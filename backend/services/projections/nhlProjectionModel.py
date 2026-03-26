"""
Chalk NHL Projection Model  v2.0
=================================
Runs at 4:30 AM ET daily. Generates player + team projections for every
NHL game tonight. Reads from PostgreSQL, fetches live odds from The Odds API,
and writes to chalk_projections and team_projections.

DB column mappings (shared player_game_logs table):
  Skaters
  -------
  points        = goals per game
  three_made    = assists per game
  fg_made       = shots on goal
  ft_made       = hits
  ft_att        = blocked shots
  minutes       = TOI total (seconds or minutes — normalised below)
  fg_att        = PP TOI per game
  three_att     = PP goals
  plus_minus    = plus/minus
  turnovers     = PIM
  position      = forward/D position code

  Goalies (position = 'G')
  -------
  steals        = saves
  fg_pct        = save percentage (decimal, e.g. 0.921)
  fg_att        = shots against
  blocks        = goals against
  off_reb       = GSAA
  minutes       = TOI
  plus_minus    = W=1, L=-1, OT=0

Team game logs
  points_scored  = goals for
  points_allowed = goals against
  fg_made        = shots for
  fg_att         = shots against

Execution order:
  1  Schedule           5  SOG           9  PM
  2  Goalie confirm     6  Goals         10 Saves
  3  Odds API           7  Assists       11 GA
  4  TOI                8  Points        12 SV%  13 Team props

Usage:
  python nhlProjectionModel.py [--date YYYY-MM-DD]
"""

from __future__ import annotations
import argparse
import json
import logging
import math
import os
import sys
import time
from datetime import date, timedelta
from typing import Optional

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

DATABASE_URL   = os.getenv('DATABASE_URL', '')
ODDS_API_KEY   = os.getenv('ODDS_API_KEY', '')
MODEL_VERSION  = 'v2.0'
CURRENT_SEASON = '20252026'

# ── League-average baselines (2024-25 NHL season) ────────────────────────────

LEAGUE = {
    # Skater per game
    'goals_pg':          0.30,
    'assists_pg':        0.50,
    'points_pg':         0.80,
    'sog_pg':            2.80,
    'toi_pg':            15.5,
    'pp_toi_pg':         2.10,   # updated from spec
    # Shooting / scoring rates
    'sh_pct':            0.105,
    'shooting_pct':      0.105,
    # Team
    'team_goals_pg':     3.05,
    'team_ga_pg':        3.05,
    'shots_for_pg':      30.0,
    'shots_against_pg':  30.0,
    'sog_per_min':       0.156,   # 2.8 SOG / 18 min
    # Goalie
    'sv_pct':            0.906,
    'backup_sv_pct':     0.889,
    'saves_pg':          27.5,
    'ga_pg':             3.05,
    # Game
    'nhl_total':         6.10,
    'en_goals_pg':       0.15,
    'ot_probability':    0.24,
    # Std devs for probability calcs
    'total_std_dev':     1.35,
    'rl_std_dev':        1.90,
}

# ── DB connection ─────────────────────────────────────────────────────────────

def get_db():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL env var not set')
    conn = psycopg2.connect(DATABASE_URL)
    psycopg2.extras.register_default_jsonb(conn)
    return conn


# ── Utility helpers ───────────────────────────────────────────────────────────

def safe(val, default: float = 0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def normal_cdf(x: float, mu: float = 0.0, sigma: float = 1.0) -> float:
    if sigma <= 0:
        return 0.5
    return 0.5 * (1.0 + math.erf((x - mu) / (sigma * math.sqrt(2.0))))


def rolling_avg(rows: list, col: str, n: int) -> float:
    vals = [safe(r[col]) for r in rows[:n] if r.get(col) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def weighted_avg(rows: list, col: str) -> float:
    """
    Per spec: L5×0.40 + L10×0.30 + L20×0.20 + season×0.10
    L5 weighted most heavily because hockey hot/cold streaks are the most
    predictive short-term signal in the sport.
    """
    n = len(rows)
    if n == 0:
        return 0.0
    l5  = rolling_avg(rows, col, min(5, n))
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


def home_away_avg(rows: list, col: str, location: str) -> float:
    filtered = [r for r in rows if r.get('home_away') == location]
    return rolling_avg(filtered, col, len(filtered)) if filtered else 0.0


def cap(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


# ── DB queries ────────────────────────────────────────────────────────────────

def get_skater_logs(conn, player_id: int, limit: int = 50) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'NHL' AND season = %s
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_goalie_logs(conn, player_id: int, limit: int = 30) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'NHL' AND season = %s
                 AND steals > 0
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_team_logs(conn, team_abbr: str, limit: int = 20) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM team_game_logs
               WHERE (team_name = %s OR team_name ILIKE %s)
                 AND sport = 'NHL' AND season = %s
               ORDER BY game_date DESC LIMIT %s""",
            (team_abbr, f'%{team_abbr}%', CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_rest_days(conn, player_id: int, game_date: date) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT MAX(game_date) FROM player_game_logs
               WHERE player_id = %s AND game_date < %s AND sport = 'NHL'""",
            (player_id, game_date)
        )
        row = cur.fetchone()
        if row and row[0]:
            return (game_date - row[0]).days
        return 3


def get_team_goalie(conn, team_abbr: str) -> Optional[dict]:
    """Return the most-used goalie for a team this season."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT player_id, player_name,
                      COUNT(*)     AS starts,
                      AVG(steals)  AS avg_saves,
                      AVG(fg_pct)  AS avg_sv_pct,
                      AVG(off_reb) AS avg_gsaa
               FROM player_game_logs
               WHERE (team = %s OR team ILIKE %s)
                 AND sport = 'NHL' AND season = %s
                 AND position = 'G' AND steals > 0
               GROUP BY player_id, player_name
               ORDER BY starts DESC LIMIT 1""",
            (team_abbr, f'%{team_abbr}%', CURRENT_SEASON)
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_nightly_roster(conn, team_abbr: str, game_date: date) -> list:
    """Return nightly_roster rows for this team today."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM nightly_roster
               WHERE (team ILIKE %s OR team = %s)
                 AND game_date = %s AND sport = 'NHL'""",
            (f'%{team_abbr}%', team_abbr, game_date)
        )
        return cur.fetchall()


def get_injury_context(roster_rows: list) -> dict:
    """
    Parse nightly_roster for injury context.
    Returns:
      forwards_out: count of unavailable forwards
      star_scorer_out: bool (top scorer injured)
      primary_pg_out: bool (primary playmaker injured)
    """
    out = [r for r in roster_rows
           if not r.get('is_confirmed_playing', True)
           and r.get('injury_status') not in (None, 'GTD')]

    fwd_positions = {'C', 'LW', 'RW', 'F'}
    fwds_out = sum(1 for r in out if (r.get('position') or '') in fwd_positions)

    # Star scorer heuristic: first player alphabetically among scratches
    # In production the edge detector has richer role data;
    # here we flag if multiple forwards are out
    star_out    = fwds_out >= 1
    pg_out      = fwds_out >= 2
    multi_out   = fwds_out >= 2

    return {
        'forwards_out':    fwds_out,
        'star_scorer_out': star_out,
        'primary_pg_out':  pg_out,
        'multi_out':       multi_out,
    }


# ── NHL API helpers ───────────────────────────────────────────────────────────

def nhl_get(path: str) -> Optional[dict]:
    url = f'https://api-web.nhle.com/v1{path}'
    try:
        r = requests.get(url, timeout=10,
                         headers={'User-Agent': 'ChalkApp/2.0'})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning(f'NHL API error {path}: {e}')
        return None


def get_todays_games(game_date: date) -> list:
    data = nhl_get(f'/schedule/{game_date}')
    if not data:
        return []
    target = str(game_date)
    games  = []
    for week in data.get('gameWeek', []):
        if week.get('date', '') != target:
            continue
        for g in week.get('games', []):
            games.append({
                'game_id':    g.get('id'),
                'home_team':  g.get('homeTeam', {}).get('abbrev', ''),
                'away_team':  g.get('awayTeam', {}).get('abbrev', ''),
                'start_time': g.get('startTimeUTC', ''),
                'venue':      g.get('venue', {}).get('default', ''),
            })
    return games


def get_team_roster(team_abbr: str) -> dict:
    data = nhl_get(f'/roster/{team_abbr}/current')
    if not data:
        return {'forwards': [], 'defensemen': [], 'goalies': []}
    return {
        'forwards':   data.get('forwards',   []),
        'defensemen': data.get('defensemen', []),
        'goalies':    data.get('goalies',    []),
    }


def confirm_starting_goalie(game_id: int) -> dict:
    """
    Check NHL pre-game API for confirmed starting goalies.
    Falls back to 'most starts this season' from DB caller.
    Returns dict with home/away goalie name and backup flag.
    """
    data = nhl_get(f'/gamecenter/{game_id}/landing')
    result = {
        'home_goalie_name': None,
        'away_goalie_name': None,
        'home_is_backup':   False,
        'away_is_backup':   False,
        'confirmed':        False,
    }
    if not data:
        return result

    pg = data.get('matchup', {}).get('skaterSeasonStats', {})
    # Pre-game endpoint sometimes has 'goalieSeasonStats'
    # If starters are listed, use them
    home_starters = data.get('homeTeam', {}).get('skaters', [])
    away_starters = data.get('awayTeam', {}).get('skaters', [])

    # Simpler approach: check 'teamGameProjection' for projected starter
    home_g = data.get('homeTeam', {}).get('goalie')
    away_g = data.get('awayTeam', {}).get('goalie')

    if home_g:
        result['home_goalie_name'] = home_g.get('name', {}).get('default')
        result['confirmed'] = True
    if away_g:
        result['away_goalie_name'] = away_g.get('name', {}).get('default')
        result['confirmed'] = True

    return result


# ── Odds API helpers ──────────────────────────────────────────────────────────

_odds_cache: dict = {}   # (home, away) → odds dict

def fetch_game_odds(home_team: str, away_team: str) -> dict:
    """
    Fetch live NHL puck line, total, and moneyline from The Odds API.
    Returns:
      home_ml, away_ml, home_puck_line, puck_line_price,
      implied_total, posted_total
    All None if API unavailable.
    """
    key = f'{away_team}@{home_team}'
    if key in _odds_cache:
        return _odds_cache[key]

    result = {
        'home_ml': None, 'away_ml': None,
        'home_puck_line': None, 'posted_total': LEAGUE['nhl_total'],
        'implied_total': LEAGUE['nhl_total'],
    }

    if not ODDS_API_KEY:
        _odds_cache[key] = result
        return result

    try:
        url = 'https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/'
        r = requests.get(url, params={
            'apiKey':      ODDS_API_KEY,
            'regions':     'us',
            'markets':     'h2h,spreads,totals',
            'oddsFormat':  'american',
        }, timeout=10)
        if not r.ok:
            log.warning(f'[Odds API] HTTP {r.status_code}')
            _odds_cache[key] = result
            return result

        for game in r.json():
            ht = game.get('home_team', '').lower()
            at = game.get('away_team', '').lower()
            # Fuzzy match on team abbreviation
            if home_team.lower()[:3] not in ht and home_team.lower() not in ht:
                continue

            for bm in game.get('bookmakers', [])[:1]:   # use first bookmaker
                for mkt in bm.get('markets', []):
                    key_m = mkt.get('key')
                    outcomes = mkt.get('outcomes', [])
                    if key_m == 'h2h':
                        for o in outcomes:
                            if o.get('name', '').lower() in ht:
                                result['home_ml'] = o.get('price')
                            else:
                                result['away_ml'] = o.get('price')
                    elif key_m == 'spreads':
                        for o in outcomes:
                            if o.get('name', '').lower() in ht:
                                result['home_puck_line'] = o.get('point')
                    elif key_m == 'totals':
                        for o in outcomes:
                            if o.get('name', '').lower() == 'over':
                                result['posted_total']  = safe(o.get('point'), LEAGUE['nhl_total'])
                                result['implied_total'] = result['posted_total']
            break

    except Exception as e:
        log.warning(f'[Odds API] {e}')

    _odds_cache[key] = result
    return result


def game_script_factor_from_odds(home_ml: Optional[float],
                                  away_ml: Optional[float],
                                  is_home: bool) -> float:
    """
    Derive game script factor from moneyline.
    Underdog teams trailing → shoot more desperately (SOG/goals up).
    Heavy fav teams leading → conservative (SOG slightly down).
    """
    my_ml  = home_ml if is_home else away_ml
    opp_ml = away_ml if is_home else home_ml

    if my_ml is None or opp_ml is None:
        return 1.00

    # If my team is the heavy underdog
    if my_ml >= 160:
        return 1.10    # trailing → shoot desperately

    # If my team is the heavy favourite
    if my_ml <= -200:
        return 0.94    # leading → conservative

    # If puck line is close (+/- 0.5)
    return 1.00


# ── TOI helpers ───────────────────────────────────────────────────────────────

def normalise_toi(val) -> float:
    """
    TOI stored as seconds or minutes depending on collector version.
    Normalise to minutes.
    """
    v = safe(val)
    if v > 90:            # clearly stored as seconds
        return v / 60.0
    return v


def get_avg_toi(logs: list, n: int) -> float:
    vals = [normalise_toi(r.get('minutes')) for r in logs[:n]
            if r.get('minutes') is not None]
    return sum(vals) / len(vals) if vals else LEAGUE['toi_pg']


def get_avg_pp_toi(logs: list, n: int) -> float:
    vals = [safe(r.get('fg_att')) for r in logs[:n]
            if r.get('fg_att') is not None]
    return sum(vals) / len(vals) if vals else 0.0


def line_position_factor(avg_toi_l20: float) -> float:
    """Derive line position from average TOI."""
    if avg_toi_l20 > 18:   return 1.08   # top line / top pair D
    if avg_toi_l20 > 15:   return 1.00   # second line
    if avg_toi_l20 > 12:   return 0.90   # third line
    return 0.76                           # fourth line


# ── Project TOI (Step 4 — feeds everything) ───────────────────────────────────

def project_toi(logs: list, home_away: str, is_b2b: bool,
                injury_ctx: dict) -> tuple:
    """
    proj_toi = base × coaching_f × b2b_f × injury_f × home_away_f
    Run FIRST — all other projections use toi_proj as input.
    """
    base = weighted_avg(logs, 'minutes')
    # Normalise if stored as seconds
    if base > 90:
        base /= 60.0
    if base <= 0:
        base = LEAGUE['toi_pg']

    # PP TOI component — almost perfectly stable
    pp_toi_l20 = get_avg_pp_toi(logs, 20)

    # Coaching adjustment: L5 vs L20 TOI trend
    toi_l5  = get_avg_toi(logs, 5)
    toi_l20 = get_avg_toi(logs, 20)
    diff    = toi_l5 - toi_l20
    if diff > 2.0:
        coaching_f = 1.08   # line promotion
    elif diff < -2.0:
        coaching_f = 0.92   # line demotion
    else:
        coaching_f = 1.00

    # B2B: coaches protect stars more
    if is_b2b:
        b2b_f = 0.96 if base > 19 else 0.98
    else:
        b2b_f = 1.00

    # Injury factor (key linemate out = more TOI)
    if injury_ctx.get('primary_pg_out'):
        injury_f = 1.08
    else:
        injury_f = 1.00

    # Home/away subtle
    ha_f = 1.03 if home_away == 'home' else 0.97

    proj = base * coaching_f * b2b_f * injury_f * ha_f

    # Derive EV and PP TOI from projection
    proj_pp_toi = min(proj * 0.30, pp_toi_l20) if pp_toi_l20 > 0 else 0.0
    proj_ev_toi = proj - proj_pp_toi

    factors = {
        'base':       round(base, 2),
        'toi_l5':     round(toi_l5, 2),
        'toi_l20':    round(toi_l20, 2),
        'pp_toi_l20': round(pp_toi_l20, 2),
        'coaching_f': round(coaching_f, 3),
        'b2b_f':      round(b2b_f, 3),
        'injury_f':   round(injury_f, 3),
        'home_away_f': round(ha_f, 3),
        'proj_pp_toi': round(proj_pp_toi, 2),
        'proj_ev_toi': round(proj_ev_toi, 2),
    }
    return round(max(4.0, proj), 2), factors


# ── Project SOG (Step 5) ──────────────────────────────────────────────────────

def project_shots_on_goal(logs: list, opp_team_logs: list,
                           home_away: str, toi_proj: float,
                           pp_toi_proj: float, is_b2b: bool,
                           game_script_f: float) -> tuple:
    """
    proj_sog = base × toi_f × rate_f × (1 + pp_boost) × opp_shot_f
                    × game_script_f × home_away_f × b2b_f × line_proxy_f
    """
    base = weighted_avg(logs, 'fg_made')
    if base <= 0:
        base = LEAGUE['sog_pg']

    # 1. TOI factor
    toi_l10  = get_avg_toi(logs, 10)
    toi_szn  = get_avg_toi(logs, len(logs))
    if toi_szn > 0:
        toi_f = cap(toi_l10 / toi_szn, 0.80, 1.25)
        if toi_l10 > toi_szn + 1.5:
            toi_f = min(1.25, toi_f * 1.08)
        elif toi_l10 < toi_szn - 1.5:
            toi_f = max(0.80, toi_f * 0.93)
    else:
        toi_f = 1.00

    # 2. SOG per minute rate
    sog_l10_vals  = [safe(r['fg_made']) for r in logs[:10] if r.get('fg_made') is not None]
    toi_l10_vals  = [normalise_toi(r.get('minutes')) for r in logs[:10] if r.get('minutes') is not None]
    n = min(len(sog_l10_vals), len(toi_l10_vals))
    if n > 0 and sum(toi_l10_vals[:n]) > 0:
        sog_per_min = sum(sog_l10_vals[:n]) / sum(toi_l10_vals[:n])
    else:
        sog_per_min = LEAGUE['sog_per_min']
    rate_f = cap(sog_per_min / LEAGUE['sog_per_min'], 0.50, 1.80)

    # 3. PP TOI factor (boost for PP specialists)
    pp_toi_l10 = get_avg_pp_toi(logs, 10)
    pp_toi_f   = pp_toi_l10 / LEAGUE['pp_toi_pg'] if LEAGUE['pp_toi_pg'] > 0 else 1.0
    sog_pp_boost = (pp_toi_f - 1.0) * 0.25   # 25% weight as per spec

    # 4. Opponent shots allowed factor
    opp_sa_l10 = rolling_avg(opp_team_logs, 'fg_att', 10) or LEAGUE['shots_against_pg']
    opp_shot_f = cap(opp_sa_l10 / LEAGUE['shots_against_pg'], 0.88, 1.18)

    # 5. Game script factor (passed in from Odds API)
    # 6. Home/away
    home_avg = home_away_avg(logs, 'fg_made', 'home')
    away_avg = home_away_avg(logs, 'fg_made', 'away')
    if home_avg > 0 and away_avg > 0:
        ha_f = cap((home_avg if home_away == 'home' else away_avg) /
                   ((home_avg + away_avg) / 2), 0.88, 1.12)
    else:
        ha_f = 1.00

    # 7. Back-to-back
    b2b_f = 0.96 if is_b2b else 1.00

    # 8. Line position proxy
    toi_l20  = get_avg_toi(logs, 20)
    line_f   = line_position_factor(toi_l20)

    proj = base * toi_f * rate_f * (1.0 + sog_pp_boost) * opp_shot_f * \
           game_script_f * ha_f * b2b_f * line_f

    factors = {
        'base':            round(base, 3),
        'toi_f':           round(toi_f, 3),
        'sog_per_min':     round(sog_per_min, 4),
        'rate_f':          round(rate_f, 3),
        'pp_toi_l10':      round(pp_toi_l10, 2),
        'pp_toi_f':        round(pp_toi_f, 3),
        'sog_pp_boost':    round(sog_pp_boost, 3),
        'opp_shots_a_l10': round(opp_sa_l10, 2),
        'opp_shot_f':      round(opp_shot_f, 3),
        'game_script_f':   round(game_script_f, 3),
        'home_away_f':     round(ha_f, 3),
        'b2b_f':           round(b2b_f, 3),
        'line_proxy_f':    round(line_f, 3),
    }
    return round(max(0.0, proj), 3), factors


# ── Project Goals (Step 6) ────────────────────────────────────────────────────

def project_goals(logs: list, opp_goalie_logs: list, opp_team_logs: list,
                  home_away: str, toi_proj: float,
                  opp_is_backup: bool, is_b2b: bool) -> tuple:
    """
    PP/EV split model:
    proj_goals = ev_goal_rate × proj_ev_toi + pp_goal_rate × proj_pp_toi
      then multiply through: sh_reg_f × opp_goalie_f × opp_ga_f × toi_f × ha_f × b2b_f
    """
    # Base from weighted average
    base_goals   = weighted_avg(logs, 'points')
    base_pp_goals = weighted_avg(logs, 'three_att')
    if base_goals < 0:  base_goals = 0.0
    if base_pp_goals < 0: base_pp_goals = 0.0

    # PP and EV split
    pp_toi_l10 = get_avg_pp_toi(logs, 10)
    toi_l10    = get_avg_toi(logs, 10)
    ev_toi_l10 = max(0.1, toi_l10 - pp_toi_l10)

    ev_goals_l10 = max(0.0, rolling_avg(logs, 'points', 10) - rolling_avg(logs, 'three_att', 10))
    pp_goals_l10 = rolling_avg(logs, 'three_att', 10)

    ev_goal_rate = ev_goals_l10 / ev_toi_l10 if ev_toi_l10 > 0 else 0.0
    pp_goal_rate = pp_goals_l10 / pp_toi_l10 if pp_toi_l10 > 0 else 0.0

    # Projected TOI split
    pp_toi_proj = get_avg_pp_toi(logs, 20)
    ev_toi_proj = max(0.1, toi_proj - pp_toi_proj)

    # Raw EV + PP goals projection
    proj_ev  = ev_goal_rate * ev_toi_proj
    proj_pp  = pp_goal_rate * pp_toi_proj

    # 1. Shooting percentage regression factor
    sog_l10  = rolling_avg(logs, 'fg_made', 10)
    sh_pct_l10 = (rolling_avg(logs, 'points', 10) / sog_l10) if sog_l10 > 0 else LEAGUE['sh_pct']
    if sh_pct_l10 > 0.150:
        sh_reg_f = 0.90   # hot — expect regression
    elif sh_pct_l10 < 0.070:
        sh_reg_f = 1.10   # cold — expect surge
    else:
        sh_reg_f = 1.00

    # 2. Opponent goalie factor (CRITICAL)
    if opp_is_backup:
        opp_sv = LEAGUE['backup_sv_pct']
        backup_flag = True
    else:
        opp_sv = rolling_avg(opp_goalie_logs, 'fg_pct', 10) if opp_goalie_logs else LEAGUE['sv_pct']
        if opp_sv <= 0:
            opp_sv = LEAGUE['sv_pct']
        backup_flag = False

    opp_goalie_f = ((1 - LEAGUE['sv_pct']) / (1 - opp_sv)) if (1 - opp_sv) > 0 else 1.0
    opp_goalie_f = cap(opp_goalie_f, 0.60, 1.60)

    # 3. Opponent goals allowed factor
    opp_ga_l10 = rolling_avg(opp_team_logs, 'points_allowed', 10) or LEAGUE['team_ga_pg']
    opp_ga_f   = cap(opp_ga_l10 / LEAGUE['team_ga_pg'], 0.80, 1.30)

    # Opponent goals allowed trend (L5 vs L20)
    opp_ga_l5  = rolling_avg(opp_team_logs, 'points_allowed', 5)
    opp_ga_l20 = rolling_avg(opp_team_logs, 'points_allowed', 20)
    if opp_ga_l5 > opp_ga_l20 + 0.3:
        opp_ga_trend_f = 1.05   # opp letting more in recently
    elif opp_ga_l5 < opp_ga_l20 - 0.3:
        opp_ga_trend_f = 0.95
    else:
        opp_ga_trend_f = 1.00

    # 4. TOI factor
    toi_szn = get_avg_toi(logs, len(logs))
    toi_f   = cap(toi_proj / toi_szn, 0.75, 1.30) if toi_szn > 0 else 1.0

    # 5. Home/away
    home_g = home_away_avg(logs, 'points', 'home')
    away_g = home_away_avg(logs, 'points', 'away')
    if home_g > 0 and away_g > 0:
        ha_f = cap((home_g if home_away == 'home' else away_g) /
                   ((home_g + away_g) / 2), 0.88, 1.12)
    else:
        ha_f = 1.00

    # 6. B2B: goals drop more than SOG on B2B
    b2b_f = 0.93 if is_b2b else 1.00

    proj = (proj_ev + proj_pp) * sh_reg_f * opp_goalie_f * opp_ga_f * \
           opp_ga_trend_f * toi_f * ha_f * b2b_f

    factors = {
        'base_goals':        round(base_goals, 3),
        'ev_goal_rate':      round(ev_goal_rate, 4),
        'pp_goal_rate':      round(pp_goal_rate, 4),
        'pp_toi_proj':       round(pp_toi_proj, 2),
        'ev_toi_proj':       round(ev_toi_proj, 2),
        'proj_ev_goals':     round(proj_ev, 3),
        'proj_pp_goals':     round(proj_pp, 3),
        'sh_pct_l10':        round(sh_pct_l10, 4),
        'sh_reg_f':          round(sh_reg_f, 3),
        'opp_sv_l10':        round(opp_sv, 4),
        'opp_goalie_f':      round(opp_goalie_f, 3),
        'backup_starting':   backup_flag,
        'opp_ga_l10':        round(opp_ga_l10, 3),
        'opp_ga_f':          round(opp_ga_f, 3),
        'opp_ga_trend_f':    round(opp_ga_trend_f, 3),
        'toi_f':             round(toi_f, 3),
        'home_away_f':       round(ha_f, 3),
        'b2b_f':             round(b2b_f, 3),
    }
    return round(max(0.0, proj), 3), factors


# ── Project Assists (Step 7) ──────────────────────────────────────────────────

def project_assists(logs: list, opp_team_logs: list, own_team_logs: list,
                    home_away: str, toi_proj: float, is_b2b: bool,
                    injury_ctx: dict, opp_goalie_logs: list) -> tuple:
    """
    proj_assists = base × pp_assist_f × toi_f × linemate_f × opp_ga_f
                       × injury_f × passing_lane_f × ha_f × b2b_f
    """
    base = weighted_avg(logs, 'three_made')
    if base < 0:
        base = 0.0

    # 1. PP assist factor
    pp_toi_l10 = get_avg_pp_toi(logs, 10)
    pp_ast_f   = 1.0 + ((pp_toi_l10 / LEAGUE['pp_toi_pg']) - 1.0) * 0.40
    pp_ast_f   = cap(pp_ast_f, 0.70, 1.60)

    # 2. TOI factor
    toi_szn = get_avg_toi(logs, len(logs))
    toi_f   = cap(toi_proj / toi_szn, 0.75, 1.30) if toi_szn > 0 else 1.0

    # 3. Linemate scoring proxy (team goals L10)
    team_goals_l10 = rolling_avg(own_team_logs, 'points_scored', 10) or LEAGUE['team_goals_pg']
    linemate_f = cap(team_goals_l10 / LEAGUE['team_goals_pg'], 0.88, 1.12)

    # 4. Opponent GA factor
    opp_ga_l10 = rolling_avg(opp_team_logs, 'points_allowed', 10) or LEAGUE['team_ga_pg']
    opp_ga_f   = cap(opp_ga_l10 / LEAGUE['team_ga_pg'], 0.80, 1.30)

    # 5. Injury cascading (most important for assists)
    fwds_out = injury_ctx.get('forwards_out', 0)
    star_out  = injury_ctx.get('star_scorer_out', False)
    pg_out    = injury_ctx.get('primary_pg_out', False)

    if fwds_out == 0:
        injury_f = 1.00   # Scenario D: no injuries
    elif pg_out and pp_toi_l10 > 2.0:
        injury_f = 1.22   # Scenario B: PG out, this player takes role
    elif star_out:
        injury_f = 0.85   # Scenario A: primary scorer out (fewer assists)
    elif fwds_out >= 2:
        injury_f = 0.91   # Scenario C: multiple forwards out
    else:
        injury_f = 1.00

    # 6. Passing lane factor (active D = fewer assists)
    # Proxy: opponent steals/deflections approximate — use shots against rate
    opp_sa_l10 = rolling_avg(opp_team_logs, 'fg_att', 10) or LEAGUE['shots_against_pg']
    if opp_sa_l10 > LEAGUE['shots_against_pg'] * 1.08:
        passing_lane_f = 0.94   # high-shot defence, active puck pursuit
    else:
        passing_lane_f = 1.00

    # 7. Home/away
    home_a = home_away_avg(logs, 'three_made', 'home')
    away_a = home_away_avg(logs, 'three_made', 'away')
    if home_a > 0 and away_a > 0:
        ha_f = cap((home_a if home_away == 'home' else away_a) /
                   ((home_a + away_a) / 2), 0.88, 1.12)
    else:
        ha_f = 1.00

    # 8. B2B
    b2b_f = 0.94 if is_b2b else 1.00

    proj = base * pp_ast_f * toi_f * linemate_f * opp_ga_f * \
           injury_f * passing_lane_f * ha_f * b2b_f

    factors = {
        'base':             round(base, 3),
        'pp_toi_l10':       round(pp_toi_l10, 2),
        'pp_assist_f':      round(pp_ast_f, 3),
        'toi_f':            round(toi_f, 3),
        'team_goals_l10':   round(team_goals_l10, 3),
        'linemate_f':       round(linemate_f, 3),
        'opp_ga_l10':       round(opp_ga_l10, 3),
        'opp_ga_f':         round(opp_ga_f, 3),
        'forwards_out':     fwds_out,
        'injury_f':         round(injury_f, 3),
        'passing_lane_f':   round(passing_lane_f, 3),
        'home_away_f':      round(ha_f, 3),
        'b2b_f':            round(b2b_f, 3),
    }
    return round(max(0.0, proj), 3), factors


# ── Project Points (Step 8) ───────────────────────────────────────────────────

def project_points(logs: list, g_proj: float, a_proj: float,
                   toi_proj: float, implied_total: float) -> tuple:
    """
    proj_points = (g_proj + a_proj) × archetype_f × pp_pts_adj × game_total_f
    """
    base_goals   = weighted_avg(logs, 'points')
    base_assists = weighted_avg(logs, 'three_made')
    if base_goals < 0:   base_goals = 0.0
    if base_assists < 0: base_assists = 0.0

    # Archetype classification
    if base_goals > 0.40 and base_assists > 0.40:
        archetype, corr_f = 'TRUE_POINT_PRODUCER', 1.00
    elif base_goals > 0.40 and base_assists < 0.35:
        archetype, corr_f = 'GOAL_SCORER', 0.96
    elif base_assists > 0.45 and base_goals < 0.20:
        archetype, corr_f = 'PURE_PLAYMAKER', 0.98
    else:
        archetype, corr_f = 'ROLE_PLAYER', 0.97

    # PP points adjustment
    pp_toi_l20 = get_avg_pp_toi(logs, 20)
    pp_pts_f   = 1.0 + ((pp_toi_l20 / LEAGUE['pp_toi_pg']) - 1.0) * 0.35
    pp_pts_f   = cap(pp_pts_f, 0.70, 1.50)

    # Game total factor
    if implied_total > 7.0:
        total_f = 1.06
    elif implied_total < 5.5:
        total_f = 0.94
    else:
        total_f = 1.00

    proj = (g_proj + a_proj) * corr_f * pp_pts_f * total_f

    factors = {
        'g_proj':        round(g_proj, 3),
        'a_proj':        round(a_proj, 3),
        'archetype':     archetype,
        'corr_f':        round(corr_f, 3),
        'pp_toi_l20':    round(pp_toi_l20, 2),
        'pp_pts_f':      round(pp_pts_f, 3),
        'implied_total': round(implied_total, 2),
        'game_total_f':  round(total_f, 3),
    }
    return round(max(0.0, proj), 3), factors


# ── Project Plus/Minus (Step 9) ───────────────────────────────────────────────

def project_plus_minus(logs: list, opp_team_logs: list, own_team_logs: list,
                        home_away: str, toi_proj: float,
                        puck_line: Optional[float]) -> tuple:
    """
    proj_pm = base × ev_diff_f × oz_f × toi_f × opp_quality_f
    HIGH VARIANCE — apply confidence dampening.
    """
    base = weighted_avg(logs, 'plus_minus')

    # 1. EV goal differential (own team vs opponent)
    own_gf_l10 = rolling_avg(own_team_logs, 'points_scored', 10) or LEAGUE['team_goals_pg']
    opp_ga_l10 = rolling_avg(opp_team_logs, 'points_allowed', 10) or LEAGUE['team_ga_pg']
    ev_diff    = own_gf_l10 - opp_ga_l10
    ev_diff_f  = cap(1.0 + (ev_diff / LEAGUE['team_goals_pg']) * 0.15, 0.85, 1.20)

    # 2. Zone start proxy (high PP TOI = more offensive zone starts)
    pp_toi_l10 = get_avg_pp_toi(logs, 10)
    if pp_toi_l10 > 3.0:
        oz_f = 1.06
    elif pp_toi_l10 < 0.5:
        oz_f = 0.94
    else:
        oz_f = 1.00

    # 3. TOI factor
    toi_szn = get_avg_toi(logs, len(logs))
    toi_f   = cap(toi_proj / toi_szn, 0.75, 1.30) if toi_szn > 0 else 1.0

    # 4. Opponent quality
    opp_gf_l10 = rolling_avg(opp_team_logs, 'points_scored', 10) or LEAGUE['team_goals_pg']
    opp_quality_f = cap(LEAGUE['team_goals_pg'] / opp_gf_l10, 0.80, 1.20) if opp_gf_l10 > 0 else 1.0

    proj = base * ev_diff_f * oz_f * toi_f * opp_quality_f

    # Blowout risk: abs(puck_line) > 1.5 distorts PM dramatically
    blowout_risk = puck_line is not None and abs(puck_line) > 1.5

    factors = {
        'base':           round(base, 3),
        'own_gf_l10':     round(own_gf_l10, 3),
        'opp_ga_l10':     round(opp_ga_l10, 3),
        'ev_diff_f':      round(ev_diff_f, 3),
        'pp_toi_l10':     round(pp_toi_l10, 2),
        'oz_f':           round(oz_f, 3),
        'toi_f':          round(toi_f, 3),
        'opp_quality_f':  round(opp_quality_f, 3),
        'blowout_risk':   blowout_risk,
    }
    return round(proj, 3), factors


# ── Goalie: Project Saves (Step 10) ──────────────────────────────────────────

def project_saves(goalie_logs: list, opp_team_logs: list,
                  home_away: str, is_b2b: bool, rest_days: int,
                  is_backup: bool) -> tuple:
    """
    proj_saves = base × sv_trend_f × gsaa_f × opp_shot_f
                     × opp_sh_pct_f × game_total_f × ha_f × rest_f × team_def_f
    """
    if is_backup and len(goalie_logs) < 5:
        base = 22.4
        sv_pct_l10 = LEAGUE['backup_sv_pct']
        base_sv = LEAGUE['backup_sv_pct']
    else:
        base     = weighted_avg(goalie_logs, 'steals') if goalie_logs else LEAGUE['saves_pg']
        base_sv  = rolling_avg(goalie_logs, 'fg_pct', len(goalie_logs)) if goalie_logs else LEAGUE['sv_pct']
        sv_pct_l10 = rolling_avg(goalie_logs, 'fg_pct', 10) if goalie_logs else base_sv

    if base <= 0:
        base = LEAGUE['saves_pg']
    if base_sv <= 0:
        base_sv = LEAGUE['sv_pct']

    # 1. SV% sustainability check
    sv_szn = rolling_avg(goalie_logs, 'fg_pct', len(goalie_logs)) if goalie_logs else LEAGUE['sv_pct']
    if sv_szn > 0:
        if sv_pct_l10 > sv_szn + 0.010:
            sv_trend_f = 0.93   # hot goalie — expect regression
        elif sv_pct_l10 < sv_szn - 0.010:
            sv_trend_f = 1.07   # cold goalie — expect surge
        else:
            sv_trend_f = 1.00
    else:
        sv_trend_f = 1.00

    # 2. GSAA factor
    gsaa_l10 = rolling_avg(goalie_logs, 'off_reb', 10) if goalie_logs else 0.0
    if gsaa_l10 > 0.5:
        gsaa_f = 1.04
    elif gsaa_l10 < -0.5:
        gsaa_f = 0.96
    else:
        gsaa_f = 1.00

    # 3. Opponent shots factor (most important for save VOLUME)
    opp_sf_l10 = rolling_avg(opp_team_logs, 'fg_made', 10) or LEAGUE['shots_for_pg']
    opp_shot_f = cap(opp_sf_l10 / LEAGUE['shots_for_pg'], 0.80, 1.30)

    # 4. Opponent shooting percentage regression
    opp_goals_l10 = rolling_avg(opp_team_logs, 'points_scored', 10) or LEAGUE['team_goals_pg']
    opp_sh_pct_l10 = (opp_goals_l10 / opp_sf_l10) if opp_sf_l10 > 0 else LEAGUE['sh_pct']
    if opp_sh_pct_l10 > LEAGUE['sh_pct'] + 0.015:
        opp_sh_f = 1.05   # hot shooting team — regression coming = more saves
    elif opp_sh_pct_l10 < LEAGUE['sh_pct'] - 0.015:
        opp_sh_f = 0.96
    else:
        opp_sh_f = 1.00

    # 5. Game total factor (from Odds API — passed as param via caller)
    # Handled at call site by passing implied_total
    game_total_f = 1.00   # overridden by caller if total available

    # 6. Home/away
    home_sv = home_away_avg(goalie_logs, 'steals', 'home') if goalie_logs else 0.0
    away_sv = home_away_avg(goalie_logs, 'steals', 'away') if goalie_logs else 0.0
    if home_sv > 0 and away_sv > 0:
        ha_f = cap((home_sv if home_away == 'home' else away_sv) /
                   ((home_sv + away_sv) / 2), 0.90, 1.10)
    else:
        ha_f = 1.00

    # 7. Rest factor
    if rest_days <= 1:
        rest_f = 0.93
    elif rest_days >= 5:
        rest_f = 0.97
    else:
        rest_f = 1.00

    # 8. Team defence factor (subtle)
    own_sa_l10 = rolling_avg(opp_team_logs, 'fg_att', 10) or LEAGUE['shots_against_pg']
    # Higher opp SA = goalie faces more = slightly more saves but also more GA
    team_def_f = cap(1.0 + (own_sa_l10 / LEAGUE['shots_against_pg'] - 1.0) * 0.03,
                     0.97, 1.03)

    proj = base * sv_trend_f * gsaa_f * opp_shot_f * opp_sh_f * \
           game_total_f * ha_f * rest_f * team_def_f

    factors = {
        'base':            round(base, 3),
        'backup_starting': is_backup,
        'sv_pct_l10':      round(sv_pct_l10, 4),
        'sv_pct_szn':      round(sv_szn, 4),
        'sv_trend_f':      round(sv_trend_f, 3),
        'gsaa_l10':        round(gsaa_l10, 3),
        'gsaa_f':          round(gsaa_f, 3),
        'opp_sf_l10':      round(opp_sf_l10, 2),
        'opp_shot_f':      round(opp_shot_f, 3),
        'opp_sh_pct_l10':  round(opp_sh_pct_l10, 4),
        'opp_sh_f':        round(opp_sh_f, 3),
        'game_total_f':    round(game_total_f, 3),
        'home_away_f':     round(ha_f, 3),
        'rest_days':       rest_days,
        'rest_f':          round(rest_f, 3),
        'team_def_f':      round(team_def_f, 3),
    }
    return round(max(12.0, proj), 2), factors


# ── Goalie: Project Goals Against (Step 11) ───────────────────────────────────

def project_goals_against(goalie_logs: list, opp_team_logs: list,
                           home_away: str, is_backup: bool) -> tuple:
    """
    proj_ga = base × xga_reg_f × opp_goals_f × pp_quality_f × script_f
              + en_adj + ot_adj
    """
    if is_backup and len(goalie_logs) < 5:
        base = 3.40
        shots_against_l10 = LEAGUE['shots_against_pg']
    else:
        base = weighted_avg(goalie_logs, 'blocks') if goalie_logs else LEAGUE['ga_pg']
        shots_l = [safe(r.get('fg_att')) for r in goalie_logs[:10] if r.get('fg_att')]
        shots_against_l10 = sum(shots_l) / len(shots_l) if shots_l else LEAGUE['shots_against_pg']

    if base <= 0:
        base = LEAGUE['ga_pg']

    # 1. xGA regression
    xga = shots_against_l10 * (1 - LEAGUE['sv_pct'])   # = shots × 0.094
    actual_ga_l10 = rolling_avg(goalie_logs, 'blocks', 10) if goalie_logs else base
    if actual_ga_l10 > xga + 0.3:
        xga_reg_f = 0.92   # lucky bad — will improve
    elif actual_ga_l10 < xga - 0.3:
        xga_reg_f = 1.08   # unlucky good — will get worse
    else:
        xga_reg_f = 1.00

    # 2. Opponent goals factor
    opp_gf_l10 = rolling_avg(opp_team_logs, 'points_scored', 10) or LEAGUE['team_goals_pg']
    opp_goals_f = cap(opp_gf_l10 / LEAGUE['team_goals_pg'], 0.75, 1.35)

    # 3. Opponent PP quality proxy
    opp_sf_l10  = rolling_avg(opp_team_logs, 'fg_made', 10) or LEAGUE['shots_for_pg']
    opp_sh_pct  = (opp_gf_l10 / opp_sf_l10) if opp_sf_l10 > 0 else LEAGUE['sh_pct']
    if opp_sh_pct > LEAGUE['sh_pct'] * 1.15:
        pp_quality_f = 1.12
    elif opp_sh_pct < LEAGUE['sh_pct'] * 0.85:
        pp_quality_f = 0.90
    else:
        pp_quality_f = 1.00

    # 4. Game script (away teams score more on average — subtle)
    script_f = 1.02 if home_away == 'away' else 1.00

    # 5. EN + OT adjustments (always additive)
    en_adj = LEAGUE['en_goals_pg']   # 0.15
    ot_adj = 0.10                     # ~0.24 × 0.4 goals in OT

    proj_mult = base * xga_reg_f * opp_goals_f * pp_quality_f * script_f
    proj      = proj_mult + en_adj + ot_adj

    factors = {
        'base':            round(base, 3),
        'backup_starting': is_backup,
        'shots_against_l10': round(shots_against_l10, 2),
        'xga':             round(xga, 3),
        'actual_ga_l10':   round(actual_ga_l10, 3),
        'xga_reg_f':       round(xga_reg_f, 3),
        'opp_gf_l10':      round(opp_gf_l10, 3),
        'opp_goals_f':     round(opp_goals_f, 3),
        'opp_sh_pct':      round(opp_sh_pct, 4),
        'pp_quality_f':    round(pp_quality_f, 3),
        'script_f':        round(script_f, 3),
        'en_adj':          round(en_adj, 3),
        'ot_adj':          round(ot_adj, 3),
    }
    return round(max(0.5, proj), 3), factors


# ── Team: Project Total (Step 12) ─────────────────────────────────────────────

def project_total(home_tl: list, away_tl: list,
                  home_goalie_logs: list, away_goalie_logs: list,
                  home_is_backup: bool, away_is_backup: bool,
                  home_b2b: bool, away_b2b: bool,
                  home_injury_ctx: dict, away_injury_ctx: dict,
                  posted_total: float = LEAGUE['nhl_total'],
                  conn=None, home_team: str = '', away_team: str = '') -> tuple:
    """
    proj_total = (proj_home_goals + proj_away_goals)
    with goalie, backup, combined offense/defense, PP, B2B, OT, H2H, injury factors.
    """
    def team_goals_base(tl):
        return rolling_avg(tl, 'points_scored', 10) or LEAGUE['team_goals_pg']

    home_base = team_goals_base(home_tl)
    away_base = team_goals_base(away_tl)

    # Opposing goalie factors (DOMINANT)
    def goalie_factor(goalie_logs, is_backup):
        if is_backup:
            return 1.45, LEAGUE['backup_sv_pct']  # massive backup boost
        sv = rolling_avg(goalie_logs, 'fg_pct', 10) if goalie_logs else LEAGUE['sv_pct']
        if sv <= 0:
            sv = LEAGUE['sv_pct']
        f = (1 - LEAGUE['sv_pct']) / (1 - sv) if (1 - sv) > 0 else 1.0
        return cap(f, 0.60, 1.60), sv

    away_goalie_f, away_sv = goalie_factor(away_goalie_logs, away_is_backup)  # home team faces away goalie
    home_goalie_f, home_sv = goalie_factor(home_goalie_logs, home_is_backup)  # away team faces home goalie

    proj_home = home_base * away_goalie_f
    proj_away = away_base * home_goalie_f

    # Combined defence factor
    home_ga_l10 = rolling_avg(home_tl, 'points_allowed', 10) or LEAGUE['team_ga_pg']
    away_ga_l10 = rolling_avg(away_tl, 'points_allowed', 10) or LEAGUE['team_ga_pg']
    combined_def_f = cap(((home_ga_l10 + away_ga_l10) / 2) / LEAGUE['team_ga_pg'], 0.80, 1.25)
    proj_home *= combined_def_f
    proj_away *= combined_def_f

    # B2B factors
    if home_b2b:
        proj_home *= 0.94
    if away_b2b:
        proj_away *= 0.94

    # Injury factors
    if home_injury_ctx.get('multi_out'):
        proj_home *= 0.93
    elif home_injury_ctx.get('star_scorer_out'):
        proj_home *= 0.96
    if away_injury_ctx.get('multi_out'):
        proj_away *= 0.93
    elif away_injury_ctx.get('star_scorer_out'):
        proj_away *= 0.96

    # OT adjustment (+0.07 expected goals from OT games)
    proj_total_raw = proj_home + proj_away + 0.07

    # H2H factor (last 5 meetings)
    h2h_f = 1.00
    if conn and home_team and away_team:
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT AVG(t1.points_scored + t2.points_scored)
                    FROM team_game_logs t1
                    JOIN team_game_logs t2
                      ON t1.game_date = t2.game_date
                      AND t1.sport = t2.sport
                      AND t1.season = t2.season
                      AND t1.team_name != t2.team_name
                    WHERE t1.sport = 'NHL'
                      AND t1.team_name ILIKE %s
                      AND t2.team_name ILIKE %s
                      AND t1.points_scored IS NOT NULL
                    ORDER BY t1.game_date DESC
                    LIMIT 5
                """, (f'%{home_team[:4]}%', f'%{away_team[:4]}%'))
                row = cur.fetchone()
                if row and row[0]:
                    h2h_avg = float(row[0])
                    if h2h_avg > LEAGUE['nhl_total'] + 1.0:
                        h2h_f = 1.0 + 0.06 * 0.10   # 0.10 weight
                    elif h2h_avg < LEAGUE['nhl_total'] - 1.0:
                        h2h_f = 1.0 - 0.06 * 0.10
        except Exception:
            if conn:
                conn.rollback()

    proj_total = proj_total_raw * h2h_f

    over_prob  = normal_cdf(proj_total, mu=posted_total, sigma=LEAGUE['total_std_dev'])
    over_prob  = max(0.10, min(0.90, over_prob))

    factors = {
        'proj_home_goals':    round(proj_home, 3),
        'proj_away_goals':    round(proj_away, 3),
        'proj_total':         round(proj_total, 3),
        'home_base_goals':    round(home_base, 3),
        'away_base_goals':    round(away_base, 3),
        'away_goalie_f':      round(away_goalie_f, 3),
        'home_goalie_f':      round(home_goalie_f, 3),
        'home_sv_l10':        round(home_sv, 4),
        'away_sv_l10':        round(away_sv, 4),
        'home_is_backup':     home_is_backup,
        'away_is_backup':     away_is_backup,
        'combined_def_f':     round(combined_def_f, 3),
        'home_b2b':           home_b2b,
        'away_b2b':           away_b2b,
        'h2h_f':              round(h2h_f, 4),
        'ot_adj':             0.07,
        'posted_total':       round(posted_total, 2),
        'over_probability':   round(over_prob, 4),
        'under_probability':  round(1.0 - over_prob, 4),
    }
    return round(proj_total, 3), factors


# ── Team: Project Puck Line (Step 13a) ────────────────────────────────────────

def project_puck_line(proj_home: float, proj_away: float,
                       home_goalie_logs: list, away_goalie_logs: list,
                       home_tl: list, away_tl: list,
                       home_is_backup: bool, away_is_backup: bool,
                       home_rest: int, away_rest: int,
                       home_ml: Optional[float]) -> tuple:
    """
    cover_prob = normalCDF((proj_diff - posted_line) / std_dev)
    OT boost: underdog +1.5 always covers in OT (+0.24 to cover prob).
    Large favourite regression if implied > -200.
    """
    proj_diff = proj_home - proj_away

    # Large favourite regression per spec
    regression_applied = False
    if home_ml is not None and home_ml <= -200:
        proj_diff *= 0.91
        regression_applied = True

    # Home -1.5 cover probability
    home_cover_raw = normal_cdf(proj_diff, mu=1.5, sigma=LEAGUE['rl_std_dev'])

    # OT boost: underdog +1.5 always covers in OT (24% OT probability)
    # Away team is the underdog +1.5 if home_cover_raw > 0.50
    away_cover_raw = 1.0 - home_cover_raw
    away_cover_with_ot = min(0.92, away_cover_raw + LEAGUE['ot_probability'])

    # Goalie GSAA differential
    home_gsaa = rolling_avg(home_goalie_logs, 'off_reb', 10) if home_goalie_logs else 0.0
    away_gsaa = rolling_avg(away_goalie_logs, 'off_reb', 10) if away_goalie_logs else 0.0
    gsaa_diff  = home_gsaa - away_gsaa
    gsaa_adj   = gsaa_diff * 0.06   # 0.5 GSAA = 3% cover prob shift

    # Rest advantage
    rest_diff = home_rest - away_rest
    rest_adj  = rest_diff * 0.02

    # Backup goalie adjustment
    backup_adj = 0.0
    if home_is_backup:  backup_adj -= 0.08
    if away_is_backup:  backup_adj += 0.10

    home_cover = max(0.10, min(0.90, home_cover_raw + gsaa_adj + rest_adj + backup_adj))
    away_cover = max(0.10, min(0.92, away_cover_with_ot - gsaa_adj - rest_adj - backup_adj))

    home_factors = {
        'proj_home_goals': round(proj_home, 3),
        'proj_away_goals': round(proj_away, 3),
        'proj_diff':       round(proj_diff, 3),
        'home_cover_raw':  round(home_cover_raw, 4),
        'gsaa_adj':        round(gsaa_adj, 4),
        'rest_adj':        round(rest_adj, 4),
        'backup_adj':      round(backup_adj, 4),
        'ot_probability':  LEAGUE['ot_probability'],
        'fav_regression':  regression_applied,
        'cover_prob':      round(home_cover, 4),
        'side':            'home',
    }
    away_factors = {**home_factors,
                    'ot_underdog_boost': round(LEAGUE['ot_probability'], 3),
                    'cover_prob': round(away_cover, 4),
                    'side': 'away'}
    return home_cover, home_factors, away_cover, away_factors


# ── Team: Project Moneyline (Step 13b) ────────────────────────────────────────

def project_moneyline(home_tl: list, away_tl: list,
                       home_goalie_logs: list, away_goalie_logs: list,
                       home_is_backup: bool, away_is_backup: bool,
                       home_rest: int, away_rest: int) -> tuple:
    """
    home_win_prob base = 0.540 (home teams win 54% in NHL)
    Adjusted by: goalie quality, team offense/defense, PP, rest, home record, H2H.
    BACKUP GOALIE: × 0.76 win probability (non-negotiable per spec).
    """
    home_win = 0.540   # HFA baseline

    # 1. Goalie quality (biggest factor)
    home_sv_l10 = rolling_avg(home_goalie_logs, 'fg_pct', 10) if home_goalie_logs else LEAGUE['sv_pct']
    away_sv_l10 = rolling_avg(away_goalie_logs, 'fg_pct', 10) if away_goalie_logs else LEAGUE['sv_pct']
    if home_sv_l10 <= 0: home_sv_l10 = LEAGUE['sv_pct']
    if away_sv_l10 <= 0: away_sv_l10 = LEAGUE['sv_pct']

    sv_diff = home_sv_l10 - away_sv_l10   # positive = home goalie better
    goalie_adj = sv_diff * 6.0             # every 0.010 SV% = 6% win prob shift
    goalie_adj = cap(goalie_adj, -0.15, 0.15)

    # Backup penalty (non-negotiable)
    if home_is_backup:
        home_win *= 0.76
    if away_is_backup:
        home_win = min(0.80, home_win * 1.25)   # effectively: away × 0.76

    # 2. Team offense vs defense
    home_gf_l10 = rolling_avg(home_tl, 'points_scored', 10) or LEAGUE['team_goals_pg']
    home_ga_l10 = rolling_avg(home_tl, 'points_allowed', 10) or LEAGUE['team_ga_pg']
    away_gf_l10 = rolling_avg(away_tl, 'points_scored', 10) or LEAGUE['team_goals_pg']
    away_ga_l10 = rolling_avg(away_tl, 'points_allowed', 10) or LEAGUE['team_ga_pg']

    home_gs = home_gf_l10 / (home_gf_l10 + away_ga_l10) if (home_gf_l10 + away_ga_l10) > 0 else 0.5
    off_def_adj = (home_gs - 0.50) * 0.20

    # 3. Rest differential
    rest_adj = (home_rest - away_rest) * 0.02

    # 4. Home record
    home_wins_l20 = sum(1 for r in home_tl[:20]
                        if r.get('home_away') == 'home' and
                        safe(r.get('result', r.get('points_scored', 0))) > safe(r.get('points_allowed', 0)))
    home_games_l20 = sum(1 for r in home_tl[:20] if r.get('home_away') == 'home')
    if home_games_l20 >= 5:
        home_win_pct = home_wins_l20 / home_games_l20
        if home_win_pct > 0.60:
            home_record_adj = 0.05
        elif home_win_pct < 0.45:
            home_record_adj = -0.05
        else:
            home_record_adj = 0.0
    else:
        home_record_adj = 0.0

    # Combine adjustments
    home_win += goalie_adj + off_def_adj + rest_adj + home_record_adj
    home_win  = cap(home_win, 0.25, 0.80)
    away_win  = 1.0 - home_win

    def to_ml(p: float) -> float:
        if p <= 0 or p >= 1:
            return 0.0
        if p >= 0.5:
            return round(-(p / (1 - p)) * 100, 0)
        return round(((1 - p) / p) * 100, 0)

    factors = {
        'home_sv_l10':       round(home_sv_l10, 4),
        'away_sv_l10':       round(away_sv_l10, 4),
        'sv_diff':           round(sv_diff, 4),
        'goalie_adj':        round(goalie_adj, 4),
        'home_is_backup':    home_is_backup,
        'away_is_backup':    away_is_backup,
        'home_gf_l10':       round(home_gf_l10, 3),
        'away_gf_l10':       round(away_gf_l10, 3),
        'home_ga_l10':       round(home_ga_l10, 3),
        'away_ga_l10':       round(away_ga_l10, 3),
        'off_def_adj':       round(off_def_adj, 4),
        'rest_adj':          round(rest_adj, 4),
        'home_record_adj':   round(home_record_adj, 4),
        'home_win_prob':     round(home_win, 4),
        'away_win_prob':     round(away_win, 4),
        'home_ml':           to_ml(home_win),
        'away_ml':           to_ml(away_win),
        'proj_home_score':   rolling_avg(home_tl, 'points_scored', 10),
        'proj_away_score':   rolling_avg(away_tl, 'points_scored', 10),
    }
    return home_win, factors


# ── Confidence scoring ────────────────────────────────────────────────────────

def compute_confidence(prop_type: str,
                       edge_pct: float,
                       backup_starting: bool = False,
                       opp_goalie_cold: bool = False,
                       player_games: int = 20,
                       pp_toi: float = 0.0,
                       pp_matchup_fav: bool = False,
                       sog_rate_extreme: bool = False,
                       opp_b2b: bool = False,
                       h2h_strong: bool = False,
                       rest_advantage: int = 0,
                       goalie_confirmed: bool = True,
                       opp_goalie_tbd: bool = False,
                       blowout_risk: bool = False) -> int:
    """
    base 60 + edge bonuses + prop-type penalties.
    Soft cap >85: 85 + (x-85)×0.40. Hard cap 92.
    """
    c = 60

    # Edge bonuses
    abs_edge = abs(edge_pct)
    if abs_edge > 0.20:   c += 12
    elif abs_edge > 0.15: c += 10
    elif abs_edge > 0.10: c += 8
    elif abs_edge > 0.07: c += 6

    # Signal bonuses
    if backup_starting:           c += 15   # strongest signal in hockey
    if opp_goalie_cold:           c += 8
    if pp_toi > 3.5 and pp_matchup_fav: c += 6
    if sog_rate_extreme:          c += 5
    if opp_b2b:                   c += 4
    if h2h_strong:                c += 4
    if rest_advantage > 1:        c += 3

    # Data quality penalties
    if not goalie_confirmed:      c -= 8
    if player_games < 10:         c -= 6
    if opp_goalie_tbd:            c -= 5

    # Prop-type variance penalties
    if prop_type == 'plus_minus':  c -= 10
    if prop_type == 'goals':       c -= 4
    if blowout_risk:               c -= 25

    # Soft cap
    if c > 85:
        c = int(85 + (c - 85) * 0.40)

    return max(45, min(92, c))


# ── Minimum edge thresholds ───────────────────────────────────────────────────

MIN_EDGE = {
    'shots_on_goal': 0.8,
    'goals':         0.08,
    'assists':       0.25,
    'points':        0.30,
    'plus_minus':    0.8,
    'toi':           1.5,
    'saves':         1.5,
    'goals_against': 0.4,
    'puck_line':     0.04,
    'total':         0.4,
    'moneyline':     0.05,
}


# ── DB write functions ────────────────────────────────────────────────────────

def get_market_line(conn, player_name: str, prop_type: str, game_date) -> float | None:
    """
    Read the market prop line from player_props_history.
    Populated by oddsService.js before the model runs.
    Returns None if no line posted yet — prop is skipped.
    oddsService.js strips player_ prefix on write, so DB stores bare types:
    'shots_on_goal', 'goals', 'assists', 'points', 'blocked_shots', etc.
    """
    # Normalize: strip sport-specific prefixes before DB lookup
    clean_type = prop_type
    for prefix in ('player_', 'batter_', 'pitcher_'):
        if clean_type.startswith(prefix):
            clean_type = clean_type[len(prefix):]
            break

    # Match on last name since name formats can differ
    last_name = player_name.split()[-1] if player_name else ''

    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT prop_line
                   FROM player_props_history
                   WHERE player_name ILIKE %s
                     AND prop_type = %s
                     AND game_date = %s
                   ORDER BY created_at DESC LIMIT 1""",
                (f'%{last_name}%', clean_type, str(game_date))
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                return float(row[0])
    except Exception as e:
        log.warning(f'[get_market_line] {player_name} {prop_type}: {e}')
        try:
            conn.rollback()
        except Exception:
            pass
    return None


# Minimum edge required per prop type before writing a pick
NHL_MIN_EDGE = {
    'shots_on_goal':      0.4,
    'goals':              0.1,
    'assists':            0.1,
    'points':             0.15,
    'blocked_shots':      0.3,
    'goal_scorer_anytime': 0.05,
    'saves':              0.5,
}


def upsert_player_projection(conn, player_id: int, player_name: str,
                              team: str, opponent: str, game_date: date,
                              prop_type: str, proj_value: float,
                              confidence: int, factors: dict) -> None:
    col_map = {
        'goals':         'proj_points',
        'assists':       'proj_assists',
        'points':        'proj_pra',
        'shots_on_goal': 'proj_rebounds',
        'saves':         'proj_steals',
        'goals_against': 'proj_blocks',
        'toi':           'proj_minutes',
        'plus_minus':    'proj_points',
    }
    proj_col = col_map.get(prop_type, 'proj_points')

    # Gate on market line from player_props_history — skip if no line posted
    line = get_market_line(conn, player_name, prop_type, game_date)
    if line is None:
        return  # No market line for this prop — not a tradeable market today

    # Only write picks with meaningful edge vs the posted line
    edge = round(proj_value - line, 2)
    threshold = NHL_MIN_EDGE.get(prop_type, 0.3)
    if abs(edge) < threshold:
        return  # Edge too small — not a pick

    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""INSERT INTO chalk_projections
                       (player_id, player_name, team, opponent, sport, game_date,
                        prop_type, proj_value, {proj_col},
                        confidence_score, factors_json, model_version)
                    VALUES (%s,%s,%s,%s,'NHL',%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (player_id, game_date, prop_type)
                    DO UPDATE SET
                       proj_value      = EXCLUDED.proj_value,
                       {proj_col}      = EXCLUDED.{proj_col},
                       confidence_score = EXCLUDED.confidence_score,
                       factors_json    = EXCLUDED.factors_json,
                       model_version   = EXCLUDED.model_version,
                       updated_at      = NOW()""",
                (player_id, player_name, team, opponent, game_date,
                 prop_type, proj_value, proj_value,
                 confidence, json.dumps(factors), MODEL_VERSION)
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        log.warning(f'[upsert_player_projection] {player_name} {prop_type}: {e}')


def upsert_team_projection(conn, team_name: str, opponent: str, game_date: date,
                            prop_type: str, proj_value: float,
                            factors: dict, confidence: int = 65) -> None:
    proj_total = factors.get('proj_total')         if prop_type == 'total'           else None
    over_prob  = factors.get('over_probability')   if prop_type == 'total'           else None
    under_prob = factors.get('under_probability')  if prop_type == 'total'           else None
    win_prob   = float(proj_value)                 if prop_type == 'moneyline'       else None
    cover_prob = float(proj_value)                 if prop_type in ('puck_line_cover', 'spread') else None
    proj_pts   = factors.get('proj_home_score')    if prop_type == 'moneyline'       else None

    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO team_projections
                      (team_name, opponent, sport, game_date, prop_type,
                       proj_value, proj_total, over_probability, under_probability,
                       win_probability, spread_cover_probability,
                       proj_points, confidence_score, factors_json, model_version)
                   VALUES (%s,%s,'NHL',%s,%s,%s, %s,%s,%s,%s,%s,%s,%s, %s,%s)
                   ON CONFLICT (team_name, game_date, prop_type)
                   DO UPDATE SET
                      proj_value               = EXCLUDED.proj_value,
                      proj_total               = EXCLUDED.proj_total,
                      over_probability         = EXCLUDED.over_probability,
                      under_probability        = EXCLUDED.under_probability,
                      win_probability          = EXCLUDED.win_probability,
                      spread_cover_probability = EXCLUDED.spread_cover_probability,
                      proj_points              = EXCLUDED.proj_points,
                      confidence_score         = EXCLUDED.confidence_score,
                      factors_json             = EXCLUDED.factors_json,
                      model_version            = EXCLUDED.model_version,
                      updated_at               = NOW()""",
                (team_name, opponent, game_date,
                 prop_type, proj_value,
                 proj_total, over_prob, under_prob,
                 win_prob, cover_prob,
                 proj_pts, confidence,
                 json.dumps(factors), MODEL_VERSION)
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        log.warning(f'[upsert_team_projection] {team_name} {prop_type}: {e}')


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk NHL Projection Model v2.0')
    parser.add_argument('--date', default=str(date.today()),
                        help='Game date YYYY-MM-DD (default: today)')
    args = parser.parse_args()
    game_date = date.fromisoformat(args.date)

    log.info('═══════════════════════════════════════════════════')
    log.info(f'Chalk NHL Projection Model v2.0 — {game_date}')
    log.info('═══════════════════════════════════════════════════')

    conn = get_db()

    # ── Step 1: Schedule ──────────────────────────────────────────────────────
    log.info('\n▶ STEP 1: Fetching NHL schedule')
    games = get_todays_games(game_date)
    if not games:
        log.info('  No NHL games today. Exiting.')
        conn.close()
        return
    log.info(f'  Found {len(games)} games')

    player_count = 0
    team_count   = 0

    for game in games:
        home = game['home_team']
        away = game['away_team']
        log.info(f'\n--- {away} @ {home} ---')

        # ── Step 2: Confirm starting goalies ─────────────────────────────────
        log.info('  ▶ STEP 2: Goalie confirmation')
        goalie_info    = confirm_starting_goalie(game['game_id']) if game.get('game_id') else {}
        home_is_backup = goalie_info.get('home_is_backup', False)
        away_is_backup = goalie_info.get('away_is_backup', False)
        goalie_confirmed = goalie_info.get('confirmed', False)

        home_goalie_info = get_team_goalie(conn, home)
        away_goalie_info = get_team_goalie(conn, away)
        home_goalie_logs = get_goalie_logs(conn, home_goalie_info['player_id']) if home_goalie_info else []
        away_goalie_logs = get_goalie_logs(conn, away_goalie_info['player_id']) if away_goalie_info else []

        if home_is_backup:
            log.warning(f'  ⚠️  BACKUP STARTING: {home}')
        if away_is_backup:
            log.warning(f'  ⚠️  BACKUP STARTING: {away}')

        # ── Step 3: Odds API ──────────────────────────────────────────────────
        log.info('  ▶ STEP 3: Fetching live odds')
        odds = fetch_game_odds(home, away)
        home_ml      = odds.get('home_ml')
        away_ml      = odds.get('away_ml')
        puck_line    = odds.get('home_puck_line')
        implied_total = odds.get('implied_total', LEAGUE['nhl_total'])
        posted_total  = odds.get('posted_total',  LEAGUE['nhl_total'])
        if odds.get('home_ml'):
            log.info(f'  Odds: home_ml={home_ml} away_ml={away_ml} total={posted_total}')

        # ── Step 3a: Team logs + B2B check ───────────────────────────────────
        home_tl = get_team_logs(conn, home)
        away_tl = get_team_logs(conn, away)
        home_last  = home_tl[0].get('game_date') if home_tl else None
        away_last  = away_tl[0].get('game_date') if away_tl else None
        home_rest  = (game_date - home_last).days if home_last else 3
        away_rest  = (game_date - away_last).days if away_last else 3
        home_b2b   = home_rest <= 1
        away_b2b   = away_rest <= 1

        # ── Step 4: Injuries from nightly_roster ─────────────────────────────
        home_roster_rows = get_nightly_roster(conn, home, game_date)
        away_roster_rows = get_nightly_roster(conn, away, game_date)
        home_injury_ctx  = get_injury_context(home_roster_rows)
        away_injury_ctx  = get_injury_context(away_roster_rows)
        if home_injury_ctx['forwards_out']:
            log.info(f'  Injuries {home}: {home_injury_ctx["forwards_out"]} fwds out')
        if away_injury_ctx['forwards_out']:
            log.info(f'  Injuries {away}: {away_injury_ctx["forwards_out"]} fwds out')

        # ── Step 5–10: Skater projections ─────────────────────────────────────
        log.info('  ▶ STEPS 5-10: Skater projections')
        for side, team_abbr, opp_abbr, own_tl, opp_tl, \
            opp_goalie_logs, opp_is_backup, team_b2b, injury_ctx, \
            team_ml, opp_ml in [
            (
                'home', home, away, home_tl, away_tl,
                away_goalie_logs, away_is_backup, home_b2b, home_injury_ctx,
                home_ml, away_ml,
            ),
            (
                'away', away, home, away_tl, home_tl,
                home_goalie_logs, home_is_backup, away_b2b, away_injury_ctx,
                away_ml, home_ml,
            ),
        ]:
            roster = get_team_roster(team_abbr)
            all_skaters = roster.get('forwards', [])[:12] + \
                          roster.get('defensemen', [])[:6]

            gs_f = game_script_factor_from_odds(home_ml, away_ml, side == 'home')

            for player in all_skaters:
                pid   = player.get('id')
                pname = (
                    player.get('firstName', {}).get('default', '') + ' ' +
                    player.get('lastName',  {}).get('default', '')
                ).strip()
                pos = player.get('positionCode', '')
                if not pid:
                    continue

                logs = get_skater_logs(conn, pid)
                if len(logs) < 3:
                    continue

                rest_days = get_rest_days(conn, pid, game_date)
                is_b2b    = rest_days <= 1

                # Step 5: TOI (FIRST — feeds everything)
                toi_proj, toi_f = project_toi(logs, side, is_b2b, injury_ctx)
                pp_toi_proj = toi_f.get('proj_pp_toi', 0.0)

                upsert_player_projection(
                    conn, pid, pname, team_abbr, opp_abbr, game_date,
                    'toi', toi_proj,
                    compute_confidence('toi', 0, player_games=len(logs)),
                    toi_f
                )

                # Step 6: SOG
                sog_proj, sog_f = project_shots_on_goal(
                    logs, opp_tl, side, toi_proj, pp_toi_proj, is_b2b, gs_f
                )
                pp_toi_l10 = get_avg_pp_toi(logs, 10)
                conf_sog = compute_confidence(
                    'shots_on_goal',
                    edge_pct=(sog_proj - LEAGUE['sog_pg']) / LEAGUE['sog_pg'],
                    backup_starting=opp_is_backup,
                    player_games=len(logs),
                    pp_toi=pp_toi_l10,
                    sog_rate_extreme=sog_f.get('rate_f', 1.0) > 1.30,
                    opp_b2b=(opp_tl[0].get('game_date') is not None and
                             (game_date - opp_tl[0]['game_date']).days <= 1
                             if opp_tl else False),
                    goalie_confirmed=goalie_confirmed,
                )
                upsert_player_projection(
                    conn, pid, pname, team_abbr, opp_abbr, game_date,
                    'shots_on_goal', sog_proj, conf_sog + 5, sog_f  # SOG +5 confidence bonus
                )

                # Step 7: Goals
                g_proj, g_f = project_goals(
                    logs, opp_goalie_logs, opp_tl, side,
                    toi_proj, opp_is_backup, is_b2b
                )
                conf_g = compute_confidence(
                    'goals',
                    edge_pct=(g_proj - LEAGUE['goals_pg']) / LEAGUE['goals_pg'],
                    backup_starting=opp_is_backup,
                    opp_goalie_cold=g_f.get('opp_sv_l10', LEAGUE['sv_pct']) < 0.895,
                    player_games=len(logs),
                    pp_toi=pp_toi_l10,
                    pp_matchup_fav=opp_is_backup,
                    goalie_confirmed=goalie_confirmed,
                    opp_goalie_tbd=not goalie_confirmed,
                )
                upsert_player_projection(
                    conn, pid, pname, team_abbr, opp_abbr, game_date,
                    'goals', g_proj, conf_g, g_f
                )

                # Step 8: Assists
                a_proj, a_f = project_assists(
                    logs, opp_tl, own_tl, side, toi_proj, is_b2b,
                    injury_ctx, opp_goalie_logs
                )
                conf_a = compute_confidence(
                    'assists',
                    edge_pct=(a_proj - LEAGUE['assists_pg']) / LEAGUE['assists_pg'],
                    backup_starting=opp_is_backup,
                    player_games=len(logs),
                    pp_toi=pp_toi_l10,
                    pp_matchup_fav=pp_toi_l10 > 3.5 and opp_is_backup,
                    goalie_confirmed=goalie_confirmed,
                )
                upsert_player_projection(
                    conn, pid, pname, team_abbr, opp_abbr, game_date,
                    'assists', a_proj, conf_a, a_f
                )

                # Step 9: Points
                p_proj, p_f = project_points(
                    logs, g_proj, a_proj, toi_proj, implied_total
                )
                conf_p = compute_confidence(
                    'points',
                    edge_pct=(p_proj - LEAGUE['points_pg']) / LEAGUE['points_pg'],
                    backup_starting=opp_is_backup,
                    player_games=len(logs),
                    pp_toi=pp_toi_l10,
                    goalie_confirmed=goalie_confirmed,
                )
                upsert_player_projection(
                    conn, pid, pname, team_abbr, opp_abbr, game_date,
                    'points', p_proj, conf_p, p_f
                )

                # Step 10: Plus/Minus
                pm_proj, pm_f = project_plus_minus(
                    logs, opp_tl, own_tl, side, toi_proj, puck_line
                )
                blowout = pm_f.get('blowout_risk', False)
                conf_pm = compute_confidence(
                    'plus_minus',
                    edge_pct=pm_proj / max(1.0, abs(pm_proj) + 1.0),
                    player_games=len(logs),
                    goalie_confirmed=goalie_confirmed,
                    blowout_risk=blowout,
                )
                upsert_player_projection(
                    conn, pid, pname, team_abbr, opp_abbr, game_date,
                    'plus_minus', pm_proj, conf_pm, pm_f
                )

                log.info(
                    f'    [{side}] {pname} ({pos}) '
                    f'G={g_proj:.2f} A={a_proj:.2f} P={p_proj:.2f} '
                    f'SOG={sog_proj:.2f} TOI={toi_proj:.1f} PM={pm_proj:+.2f}'
                )
                player_count += 1

        # ── Steps 11–12: Goalie projections ───────────────────────────────────
        log.info('  ▶ STEPS 11-12: Goalie projections')
        for g_info, g_logs, team_abbr, opp_abbr, opp_tl, is_backup, g_loc in [
            (home_goalie_info, home_goalie_logs, home, away, away_tl, home_is_backup, 'home'),
            (away_goalie_info, away_goalie_logs, away, home, home_tl, away_is_backup, 'away'),
        ]:
            if not g_info:
                continue
            gid    = g_info['player_id']
            gname  = g_info['player_name']
            g_rest = get_rest_days(conn, gid, game_date)
            g_b2b  = g_rest <= 1

            # Saves
            sv_proj, sv_f = project_saves(
                g_logs, opp_tl, g_loc, g_b2b, g_rest, is_backup
            )
            # Apply game total factor to saves
            if implied_total < 5.5:
                sv_f['game_total_f'] = 1.08
                sv_proj = round(sv_proj * 1.08, 2)
            elif implied_total > 7.0:
                sv_f['game_total_f'] = 0.94
                sv_proj = round(sv_proj * 0.94, 2)

            conf_sv = compute_confidence(
                'saves',
                edge_pct=(sv_proj - LEAGUE['saves_pg']) / LEAGUE['saves_pg'],
                backup_starting=is_backup,
                player_games=len(g_logs),
                goalie_confirmed=goalie_confirmed,
                opp_b2b=(opp_tl[0].get('game_date') is not None and
                         (game_date - opp_tl[0]['game_date']).days <= 1
                         if opp_tl else False),
            )
            upsert_player_projection(
                conn, gid, gname, team_abbr, opp_abbr, game_date,
                'saves', sv_proj, conf_sv, {**sv_f, 'goalie_confirmed': goalie_confirmed}
            )

            # Goals against
            ga_proj, ga_f = project_goals_against(g_logs, opp_tl, g_loc, is_backup)
            conf_ga = compute_confidence(
                'goals_against',
                edge_pct=(ga_proj - LEAGUE['ga_pg']) / LEAGUE['ga_pg'],
                backup_starting=is_backup,
                player_games=len(g_logs),
                goalie_confirmed=goalie_confirmed,
            )
            upsert_player_projection(
                conn, gid, gname, team_abbr, opp_abbr, game_date,
                'goals_against', ga_proj, conf_ga, ga_f
            )

            # SV% (derived)
            proj_shots_against = sv_proj + ga_proj
            sv_pct_proj = (sv_proj / proj_shots_against) if proj_shots_against > 0 else LEAGUE['sv_pct']
            upsert_player_projection(
                conn, gid, gname, team_abbr, opp_abbr, game_date,
                'sv_pct', round(sv_pct_proj, 4), conf_sv,
                {'proj_saves': sv_proj, 'proj_ga': ga_proj,
                 'proj_shots_against': round(proj_shots_against, 2),
                 'backup_starting': is_backup}
            )

            star = '⭐BACKUP' if is_backup else ''
            log.info(f'    [{g_loc} G{star}] {gname}: SV={sv_proj:.1f} GA={ga_proj:.2f} SV%={sv_pct_proj:.3f}')
            player_count += 1

        # ── Step 13: Team projections ──────────────────────────────────────────
        log.info('  ▶ STEP 13: Team projections')

        # Total
        proj_total, total_f = project_total(
            home_tl, away_tl, home_goalie_logs, away_goalie_logs,
            home_is_backup, away_is_backup, home_b2b, away_b2b,
            home_injury_ctx, away_injury_ctx,
            posted_total, conn, home, away,
        )

        # Moneyline
        home_win, ml_f = project_moneyline(
            home_tl, away_tl, home_goalie_logs, away_goalie_logs,
            home_is_backup, away_is_backup, home_rest, away_rest,
        )

        proj_home_r = total_f.get('proj_home_goals', 3.0)
        proj_away_r = total_f.get('proj_away_goals', 3.0)

        # Puck line
        home_cover, hl_f, away_cover, al_f = project_puck_line(
            proj_home_r, proj_away_r,
            home_goalie_logs, away_goalie_logs,
            home_tl, away_tl,
            home_is_backup, away_is_backup,
            home_rest, away_rest, home_ml,
        )

        # Team confidence
        team_conf = 60
        if len(home_tl) >= 15 and len(away_tl) >= 15: team_conf = 68
        elif len(home_tl) >= 8 and len(away_tl) >= 8:  team_conf = 65
        if home_goalie_logs and away_goalie_logs:       team_conf = min(75, team_conf + 5)
        if home_is_backup or away_is_backup:            team_conf = min(82, team_conf + 15)

        upsert_team_projection(conn, home, away, game_date, 'total',           proj_total, total_f, team_conf)
        upsert_team_projection(conn, home, away, game_date, 'moneyline',        home_win,   ml_f,   team_conf)
        upsert_team_projection(conn, home, away, game_date, 'puck_line_cover',  home_cover, hl_f,   team_conf)
        upsert_team_projection(conn, away, home, game_date, 'puck_line_cover',  away_cover, al_f,   team_conf)

        log.info(
            f'    Total={proj_total:.2f} (over={total_f["over_probability"]:.1%}) '
            f'home_win={home_win:.1%} home_cover={home_cover:.1%} '
            f'away_cover(+1.5+OT)={away_cover:.1%}'
        )
        team_count += 2

    conn.close()
    log.info('\n═══════════════════════════════════════════════════')
    log.info(f'NHL v2.0 complete — {player_count} player projections, {team_count} team projections')
    log.info('═══════════════════════════════════════════════════')


if __name__ == '__main__':
    main()
