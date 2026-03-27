"""
Chalk NBA Projection Model v2.0
================================
Morning script (runs at 10:00 AM ET) generating player and team projections
for every NBA game tonight.

Execution order:
  0. Load league averages from DB
  1. Fetch tonight's schedule (BallDontLie)
  1b. Fetch live odds (Odds API) → implied_total + spread per game
  1c. Build OUT players map + usage boosts
  2. For each player on a team playing tonight:
     a. Compute weighted base: L5×0.35 + L10×0.30 + L20×0.20 + season×0.15
     b. Classify archetype (6 types)
     c. Apply 8-12 factors per prop type
     d. Compute confidence with soft cap 85 → hard cap 92
     e. Apply minimum edge threshold
     f. Write to chalk_projections
  3. Compute team props: Total, Spread, Moneyline
  4. Log summary

Player props: Points, Rebounds, Assists, Threes, PRA, P+R, P+A, A+R
Team props:   Total, Spread, Moneyline
"""

from __future__ import annotations
import argparse
import json
import logging
import math
import os
import sys
import urllib.request
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

DATABASE_URL   = os.getenv('DATABASE_URL', '')
BDL_BASE       = 'https://api.balldontlie.io/v1'
BDL_KEY        = os.getenv('BALLDONTLIE_API_KEY', '')
ODDS_API_KEY   = os.getenv('ODDS_API_KEY', '')
ODDS_BASE      = 'https://api.the-odds-api.com/v4'
CURRENT_SEASON = '2025-26'

# ---------------------------------------------------------------------------
# Archetype constants
# ---------------------------------------------------------------------------
DOMINANT_SCORER  = 'DOMINANT_SCORER'
TRUE_PLAYMAKER   = 'TRUE_PLAYMAKER'
TRUE_BIG         = 'TRUE_BIG'
TWO_WAY_STAR     = 'TWO_WAY_STAR'
THREE_AND_D      = 'THREE_AND_D'
ROLE_PLAYER      = 'ROLE_PLAYER'

# ---------------------------------------------------------------------------
# Team name → Odds API abbreviation lookup
# ---------------------------------------------------------------------------
TEAM_ABBR_TO_ODDS: dict[str, str] = {
    'ATL': 'Atlanta Hawks',      'BOS': 'Boston Celtics',
    'BKN': 'Brooklyn Nets',      'CHA': 'Charlotte Hornets',
    'CHI': 'Chicago Bulls',      'CLE': 'Cleveland Cavaliers',
    'DAL': 'Dallas Mavericks',   'DEN': 'Denver Nuggets',
    'DET': 'Detroit Pistons',    'GSW': 'Golden State Warriors',
    'HOU': 'Houston Rockets',    'IND': 'Indiana Pacers',
    'LAC': 'LA Clippers',        'LAL': 'Los Angeles Lakers',
    'MEM': 'Memphis Grizzlies',  'MIA': 'Miami Heat',
    'MIL': 'Milwaukee Bucks',    'MIN': 'Minnesota Timberwolves',
    'NOP': 'New Orleans Pelicans','NYK': 'New York Knicks',
    'OKC': 'Oklahoma City Thunder','ORL': 'Orlando Magic',
    'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
    'POR': 'Portland Trail Blazers','SAC': 'Sacramento Kings',
    'SAS': 'San Antonio Spurs',  'TOR': 'Toronto Raptors',
    'UTA': 'Utah Jazz',          'WAS': 'Washington Wizards',
    'MEM': 'Memphis Grizzlies',
}
FULL_NAME_TO_ABBR: dict[str, str] = {v: k for k, v in TEAM_ABBR_TO_ODDS.items()}

# ---------------------------------------------------------------------------
# League averages (populated from DB in Step 0)
# ---------------------------------------------------------------------------
LEAGUE_AVG: dict[str, float] = {
    'pace':        100.0,
    'pts_pg':       15.0,
    'reb_pg':        5.0,
    'ast_pg':        3.5,
    'fg3m_pg':       1.5,
    'game_total':  225.0,
}

# ---------------------------------------------------------------------------
# Minimum edge thresholds (projection must exceed line by at least this)
# ---------------------------------------------------------------------------
MIN_EDGE: dict[str, float] = {
    'points':    0.8,
    'rebounds':  0.5,
    'assists':   0.4,
    'threes':    0.25,
    'pra':       1.5,
    'pr':        1.0,
    'pa':        1.0,
    'ar':        0.8,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_float(v, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def normal_cdf(x: float) -> float:
    """Standard normal CDF via math.erf."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def cap_confidence(raw: float) -> float:
    """Soft cap at 85, hard cap at 92."""
    if raw <= 85.0:
        return raw
    excess = raw - 85.0
    capped = 85.0 + excess * 0.40
    return min(92.0, capped)


def log5(prob_a: float, prob_b: float) -> float:
    """Log5 formula: probability team A beats team B."""
    a = clamp(prob_a, 0.05, 0.95)
    b = clamp(prob_b, 0.05, 0.95)
    num   = a * (1 - b)
    denom = a * (1 - b) + (1 - a) * b
    return num / denom if denom else 0.5


def bdl_fetch(path: str, params: dict | None = None) -> dict | None:
    url = f"{BDL_BASE}{path}"
    if params:
        qs = '&'.join(f"{k}={v}" for k, v in params.items())
        url += f"?{qs}"
    try:
        req = urllib.request.Request(url, headers={'Authorization': BDL_KEY})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        log.warning("BDL fetch failed %s: %s", path, e)
        return None


def odds_fetch(path: str, params: dict | None = None) -> list | None:
    base_params = {'apiKey': ODDS_API_KEY}
    if params:
        base_params.update(params)
    qs  = '&'.join(f"{k}={v}" for k, v in base_params.items())
    url = f"{ODDS_BASE}{path}?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        log.warning("Odds API fetch failed %s: %s", path, e)
        return None


# ---------------------------------------------------------------------------
# Step 0 — Load league averages from DB
# ---------------------------------------------------------------------------

def load_league_averages(conn) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT stat_name, stat_value FROM league_averages WHERE sport = 'NBA'"
            )
            for row in cur.fetchall():
                LEAGUE_AVG[row[0]] = float(row[1])
        log.info("League averages loaded: %s", LEAGUE_AVG)
    except Exception as e:
        log.warning("Could not load league averages (using hardcoded defaults): %s", e)


# ---------------------------------------------------------------------------
# Step 1 — Tonight's schedule
# ---------------------------------------------------------------------------

def get_todays_games(game_date: str) -> list[dict]:
    """Returns list of {home_team, away_team, game_id, start_time}."""
    data = bdl_fetch('/games', {
        'dates[]': game_date,
        'per_page': 50,
    })
    if not data or not data.get('data'):
        return []
    games = []
    for g in data['data']:
        home = g.get('home_team', {}).get('abbreviation', '')
        away = g.get('visitor_team', {}).get('abbreviation', '')
        if home and away:
            games.append({
                'game_id':    g['id'],
                'home_team':  home,
                'away_team':  away,
                'start_time': g.get('status', ''),
            })
    return games


# ---------------------------------------------------------------------------
# Step 1b — Live odds
# ---------------------------------------------------------------------------

def fetch_nba_odds(game_date: str) -> dict[str, dict]:
    """
    Returns dict keyed by 'HOME_AWAY' → {implied_total, spread, home_ml, away_ml}.
    Falls back to league averages if API unavailable.
    """
    data = odds_fetch(
        '/sports/basketball_nba/odds',
        {'regions': 'us', 'markets': 'h2h,spreads,totals', 'oddsFormat': 'american'}
    )
    result: dict[str, dict] = {}
    if not data:
        return result

    for event in data:
        home_full = event.get('home_team', '')
        away_full = event.get('away_team', '')
        home_abbr = FULL_NAME_TO_ABBR.get(home_full, '')
        away_abbr = FULL_NAME_TO_ABBR.get(away_full, '')
        if not home_abbr or not away_abbr:
            continue

        key = f"{home_abbr}_{away_abbr}"
        entry: dict = {
            'implied_total': LEAGUE_AVG['game_total'],
            'spread':        0.0,
            'home_ml':       None,
            'away_ml':       None,
        }

        for bm in event.get('bookmakers', []):
            for market in bm.get('markets', []):
                if market['key'] == 'totals':
                    for outcome in market.get('outcomes', []):
                        if outcome['name'] == 'Over':
                            entry['implied_total'] = safe_float(outcome.get('point', LEAGUE_AVG['game_total']))
                elif market['key'] == 'spreads':
                    for outcome in market.get('outcomes', []):
                        if outcome['name'] == home_full:
                            entry['spread'] = safe_float(outcome.get('point', 0.0))
                elif market['key'] == 'h2h':
                    for outcome in market.get('outcomes', []):
                        if outcome['name'] == home_full:
                            entry['home_ml'] = safe_float(outcome.get('price'))
                        elif outcome['name'] == away_full:
                            entry['away_ml'] = safe_float(outcome.get('price'))
            break  # use first bookmaker only

        result[key] = entry

    return result


# ---------------------------------------------------------------------------
# Step 1c — OUT players + usage boost
# ---------------------------------------------------------------------------

def get_out_players(conn, team_abbr: str, game_date: str) -> list[dict]:
    """Players confirmed OUT from nightly_roster."""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT player_id, player_name
                   FROM nightly_roster
                   WHERE team = %s AND sport = 'NBA' AND game_date = %s
                     AND is_confirmed_playing = false""",
                (team_abbr, game_date)
            )
            return cur.fetchall()
    except Exception:
        return []


def compute_usage_boost(conn, team_abbr: str, out_players: list[dict], game_date: str) -> float:
    """
    Each OUT player contributes ~22% usage. Remaining players share it.
    Redistribution efficiency = 0.85.
    Returns boost to add to each active player's usage factor (capped at +0.30).
    """
    if not out_players:
        return 0.0
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM nightly_roster WHERE team = %s AND sport = 'NBA' AND game_date = %s AND is_confirmed_playing = true",
                (team_abbr, game_date)
            )
            active = cur.fetchone()[0] or 8
    except Exception:
        active = 8

    lost_usage = len(out_players) * 0.22
    boost_per_player = (lost_usage * 0.85) / max(active, 1)
    return clamp(boost_per_player, 0.0, 0.30)


# ---------------------------------------------------------------------------
# Archetype classification
# ---------------------------------------------------------------------------

def classify_archetype(
    pts_pg: float, ast_pg: float, reb_pg: float,
    usage: float, position: str,
    fg3a_pg: float, stl_pg: float, blk_pg: float
) -> str:
    pos = (position or '').upper()
    if usage > 1.25 and pts_pg > 22:
        return DOMINANT_SCORER
    if ast_pg > 7 and usage < 1.20:
        return TRUE_PLAYMAKER
    if pos in ('C', 'PF') and reb_pg > 8:
        return TRUE_BIG
    if pts_pg > 20 and reb_pg > 7 and ast_pg > 5:
        return TWO_WAY_STAR
    if fg3a_pg > 4 and (stl_pg + blk_pg) > 1:
        return THREE_AND_D
    return ROLE_PLAYER


# ---------------------------------------------------------------------------
# Position defense factor
# ---------------------------------------------------------------------------

def get_position_defense_factor(conn, opponent: str, position: str, stat: str) -> float:
    """
    Returns factor relative to league average. 1.0 = average defense.
    < 1.0 = tough defense (fewer allowed). > 1.0 = soft defense (more allowed).
    opponent is the team abbreviation — we match against team_name with ILIKE.
    """
    if not position or not opponent:
        return 1.0

    # Map stat name to DB column
    stat_col_map = {
        'points':     'pts_allowed',
        'pts':        'pts_allowed',
        'rebounds':   'reb_allowed',
        'reb':        'reb_allowed',
        'assists':    'ast_allowed',
        'ast':        'ast_allowed',
        'threes':     'three_allowed',
        'three_made': 'three_allowed',
        'fg3m':       'three_allowed',
    }
    col = stat_col_map.get(stat)
    if not col:
        return 1.0

    # Map DB column to LEAGUE_AVG key for normalization
    lg_key_map = {
        'pts_allowed':   'pts_pg',
        'reb_allowed':   'reb_pg',
        'ast_allowed':   'ast_pg',
        'three_allowed': 'fg3m_pg',
    }
    lg_key = lg_key_map.get(col, 'pts_pg')
    league_avg_val = LEAGUE_AVG.get(lg_key, 0.0)
    if league_avg_val <= 0:
        return 1.0

    try:
        with conn.cursor() as cur:
            # Try position-specific row first, then fall back to aggregate 'ALL' row
            for pos_lookup in (position.upper(), 'ALL'):
                cur.execute(
                    f"""SELECT {col}
                        FROM position_defense_ratings
                        WHERE team_name ILIKE %s AND position = %s AND sport = 'NBA'
                        ORDER BY updated_at DESC LIMIT 1""",
                    (f'%{opponent}%', pos_lookup)
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    factor = float(row[0]) / league_avg_val
                    # Tighter clamp: ±20% vs ±30% to avoid dominating total projection
                    return clamp(factor, 0.80, 1.20)
    except Exception:
        pass
    return 1.0


# ---------------------------------------------------------------------------
# Player game log fetch
# ---------------------------------------------------------------------------

def get_player_logs(conn, player_id: int, sport: str = 'NBA') -> list[dict]:
    """Returns game logs ordered by game date desc."""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT *
                   FROM player_game_logs
                   WHERE player_id = %s AND sport = %s
                   ORDER BY game_date DESC
                   LIMIT 25""",
                (player_id, sport)
            )
            return cur.fetchall()
    except Exception:
        return []


def get_player_season_avgs(conn, player_id: int) -> dict:
    """Returns season averages from BallDontLie or DB aggregate."""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT
                     AVG(points)     AS pts_pg,
                     AVG(rebounds)   AS reb_pg,
                     AVG(assists)    AS ast_pg,
                     AVG(three_made) AS fg3m_pg,
                     AVG(three_att)  AS fg3a_pg,
                     AVG(steals)     AS stl_pg,
                     AVG(blocks)     AS blk_pg,
                     AVG(minutes)    AS min_pg,
                     AVG(fg_att)     AS fga_pg,
                     AVG(fg_made)    AS fgm_pg,
                     AVG(ft_att)     AS fta_pg,
                     AVG(ft_made)    AS ftm_pg,
                     COUNT(*)        AS games_played
                   FROM player_game_logs
                   WHERE player_id = %s AND sport = 'NBA' AND season = %s""",
                (player_id, CURRENT_SEASON)
            )
            row = cur.fetchone()
            return dict(row) if row else {}
    except Exception:
        return {}


def rolling_avg(logs: list[dict], stat: str, n: int) -> float:
    vals = [safe_float(r.get(stat)) for r in logs[:n] if r.get(stat) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def weighted_base(logs: list[dict], season_avg: float, stat: str) -> float:
    """L5×0.35 + L10×0.30 + L20×0.20 + season×0.15"""
    l5  = rolling_avg(logs, stat, 5)
    l10 = rolling_avg(logs, stat, 10)
    l20 = rolling_avg(logs, stat, 20)
    return l5*0.35 + l10*0.30 + l20*0.20 + season_avg*0.15


def weighted_base_threes(logs: list[dict], season_avg: float) -> float:
    """Threes special: L5×0.50 + L10×0.25 + L20×0.15 + season×0.10"""
    l5  = rolling_avg(logs, 'three_made', 5)
    l10 = rolling_avg(logs, 'three_made', 10)
    l20 = rolling_avg(logs, 'three_made', 20)
    return l5*0.50 + l10*0.25 + l20*0.15 + season_avg*0.10


# ---------------------------------------------------------------------------
# Team pace fetch
# ---------------------------------------------------------------------------

def get_team_pace(conn, team_abbr: str) -> float:
    """Returns team pace from team_game_logs. Falls back to league avg."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT AVG(pace) FROM (
                     SELECT pace FROM team_game_logs
                     WHERE team_name ILIKE %s AND sport = 'NBA'
                       AND pace IS NOT NULL
                     ORDER BY game_date DESC
                     LIMIT 15
                   ) recent""",
                (f'%{team_abbr}%',)
            )
            row = cur.fetchone()
            if row and row[0]:
                return float(row[0])
    except Exception:
        pass
    return LEAGUE_AVG['pace']


def get_team_record(conn, team_abbr: str) -> tuple[int, int]:
    """Returns (wins, losses) from recent team_game_logs."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT result
                   FROM team_game_logs
                   WHERE team_name ILIKE %s AND sport = 'NBA'
                   ORDER BY game_date DESC
                   LIMIT 20""",
                (f'%{team_abbr}%',)
            )
            rows = cur.fetchall()
            if rows:
                wins   = sum(1 for r in rows if r[0] == 'W')
                losses = len(rows) - wins
                return (wins, losses)
    except Exception:
        pass
    return (41, 41)


def get_rest_days(conn, player_id: int, game_date: str) -> int:
    """Days since last game for this player."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT game_date FROM player_game_logs
                   WHERE player_id = %s AND sport = 'NBA' AND game_date < %s
                   ORDER BY game_date DESC LIMIT 1""",
                (player_id, game_date)
            )
            row = cur.fetchone()
            if row and row[0]:
                from datetime import datetime
                last = row[0] if hasattr(row[0], 'days') else \
                    __import__('datetime').date.fromisoformat(str(row[0]))
                current = __import__('datetime').date.fromisoformat(game_date)
                return (current - last).days
    except Exception:
        pass
    return 2


def get_home_away_split(conn, player_id: int, stat: str, is_home: bool) -> float:
    """Average stat across last 20 home or away games. Returns 0 if insufficient data."""
    side_filter = "home_away = 'home'" if is_home else "home_away = 'away'"
    try:
        with conn.cursor() as cur:
            # LIMIT must be inside the subquery — LIMIT on AVG has no effect
            cur.execute(
                f"""SELECT AVG(v) FROM (
                        SELECT {stat} AS v
                        FROM player_game_logs
                        WHERE player_id = %s AND sport = 'NBA'
                          AND season = %s AND {side_filter}
                        ORDER BY game_date DESC
                        LIMIT 20
                    ) recent""",
                (player_id, CURRENT_SEASON)
            )
            row = cur.fetchone()
            if row and row[0]:
                return float(row[0])
    except Exception:
        pass
    return 0.0


# ---------------------------------------------------------------------------
# Archetype combo correlation factors
# ---------------------------------------------------------------------------

COMBO_CORRELATIONS: dict[str, dict[str, float]] = {
    # PRA correlations
    DOMINANT_SCORER: {'pra': 0.95, 'pr': 0.92, 'pa': 0.88, 'ar': 0.80},
    TRUE_PLAYMAKER:  {'pra': 0.92, 'pr': 0.82, 'pa': 0.95, 'ar': 0.90},
    TRUE_BIG:        {'pra': 0.90, 'pr': 0.96, 'pa': 0.78, 'ar': 0.80},
    TWO_WAY_STAR:    {'pra': 0.96, 'pr': 0.93, 'pa': 0.91, 'ar': 0.85},
    THREE_AND_D:     {'pra': 0.85, 'pr': 0.82, 'pa': 0.80, 'ar': 0.78},
    ROLE_PLAYER:     {'pra': 0.82, 'pr': 0.80, 'pa': 0.80, 'ar': 0.78},
}


# ---------------------------------------------------------------------------
# Core projection function
# ---------------------------------------------------------------------------

@dataclass
class PlayerProjection:
    player_id:     int
    player_name:   str
    team:          str
    opponent:      str
    is_home:       bool
    position:      str
    archetype:     str
    game_date:     str
    props:         dict = field(default_factory=dict)   # prop_type → {proj, confidence, line, edge, factors_json}


def project_player(
    conn,
    player_id: int,
    player_name: str,
    team: str,
    opponent: str,
    is_home: bool,
    position: str,
    game_date: str,
    implied_total: float,
    spread: float,
    usage_boost: float = 0.0,
) -> PlayerProjection | None:
    logs       = get_player_logs(conn, player_id)
    season_avg = get_player_season_avgs(conn, player_id)

    if not logs and not season_avg:
        return None

    # Season averages with safe defaults
    pts_season  = safe_float(season_avg.get('pts_pg'), LEAGUE_AVG['pts_pg'])
    reb_season  = safe_float(season_avg.get('reb_pg'), LEAGUE_AVG['reb_pg'])
    ast_season  = safe_float(season_avg.get('ast_pg'), LEAGUE_AVG['ast_pg'])
    fg3m_season = safe_float(season_avg.get('fg3m_pg'), LEAGUE_AVG['fg3m_pg'])
    fg3a_season = safe_float(season_avg.get('fg3a_pg'), 3.0)
    stl_season  = safe_float(season_avg.get('stl_pg'), 0.8)
    blk_season  = safe_float(season_avg.get('blk_pg'), 0.5)
    min_season  = safe_float(season_avg.get('min_pg'), 25.0)
    fga_season  = safe_float(season_avg.get('fga_pg'), 12.0)
    fgm_season  = safe_float(season_avg.get('fgm_pg'), 5.0)
    fta_season  = safe_float(season_avg.get('fta_pg'), 3.0)
    ftm_season  = safe_float(season_avg.get('ftm_pg'), 2.5)

    # TS% = pts / (2 * (fga + 0.44*fta))
    ts_denom = 2 * (fga_season + 0.44 * fta_season)
    ts_pct   = pts_season / ts_denom if ts_denom > 0 else 0.50
    ts_lg    = 0.565  # league average TS%
    ts_f     = clamp(ts_pct / ts_lg, 0.85, 1.15)

    # Usage approximation — normalized so league-average player ≈ 1.0.
    # Denominator min * 0.38 gives ~1.0 for a typical starter (8 FGA, 2.5 FTA, 25 min).
    # High-usage stars (15 FGA, 6 FTA, 35 min) get ~1.30-1.35.
    # min * 0.20 was wrong: produced 2.0+ for all starters, everyone hit the 1.45 ceiling.
    usage_approx = (fga_season + 0.44 * fta_season) / max(min_season * 0.38, 1)
    usage_f = clamp(usage_approx + usage_boost, 0.70, 1.45)

    # Archetype
    archetype = classify_archetype(
        pts_season, ast_season, reb_season,
        usage_approx, position, fg3a_season, stl_season, blk_season
    )

    # Pace factor
    team_pace = get_team_pace(conn, team)
    opp_pace  = get_team_pace(conn, opponent)
    avg_pace  = (team_pace + opp_pace) / 2
    pace_f    = clamp(avg_pace / LEAGUE_AVG['pace'], 0.90, 1.10)

    # Rest factor
    rest_days = get_rest_days(conn, player_id, game_date)
    if rest_days == 0:
        rest_f = 0.92   # B2B
    elif rest_days == 1:
        rest_f = 0.97
    elif rest_days >= 3:
        rest_f = 1.03   # extra rest
    else:
        rest_f = 1.00

    # Home/away factor (per stat)
    home_pts_avg  = get_home_away_split(conn, player_id, 'points', is_home)
    home_reb_avg  = get_home_away_split(conn, player_id, 'rebounds', is_home)
    home_ast_avg  = get_home_away_split(conn, player_id, 'assists', is_home)

    def home_away_f(split_avg: float, base: float) -> float:
        if split_avg > 0 and base > 0:
            return clamp(split_avg / base, 0.90, 1.10)
        return 1.02 if is_home else 0.98

    ha_pts_f = home_away_f(home_pts_avg, pts_season)
    ha_reb_f = home_away_f(home_reb_avg, reb_season)
    ha_ast_f = home_away_f(home_ast_avg, ast_season)

    # Opponent position defense factors
    pos_def_pts  = get_position_defense_factor(conn, opponent, position, 'points')
    pos_def_reb  = get_position_defense_factor(conn, opponent, position, 'rebounds')
    pos_def_ast  = get_position_defense_factor(conn, opponent, position, 'assists')
    pos_def_3pm  = get_position_defense_factor(conn, opponent, position, 'three_made')

    # Implied total factor (team scoring context)
    # league avg ~225, each team scores ~112.5
    implied_team_pts  = implied_total / 2.0
    total_f           = clamp(implied_total / LEAGUE_AVG['game_total'], 0.92, 1.10)
    scoring_context_f = clamp(implied_team_pts / 112.5, 0.90, 1.12)

    # Spread / game script
    # Large spread → starter rests → lower counting stats for favorite
    abs_spread = abs(spread)
    if abs_spread > 12:
        game_script_f = 0.90
    elif abs_spread > 8:
        game_script_f = 0.95
    else:
        game_script_f = 1.00

    # ────────────────────────────────────────────────────────────────────────
    # POINTS
    # ────────────────────────────────────────────────────────────────────────
    base_pts   = weighted_base(logs, pts_season, 'points')
    l5_pts     = rolling_avg(logs, 'points', 5)
    l10_pts    = rolling_avg(logs, 'points', 10)

    proj_pts   = (base_pts
                  * pos_def_pts
                  * pace_f
                  * rest_f
                  * ha_pts_f
                  * ts_f
                  * usage_f
                  * scoring_context_f
                  * game_script_f)

    # Confidence: base 60 + factors
    conf_pts_raw = (60.0
                    + (10 if len(logs) >= 10 else 5)           # sample size
                    + (8  if abs(base_pts - l5_pts) < 2 else 2)  # consistency
                    + (5  if pos_def_pts != 1.0 else 0)         # matchup data
                    + (5  if pace_f > 1.02 else 0)              # pace boost
                    + (4  if usage_f > 1.10 else 0)             # usage spike
                    + (3  if rest_f >= 1.0 else -3)             # rest edge
                    + (4  if abs(ha_pts_f - 1.0) > 0.02 else 0) # h/a split
                    + (4  if ts_f > 1.02 else 0))               # efficiency edge
    conf_pts = cap_confidence(conf_pts_raw)

    factors_pts = {
        'base':           round(base_pts, 2),
        'l5':             round(l5_pts, 2),
        'l10':            round(l10_pts, 2),
        'season_avg':     round(pts_season, 2),
        'pos_def_f':      round(pos_def_pts, 3),
        'pace_f':         round(pace_f, 3),
        'rest_f':         round(rest_f, 3),
        'home_away_f':    round(ha_pts_f, 3),
        'ts_f':           round(ts_f, 3),
        'usage_f':        round(usage_f, 3),
        'scoring_ctx_f':  round(scoring_context_f, 3),
        'game_script_f':  round(game_script_f, 3),
        'archetype':      archetype,
        'implied_total':  round(implied_total, 1),
        'spread':         round(spread, 1),
        'usage_boost':    round(usage_boost, 3),
    }

    # ────────────────────────────────────────────────────────────────────────
    # REBOUNDS
    # ────────────────────────────────────────────────────────────────────────
    base_reb = weighted_base(logs, reb_season, 'rebounds')
    l5_reb   = rolling_avg(logs, 'rebounds', 5)
    l10_reb  = rolling_avg(logs, 'rebounds', 10)

    # Big man bonus
    big_bonus = 1.08 if archetype == TRUE_BIG else 1.00

    proj_reb = (base_reb
                * pos_def_reb
                * pace_f
                * rest_f
                * ha_reb_f
                * big_bonus
                * total_f
                * game_script_f)

    conf_reb_raw = (60.0
                    + (10 if len(logs) >= 10 else 5)
                    + (8  if abs(base_reb - l5_reb) < 1 else 2)
                    + (5  if pos_def_reb != 1.0 else 0)
                    + (5  if archetype == TRUE_BIG else 0)
                    + (4  if pace_f > 1.02 else 0)
                    + (3  if rest_f >= 1.0 else -3)
                    + (3  if abs(ha_reb_f - 1.0) > 0.02 else 0))
    conf_reb = cap_confidence(conf_reb_raw)

    factors_reb = {
        'base':        round(base_reb, 2),
        'l5':          round(l5_reb, 2),
        'l10':         round(l10_reb, 2),
        'season_avg':  round(reb_season, 2),
        'pos_def_f':   round(pos_def_reb, 3),
        'pace_f':      round(pace_f, 3),
        'rest_f':      round(rest_f, 3),
        'home_away_f': round(ha_reb_f, 3),
        'big_bonus':   round(big_bonus, 3),
        'total_f':     round(total_f, 3),
        'game_script_f': round(game_script_f, 3),
        'archetype':   archetype,
    }

    # ────────────────────────────────────────────────────────────────────────
    # ASSISTS
    # ────────────────────────────────────────────────────────────────────────
    base_ast = weighted_base(logs, ast_season, 'assists')
    l5_ast   = rolling_avg(logs, 'assists', 5)
    l10_ast  = rolling_avg(logs, 'assists', 10)

    # Playmaker bonus
    pg_bonus = 1.08 if archetype == TRUE_PLAYMAKER else 1.00

    proj_ast = (base_ast
                * pos_def_ast
                * pace_f
                * rest_f
                * ha_ast_f
                * pg_bonus
                * total_f)

    conf_ast_raw = (60.0
                    + (10 if len(logs) >= 10 else 5)
                    + (8  if abs(base_ast - l5_ast) < 1 else 2)
                    + (5  if pos_def_ast != 1.0 else 0)
                    + (5  if archetype == TRUE_PLAYMAKER else 0)
                    + (4  if pace_f > 1.02 else 0)
                    + (3  if rest_f >= 1.0 else -3)
                    + (3  if abs(ha_ast_f - 1.0) > 0.02 else 0))
    conf_ast = cap_confidence(conf_ast_raw)

    factors_ast = {
        'base':        round(base_ast, 2),
        'l5':          round(l5_ast, 2),
        'l10':         round(l10_ast, 2),
        'season_avg':  round(ast_season, 2),
        'pos_def_f':   round(pos_def_ast, 3),
        'pace_f':      round(pace_f, 3),
        'rest_f':      round(rest_f, 3),
        'home_away_f': round(ha_ast_f, 3),
        'pg_bonus':    round(pg_bonus, 3),
        'total_f':     round(total_f, 3),
        'archetype':   archetype,
    }

    # ────────────────────────────────────────────────────────────────────────
    # THREES (fg3m) — special L5 weighting
    # ────────────────────────────────────────────────────────────────────────
    base_3pm = weighted_base_threes(logs, fg3m_season)
    l5_3pm   = rolling_avg(logs, 'three_made', 5)
    l10_3pm  = rolling_avg(logs, 'three_made', 10)

    # 3-and-D archetype bonus
    threes_bonus = 1.10 if archetype == THREE_AND_D else 1.00

    proj_3pm = (base_3pm
                * pos_def_3pm
                * pace_f
                * rest_f
                * threes_bonus
                * total_f)

    # Three-point volume check: project at least fg3a * avg_pct if base is very low
    avg_3pt_pct = safe_float(season_avg.get('fg3m_pg'), 0) / fg3a_season if fg3a_season > 0 else 0.35
    vol_floor   = fg3a_season * avg_3pt_pct * 0.80
    proj_3pm    = max(proj_3pm, vol_floor * 0.70)

    conf_3pm_raw = (55.0
                    + (10 if len(logs) >= 10 else 5)
                    + (8  if abs(base_3pm - l5_3pm) < 0.5 else 2)
                    + (6  if fg3a_season > 5 else 0)                # high volume shooter
                    + (5  if archetype == THREE_AND_D else 0)
                    + (5  if pos_def_3pm != 1.0 else 0)
                    + (3  if pace_f > 1.02 else 0)
                    + (3  if rest_f >= 1.0 else -3))
    conf_3pm = cap_confidence(conf_3pm_raw)

    factors_3pm = {
        'base':        round(base_3pm, 2),
        'l5':          round(l5_3pm, 2),
        'l10':         round(l10_3pm, 2),
        'season_avg':  round(fg3m_season, 2),
        'fg3a_pg':     round(fg3a_season, 2),
        'pos_def_f':   round(pos_def_3pm, 3),
        'pace_f':      round(pace_f, 3),
        'rest_f':      round(rest_f, 3),
        'threes_bonus': round(threes_bonus, 3),
        'total_f':     round(total_f, 3),
        'archetype':   archetype,
        'special_weighting': 'L5×0.50 + L10×0.25 + L20×0.15 + season×0.10',
    }

    # ────────────────────────────────────────────────────────────────────────
    # COMBO PROPS (archetype correlation)
    # ────────────────────────────────────────────────────────────────────────
    corr = COMBO_CORRELATIONS.get(archetype, COMBO_CORRELATIONS[ROLE_PLAYER])

    # PRA = pts + reb + ast
    proj_pra  = (proj_pts + proj_reb + proj_ast) * corr['pra']
    conf_pra  = cap_confidence((conf_pts + conf_reb + conf_ast) / 3 + 2)
    factors_pra = {
        'proj_pts': round(proj_pts, 2), 'proj_reb': round(proj_reb, 2),
        'proj_ast': round(proj_ast, 2), 'corr_f': corr['pra'],
        'archetype': archetype,
    }

    # P+R
    proj_pr   = (proj_pts + proj_reb) * corr['pr']
    conf_pr   = cap_confidence((conf_pts + conf_reb) / 2 + 2)
    factors_pr = {
        'proj_pts': round(proj_pts, 2), 'proj_reb': round(proj_reb, 2),
        'corr_f': corr['pr'], 'archetype': archetype,
    }

    # P+A
    proj_pa   = (proj_pts + proj_ast) * corr['pa']
    conf_pa   = cap_confidence((conf_pts + conf_ast) / 2 + 2)
    factors_pa = {
        'proj_pts': round(proj_pts, 2), 'proj_ast': round(proj_ast, 2),
        'corr_f': corr['pa'], 'archetype': archetype,
    }

    # A+R
    proj_ar   = (proj_ast + proj_reb) * corr['ar']
    conf_ar   = cap_confidence((conf_ast + conf_reb) / 2 + 2)
    factors_ar = {
        'proj_ast': round(proj_ast, 2), 'proj_reb': round(proj_reb, 2),
        'corr_f': corr['ar'], 'archetype': archetype,
    }

    return PlayerProjection(
        player_id   = player_id,
        player_name = player_name,
        team        = team,
        opponent    = opponent,
        is_home     = is_home,
        position    = position,
        archetype   = archetype,
        game_date   = game_date,
        props       = {
            'points':    {'proj': proj_pts,  'conf': conf_pts,  'factors': factors_pts},
            'rebounds':  {'proj': proj_reb,  'conf': conf_reb,  'factors': factors_reb},
            'assists':   {'proj': proj_ast,  'conf': conf_ast,  'factors': factors_ast},
            'threes':    {'proj': proj_3pm,  'conf': conf_3pm,  'factors': factors_3pm},
            'pra':       {'proj': proj_pra,  'conf': conf_pra,  'factors': factors_pra},
            'pr':        {'proj': proj_pr,   'conf': conf_pr,   'factors': factors_pr},
            'pa':        {'proj': proj_pa,   'conf': conf_pa,   'factors': factors_pa},
            'ar':        {'proj': proj_ar,   'conf': conf_ar,   'factors': factors_ar},
        },
    )


# ---------------------------------------------------------------------------
# Team props: Total, Spread, Moneyline
# ---------------------------------------------------------------------------

def project_team_props(
    conn,
    home_team: str,
    away_team: str,
    game_date: str,
    implied_total: float,
    spread: float,
    home_ml: float | None,
    away_ml: float | None,
) -> dict:
    """Computes Total, Spread, Moneyline for the game."""

    home_pace = get_team_pace(conn, home_team)
    away_pace = get_team_pace(conn, away_team)
    avg_pace  = (home_pace + away_pace) / 2

    # ── TOTAL ────────────────────────────────────────────────────────────────
    pace_f       = clamp(avg_pace / LEAGUE_AVG['pace'], 0.90, 1.10)
    total_base   = implied_total if implied_total > 0 else LEAGUE_AVG['game_total']

    # Position defense aggregates per team
    # Compute a single composite factor = avg pts_allowed / league_avg pts
    lg_pts = LEAGUE_AVG.get('pts_pg', 15.0)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT AVG(pts_allowed)
                   FROM position_defense_ratings
                   WHERE team_name ILIKE %s AND sport = 'NBA'""",
                (f'%{home_team}%',)
            )
            row = cur.fetchone()
            raw_home = float(row[0]) if row and row[0] else None
            home_def_f = clamp(raw_home / lg_pts, 0.85, 1.15) if raw_home else 1.0

            cur.execute(
                """SELECT AVG(pts_allowed)
                   FROM position_defense_ratings
                   WHERE team_name ILIKE %s AND sport = 'NBA'""",
                (f'%{away_team}%',)
            )
            row = cur.fetchone()
            raw_away = float(row[0]) if row and row[0] else None
            away_def_f = clamp(raw_away / lg_pts, 0.85, 1.15) if raw_away else 1.0
    except Exception:
        home_def_f = 1.0
        away_def_f = 1.0

    # Both defenses affect total
    combined_def_f = (home_def_f + away_def_f) / 2
    proj_total = total_base * pace_f * combined_def_f

    # Normal CDF cover probability (std_dev 12.5 for totals)
    std_dev_total  = 12.5
    over_prob      = 1.0 - normal_cdf(0.5 / std_dev_total)
    # Shift based on proj vs implied
    delta_total    = proj_total - implied_total
    over_prob      = clamp(0.5 + delta_total / (2 * std_dev_total), 0.10, 0.90)

    # ── SPREAD ──────────────────────────────────────────────────────────────
    # Home baseline 59%
    home_win_prob_base = 0.59

    # HCA adjustments
    home_rec = get_team_record(conn, home_team)
    away_rec = get_team_record(conn, away_team)
    home_win_pct = home_rec[0] / max(sum(home_rec), 1)
    away_win_pct = away_rec[0] / max(sum(away_rec), 1)

    # Pace matchup: faster home team benefits more at home
    pace_spread_f = clamp((home_pace - away_pace) / 20, -0.05, 0.05)
    home_win_prob = clamp(home_win_prob_base + (home_win_pct - 0.50) * 0.20
                          + (0.50 - away_win_pct) * 0.15
                          + pace_spread_f, 0.30, 0.75)

    # Spread cover probability (std_dev 13.5 for spreads)
    std_dev_spread = 13.5
    expected_margin = (home_win_prob - 0.5) * 2 * std_dev_spread
    cover_prob     = 1.0 - normal_cdf((spread + expected_margin) / std_dev_spread) \
                     if spread > 0 else normal_cdf((-spread - expected_margin) / std_dev_spread)
    cover_prob     = clamp(cover_prob, 0.10, 0.90)

    # ── MONEYLINE ────────────────────────────────────────────────────────────
    # Log5 from team win percentages
    log5_home = log5(home_win_pct + 0.05, away_win_pct)  # +0.05 HCA
    log5_home = clamp(log5_home, 0.10, 0.90)

    # Adjust for pace and defense
    ml_home_final = clamp(log5_home + pace_spread_f * 0.5, 0.10, 0.90)
    ml_away_final = 1.0 - ml_home_final

    # Implied probability from market ML (for confidence)
    def ml_to_prob(ml: float | None) -> float:
        if ml is None:
            return 0.5
        if ml > 0:
            return 100 / (ml + 100)
        return abs(ml) / (abs(ml) + 100)

    market_home_prob = ml_to_prob(home_ml)
    market_away_prob = ml_to_prob(away_ml)

    # Edge = model prob minus market implied prob
    home_ml_edge = ml_home_final - market_home_prob
    away_ml_edge = ml_away_final - market_away_prob

    # Team prop confidence
    records_available = sum(home_rec) >= 20 and sum(away_rec) >= 20
    conf_team_raw = (60
                     + (8  if records_available else 0)
                     + (6  if implied_total > 0 else 0)
                     + (5  if home_def_f != 1.0 and away_def_f != 1.0 else 0)
                     + (4  if abs(pace_f - 1.0) > 0.02 else 0))
    conf_team = cap_confidence(conf_team_raw)

    return {
        'total': {
            'proj':       round(proj_total, 1),
            'over_prob':  round(over_prob, 3),
            'under_prob': round(1 - over_prob, 3),
            'confidence': round(conf_team, 1),
            'factors': {
                'implied_total': round(implied_total, 1),
                'pace_f':        round(pace_f, 3),
                'home_def_f':    round(home_def_f, 3),
                'away_def_f':    round(away_def_f, 3),
                'std_dev':       std_dev_total,
            },
        },
        # upsert_team_props reads: proj, over_prob, under_prob, confidence
        # spread: proj = market spread value, over_prob = probability home covers
        'spread': {
            'proj':            round(spread, 1),
            'expected_margin': round(expected_margin, 2),  # model's projected home margin
            'over_prob':       round(cover_prob, 3),       # home cover probability
            'under_prob':      round(1 - cover_prob, 3),   # away cover probability
            'confidence':      round(conf_team, 1),
            'factors': {
                'spread':        round(spread, 1),
                'cover_prob':    round(cover_prob, 3),
                'home_win_prob': round(home_win_prob, 3),
                'pace_spread_f': round(pace_spread_f, 3),
                'std_dev':       std_dev_spread,
            },
        },
        # moneyline: proj = win probability (home or away depending on team row)
        # upsert reads proj_val = data.get('home_prob' if is_home else 'away_prob')
        'moneyline': {
            'home_prob':    round(ml_home_final, 3),
            'away_prob':    round(ml_away_final, 3),
            'proj':         round(ml_home_final, 3),   # home win prob as default proj
            'over_prob':    round(ml_home_final, 3),   # stored as over_prob for querying
            'under_prob':   round(ml_away_final, 3),
            'home_ml_edge': round(home_ml_edge, 3),
            'away_ml_edge': round(away_ml_edge, 3),
            'confidence':   round(conf_team, 1),
            'factors': {
                'log5_home':        round(log5_home, 3),
                'home_win_pct':     round(home_win_pct, 3),
                'away_win_pct':     round(away_win_pct, 3),
                'home_ml_edge':     round(home_ml_edge, 3),
                'away_ml_edge':     round(away_ml_edge, 3),
                'market_home_prob': round(market_home_prob, 3),
                'market_away_prob': round(market_away_prob, 3),
            },
        },
    }


# ---------------------------------------------------------------------------
# Fetch active NBA players for tonight's games
# ---------------------------------------------------------------------------

def get_players_for_team(conn, team_abbr: str, game_date: str) -> list[dict]:
    """
    Returns players confirmed playing from nightly_roster.
    Falls back to players with recent game logs if roster not populated.
    Position is always populated from player_game_logs (backfilled by nbaDataCollector).
    """
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT player_id, player_name, NULL::text AS position
                   FROM nightly_roster
                   WHERE team = %s AND sport = 'NBA' AND game_date = %s
                     AND is_confirmed_playing = true""",
                (team_abbr, game_date)
            )
            rows = cur.fetchall()
            if rows:
                players = [dict(r) for r in rows]
                # Enrich with position from player_game_logs (nightly_roster has no position column)
                ids = [p['player_id'] for p in players if p.get('player_id')]
                if ids:
                    pos_cutoff = (date.fromisoformat(game_date) - timedelta(days=30)).isoformat()
                    cur.execute(
                        """SELECT DISTINCT ON (player_id) player_id, position
                           FROM player_game_logs
                           WHERE player_id = ANY(%s) AND sport = 'NBA'
                             AND game_date >= %s AND position IS NOT NULL
                           ORDER BY player_id, game_date DESC""",
                        (ids, pos_cutoff)
                    )
                    pos_map = {r['player_id']: r['position'] for r in cur.fetchall()}
                    for p in players:
                        p['position'] = pos_map.get(p['player_id'])
                return players

            # Fallback: read actual position column — backfilled by nbaDataCollector.py
            cutoff = (date.fromisoformat(game_date) - timedelta(days=14)).isoformat()
            cur.execute(
                """SELECT DISTINCT ON (player_id) player_id, player_name,
                          position, team
                   FROM player_game_logs
                   WHERE team ILIKE %s AND sport = 'NBA' AND game_date >= %s
                   ORDER BY player_id, game_date DESC""",
                (f'%{team_abbr}%', cutoff)
            )
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        log.warning("get_players_for_team %s: %s", team_abbr, e)
        return []


# ---------------------------------------------------------------------------
# Write projections to DB
# ---------------------------------------------------------------------------

# Maps prop_type to the correct edge column in chalk_projections
EDGE_COL: dict[str, str] = {
    'points':   'edge_pts',
    'rebounds': 'edge_reb',
    'assists':  'edge_ast',
    'threes':   'edge_threes',
    'pra':      'edge_pra',
    'pr':       'edge_pts_reb',
    'pa':       'edge_pts_ast',
    'ar':       'edge_ast_reb',
}


# Maps model's internal prop_type short codes to the names stored in player_props_history.
# oddsService.js strips the 'player_' prefix, so combo markets become full underscore names.
PROP_TYPE_TO_DB: dict[str, str] = {
    'pra':      'points_rebounds_assists',
    'pr':       'points_rebounds',
    'pa':       'points_assists',
    'ar':       'rebounds_assists',
    # Individual props already stored with matching names:
    'points':   'points',
    'rebounds': 'rebounds',
    'assists':  'assists',
    'threes':   'threes',
    'blocks':   'blocks',
    'steals':   'steals',
}


def get_market_line(conn, player_name: str, prop_type: str, game_date: str) -> float | None:
    """
    Read the market prop line from player_props_history.
    Populated by oddsService.js before the model runs.
    Returns None if no line posted yet — prop is skipped.

    Matching strategy:
    1. Exact full name (case-insensitive) — avoids surname collisions (Davis, Williams, etc.)
    2. Last-name fallback only for surnames longer than 5 chars with no ambiguous matches
    """
    if not player_name:
        return None

    # Translate model short code → DB prop_type name
    db_prop_type = PROP_TYPE_TO_DB.get(prop_type, prop_type)

    try:
        with conn.cursor() as cur:
            # Primary: exact full-name match (case-insensitive)
            cur.execute(
                """SELECT prop_line
                   FROM player_props_history
                   WHERE player_name ILIKE %s
                     AND prop_type = %s
                     AND game_date = %s
                   ORDER BY created_at DESC LIMIT 1""",
                (player_name, db_prop_type, game_date)
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                return float(row[0])

            # Fallback: last name only, but only if it uniquely identifies one player
            last_name = player_name.split()[-1]
            if len(last_name) > 5:
                cur.execute(
                    """SELECT prop_line, COUNT(*) OVER () AS name_count
                       FROM player_props_history
                       WHERE player_name ILIKE %s
                         AND prop_type = %s
                         AND game_date = %s
                       ORDER BY created_at DESC LIMIT 1""",
                    (f'%{last_name}%', db_prop_type, game_date)
                )
                row = cur.fetchone()
                if row and row[0] is not None and row[1] == 1:
                    return float(row[0])
    except Exception:
        pass
    return None


def upsert_player_projections(conn, proj: PlayerProjection) -> int:
    """Writes all props for a player. Returns count written."""
    written = 0
    with conn.cursor() as cur:
        for prop_type, data in proj.props.items():
            raw_proj = data['proj']
            raw_conf = data['conf']
            factors  = data['factors']

            if raw_proj <= 0:
                continue

            # Read market line from player_props_history
            line = get_market_line(conn, proj.player_name, prop_type, proj.game_date)
            if line is None:
                # No market line posted yet — skip this prop
                continue

            edge_val  = round(raw_proj - line, 2)
            threshold = MIN_EDGE.get(prop_type, 0.5)
            if abs(edge_val) < threshold:
                continue  # edge too small — not a pick

            # Normalize prop_type to full DB name (e.g. 'pra' → 'points_rebounds_assists')
            db_prop_type = PROP_TYPE_TO_DB.get(prop_type, prop_type)
            edge_col  = EDGE_COL.get(prop_type, 'edge_pts')
            home_away = 'home' if proj.is_home else 'away'

            sql = f"""
                INSERT INTO chalk_projections
                  (player_id, player_name, team, opponent, home_away, position,
                   sport, game_date, prop_type,
                   proj_value, {edge_col}, confidence_score, factors_json,
                   created_at, updated_at)
                VALUES
                  (%s, %s, %s, %s, %s, %s,
                   'NBA', %s, %s,
                   %s, %s, %s, %s,
                   NOW(), NOW())
                ON CONFLICT (player_id, game_date, prop_type)
                DO UPDATE SET
                  proj_value       = EXCLUDED.proj_value,
                  {edge_col}       = EXCLUDED.{edge_col},
                  confidence_score = EXCLUDED.confidence_score,
                  factors_json     = EXCLUDED.factors_json,
                  updated_at       = NOW()
            """
            cur.execute(sql, (
                proj.player_id, proj.player_name, proj.team, proj.opponent,
                home_away, proj.position,
                proj.game_date, db_prop_type,
                round(raw_proj, 2), round(edge_val, 2),
                round(raw_conf, 1), json.dumps({**factors, 'meets_threshold': abs(edge_val) >= threshold}),
            ))
            written += 1
    conn.commit()
    return written


def upsert_team_props(conn, home_team: str, away_team: str, game_date: str, team_props: dict) -> None:
    """Writes total, spread, moneyline to team_projections table."""

    def win_prob_to_american(prob: float) -> int:
        """Convert win probability (0-1) to American moneyline odds."""
        prob = max(0.01, min(0.99, prob))
        if prob >= 0.5:
            return round(-(prob / (1 - prob)) * 100)
        return round(((1 - prob) / prob) * 100)

    with conn.cursor() as cur:
        for prop_type, data in team_props.items():
            for team, opponent, is_home in [(home_team, away_team, True), (away_team, home_team, False)]:
                proj_val  = data.get('proj', data.get('home_prob' if is_home else 'away_prob', 0))
                conf      = data.get('confidence', 60)
                factors   = data.get('factors', {})

                cur.execute(
                    """INSERT INTO team_projections
                         (team_name, opponent, sport, game_date, prop_type,
                          proj_total, proj_value, over_probability, under_probability,
                          confidence_score, factors_json, created_at, updated_at)
                       VALUES
                         (%s, %s, 'NBA', %s, %s,
                          %s, %s, %s, %s,
                          %s, %s,
                          NOW(), NOW())
                       ON CONFLICT (team_name, game_date, prop_type)
                       DO UPDATE SET
                         proj_total        = EXCLUDED.proj_total,
                         proj_value        = EXCLUDED.proj_value,
                         over_probability  = EXCLUDED.over_probability,
                         under_probability = EXCLUDED.under_probability,
                         confidence_score  = EXCLUDED.confidence_score,
                         factors_json      = EXCLUDED.factors_json,
                         updated_at        = NOW()""",
                    (
                        team, opponent, game_date, prop_type,
                        round(float(proj_val), 2),
                        round(float(proj_val), 2),   # proj_value mirrors proj_total
                        data.get('over_prob', 0),
                        data.get('under_prob', 0),
                        round(conf, 1),
                        json.dumps(factors),
                    )
                )

        # Write combined 'game' row — used by edgeDetector to find spread/ML picks
        spread_data = team_props.get('spread', {})
        total_data  = team_props.get('total', {})
        ml_data     = team_props.get('moneyline', {})
        expected_margin = spread_data.get('expected_margin', 0.0)
        proj_total      = total_data.get('proj', 0.0)
        conf            = spread_data.get('confidence', 60)

        for team, opponent, is_home in [(home_team, away_team, True), (away_team, home_team, False)]:
            spread_proj = expected_margin if is_home else -expected_margin
            cover_prob  = spread_data.get('over_prob', 0.5) if is_home else spread_data.get('under_prob', 0.5)
            win_prob    = ml_data.get('home_prob', 0.5) if is_home else ml_data.get('away_prob', 0.5)
            ml_american = win_prob_to_american(win_prob)

            cur.execute(
                """INSERT INTO team_projections
                     (team_name, opponent, sport, game_date, prop_type,
                      proj_total, spread_projection, spread_cover_probability,
                      moneyline_projection, win_probability,
                      confidence_score, factors_json, created_at, updated_at)
                   VALUES
                     (%s, %s, 'NBA', %s, 'game',
                      %s, %s, %s, %s, %s,
                      %s, %s, NOW(), NOW())
                   ON CONFLICT (team_name, game_date, prop_type)
                   DO UPDATE SET
                     proj_total               = EXCLUDED.proj_total,
                     spread_projection        = EXCLUDED.spread_projection,
                     spread_cover_probability = EXCLUDED.spread_cover_probability,
                     moneyline_projection     = EXCLUDED.moneyline_projection,
                     win_probability          = EXCLUDED.win_probability,
                     confidence_score         = EXCLUDED.confidence_score,
                     factors_json             = EXCLUDED.factors_json,
                     updated_at               = NOW()""",
                (
                    team, opponent, game_date,
                    round(float(proj_total), 1),
                    round(float(spread_proj), 2),
                    round(float(cover_prob), 3),
                    ml_american,
                    round(float(win_prob), 3),
                    round(conf, 1),
                    json.dumps({'expected_margin': round(expected_margin, 2),
                                'home_team': home_team, 'away_team': away_team}),
                )
            )

    conn.commit()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description='Chalk NBA Projection Model v2.0')
    parser.add_argument('--date', default=__import__('datetime').datetime.utcnow().date().isoformat(),
                        help='Game date YYYY-MM-DD (default: today)')
    parser.add_argument('--props-only', action='store_true',
                        help='Skip team props — generate player props only (9:15 AM run after lines posted)')
    args      = parser.parse_args()
    game_date  = args.date
    props_only = args.props_only

    if props_only:
        log.info("=== Chalk NBA Projection Model v2.0 — %s [PLAYER PROPS ONLY] ===", game_date)
    else:
        log.info("=== Chalk NBA Projection Model v2.0 — %s ===", game_date)

    conn = psycopg2.connect(DATABASE_URL)
    # autocommit=True means each query is its own transaction.
    # A failed read (e.g. missing table) cannot abort subsequent queries.
    # The upsert functions call conn.commit() explicitly after each INSERT.
    conn.autocommit = True

    # ── Step 0: Load league averages ────────────────────────────────────────
    load_league_averages(conn)

    # ── Step 1: Tonight's schedule ──────────────────────────────────────────
    games = get_todays_games(game_date)
    if not games:
        log.info("No NBA games found for %s", game_date)
        conn.close()
        return
    log.info("Found %d games", len(games))

    # ── Step 1b: Live odds ───────────────────────────────────────────────────
    odds_map = fetch_nba_odds(game_date)
    log.info("Odds loaded for %d matchups", len(odds_map))

    # ── Step 1c: OUT players + usage boosts ─────────────────────────────────
    out_map:   dict[str, list]  = {}
    boost_map: dict[str, float] = {}
    for game in games:
        for team in (game['home_team'], game['away_team']):
            out_players = get_out_players(conn, team, game_date)
            out_map[team]   = [p['player_id'] for p in out_players]
            boost_map[team] = compute_usage_boost(conn, team, out_players, game_date)
            if out_players:
                log.info("  %s: %d OUT players, usage_boost=%.3f",
                         team, len(out_players), boost_map[team])

    # ── Steps 2–4: Project each game ────────────────────────────────────────
    total_players = 0
    total_props   = 0

    for game in games:
        home = game['home_team']
        away = game['away_team']
        key  = f"{home}_{away}"
        alt_key = f"{away}_{home}"

        odds = odds_map.get(key) or odds_map.get(alt_key) or {}
        implied_total = odds.get('implied_total', LEAGUE_AVG['game_total'])
        spread        = odds.get('spread', 0.0)
        home_ml       = odds.get('home_ml')
        away_ml       = odds.get('away_ml')

        log.info("\n  %s @ %s | total=%.1f spread=%.1f",
                 away, home, implied_total, spread)

        # Team props — skipped on props-only run (already written at 4:30 AM)
        if not props_only:
            team_props = project_team_props(
                conn, home, away, game_date,
                implied_total, spread, home_ml, away_ml
            )
            upsert_team_props(conn, home, away, game_date, team_props)
            log.info("  Team props: total=%.1f over_prob=%.2f home_ML=%.3f",
                     team_props['total']['proj'],
                     team_props['total']['over_prob'],
                     team_props['moneyline']['home_prob'])

        # Player props
        for team, opponent, is_home in [(home, away, True), (away, home, False)]:
            players = get_players_for_team(conn, team, game_date)
            out_ids = set(out_map.get(team, []))
            boost   = boost_map.get(team, 0.0)

            for p in players:
                pid = p['player_id']
                if pid in out_ids:
                    continue

                proj = project_player(
                    conn,
                    player_id     = pid,
                    player_name   = p.get('player_name', ''),
                    team          = team,
                    opponent      = opponent,
                    is_home       = is_home,
                    position      = p.get('position', 'G'),
                    game_date     = game_date,
                    implied_total = implied_total,
                    spread        = spread,
                    usage_boost   = boost,
                )
                if proj is None:
                    continue

                written = upsert_player_projections(conn, proj)
                total_props   += written
                total_players += 1

    mode_label = 'player props only' if props_only else 'full model'
    log.info("\n=== NBA v2.0 complete [%s]: %d players, %d prop rows written ===",
             mode_label, total_players, total_props)
    conn.close()


if __name__ == '__main__':
    main()
