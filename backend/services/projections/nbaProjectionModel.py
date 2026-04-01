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
  3. Compute team props: Total, Spread
  4. Log summary

Player props: Points, Rebounds, Assists, Threes, PRA, P+R, P+A, A+R
Team props:   Total, Spread
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
BDL_KEY        = os.getenv('BALLDONTLIE_API_KEY', '').strip()
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
# Helpers
# ---------------------------------------------------------------------------

def is_acceptable_moneyline(ml_odds) -> bool:
    """
    Only generate picks for moneylines between -160 and +999.
    Heavy favorites (-160 or worse) offer too little value — skip.
    No restriction on underdogs (positive odds always acceptable).
    """
    if ml_odds is None:
        return False
    ml_odds = float(ml_odds)
    if ml_odds < 0:
        return ml_odds >= -160  # -160 is acceptable; -161 or worse is not
    return True  # positive odds always acceptable


def safe_float(v, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ---------------------------------------------------------------------------
# Universal confidence formula (FIX 3)
# ---------------------------------------------------------------------------

def calculate_confidence(edge: float, prop_type: str, sport: str, sample_size: int = 10):
    """
    Universal confidence formula tied to edge size.
    Returns None if edge is too small (skip this pick).
    Returns int confidence score 62–87 if edge qualifies.
    """
    MIN_EDGES = {
        # NBA player
        'points': 1.5, 'rebounds': 0.8, 'assists': 0.8, 'threes': 0.4,
        'pra': 2.0, 'pr': 1.5, 'pa': 1.5, 'ar': 1.2, 'blocks': 0.3, 'steals': 0.3,
        # NBA team
        'spread': 1.5, 'total': 2.0,
        # NHL player
        'shots_on_goal': 0.8, 'goals': 0.3,
        # NHL team
        'puck_line': 0.4,
        # MLB player
        'hits': 0.3, 'total_bases': 0.5, 'home_runs': 0.2, 'rbis': 0.4,
        'strikeouts': 0.8, 'earned_runs': 0.5,
        # MLB team
        'run_line': 0.5,
    }
    min_edge = MIN_EDGES.get(prop_type, 1.0)
    if abs(edge) < min_edge:
        return None  # Skip this pick
    # 50 = minimum edge exactly met (coin flip + barely qualifies).
    # 87 = exceptional edge (4× minimum). Linear mapping across that range.
    base = 50
    edge_ratio = abs(edge) / min_edge
    edge_bonus = min(37, int((edge_ratio - 1) * 12.33))
    if sample_size >= 20:
        sample_bonus = 5
    elif sample_size >= 10:
        sample_bonus = 3
    elif sample_size >= 5:
        sample_bonus = 1
    else:
        sample_bonus = 0
    return min(87, base + edge_bonus + sample_bonus)


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
    except Exception as exc:
        log.debug('get_out_players %s %s: %s', team_abbr, game_date, exc)
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
    except Exception as exc:
        log.debug('compute_usage_boost %s: %s', team_abbr, exc)
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

    # position_defense_ratings stores team abbreviations (e.g. 'UTA').
    # Convert full team name → abbreviation using the module-level mapping.
    opp_abbr = FULL_NAME_TO_ABBR.get(opponent, opponent)

    try:
        with conn.cursor() as cur:
            # Try position-specific row first, then fall back to aggregate 'ALL' row.
            # Normalization: use the league-wide average of the same column for that position,
            # NOT a per-individual-player LEAGUE_AVG (which is a different scale).
            for pos_lookup in (position.upper(), 'ALL'):
                cur.execute(
                    f"""SELECT {col}
                        FROM position_defense_ratings
                        WHERE team_name = %s AND position = %s AND sport = 'NBA'
                        ORDER BY updated_at DESC LIMIT 1""",
                    (opp_abbr, pos_lookup)
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    team_val = float(row[0])
                    # League average for this column+position across all NBA teams
                    cur.execute(
                        f"SELECT AVG({col}) FROM position_defense_ratings "
                        f"WHERE position = %s AND sport = 'NBA'",
                        (pos_lookup,)
                    )
                    lg_row = cur.fetchone()
                    league_avg_val = float(lg_row[0]) if lg_row and lg_row[0] else 0.0
                    if league_avg_val <= 0:
                        return 1.0
                    factor = team_val / league_avg_val
                    # Clamp: ±20% max adjustment to avoid dominating total projection
                    return clamp(factor, 0.80, 1.20)
    except Exception as exc:
        log.debug('get_position_defense_factor %s %s %s: %s', opponent, position, stat, exc)
    return 1.0


# ---------------------------------------------------------------------------
# Player game log fetch
# ---------------------------------------------------------------------------

def get_player_logs(conn, player_id: int, sport: str = 'NBA') -> list[dict]:
    """Returns game logs for the current season only, ordered by game date desc."""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT *
                   FROM player_game_logs
                   WHERE player_id = %s AND sport = %s AND season = %s
                   ORDER BY game_date DESC
                   LIMIT 25""",
                (player_id, sport, CURRENT_SEASON)
            )
            return cur.fetchall()
    except Exception as exc:
        log.debug('get_player_logs %s: %s', player_id, exc)
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
    except Exception as exc:
        log.debug('get_player_season_avgs %s: %s', player_id, exc)
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
    except Exception as exc:
        log.debug('get_team_pace %s: %s', team_abbr, exc)
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
    except Exception as exc:
        log.debug('get_team_record %s: %s', team_abbr, exc)
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
    except Exception as exc:
        log.debug('get_rest_days %s %s: %s', player_id, game_date, exc)
    return 2


def get_team_situation_b2b_factor(conn, team_abbr: str) -> float:
    """
    Returns team-specific B2B scoring factor from team_situation_splits.
    Ratio = avg pts_scored on B2B (split_type='rest_0') /
            avg pts_scored with 2+ rest days (split_type='rest_2').
    Falls back to 0.94 (league-average B2B penalty) if no data.
    Clamps to [0.87, 0.99].
    """
    try:
        with conn.cursor() as cur:
            # split_type values stored by populateTeamData.py:
            #   'rest_0' = back-to-back, 'rest_1' = 1 rest day, 'rest_2' = 2+ rest days
            cur.execute(
                """SELECT split_type, pts_scored
                   FROM team_situation_splits
                   WHERE team_name ILIKE %s
                     AND sport = 'NBA'
                     AND split_type IN ('rest_0', 'rest_2')""",
                (f'%{team_abbr}%',)
            )
            rows = {r[0]: float(r[1]) for r in cur.fetchall() if r[1] is not None}
            b2b  = rows.get('rest_0')
            rest = rows.get('rest_2')
            if b2b and rest and rest > 0:
                return clamp(b2b / rest, 0.87, 0.99)
    except Exception as exc:
        log.debug('get_team_situation_b2b_factor %s: %s', team_abbr, exc)
    return 0.94  # league-average B2B penalty fallback


def get_team_rest_days(conn, team_abbr: str, game_date: str) -> int:
    """Days since this team's last game. Returns 2 if no prior game found."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT MAX(game_date) FROM team_game_logs
                   WHERE team_name ILIKE %s AND sport = 'NBA' AND game_date < %s""",
                (f'%{team_abbr}%', game_date)
            )
            row = cur.fetchone()
            if row and row[0]:
                import datetime as _dt
                last    = row[0] if hasattr(row[0], 'days') else _dt.date.fromisoformat(str(row[0]))
                current = _dt.date.fromisoformat(game_date)
                return (current - last).days
    except Exception as exc:
        log.debug('get_team_rest_days %s %s: %s', team_abbr, game_date, exc)
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
    except Exception as exc:
        log.debug('get_home_away_split %s %s: %s', player_id, stat, exc)
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
    games_played:  int = 0                              # actual game log count for sample_size in confidence
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

    # Usage approximation — normalized so league-average player ≈ 1.0.
    usage_approx   = (fga_season + 0.44 * fta_season) / max(min_season * 0.38, 1)
    usage_deviation = usage_approx - 1.0  # absolute deviation from league-average (1.0)

    # Combined efficiency factor — replaces the old separate ts_f * usage_f product.
    # The weighted base (L5/L10/L20/season) already reflects a player's historical
    # scoring output, which inherently captures both their efficiency (TS%) and their
    # volume (usage). Multiplying by both ts_f AND usage_f independently amplified stars
    # by ~28% on top of a base that already reflected their elite production.
    # Fix: use one blended factor that takes the SMALLER of the two deviations to avoid
    # amplification when both are simultaneously high (e.g. Jokic = 1.279× → 1.022×).
    ts_deviation_rel = (ts_pct - ts_lg) / ts_lg   # relative to league avg TS%
    combined_eff_f   = 1.0 + min(ts_deviation_rel * 0.15, usage_deviation * 0.10)
    combined_eff_f   = clamp(combined_eff_f, 0.90, 1.15)

    # Injury/role boost is applied separately — it represents a genuine change from
    # a player's baseline (someone else is out), not a double-count of existing skill.
    injury_boost_f = clamp(1.0 + usage_boost, 1.0, 1.20)

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
                  * combined_eff_f
                  * injury_boost_f
                  * scoring_context_f
                  * game_script_f)

    # Confidence: use universal formula (edge applied at write time; use sample size here)
    conf_pts = calculate_confidence(0.0, 'points', 'NBA', len(logs)) or 62

    factors_pts = {
        'base':           round(base_pts, 2),
        'l5':             round(l5_pts, 2),
        'l10':            round(l10_pts, 2),
        'season_avg':     round(pts_season, 2),
        'pos_def_f':      round(pos_def_pts, 3),
        'pace_f':         round(pace_f, 3),
        'rest_f':         round(rest_f, 3),
        'home_away_f':    round(ha_pts_f, 3),
        'combined_eff_f': round(combined_eff_f, 3),
        'injury_boost_f': round(injury_boost_f, 3),
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

    # Big man bonus removed — weighted base already reflects a big's rebounding role
    # (their L5/L10/season averages ARE their rebounding output, which is already high
    # because they're a big). A 1.08× on top was double-counting position.

    proj_reb = (base_reb
                * pos_def_reb
                * pace_f
                * rest_f
                * ha_reb_f
                * total_f
                * game_script_f)

    conf_reb = calculate_confidence(0.0, 'rebounds', 'NBA', len(logs)) or 62

    factors_reb = {
        'base':        round(base_reb, 2),
        'l5':          round(l5_reb, 2),
        'l10':         round(l10_reb, 2),
        'season_avg':  round(reb_season, 2),
        'pos_def_f':   round(pos_def_reb, 3),
        'pace_f':      round(pace_f, 3),
        'rest_f':      round(rest_f, 3),
        'home_away_f': round(ha_reb_f, 3),
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

    # Playmaker bonus removed — same reason as big_bonus for rebounds.
    # A true playmaker's base already reflects 7+ apg; 1.08× double-counts their role.

    proj_ast = (base_ast
                * pos_def_ast
                * pace_f
                * rest_f
                * ha_ast_f
                * total_f)

    conf_ast = calculate_confidence(0.0, 'assists', 'NBA', len(logs)) or 62

    factors_ast = {
        'base':        round(base_ast, 2),
        'l5':          round(l5_ast, 2),
        'l10':         round(l10_ast, 2),
        'season_avg':  round(ast_season, 2),
        'pos_def_f':   round(pos_def_ast, 3),
        'pace_f':      round(pace_f, 3),
        'rest_f':      round(rest_f, 3),
        'home_away_f': round(ha_ast_f, 3),
        'total_f':     round(total_f, 3),
        'archetype':   archetype,
    }

    # ────────────────────────────────────────────────────────────────────────
    # THREES (fg3m) — special L5 weighting
    # ────────────────────────────────────────────────────────────────────────
    base_3pm = weighted_base_threes(logs, fg3m_season)
    l5_3pm   = rolling_avg(logs, 'three_made', 5)
    l10_3pm  = rolling_avg(logs, 'three_made', 10)

    # 3-and-D archetype bonus removed — base already reflects their actual 3PM averages.

    proj_3pm = (base_3pm
                * pos_def_3pm
                * pace_f
                * rest_f
                * total_f)

    # Three-point volume check: project at least fg3a * avg_pct if base is very low
    avg_3pt_pct = safe_float(season_avg.get('fg3m_pg'), 0) / fg3a_season if fg3a_season > 0 else 0.35
    vol_floor   = fg3a_season * avg_3pt_pct * 0.80
    proj_3pm    = max(proj_3pm, vol_floor * 0.70)

    conf_3pm = calculate_confidence(0.0, 'threes', 'NBA', len(logs)) or 62

    factors_3pm = {
        'base':        round(base_3pm, 2),
        'l5':          round(l5_3pm, 2),
        'l10':         round(l10_3pm, 2),
        'season_avg':  round(fg3m_season, 2),
        'fg3a_pg':     round(fg3a_season, 2),
        'pos_def_f':   round(pos_def_3pm, 3),
        'pace_f':      round(pace_f, 3),
        'rest_f':      round(rest_f, 3),

        'total_f':     round(total_f, 3),
        'archetype':   archetype,
        'special_weighting': 'L5×0.50 + L10×0.25 + L20×0.15 + season×0.10',
    }

    # ────────────────────────────────────────────────────────────────────────
    # COMBO PROPS — no correlation discount applied.
    # Sportsbooks set PRA/PR/PA/AR lines at approximately the sum of individual
    # prop lines (P_line + R_line + A_line ≈ PRA_line). Applying an archetype
    # correlation discount here creates a systematic ~5–18% under-projection vs
    # market that causes the sanity check to block every combo prop. The market
    # already prices in correlation when setting the combined line, so the model
    # should project at the raw sum to compare on equal footing.
    # ────────────────────────────────────────────────────────────────────────
    corr = COMBO_CORRELATIONS.get(archetype, COMBO_CORRELATIONS[ROLE_PLAYER])

    # PRA = pts + reb + ast
    proj_pra  = proj_pts + proj_reb + proj_ast
    conf_pra  = calculate_confidence(0.0, 'pra', 'NBA', len(logs)) or 62
    factors_pra = {
        'proj_pts': round(proj_pts, 2), 'proj_reb': round(proj_reb, 2),
        'proj_ast': round(proj_ast, 2), 'corr_f': corr['pra'],
        'archetype': archetype,
    }

    # P+R
    proj_pr   = proj_pts + proj_reb
    conf_pr   = calculate_confidence(0.0, 'pr', 'NBA', len(logs)) or 62
    factors_pr = {
        'proj_pts': round(proj_pts, 2), 'proj_reb': round(proj_reb, 2),
        'corr_f': corr['pr'], 'archetype': archetype,
    }

    # P+A
    proj_pa   = proj_pts + proj_ast
    conf_pa   = calculate_confidence(0.0, 'pa', 'NBA', len(logs)) or 62
    factors_pa = {
        'proj_pts': round(proj_pts, 2), 'proj_ast': round(proj_ast, 2),
        'corr_f': corr['pa'], 'archetype': archetype,
    }

    # A+R
    proj_ar   = proj_ast + proj_reb
    conf_ar   = calculate_confidence(0.0, 'ar', 'NBA', len(logs)) or 62
    factors_ar = {
        'proj_ast': round(proj_ast, 2), 'proj_reb': round(proj_reb, 2),
        'corr_f': corr['ar'], 'archetype': archetype,
    }

    return PlayerProjection(
        player_id    = player_id,
        player_name  = player_name,
        team         = team,
        opponent     = opponent,
        is_home      = is_home,
        position     = position,
        archetype    = archetype,
        game_date    = game_date,
        games_played = len(logs),
        props        = {
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
    home_ml: float | None = None,
    away_ml: float | None = None,
) -> dict:
    """Computes Total and Spread for the game (moneyline excluded from picks)."""

    home_pace = get_team_pace(conn, home_team)
    away_pace = get_team_pace(conn, away_team)
    avg_pace  = (home_pace + away_pace) / 2

    # ── TOTAL ────────────────────────────────────────────────────────────────
    pace_f       = clamp(avg_pace / LEAGUE_AVG['pace'], 0.90, 1.10)
    total_base   = implied_total if implied_total > 0 else LEAGUE_AVG['game_total']

    # Position defense aggregates per team.
    # position_defense_ratings.pts_allowed = total pts scored against this team
    # per game (SUM across all player logs / games) — a TEAM-level total (~108-118).
    # The correct league baseline is game_total/2, not pts_pg (which is per-player ~15).
    lg_pts = LEAGUE_AVG.get('game_total', 225.0) / 2  # ~112.5 team pts allowed/game
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
            home_def_f = clamp(raw_home / lg_pts, 0.88, 1.12) if raw_home else 1.0

            cur.execute(
                """SELECT AVG(pts_allowed)
                   FROM position_defense_ratings
                   WHERE team_name ILIKE %s AND sport = 'NBA'""",
                (f'%{away_team}%',)
            )
            row = cur.fetchone()
            raw_away = float(row[0]) if row and row[0] else None
            away_def_f = clamp(raw_away / lg_pts, 0.88, 1.12) if raw_away else 1.0
    except Exception as exc:
        log.debug('project_team_props def factors %s vs %s: %s', home_team, away_team, exc)
        home_def_f = 1.0
        away_def_f = 1.0

    # Both defenses affect total
    combined_def_f = (home_def_f + away_def_f) / 2
    proj_total = total_base * pace_f * combined_def_f

    # B2B adjustment from team_situation_splits — team-specific penalty
    home_rest = get_team_rest_days(conn, home_team, game_date)
    away_rest = get_team_rest_days(conn, away_team, game_date)
    home_b2b  = home_rest <= 1
    away_b2b  = away_rest <= 1
    home_b2b_f = get_team_situation_b2b_factor(conn, home_team) if home_b2b else 1.0
    away_b2b_f = get_team_situation_b2b_factor(conn, away_team) if away_b2b else 1.0
    # Average the two team factors: if neither is on B2B both are 1.0 → no change
    b2b_total_f = (home_b2b_f + away_b2b_f) / 2 if (home_b2b or away_b2b) else 1.0
    proj_total *= b2b_total_f

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
                'home_b2b':      home_b2b,
                'away_b2b':      away_b2b,
                'home_b2b_f':    round(home_b2b_f, 3),
                'away_b2b_f':    round(away_b2b_f, 3),
                'b2b_total_f':   round(b2b_total_f, 3),
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
    1. Exact full name (case-insensitive)
    2. First + last name partial match — handles "N. Jokic" vs "Nikola Jokic" style mismatches
    3. Last-name fallback only when surname is >= 6 chars AND exactly ONE distinct player
       name matches today — prevents "Aaron Holiday" from getting "Jrue Holiday"'s line
    """
    if not player_name:
        return None

    db_prop_type = PROP_TYPE_TO_DB.get(prop_type, prop_type)

    try:
        with conn.cursor() as cur:
            # Step 1 — exact full-name match
            cur.execute(
                """SELECT prop_line
                   FROM player_props_history
                   WHERE LOWER(player_name) = LOWER(%s)
                     AND prop_type = %s
                     AND game_date = %s
                   ORDER BY created_at DESC LIMIT 1""",
                (player_name, db_prop_type, game_date)
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                return float(row[0])

            # Step 2 — first + last partial match (handles abbreviations/nicknames)
            name_parts = player_name.strip().split()
            if len(name_parts) >= 2:
                first = name_parts[0]
                last  = name_parts[-1]
                cur.execute(
                    """SELECT prop_line
                       FROM player_props_history
                       WHERE player_name ILIKE %s
                         AND player_name ILIKE %s
                         AND prop_type = %s
                         AND game_date = %s
                       ORDER BY created_at DESC LIMIT 1""",
                    (f'%{first}%', f'%{last}%', db_prop_type, game_date)
                )
                row = cur.fetchone()
                if row and row[0] is not None:
                    return float(row[0])

            # Step 3 — last-name fallback, only when surname uniquely identifies ONE player
            last = name_parts[-1] if name_parts else player_name
            if len(last) < 6:
                return None  # too short — too many collisions (Lee, King, etc.)

            cur.execute(
                """SELECT prop_line, player_name
                   FROM player_props_history
                   WHERE player_name ILIKE %s
                     AND prop_type = %s
                     AND game_date = %s
                   ORDER BY created_at DESC""",
                (f'%{last}%', db_prop_type, game_date)
            )
            fallback_rows = cur.fetchall()

            # Count how many distinct player names share this surname today
            distinct_names = {r[1].lower() for r in fallback_rows if r[1]}
            if len(distinct_names) == 1:
                # Exactly one player with this surname — safe to use
                return float(fallback_rows[0][0])
            elif len(distinct_names) > 1:
                log.warning(
                    'get_market_line: surname "%s" matches %d players today (%s) — '
                    'skipping line lookup for %s',
                    last, len(distinct_names),
                    ', '.join(sorted(distinct_names)), player_name
                )

    except Exception as exc:
        log.debug('get_market_line %s: %s', player_name, exc)
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

            # Read market line from player_props_history (posted ~9 AM by sportsbooks).
            # Store projection regardless of line availability so the 9:15 AM --props-only
            # re-run and edge detector can apply the edge filter once lines are posted.
            line = get_market_line(conn, proj.player_name, prop_type, proj.game_date)

            # Combo sanity check: if projection is >20% above or below the market line,
            # the correlation factor likely overcorrected — skip this prop.
            if line is not None and prop_type in ('pra', 'pr', 'pa', 'ar') and line > 0:
                ratio = raw_proj / line
                if ratio > 1.20 or ratio < 0.80:
                    import logging
                    logging.warning(
                        f'[NBA] Combo sanity fail {proj.player_name} {prop_type}: '
                        f'proj={raw_proj:.1f} line={line:.1f} ratio={ratio:.2f} — skipping'
                    )
                    continue

            if line is not None:
                edge_val = round(raw_proj - line, 2)
                # Use universal confidence formula — returns None if edge too small.
                # IMPORTANT: do NOT skip — store every projection so the edge detector
                # can process it. Skipping here means the edge detector never sees this
                # player, even if lines move later in the day.
                conf_score = calculate_confidence(edge_val, prop_type, 'NBA', proj.games_played)
                if conf_score is None:
                    conf_score = raw_conf  # below edge threshold — store with base confidence
                factors = {**factors, 'market_line': line, 'edge': edge_val}
            else:
                edge_val   = 0.0   # placeholder until lines post at 9 AM
                conf_score = raw_conf  # use model's base confidence until edge known

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
                round(conf_score, 1), json.dumps(factors),
            ))
            written += 1
    conn.commit()
    return written


def upsert_team_props(conn, home_team: str, away_team: str, game_date: str, team_props: dict) -> None:
    """Writes total and spread to team_projections table (moneyline excluded)."""

    with conn.cursor() as cur:
        for prop_type, data in team_props.items():
            for team, opponent, is_home in [(home_team, away_team, True), (away_team, home_team, False)]:
                proj_val  = data.get('proj', 0)
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

        # Write combined 'game' row — used by edgeDetector to find spread/total picks
        spread_data = team_props.get('spread', {})
        total_data  = team_props.get('total', {})
        expected_margin = spread_data.get('expected_margin', 0.0)
        proj_total      = total_data.get('proj', 0.0)
        conf            = spread_data.get('confidence', 60)

        for team, opponent, is_home in [(home_team, away_team, True), (away_team, home_team, False)]:
            spread_proj = expected_margin if is_home else -expected_margin
            cover_prob  = spread_data.get('over_prob', 0.5) if is_home else spread_data.get('under_prob', 0.5)

            cur.execute(
                """INSERT INTO team_projections
                     (team_name, opponent, sport, game_date, prop_type,
                      proj_value, proj_total, spread_projection, spread_cover_probability,
                      confidence_score, factors_json, created_at, updated_at)
                   VALUES
                     (%s, %s, 'NBA', %s, 'game',
                      %s, %s, %s, %s,
                      %s, %s, NOW(), NOW())
                   ON CONFLICT (team_name, game_date, prop_type)
                   DO UPDATE SET
                     proj_value               = EXCLUDED.proj_value,
                     proj_total               = EXCLUDED.proj_total,
                     spread_projection        = EXCLUDED.spread_projection,
                     spread_cover_probability = EXCLUDED.spread_cover_probability,
                     confidence_score         = EXCLUDED.confidence_score,
                     factors_json             = EXCLUDED.factors_json,
                     updated_at               = NOW()""",
                (
                    team, opponent, game_date,
                    round(float(proj_total), 1),
                    round(float(proj_total), 1),
                    round(float(spread_proj), 2),
                    round(float(cover_prob), 3),
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
    log.info("BDL key: present=%s len=%d", bool(BDL_KEY), len(BDL_KEY))

    # ── Step 1: Tonight's schedule ──────────────────────────────────────────
    games = get_todays_games(game_date)
    if not games:
        log.info("No NBA games found for %s — check BDL key or off-day", game_date)
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
            log.info("  Team props: total=%.1f over_prob=%.2f spread_proj=%.2f",
                     team_props['total']['proj'],
                     team_props['total']['over_prob'],
                     team_props['spread'].get('expected_margin', 0.0))

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
