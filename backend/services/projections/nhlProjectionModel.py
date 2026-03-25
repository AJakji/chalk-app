"""
Chalk NHL Projection Model
==========================
Morning script (runs at 10:30 AM) that generates player and team projections
for every NHL game tonight. Reads historical data from our PostgreSQL database
(populated by nhlDataCollector.py) and writes projections to chalk_projections
and team_projections tables.

The model uses a multi-factor weighted approach:
  1. Weighted rolling average (L10 × 0.40, L20 × 0.30, L30 × 0.20, season × 0.10)
  2. Goalie quality matchup (MOST IMPORTANT signal in NHL betting)
  3. Special teams (PP/PK) matchup via PP TOI per game
  4. TOI line proxy (top/2nd/3rd/4th line role)
  5. Shot quality proxy (opponent team SH% allowed)
  6. EV goals vs PP goals split for goal projection
  7. Rest and back-to-back
  8. Game script (spread size)

CRITICAL: Confirmed starting goalie is the single most important variable.
Backup goalie detected → flag immediately, adjust all projections, add +15 confidence.

All factor multipliers stored in factors_json for full audit trail.

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
from dotenv import load_dotenv

try:
    from nhl_api_py.core import NHLClient
    _nhl = NHLClient()
except ImportError:
    _nhl = None

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

DATABASE_URL   = os.getenv('DATABASE_URL', '')
MODEL_VERSION  = 'v1.1'
CURRENT_SEASON = '20252026'

# League-average baselines — calibrated to 2024-25 NHL season
LEAGUE_AVG = {
    'goals_per_game':         0.30,
    'assists_per_game':       0.50,
    'points_per_game':        0.80,
    'sog_per_game':           2.8,
    'hits_per_game':          1.8,
    'blocks_per_game':        0.9,
    'pim_per_game':           0.7,
    'toi_per_game':           15.5,
    'pp_toi_per_game':        1.2,
    'shooting_pct':           0.105,
    'sv_pct':                 0.900,
    'gsaa_per_game':          0.0,
    'hd_sv_pct':              0.830,
    'saves_per_game':         27.5,
    'goals_against_per_game': 3.0,
    'shots_against_per_game': 30.5,
    'xgf_per_game':           2.8,
    'xga_per_game':           2.8,
    'cf_pct':                 50.0,
    'pp_pct':                 0.205,
    'pk_pct':                 0.795,
    'faceoff_pct':            50.0,
    'team_goals_per_game':    3.0,
    'home_win_pct':           0.54,
    'ot_probability':         0.24,
}

TOTAL_STD_DEV     = 1.5
PUCK_LINE_STD_DEV = 1.4


# ── DB connection ──────────────────────────────────────────────────────────────

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


# ── Normal CDF (no scipy dependency) ─────────────────────────────────────────

def normal_cdf(x, mu=0.0, sigma=1.0):
    """Standard normal CDF using math.erf."""
    if sigma <= 0:
        return 0.5
    return 0.5 * (1.0 + math.erf((x - mu) / (sigma * math.sqrt(2.0))))


# ── Rolling average calculations ──────────────────────────────────────────────

def rolling_avg(rows: list[dict], col: str, n: int) -> float:
    vals = [safe(r[col]) for r in rows[:n] if r.get(col) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def weighted_avg(rows: list[dict], col: str) -> float:
    """
    NHL weighted rolling average:
      L10 × 0.40 + L20 × 0.30 + L30 × 0.20 + season × 0.10
    Falls back gracefully when fewer games exist.
    """
    n = len(rows)
    if n == 0:
        return 0.0
    l10 = rolling_avg(rows, col, min(10, n))
    l20 = rolling_avg(rows, col, min(20, n))
    l30 = rolling_avg(rows, col, min(30, n))
    szn = rolling_avg(rows, col, n)

    if n >= 30:
        return l10 * 0.40 + l20 * 0.30 + l30 * 0.20 + szn * 0.10
    elif n >= 20:
        return l10 * 0.50 + l20 * 0.35 + szn * 0.15
    elif n >= 10:
        return l10 * 0.65 + szn * 0.35
    else:
        return szn


def home_away_avg(rows: list[dict], col: str, location: str) -> float:
    filtered = [r for r in rows if r.get('home_away') == location]
    return rolling_avg(filtered, col, len(filtered)) if filtered else 0.0


# ── DB queries ─────────────────────────────────────────────────────────────────

def get_skater_logs(conn, player_id: int, limit: int = 50) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'NHL' AND season = %s
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_goalie_logs(conn, player_id: int, limit: int = 30) -> list[dict]:
    """Only returns games where the goalie actually played (saves > 0)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'NHL' AND season = %s
                 AND steals > 0
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_team_logs(conn, team_abbr: str, limit: int = 20) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT *,
                      points_scored  AS points_scored,
                      points_allowed AS points_allowed
               FROM team_game_logs
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
            """SELECT player_id, player_name, COUNT(*) as starts,
                      AVG(steals)  as avg_saves,
                      AVG(fg_pct)  as avg_sv_pct,
                      AVG(off_reb) as avg_gsaa
               FROM player_game_logs
               WHERE team = %s AND sport = 'NHL' AND season = %s
                 AND position = 'G' AND steals > 0
               GROUP BY player_id, player_name
               ORDER BY starts DESC LIMIT 1""",
            (team_abbr, CURRENT_SEASON)
        )
        row = cur.fetchone()
        return dict(row) if row else None


def classify_player_archetype(base_goals: float, base_assists: float) -> tuple[str, float]:
    """
    Classify a skater's archetype based on season scoring rates.
    Returns (archetype_name, correlation_factor) for points projection.
    """
    if base_goals > 0.40 and base_assists > 0.40:
        return ('TRUE_POINT_PRODUCER', 1.00)   # Draisaitl, MacKinnon — stats move together
    if base_goals > 0.40 and base_assists < 0.35:
        return ('GOAL_SCORER', 0.96)            # pure goal scorers
    if base_assists > 0.45 and base_goals < 0.20:
        return ('PURE_PLAYMAKER', 0.98)         # playmakers, PP QB D-men
    return ('ROLE_PLAYER', 0.97)


# ── NHL API helpers ────────────────────────────────────────────────────────────

def nhl_get(path: str) -> Optional[dict]:
    import requests as _req
    url = f'https://api-web.nhle.com/v1{path}'
    try:
        r = _req.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning(f'NHL API failed {path}: {e}')
        return None


def get_todays_games(game_date: date) -> list[dict]:
    data = nhl_get(f'/schedule/{game_date}')
    if not data:
        return []
    target = str(game_date)
    games  = []
    for week in data.get('gameWeek', []):
        if week.get('date', '') != target:
            continue   # only return games on the exact requested date
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
    """Return {'forwards': [...], 'defensemen': [...], 'goalies': [...]}"""
    data = nhl_get(f'/roster/{team_abbr}/current')
    if not data:
        return {'forwards': [], 'defensemen': [], 'goalies': []}
    return {
        'forwards':   data.get('forwards', []),
        'defensemen': data.get('defensemen', []),
        'goalies':    data.get('goalies', []),
    }


def confirm_starting_goalie(game_id: int) -> dict:
    """
    Check NHL API for confirmed starters via pre-game boxscore.
    Returns goalie info or empty dict if not yet available.
    """
    data = nhl_get(f'/gamecenter/{game_id}/boxscore')
    result = {
        'home_goalie_id': None, 'home_goalie_name': None, 'home_is_backup': False,
        'away_goalie_id': None, 'away_goalie_name': None, 'away_is_backup': False,
    }
    if not data:
        return result
    pbgs = data.get('playerByGameStats', {})
    for side in ('homeTeam', 'awayTeam'):
        goalies = pbgs.get(side, {}).get('goalies', [])
        prefix  = 'home' if side == 'homeTeam' else 'away'
        if goalies:
            g = goalies[0]
            result[f'{prefix}_goalie_id']   = g.get('playerId')
            first = g.get('firstName', {}).get('default', '')
            last  = g.get('lastName', {}).get('default', '')
            result[f'{prefix}_goalie_name'] = f'{first} {last}'.strip()
    return result


# ── Skater projection functions ────────────────────────────────────────────────

def project_goals(skater_logs: list[dict], opp_goalie_logs: list[dict],
                  opp_team_logs: list[dict], home_away: str,
                  toi_projection: float, backup_goalie: bool,
                  is_back_to_back: bool = False) -> tuple[float, dict]:
    """
    Goals projection using EV/PP split (0.65/0.35 weight).
    SOG rate and opp goalie SV% are the two highest-impact factors.
    """
    n = len(skater_logs)
    base = weighted_avg(skater_logs, 'points')   # goals in 'points' col
    if base == 0.0:
        base = LEAGUE_AVG['goals_per_game']
    factors = {'base': round(base, 4)}

    # EV/PP split — compute from real data (three_att = PP goals)
    pp_goals_avg = rolling_avg(skater_logs, 'three_att', min(20, n))
    ev_goals_avg = max(0.0, base - pp_goals_avg)
    factors['ev_goals_base'] = round(ev_goals_avg, 4)
    factors['pp_goals_base'] = round(pp_goals_avg, 4)

    # ── SOG rate factor (strongest EV driver) ────────────────────────────────
    sog_avg = weighted_avg(skater_logs, 'fg_made')
    sog_f   = (sog_avg / LEAGUE_AVG['sog_per_game']) if sog_avg > 0 else 1.0
    sog_f   = max(0.30, min(2.00, sog_f))   # wide range — Matthews vs 4th liner
    factors['sog_rate_f'] = round(sog_f, 4)

    # ── Shooting % trend (regression signal) ─────────────────────────────────
    # Compute sh% from actual goals/SOG stored in DB
    l10_goals = rolling_avg(skater_logs, 'points', min(10, n))
    l10_sog   = rolling_avg(skater_logs, 'fg_made', min(10, n))
    szn_goals = rolling_avg(skater_logs, 'points', n)
    szn_sog   = rolling_avg(skater_logs, 'fg_made', n)
    l10_sh_pct = (l10_goals / l10_sog) if l10_sog > 0 else 0.0
    szn_sh_pct = (szn_goals / szn_sog) if szn_sog > 0 else 0.0
    if szn_sh_pct > 0 and l10_sog >= 5:   # need enough sample
        if l10_sh_pct > szn_sh_pct + 0.03:
            sh_trend_f = 0.92   # hot shooter — regress
        elif l10_sh_pct < szn_sh_pct - 0.03:
            sh_trend_f = 1.08   # cold shooter — expect surge
        else:
            sh_trend_f = 1.0
    else:
        sh_trend_f = 1.0
    factors['sh_trend_f'] = round(sh_trend_f, 4)

    # ── Opp goalie SV% factor (most impactful matchup signal) ────────────────
    opp_sv = rolling_avg(opp_goalie_logs, 'fg_pct', min(10, len(opp_goalie_logs)))
    if opp_sv > 0:
        goalie_f = (1.0 - LEAGUE_AVG['sv_pct']) / (1.0 - opp_sv)
        goalie_f = max(0.60, min(1.60, goalie_f))
    else:
        goalie_f = 1.0
    if backup_goalie:
        goalie_f = max(goalie_f, 1.30)
        factors['backup_goalie_detected'] = True
    factors['goalie_sv_f'] = round(goalie_f, 4)

    # ── PP TOI factor (modulation on pp_goals_avg component) ─────────────────
    # pp_goals_avg already captures PP scoring from real data.
    # pp_f is a soft adjustment: detects if the player is above/below-average PP
    # deployment and nudges the PP component accordingly.
    pp_toi_avg = rolling_avg(skater_logs, 'fg_att', min(20, n))
    if pp_toi_avg > 0:
        pp_ratio = pp_toi_avg / LEAGUE_AVG['pp_toi_per_game']
        pp_f = 1.0 + (pp_ratio - 1.0) * 0.25  # 25% weight: prevents double-counting
    else:
        pp_f = 1.0
    pp_f = max(0.60, min(1.60, pp_f))   # EV-only → ~0.75; elite PP QB → ~1.60 max
    factors['pp_toi_f'] = round(pp_f, 4)

    # ── Opp PK quality proxy ──────────────────────────────────────────────────
    # Approximate opp PK% from steals (blocked shots) in team_game_logs
    # Passive PK (high shots allowed on PP) = weaker PK
    opp_ga_from_team = rolling_avg(opp_team_logs, 'points_allowed', 10)
    if opp_ga_from_team > LEAGUE_AVG['team_goals_per_game'] * 1.08:
        opp_pk_f = 1.12   # soft PK
    elif opp_ga_from_team > 0 and opp_ga_from_team < LEAGUE_AVG['team_goals_per_game'] * 0.92:
        opp_pk_f = 0.88   # stout PK
    else:
        opp_pk_f = 1.0
    factors['opp_pk_f'] = round(opp_pk_f, 4)

    # ── Opp goals allowed ─────────────────────────────────────────────────────
    opp_ga_avg = rolling_avg(opp_team_logs, 'points_allowed', 10)
    opp_goals_f = (opp_ga_avg / LEAGUE_AVG['team_goals_per_game']) if opp_ga_avg > 0 else 1.0
    opp_goals_f = max(0.75, min(1.30, opp_goals_f))
    factors['opp_goals_allowed_f'] = round(opp_goals_f, 4)

    # ── TOI line proxy ────────────────────────────────────────────────────────
    season_toi = weighted_avg(skater_logs, 'minutes')
    toi_f = (toi_projection / season_toi) if season_toi > 0 and toi_projection > 0 else 1.0
    toi_f = max(0.70, min(1.30, toi_f))
    factors['toi_f'] = round(toi_f, 4)

    # ── Home/away split ───────────────────────────────────────────────────────
    home_avg = home_away_avg(skater_logs, 'points', 'home')
    away_avg = home_away_avg(skater_logs, 'points', 'away')
    if home_avg > 0 and away_avg > 0 and home_away in ('home', 'away'):
        loc_f = (home_avg / away_avg) if home_away == 'home' else (away_avg / home_avg)
        loc_f = max(0.85, min(1.15, loc_f))
    else:
        loc_f = 1.0
    factors['home_away_f'] = round(loc_f, 4)

    # ── Back-to-back ──────────────────────────────────────────────────────────
    b2b_f = 0.93 if is_back_to_back else 1.0
    factors['b2b_f'] = b2b_f

    # ── EV/PP weighted formula (0.65 EV / 0.35 PP) ───────────────────────────
    if base > 0:
        ev_proj = ev_goals_avg * sog_f * goalie_f * sh_trend_f * toi_f * loc_f * b2b_f
        pp_proj = pp_goals_avg * pp_f  * goalie_f * opp_pk_f   * toi_f
        projection = (ev_proj * 0.65 + pp_proj * 0.35) * opp_goals_f
    else:
        projection = 0.0

    projection = max(0.0, round(projection, 4))
    factors['projection'] = projection
    return projection, factors


def project_assists(skater_logs: list[dict], opp_team_logs: list[dict],
                    home_away: str, toi_projection: float,
                    is_back_to_back: bool = False) -> tuple[float, dict]:
    """
    Assists is the most consistent NHL prop — less random than goals.
    PP TOI drives assist opportunities heavily for elite playmakers.
    """
    n = len(skater_logs)
    base = weighted_avg(skater_logs, 'three_made')   # assists in three_made col
    if base == 0.0:
        base = LEAGUE_AVG['assists_per_game']
    factors = {'base': round(base, 4)}

    # ── TOI factor ────────────────────────────────────────────────────────────
    season_toi = weighted_avg(skater_logs, 'minutes')
    toi_f = (toi_projection / season_toi) if season_toi > 0 and toi_projection > 0 else 1.0
    toi_f = max(0.80, min(1.20, toi_f))
    factors['toi_f'] = round(toi_f, 4)

    # ── TOI line proxy ────────────────────────────────────────────────────────
    if season_toi > 18:
        toi_line_f = 1.10
    elif season_toi >= 15:
        toi_line_f = 1.00
    elif season_toi >= 12:
        toi_line_f = 0.95
    else:
        toi_line_f = 0.85
    factors['toi_line_f'] = round(toi_line_f, 4)

    # ── PP assist factor (40% weight — PP assists dominate for pure playmakers) ──
    pp_toi_avg = rolling_avg(skater_logs, 'fg_att', min(20, n))
    if pp_toi_avg > 0:
        # Raw ratio then weighted at 40%
        pp_ratio = pp_toi_avg / LEAGUE_AVG['pp_toi_per_game']
        pp_f = 1.0 + (pp_ratio - 1.0) * 0.40
        pp_f = max(0.80, min(1.35, pp_f))
    else:
        pp_f = 1.0
    factors['pp_assist_f'] = round(pp_f, 4)

    # ── Linemate scoring proxy ────────────────────────────────────────────────
    # Assists require teammates to score. Use opp GA as proxy for open game.
    opp_ga_avg = rolling_avg(opp_team_logs, 'points_allowed', 10)
    if opp_ga_avg > LEAGUE_AVG['team_goals_per_game'] + 0.5:
        linemate_f = 1.06   # soft team = more total goals = more assists available
    elif opp_ga_avg > 0 and opp_ga_avg < LEAGUE_AVG['team_goals_per_game'] - 0.5:
        linemate_f = 0.94
    else:
        linemate_f = 1.0
    factors['linemate_proxy_f'] = round(linemate_f, 4)

    # ── Home/away split ───────────────────────────────────────────────────────
    home_avg = home_away_avg(skater_logs, 'three_made', 'home')
    away_avg = home_away_avg(skater_logs, 'three_made', 'away')
    if home_avg > 0 and away_avg > 0 and home_away in ('home', 'away'):
        loc_f = (home_avg / away_avg) if home_away == 'home' else (away_avg / home_avg)
        loc_f = max(0.85, min(1.15, loc_f))
    else:
        loc_f = 1.0
    factors['home_away_f'] = round(loc_f, 4)

    # ── Back-to-back ──────────────────────────────────────────────────────────
    b2b_f = 0.94 if is_back_to_back else 1.0
    factors['b2b_f'] = b2b_f

    projection = base * toi_f * toi_line_f * pp_f * linemate_f * loc_f * b2b_f
    projection = max(0.0, round(projection, 4))
    factors['projection'] = projection
    return projection, factors


def project_points(skater_logs: list[dict], opp_goalie_logs: list[dict],
                   opp_team_logs: list[dict], home_away: str,
                   toi_projection: float, backup_goalie: bool,
                   proj_goals: float, proj_assists: float) -> tuple[float, dict]:
    """
    Points = proj_goals + proj_assists with archetype correlation adjustment.
    Archetype classification separates elite point producers from specialists.
    """
    n = len(skater_logs)
    base_goals  = rolling_avg(skater_logs, 'points',     n)
    base_assists = rolling_avg(skater_logs, 'three_made', n)
    archetype, corr_f = classify_player_archetype(base_goals, base_assists)

    base_sum = proj_goals + proj_assists
    factors = {
        'goals_component':  round(proj_goals,   4),
        'assists_component': round(proj_assists, 4),
        'archetype':        archetype,
        'corr_f':           corr_f,
    }

    # PP points factor — separates elite PP players from EV-only dramatically
    pp_toi_avg = rolling_avg(skater_logs, 'fg_att', min(20, n))
    if pp_toi_avg > 0:
        pp_pts_f = pp_toi_avg / LEAGUE_AVG['pp_toi_per_game']
        pp_pts_f = 1.0 + (pp_pts_f - 1.0) * 0.35   # 35% weight on PP contribution
        pp_pts_f = max(0.82, min(1.38, pp_pts_f))
    else:
        pp_pts_f = 1.0
    factors['pp_pts_f'] = round(pp_pts_f, 4)

    # Game total factor — higher scoring games = more total points available
    opp_ga = rolling_avg(opp_team_logs, 'points_allowed', 10)
    if opp_ga > 0:
        total_f = 0.5 * (opp_ga / LEAGUE_AVG['team_goals_per_game']) + 0.5
        total_f = max(0.92, min(1.08, total_f))
    else:
        total_f = 1.0
    if backup_goalie:
        total_f = min(1.10, total_f * 1.08)
        factors['backup_goalie_detected'] = True
    factors['game_total_f'] = round(total_f, 4)

    # pp_pts_f is already embedded in proj_goals and proj_assists — don't re-apply
    # Only corr_f (archetype) and total_f (game environment) are truly additive here
    projection = base_sum * corr_f * total_f
    projection = max(0.0, round(projection, 4))
    factors['projection'] = projection
    return projection, factors


def project_shots_on_goal(skater_logs: list[dict], opp_team_logs: list[dict],
                           home_away: str, toi_projection: float,
                           is_trailing: bool = False) -> tuple[float, dict]:
    """
    SOG is the most consistent NHL prop — lowest variance, tightest correlation with TOI.
    All factors now read from real data (fg_made = SOG, minutes = TOI, fg_att = PP TOI).
    """
    base = weighted_avg(skater_logs, 'fg_made')    # SOG in fg_made col
    if base == 0.0:
        base = LEAGUE_AVG['sog_per_game']
    factors = {'base': round(base, 4)}

    # TOI factor — primary driver: more ice time = more shots (strongest signal)
    season_toi = weighted_avg(skater_logs, 'minutes')
    if season_toi > 0 and toi_projection > 0:
        toi_f = toi_projection / season_toi
        toi_f = max(0.80, min(1.20, toi_f))
    else:
        toi_f = 1.0
    factors['toi_f'] = round(toi_f, 4)

    # Shot attempt rate per minute — differentiates high-volume shooters from passers
    # sog_per_min for this player vs league average 0.156 (2.8/18)
    LEAGUE_SOG_PER_MIN = 0.156
    if season_toi > 0 and base > 0:
        player_sog_per_min = base / season_toi
        shot_rate_f = player_sog_per_min / LEAGUE_SOG_PER_MIN
        shot_rate_f = max(0.65, min(1.55, shot_rate_f))
    else:
        shot_rate_f = 1.0
    factors['shot_rate_f'] = round(shot_rate_f, 4)

    # PP SOG factor — PP creates disproportionate shot volume per minute
    pp_toi_avg = rolling_avg(skater_logs, 'fg_att', min(20, len(skater_logs)))
    if pp_toi_avg > 0:
        # Weight PP contribution at 25% of total shot volume
        pp_sog_bonus = (pp_toi_avg / LEAGUE_AVG['pp_toi_per_game'] - 1.0) * 0.25
        pp_sog_f = 1.0 + pp_sog_bonus
        pp_sog_f = max(0.90, min(1.15, pp_sog_f))
    else:
        pp_sog_f = 1.0
    factors['pp_sog_f'] = round(pp_sog_f, 4)

    # Opponent shots allowed (passive defence = more SOG opportunities)
    # Read from team_game_logs; fall back gracefully if not populated
    opp_shots_allowed = rolling_avg(opp_team_logs, 'shots_for', 10)
    if opp_shots_allowed > LEAGUE_AVG['shots_against_per_game'] + 3:
        opp_passive_f = 1.08
    elif opp_shots_allowed > 0 and opp_shots_allowed < LEAGUE_AVG['shots_against_per_game'] - 3:
        opp_passive_f = 0.93
    else:
        opp_passive_f = 1.0
    factors['opp_passive_f'] = round(opp_passive_f, 4)

    # Game script: trailing teams shoot more desperately
    script_f = 1.10 if is_trailing else 1.0
    factors['script_f'] = script_f

    # Home/away split
    home_avg = home_away_avg(skater_logs, 'fg_made', 'home')
    away_avg = home_away_avg(skater_logs, 'fg_made', 'away')
    if home_avg > 0 and away_avg > 0 and home_away in ('home', 'away'):
        loc_f = (home_avg / away_avg) if home_away == 'home' else (away_avg / home_avg)
        loc_f = max(0.88, min(1.12, loc_f))
    else:
        loc_f = 1.0
    factors['home_away_f'] = round(loc_f, 4)

    # Back-to-back: SOG stable but slightly reduced
    b2b_f = 0.96 if is_trailing is False and toi_projection < season_toi * 0.95 else 1.0
    # Simpler: caller passes is_trailing; we apply b2b separately in main
    factors['b2b_applied'] = False  # main() will override toi_projection for B2B

    projection = base * toi_f * shot_rate_f * pp_sog_f * opp_passive_f * script_f * loc_f
    projection = max(0.0, round(projection, 4))
    factors['projection'] = projection
    return projection, factors


def project_plus_minus(skater_logs: list[dict], opp_team_logs: list[dict],
                       own_team_logs: list[dict], home_away: str,
                       toi_projection: float) -> tuple[float, dict]:
    """
    Plus/minus is the highest-variance NHL prop.
    Confidence is heavily dampened — see edgeDetector for -8 penalty + blowout risk -25.
    """
    n = len(skater_logs)
    base = weighted_avg(skater_logs, 'plus_minus')
    factors = {'base': round(base, 4)}

    # EV goals differential — what actually drives +/-
    own_ev_goals = rolling_avg(own_team_logs, 'points_scored', 10)
    opp_ev_goals = rolling_avg(opp_team_logs, 'points_scored', 10)
    if own_ev_goals > 0 and opp_ev_goals > 0:
        ev_diff = own_ev_goals - opp_ev_goals
        # Every 0.5 goal/game differential ≈ ±0.15 PM per player
        ev_diff_f = 1.0 + (ev_diff / LEAGUE_AVG['team_goals_per_game']) * 0.15
        ev_diff_f = max(0.85, min(1.15, ev_diff_f))
    else:
        ev_diff_f = 1.0
    factors['ev_diff_f'] = round(ev_diff_f, 4)

    # Zone start proxy via PP TOI
    pp_toi_avg = rolling_avg(skater_logs, 'fg_att', min(20, n))
    if pp_toi_avg > LEAGUE_AVG['pp_toi_per_game'] * 1.5:
        oz_proxy_f = 1.05   # heavy PP = offensive zone starts
    elif pp_toi_avg < LEAGUE_AVG['pp_toi_per_game'] * 0.3:
        oz_proxy_f = 0.95   # minimal PP = defensive zone deployment
    else:
        oz_proxy_f = 1.0
    factors['zone_start_proxy_f'] = round(oz_proxy_f, 4)

    # TOI factor — more ice time = more +/- exposure
    season_toi = weighted_avg(skater_logs, 'minutes')
    toi_f = (toi_projection / season_toi) if season_toi > 0 and toi_projection > 0 else 1.0
    toi_f = max(0.85, min(1.15, toi_f))
    factors['toi_f'] = round(toi_f, 4)

    projection = base * ev_diff_f * oz_proxy_f * toi_f
    # Clamp: +/- projection rarely exceeds ±1.5 per game
    projection = max(-2.0, min(2.0, round(projection, 4)))
    factors['projection'] = projection
    factors['high_variance_prop'] = True   # signals edgeDetector to apply confidence penalty
    return projection, factors


def project_toi(skater_logs: list[dict], home_away: str,
                is_back_to_back: bool) -> tuple[float, dict]:
    """
    Project ice time. Run FIRST — all other props use proj_toi as an input.
    L20 average is the best predictor (TOI is extremely stable).
    """
    n = len(skater_logs)
    base = rolling_avg(skater_logs, 'minutes', min(20, n))   # L20 is most stable
    if base == 0.0:
        base = LEAGUE_AVG['toi_per_game']
    factors = {'base': round(base, 4)}

    # Coaching adjustment: detect line promotions/demotions
    # L5 avg vs L20 avg — significant change signals role shift
    l5_toi  = rolling_avg(skater_logs, 'minutes', min(5, n))
    l20_toi = rolling_avg(skater_logs, 'minutes', min(20, n))
    if l5_toi > 0 and l20_toi > 0:
        toi_trend = l5_toi / l20_toi
        if toi_trend > 1.10:
            coaching_f = 1.08   # trending up — promotion or injury call-up
        elif toi_trend < 0.90:
            coaching_f = 0.92   # trending down — demotion or healthy scratch risk
        else:
            coaching_f = 1.0
    else:
        coaching_f = 1.0
    factors['coaching_f'] = round(coaching_f, 4)

    # PP TOI stability — players with heavy PP deployment have very stable TOI
    pp_toi_l20 = rolling_avg(skater_logs, 'fg_att', min(20, n))
    if pp_toi_l20 > LEAGUE_AVG['pp_toi_per_game'] * 1.5:
        pp_stability_f = 1.02   # high PP deployment = reliable minutes
    elif pp_toi_l20 < LEAGUE_AVG['pp_toi_per_game'] * 0.3:
        pp_stability_f = 0.98   # EV-only grinder = volatile TOI
    else:
        pp_stability_f = 1.0
    factors['pp_stability_f'] = round(pp_stability_f, 4)

    # Back-to-back: star players (>19 avg min) may see reduced deployment
    if is_back_to_back:
        b2b_f = 0.96 if base > 19.0 else 0.98
    else:
        b2b_f = 1.0
    factors['b2b_f'] = b2b_f

    # Home/away split
    home_avg = home_away_avg(skater_logs, 'minutes', 'home')
    away_avg = home_away_avg(skater_logs, 'minutes', 'away')
    if home_avg > 0 and away_avg > 0 and home_away in ('home', 'away'):
        loc_f = (home_avg / away_avg) if home_away == 'home' else (away_avg / home_avg)
        loc_f = max(0.93, min(1.07, loc_f))
    else:
        loc_f = 1.0
    factors['home_away_f'] = round(loc_f, 4)

    projection = base * coaching_f * pp_stability_f * b2b_f * loc_f
    projection = max(0.0, round(projection, 4))
    factors['projection'] = projection
    return projection, factors


# ── Goalie projection functions ────────────────────────────────────────────────

BACKUP_GOALIE_AVG_SAVES   = 22.4
BACKUP_GOALIE_AVG_SV_PCT  = 0.889
BACKUP_GOALIE_AVG_GA      = 3.8


def project_saves(goalie_logs: list[dict], opp_team_logs: list[dict],
                  home_away: str, is_back_to_back: bool,
                  rest_days: int, is_backup: bool = False) -> tuple[float, dict]:
    """
    Saves projection. Now uses real saves (steals col), SV% (fg_pct), GSAA (off_reb).
    Backup goalie detection uses league-average backup stats.
    """
    n = len(goalie_logs)

    # Backup goalie: use league-average backup stats if <5 starts this season
    if is_backup and n < 5:
        base = BACKUP_GOALIE_AVG_SAVES
        factors = {
            'base': base, 'is_backup_low_sample': True,
            'backup_avg_saves': BACKUP_GOALIE_AVG_SAVES,
        }
        factors['projection'] = round(base, 4)
        return round(base, 4), factors

    base = weighted_avg(goalie_logs, 'steals')   # saves in steals col
    if base == 0.0:
        base = BACKUP_GOALIE_AVG_SAVES if is_backup else LEAGUE_AVG['saves_per_game']
    factors = {'base': round(base, 4), 'is_backup': is_backup}

    # SV% trend: L10 vs season — hot goalies regress, cold surge
    sv_l10 = rolling_avg(goalie_logs, 'fg_pct', min(10, n))
    sv_szn = rolling_avg(goalie_logs, 'fg_pct', n)
    if sv_szn > 0 and n >= 5:
        sv_ratio = sv_l10 / sv_szn
        if sv_ratio > 1.010 / sv_szn * sv_szn:   # simplified: absolute threshold
            pass
        # Use absolute SV% thresholds per spec
        if sv_l10 > sv_szn + 0.010:
            sv_trend_f = 0.93   # hot — regress
        elif sv_l10 < sv_szn - 0.010:
            sv_trend_f = 1.07   # cold — expect surge
        else:
            sv_trend_f = 1.0
    else:
        sv_trend_f = 1.0
    factors['sv_trend_f'] = round(sv_trend_f, 4)

    # GSAA factor — now real data from off_reb column
    gsaa_avg = weighted_avg(goalie_logs, 'off_reb')
    if gsaa_avg > 0.5:
        gsaa_f = 1.04   # legitimately above average
    elif gsaa_avg < -0.5:
        gsaa_f = 0.96   # below average
    else:
        gsaa_f = 1.0
    factors['gsaa_f'] = round(gsaa_f, 4)

    # Opponent shots per game — most important volume driver
    opp_shots = rolling_avg(opp_team_logs, 'shots_for', 10)
    if opp_shots > 0:
        opp_shots_f = opp_shots / LEAGUE_AVG['shots_against_per_game']
        opp_shots_f = max(0.80, min(1.25, opp_shots_f))
    else:
        opp_shots_f = 1.0
    factors['opp_shots_f'] = round(opp_shots_f, 4)

    # Opponent SH% regression — high SH% unsustainable = more saves coming
    opp_sh_pct = rolling_avg(opp_team_logs, 'fg_pct', 10)
    if opp_sh_pct > LEAGUE_AVG['shooting_pct'] + 0.02:
        sh_reg_f = 1.05   # over-performing offence — expect regression = more saves
    elif opp_sh_pct > 0 and opp_sh_pct < LEAGUE_AVG['shooting_pct'] - 0.02:
        sh_reg_f = 0.97
    else:
        sh_reg_f = 1.0
    factors['opp_sh_regression_f'] = round(sh_reg_f, 4)

    # Home/away SV% split
    home_sv = home_away_avg(goalie_logs, 'fg_pct', 'home')
    away_sv = home_away_avg(goalie_logs, 'fg_pct', 'away')
    if home_sv > 0 and away_sv > 0 and home_away in ('home', 'away') and sv_szn > 0:
        loc_sv = home_sv if home_away == 'home' else away_sv
        loc_f  = max(0.95, min(1.05, loc_sv / sv_szn))
    else:
        loc_f = 1.0
    factors['home_away_f'] = round(loc_f, 4)

    # Rest factor
    if is_back_to_back or rest_days <= 1:
        rest_f = 0.93
    elif rest_days >= 5:
        rest_f = 0.97
    else:
        rest_f = 1.0
    factors['rest_f'] = rest_f

    projection = base * sv_trend_f * gsaa_f * opp_shots_f * sh_reg_f * loc_f * rest_f
    projection = max(0.0, round(projection, 4))
    factors['projection'] = projection
    return projection, factors


def project_goals_against(goalie_logs: list[dict], opp_team_logs: list[dict],
                           home_away: str, is_backup: bool = False) -> tuple[float, dict]:
    """
    Goals Against projection. Now uses real GA (blocks col), shots (fg_att), SV% (fg_pct), GSAA (off_reb).
    Includes empty-net and OT adjustments as per spec.
    """
    n = len(goalie_logs)

    if is_backup and n < 5:
        base = BACKUP_GOALIE_AVG_GA
        factors = {
            'base': base, 'is_backup_low_sample': True,
            'backup_avg_ga': BACKUP_GOALIE_AVG_GA,
        }
        factors['projection'] = round(base + 0.15 + 0.10, 4)
        return round(base + 0.15 + 0.10, 4), factors

    base = weighted_avg(goalie_logs, 'blocks')   # GA in blocks col
    if base == 0.0:
        base = LEAGUE_AVG['goals_against_per_game']
    factors = {'base': round(base, 4), 'is_backup': is_backup}

    # xGA regression: actual GA vs expected GA from shots × league SH%
    shots_avg = weighted_avg(goalie_logs, 'fg_att')   # shotsAgainst in fg_att
    if shots_avg > 0:
        xga = shots_avg * (1.0 - LEAGUE_AVG['sv_pct'])
        if base > xga + 0.3:
            xga_reg_f = 0.93   # actual GA above expected — regression toward mean
        elif base < xga - 0.3:
            xga_reg_f = 1.07
        else:
            xga_reg_f = 1.0
    else:
        xga_reg_f = 1.0
    factors['xga_regression_f'] = round(xga_reg_f, 4)

    # GSAA factor — real data from off_reb
    gsaa_avg = weighted_avg(goalie_logs, 'off_reb')
    if gsaa_avg > 0.3:
        gsaa_f = 0.94   # elite goalie — suppresses GA
    elif gsaa_avg < -0.3:
        gsaa_f = 1.08   # below average — allows more GA
    else:
        gsaa_f = 1.0
    factors['gsaa_f'] = round(gsaa_f, 4)

    # Opponent goals per game (offensive quality)
    opp_goals_avg = rolling_avg(opp_team_logs, 'points_scored', 10)
    opp_off_f = (opp_goals_avg / LEAGUE_AVG['team_goals_per_game']) if opp_goals_avg > 0 else 1.0
    opp_off_f = max(0.80, min(1.25, opp_off_f))
    factors['opp_offense_f'] = round(opp_off_f, 4)

    # Home/away GA split
    home_ga = home_away_avg(goalie_logs, 'blocks', 'home')
    away_ga = home_away_avg(goalie_logs, 'blocks', 'away')
    if home_ga > 0 and away_ga > 0 and home_away in ('home', 'away'):
        loc_f = (home_ga / away_ga) if home_away == 'home' else (away_ga / home_ga)
        loc_f = max(0.90, min(1.10, loc_f))
    else:
        loc_f = 1.0
    factors['home_away_f'] = round(loc_f, 4)

    projection = base * xga_reg_f * gsaa_f * opp_off_f * loc_f

    # Empty-net adjustment: EN goals count in GA totals but not SV%
    # Avg 0.15 EN goals per game (games where team is losing late)
    en_adjustment = 0.15
    factors['en_adjustment'] = en_adjustment

    # OT factor: ~24% of games go to OT, adding ~0.5 shots per team in OT
    ot_adjustment = LEAGUE_AVG['ot_probability'] * 0.5 * (1.0 - LEAGUE_AVG['sv_pct'])
    ot_adjustment = round(ot_adjustment, 4)
    factors['ot_adjustment'] = ot_adjustment

    projection = projection + en_adjustment + ot_adjustment
    projection = max(0.0, round(projection, 4))
    factors['projection'] = projection
    return projection, factors


# ── Team projection functions ──────────────────────────────────────────────────

def project_moneyline(home_team_logs: list[dict], away_team_logs: list[dict],
                      home_goalie_logs: list[dict], away_goalie_logs: list[dict],
                      home_is_backup: bool, away_is_backup: bool,
                      home_rest_days: int = 3, away_rest_days: int = 3) -> tuple[float, dict]:
    """
    Moneyline win probability. Goalie GSAA differential is the single biggest driver.
    Every 0.5 GSAA differential = 3% win probability shift.
    """
    factors = {}

    # Offense scores (from team_game_logs — fall back to 1.0 if not populated)
    home_goals_avg = rolling_avg(home_team_logs, 'points_scored', 10)
    away_goals_avg = rolling_avg(away_team_logs, 'points_scored', 10)
    home_off = (home_goals_avg / LEAGUE_AVG['team_goals_per_game']) if home_goals_avg > 0 else 1.0
    away_off = (away_goals_avg / LEAGUE_AVG['team_goals_per_game']) if away_goals_avg > 0 else 1.0
    factors['home_offense_score'] = round(home_off, 4)
    factors['away_offense_score'] = round(away_off, 4)

    # Defense scores
    home_ga_avg = rolling_avg(home_team_logs, 'points_allowed', 10)
    away_ga_avg = rolling_avg(away_team_logs, 'points_allowed', 10)
    home_def = (LEAGUE_AVG['team_goals_per_game'] / home_ga_avg) if home_ga_avg > 0 else 1.0
    away_def = (LEAGUE_AVG['team_goals_per_game'] / away_ga_avg) if away_ga_avg > 0 else 1.0
    home_def = max(0.75, min(1.30, home_def))
    away_def = max(0.75, min(1.30, away_def))
    factors['home_defense_score'] = round(home_def, 4)
    factors['away_defense_score'] = round(away_def, 4)

    # Goalie SV% — most critical for moneyline
    home_sv   = rolling_avg(home_goalie_logs, 'fg_pct',  min(10, len(home_goalie_logs))) if home_goalie_logs else LEAGUE_AVG['sv_pct']
    away_sv   = rolling_avg(away_goalie_logs, 'fg_pct',  min(10, len(away_goalie_logs))) if away_goalie_logs else LEAGUE_AVG['sv_pct']
    home_gsaa = rolling_avg(home_goalie_logs, 'off_reb', min(10, len(home_goalie_logs))) if home_goalie_logs else 0.0
    away_gsaa = rolling_avg(away_goalie_logs, 'off_reb', min(10, len(away_goalie_logs))) if away_goalie_logs else 0.0
    gsaa_diff = home_gsaa - away_gsaa   # positive = home goalie advantage
    factors['home_sv_pct'] = round(home_sv, 4)
    factors['away_sv_pct'] = round(away_sv, 4)
    factors['gsaa_diff']   = round(gsaa_diff, 4)

    if home_is_backup:
        home_sv = min(home_sv, LEAGUE_AVG['sv_pct'] - 0.015)
        home_gsaa -= 0.8
        factors['home_backup_goalie'] = True
    if away_is_backup:
        away_sv = min(away_sv, LEAGUE_AVG['sv_pct'] - 0.015)
        away_gsaa -= 0.8
        factors['away_backup_goalie'] = True

    # Projected goals
    proj_home = home_off * away_def * (1.0 - away_sv) / (1.0 - LEAGUE_AVG['sv_pct']) * LEAGUE_AVG['team_goals_per_game']
    proj_away = away_off * home_def * (1.0 - home_sv) / (1.0 - LEAGUE_AVG['sv_pct']) * LEAGUE_AVG['team_goals_per_game']
    factors['proj_home_score'] = round(proj_home, 3)
    factors['proj_away_score'] = round(proj_away, 3)

    # Win probability base: 54% home ice
    score_diff = proj_home - proj_away
    raw_win_prob = LEAGUE_AVG['home_win_pct'] + (score_diff / (2 * LEAGUE_AVG['team_goals_per_game'])) * 0.30

    # GSAA adjustment: every 0.5 GSAA diff = 3% shift
    gsaa_win_adj = (gsaa_diff / 0.5) * 0.03
    raw_win_prob += gsaa_win_adj
    factors['gsaa_win_adj'] = round(gsaa_win_adj, 4)

    # Rest advantage: +2% per extra rest day (capped at ±4%)
    rest_diff = home_rest_days - away_rest_days
    rest_adj  = max(-0.04, min(0.04, rest_diff * 0.02))
    raw_win_prob += rest_adj
    factors['rest_adj'] = round(rest_adj, 4)

    raw_win_prob = max(0.15, min(0.85, raw_win_prob))
    if home_is_backup:
        raw_win_prob = min(raw_win_prob, 0.38)
    factors['home_win_prob'] = round(raw_win_prob, 4)

    return raw_win_prob, factors


def project_puck_line(home_team_logs: list[dict], away_team_logs: list[dict],
                      home_goalie_logs: list[dict], away_goalie_logs: list[dict],
                      home_is_backup: bool, away_is_backup: bool,
                      proj_home_score: float, proj_away_score: float) -> tuple[float, dict, float, dict]:
    """Returns (home_cover_prob, home_factors, away_cover_prob, away_factors)."""
    proj_diff = proj_home_score - proj_away_score
    factors_home = {'proj_differential': round(proj_diff, 3)}
    factors_away = {'proj_differential': round(proj_diff, 3)}

    # CRITICAL: 24% of NHL games go to OT
    # For +1.5 underdog: tie after regulation (OT game) = underdog covers
    # ot_probability varies by projected goal differential — tighter game = more OT
    abs_diff = abs(proj_home_score - proj_away_score)
    if abs_diff < 0.3:
        ot_prob = 0.32   # very tight matchup
    elif abs_diff > 1.0:
        ot_prob = 0.15   # likely blowout
    else:
        ot_prob = 0.24   # default league average
    factors_home['ot_probability'] = ot_prob
    factors_away['ot_probability'] = ot_prob

    # Puck line is -1.5 for favourite, +1.5 for underdog
    # Home cover (-1.5): need proj_diff > 1.5
    home_cover = normal_cdf(proj_diff, mu=1.5, sigma=PUCK_LINE_STD_DEV)
    # Away cover (+1.5): covers if lose by < 1.5 OR game goes to OT (tie after regulation)
    away_cover = 1.0 - normal_cdf(proj_diff, mu=1.5, sigma=PUCK_LINE_STD_DEV)
    # Add OT probability to away cover (OT means 1-goal game → away covers +1.5)
    away_cover = min(0.90, away_cover + ot_prob * 0.6)

    if home_is_backup:
        home_cover = max(home_cover * 0.70, 0.20)
        away_cover = min(away_cover * 1.25, 0.80)
        factors_home['backup_goalie_cover_penalty'] = True
        factors_away['backup_goalie_cover_boost'] = True

    factors_home['cover_probability'] = round(home_cover, 4)
    factors_away['cover_probability'] = round(away_cover, 4)
    return home_cover, factors_home, away_cover, factors_away


def project_total(home_team_logs: list[dict], away_team_logs: list[dict],
                  home_goalie_logs: list[dict], away_goalie_logs: list[dict],
                  home_is_backup: bool, away_is_backup: bool,
                  home_is_b2b: bool = False, away_is_b2b: bool = False) -> tuple[float, dict]:
    """
    Game total. Goalie SV% matchup is the single biggest driver.
    Backup goalie = × 1.18 — most reliable NHL over signal.
    """
    home_goals = rolling_avg(home_team_logs, 'points_scored', 10) if home_team_logs else LEAGUE_AVG['team_goals_per_game']
    away_goals = rolling_avg(away_team_logs, 'points_scored', 10) if away_team_logs else LEAGUE_AVG['team_goals_per_game']
    if home_goals == 0: home_goals = LEAGUE_AVG['team_goals_per_game']
    if away_goals == 0: away_goals = LEAGUE_AVG['team_goals_per_game']
    proj_total = home_goals + away_goals
    factors    = {'proj_home_goals': round(home_goals, 3), 'proj_away_goals': round(away_goals, 3)}

    # Goalie SV% matchup — each 0.010 SV% from avg shifts total by 0.3 goals
    home_sv = rolling_avg(home_goalie_logs, 'fg_pct', min(10, len(home_goalie_logs))) if home_goalie_logs else LEAGUE_AVG['sv_pct']
    away_sv = rolling_avg(away_goalie_logs, 'fg_pct', min(10, len(away_goalie_logs))) if away_goalie_logs else LEAGUE_AVG['sv_pct']
    if home_is_backup: home_sv = min(home_sv, LEAGUE_AVG['sv_pct'] - 0.015)
    if away_is_backup: away_sv = min(away_sv, LEAGUE_AVG['sv_pct'] - 0.015)
    avg_sv = (home_sv + away_sv) / 2
    factors['home_sv_pct'] = round(home_sv, 4)
    factors['away_sv_pct'] = round(away_sv, 4)

    # Goalie impact on total: both .915+ = -0.6 total; either backup = +0.8 total
    sv_total_adj = ((LEAGUE_AVG['sv_pct'] - home_sv) + (LEAGUE_AVG['sv_pct'] - away_sv)) * 30
    sv_total_adj = max(-0.80, min(0.80, sv_total_adj))
    proj_total  += sv_total_adj
    factors['sv_total_adj'] = round(sv_total_adj, 4)

    # Backup goalie — most reliable NHL over signal
    if home_is_backup or away_is_backup:
        proj_total *= 1.18
        factors['backup_goalie_over_signal'] = True

    # B2B both teams: under lean (tired goalies and skaters)
    if home_is_b2b and away_is_b2b:
        proj_total *= 0.94
        factors['b2b_both_teams'] = True
    elif home_is_b2b or away_is_b2b:
        proj_total *= 0.97
        factors['b2b_one_team'] = True

    # OT adds expected goals (24% probability × ~0.3 goals in OT period)
    ot_adjustment = LEAGUE_AVG['ot_probability'] * 0.30
    proj_total   += ot_adjustment
    factors['ot_adjustment'] = round(ot_adjustment, 3)

    proj_total = max(3.0, round(proj_total, 3))
    factors['proj_total'] = proj_total

    posted_total = 5.5
    over_prob  = normal_cdf(proj_total, mu=posted_total, sigma=TOTAL_STD_DEV)
    over_prob  = max(0.10, min(0.90, over_prob))
    factors['over_probability']  = round(over_prob, 4)
    factors['under_probability'] = round(1.0 - over_prob, 4)
    return proj_total, factors


# ── DB write functions ─────────────────────────────────────────────────────────

def upsert_player_projection(conn, player_id: int, player_name: str,
                              team: str, opponent: str, game_date: date,
                              prop_type: str, proj_value: float,
                              factors: dict) -> None:
    # Map prop_type → projection column
    col_map = {
        'goals':         'proj_points',
        'assists':       'proj_assists',
        'points':        'proj_pra',
        'shots_on_goal': 'proj_rebounds',
        'saves':         'proj_steals',
        'goals_against': 'proj_blocks',
        'toi':           'proj_minutes',
    }
    proj_col = col_map.get(prop_type, 'proj_points')

    with conn.cursor() as cur:
        cur.execute(
            f"""INSERT INTO chalk_projections
                   (player_id, player_name, team, opponent, sport, game_date,
                    prop_type, proj_value, {proj_col}, factors_json, model_version)
                VALUES (%s,%s,%s,%s,'NHL',%s,%s,%s,%s,%s,%s)
                ON CONFLICT (player_id, game_date, prop_type)
                DO UPDATE SET
                   proj_value     = EXCLUDED.proj_value,
                   {proj_col}     = EXCLUDED.{proj_col},
                   factors_json   = EXCLUDED.factors_json,
                   model_version  = EXCLUDED.model_version,
                   updated_at     = NOW()""",
            (player_id, player_name, team, opponent, game_date,
             prop_type, proj_value, proj_value,
             json.dumps(factors), MODEL_VERSION)
        )
    conn.commit()


def upsert_team_projection(conn, team_name: str, opponent: str, game_date: date,
                            prop_type: str, proj_value: float,
                            factors: dict, confidence: int = 65) -> None:
    """
    Upsert a single team projection row.
    Extra columns are extracted from `factors` based on prop_type:
      - 'total'           → stores proj_total, over_probability, under_probability
      - 'moneyline'       → stores win_probability, proj_points (proj_home/away score)
      - 'puck_line_cover' → stores spread_cover_probability
    """
    proj_total     = factors.get('proj_total')         if prop_type == 'total'           else None
    over_prob      = factors.get('over_probability')   if prop_type == 'total'           else None
    under_prob     = factors.get('under_probability')  if prop_type == 'total'           else None
    win_prob       = float(proj_value)                 if prop_type == 'moneyline'       else None
    cover_prob     = float(proj_value)                 if prop_type in ('puck_line_cover', 'spread') else None
    proj_pts       = factors.get('proj_home_score')    if prop_type == 'moneyline'       else None

    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO team_projections
                  (team_name, opponent, sport, game_date, prop_type,
                   proj_value, proj_total, over_probability, under_probability,
                   win_probability, spread_cover_probability,
                   proj_points, confidence_score,
                   factors_json, model_version)
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


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk NHL Projection Model')
    parser.add_argument('--date', default=str(date.today()),
                        help='Game date YYYY-MM-DD (default: today)')
    args = parser.parse_args()
    game_date = date.fromisoformat(args.date)

    log.info(f'NHL Projection Model — {game_date}')

    conn = get_db()

    # Step 1: Fetch tonight's NHL schedule
    games = get_todays_games(game_date)
    if not games:
        log.info('No NHL games found for today.')
        conn.close()
        return

    log.info(f'Found {len(games)} games')

    player_count = 0
    team_count   = 0

    for game in games:
        home = game['home_team']
        away = game['away_team']
        log.info(f'  {away} @ {home}')

        # Step 2: Confirm starting goalies
        goalie_info = confirm_starting_goalie(game['game_id']) if game.get('game_id') else {}
        home_is_backup = goalie_info.get('home_is_backup', False)
        away_is_backup = goalie_info.get('away_is_backup', False)
        if home_is_backup:
            log.warning(f'  ⚠️  BACKUP GOALIE: {home} — {goalie_info.get("home_goalie_name")}')
        if away_is_backup:
            log.warning(f'  ⚠️  BACKUP GOALIE: {away} — {goalie_info.get("away_goalie_name")}')

        # Step 3: Get team logs
        home_team_logs = get_team_logs(conn, home)
        away_team_logs = get_team_logs(conn, away)

        # Step 4: Get starting goalies and their logs
        home_goalie_info = get_team_goalie(conn, home)
        away_goalie_info = get_team_goalie(conn, away)
        home_goalie_logs = get_goalie_logs(conn, home_goalie_info['player_id']) if home_goalie_info else []
        away_goalie_logs = get_goalie_logs(conn, away_goalie_info['player_id']) if away_goalie_info else []

        # Step 5: Get rosters (top skaters by TOI)
        home_roster = get_team_roster(home)
        away_roster = get_team_roster(away)

        # Compute team-level rest days (last game from team logs)
        home_last_game = home_team_logs[0].get('game_date') if home_team_logs else None
        away_last_game = away_team_logs[0].get('game_date') if away_team_logs else None
        home_team_rest = (game_date - home_last_game).days if home_last_game else 3
        away_team_rest = (game_date - away_last_game).days if away_last_game else 3
        home_team_b2b  = home_team_rest <= 1
        away_team_b2b  = away_team_rest <= 1

        # Step 6: Project skaters
        # Execution order: TOI → SOG → Goals → Assists → Points → Plus/Minus
        for side, roster, team_abbr, opp_abbr, own_tl in [
            ('home', home_roster, home, away, home_team_logs),
            ('away', away_roster, away, home, away_team_logs),
        ]:
            opp_goalie_logs = away_goalie_logs if side == 'home' else home_goalie_logs
            opp_team_logs   = away_team_logs   if side == 'home' else home_team_logs
            opp_is_backup   = away_is_backup   if side == 'home' else home_is_backup
            location        = side
            is_team_b2b     = home_team_b2b if side == 'home' else away_team_b2b

            all_skaters = roster.get('forwards', [])[:12] + roster.get('defensemen', [])[:6]

            for player in all_skaters:
                pid   = player.get('id')
                pname = f"{player.get('firstName', {}).get('default', '')} {player.get('lastName', {}).get('default', '')}".strip()
                if not pid:
                    continue

                logs = get_skater_logs(conn, pid)
                if len(logs) < 3:
                    continue

                rest   = get_rest_days(conn, pid, game_date)
                is_b2b = rest <= 1
                ctx    = {'rest_days': rest, 'is_b2b': is_b2b}

                # 1. TOI (feeds all other props)
                toi_proj, toi_factors = project_toi(logs, location, is_b2b)
                upsert_player_projection(conn, pid, pname, team_abbr, opp_abbr, game_date, 'toi', toi_proj, toi_factors)

                # 2. SOG
                sog_proj, sog_factors = project_shots_on_goal(logs, opp_team_logs, location, toi_proj)
                upsert_player_projection(conn, pid, pname, team_abbr, opp_abbr, game_date, 'shots_on_goal', sog_proj, sog_factors)

                # 3. Goals
                g_proj, g_factors = project_goals(logs, opp_goalie_logs, opp_team_logs, location, toi_proj, opp_is_backup, is_b2b)
                upsert_player_projection(conn, pid, pname, team_abbr, opp_abbr, game_date, 'goals', g_proj, {**g_factors, 'context': ctx})

                # 4. Assists
                a_proj, a_factors = project_assists(logs, opp_team_logs, location, toi_proj, is_b2b)
                upsert_player_projection(conn, pid, pname, team_abbr, opp_abbr, game_date, 'assists', a_proj, {**a_factors, 'context': ctx})

                # 5. Points (Goals + Assists)
                p_proj, p_factors = project_points(logs, opp_goalie_logs, opp_team_logs, location, toi_proj, opp_is_backup, g_proj, a_proj)
                upsert_player_projection(conn, pid, pname, team_abbr, opp_abbr, game_date, 'points', p_proj, p_factors)

                # 6. Plus/Minus
                pm_proj, pm_factors = project_plus_minus(logs, opp_team_logs, own_tl, location, toi_proj)
                upsert_player_projection(conn, pid, pname, team_abbr, opp_abbr, game_date, 'plus_minus', pm_proj, pm_factors)

                log.info(f'    {pname}: G={g_proj:.2f} A={a_proj:.2f} P={p_proj:.2f} SOG={sog_proj:.2f} TOI={toi_proj:.1f} PM={pm_proj:+.2f}')
                player_count += 1

        # Step 7: Project starting goalies
        for goalie_info_dict, goalie_logs, team_abbr, opp_abbr, opp_team_logs, is_backup in [
            (home_goalie_info, home_goalie_logs, home, away, away_team_logs, home_is_backup),
            (away_goalie_info, away_goalie_logs, away, home, home_team_logs, away_is_backup),
        ]:
            if not goalie_info_dict:
                continue
            gid    = goalie_info_dict['player_id']
            gname  = goalie_info_dict['player_name']
            rest   = get_rest_days(conn, gid, game_date)
            is_b2b = rest <= 1
            g_loc  = 'home' if team_abbr == home else 'away'

            sv_proj, sv_factors = project_saves(goalie_logs, opp_team_logs, g_loc, is_b2b, rest, is_backup)
            upsert_player_projection(conn, gid, gname, team_abbr, opp_abbr, game_date, 'saves', sv_proj,
                                     {**sv_factors, 'context': {'rest_days': rest, 'is_b2b': is_b2b}})

            ga_proj, ga_factors = project_goals_against(goalie_logs, opp_team_logs, g_loc, is_backup)
            upsert_player_projection(conn, gid, gname, team_abbr, opp_abbr, game_date, 'goals_against', ga_proj, ga_factors)

            log.info(f'    {gname} (G{"*" if is_backup else ""}): SV={sv_proj:.1f} GA={ga_proj:.2f}')
            player_count += 1

        # Step 8: Team projections
        home_win_prob, ml_factors = project_moneyline(
            home_team_logs, away_team_logs, home_goalie_logs, away_goalie_logs,
            home_is_backup, away_is_backup, home_team_rest, away_team_rest
        )

        proj_home_score = ml_factors.get('proj_home_score', 3.0)
        proj_away_score = ml_factors.get('proj_away_score', 3.0)

        home_cover, hf, away_cover, af = project_puck_line(
            home_team_logs, away_team_logs, home_goalie_logs, away_goalie_logs,
            home_is_backup, away_is_backup, proj_home_score, proj_away_score
        )

        proj_total, total_factors = project_total(
            home_team_logs, away_team_logs, home_goalie_logs, away_goalie_logs,
            home_is_backup, away_is_backup, home_team_b2b, away_team_b2b
        )

        # Compute team bet confidence based on data quality
        games_home = len(home_team_logs)
        games_away = len(away_team_logs)
        has_goalie_data = bool(home_goalie_logs) and bool(away_goalie_logs)
        team_conf = 60
        if games_home >= 15 and games_away >= 15: team_conf = 68
        elif games_home >= 8 and games_away >= 8:  team_conf = 65
        if has_goalie_data: team_conf = min(75, team_conf + 5)
        if home_is_backup or away_is_backup: team_conf = min(78, team_conf + 8)

        upsert_team_projection(conn, home, away, game_date, 'moneyline', home_win_prob, ml_factors, team_conf)
        upsert_team_projection(conn, home, away, game_date, 'puck_line_cover', home_cover, hf, team_conf)
        upsert_team_projection(conn, away, home, game_date, 'puck_line_cover', away_cover, af, team_conf)
        upsert_team_projection(conn, home, away, game_date, 'total', proj_total, total_factors, team_conf)

        log.info(f'    Team: home_win={home_win_prob:.1%}, total={proj_total:.2f}')
        team_count += 2

    conn.close()
    log.info(f'\nNHL projection model complete — {player_count} player projections, {team_count} team projections')


if __name__ == '__main__':
    main()
