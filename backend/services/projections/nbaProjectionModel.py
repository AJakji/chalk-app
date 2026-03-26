"""
Chalk NBA Projection Model
==========================
Morning script (runs at 10:00 AM) that generates player and team projections
for every NBA game tonight.

Key architectural note:
  This script fetches tonight's schedule from BallDontLie FIRST, so every
  projection is run with the real opponent and home/away context — not a
  placeholder. Only players on teams playing tonight are projected.

Factor pipeline:
  1. Weighted rolling average  (L5×0.40, L10×0.30, L20×0.20, season×0.10)
  2. Opponent defensive rating (computed from player_game_logs via position_defense_ratings)
  3. Pace matchup              (computed from team_game_logs)
  4. Rest days
  5. Home/away splits
  6. True shooting % efficiency (computed from game log raw stats)
  7. Usage approximation        (computed from game log raw stats)
  8. Game script (spread size)

Usage:
  python nbaProjectionModel.py [--date YYYY-MM-DD]
"""

from __future__ import annotations
import argparse
import json
import logging
import math
import os
import sys
import urllib.request
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

DATABASE_URL        = os.getenv('DATABASE_URL', '')
BALLDONTLIE_API_KEY = os.getenv('BALLDONTLIE_API_KEY', '')
ODDS_API_KEY        = os.getenv('ODDS_API_KEY', '')
BDL_BASE            = 'https://api.balldontlie.io/v1'
ODDS_BASE           = 'https://api.the-odds-api.com/v4'
MODEL_VERSION       = 'v1.2'
CURRENT_SEASON      = '2025-26'

# League-average baselines — calibrated to 2024-25 NBA season
LEAGUE_AVG = {
    'pts':          112.0,
    'reb':          43.5,
    'ast':          24.5,
    'stl':          7.3,
    'blk':          4.8,
    'tov':          13.1,
    'threes':       12.8,
    'pace':         98.5,
    'fg_pct':       0.476,
    'three_pct':    0.364,
    'ft_pct':       0.774,
    'ts_pct':       0.580,
    'fta_per_game': 3.5,
    # Usage approximation: avg (fga + 0.44*fta + tov) / minutes for an NBA player
    # Measured from 2025-26 player_game_logs (minutes > 10): AVG = 0.455
    'usage_per_min': 0.455,
    'three_rate':    0.390,   # 3PA / FGA ratio (39 % of field-goal attempts are 3s, 2024-25)
    'team_fouls':    20.0,    # team fouls committed per game
}

TOTAL_STD_DEV  = 12.0
SPREAD_STD_DEV = 10.0

# BDL team abbreviation → full name (for team_game_logs which stores full names)
ABBR_TO_FULL_NAME = {
    'ATL': 'Atlanta Hawks',         'BOS': 'Boston Celtics',
    'BKN': 'Brooklyn Nets',         'CHA': 'Charlotte Hornets',
    'CHI': 'Chicago Bulls',         'CLE': 'Cleveland Cavaliers',
    'DAL': 'Dallas Mavericks',      'DEN': 'Denver Nuggets',
    'DET': 'Detroit Pistons',       'GSW': 'Golden State Warriors',
    'HOU': 'Houston Rockets',       'IND': 'Indiana Pacers',
    'LAC': 'LA Clippers',           'LAL': 'Los Angeles Lakers',
    'MEM': 'Memphis Grizzlies',     'MIA': 'Miami Heat',
    'MIL': 'Milwaukee Bucks',       'MIN': 'Minnesota Timberwolves',
    'NOP': 'New Orleans Pelicans',  'NYK': 'New York Knicks',
    'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic',
    'PHI': 'Philadelphia 76ers',    'PHX': 'Phoenix Suns',
    'POR': 'Portland Trail Blazers','SAC': 'Sacramento Kings',
    'SAS': 'San Antonio Spurs',     'TOR': 'Toronto Raptors',
    'UTA': 'Utah Jazz',             'WAS': 'Washington Wizards',
}

# Reverse lookup: full name → abbreviation (for Odds API matching)
FULL_NAME_TO_ABBR = {v.lower(): k for k, v in ABBR_TO_FULL_NAME.items()}


def get_db():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL env var not set')
    conn = psycopg2.connect(DATABASE_URL)
    psycopg2.extras.register_default_jsonb(conn)
    return conn


def safe(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


# ── Schedule fetch ─────────────────────────────────────────────────────────────

def fetch_tonight_schedule(game_date: date) -> dict:
    """
    Calls BallDontLie /games?dates[]={date} and returns a lookup dict:
      { team_abbr: { opponent: abbr, home_away: str, game_id: int, opponent_full: str } }

    Both home and away teams are added so any team abbr maps to its matchup.
    Returns empty dict if no games or API call fails.
    """
    if not BALLDONTLIE_API_KEY:
        log.warning('  BALLDONTLIE_API_KEY not set — cannot fetch schedule')
        return {}

    url = f'{BDL_BASE}/games?dates[]={game_date}&per_page=30'
    req = urllib.request.Request(url, headers={'Authorization': BALLDONTLIE_API_KEY})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        log.warning(f'  BDL schedule fetch failed: {e}')
        return {}

    schedule = {}
    for game in data.get('data', []):
        home_abbr = game['home_team']['abbreviation']
        away_abbr = game['visitor_team']['abbreviation']
        home_full = game['home_team']['full_name']
        away_full = game['visitor_team']['full_name']
        gid = game['id']
        schedule[home_abbr] = {
            'opponent':      away_abbr,
            'home_away':     'home',
            'game_id':       gid,
            'opponent_full': away_full,
        }
        schedule[away_abbr] = {
            'opponent':      home_abbr,
            'home_away':     'away',
            'game_id':       gid,
            'opponent_full': home_full,
        }
    return schedule


# ── Live odds fetch ────────────────────────────────────────────────────────────

def fetch_nba_odds() -> dict:
    """
    Fetch tonight's NBA odds from The Odds API.
    Returns a dict keyed by (home_abbr, away_abbr) tuples:
      { ('BOS', 'MIA'): { 'total': 218.5, 'home_spread': -5.5, 'home_ml': -220 } }

    Falls back to empty dict on any error so the model runs without odds.
    """
    if not ODDS_API_KEY:
        log.warning('  ODDS_API_KEY not set — game_total_factor and game_script will be 1.0')
        return {}

    url = (f'{ODDS_BASE}/sports/basketball_nba/odds'
           f'?apiKey={ODDS_API_KEY}&regions=us&markets=totals,spreads,h2h&oddsFormat=american')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'ChalkApp/3.2'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            games = json.loads(resp.read())
    except Exception as e:
        log.warning(f'  NBA odds fetch failed: {e}')
        return {}

    odds_map = {}
    for game in games:
        home_full = game.get('home_team', '').lower()
        away_full = game.get('away_team', '').lower()
        home_abbr = FULL_NAME_TO_ABBR.get(home_full)
        away_abbr = FULL_NAME_TO_ABBR.get(away_full)
        if not home_abbr or not away_abbr:
            continue

        entry = {'total': None, 'home_spread': None, 'home_ml': None}

        for bookmaker in game.get('bookmakers', []):
            for market in bookmaker.get('markets', []):
                key = market.get('key')
                outcomes = market.get('outcomes', [])
                if key == 'totals' and entry['total'] is None:
                    for o in outcomes:
                        if o.get('name') == 'Over':
                            entry['total'] = float(o.get('point', 0))
                            break
                elif key == 'spreads' and entry['home_spread'] is None:
                    for o in outcomes:
                        if o.get('name', '').lower() in (home_full, home_abbr.lower()):
                            entry['home_spread'] = float(o.get('point', 0))
                            break
                elif key == 'h2h' and entry['home_ml'] is None:
                    for o in outcomes:
                        if o.get('name', '').lower() in (home_full, home_abbr.lower()):
                            entry['home_ml'] = float(o.get('price', 0))
                            break
            if entry['total'] and entry['home_spread']:
                break  # got what we need from first bookmaker

        odds_map[(home_abbr, away_abbr)] = entry

    log.info(f'  NBA odds loaded for {len(odds_map)} games')
    return odds_map


def get_out_players(conn, team_abbr: str, game_date: date) -> list:
    """
    Return player names confirmed OUT tonight for this team (from nightly_roster).
    Returns a list of lowercased player names.
    """
    full_name = ABBR_TO_FULL_NAME.get(team_abbr, team_abbr)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT player_name FROM nightly_roster
               WHERE (team = %s OR team ILIKE %s)
                 AND sport = 'NBA'
                 AND game_date = %s
                 AND is_confirmed_playing = false""",
            (full_name, f'%{team_abbr}%', game_date)
        )
        return [row[0].lower() for row in cur.fetchall()]


def load_league_averages(conn) -> None:
    """
    Read the latest league averages from the DB and update LEAGUE_AVG in-place.
    Falls back to hardcoded values if table is empty or query fails.
    """
    global LEAGUE_AVG
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT DISTINCT ON (stat_name) stat_name, stat_value
                FROM league_averages
                WHERE sport = 'NBA'
                ORDER BY stat_name, computed_date DESC
            """)
            rows = cur.fetchall()
        if rows:
            for row in rows:
                name = row['stat_name']
                if name in LEAGUE_AVG:
                    LEAGUE_AVG[name] = float(row['stat_value'])
            log.info(f'  League averages loaded from DB ({len(rows)} stats)')
        else:
            log.info('  No DB league averages found — using hardcoded constants')
    except Exception as e:
        log.warning(f'  Could not load league averages from DB: {e}')


# ── Rolling average calculations ──────────────────────────────────────────────

def rolling_avg(rows: list[dict], col: str, n: int) -> float:
    vals = [safe(r[col]) for r in rows[:n] if r.get(col) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def weighted_avg(rows: list[dict], col: str) -> float:
    """
    Core projection baseline:
      L5×0.40 + L10×0.30 + L20×0.20 + season×0.10
    Falls back gracefully when fewer games exist.
    """
    n = len(rows)
    if n == 0:
        return 0.0
    l5  = rolling_avg(rows, col, 5)
    l10 = rolling_avg(rows, col, min(10, n))
    l20 = rolling_avg(rows, col, min(20, n))
    szn = rolling_avg(rows, col, n)
    if n >= 20:
        return l5 * 0.40 + l10 * 0.30 + l20 * 0.20 + szn * 0.10
    elif n >= 10:
        return l5 * 0.50 + l10 * 0.35 + szn * 0.15
    elif n >= 5:
        return l5 * 0.65 + szn * 0.35
    else:
        return szn


def home_away_avg(rows: list[dict], col: str, location: str) -> float:
    filtered = [r for r in rows if r.get('home_away') == location]
    return rolling_avg(filtered, col, len(filtered)) if filtered else 0.0


# ── Derived stat computations (replaces NULL advanced_stats columns) ───────────

def compute_ts_pct(logs: list[dict]) -> float:
    """
    True shooting % = pts / (2 × (fga + 0.44 × fta))
    Computed from raw game log data — no advanced_stats API needed.
    Returns weighted recent average (L20), falls back to league avg.
    """
    vals = []
    for r in logs[:20]:
        pts = safe(r.get('points'))
        fga = safe(r.get('fg_att'))
        fta = safe(r.get('ft_att'))
        denom = 2.0 * (fga + 0.44 * fta)
        if denom > 0 and pts > 0:
            vals.append(pts / denom)
    return sum(vals) / len(vals) if vals else LEAGUE_AVG['ts_pct']


def compute_usage_approx(logs: list[dict], n: int = 20) -> float:
    """
    Usage approximation = (fga + 0.44×fta + tov) / minutes
    Normalised against league average (0.415 per minute).
    Returns a ratio where 1.0 = average usage, >1 = high usage.
    """
    vals = []
    for r in logs[:n]:
        fga  = safe(r.get('fg_att'))
        fta  = safe(r.get('ft_att'))
        tov  = safe(r.get('turnovers'))
        mins = safe(r.get('minutes'))
        if mins > 5:
            vals.append((fga + 0.44 * fta + tov) / mins)
    if not vals:
        return 1.0
    player_per_min = sum(vals) / len(vals)
    return player_per_min / LEAGUE_AVG['usage_per_min']


# ── DB queries ─────────────────────────────────────────────────────────────────

def get_player_logs(conn, player_id: int, limit: int = 60) -> list[dict]:
    """Most recent `limit` game logs for a player (current season)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'NBA' AND season = %s
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_team_logs(conn, team_abbr: str, limit: int = 20) -> list[dict]:
    """
    team_game_logs stores full names ('Atlanta Hawks').
    Use ABBR_TO_FULL_NAME to convert before querying.
    """
    full_name = ABBR_TO_FULL_NAME.get(team_abbr, team_abbr)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM team_game_logs
               WHERE team_name = %s AND sport = 'NBA' AND season = %s
               ORDER BY game_date DESC LIMIT %s""",
            (full_name, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_defense_rating(conn, team_abbr: str) -> dict:
    """
    position_defense_ratings stores abbreviations as team_name (e.g. 'TOR').
    Exact match — no ILIKE needed.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT pts_allowed, reb_allowed, ast_allowed, three_allowed
               FROM position_defense_ratings
               WHERE team_name = %s AND sport = 'NBA' AND season = %s AND position = 'ALL'
               LIMIT 1""",
            (team_abbr, CURRENT_SEASON)
        )
        row = cur.fetchone()
        return dict(row) if row else {}


def get_team_pace(conn, team_abbr: str) -> float:
    """
    Average pace over last 10 games for a team.
    team_game_logs stores full names — convert via ABBR_TO_FULL_NAME.
    """
    full_name = ABBR_TO_FULL_NAME.get(team_abbr, team_abbr)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT AVG(pace) FROM (
                 SELECT pace FROM team_game_logs
                 WHERE team_name = %s AND sport = 'NBA' AND season = %s
                   AND pace IS NOT NULL
                 ORDER BY game_date DESC LIMIT 10
               ) sub""",
            (full_name, CURRENT_SEASON)
        )
        row = cur.fetchone()
        return float(row[0]) if row and row[0] else LEAGUE_AVG['pace']


def get_rest_days(conn, player_id: int, game_date: date) -> int:
    """Days since the player's last game."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT MAX(game_date) FROM player_game_logs
               WHERE player_id = %s AND game_date < %s AND sport = 'NBA'""",
            (player_id, game_date)
        )
        row = cur.fetchone()
        if row and row[0]:
            return (game_date - row[0]).days
        return 3


# ── Factor calculations ────────────────────────────────────────────────────────

def rest_factor(rest_days: int) -> float:
    if rest_days == 0:  return 0.92   # back-to-back
    if rest_days == 1:  return 0.97
    if rest_days <= 4:  return 1.00
    return 0.98                        # rust (5+ days off)


def home_away_factor(logs: list[dict], col: str, location: str) -> float:
    home_a = home_away_avg(logs, col, 'home')
    away_a = home_away_avg(logs, col, 'away')
    baseline = (home_a + away_a) / 2 if (home_a + away_a) > 0 else 1.0
    if baseline == 0:
        return 1.0
    loc_avg = home_a if location == 'home' else away_a
    if loc_avg == 0:
        return 1.0
    return max(0.80, min(1.20, loc_avg / baseline))


def pace_factor_offensive(team_pace: float, opp_pace: float) -> float:
    matchup_pace = (team_pace + opp_pace) / 2
    return max(0.88, min(1.12, matchup_pace / LEAGUE_AVG['pace']))


def pace_factor_rebounds(team_pace: float, opp_pace: float) -> float:
    matchup_pace = (team_pace + opp_pace) / 2
    return max(0.88, min(1.12, LEAGUE_AVG['pace'] / matchup_pace))


def game_script_pts_factor(spread: Optional[float], is_underdog: bool) -> float:
    """
    Heavy favourites rest starters in garbage time (fewer pts).
    Large underdogs pad stats late (more pts).
    Spread bands: 10+ / 6-9 / within 5.
    """
    if spread is None:
        return 1.00
    abs_s = abs(spread)
    if is_underdog:
        if abs_s >= 10: return 1.08   # heavy underdog — garbage-time padding
        if abs_s >= 6:  return 1.04
        return 1.00
    else:
        if abs_s >= 10: return 0.94   # heavy favourite — starters rested in Q4
        if abs_s >= 6:  return 0.97
        return 1.00


def game_script_threes_factor(spread: Optional[float], is_underdog: bool) -> float:
    if spread is None or abs(spread) < 8:
        return 1.0
    return 1.20 if is_underdog else 0.85


# ── Opponent foul rate (points — FTA opportunity boost) ────────────────────────

def get_opp_foul_rate_factor(conn, team_abbr: str) -> float:
    """
    Returns 1.05 if the opponent commits > 22 fouls per game (top-10 foul team).
    More fouls → more FTA for this player → more scoring opportunities.
    Queried from player_game_logs (team column = BDL abbreviation).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT AVG(game_fouls) FROM (
              SELECT game_date, SUM(fouls) AS game_fouls
              FROM player_game_logs
              WHERE team = %s AND sport = 'NBA' AND season = %s
                AND minutes > 0
              GROUP BY game_date
              ORDER BY game_date DESC
              LIMIT 20
            ) sub
        """, (team_abbr, CURRENT_SEASON))
        row = cur.fetchone()
    fouls_pg = float(row[0]) if row and row[0] else LEAGUE_AVG['team_fouls']
    return 1.05 if fouls_pg > 22.0 else 1.00


def get_opp_fg_pct(conn, team_abbr: str) -> float:
    """
    Opponent's offensive FG% from team_game_logs (last 20 games).
    Used for the rebound miss factor: low FG% → more misses → more rebounds.
    team_game_logs stores full names — convert via ABBR_TO_FULL_NAME.
    """
    full_name = ABBR_TO_FULL_NAME.get(team_abbr, team_abbr)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT AVG(fg_pct) FROM (
              SELECT fg_pct FROM team_game_logs
              WHERE team_name = %s AND sport = 'NBA' AND season = %s
                AND fg_pct IS NOT NULL
              ORDER BY game_date DESC LIMIT 20
            ) sub
        """, (full_name, CURRENT_SEASON))
        row = cur.fetchone()
    return float(row[0]) if row and row[0] else LEAGUE_AVG['fg_pct']


def get_opp_three_rate(conn, team_abbr: str) -> float:
    """
    Opponent's three-point attempt rate (3PA / FGA) from player_game_logs (last 20 games).
    High 3PA teams produce long rebounds → more rebound chances for athletic players.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT AVG(game_3pa_rate) FROM (
              SELECT game_date,
                     SUM(three_att)::float / NULLIF(SUM(fg_att), 0) AS game_3pa_rate
              FROM player_game_logs
              WHERE team = %s AND sport = 'NBA' AND season = %s AND minutes > 0
              GROUP BY game_date
              HAVING SUM(fg_att) > 0
              ORDER BY game_date DESC
              LIMIT 20
            ) sub
        """, (team_abbr, CURRENT_SEASON))
        row = cur.fetchone()
    return float(row[0]) if row and row[0] else LEAGUE_AVG['three_rate']


def get_opp_steals_factor(conn, team_abbr: str) -> float:
    """
    Returns 0.93 if the opponent averages > 8.5 steals per game (top-10 in stealing).
    High steal rate correlates with deflections → tighter passing lanes → fewer assists.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT AVG(game_stl) FROM (
              SELECT game_date, SUM(steals) AS game_stl
              FROM player_game_logs
              WHERE team = %s AND sport = 'NBA' AND season = %s AND minutes > 0
              GROUP BY game_date
              ORDER BY game_date DESC
              LIMIT 20
            ) sub
        """, (team_abbr, CURRENT_SEASON))
        row = cur.fetchone()
    opp_stl = float(row[0]) if row and row[0] else LEAGUE_AVG['stl']
    return 0.93 if opp_stl > 8.5 else 1.00


def weighted_avg_threes(rows: list[dict]) -> float:
    """
    Three-point shooting responds more strongly to recent form than other stats.
    L5 × 0.50 + L10 × 0.25 + L15 × 0.15 + season × 0.10
    (vs standard weighted_avg which weights L5 at 0.40)
    """
    n = len(rows)
    if n == 0:
        return 0.0
    l5  = rolling_avg(rows, 'three_made', 5)
    l10 = rolling_avg(rows, 'three_made', min(10, n))
    l15 = rolling_avg(rows, 'three_made', min(15, n))
    szn = rolling_avg(rows, 'three_made', n)
    if n >= 15:
        return l5 * 0.50 + l10 * 0.25 + l15 * 0.15 + szn * 0.10
    elif n >= 10:
        return l5 * 0.55 + l10 * 0.30 + szn * 0.15
    elif n >= 5:
        return l5 * 0.70 + szn * 0.30
    else:
        return szn


def classify_archetype(
    base_pts: float, base_reb: float, base_ast: float, usage_f: float
) -> tuple:
    """
    Classify a player's PRA archetype and return (label, pra_correlation_factor).

    A — TRIPLE_THREAT  (pts>5, reb>4, ast>4):
        All three stats move together. pra_corr = 1.00.
        Examples: Jokic, LeBron, Giannis, Draymond.

    B — PRIMARY_SCORER (usage ≥ 1.20 AND ast < 4):
        Hunting shots → points up often means assists down. pra_corr = 0.95.
        Examples: Booker, Kawhi, Jaylen Brown.

    C — ROLE_PLAYER    (everyone else):
        Stats are relatively independent. pra_corr = 0.97.
    """
    if base_pts > 5.0 and base_reb > 4.0 and base_ast > 4.0:
        return ('TRIPLE_THREAT', 1.00)
    if usage_f >= 1.20 and base_ast < 4.0:
        return ('PRIMARY_SCORER', 0.95)
    return ('ROLE_PLAYER', 0.97)


def opp_pts_allowed_factor(opp_pts_allowed: float) -> float:
    if opp_pts_allowed <= 0:
        return 1.0
    return max(0.85, min(1.18, opp_pts_allowed / LEAGUE_AVG['pts']))


def game_total_factor(implied_total: Optional[float]) -> float:
    if implied_total is None:
        return 1.0
    diff = implied_total - 224.0
    if diff > 5:  return 1.04
    if diff < -5: return 0.96
    return 1.0


# ── Player projection ──────────────────────────────────────────────────────────

def project_player(
    conn,
    player_id:     int,
    player_name:   str,
    team:          str,          # BDL abbreviation e.g. 'LAC'
    opponent:      str,          # BDL abbreviation e.g. 'TOR'
    location:      str,          # 'home' | 'away'
    game_date:     date,
    spread:        Optional[float] = None,
    implied_total: Optional[float] = None,
    usage_boost:   float          = 0.0,  # added when a star teammate is OUT
) -> Optional[dict]:

    logs = get_player_logs(conn, player_id, limit=60)
    if len(logs) < 3:
        return None

    # ── Minutes floor — low-minutes players are unreliable prop targets ──────
    season_min_avg = rolling_avg(logs, 'minutes', len(logs)) if logs else 0.0
    low_minutes    = 0.0 < season_min_avg < 20.0
    min_floor_f    = 0.88 if low_minutes else 1.00

    # ── Base weighted averages ─────────────────────────────────────────────────
    base_pts    = weighted_avg(logs, 'points')
    base_reb    = weighted_avg(logs, 'rebounds')
    base_ast    = weighted_avg(logs, 'assists')
    base_stl    = weighted_avg(logs, 'steals')
    base_blk    = weighted_avg(logs, 'blocks')
    base_tov    = weighted_avg(logs, 'turnovers')
    base_threes = weighted_avg(logs, 'three_made')
    base_min    = weighted_avg(logs, 'minutes')
    base_fta    = weighted_avg(logs, 'ft_att')

    # ── Derived stats — computed from raw log data (no advanced_stats API) ─────
    ts_pct  = compute_ts_pct(logs)
    usage_f = compute_usage_approx(logs)    # clamped to [0.70, 1.40] below

    ts_f = ts_pct / LEAGUE_AVG['ts_pct'] if LEAGUE_AVG['ts_pct'] > 0 else 1.0
    ts_f = max(0.85, min(1.20, ts_f))

    # Clamp usage_f to [0.70, 1.40] — bench floor to primary scorer ceiling
    # usage_boost is added when a star teammate is confirmed OUT tonight
    usage_f = max(0.70, min(1.45, usage_f + usage_boost))

    fta_f = 1.04 if base_fta > 5 else 1.0

    # ── Opponent defense (from position_defense_ratings, team_name = abbr) ─────
    opp_def         = get_defense_rating(conn, opponent)
    opp_pts_allowed = safe(opp_def.get('pts_allowed'), LEAGUE_AVG['pts'])
    opp_reb_allowed = safe(opp_def.get('reb_allowed'), LEAGUE_AVG['reb'])
    opp_ast_allowed = safe(opp_def.get('ast_allowed'), LEAGUE_AVG['ast'])
    opp_3pm_allowed = safe(opp_def.get('three_allowed'), LEAGUE_AVG['threes'])
    has_opp_data    = bool(opp_def)

    # ── Pace (from team_game_logs, looked up by full name) ────────────────────
    team_pace = get_team_pace(conn, team)
    opp_pace  = get_team_pace(conn, opponent)

    # ── Rest ──────────────────────────────────────────────────────────────────
    rest = get_rest_days(conn, player_id, game_date)
    rf   = rest_factor(rest)

    is_underdog = (spread is not None and spread < 0)

    # ── Additional opponent context (computed nightly from game logs) ─────────
    foul_rate_f    = get_opp_foul_rate_factor(conn, opponent)   # pts: FTA opportunity
    opp_fg_pct_val = get_opp_fg_pct(conn, opponent)             # reb: actual miss rate
    opp_3pa_rate   = get_opp_three_rate(conn, opponent)         # reb: long-miss opportunity
    ast_steals_f   = get_opp_steals_factor(conn, opponent)      # ast: passing-lane pressure

    # ── POINTS ────────────────────────────────────────────────────────────────
    pts_opp_f    = opp_pts_allowed_factor(opp_pts_allowed)
    pts_pace_f   = pace_factor_offensive(team_pace, opp_pace)
    pts_rest_f   = rf
    pts_home_f   = home_away_factor(logs, 'points', location)
    pts_script_f = game_script_pts_factor(spread, is_underdog)
    pts_total_f  = game_total_factor(implied_total)

    factors_pts = {
        'usage_f':       round(usage_f,       3),
        'ts_f':          round(ts_f,          3),
        'fta_f':         round(fta_f,         3),
        'foul_rate_f':   round(foul_rate_f,   3),
        'opp_pts_f':     round(pts_opp_f,     3),
        'pace_f':        round(pts_pace_f,    3),
        'rest_f':        round(pts_rest_f,    3),
        'home_away_f':   round(pts_home_f,    3),
        'script_f':      round(pts_script_f,  3),
        'total_f':       round(pts_total_f,   3),
    }

    proj_pts = (
        base_pts * usage_f * ts_f * fta_f * foul_rate_f
        * pts_opp_f * pts_pace_f * pts_rest_f
        * pts_home_f * pts_script_f * pts_total_f
        * min_floor_f
    )

    # ── REBOUNDS ──────────────────────────────────────────────────────────────
    # Miss factor from actual opponent FG% (team_game_logs) — more misses = more boards
    miss_factor = max(0.85, min(1.15,
        (1 - opp_fg_pct_val) / (1 - LEAGUE_AVG['fg_pct'])
        if (1 - LEAGUE_AVG['fg_pct']) > 0 else 1.0
    ))

    # 3PA rate factor: high three-point volume teams produce longer rebounds
    opp_3pa_f = 1.05 if opp_3pa_rate > LEAGUE_AVG['three_rate'] + 0.03 else 1.00

    reb_opp_f   = max(0.85, min(1.15, opp_reb_allowed / LEAGUE_AVG['reb'])) if LEAGUE_AVG['reb'] > 0 else 1.0
    reb_pace_f  = pace_factor_rebounds(team_pace, opp_pace)
    reb_rest_f  = rf
    reb_home_f  = home_away_factor(logs, 'rebounds', location)

    factors_reb = {
        'miss_f':      round(miss_factor,  3),
        'opp_3pa_f':   round(opp_3pa_f,   3),
        'opp_reb_f':   round(reb_opp_f,   3),
        'pace_f':      round(reb_pace_f,   3),
        'rest_f':      round(reb_rest_f,   3),
        'home_away_f': round(reb_home_f,   3),
    }

    proj_reb = base_reb * miss_factor * opp_3pa_f * reb_opp_f * reb_pace_f * reb_rest_f * reb_home_f * min_floor_f

    # ── ASSISTS ───────────────────────────────────────────────────────────────
    ast_opp_f  = max(0.85, min(1.15, opp_ast_allowed / LEAGUE_AVG['ast'])) if LEAGUE_AVG['ast'] > 0 else 1.0
    ast_pace_f = pace_factor_offensive(team_pace, opp_pace)
    ast_rest_f = rf
    ast_home_f = home_away_factor(logs, 'assists', location)

    recent_ast = rolling_avg(logs, 'assists', 10)
    recent_tov = rolling_avg(logs, 'turnovers', 10)
    ato_ratio  = (recent_ast / recent_tov) if recent_tov > 0 else 2.0
    ato_f      = 1.05 if ato_ratio > 3.0 else 1.0

    # Passing-lane pressure: high-steal opponents disrupt passes → fewer assists
    # ast_steals_f already computed above (0.93 if opponent > 8.5 stl/game, else 1.00)
    factors_ast = {
        'opp_ast_f':      round(ast_opp_f,    3),
        'pace_f':         round(ast_pace_f,   3),
        'rest_f':         round(ast_rest_f,   3),
        'home_away_f':    round(ast_home_f,   3),
        'ato_f':          round(ato_f,        3),
        'passing_lane_f': round(ast_steals_f, 3),
    }

    proj_ast = base_ast * ast_opp_f * ast_pace_f * ast_rest_f * ast_home_f * ato_f * ast_steals_f * min_floor_f

    # ── THREES ────────────────────────────────────────────────────────────────
    # Front-weighted baseline: L5×0.50 because recent form is most predictive for 3s
    base_threes_wt = weighted_avg_threes(logs)

    # Hot/cold streak detection — 3PM streaks are more persistent than other stats
    l5_3pm  = rolling_avg(logs, 'three_made', 5)
    l20_3pm = rolling_avg(logs, 'three_made', min(20, len(logs)))
    if l20_3pm > 0 and l5_3pm > l20_3pm * 1.25:
        streak_3f = 1.08    # hot streak — shooting confidence is real and sticky
    elif l20_3pm > 0 and l5_3pm < l20_3pm * 0.75:
        streak_3f = 0.90    # cold streak — also sticky; don't fade the slump
    else:
        streak_3f = 1.00

    # Trend: L5 3P% vs season 3P% (efficiency trend separate from volume trend)
    l5_3pct  = rolling_avg(logs, 'three_pct', 5)
    szn_3pct = rolling_avg(logs, 'three_pct', len(logs))
    trend_3f = max(0.80, min(1.20, (l5_3pct / szn_3pct) if szn_3pct > 0 else 1.0))

    opp_3pct_f      = max(0.80, min(1.20, opp_3pm_allowed / LEAGUE_AVG['threes'])) if LEAGUE_AVG['threes'] > 0 else 1.0
    threes_pace_f   = pace_factor_offensive(team_pace, opp_pace)
    threes_script_f = game_script_threes_factor(spread, is_underdog)
    threes_home_f   = home_away_factor(logs, 'three_made', location)

    factors_threes = {
        'trend_3f':    round(trend_3f,       3),
        'streak_3f':   round(streak_3f,      3),
        'opp_3pct_f':  round(opp_3pct_f,     3),
        'pace_f':      round(threes_pace_f,   3),
        'script_f':    round(threes_script_f, 3),
        'home_away_f': round(threes_home_f,   3),
    }

    proj_threes = base_threes_wt * trend_3f * streak_3f * opp_3pct_f * threes_pace_f * threes_script_f * threes_home_f * min_floor_f

    # ── COMBO PROPS ───────────────────────────────────────────────────────────
    is_big       = (base_reb > 7.0)
    is_playmaker = (base_ast > 6.0)
    is_scorer    = (base_pts > 20.0 or usage_f >= 1.20)
    is_pure_pg   = (is_playmaker and not is_big)   # high ast, limited reb

    # PRA — archetype-based correlation
    archetype, pra_corr = classify_archetype(base_pts, base_reb, base_ast, usage_f)

    # P+A — role-based correlation + double-weight pace bonus
    # Primary scorers hunt their own shot → points up often means assists down
    # True playmakers generate more of both with every touch
    if usage_f >= 1.20 and not is_playmaker:
        pts_ast_corr = 0.91   # primary scorer
    elif is_playmaker:
        pts_ast_corr = 1.00   # true playmaker
    else:
        pts_ast_corr = 0.95   # combo guard
    pts_ast_pace_bonus   = (pts_pace_f - 1.0) * 2.0   # fast games benefit P+A doubly
    pts_ast_corr_final   = max(0.85, min(1.10, pts_ast_corr * (1.0 + pts_ast_pace_bonus)))

    # P+R — position-proxy correlation + minutes dependency check
    if is_big:
        pts_reb_corr = 1.02    # interior play drives both pts and reb
    elif is_pure_pg:
        pts_reb_corr = 0.95    # PGs rarely combine high pts and reb
    else:
        pts_reb_corr = 0.98    # wings — slight negative
    l5_min_ck  = rolling_avg(logs, 'minutes', 5)
    if season_min_avg > 0 and l5_min_ck < season_min_avg - 3:
        pts_reb_corr = max(0.85, pts_reb_corr * 0.94)   # reduced minutes hurts both stats

    # A+R — passing big vs pure PG vs everyone else
    if is_big and base_ast > 3.0:
        ast_reb_corr = 1.05    # passing big: playmaking and rebounding go hand-in-hand
    elif is_pure_pg and base_reb < 4.0:
        ast_reb_corr = 0.95    # pure PG: assists high, rebounds low and independent
    else:
        ast_reb_corr = 0.97

    proj_pra     = round((proj_pts + proj_reb + proj_ast) * pra_corr,       3)
    proj_pts_ast = round((proj_pts + proj_ast) * pts_ast_corr_final,        3)
    proj_pts_reb = round((proj_pts + proj_reb) * pts_reb_corr,              3)
    proj_ast_reb = round((proj_ast + proj_reb) * ast_reb_corr,              3)

    proj_stl = base_stl * rf * min_floor_f
    proj_blk = base_blk * rf * min_floor_f
    proj_tov = base_tov * rf * min_floor_f

    # ── Confidence ────────────────────────────────────────────────────────────
    confidence = 60
    if len(logs) >= 20: confidence += 5
    if len(logs) >= 40: confidence += 3
    if rest == 0:       confidence -= 8
    if rest == 1:       confidence -= 3
    if not has_opp_data: confidence -= 5   # no defense data for opponent
    if low_minutes:      confidence -= 8   # < 20 min/game — unreliable prop target

    l5_pts  = rolling_avg(logs, 'points', 5)
    l20_pts = rolling_avg(logs, 'points', 20)
    if l20_pts > 0 and l5_pts > l20_pts * 1.15:
        confidence += 6
    elif l20_pts > 0 and l5_pts < l20_pts * 0.85:
        confidence -= 10
    confidence = max(50, min(95, confidence))

    # ── Assemble ──────────────────────────────────────────────────────────────
    all_factors = {
        'pts':    factors_pts,
        'reb':    factors_reb,
        'ast':    factors_ast,
        'threes': factors_threes,
        'combo_corr': {
            'archetype':      archetype,
            'pra_corr':       pra_corr,
            'pts_ast_corr':   pts_ast_corr_final,
            'pts_reb_corr':   pts_reb_corr,
            'ast_reb_corr':   ast_reb_corr,
        },
        'context': {
            'rest_days':      rest,
            'team_pace':      round(team_pace,      2),
            'opp_pace':       round(opp_pace,       2),
            'ts_pct':         round(ts_pct,         4),
            'usage_approx':   round(usage_f,        3),
            'has_opp_data':   has_opp_data,
            'is_big':         is_big,
            'is_playmaker':   is_playmaker,
            'is_scorer':      is_scorer,
            'low_minutes':    low_minutes,
            'season_min_avg': round(season_min_avg, 2),
            'base_pts':       round(base_pts,       2),
            'base_reb':       round(base_reb,       2),
            'base_ast':       round(base_ast,       2),
            'base_threes':    round(base_threes,    2),
            'games_used':     len(logs),
        }
    }

    return {
        'player_id':      player_id,
        'player_name':    player_name,
        'team':           team,
        'sport':          'NBA',
        'game_date':      game_date,
        'opponent':       opponent,
        'home_away':      location,
        'proj_points':    round(max(0, proj_pts), 3),
        'proj_rebounds':  round(max(0, proj_reb), 3),
        'proj_assists':   round(max(0, proj_ast), 3),
        'proj_steals':    round(max(0, proj_stl), 3),
        'proj_blocks':    round(max(0, proj_blk), 3),
        'proj_turnovers': round(max(0, proj_tov), 3),
        'proj_threes':    round(max(0, proj_threes), 3),
        'proj_minutes':   round(max(0, base_min), 2),
        'proj_pra':       round(max(0, proj_pra), 3),
        'proj_pts_ast':   round(max(0, proj_pts_ast), 3),
        'proj_pts_reb':   round(max(0, proj_pts_reb), 3),
        'proj_ast_reb':   round(max(0, proj_ast_reb), 3),
        'confidence_score': confidence,
        'model_version':  MODEL_VERSION,
        'factors_json':   json.dumps(all_factors),
    }


def upsert_player_projection(conn, proj: dict):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO chalk_projections (
                 player_id, player_name, team, sport, game_date, opponent, home_away,
                 proj_points, proj_rebounds, proj_assists, proj_steals, proj_blocks,
                 proj_turnovers, proj_threes, proj_minutes,
                 proj_pra, proj_pts_ast, proj_pts_reb, proj_ast_reb,
                 confidence_score, model_version, factors_json
               ) VALUES (
                 %(player_id)s, %(player_name)s, %(team)s, %(sport)s,
                 %(game_date)s, %(opponent)s, %(home_away)s,
                 %(proj_points)s, %(proj_rebounds)s, %(proj_assists)s,
                 %(proj_steals)s, %(proj_blocks)s, %(proj_turnovers)s,
                 %(proj_threes)s, %(proj_minutes)s,
                 %(proj_pra)s, %(proj_pts_ast)s, %(proj_pts_reb)s, %(proj_ast_reb)s,
                 %(confidence_score)s, %(model_version)s, %(factors_json)s
               )
               ON CONFLICT (player_id, game_date) DO UPDATE SET
                 opponent       = EXCLUDED.opponent,
                 home_away      = EXCLUDED.home_away,
                 proj_points    = EXCLUDED.proj_points,
                 proj_rebounds  = EXCLUDED.proj_rebounds,
                 proj_assists   = EXCLUDED.proj_assists,
                 proj_steals    = EXCLUDED.proj_steals,
                 proj_blocks    = EXCLUDED.proj_blocks,
                 proj_turnovers = EXCLUDED.proj_turnovers,
                 proj_threes    = EXCLUDED.proj_threes,
                 proj_minutes   = EXCLUDED.proj_minutes,
                 proj_pra       = EXCLUDED.proj_pra,
                 proj_pts_ast   = EXCLUDED.proj_pts_ast,
                 proj_pts_reb   = EXCLUDED.proj_pts_reb,
                 proj_ast_reb   = EXCLUDED.proj_ast_reb,
                 confidence_score = EXCLUDED.confidence_score,
                 factors_json   = EXCLUDED.factors_json,
                 model_version  = EXCLUDED.model_version""",
            proj
        )
    conn.commit()


# ── Team projection ────────────────────────────────────────────────────────────

def project_team(
    conn,
    team_id:       int,
    team_abbr:     str,
    opponent_abbr: str,
    location:      str,
    game_date:     date,
    posted_spread: Optional[float] = None,
    posted_total:  Optional[float] = None,
) -> Optional[dict]:

    logs     = get_team_logs(conn, team_abbr, limit=20)
    opp_logs = get_team_logs(conn, opponent_abbr, limit=20)

    if len(logs) < 3:
        return None

    team_full = ABBR_TO_FULL_NAME.get(team_abbr, team_abbr)

    base_pts_scored = weighted_avg(logs, 'points_scored')
    opp_base_pts    = weighted_avg(opp_logs, 'points_scored') if opp_logs else LEAGUE_AVG['pts'] / 30 * 5

    opp_def     = get_defense_rating(conn, opponent_abbr)
    opp_pts_all = safe(opp_def.get('pts_allowed'), LEAGUE_AVG['pts'])
    def_quality = max(0.90, min(1.10, (LEAGUE_AVG['pts'] / opp_pts_all) if opp_pts_all > 0 else 1.0))

    team_pace = get_team_pace(conn, team_abbr)
    opp_pace  = get_team_pace(conn, opponent_abbr)
    pace_f    = pace_factor_offensive(team_pace, opp_pace)

    home_court_pts   = 2.0 if location == 'home' else 0.0
    proj_pts_scored  = base_pts_scored * def_quality * pace_f + home_court_pts
    proj_pts_allowed = opp_base_pts * def_quality * pace_f - home_court_pts

    proj_total  = proj_pts_scored + proj_pts_allowed
    proj_spread = proj_pts_scored - proj_pts_allowed

    team_win_pct = sum(1 for r in logs if r.get('result') == 'W') / len(logs) if logs else 0.5
    opp_win_pct  = sum(1 for r in opp_logs if r.get('result') == 'W') / len(opp_logs) if opp_logs else 0.5

    team_s = max(0.01, team_win_pct)
    opp_s  = max(0.01, opp_win_pct)
    denom  = team_s + opp_s - 2 * team_s * opp_s
    win_prob = (team_s - team_s * opp_s) / denom if denom != 0 else 0.5

    ml = -(win_prob / (1 - win_prob)) * 100 if win_prob > 0.5 else ((1 - win_prob) / win_prob) * 100

    def normal_cdf(x):
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))

    spread_cover_prob = round(normal_cdf((proj_spread - posted_spread) / SPREAD_STD_DEV), 4) if posted_spread is not None else None
    over_prob         = round(normal_cdf((proj_total - posted_total) / TOTAL_STD_DEV), 4) if posted_total is not None else None
    under_prob        = round(1 - over_prob, 4) if over_prob is not None else None

    confidence = 65 if len(logs) >= 15 else 60
    confidence = max(50, min(90, confidence))

    return {
        'team_id':                  team_id,
        'team_name':                team_full,
        'sport':                    'NBA',
        'game_date':                game_date,
        'opponent':                 opponent_abbr,
        'home_away':                location,
        'prop_type':                'game',
        'proj_points':              round(proj_pts_scored, 3),
        'proj_points_allowed':      round(proj_pts_allowed, 3),
        'proj_total':               round(proj_total, 3),
        'moneyline_projection':     round(ml, 3),
        'win_probability':          round(win_prob, 4),
        'spread_projection':        round(proj_spread, 3),
        'spread_cover_probability': spread_cover_prob,
        'over_probability':         over_prob,
        'under_probability':        under_prob,
        'confidence_score':         confidence,
        'model_version':            MODEL_VERSION,
        'factors_json': json.dumps({
            'def_quality':  round(def_quality, 3),
            'pace_f':       round(pace_f,      3),
            'team_win_pct': round(team_win_pct, 4),
            'opp_win_pct':  round(opp_win_pct,  4),
            'posted_spread': posted_spread,
            'posted_total':  posted_total,
            'games_used':    len(logs),
        }),
    }


def upsert_team_projection(conn, proj: dict):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO team_projections (
                 team_id, team_name, sport, game_date, opponent, home_away,
                 prop_type,
                 proj_points, proj_points_allowed, proj_total,
                 moneyline_projection, win_probability,
                 spread_projection, spread_cover_probability,
                 over_probability, under_probability,
                 confidence_score, model_version, factors_json
               ) VALUES (
                 %(team_id)s, %(team_name)s, %(sport)s, %(game_date)s,
                 %(opponent)s, %(home_away)s,
                 %(prop_type)s,
                 %(proj_points)s, %(proj_points_allowed)s, %(proj_total)s,
                 %(moneyline_projection)s, %(win_probability)s,
                 %(spread_projection)s, %(spread_cover_probability)s,
                 %(over_probability)s, %(under_probability)s,
                 %(confidence_score)s, %(model_version)s, %(factors_json)s
               )
               ON CONFLICT (team_name, game_date, prop_type) DO UPDATE SET
                 prop_type                = EXCLUDED.prop_type,
                 proj_points              = EXCLUDED.proj_points,
                 proj_points_allowed      = EXCLUDED.proj_points_allowed,
                 proj_total               = EXCLUDED.proj_total,
                 moneyline_projection     = EXCLUDED.moneyline_projection,
                 win_probability          = EXCLUDED.win_probability,
                 spread_projection        = EXCLUDED.spread_projection,
                 spread_cover_probability = EXCLUDED.spread_cover_probability,
                 over_probability         = EXCLUDED.over_probability,
                 under_probability        = EXCLUDED.under_probability,
                 confidence_score         = EXCLUDED.confidence_score,
                 factors_json             = EXCLUDED.factors_json,
                 model_version            = EXCLUDED.model_version""",
            proj
        )
    conn.commit()


# ── BDL team ID → abbreviation map (for team projection lookup) ────────────────
BDL_TEAM_ID_TO_ABBR = {
    1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI',
    6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
    11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM',
    16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
    21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR',
    26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS',
}

ABBR_TO_TEAM_ID = {v: k for k, v in BDL_TEAM_ID_TO_ABBR.items()}


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk NBA Projection Model')
    parser.add_argument('--date', default=None, help='Game date YYYY-MM-DD (default: today)')
    args = parser.parse_args()

    game_date = date.fromisoformat(args.date) if args.date else date.today()

    log.info('═══════════════════════════════════════')
    log.info(f'Chalk NBA Projection Model — {game_date}')
    log.info(f'Model version: {MODEL_VERSION}')
    log.info('═══════════════════════════════════════')

    conn = get_db()

    # ── Step 0: Load rolling league averages from DB ───────────────────────────
    load_league_averages(conn)

    # ── Step 1: Fetch tonight's schedule ──────────────────────────────────────
    log.info('\n▶ TONIGHT\'S SCHEDULE')
    tonight_games = fetch_tonight_schedule(game_date)

    if not tonight_games:
        log.warning('  No games tonight — nothing to project')
        conn.close()
        return

    playing_teams = set(tonight_games.keys())
    for abbr, info in sorted(tonight_games.items()):
        log.info(f'  {abbr} ({info["home_away"]}) vs {info["opponent"]}')

    # ── Step 1b: Fetch live NBA odds (total + spread per game) ─────────────────
    log.info('\n▶ LIVE ODDS')
    nba_odds = fetch_nba_odds()

    # Build per-team odds lookup: team_abbr → { total, spread (from team's POV) }
    team_odds: dict = {}
    for (home_abbr, away_abbr), entry in nba_odds.items():
        total       = entry.get('total')
        home_spread = entry.get('home_spread')
        away_spread = (-home_spread) if home_spread is not None else None
        team_odds[home_abbr] = {'total': total, 'spread': home_spread}
        team_odds[away_abbr] = {'total': total, 'spread': away_spread}

    # ── Step 1c: OUT players + usage redistribution ────────────────────────────
    log.info('\n▶ INJURY / USAGE REDISTRIBUTION')
    out_by_team: dict[str, set] = {}
    for abbr in playing_teams:
        out_names = set(get_out_players(conn, abbr, game_date))
        if out_names:
            log.info(f'  {abbr}: {len(out_names)} player(s) OUT — redistributing usage')
            out_by_team[abbr] = out_names
        else:
            out_by_team[abbr] = set()

    # Pre-compute usage boost per active player on teams with OUT players
    # Each OUT player's ~22% usage share is distributed (×0.85 efficiency) to active teammates
    LEAGUE_USAGE_RATE = 0.22   # rough per-player usage fraction
    usage_boost_map: dict[str, float] = {}   # player_name.lower() → boost amount

    # ── Step 2: Player projections (only players on teams playing tonight) ─────
    log.info('\n▶ PLAYER PROJECTIONS')
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT DISTINCT ON (player_id)
                 player_id, player_name, team
               FROM player_game_logs
               WHERE sport = 'NBA' AND season = %s
                 AND game_date >= %s
               ORDER BY player_id, game_date DESC""",
            (CURRENT_SEASON, game_date - timedelta(days=3))
        )
        all_recent = cur.fetchall()

    players_tonight = [p for p in all_recent if p['team'] in playing_teams]
    log.info(f'  {len(players_tonight)} players on tonight\'s teams (from {len(all_recent)} recently active)')

    # Compute usage boosts: for each team with OUT players, distribute usage to active teammates
    for abbr, out_names in out_by_team.items():
        if not out_names:
            continue
        active = [p for p in players_tonight
                  if p['team'] == abbr and p['player_name'].lower() not in out_names]
        if not active:
            continue
        # Each OUT player carried ~22% usage; 85% of that transfers to active players
        total_boost = len(out_names) * LEAGUE_USAGE_RATE * 0.85
        per_player_boost = total_boost / len(active)
        for p in active:
            usage_boost_map[p['player_name'].lower()] = round(per_player_boost, 4)

    projected = 0
    skipped   = 0
    for player in players_tonight:
        pid      = player['player_id']
        name     = player['player_name']
        team     = player['team']
        game_info = tonight_games[team]
        opponent  = game_info['opponent']
        location  = game_info['home_away']

        # Skip confirmed OUT players (no projection needed)
        if name.lower() in out_by_team.get(team, set()):
            log.info(f'  SKIP {name} — confirmed OUT')
            skipped += 1
            continue

        # Get live odds for this game
        t_odds        = team_odds.get(team, {})
        implied_total = t_odds.get('total')
        spread        = t_odds.get('spread')
        u_boost       = usage_boost_map.get(name.lower(), 0.0)

        proj = project_player(
            conn=conn,
            player_id=pid,
            player_name=name,
            team=team,
            opponent=opponent,
            location=location,
            game_date=game_date,
            spread=spread,
            implied_total=implied_total,
            usage_boost=u_boost,
        )

        if proj:
            try:
                upsert_player_projection(conn, proj)
                projected += 1
            except Exception as e:
                log.warning(f'  Could not store projection for {name}: {e}')
                conn.rollback()
        else:
            skipped += 1

    log.info(f'  Projected: {projected} players, skipped: {skipped}')

    # ── Step 3: Team projections ───────────────────────────────────────────────
    log.info('\n▶ TEAM PROJECTIONS')
    team_projected = 0

    # Use each game once (home team side only to avoid duplicates)
    seen_games = set()
    for abbr, info in tonight_games.items():
        if info['home_away'] != 'home':
            continue
        tid = ABBR_TO_TEAM_ID.get(abbr)
        if not tid:
            continue
        game_key = info['game_id']
        if game_key in seen_games:
            continue
        seen_games.add(game_key)

        # Get live odds for this game
        t_odds = team_odds.get(abbr, {})

        # Project home team
        proj = project_team(
            conn=conn,
            team_id=tid,
            team_abbr=abbr,
            opponent_abbr=info['opponent'],
            location='home',
            game_date=game_date,
        )
        if proj:
            try:
                upsert_team_projection(conn, proj)
                team_projected += 1
            except Exception as e:
                log.warning(f'  Could not store team projection for {abbr}: {e}')
                conn.rollback()

        # Project away team
        away_abbr = info['opponent']
        away_tid  = ABBR_TO_TEAM_ID.get(away_abbr)
        if away_tid:
            away_proj = project_team(
                conn=conn,
                team_id=away_tid,
                team_abbr=away_abbr,
                opponent_abbr=abbr,
                location='away',
                game_date=game_date,
            )
            if away_proj:
                try:
                    upsert_team_projection(conn, away_proj)
                    team_projected += 1
                except Exception as e:
                    log.warning(f'  Could not store team projection for {away_abbr}: {e}')
                    conn.rollback()

    log.info(f'  Projected: {team_projected} teams')

    conn.close()
    log.info('\n✅ Projection model complete')
    log.info(f'   Player projections: {projected}')
    log.info(f'   Team projections:   {team_projected}')
    log.info('   → Run edgeDetector.js next to find value vs. market lines')


if __name__ == '__main__':
    main()
