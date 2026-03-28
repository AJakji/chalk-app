"""
Chalk MLB Projection Model  v3.0
=================================
Runs at 10:00 AM ET daily. Generates player + team projections for every
MLB game tonight. Reads from PostgreSQL, fetches weather from Open-Meteo,
writes to chalk_projections and team_projections.

DB column mappings (shared player_game_logs table):
  Batters
  -------
  points        = runs
  fg_made       = hits
  fg_att        = atBats
  fg_pct        = batting average
  three_made    = homeRuns
  steals        = stolenBases
  rebounds      = RBI
  turnovers     = strikeOuts (batter K)
  fouls         = baseOnBalls (BB)
  off_reb       = doubles
  def_reb       = triples

  Pitchers
  --------
  offensive_rating  = ERA
  true_shooting_pct = WHIP
  assists           = strikeOuts (pitcher K)
  minutes           = inningsPitched (float)
  fg_made           = hits allowed
  points            = runs allowed
  turnovers         = BB allowed
  three_made        = HR allowed

Usage:
  python mlbProjectionModel.py [--date YYYY-MM-DD]
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
import requests
import psycopg2
import psycopg2.extras
import statsapi
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

DATABASE_URL   = os.getenv('DATABASE_URL', '')
MODEL_VERSION  = 'v3.1'
CURRENT_SEASON = '2025'

# ── League-average baselines (2024 MLB) ─────────────────────────────────────────
LEAGUE_AVG = {
    # Batter per-game averages
    'hits_per_game':      0.87,
    'tb_per_game':        1.30,
    'hr_per_game':        0.147,
    'rbi_per_game':       0.50,
    'runs_per_game':      0.50,
    'sb_per_game':        0.09,
    # Batter rates
    'ba':                 0.248,
    'baa':                0.248,
    'obp':                0.317,
    'slg':                0.411,
    'ops':                0.728,
    'babip':              0.300,
    'iso':                0.155,
    'k_pct':              0.233,
    'bb_pct':             0.085,
    # Pitcher
    'era':                4.20,
    'whip':               1.30,
    'fip':                4.15,
    'k_per_9':            8.7,
    'bb_per_9':           3.1,
    'hr_per_9':           1.35,
    'h_per_9':            8.5,
    # Team
    'team_runs_per_game': 4.6,
    'team_era':           4.20,
    'team_whip':          1.30,
    'team_ops':           0.728,
    # Game-level
    'game_total':         8.8,
    'k_per_game':         16.2,   # both teams combined
    'bb_per_game_team':   3.35,   # per team per game
    'risp_rbi_per_pa':    0.085,
    # SB
    'sb_rate':            0.09,
}

# Standard deviations for CDF calculations
TOTAL_STD_DEV  = 2.8   # MLB game totals
SPREAD_STD_DEV = 3.2   # MLB run line

# ── Venue coordinates for weather lookup ────────────────────────────────────────
VENUE_COORDS = {
    'Yankee Stadium':           (40.8296, -73.9262),
    'Fenway Park':              (42.3467, -71.0972),
    'Oriole Park':              (39.2838, -76.6217),
    'Camden Yards':             (39.2838, -76.6217),
    'Tropicana Field':          (27.7683, -82.6534),
    'Rogers Centre':            (43.6414, -79.3894),
    'Guaranteed Rate Field':    (41.8299, -87.6338),
    'Progressive Field':        (41.4954, -81.6854),
    'Comerica Park':            (42.3390, -83.0485),
    'Kauffman Stadium':         (39.0517, -94.4803),
    'Target Field':             (44.9817, -93.2781),
    'Minute Maid Park':         (29.7572, -95.3556),
    'Globe Life Field':         (32.7473, -97.0820),
    'Angel Stadium':            (33.8003, -117.8827),
    'Oakland Coliseum':         (37.7516, -122.2005),
    'T-Mobile Park':            (47.5914, -122.3325),
    'Dodger Stadium':           (34.0739, -118.2400),
    'Oracle Park':              (37.7786, -122.3893),
    'Petco Park':               (32.7076, -117.1570),
    'Chase Field':              (33.4453, -112.0667),
    'Coors Field':              (39.7559, -104.9942),
    'Busch Stadium':            (38.6226, -90.1928),
    'American Family Field':    (43.0280, -87.9712),
    'Wrigley Field':            (41.9484, -87.6553),
    'Great American Ball Park': (39.0979, -84.5082),
    'PNC Park':                 (40.4469, -80.0057),
    'Citi Field':               (40.7571, -73.8458),
    'Citizens Bank Park':       (39.9061, -75.1665),
    'Nationals Park':           (38.8730, -77.0074),
    'Truist Park':              (33.8908, -84.4678),
    'loanDepot park':           (25.7781, -80.2197),
    'LoanDepot Park':           (25.7781, -80.2197),
}

# ── Park factors (3-year rolling) ───────────────────────────────────────────────
MLB_PARK_FACTORS = {
    'coors_field':              {'hr': 1.35, 'runs': 1.28, 'hits': 1.14, 'altitude_ft': 5183},
    'great_american_ballpark':  {'hr': 1.25, 'runs': 1.18, 'hits': 1.08, 'altitude_ft': 489},
    'yankee_stadium':           {'hr': 1.18, 'runs': 1.10, 'hits': 1.05, 'altitude_ft': 55},
    'wrigley_field':            {'hr': 1.10, 'runs': 1.08, 'hits': 1.06, 'altitude_ft': 595},
    'fenway_park':              {'hr': 0.95, 'runs': 1.07, 'hits': 1.08, 'altitude_ft': 20},
    'guaranteed_rate_field':    {'hr': 1.08, 'runs': 1.05, 'hits': 1.03, 'altitude_ft': 595},
    'progressive_field':        {'hr': 0.97, 'runs': 0.98, 'hits': 1.01, 'altitude_ft': 580},
    'comerica_park':            {'hr': 0.90, 'runs': 0.95, 'hits': 0.98, 'altitude_ft': 600},
    'target_field':             {'hr': 0.95, 'runs': 0.97, 'hits': 0.99, 'altitude_ft': 830},
    'minute_maid_park':         {'hr': 1.07, 'runs': 1.04, 'hits': 1.02, 'altitude_ft': 43},
    't_mobile_park':            {'hr': 0.88, 'runs': 0.94, 'hits': 0.97, 'altitude_ft': 8},
    'chase_field':              {'hr': 1.05, 'runs': 1.04, 'hits': 1.02, 'altitude_ft': 1082},
    'oracle_park':              {'hr': 0.82, 'runs': 0.91, 'hits': 0.95, 'altitude_ft': 0},
    'petco_park':               {'hr': 0.78, 'runs': 0.90, 'hits': 0.94, 'altitude_ft': 17},
    'angel_stadium':            {'hr': 0.97, 'runs': 0.97, 'hits': 0.99, 'altitude_ft': 154},
    'dodger_stadium':           {'hr': 0.97, 'runs': 0.97, 'hits': 0.99, 'altitude_ft': 340},
    'kauffman_stadium':         {'hr': 0.88, 'runs': 0.94, 'hits': 0.96, 'altitude_ft': 750},
    'american_family_field':    {'hr': 1.02, 'runs': 1.01, 'hits': 1.00, 'altitude_ft': 635},
    'tropicana_field':          {'hr': 1.05, 'runs': 1.00, 'hits': 0.99, 'altitude_ft': 15},
    'camden_yards':             {'hr': 1.06, 'runs': 1.05, 'hits': 1.03, 'altitude_ft': 32},
    'nationals_park':           {'hr': 1.08, 'runs': 1.04, 'hits': 1.02, 'altitude_ft': 25},
    'pnc_park':                 {'hr': 0.88, 'runs': 0.94, 'hits': 0.97, 'altitude_ft': 705},
    'citizens_bank_park':       {'hr': 1.15, 'runs': 1.10, 'hits': 1.05, 'altitude_ft': 20},
    'citi_field':               {'hr': 0.93, 'runs': 0.96, 'hits': 0.98, 'altitude_ft': 20},
    'truist_park':              {'hr': 1.05, 'runs': 1.02, 'hits': 1.01, 'altitude_ft': 1050},
    'loandepot_park':           {'hr': 0.85, 'runs': 0.93, 'hits': 0.96, 'altitude_ft': 6},
    'busch_stadium':            {'hr': 0.92, 'runs': 0.95, 'hits': 0.98, 'altitude_ft': 455},
    'globe_life_field':         {'hr': 1.08, 'runs': 1.05, 'hits': 1.03, 'altitude_ft': 551},
    'rogers_centre':            {'hr': 1.06, 'runs': 1.04, 'hits': 1.02, 'altitude_ft': 251},
    'default':                  {'hr': 1.00, 'runs': 1.00, 'hits': 1.00, 'altitude_ft': 100},
}


# ── Core helpers ────────────────────────────────────────────────────────────────

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


def _normal_cdf(z: float) -> float:
    """Standard normal CDF via math.erfc."""
    return 0.5 * math.erfc(-z / math.sqrt(2))


# ── Venue / park helpers ────────────────────────────────────────────────────────

def get_venue_coords(venue_name: str) -> Optional[tuple]:
    if not venue_name:
        return None
    vl = venue_name.lower()
    for key, coords in VENUE_COORDS.items():
        if key.lower() in vl or vl in key.lower():
            return coords
    return None


def get_park_factors(venue_name: str) -> dict:
    name_lower = venue_name.lower().replace(' ', '_').replace("'", '').replace('.', '')
    for key, factors in MLB_PARK_FACTORS.items():
        if key == 'default':
            continue
        key_words = key.replace('_', ' ')
        if key in name_lower or key_words in venue_name.lower():
            return factors
    return MLB_PARK_FACTORS['default']


# ── Weather ──────────────────────────────────────────────────────────────────────

def fetch_weather(lat: float, lon: float) -> dict:
    url = (
        f'https://api.open-meteo.com/v1/forecast'
        f'?latitude={lat}&longitude={lon}'
        f'&current_weather=true'
        f'&hourly=temperature_2m,wind_speed_10m,wind_direction_10m'
        f'&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto'
    )
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        cw = data.get('current_weather', {})
        return {
            'temp_f':       float(cw.get('temperature', 72)),
            'wind_mph':     float(cw.get('windspeed', 0)),
            'wind_dir_deg': float(cw.get('winddirection', 0)),
        }
    except Exception as exc:
        log.warning(f'  Weather fetch failed ({lat},{lon}): {exc}')
        return {}


def wind_direction_label(degrees: float) -> str:
    dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    idx = round(degrees / 45) % 8
    return dirs[idx]


def _wind_out(wind_dir_deg: float, park_name: str) -> bool:
    """True if wind is blowing toward outfield (bad for pitchers, good for hitters)."""
    label = wind_direction_label(wind_dir_deg)
    if 'wrigley' in park_name.lower():
        return label in ('E', 'SE', 'NE')
    return label in ('S', 'SW', 'SE')


def _wind_in(wind_dir_deg: float, park_name: str) -> bool:
    """True if wind is blowing from outfield toward home plate."""
    label = wind_direction_label(wind_dir_deg)
    if 'wrigley' in park_name.lower():
        return label in ('W', 'SW', 'NW')
    return label in ('N', 'NW', 'NE')


# ── Per-spec weather factor functions ───────────────────────────────────────────

def weather_hits_factor(weather: dict, park_name: str = '') -> float:
    """
    Hits multiplier per spec:
      wind blowing out > 12mph: ×1.02
      temp < 50F: ×0.97
      temp > 80F: ×1.02
    """
    if not weather:
        return 1.0
    temp     = weather.get('temp_f', 72)
    wind_mph = weather.get('wind_mph', 0)
    wind_dir = weather.get('wind_dir_deg', 0)

    f = 1.0
    if temp < 50:
        f *= 0.97
    elif temp > 80:
        f *= 1.02

    if wind_mph > 12 and _wind_out(wind_dir, park_name):
        f *= 1.02

    return round(f, 4)


def weather_tb_wind_factor(weather: dict, park_name: str = '') -> float:
    """
    Total-bases wind factor per spec:
      blowing out 15-19mph: ×1.08  |  20+mph: ×1.14
      blowing in  15-19mph: ×0.91  |  20+mph: ×0.86
      crosswind: ×1.01
    """
    if not weather:
        return 1.0
    wind_mph = weather.get('wind_mph', 0)
    wind_dir = weather.get('wind_dir_deg', 0)

    out = _wind_out(wind_dir, park_name)
    inn = _wind_in(wind_dir, park_name)

    if out:
        if wind_mph >= 20:   return 1.14
        if wind_mph >= 15:   return 1.08
    elif inn:
        if wind_mph >= 20:   return 0.86
        if wind_mph >= 15:   return 0.91
    elif wind_mph >= 10:
        return 1.01
    return 1.0


def weather_tb_temp_factor(weather: dict) -> float:
    """
    Total-bases temperature factor per spec:
      < 45F: 0.88  |  45-55: 0.93  |  55-65: 0.97
      65-75: 1.00  |  75-85: 1.04  |  > 85: 1.08
    """
    if not weather:
        return 1.0
    temp = weather.get('temp_f', 72)
    if temp < 45:   return 0.88
    if temp < 55:   return 0.93
    if temp < 65:   return 0.97
    if temp < 75:   return 1.00
    if temp < 85:   return 1.04
    return 1.08


def weather_hr_wind_factor(weather: dict, park_name: str = '') -> float:
    """
    HR wind factor per spec (most important HR swing factor):
      blowing out 10-14mph: ×1.10  |  15-19: ×1.18  |  20+: ×1.28
      blowing in  any speed: ×0.82
    """
    if not weather:
        return 1.0
    wind_mph = weather.get('wind_mph', 0)
    wind_dir = weather.get('wind_dir_deg', 0)

    if _wind_in(wind_dir, park_name):
        return 0.82

    if _wind_out(wind_dir, park_name):
        if wind_mph >= 20:   return 1.28
        if wind_mph >= 15:   return 1.18
        if wind_mph >= 10:   return 1.10

    return 1.0


def weather_hr_temp_factor(weather: dict) -> float:
    """
    HR temperature factor per spec:
      < 45F: 0.82  |  45-55: 0.89  |  55-65: 0.95
      65-75: 1.00  |  75-85: 1.06  |  > 85: 1.12
    """
    if not weather:
        return 1.0
    temp = weather.get('temp_f', 72)
    if temp < 45:   return 0.82
    if temp < 55:   return 0.89
    if temp < 65:   return 0.95
    if temp < 75:   return 1.00
    if temp < 85:   return 1.06
    return 1.12


def weather_cold_grip_factor(weather: dict) -> float:
    """Cold weather increases walks — grip issues. Used in pitcher walks."""
    if not weather:
        return 1.0
    temp = weather.get('temp_f', 72)
    if temp < 45:   return 1.10
    if temp < 55:   return 1.05
    return 1.0


def weather_scoring_factor(weather: dict, park_name: str = '') -> float:
    """Combined wind+temp run environment factor for RBI/runs."""
    if not weather:
        return 1.0
    wind_f = weather_tb_wind_factor(weather, park_name)
    temp_f = weather_tb_temp_factor(weather)
    return round(wind_f * temp_f, 4)


# ── Rolling averages ─────────────────────────────────────────────────────────────

def rolling_avg(rows: list, col: str, n: int) -> float:
    vals = [safe(r[col]) for r in rows[:n] if r.get(col) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def new_weighted_avg(rows: list, col: str) -> float:
    """
    L5 × 0.35  +  L10 × 0.30  +  L20 × 0.20  +  season × 0.15
    Gracefully degrades with fewer games.
    """
    n = len(rows)
    if n == 0:
        return 0.0
    l5  = rolling_avg(rows, col, min(5,  n))
    l10 = rolling_avg(rows, col, min(10, n))
    l20 = rolling_avg(rows, col, min(20, n))
    szn = rolling_avg(rows, col, n)
    if n >= 20:
        return l5 * 0.35 + l10 * 0.30 + l20 * 0.20 + szn * 0.15
    if n >= 10:
        return l5 * 0.45 + l10 * 0.35 + szn * 0.20
    if n >= 5:
        return l5 * 0.60 + szn * 0.40
    return szn


def home_away_factor_for_col(logs: list, col: str, tonight_location: str) -> float:
    """
    Ratio of player's home (or away) average vs overall season average.
    Cap: 0.85 to 1.20.
    """
    home_vals = [safe(r[col]) for r in logs if r.get('home_away') == 'home' and r.get(col) is not None]
    away_vals = [safe(r[col]) for r in logs if r.get('home_away') == 'away' and r.get(col) is not None]
    all_vals  = [safe(r[col]) for r in logs if r.get(col) is not None]
    if not all_vals:
        return 1.0
    season_avg = sum(all_vals) / len(all_vals)
    if season_avg <= 0:
        return 1.0
    loc_vals = home_vals if tonight_location == 'home' else away_vals
    if not loc_vals:
        return 1.0
    loc_avg = sum(loc_vals) / len(loc_vals)
    return max(0.85, min(1.20, loc_avg / season_avg))


# ── DB query functions ───────────────────────────────────────────────────────────

def get_batter_logs(conn, player_id: int, limit: int = 50) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'MLB' AND season = %s
                 AND fg_att IS NOT NULL
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_sp_logs(conn, player_id: int, limit: int = 15) -> list:
    """Pitcher game logs — only outings with >= 1 IP."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'MLB' AND season = %s
                 AND minutes >= 1
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_team_logs(conn, team_name: str, limit: int = 20) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM team_game_logs
               WHERE team_name ILIKE %s AND sport = 'MLB' AND season = %s
               ORDER BY game_date DESC LIMIT %s""",
            (f'%{team_name}%', CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_rest_days(conn, player_id: int, game_date: date) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT MAX(game_date) FROM player_game_logs
               WHERE player_id = %s AND game_date < %s AND sport = 'MLB'""",
            (player_id, game_date)
        )
        row = cur.fetchone()
        if row and row[0]:
            return (game_date - row[0]).days
        return 5


def get_todays_games(conn, game_date: date) -> list:
    try:
        schedule = statsapi.schedule(date=str(game_date), sportId=1)
    except Exception as exc:
        log.error(f'  statsapi.schedule() failed: {exc}')
        return []
    games = []
    for game in schedule:
        status = game.get('status', '')
        if status in ('Final', 'Cancelled', 'Postponed'):
            continue
        games.append({
            'game_pk':       game.get('game_id'),
            'away_team':     game.get('away_name', ''),
            'away_team_id':  game.get('away_id', 0),
            'home_team':     game.get('home_name', ''),
            'home_team_id':  game.get('home_id', 0),
            'venue_name':    game.get('venue_name', ''),
            'game_time':     game.get('game_datetime', ''),
            'status':        status,
        })
    log.info(f'  Found {len(games)} MLB games for {game_date}')
    return games


# ── New v3 DB factor queries ─────────────────────────────────────────────────────

def get_batter_splits_db(conn, player_id: int) -> dict:
    """Full row from player_splits for this batter."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_splits
               WHERE player_id = %s AND sport = 'MLB' AND season = %s
               LIMIT 1""",
            (player_id, CURRENT_SEASON)
        )
        row = cur.fetchone()
        return dict(row) if row else {}


def get_career_matchup_db(conn, pitcher_id: int, batter_id: int) -> dict:
    """Career matchup row from pitcher_batter_matchups."""
    if not pitcher_id or not batter_id:
        return {}
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT ab AS career_ab, hits AS career_hits, hr AS career_hr,
                      bb AS career_bb, k AS career_k, avg AS career_avg, ops AS career_ops
               FROM pitcher_batter_matchups
               WHERE pitcher_id = %s AND batter_id = %s
               ORDER BY season DESC LIMIT 1""",
            (pitcher_id, batter_id)
        )
        row = cur.fetchone()
        return dict(row) if row else {}


def get_arsenal_data(conn, pitcher_id: int) -> list:
    """All pitch types from pitcher_arsenal for this pitcher."""
    if not pitcher_id:
        return []
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT pitch_type, avg_velocity AS velocity, usage_pct, whiff_rate,
                      ba_against, slg_against, avg_spin_rate AS spin_rate
               FROM pitcher_arsenal
               WHERE pitcher_id = %s
               AND season = (SELECT MAX(season) FROM pitcher_arsenal WHERE pitcher_id = %s)""",
            (pitcher_id, pitcher_id)
        )
        return cur.fetchall()


def get_arsenal_weighted_whiff(arsenal: list) -> float:
    """Compute usage-weighted whiff rate from arsenal rows. Returns None if no data."""
    rows = [r for r in arsenal if r.get('usage_pct') and r.get('whiff_rate')]
    if not rows:
        return None
    total_usage  = sum(safe(r['usage_pct']) for r in rows)
    if total_usage <= 0:
        return None
    weighted = sum(safe(r['usage_pct']) * safe(r['whiff_rate']) for r in rows) / total_usage
    return weighted


def get_arsenal_primary_velocity(arsenal: list) -> Optional[float]:
    """Velocity of the most-used pitch (primary pitch)."""
    rows = [r for r in arsenal if r.get('usage_pct') and r.get('velocity')]
    if not rows:
        return None
    primary = max(rows, key=lambda r: safe(r['usage_pct']))
    return safe(primary['velocity'])


def get_bullpen_tired(conn, team_id: int, game_date: date) -> bool:
    """True if 2+ top relievers pitched 50+ pitches in the last 3 days."""
    if not team_id:
        return False
    collected = str(game_date)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT pitches_last_3, innings_last_3
               FROM bullpen_usage
               WHERE team_id = %s AND collected_date = %s
               ORDER BY pitches_last_3 DESC LIMIT 5""",
            (team_id, collected)
        )
        rows = cur.fetchall()
    if not rows:
        return False
    tired_count = sum(1 for r in rows if safe(r[0]) >= 50 or safe(r[1]) >= 2.0)
    return tired_count >= 2


def get_umpire_data(conn, game_pk: int) -> dict:
    """K/BB/runs factors for tonight's home plate umpire."""
    if not game_pk:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """SELECT ut.avg_k_per_game, ut.avg_bb_per_game,
                      ut.avg_runs_per_game, ut.umpire_name
               FROM game_umpires gu
               JOIN umpire_tendencies ut ON gu.hp_umpire_id = ut.umpire_id
               WHERE gu.game_pk = %s""",
            (game_pk,)
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return {}
    return {
        'k_per_game':    safe(row[0]),
        'bb_per_game':   safe(row[1]),
        'runs_per_game': safe(row[2]),
        'ump_name':      row[3] or 'Unknown',
    }


def get_team_k_rate(conn, team_name: str) -> float:
    """Team batter strikeout rate from recent game logs."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT SUM(turnovers), SUM(fg_att)
               FROM player_game_logs
               WHERE team ILIKE %s AND sport = 'MLB' AND season = %s
                 AND fg_att > 0
                 AND game_date >= CURRENT_DATE - INTERVAL '30 days'""",
            (f'%{team_name[:3]}%', CURRENT_SEASON)
        )
        row = cur.fetchone()
        if row and row[0] is not None and row[1] and float(row[1]) > 0:
            return max(0.150, min(0.320, float(row[0]) / float(row[1])))
    return LEAGUE_AVG['k_pct']


def get_team_sb_allowed(conn, team_name: str) -> float:
    """Approximate opponent SB allowed per game (for catcher factor)."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT AVG(steals) FROM team_game_logs
               WHERE opponent ILIKE %s AND sport = 'MLB' AND season = %s
               LIMIT 20""",
            (f'%{team_name[:3]}%', CURRENT_SEASON)
        )
        row = cur.fetchone()
        if row and row[0]:
            return max(0.0, float(row[0]))
    return LEAGUE_AVG['sb_rate'] * 9  # fallback: league avg per game


# ── SP stat helpers (computed from game logs) ────────────────────────────────────

def compute_sp_season_h9(sp_logs: list) -> float:
    total_h  = sum(safe(r.get('fg_made', 0)) for r in sp_logs)
    total_ip = sum(safe(r.get('minutes', 0)) for r in sp_logs)
    if total_ip <= 0:
        return LEAGUE_AVG['h_per_9']
    return max(1.0, min(15.0, total_h / total_ip * 9))


def compute_sp_l5_h9(sp_logs: list) -> float:
    recent = sp_logs[:min(5, len(sp_logs))]
    return compute_sp_season_h9(recent)


def compute_sp_season_era(sp_logs: list) -> float:
    return rolling_avg(sp_logs, 'offensive_rating', len(sp_logs)) if sp_logs else LEAGUE_AVG['era']


def compute_sp_l5_era(sp_logs: list) -> float:
    return rolling_avg(sp_logs, 'offensive_rating', min(5, len(sp_logs))) if sp_logs else LEAGUE_AVG['era']


def compute_sp_season_whip(sp_logs: list) -> float:
    return rolling_avg(sp_logs, 'true_shooting_pct', len(sp_logs)) if sp_logs else LEAGUE_AVG['whip']


def compute_sp_k9(sp_logs: list, n: int = None) -> float:
    rows = sp_logs[:n] if n else sp_logs
    total_k  = sum(safe(r.get('assists', 0)) for r in rows)
    total_ip = sum(safe(r.get('minutes', 0)) for r in rows)
    if total_ip <= 0:
        return LEAGUE_AVG['k_per_9']
    return max(0.0, total_k / total_ip * 9)


def compute_sp_bb9(sp_logs: list, n: int = None) -> float:
    rows = sp_logs[:n] if n else sp_logs
    total_bb = sum(safe(r.get('turnovers', 0)) for r in rows)
    total_ip = sum(safe(r.get('minutes', 0)) for r in rows)
    if total_ip <= 0:
        return LEAGUE_AVG['bb_per_9']
    return max(0.0, total_bb / total_ip * 9)


def compute_sp_hr9(sp_logs: list, n: int = None) -> float:
    rows = sp_logs[:n] if n else sp_logs
    total_hr = sum(safe(r.get('three_made', 0)) for r in rows)
    total_ip = sum(safe(r.get('minutes', 0)) for r in rows)
    if total_ip <= 0:
        return LEAGUE_AVG['hr_per_9']
    return max(0.0, total_hr / total_ip * 9)


def compute_sp_fip(sp_logs: list) -> float:
    """FIP = (13×HR + 3×BB − 2×K) / IP + 3.10"""
    recent = sp_logs[:min(10, len(sp_logs))]
    if not recent:
        return LEAGUE_AVG['fip']
    total_hr = sum(safe(r.get('three_made', 0)) for r in recent)
    total_bb = sum(safe(r.get('turnovers', 0)) for r in recent)
    total_k  = sum(safe(r.get('assists', 0)) for r in recent)
    total_ip = sum(safe(r.get('minutes', 0)) for r in recent)
    if total_ip <= 0:
        return LEAGUE_AVG['fip']
    return max(2.0, min(7.0, (13 * total_hr + 3 * total_bb - 2 * total_k) / total_ip + 3.10))


def compute_sp_avg_ip(sp_logs: list, n: int = 5) -> float:
    recent = sp_logs[:min(n, len(sp_logs))]
    if not recent:
        return 5.0
    avg = rolling_avg(recent, 'minutes', len(recent))
    return avg if avg > 0 else 5.0


def compute_days_rest(sp_logs: list, game_date: date) -> int:
    if not sp_logs:
        return 5
    last_date = sp_logs[0].get('game_date')
    if not last_date:
        return 5
    try:
        return max(0, (game_date - last_date).days)
    except Exception:
        return 5


def compute_babip(logs: list, n: int = 20) -> float:
    """BABIP = (H - HR) / (AB - K - HR)"""
    recent   = logs[:min(n, len(logs))]
    total_h  = sum(safe(r.get('fg_made', 0)) for r in recent)
    total_hr = sum(safe(r.get('three_made', 0)) for r in recent)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in recent)
    total_k  = sum(safe(r.get('turnovers', 0)) for r in recent)
    denom = total_ab - total_k - total_hr
    if denom <= 0:
        return LEAGUE_AVG['babip']
    return max(0.200, min(0.450, (total_h - total_hr) / denom))


def compute_iso(logs: list, n: int = 20) -> float:
    """ISO = (2B + 2×3B + 3×HR) / AB"""
    recent   = logs[:min(n, len(logs))]
    total_2b = sum(safe(r.get('off_reb', 0)) for r in recent)
    total_3b = sum(safe(r.get('def_reb', 0)) for r in recent)
    total_hr = sum(safe(r.get('three_made', 0)) for r in recent)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in recent)
    if total_ab <= 0:
        return LEAGUE_AVG['iso']
    return max(0.050, min(0.400, (total_2b + 2 * total_3b + 3 * total_hr) / total_ab))


def compute_obp(logs: list, n: int = 20) -> float:
    """OBP = (H + BB) / (AB + BB)"""
    recent   = logs[:min(n, len(logs))]
    total_h  = sum(safe(r.get('fg_made', 0)) for r in recent)
    total_bb = sum(safe(r.get('fouls', 0)) for r in recent)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in recent)
    denom = total_ab + total_bb
    if denom <= 0:
        return LEAGUE_AVG['obp']
    return max(0.200, min(0.500, (total_h + total_bb) / denom))


def compute_season_ba(logs: list) -> float:
    total_h  = sum(safe(r.get('fg_made', 0)) for r in logs)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in logs)
    if total_ab <= 0:
        return LEAGUE_AVG['ba']
    return max(0.100, min(0.450, total_h / total_ab))


def compute_season_slg(logs: list) -> float:
    total_h  = sum(safe(r.get('fg_made', 0)) for r in logs)
    total_2b = sum(safe(r.get('off_reb', 0)) for r in logs)
    total_3b = sum(safe(r.get('def_reb', 0)) for r in logs)
    total_hr = sum(safe(r.get('three_made', 0)) for r in logs)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in logs)
    if total_ab <= 0:
        return LEAGUE_AVG['slg']
    tb = total_h + total_2b + 2 * total_3b + 3 * total_hr
    return max(0.100, min(0.900, tb / total_ab))


def compute_season_hr_rate(logs: list) -> float:
    total_hr = sum(safe(r.get('three_made', 0)) for r in logs)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in logs)
    if total_ab <= 0:
        return LEAGUE_AVG['hr_per_game']
    return max(0.0, min(0.200, total_hr / total_ab))


# ── Factor helper functions ──────────────────────────────────────────────────────

def lineup_pa_factor(pos: int, confirmed: bool) -> float:
    """Plate-appearance rate by lineup position (per spec)."""
    if not confirmed:
        return 1.00
    if pos == 1:              return 1.12
    if pos == 2:              return 1.08
    if pos == 3:              return 1.05
    if pos == 4:              return 1.03
    if pos == 5:              return 1.00
    if pos in (6, 7):         return 0.96
    return 0.90  # 8-9


def lineup_rbi_factor(pos: int) -> float:
    """RBI opportunity weight by lineup position (per spec)."""
    if pos == 4:              return 1.25
    if pos == 3:              return 1.20
    if pos == 5:              return 1.15
    if pos in (6, 7):         return 0.95
    if pos in (8, 9):         return 0.85
    return 0.80  # 1-2 leadoff


def lineup_runs_factor(pos: int) -> float:
    """Runs-scored weight by lineup position (per spec)."""
    if pos == 1:              return 1.32
    if pos == 2:              return 1.18
    if pos == 3:              return 1.08
    if pos in (4, 5):         return 1.00
    if pos in (6, 7, 8):      return 0.88
    return 0.78  # 9


def lineup_sb_factor(pos: int) -> float:
    """SB likelihood by lineup position (per spec)."""
    if pos == 1:              return 1.20
    if pos == 2:              return 1.10
    return 0.80


def babip_regression_f(logs: list) -> float:
    """Per spec: BABIP regression factor from last-20 games."""
    babip = compute_babip(logs, 20)
    if babip > 0.350:   return 0.93
    if babip > 0.320:   return 0.97
    if babip < 0.260:   return 1.07
    if babip < 0.280:   return 1.03
    return 1.00


def platoon_hits_f(splits: dict, sp_hand: str, season_avg: float) -> float:
    """vs_rhp_avg or vs_lhp_avg / season_avg. Cap 0.75-1.35."""
    if not splits or season_avg <= 0:
        return 1.0
    key = 'vs_lhp_avg' if sp_hand == 'L' else 'vs_rhp_avg'
    split_val = splits.get(key)
    if not split_val or float(split_val) <= 0:
        return 1.0
    return max(0.75, min(1.35, float(split_val) / season_avg))


def platoon_slg_f(splits: dict, sp_hand: str, season_slg: float) -> float:
    """vs_rhp_slg or vs_lhp_slg / season_slg. Cap 0.70-1.40."""
    if not splits or season_slg <= 0:
        return 1.0
    key = 'vs_lhp_slg' if sp_hand == 'L' else 'vs_rhp_slg'
    split_val = splits.get(key)
    if not split_val or float(split_val) <= 0:
        return 1.0
    return max(0.70, min(1.40, float(split_val) / season_slg))


def platoon_hr_f(splits: dict, sp_hand: str, season_hr_rate: float) -> float:
    """vs_rhp_hr_rate or vs_lhp_hr_rate / season_hr_rate. Cap 0.50-2.00."""
    if not splits or season_hr_rate <= 0:
        return 1.0
    key = 'vs_lhp_hr_rate' if sp_hand == 'L' else 'vs_rhp_hr_rate'
    split_val = splits.get(key)
    if not split_val or float(split_val) <= 0:
        return 1.0
    return max(0.50, min(2.00, float(split_val) / season_hr_rate))


def day_night_f(splits: dict, is_day_game: bool, season_avg: float) -> float:
    """day_avg or night_avg / season_avg. Cap 0.85-1.15."""
    if not splits or season_avg <= 0:
        return 1.0
    key = 'day_avg' if is_day_game else 'night_avg'
    split_val = splits.get(key)
    if not split_val or float(split_val) <= 0:
        return 1.0
    return max(0.85, min(1.15, float(split_val) / season_avg))


def risp_rbi_f(splits: dict) -> float:
    """risp_rbi_per_pa / 0.085. Falls back to risp_avg / 0.240. Cap 0.65-1.50."""
    if not splits:
        return 1.0
    # Prefer risp_rbi_per_pa if available; otherwise use risp_avg as proxy
    risp_rbi = splits.get('risp_rbi_per_pa')
    if risp_rbi and float(risp_rbi) > 0:
        return max(0.65, min(1.50, float(risp_rbi) / LEAGUE_AVG['risp_rbi_per_pa']))
    risp_avg = splits.get('risp_avg')
    if risp_avg and float(risp_avg) > 0:
        return max(0.65, min(1.50, float(risp_avg) / 0.240))
    return 1.0


def sp_quality_f(sp_logs: list) -> float:
    """league_avg_H9 / sp_season_H9 → bad pitcher > 1.0 (good for batters). Cap 0.70-1.40."""
    if len(sp_logs) < 3:
        return 1.0
    sp_h9 = compute_sp_season_h9(sp_logs)
    if sp_h9 <= 0:
        return 1.0
    return max(0.70, min(1.40, LEAGUE_AVG['h_per_9'] / sp_h9))


def sp_recent_form_f(sp_logs: list) -> float:
    """sp_quality × (L5_H9 / season_H9). Cap 0.80-1.20."""
    if len(sp_logs) < 5:
        return 1.0
    szn_h9 = compute_sp_season_h9(sp_logs)
    l5_h9  = compute_sp_l5_h9(sp_logs)
    if szn_h9 <= 0:
        return 1.0
    q_f    = sp_quality_f(sp_logs)
    trend  = max(0.70, min(1.40, l5_h9 / szn_h9))
    return max(0.80, min(1.20, q_f * trend))


def career_matchup_hits_f(matchup: dict) -> float:
    """
    career_avg / 0.248, weighted by AB sample. Cap 0.65-1.50.
    < 10 AB → 1.0 (ignore)
    10-19 AB → 50% weight
    20+ AB → full weight
    """
    ab  = int(safe(matchup.get('career_ab', 0)))
    avg = safe(matchup.get('career_avg', 0))
    if ab < 10 or avg <= 0:
        return 1.0
    raw = max(0.65, min(1.50, avg / LEAGUE_AVG['baa']))
    weight = 1.0 if ab >= 20 else 0.5
    return 1.0 + (raw - 1.0) * weight


def career_matchup_ops_f(matchup: dict) -> float:
    """career_ops / 0.728. Cap 0.65-1.50. Used for TB."""
    ab  = int(safe(matchup.get('career_ab', 0)))
    ops = safe(matchup.get('career_ops', 0))
    if ab < 20 or ops <= 0:
        return 1.0
    return max(0.65, min(1.50, ops / LEAGUE_AVG['ops']))


def career_matchup_hr_f(matchup: dict, season_hr_rate: float) -> float:
    """(career_hr / career_ab) vs season_hr_rate. Cap 0.50-2.00."""
    ab       = int(safe(matchup.get('career_ab', 0)))
    career_hr = safe(matchup.get('career_hr', 0))
    if ab < 20 or season_hr_rate <= 0:
        return 1.0
    career_hr_rate = career_hr / ab
    return max(0.50, min(2.00, career_hr_rate / season_hr_rate))


def sp_hr9_factor(sp_logs: list) -> float:
    """sp_hr9 / 1.35 → fly-ball pitcher > 1.0. Cap 0.60-1.80."""
    if len(sp_logs) < 3:
        return 1.0
    sp_hr9 = compute_sp_hr9(sp_logs)
    return max(0.60, min(1.80, sp_hr9 / LEAGUE_AVG['hr_per_9']))


def sp_whip_rbi_f(sp_logs: list) -> float:
    """
    SP WHIP as RBI factor: high WHIP = more runners = more RBI chances.
    Per spec: > 1.50 → 1.12  |  < 1.10 → 0.88  |  else ratio. Cap 0.80-1.25.
    """
    if len(sp_logs) < 3:
        return 1.0
    whip = compute_sp_season_whip(sp_logs)
    if whip <= 0:
        return 1.0
    if whip > 1.50:
        return min(1.25, 1.12 * (whip / 1.50))
    if whip < 1.10:
        return max(0.80, 0.88 * (whip / 1.10))
    return max(0.80, min(1.25, whip / LEAGUE_AVG['whip']))


def fip_vs_era_f(sp_logs: list) -> float:
    """
    FIP vs ERA regression factor.
    FIP < ERA − 0.75 → ×0.87 (ERA will drop — been lucky)
    FIP < ERA − 0.40 → ×0.93
    FIP > ERA + 0.75 → ×1.10 (ERA will rise)
    FIP > ERA + 0.40 → ×1.06
    """
    if len(sp_logs) < 5:
        return 1.0
    fip  = compute_sp_fip(sp_logs)
    era  = compute_sp_l5_era(sp_logs)
    if era <= 0:
        return 1.0
    diff = fip - era   # positive = FIP higher than ERA
    if diff > 0.75:    return 1.10
    if diff > 0.40:    return 1.06
    if diff < -0.75:   return 0.87
    if diff < -0.40:   return 0.93
    return max(0.85, min(1.15, 1.0 + diff * 0.14))


def arsenal_whiff_k_f(whiff_rate: Optional[float]) -> float:
    """weighted_whiff / 0.245. Cap 0.65-1.45."""
    if whiff_rate is None:
        return 1.0
    return max(0.65, min(1.45, whiff_rate / 0.245))


def arsenal_fb_proxy_f(whiff_rate: Optional[float]) -> float:
    """
    Contact vs fly-ball pitcher proxy from whiff rate.
    Low whiff (<0.20) = contact pitcher = more balls in play, more TB/HR risk.
    High whiff (>0.30) = strikeout pitcher = fewer balls in play.
    """
    if whiff_rate is None:
        return 1.0
    if whiff_rate > 0.30:   return 0.90
    if whiff_rate < 0.20:   return 1.12
    return 1.00


def arsenal_tb_f(whiff_rate: Optional[float]) -> float:
    """TB arsenal factor: high whiff = 0.95 (fewer balls), low = 1.05."""
    if whiff_rate is None:
        return 1.0
    if whiff_rate > 0.30:   return 0.95
    if whiff_rate < 0.20:   return 1.05
    return 1.00


def arsenal_gb_proxy_f(whiff_rate: Optional[float]) -> float:
    """ER ground-ball proxy: low whiff = GB pitcher = fewer HR."""
    if whiff_rate is None:
        return 1.0
    if whiff_rate > 0.30:   return 1.08   # fly-ball → more HR risk
    if whiff_rate < 0.20:   return 0.90   # GB → fewer HR
    return 1.00


def arsenal_velo_trend_f(arsenal: list) -> float:
    """
    Primary pitch velocity vs league-average per pitch type.
    Rough league avgs: FF=94, SI=93, CH=86, SL=86, CU=79, KC=82.
    −1.5 mph below → ×0.91 (fatigue)  |  +1.0 above → ×1.05
    """
    PITCH_AVG_VELO = {'FF': 94.0, 'FT': 93.0, 'SI': 93.0, 'FC': 89.0,
                      'CH': 86.0, 'FS': 85.0, 'SL': 86.0, 'ST': 84.0,
                      'CU': 79.0, 'KC': 82.0, 'SV': 82.0, 'EP': 72.0}
    if not arsenal:
        return 1.0
    # Get primary pitch
    rows = [r for r in arsenal if r.get('usage_pct') and r.get('velocity')]
    if not rows:
        return 1.0
    primary = max(rows, key=lambda r: safe(r['usage_pct']))
    ptype = primary.get('pitch_type', '')
    velo  = safe(primary.get('velocity', 0))
    avg   = PITCH_AVG_VELO.get(ptype, 88.0)
    if velo <= 0 or avg <= 0:
        return 1.0
    diff = velo - avg
    if diff < -1.5:   return 0.91
    if diff > 1.0:    return 1.05
    return 1.00


def umpire_k_f(ump: dict) -> float:
    """ump K/game / 16.2. Cap 0.88-1.14."""
    k = ump.get('k_per_game', 0)
    if k <= 0:
        return 1.0
    return max(0.88, min(1.14, k / LEAGUE_AVG['k_per_game']))


def umpire_bb_f(ump: dict) -> float:
    """ump BB/game / 3.35. Cap 0.88-1.15."""
    bb = ump.get('bb_per_game', 0)
    if bb <= 0:
        return 1.0
    return max(0.88, min(1.15, bb / LEAGUE_AVG['bb_per_game_team']))


def umpire_runs_f(ump: dict) -> float:
    """ump runs/game / 8.8 (combined). Cap 0.90-1.12."""
    runs = ump.get('runs_per_game', 0)
    if runs <= 0:
        return 1.0
    return max(0.90, min(1.12, runs / LEAGUE_AVG['game_total']))


def days_rest_k_f(days: int) -> float:
    if days <= 3:   return 0.87
    if days == 4:   return 0.97
    if days == 5:   return 1.00
    return 0.97   # 6+ rust


def days_rest_bb_f(days: int) -> float:
    if days <= 3:   return 1.18
    if days == 4:   return 0.98
    if days == 5:   return 1.00
    return 1.03


def days_rest_er_f(days: int) -> float:
    if days <= 3:   return 1.08
    if days == 4:   return 1.03
    if days == 5:   return 1.00
    return 1.02


def teammates_obp_factor(team_obp: float) -> float:
    """Per spec: team OBP of batters hitting ahead → RBI multiplier."""
    if team_obp > 0.350:   return 1.08
    if team_obp > 0.330:   return 1.04
    if team_obp < 0.280:   return 0.88
    if team_obp < 0.300:   return 0.93
    return 1.00


def get_team_obp(team_logs: list) -> float:
    """Approximate team OBP from runs scored (proxy)."""
    if not team_logs:
        return LEAGUE_AVG['obp']
    avg_runs = new_weighted_avg(team_logs, 'points_scored') if team_logs else LEAGUE_AVG['team_runs_per_game']
    obp = LEAGUE_AVG['obp'] + (avg_runs - LEAGUE_AVG['team_runs_per_game']) * (0.01 / 0.3)
    return max(0.270, min(0.370, obp))


def get_batter_obp_from_logs(batter_logs: list) -> float:
    """Return season OBP for a single batter from their game logs."""
    return compute_obp(batter_logs, len(batter_logs)) if batter_logs else LEAGUE_AVG['obp']


def get_teammates_obp(conn, lineup: list, pos: int) -> float:
    """
    GAP 6: Real OBP of the 3 batters hitting ahead of 'pos' in the lineup.
    lineup: list of dicts with 'id' and 'batting_order'
    pos: 1-based batting order position of the batter we're projecting
    Returns avg OBP of up to 3 slots ahead (wrapping around the lineup).
    """
    ahead_ids = []
    for offset in (-1, -2, -3):
        slot = ((pos - 1 + offset) % 9) + 1  # wrap: slot 1 → preceding is slot 9
        for b in lineup:
            if b.get('batting_order') == slot:
                ahead_ids.append(b['id'])
                break

    if not ahead_ids:
        return LEAGUE_AVG['obp']

    obp_vals = []
    for pid in ahead_ids:
        logs = get_batter_logs(conn, pid, 30)
        if logs:
            obp_vals.append(get_batter_obp_from_logs(logs))

    return round(sum(obp_vals) / len(obp_vals), 3) if obp_vals else LEAGUE_AVG['obp']


def get_teammates_rbi_rate(conn, lineup: list, pos: int) -> float:
    """
    GAP 7: Real RBI/game of the 3 batters hitting behind 'pos' in the lineup.
    Used in project_runs_scored() — batters behind you drive you in.
    """
    behind_ids = []
    for offset in (1, 2, 3):
        slot = ((pos - 1 + offset) % 9) + 1
        for b in lineup:
            if b.get('batting_order') == slot:
                behind_ids.append(b['id'])
                break

    if not behind_ids:
        return LEAGUE_AVG['rbi_per_game']

    rbi_vals = []
    for pid in behind_ids:
        logs = get_batter_logs(conn, pid, 20)
        if logs:
            avg_rbi = new_weighted_avg(logs, 'rebounds')
            if avg_rbi > 0:
                rbi_vals.append(avg_rbi)

    return round(sum(rbi_vals) / len(rbi_vals), 3) if rbi_vals else LEAGUE_AVG['rbi_per_game']


def opp_lineup_hand_f(lineup_splits: list, sp_hand: str) -> float:
    """
    GAP 8: Real handedness factor using bat_side from player_splits.
    lineup_splits: list of splits dicts for batters in this lineup.
    If SP is RHP and >55% of lineup is LHB  → pitchers struggle → batters benefit
    If SP is RHP and <35% LHB (mostly RHB)  → platoon disadvantage for batters
    Same logic mirrored for LHP.
    """
    if not lineup_splits:
        return 1.00

    sides = [s.get('bat_side') for s in lineup_splits if s.get('bat_side')]
    if len(sides) < 5:
        return 1.00   # not enough data

    lhb = sum(1 for s in sides if s == 'L')
    rhb = sum(1 for s in sides if s == 'R')
    total = lhb + rhb
    if total == 0:
        return 1.00

    pct_lhb = lhb / total
    pct_rhb = rhb / total

    if sp_hand == 'R':
        if pct_lhb > 0.55:  return 1.05   # mostly LHBs vs RHP → LHBs get platoon adv
        if pct_rhb > 0.65:  return 0.95   # mostly RHBs vs RHP → platoon disadvantage
    elif sp_hand == 'L':
        if pct_rhb > 0.55:  return 1.05   # mostly RHBs vs LHP → platoon advantage
        if pct_lhb > 0.65:  return 0.95   # mostly LHBs vs LHP → platoon disadvantage
    return 1.00


def is_day_game(game_time: str) -> bool:
    """True if game starts before 5pm ET (rough heuristic)."""
    try:
        # game_datetime from statsapi is ISO8601 UTC
        hour_utc = int(game_time[11:13]) if len(game_time) >= 13 else 20
        # ET = UTC - 4 (EDT summer)
        hour_et = (hour_utc - 4) % 24
        return hour_et < 17
    except Exception:
        return False


# ── Pitcher hand lookup ──────────────────────────────────────────────────────────

def get_pitcher_hand(player_id: int) -> str:
    try:
        resp = requests.get(
            f'https://statsapi.mlb.com/api/v1/people/{player_id}',
            timeout=10,
        )
        data = resp.json()
        for person in data.get('people', []):
            return person.get('pitchHand', {}).get('code', 'R')
    except Exception:
        pass
    return 'R'


# ── Batter projection functions ──────────────────────────────────────────────────

def project_hits(
    batter_logs: list,
    sp_logs:     list,
    weather:     dict,
    park:        dict,
    home_away:   str,
    lineup_pos:  int,
    confirmed:   bool,
    splits:      dict,
    sp_hand:     str,
    matchup:     dict,
    day_game:    bool,
) -> tuple:
    """
    proj_hits = base × platoon × sp_quality × sp_recent × matchup
                      × babip × pa × park_hit × weather × day_night × home_away
    """
    base = new_weighted_avg(batter_logs, 'fg_made') if batter_logs else LEAGUE_AVG['hits_per_game']
    if base <= 0:
        base = LEAGUE_AVG['hits_per_game']

    season_avg = compute_season_ba(batter_logs) if batter_logs else LEAGUE_AVG['ba']

    pt_f    = platoon_hits_f(splits, sp_hand, season_avg)
    spq_f   = sp_quality_f(sp_logs)
    spr_f   = sp_recent_form_f(sp_logs)
    match_f = career_matchup_hits_f(matchup)
    babip_f = babip_regression_f(batter_logs)
    pa_f    = lineup_pa_factor(lineup_pos, confirmed)
    park_f  = park.get('hits', 1.0)
    wx_f    = weather_hits_factor(weather, park.get('name', ''))
    dn_f    = day_night_f(splits, day_game, season_avg)
    ha_f    = home_away_factor_for_col(batter_logs, 'fg_made', home_away)

    proj = base * pt_f * spq_f * spr_f * match_f * babip_f * pa_f * park_f * wx_f * dn_f * ha_f

    factors = {
        'base': round(base, 3),
        'platoon_f': round(pt_f, 3),
        'sp_quality_f': round(spq_f, 3),
        'sp_recent_f': round(spr_f, 3),
        'matchup_f': round(match_f, 3),
        'career_ab': int(safe(matchup.get('career_ab', 0))),
        'babip_f': round(babip_f, 3),
        'babip': round(compute_babip(batter_logs), 3) if batter_logs else None,
        'lineup_pa_f': round(pa_f, 3),
        'park_hit_f': round(park_f, 3),
        'weather_f': round(wx_f, 3),
        'day_night_f': round(dn_f, 3),
        'home_away_f': round(ha_f, 3),
        'sp_hand': sp_hand,
        'lineup_confirmed': confirmed,
    }
    return round(max(0.0, proj), 3), factors


def project_total_bases(
    batter_logs: list,
    sp_logs:     list,
    weather:     dict,
    park:        dict,
    home_away:   str,
    lineup_pos:  int,
    splits:      dict,
    sp_hand:     str,
    matchup:     dict,
    whiff_rate:  object,  # float or None
) -> tuple:
    """
    proj_tb = base × iso × platoon_slg × sp_hr9 × matchup_ops
                   × wind × temp × park_hr × altitude × home_away × arsenal_tb
    """
    using_player_logs = False
    if batter_logs:
        hits = new_weighted_avg(batter_logs, 'fg_made')
        dbls = new_weighted_avg(batter_logs, 'off_reb')
        trpl = new_weighted_avg(batter_logs, 'def_reb')
        hrs  = new_weighted_avg(batter_logs, 'three_made')
        sg   = max(0, hits - dbls - trpl - hrs)
        base = sg + 2*dbls + 3*trpl + 4*hrs
        if base <= 0:
            base = LEAGUE_AVG['tb_per_game']
        else:
            using_player_logs = True
    else:
        base = LEAGUE_AVG['tb_per_game']

    iso       = compute_iso(batter_logs, 20) if batter_logs else LEAGUE_AVG['iso']
    # iso_f only applied when base is league average; player logs already reflect power
    iso_f     = 1.0 if using_player_logs else max(0.50, min(2.00, iso / LEAGUE_AVG['iso']))
    szn_slg   = compute_season_slg(batter_logs) if batter_logs else LEAGUE_AVG['slg']
    pt_slg_f  = platoon_slg_f(splits, sp_hand, szn_slg)
    sp_hr_f   = sp_hr9_factor(sp_logs)
    match_f   = career_matchup_ops_f(matchup)
    wind_f    = weather_tb_wind_factor(weather, park.get('name', ''))
    temp_f    = weather_tb_temp_factor(weather)
    park_hr_f = park.get('hr', 1.0)
    alt       = park.get('altitude_ft', 100)
    alt_f     = 1.12 if alt >= 5000 else (1.02 if alt >= 1000 else 1.00)
    ha_f      = home_away_factor_for_col(batter_logs, 'three_made', home_away) if batter_logs else 1.0
    arsen_f   = arsenal_tb_f(whiff_rate)

    proj = base * iso_f * pt_slg_f * sp_hr_f * match_f * wind_f * temp_f * park_hr_f * alt_f * ha_f * arsen_f

    factors = {
        'base': round(base, 3),
        'iso_f': round(iso_f, 3),
        'iso': round(iso, 3),
        'platoon_slg_f': round(pt_slg_f, 3),
        'sp_hr9_f': round(sp_hr_f, 3),
        'matchup_ops_f': round(match_f, 3),
        'wind_f': round(wind_f, 3),
        'temp_f': round(temp_f, 3),
        'park_hr_f': round(park_hr_f, 3),
        'altitude_f': round(alt_f, 3),
        'home_away_f': round(ha_f, 3),
        'arsenal_tb_f': round(arsen_f, 3),
        'sp_hand': sp_hand,
    }
    return round(max(0.0, proj), 3), factors


def project_home_runs(
    batter_logs: list,
    sp_logs:     list,
    weather:     dict,
    park:        dict,
    home_away:   str,
    lineup_pos:  int,
    splits:      dict,
    sp_hand:     str,
    matchup:     dict,
    whiff_rate:  object,
    ump:         dict,
) -> tuple:
    """
    proj_hr = base × iso × platoon_hr × sp_hr9 × fb_proxy
                   × matchup_hr × wind_out × temp × park_hr × altitude × ump
    """
    base = new_weighted_avg(batter_logs, 'three_made') if batter_logs else LEAGUE_AVG['hr_per_game']
    if base <= 0:
        base = LEAGUE_AVG['hr_per_game']

    iso       = compute_iso(batter_logs, 20) if batter_logs else LEAGUE_AVG['iso']
    iso_f     = max(0.40, min(2.50, iso / LEAGUE_AVG['iso']))
    szn_hr_r  = compute_season_hr_rate(batter_logs) if batter_logs else 0.034
    pt_hr_f   = platoon_hr_f(splits, sp_hand, szn_hr_r)
    sp_hr9_f_ = sp_hr9_factor(sp_logs)
    fb_f      = arsenal_fb_proxy_f(whiff_rate)
    match_f   = career_matchup_hr_f(matchup, szn_hr_r)
    wind_f    = weather_hr_wind_factor(weather, park.get('name', ''))
    temp_f    = weather_hr_temp_factor(weather)
    park_hr_f = park.get('hr', 1.0)
    alt       = park.get('altitude_ft', 100)
    alt_f     = 1.38 if alt >= 5000 else (1.04 if alt >= 1000 else 1.00)
    ump_f_val = max(0.97, min(1.05, umpire_runs_f(ump)))  # subtle ump effect on HR

    proj = base * iso_f * pt_hr_f * sp_hr9_f_ * fb_f * match_f * wind_f * temp_f * park_hr_f * alt_f * ump_f_val

    factors = {
        'base': round(base, 4),
        'iso_f': round(iso_f, 3),
        'platoon_hr_f': round(pt_hr_f, 3),
        'sp_hr9_f': round(sp_hr9_f_, 3),
        'fb_proxy_f': round(fb_f, 3),
        'matchup_hr_f': round(match_f, 3),
        'wind_out_f': round(wind_f, 3),
        'temp_f': round(temp_f, 3),
        'park_hr_f': round(park_hr_f, 3),
        'altitude_f': round(alt_f, 3),
        'ump_f': round(ump_f_val, 3),
        'sp_hand': sp_hand,
    }
    return round(max(0.0, proj), 4), factors


def project_rbi(
    batter_logs:   list,
    sp_logs:       list,
    weather:       dict,
    park:          dict,
    home_away:     str,
    lineup_pos:    int,
    splits:        dict,
    sp_hand:       str,
    matchup:       dict,
    team_obp:      float,
    ump:           dict,
    bullpen_tired: bool,
    game_total:    float = 8.8,
) -> tuple:
    """
    proj_rbi = base × risp × lineup_pos × teammates_obp × sp_whip
                    × platoon × matchup × total_f × park_run × weather × bullpen
    """
    base = new_weighted_avg(batter_logs, 'rebounds') if batter_logs else LEAGUE_AVG['rbi_per_game']
    if base <= 0:
        base = LEAGUE_AVG['rbi_per_game']

    risp_f_val  = risp_rbi_f(splits)
    lp_f        = lineup_rbi_factor(lineup_pos)
    tobp_f      = teammates_obp_factor(team_obp)
    whip_f      = sp_whip_rbi_f(sp_logs)
    season_avg  = compute_season_ba(batter_logs) if batter_logs else LEAGUE_AVG['ba']
    pt_f        = platoon_hits_f(splits, sp_hand, season_avg)
    match_f     = career_matchup_hits_f(matchup)
    total_f     = max(0.80, min(1.30, game_total / LEAGUE_AVG['game_total']))
    park_run_f  = park.get('runs', 1.0)
    wx_f        = weather_scoring_factor(weather, park.get('name', ''))
    bp_f        = 1.05 if bullpen_tired else 1.00

    proj = base * risp_f_val * lp_f * tobp_f * whip_f * pt_f * match_f * total_f * park_run_f * wx_f * bp_f

    factors = {
        'base': round(base, 3),
        'risp_f': round(risp_f_val, 3),
        'lineup_pos_f': round(lp_f, 3),
        'teammates_obp_f': round(tobp_f, 3),
        'team_obp': round(team_obp, 3),
        'sp_whip_f': round(whip_f, 3),
        'platoon_f': round(pt_f, 3),
        'matchup_f': round(match_f, 3),
        'total_f': round(total_f, 3),
        'game_total': round(game_total, 2),
        'park_run_f': round(park_run_f, 3),
        'weather_scoring_f': round(wx_f, 3),
        'bullpen_f': round(bp_f, 3),
        'sp_hand': sp_hand,
    }
    return round(max(0.0, proj), 3), factors


def project_runs_scored(
    batter_logs:   list,
    sp_logs:       list,
    weather:       dict,
    park:          dict,
    home_away:     str,
    lineup_pos:    int,
    splits:        dict,
    sp_hand:       str,
    team_rbi_avg:  float,   # avg RBI rate of batters hitting behind
    ump:           dict,
    game_total:    float = 8.8,
) -> tuple:
    """
    proj_runs = base × obp × lineup_pos × speed × teammates_rbi
                     × sp_whip × platoon × total_f × home_away × park_run
    """
    base = new_weighted_avg(batter_logs, 'points') if batter_logs else LEAGUE_AVG['runs_per_game']
    if base <= 0:
        base = LEAGUE_AVG['runs_per_game']

    obp_val  = compute_obp(batter_logs, 20) if batter_logs else LEAGUE_AVG['obp']
    obp_f    = max(0.70, min(1.40, obp_val / LEAGUE_AVG['obp']))
    lp_f     = lineup_runs_factor(lineup_pos)

    # Speed factor: 0.90 + (sb_rate / 0.09 × 0.10)
    sb_rate  = new_weighted_avg(batter_logs, 'steals') if batter_logs else LEAGUE_AVG['sb_rate']
    speed_f  = max(0.90, min(1.15, 0.90 + (sb_rate / LEAGUE_AVG['sb_rate']) * 0.10))

    # Teammates RBI factor: RBI rate of batters 2-4 spots behind
    tm_rbi_f = max(0.88, min(1.12, team_rbi_avg / LEAGUE_AVG['rbi_per_game'])) if team_rbi_avg > 0 else 1.0

    whip_f   = sp_whip_rbi_f(sp_logs)
    season_avg = compute_season_ba(batter_logs) if batter_logs else LEAGUE_AVG['ba']
    pt_f     = platoon_hits_f(splits, sp_hand, season_avg)
    total_f  = max(0.80, min(1.30, game_total / LEAGUE_AVG['game_total']))
    ha_f     = home_away_factor_for_col(batter_logs, 'points', home_away) if batter_logs else 1.0
    park_f   = park.get('runs', 1.0)

    proj = base * obp_f * lp_f * speed_f * tm_rbi_f * whip_f * pt_f * total_f * ha_f * park_f

    factors = {
        'base': round(base, 3),
        'obp_f': round(obp_f, 3),
        'obp': round(obp_val, 3),
        'lineup_pos_f': round(lp_f, 3),
        'speed_f': round(speed_f, 3),
        'sb_rate': round(sb_rate, 3),
        'teammates_rbi_f': round(tm_rbi_f, 3),
        'sp_whip_f': round(whip_f, 3),
        'platoon_f': round(pt_f, 3),
        'total_f': round(total_f, 3),
        'home_away_f': round(ha_f, 3),
        'park_run_f': round(park_f, 3),
        'sp_hand': sp_hand,
    }
    return round(max(0.0, proj), 3), factors


def project_stolen_bases(
    batter_logs:      list,
    sp_logs:          list,
    home_away:        str,
    lineup_pos:       int,
    sp_hand:          str,
    opp_sb_per_game:  float,
    splits:           dict   = None,
    live_ml:          float  = None,   # GAP 11: live implied moneyline for this batter's team
) -> tuple:
    """
    proj_sb = base × sb_rate × obp × success × pitcher_hold
                   × catcher × game_script × lineup_pos
    Only meaningful for players with > 8 SB or > 0.15 SB/game.
    """
    base = new_weighted_avg(batter_logs, 'steals') if batter_logs else 0.0
    if base <= 0:
        return 0.0, {'base': 0.0, 'skipped': 'insufficient_sb_history'}

    sb_rate_f  = max(0.10, min(5.0, base / LEAGUE_AVG['sb_rate']))
    if sb_rate_f < 1.5:
        return round(base, 3), {'base': round(base, 3), 'sb_rate_f': round(sb_rate_f, 3), 'below_threshold': True}

    obp_val    = compute_obp(batter_logs, 20) if batter_logs else LEAGUE_AVG['obp']
    obp_f      = max(0.70, min(1.40, obp_val / LEAGUE_AVG['obp']))

    # GAP 9: Real caught-stealing success rate from player_splits
    sb_sr = float(splits.get('sb_success_rate') or 0) if splits else 0
    if sb_sr > 0:
        # 78% is league average → factor is sb_sr / 0.78
        success_f = max(0.80, min(1.25, sb_sr / 0.78))
    else:
        success_f = 1.05   # fallback: slightly above average (insufficient CS data)

    # Pitcher hold: LHP holds runners better
    hold_f     = 0.85 if sp_hand == 'L' else 1.10

    # Catcher factor: proxy from opp SB allowed vs league avg
    league_sb_allowed = LEAGUE_AVG['sb_rate'] * 9
    catcher_f  = max(0.88, min(1.12, opp_sb_per_game / league_sb_allowed)) if league_sb_allowed > 0 else 1.0

    # GAP 11: Game script — heavy favourites run up score less on SB
    # live_ml is this batter's team moneyline (e.g. -210 means heavy fav)
    gs_f = 1.00
    if live_ml is not None and live_ml <= -200:
        gs_f = 0.82   # heavy favourite team → less likely to steal late
    elif live_ml is not None and live_ml >= 160:
        gs_f = 1.10   # heavy underdog → more aggressive running

    lp_f       = lineup_sb_factor(lineup_pos)

    proj = base * sb_rate_f * obp_f * success_f * hold_f * catcher_f * gs_f * lp_f

    factors = {
        'base': round(base, 3),
        'sb_rate_f': round(sb_rate_f, 3),
        'obp_f': round(obp_f, 3),
        'success_f': round(success_f, 3),
        'sb_success_rate': round(sb_sr, 3) if sb_sr else None,
        'pitcher_hold_f': round(hold_f, 3),
        'catcher_f': round(catcher_f, 3),
        'game_script_f': round(gs_f, 3),
        'live_ml': live_ml,
        'lineup_pos_f': round(lp_f, 3),
        'sp_hand': sp_hand,
    }
    return round(max(0.0, proj), 3), factors


# ── Pitcher projection functions ─────────────────────────────────────────────────

def project_strikeouts(
    sp_logs:           list,
    opp_logs:          list,   # opponent team_game_logs
    weather:           dict,
    home_away:         str,
    opp_k_rate:        float,
    days_rest:         int,
    sp_hand:           str,
    arsenal:           list,
    ump:               dict,
    opp_lineup_splits: list = None,  # GAP 8: splits dicts for opp lineup batters
) -> tuple:
    """
    proj_k = base × arsenal × trend × velo × opp_k × hand_lineup
                  × ump_k × innings × rest × home_away × fp_proxy
    """
    base = new_weighted_avg(sp_logs, 'assists') if sp_logs else LEAGUE_AVG['k_per_9'] * 5.5 / 9
    if base <= 0:
        base = LEAGUE_AVG['k_per_9'] * 5.5 / 9

    whiff_rate = get_arsenal_weighted_whiff(arsenal)
    ars_f      = arsenal_whiff_k_f(whiff_rate)

    # K/9 trend: L5 vs season
    if len(sp_logs) >= 5:
        l5_k9  = compute_sp_k9(sp_logs, 5)
        szn_k9 = compute_sp_k9(sp_logs)
        trend_f = max(0.70, min(1.30, l5_k9 / szn_k9)) if szn_k9 > 0 else 1.0
    else:
        trend_f = 1.0

    # Velocity trend
    velo_f = arsenal_velo_trend_f(arsenal)

    # Opponent K rate
    opp_k_f = max(0.82, min(1.20, opp_k_rate / LEAGUE_AVG['k_pct']))

    # GAP 8: Real handedness factor from opp batter splits
    hand_f = opp_lineup_hand_f(opp_lineup_splits or [], sp_hand)

    # Umpire K factor
    ump_k  = umpire_k_f(ump)

    # Innings factor: proj_ip / 6.0
    proj_ip = compute_sp_avg_ip(sp_logs, 5)
    inn_f   = max(0.50, min(1.40, proj_ip / 6.0))

    # Rest factor
    rest_f = days_rest_k_f(days_rest)

    # Home/away K split
    ha_f = home_away_factor_for_col(sp_logs, 'assists', home_away) if sp_logs else 1.0

    # First pitch strike proxy: low BB/9 = better command
    bb9    = compute_sp_bb9(sp_logs)
    fp_f   = 1.04 if bb9 < 2.5 else (0.94 if bb9 > 3.5 else 1.00)

    proj = base * ars_f * trend_f * velo_f * opp_k_f * hand_f * ump_k * inn_f * rest_f * ha_f * fp_f

    factors = {
        'base': round(base, 3),
        'arsenal_f': round(ars_f, 3),
        'weighted_whiff': round(whiff_rate, 3) if whiff_rate else None,
        'k9_trend_f': round(trend_f, 3),
        'velo_trend_f': round(velo_f, 3),
        'opp_k_rate_f': round(opp_k_f, 3),
        'hand_lineup_f': round(hand_f, 3),
        'ump_k_f': round(ump_k, 3),
        'ump_name': ump.get('ump_name', None),
        'innings_f': round(inn_f, 3),
        'proj_ip': round(proj_ip, 2),
        'days_rest_f': round(rest_f, 3),
        'home_away_f': round(ha_f, 3),
        'fp_proxy_f': round(fp_f, 3),
        'bb9': round(bb9, 3),
    }
    return round(max(0.0, proj), 3), factors


def project_earned_runs(
    sp_logs:   list,
    opp_logs:  list,
    weather:   dict,
    park:      dict,
    home_away: str,
    days_rest: int,
    whiff_rate: object,
) -> tuple:
    """
    proj_er = base × fip × hr9 × whip × opp_offense × park_hr
                   × wind × temp × rest × innings × gb_proxy
    """
    base = new_weighted_avg(sp_logs, 'points') if sp_logs else LEAGUE_AVG['era'] * 5.0 / 9
    if base <= 0:
        base = LEAGUE_AVG['era'] * 5.0 / 9

    fip_f      = fip_vs_era_f(sp_logs)
    hr9_f      = sp_hr9_factor(sp_logs)
    whip_f_val = max(0.75, min(1.40, compute_sp_season_whip(sp_logs) / LEAGUE_AVG['whip'])) if sp_logs else 1.0

    opp_runs   = new_weighted_avg(opp_logs, 'points_scored') if opp_logs else LEAGUE_AVG['team_runs_per_game']
    opp_off_f  = max(0.80, min(1.25, opp_runs / LEAGUE_AVG['team_runs_per_game'])) if opp_runs > 0 else 1.0

    park_hr_f  = park.get('hr', 1.0)
    wind_f     = weather_tb_wind_factor(weather, park.get('name', ''))
    temp_f     = weather_tb_temp_factor(weather)
    rest_f     = days_rest_er_f(days_rest)

    # Innings exposure
    proj_ip    = compute_sp_avg_ip(sp_logs, 5)
    era_szn    = compute_sp_season_era(sp_logs) if sp_logs else LEAGUE_AVG['era']
    inn_f      = max(0.50, min(1.50, proj_ip * era_szn / 9 / base)) if base > 0 else 1.0

    # GB proxy from arsenal
    gb_f       = arsenal_gb_proxy_f(whiff_rate)

    proj = base * fip_f * hr9_f * whip_f_val * opp_off_f * park_hr_f * wind_f * temp_f * rest_f * gb_f

    factors = {
        'base': round(base, 3),
        'fip_vs_era_f': round(fip_f, 3),
        'fip': round(compute_sp_fip(sp_logs), 3) if sp_logs else None,
        'era_recent': round(compute_sp_l5_era(sp_logs), 3) if sp_logs else None,
        'hr9_f': round(hr9_f, 3),
        'whip_f': round(whip_f_val, 3),
        'opp_off_f': round(opp_off_f, 3),
        'park_hr_f': round(park_hr_f, 3),
        'wind_f': round(wind_f, 3),
        'temp_f': round(temp_f, 3),
        'days_rest_f': round(rest_f, 3),
        'gb_proxy_f': round(gb_f, 3),
        'proj_ip': round(proj_ip, 2),
    }
    return round(max(0.0, proj), 3), factors


def project_walks(
    sp_logs:    list,
    opp_logs:   list,
    weather:    dict,
    home_away:  str,
    days_rest:  int,
    ump:        dict,
    whiff_rate: object,
) -> tuple:
    """
    proj_bb = base × command × patience × ump_bb × rest × cold_wx × arsenal_ctrl × innings
    """
    base = new_weighted_avg(sp_logs, 'turnovers') if sp_logs else LEAGUE_AVG['bb_per_9'] * 5.5 / 9
    if base <= 0:
        base = LEAGUE_AVG['bb_per_9'] * 5.5 / 9

    # BB/9 trend
    if len(sp_logs) >= 5:
        l5_bb9  = compute_sp_bb9(sp_logs, 5)
        szn_bb9 = compute_sp_bb9(sp_logs)
        if szn_bb9 > 0:
            if l5_bb9 > szn_bb9 + 0.5:  command_f = 1.12
            elif l5_bb9 < szn_bb9 - 0.5: command_f = 0.90
            else:                         command_f = 1.00
        else:
            command_f = 1.00
    else:
        command_f = 1.00

    # Opponent patience (BB drawn proxy: not in team logs, use neutral)
    patience_f = 1.00   # team_game_logs lacks BB-drawn column

    ump_bb     = umpire_bb_f(ump)
    rest_f     = days_rest_bb_f(days_rest)
    cold_f     = weather_cold_grip_factor(weather)

    # Arsenal control factor: elite stuff = challenge hitters
    if whiff_rate is not None:
        ars_ctrl_f = 0.94 if whiff_rate > 0.30 else (1.06 if whiff_rate < 0.20 else 1.00)
    else:
        ars_ctrl_f = 1.00

    # Innings factor
    proj_ip = compute_sp_avg_ip(sp_logs, 5)
    inn_f   = max(0.50, min(1.40, proj_ip / 6.0))

    proj = base * command_f * patience_f * ump_bb * rest_f * cold_f * ars_ctrl_f * inn_f

    factors = {
        'base': round(base, 3),
        'command_f': round(command_f, 3),
        'patience_f': round(patience_f, 3),
        'ump_bb_f': round(ump_bb, 3),
        'days_rest_f': round(rest_f, 3),
        'cold_weather_f': round(cold_f, 3),
        'arsenal_ctrl_f': round(ars_ctrl_f, 3),
        'innings_f': round(inn_f, 3),
        'proj_ip': round(proj_ip, 2),
    }
    return round(max(0.0, proj), 3), factors


def project_outs_recorded(
    sp_logs:      list,
    weather:      dict,
    home_away:    str,
    days_rest:    int,
    bullpen_tired: bool,
    opp_logs:     list,
    arsenal:      list,
) -> tuple:
    """
    proj_outs = base_outs × efficiency × game_script × bullpen
                          × opp_quality × rest × home_away × arsenal
    """
    avg_ip = compute_sp_avg_ip(sp_logs, 5) if sp_logs else 5.0
    base   = avg_ip * 3   # outs = IP × 3

    # Pitch efficiency proxy: L5 IP vs season IP
    if len(sp_logs) >= 5:
        l5_ip   = rolling_avg(sp_logs, 'minutes', 5)
        szn_ip  = rolling_avg(sp_logs, 'minutes', len(sp_logs))
        eff_f   = max(0.80, min(1.15, l5_ip / szn_ip)) if szn_ip > 0 else 1.0
    else:
        eff_f   = 1.0

    # Game script: neutral in projection phase
    gs_f    = 1.00

    # Bullpen: tired pen → starter goes deeper
    bp_f    = 1.05 if bullpen_tired else 1.00

    # Opponent quality: high-OPS lineup runs up pitch counts
    if opp_logs:
        opp_runs = new_weighted_avg(opp_logs, 'points_scored')
        opp_f    = max(0.90, min(1.10, LEAGUE_AVG['team_runs_per_game'] / opp_runs)) if opp_runs > 0 else 1.0
    else:
        opp_f    = 1.0

    rest_f   = 0.93 if days_rest <= 3 else (0.97 if days_rest == 4 else 1.00)

    ha_f     = home_away_factor_for_col(sp_logs, 'minutes', home_away) if sp_logs else 1.0

    whiff_r  = get_arsenal_weighted_whiff(arsenal)
    ars_f    = 1.05 if (whiff_r and whiff_r > 0.30) else (0.95 if (whiff_r and whiff_r < 0.20) else 1.00)

    proj = base * eff_f * gs_f * bp_f * opp_f * rest_f * ha_f * ars_f

    factors = {
        'base_ip': round(avg_ip, 3),
        'efficiency_f': round(eff_f, 3),
        'game_script_f': round(gs_f, 3),
        'bullpen_f': round(bp_f, 3),
        'opp_quality_f': round(opp_f, 3),
        'days_rest_f': round(rest_f, 3),
        'home_away_f': round(ha_f, 3),
        'arsenal_f': round(ars_f, 3),
    }
    return round(max(0.0, proj), 3), factors


# ── GAP 11/13: Live odds fetch ───────────────────────────────────────────────────

_live_odds_cache: dict = {}

def fetch_live_odds(home_team: str, away_team: str) -> dict:
    """
    Fetch live moneyline from The Odds API for this game.
    Returns {'home_ml': -150, 'away_ml': +130} or {} on failure.
    Cached per (home, away) for the model run.
    """
    key = f'{away_team}@{home_team}'
    if key in _live_odds_cache:
        return _live_odds_cache[key]

    api_key = os.getenv('ODDS_API_KEY', '')
    if not api_key:
        _live_odds_cache[key] = {}
        return {}

    try:
        url = 'https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/'
        params = {
            'apiKey': api_key,
            'regions': 'us',
            'markets': 'h2h',
            'oddsFormat': 'american',
        }
        r = requests.get(url, params=params, timeout=10)
        if not r.ok:
            log.warning(f'  [Odds API] HTTP {r.status_code}')
            _live_odds_cache[key] = {}
            return {}

        games = r.json()
        for game in games:
            ht = game.get('home_team', '').lower()
            at = game.get('away_team', '').lower()
            if home_team.lower()[:5] in ht or at in away_team.lower()[:5]:
                for bm in game.get('bookmakers', []):
                    for mkt in bm.get('markets', []):
                        if mkt.get('key') == 'h2h':
                            outcomes = mkt.get('outcomes', [])
                            result = {}
                            for o in outcomes:
                                price = o.get('price', 0)
                                if o.get('name', '').lower() in ht:
                                    result['home_ml'] = price
                                else:
                                    result['away_ml'] = price
                            if result:
                                _live_odds_cache[key] = result
                                return result

    except Exception as e:
        log.warning(f'  [Odds API] Fetch error: {e}')

    _live_odds_cache[key] = {}
    return {}


# ── GAP 12: Head-to-head total factor ────────────────────────────────────────────

def get_h2h_total_factor(conn, home_team: str, away_team: str) -> float:
    """
    GAP 12: Look up last 5 H2H meetings in team_game_logs.
    If avg total in those games > league avg + 1.0 → h2h_f 1.06
    If avg total < league avg - 1.0 → h2h_f 0.94
    Otherwise neutral 1.00.
    Applied at 0.10 weight in project_total().
    """
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t1.game_date,
                       t1.points_scored + t2.points_scored AS total_runs
                FROM team_game_logs t1
                JOIN team_game_logs t2
                  ON t1.game_date = t2.game_date
                 AND t1.sport = t2.sport
                 AND t1.season = t2.season
                 AND t1.team_name != t2.team_name
                WHERE t1.sport = 'MLB'
                  AND t1.team_name ILIKE %s
                  AND t2.team_name ILIKE %s
                  AND t1.points_scored IS NOT NULL
                  AND t2.points_scored IS NOT NULL
                ORDER BY t1.game_date DESC
                LIMIT 5
            """, (f'%{home_team[:6]}%', f'%{away_team[:6]}%'))
            rows = cur.fetchall()
    except Exception:
        return 1.00

    if len(rows) < 3:
        return 1.00   # insufficient history

    avg_total = sum(float(r[1]) for r in rows) / len(rows)
    league_avg = LEAGUE_AVG['game_total']

    if avg_total > league_avg + 1.0:
        raw_f = 1.06
    elif avg_total < league_avg - 1.0:
        raw_f = 0.94
    else:
        raw_f = 1.00

    # Apply at 0.10 weight: final_f = 1.0 + (raw_f - 1.0) * 0.10
    return round(1.0 + (raw_f - 1.0) * 0.10, 4)


# ── Team projection functions ────────────────────────────────────────────────────

def _project_team_runs(
    batting_logs: list,   # team_game_logs for the batting team
    opp_sp_logs:  list,   # SP logs for the opposing starter
    weather:      dict,
    park:         dict,
    is_home:      bool,
    ump:          dict,
    opp_bullpen_tired: bool,
) -> tuple:
    """Projected runs scored for one team."""
    base = new_weighted_avg(batting_logs, 'points_scored') if batting_logs else LEAGUE_AVG['team_runs_per_game']
    if base <= 0:
        base = LEAGUE_AVG['team_runs_per_game']

    # SP quality (strongest factor)
    sp_era_l5  = compute_sp_l5_era(opp_sp_logs) if opp_sp_logs else LEAGUE_AVG['era']
    sp_era_szn = compute_sp_season_era(opp_sp_logs) if opp_sp_logs else LEAGUE_AVG['era']
    sp_q_f     = max(0.65, min(1.45, sp_era_l5 / LEAGUE_AVG['era'])) if sp_era_l5 > 0 else 1.0

    # FIP adjustment (subtle)
    sp_fip     = compute_sp_fip(opp_sp_logs) if opp_sp_logs else LEAGUE_AVG['fip']
    fip_adj    = max(0.95, min(1.05, 1.0 + (sp_fip - sp_era_szn) * 0.05)) if sp_era_szn > 0 else 1.0

    # Team offense
    off_f      = max(0.75, min(1.35, base / LEAGUE_AVG['team_runs_per_game']))

    park_f     = park.get('runs', 1.0)
    wind_f     = weather_tb_wind_factor(weather, park.get('name', ''))
    temp_f     = weather_tb_temp_factor(weather)

    ump_runs   = umpire_runs_f(ump)

    bp_f       = 1.08 if opp_bullpen_tired else 1.00   # tired opp pen → more late runs

    hfa        = 0.15 if is_home else 0.0   # home teams score +0.3 raw per game

    proj = (base * sp_q_f * fip_adj * park_f * wind_f * temp_f * ump_runs * bp_f) + hfa

    factors = {
        'base': round(base, 3),
        'sp_quality_f': round(sp_q_f, 3),
        'sp_era_l5': round(sp_era_l5, 3),
        'fip_adj': round(fip_adj, 3),
        'park_runs_f': round(park_f, 3),
        'wind_f': round(wind_f, 3),
        'temp_f': round(temp_f, 3),
        'ump_runs_f': round(ump_runs, 3),
        'bullpen_f': round(bp_f, 3),
    }
    return round(max(0.0, proj), 3), factors


def project_total(
    home_logs: list, away_logs: list,
    home_sp_logs: list, away_sp_logs: list,
    weather: dict, park: dict, ump: dict,
    home_bullpen_tired: bool, away_bullpen_tired: bool,
    h2h_f: float = 1.00,   # GAP 12: head-to-head historical total factor
) -> tuple:
    proj_home, home_f = _project_team_runs(home_logs, away_sp_logs, weather, park, True,  ump, away_bullpen_tired)
    proj_away, away_f = _project_team_runs(away_logs, home_sp_logs, weather, park, False, ump, home_bullpen_tired)
    proj_total = (proj_home + proj_away) * h2h_f
    factors = {
        'home_runs_f': home_f,
        'away_runs_f': away_f,
        'proj_home_runs': round(proj_home, 3),
        'proj_away_runs': round(proj_away, 3),
        'altitude_f': 1.12 if park.get('altitude_ft', 0) >= 5000 else 1.0,
        'h2h_total_f': round(h2h_f, 4),
    }
    return round(proj_total, 3), proj_home, proj_away, factors


def project_run_line(
    proj_run_diff: float,
    home_ml: float = None,  # GAP 13: live home moneyline from Odds API
) -> tuple:
    """
    Underdogs historically cover +1.5 at ~58% — baked into std_dev.
    GAP 13: If home team is implied >-200 favourite, apply 0.91 regression
            to proj_run_diff (big favourites have compressed run differentials).
    Returns (home_cover_prob, away_cover_prob).
    """
    rl_diff = proj_run_diff
    regression_applied = False

    # Large-favourite regression: when implied ML > -200, winning margin shrinks
    if home_ml is not None and home_ml <= -200:
        rl_diff = proj_run_diff * 0.91
        regression_applied = True
    elif home_ml is not None and home_ml >= 200:
        # Away team is heavy fav — flip
        rl_diff = proj_run_diff * (1.0 / 0.91)  # makes diff more negative

    home_cover = round(_normal_cdf((rl_diff - 1.5) / SPREAD_STD_DEV), 4)
    away_cover = round(1 - home_cover, 4)
    return home_cover, away_cover, regression_applied


def project_moneyline(
    home_logs: list, away_logs: list,
    home_sp_logs: list, away_sp_logs: list,
) -> tuple:
    """
    Log5 formula + SP quality + HFA.
    Returns (home_win_prob, away_win_prob, home_ml, away_ml, factors).
    """
    def skill(logs):
        runs_for     = new_weighted_avg(logs, 'points_scored')  if logs else LEAGUE_AVG['team_runs_per_game']
        runs_against = new_weighted_avg(logs, 'points_allowed') if logs else LEAGUE_AVG['team_runs_per_game']
        total = runs_for + runs_against
        return runs_for / total if total > 0 else 0.50

    home_s = skill(home_logs)
    away_s = skill(away_logs)
    denom  = home_s + away_s - 2 * home_s * away_s
    log5   = (home_s - home_s * away_s) / denom if denom > 0 else 0.54

    # SP ERA adjustment
    home_sp_era = compute_sp_l5_era(home_sp_logs) if home_sp_logs else LEAGUE_AVG['era']
    away_sp_era = compute_sp_l5_era(away_sp_logs) if away_sp_logs else LEAGUE_AVG['era']
    # Good SP for home team → home wins more; good SP for away → away wins more
    sp_adj      = (away_sp_era - home_sp_era) * 0.025   # ~2.5% per ERA point
    home_sp_adj = max(-0.10, min(0.10, sp_adj))

    # HFA: home teams win 54% base
    hfa_adj     = 0.020

    home_win = max(0.30, min(0.80, log5 + home_sp_adj + hfa_adj))
    away_win = 1 - home_win

    def to_ml(p):
        if p >= 0.5:
            return round(-(p / (1 - p)) * 100, 0)
        return round(((1 - p) / p) * 100, 0)

    factors = {
        'home_skill': round(home_s, 4),
        'away_skill': round(away_s, 4),
        'log5': round(log5, 4),
        'sp_adj': round(home_sp_adj, 4),
        'home_sp_era_l5': round(home_sp_era, 3),
        'away_sp_era_l5': round(away_sp_era, 3),
        'home_win_prob': round(home_win, 4),
        'away_win_prob': round(away_win, 4),
    }
    return home_win, away_win, to_ml(home_win), to_ml(away_win), factors


# ── Confidence scoring ───────────────────────────────────────────────────────────

def compute_confidence(
    prop_type:       str,
    batter_pa:       int      = 100,
    sp_starts:       int      = 10,
    lineup_confirmed: bool    = True,
    ump_available:   bool     = False,
    weather_available: bool   = False,
    career_ab:       int      = 0,
    platoon_strong:  bool     = False,
    sp_fip_confirms: bool     = False,
    arsenal_extreme: bool     = False,
    matchup_edge:    bool     = False,
    weather_aligns:  bool     = False,
) -> int:
    """
    Base 60. Add/subtract per spec. Edge bonuses applied by edge detector.
    Soft cap > 85: 85 + (x-85)×0.40. Hard cap: 92.
    """
    c = 60

    # Positive factors (non-edge)
    if career_ab >= 20 and matchup_edge:   c += 5
    if platoon_strong:                      c += 5
    if ump_available:                       c += 4
    if weather_aligns:                      c += 4
    if lineup_confirmed:                    c += 4
    if sp_fip_confirms:                     c += 3
    if arsenal_extreme:                     c += 3

    # Negative factors
    if not lineup_confirmed:               c -= 8
    if sp_starts < 5:                      c -= 6
    if batter_pa < 50:                     c -= 5
    if not ump_available:                  c -= 6
    if not weather_available:              c -= 4

    # Prop-type variance penalties
    if prop_type == 'home_runs':           c -= 8
    if prop_type == 'earned_runs':         c -= 6
    if prop_type == 'stolen_bases':        c -= 10

    # Soft cap
    if c > 85:
        c = int(85 + (c - 85) * 0.40)

    return max(45, min(92, c))


# ── DB write functions ───────────────────────────────────────────────────────────

# Maps model prop_type → DB prop_type (after oddsService.js strips batter_/pitcher_ prefix)
MLB_PROP_TYPE_MAP = {
    'rbi':          'rbis',
    'runs':         'runs_scored',
    'outs_recorded': 'outs',
}

# Minimum edge required per prop type before writing a pick
MLB_MIN_EDGE = {
    'hits':         0.15,
    'total_bases':  0.20,
    'home_runs':    0.05,
    'rbis':         0.15,
    'runs_scored':  0.15,
    'stolen_bases': 0.05,
    'strikeouts':   0.30,
    'earned_runs':  0.20,
    'outs':         0.50,
}


def get_market_line(conn, player_name: str, prop_type: str, game_date) -> float | None:
    """
    Read the market prop line from player_props_history.
    Populated by oddsService.js before the model runs.
    Returns None if no line posted yet — prop is skipped.
    oddsService.js strips batter_/pitcher_ prefix on write, so DB stores bare types.
    """
    # Normalize: strip sport-specific prefixes before DB lookup
    clean_type = prop_type
    for prefix in ('player_', 'batter_', 'pitcher_'):
        if clean_type.startswith(prefix):
            clean_type = clean_type[len(prefix):]
            break

    # Remap model-internal names to DB-stored names
    clean_type = MLB_PROP_TYPE_MAP.get(clean_type, clean_type)

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
    except Exception:
        conn.rollback()
    return None


def upsert_player_projection(
    conn, player_id, player_name, team, opponent, game_date, proj
) -> int:
    home_away  = proj.get('home_away', 'home')
    confidence = proj.get('confidence_score', 60)
    factors_all = proj.get('factors_json', {})
    rows_written = 0

    is_pitcher = proj.get('proj_k', 0) > 0 or proj.get('proj_er', 0) > 0 or proj.get('proj_outs', 0) > 0

    if is_pitcher:
        prop_rows = [
            ('strikeouts',    proj.get('proj_k',     0), factors_all.get('strikeouts',    {})),
            ('earned_runs',   proj.get('proj_er',    0), factors_all.get('earned_runs',   {})),
            ('walks',         proj.get('proj_walks', 0), factors_all.get('walks',         {})),
            ('outs_recorded', proj.get('proj_outs',  0), factors_all.get('outs_recorded', {})),
        ]
    else:
        prop_rows = [
            ('hits',         proj.get('proj_hits', 0), factors_all.get('hits', {})),
            ('total_bases',  proj.get('proj_tb',   0), factors_all.get('tb',   {})),
            ('home_runs',    proj.get('proj_hr',   0), factors_all.get('hr',   {})),
            ('rbi',          proj.get('proj_rbi',  0), factors_all.get('rbi',  {})),
            ('runs',         proj.get('proj_runs', 0), factors_all.get('runs', {})),
            ('stolen_bases', proj.get('proj_sb',   0), factors_all.get('sb',   {})),
        ]

    with conn.cursor() as cur:
        for prop_type, proj_value, prop_factors in prop_rows:
            # Resolve DB-stored prop_type (handles rbi→rbis, runs→runs_scored, etc.)
            db_prop_type = MLB_PROP_TYPE_MAP.get(prop_type, prop_type)

            # Include market line + edge in factors if available (for UI display)
            # Do NOT skip if no line — store all projections so --props-only and
            # edge detector can find them after sportsbooks post lines at 9 AM
            line = get_market_line(conn, player_name, prop_type, game_date)

            merged = dict(prop_factors)
            if 'context' in factors_all:
                merged['context'] = factors_all['context']
            merged['lineup_confirmed'] = proj.get('lineup_confirmed', True)
            if line is not None:
                edge = round(proj_value - line, 2)
                merged['market_line'] = line
                merged['edge'] = edge

            cur.execute(
                """INSERT INTO chalk_projections (
                     player_id, player_name, team, sport, game_date, opponent, home_away,
                     prop_type, proj_value,
                     confidence_score, model_version, factors_json
                   ) VALUES (
                     %s, %s, %s, 'MLB', %s, %s, %s,
                     %s, %s, %s, %s, %s
                   )
                   ON CONFLICT (player_id, game_date, prop_type) DO UPDATE SET
                     proj_value       = EXCLUDED.proj_value,
                     confidence_score = EXCLUDED.confidence_score,
                     factors_json     = EXCLUDED.factors_json,
                     model_version    = EXCLUDED.model_version""",
                (
                    player_id, player_name, team, game_date, opponent, home_away,
                    db_prop_type, proj_value,
                    confidence, MODEL_VERSION, json.dumps(merged),
                )
            )
            rows_written += 1
    conn.commit()
    return rows_written


def upsert_team_projection(conn, team_name, opponent, game_date, proj) -> None:
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
                 %(team_id)s, %(team_name)s, 'MLB', %(game_date)s,
                 %(opponent)s, %(home_away)s, 'game',
                 %(proj_points)s, %(proj_points_allowed)s, %(proj_total)s,
                 %(moneyline_projection)s, %(win_probability)s,
                 %(spread_projection)s, %(spread_cover_probability)s,
                 %(over_probability)s, %(under_probability)s,
                 %(confidence_score)s, %(model_version)s, %(factors_json)s
               )
               ON CONFLICT (team_name, game_date, prop_type) DO UPDATE SET
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


# ── Lineup fallback system (3-tier) ──────────────────────────────────────────────

def _extract_sps_from_boxscore(boxscore):
    home_sp = away_sp = None
    for side_key in ('home', 'away'):
        side_data      = boxscore.get(side_key, {})
        players        = side_data.get('players', {})
        pitching_order = side_data.get('pitchers', [])
        if pitching_order:
            sp_id   = pitching_order[0]
            sp_info = players.get(f'ID{sp_id}', {}).get('person', {})
            sp_dict = {'id': int(sp_id), 'name': sp_info.get('fullName', f'Pitcher {sp_id}'), 'throws': 'R'}
            if side_key == 'home':
                home_sp = sp_dict
            else:
                away_sp = sp_dict
    return home_sp, away_sp


def get_confirmed_lineup_from_cache(conn, game_pk: int, side: str, game_date) -> list:
    """
    Tier 0: Query mlb_lineups table populated by mlbLineupFetcher.py (runs at noon ET).
    Returns a lineup list identical in format to Tier 1 if confirmed, else empty list.
    """
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT player_name, player_id, batting_order
                   FROM mlb_lineups
                   WHERE game_pk = %s AND side = %s AND game_date = %s
                   ORDER BY batting_order""",
                (game_pk, side, game_date)
            )
            rows = cur.fetchall()
        if len(rows) >= 9:
            return [{'id':            r['player_id'] or 0,
                     'name':          r['player_name'],
                     'batting_order': r['batting_order'],
                     'position':      'DH'} for r in rows]
    except Exception as exc:
        conn.rollback()
        log.warning(f'  mlb_lineups cache lookup failed: {exc}')
    return []


def get_batting_lineup_with_fallback(
    conn, game_pk, home_team, away_team, home_team_id, away_team_id, game_date
):
    """
    Tier 0: mlb_lineups cache (populated by mlbLineupFetcher.py at noon ET)
    Tier 1: statsapi.boxscore_data (official if >= 9 batters each side)
    Tier 2: yesterday's player_game_logs
    Tier 3: MLB active roster API (non-pitchers, first 9)
    Returns: (home_lineup, away_lineup, lineup_confirmed, home_sp, away_sp)
    """
    home_sp = away_sp = None

    # Tier 0 — confirmed lineup cache (populated by noon run)
    home_t0 = get_confirmed_lineup_from_cache(conn, game_pk, 'home', game_date)
    away_t0 = get_confirmed_lineup_from_cache(conn, game_pk, 'away', game_date)
    if len(home_t0) >= 9 and len(away_t0) >= 9:
        log.info(f'  Lineup Tier 0 (cache): {len(home_t0)} home / {len(away_t0)} away')
        return home_t0, away_t0, True, home_sp, away_sp

    # Tier 1
    try:
        boxscore = statsapi.boxscore_data(game_pk)
        home_t1 = []
        away_t1 = []
        for side_key, lineup_list in [('home', home_t1), ('away', away_t1)]:
            side_data     = boxscore.get(side_key, {})
            players       = side_data.get('players', {})
            batting_order = side_data.get('battingOrder', [])
            for idx, player_id in enumerate(batting_order):
                pinfo = players.get(f'ID{player_id}', {})
                info  = pinfo.get('person', {})
                pos   = pinfo.get('position', {}).get('abbreviation', '')
                lineup_list.append({
                    'id': int(player_id),
                    'name': info.get('fullName', f'Player {player_id}'),
                    'batting_order': idx + 1,
                    'position': pos,
                })
        if len(home_t1) >= 9 and len(away_t1) >= 9:
            home_sp, away_sp = _extract_sps_from_boxscore(boxscore)
            log.info(f'  Lineup Tier 1: {len(home_t1)} home / {len(away_t1)} away')
            return home_t1, away_t1, True, home_sp, away_sp
        log.info(f'  Tier 1 incomplete ({len(home_t1)}/{len(away_t1)}). Trying Tier 2.')
        if not home_sp and not away_sp:
            home_sp, away_sp = _extract_sps_from_boxscore(boxscore)
    except Exception as exc:
        log.warning(f'  boxscore_data({game_pk}) failed: {exc}')

    # Tier 2: yesterday's logs
    yesterday = game_date - timedelta(days=1)

    def yesterday_lineup(team_name):
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT player_id, player_name FROM player_game_logs
                   WHERE team ILIKE %s AND sport = 'MLB' AND game_date = %s
                     AND fg_att IS NOT NULL
                   ORDER BY player_id LIMIT 12""",
                (f'%{team_name[:3]}%', yesterday)
            )
            rows = cur.fetchall()
        if len(rows) >= 7:
            return [{'id': r['player_id'], 'name': r['player_name'],
                     'batting_order': i+1, 'position': 'DH'} for i, r in enumerate(rows[:9])]
        return []

    home_t2 = yesterday_lineup(home_team)
    away_t2 = yesterday_lineup(away_team)

    if len(home_t2) >= 7 and len(away_t2) >= 7:
        log.info(f'  Lineup Tier 2: {len(home_t2)} home / {len(away_t2)} away')
        return home_t2, away_t2, False, home_sp, away_sp

    # Tier 3: active roster
    def roster_lineup(team_id):
        try:
            resp = requests.get(
                f'https://statsapi.mlb.com/api/v1/teams/{team_id}/roster?rosterType=active',
                timeout=10,
            )
            roster = resp.json().get('roster', [])
            batters = [p for p in roster
                       if p.get('position', {}).get('type', {}).get('description', '') != 'Pitcher'][:9]
            return [{'id': p['person']['id'], 'name': p['person']['fullName'],
                     'batting_order': i+1, 'position': p.get('position', {}).get('abbreviation', '')}
                    for i, p in enumerate(batters)]
        except Exception:
            return []

    home_t3 = roster_lineup(home_team_id) if home_team_id else []
    away_t3 = roster_lineup(away_team_id) if away_team_id else []

    if home_t3 or away_t3:
        log.info(f'  Lineup Tier 3 (roster): {len(home_t3)} home / {len(away_t3)} away')

    return home_t3, away_t3, False, home_sp, away_sp


# ── Main ─────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk MLB Projection Model v3.1')
    parser.add_argument('--date', default=str(date.today()), help='Game date YYYY-MM-DD')
    parser.add_argument('--props-only', action='store_true',
                        help='Re-run market line gating on existing projections (fast, no recompute)')
    args      = parser.parse_args()
    game_date = date.fromisoformat(args.date)

    log.info('═══════════════════════════════════════════════════')
    log.info(f'Chalk MLB Projection Model v3.1 — {game_date}')
    log.info('═══════════════════════════════════════════════════')

    conn = get_db()

    # ── Props-only shortcut ──────────────────────────────────────────────────
    if args.props_only:
        log.info('▶ PROPS-ONLY: re-running market line gate on existing projections')
        with conn.cursor() as cur:
            cur.execute(
                """SELECT player_id, player_name, team, opponent,
                          prop_type, proj_value, confidence_score, factors_json
                   FROM chalk_projections
                   WHERE sport='MLB' AND game_date=%s""",
                (game_date,)
            )
            rows = cur.fetchall()
        updated = 0
        for pid, pname, team, opp, ptype, pval, conf, factors in rows:
            f = factors if isinstance(factors, dict) else {}
            home_away = f.get('home_away', 'home')
            line = get_market_line(conn, pname, ptype, game_date)
            if line is None:
                continue
            edge = round(float(pval or 0) - line, 2)
            threshold = MLB_MIN_EDGE.get(ptype, 0.15)
            if abs(edge) < threshold:
                continue
            stored_f = {**f, 'market_line': line, 'edge': edge}
            try:
                with conn.cursor() as cur2:
                    cur2.execute(
                        """INSERT INTO chalk_projections (
                             player_id, player_name, team, sport, game_date, opponent, home_away,
                             prop_type, proj_value, confidence_score, model_version, factors_json
                           ) VALUES (%s,%s,%s,'MLB',%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (player_id, game_date, prop_type) DO UPDATE SET
                             proj_value       = EXCLUDED.proj_value,
                             confidence_score = EXCLUDED.confidence_score,
                             factors_json     = EXCLUDED.factors_json,
                             model_version    = EXCLUDED.model_version""",
                        (pid, pname, team, game_date, opp, home_away,
                         ptype, float(pval or 0), conf or 60, MODEL_VERSION,
                         json.dumps(stored_f))
                    )
                conn.commit()
                updated += 1
            except Exception as e:
                conn.rollback()
                log.warning(f'  props-only upsert {pname} {ptype}: {e}')
        log.info(f'  Props-only complete — re-checked {updated} projections')
        conn.close()
        return

    # ── Step 1: Schedule ──────────────────────────────────────────────────────
    log.info('\n▶ STEP 1: Fetching schedule')
    games = get_todays_games(conn, game_date)
    if not games:
        log.info('  No games today. Exiting.')
        conn.close()
        return

    # ── Step 2: Weather ───────────────────────────────────────────────────────
    log.info('\n▶ STEP 2: Fetching weather')
    weather_cache = {}
    for game in games:
        vname = game.get('venue_name', '')
        if vname in weather_cache:
            continue
        coords = get_venue_coords(vname)
        if coords:
            w = fetch_weather(*coords)
            if w:
                log.info(f'  {vname}: {w.get("temp_f")}°F wind={w.get("wind_mph")}mph {wind_direction_label(w.get("wind_dir_deg", 0))}')
            weather_cache[vname] = w
        else:
            weather_cache[vname] = {}

    total_b = total_p = total_t = 0

    for game in games:
        game_pk   = game['game_pk']
        home_team = game['home_team']
        away_team = game['away_team']
        vname     = game['venue_name']
        gtime     = game.get('game_time', '')
        weather   = weather_cache.get(vname, {})
        park      = get_park_factors(vname)
        park['name'] = vname   # pass park name to wind helpers

        log.info(f'\n--- {away_team} @ {home_team} ({vname}) ---')

        # ── Step 3: Lineups and SPs ───────────────────────────────────────────
        home_lu, away_lu, lu_confirmed, home_sp_info, away_sp_info = (
            get_batting_lineup_with_fallback(
                conn, game_pk, home_team, away_team,
                game.get('home_team_id', 0), game.get('away_team_id', 0),
                game_date,
            )
        )
        if not lu_confirmed:
            log.info('  [lineup_confirmed=False]')

        # SP logs and hand
        home_sp_logs = get_sp_logs(conn, home_sp_info['id']) if home_sp_info else []
        away_sp_logs = get_sp_logs(conn, away_sp_info['id']) if away_sp_info else []
        home_sp_hand = 'R'
        away_sp_hand = 'R'
        if home_sp_info:
            home_sp_hand = get_pitcher_hand(home_sp_info['id'])
            home_sp_info['throws'] = home_sp_hand
            log.info(f'  Home SP: {home_sp_info["name"]} ({home_sp_hand}HP) — {len(home_sp_logs)} starts in DB')
        if away_sp_info:
            away_sp_hand = get_pitcher_hand(away_sp_info['id'])
            away_sp_info['throws'] = away_sp_hand
            log.info(f'  Away SP: {away_sp_info["name"]} ({away_sp_hand}HP) — {len(away_sp_logs)} starts in DB')

        # ── Step 4: Team logs, umpire, bullpen ────────────────────────────────
        home_tl = get_team_logs(conn, home_team)
        away_tl = get_team_logs(conn, away_team)
        ump     = get_umpire_data(conn, game_pk)
        ump_avail = bool(ump)
        wx_avail  = bool(weather)

        home_bp_tired = get_bullpen_tired(conn, game.get('home_team_id', 0), game_date)
        away_bp_tired = get_bullpen_tired(conn, game.get('away_team_id', 0), game_date)

        home_k_rate = get_team_k_rate(conn, home_team)
        away_k_rate = get_team_k_rate(conn, away_team)
        home_obp    = get_team_obp(home_tl)   # fallback only
        away_obp    = get_team_obp(away_tl)   # fallback only
        home_sb_pg  = get_team_sb_allowed(conn, home_team)
        away_sb_pg  = get_team_sb_allowed(conn, away_team)

        day_game = is_day_game(gtime)

        # GAP 11: Fetch live moneyline from Odds API for game-script factors
        live_odds   = fetch_live_odds(home_team, away_team)
        home_live_ml = live_odds.get('home_ml')
        away_live_ml = live_odds.get('away_ml')
        if live_odds:
            log.info(f'  [Live odds] home_ml={home_live_ml} away_ml={away_live_ml}')

        # GAP 12: H2H total factor
        h2h_total_f = get_h2h_total_factor(conn, home_team, away_team)
        if h2h_total_f != 1.00:
            log.info(f'  [H2H total_f] {h2h_total_f:.4f} ({home_team} vs {away_team})')

        # ── Step 5: Batter projections ────────────────────────────────────────
        for side, lineup, opp_sp_logs, opp_sp_info, opp_sp_hand, team_obp, loc, opp_sb_pg in [
            ('home', home_lu, away_sp_logs, away_sp_info, away_sp_hand, away_obp, 'home', away_sb_pg),
            ('away', away_lu, home_sp_logs, home_sp_info, home_sp_hand, home_obp, 'away', home_sb_pg),
        ]:
            team_name = home_team if side == 'home' else away_team
            opponent  = away_team if side == 'home' else home_team
            opp_sp_id = opp_sp_info['id'] if opp_sp_info else None

            # GAP 6/7: pre-load splits for all lineup members (for teammates OBP/RBI)
            lineup_splits_map = {}
            for _b in lineup:
                lineup_splits_map[_b['id']] = get_batter_splits_db(conn, _b['id'])

            for batter in lineup:
                pid  = batter['id']
                name = batter['name']
                lp   = batter['batting_order']

                bat_logs = get_batter_logs(conn, pid)
                if len(bat_logs) < 3:
                    continue

                splits  = lineup_splits_map.get(pid, {})
                matchup = get_career_matchup_db(conn, opp_sp_id, pid)
                career_ab = int(safe(matchup.get('career_ab', 0)))

                batter_pa = sum(safe(r.get('fg_att', 0)) for r in bat_logs)
                sp_starts = len(opp_sp_logs)

                # Determine platoon strength
                season_avg = compute_season_ba(bat_logs)
                pt_key     = 'vs_lhp_avg' if opp_sp_hand == 'L' else 'vs_rhp_avg'
                pt_val     = float(splits.get(pt_key) or 0)
                platoon_strong = pt_val > 0 and season_avg > 0 and abs(pt_val / season_avg - 1.0) > 0.12

                # FIP confirms direction for this batter context?
                sp_fip_confirms = False
                if len(opp_sp_logs) >= 5:
                    fip  = compute_sp_fip(opp_sp_logs)
                    era  = compute_sp_season_era(opp_sp_logs)
                    sp_fip_confirms = fip > era + 0.40  # SP ERA will rise = good for batters

                # Arsenal data for opp SP
                arsenal  = get_arsenal_data(conn, opp_sp_id) if opp_sp_id else []
                whiff_r  = get_arsenal_weighted_whiff(arsenal)
                ars_ext  = whiff_r is not None and (whiff_r > 0.30 or whiff_r < 0.20)

                conf = compute_confidence(
                    prop_type       = 'hits',
                    batter_pa       = int(batter_pa),
                    sp_starts       = sp_starts,
                    lineup_confirmed= lu_confirmed,
                    ump_available   = ump_avail,
                    weather_available = wx_avail,
                    career_ab       = career_ab,
                    platoon_strong  = platoon_strong,
                    sp_fip_confirms = sp_fip_confirms,
                    arsenal_extreme = ars_ext,
                    matchup_edge    = career_ab >= 20,
                    weather_aligns  = wx_avail and (weather.get('wind_mph', 0) > 12 or weather.get('temp_f', 72) > 80),
                )

                # GAP 6: real OBP of 3 batters ahead (for RBI projection)
                real_tm_obp  = get_teammates_obp(conn, lineup, lp)
                # GAP 7: real RBI/game of 3 batters behind (for runs scored projection)
                real_tm_rbi  = get_teammates_rbi_rate(conn, lineup, lp)
                # Live ML for this batter's team (GAP 11)
                my_live_ml   = home_live_ml if side == 'home' else away_live_ml

                proj_hits_v,  fac_h  = project_hits(bat_logs, opp_sp_logs, weather, park, loc, lp, lu_confirmed, splits, opp_sp_hand, matchup, day_game)
                proj_tb_v,    fac_tb = project_total_bases(bat_logs, opp_sp_logs, weather, park, loc, lp, splits, opp_sp_hand, matchup, whiff_r)
                proj_hr_v,    fac_hr = project_home_runs(bat_logs, opp_sp_logs, weather, park, loc, lp, splits, opp_sp_hand, matchup, whiff_r, ump)
                proj_rbi_v,   fac_r  = project_rbi(bat_logs, opp_sp_logs, weather, park, loc, lp, splits, opp_sp_hand, matchup, real_tm_obp, ump, away_bp_tired if side == 'home' else home_bp_tired)
                proj_runs_v,  fac_ru = project_runs_scored(bat_logs, opp_sp_logs, weather, park, loc, lp, splits, opp_sp_hand, real_tm_rbi, ump)
                proj_sb_v,    fac_sb = project_stolen_bases(bat_logs, opp_sp_logs, loc, lp, opp_sp_hand, opp_sb_pg, splits=splits, live_ml=my_live_ml)

                all_factors = {
                    'hits':  fac_h,
                    'tb':    fac_tb,
                    'hr':    fac_hr,
                    'rbi':   fac_r,
                    'runs':  fac_ru,
                    'sb':    fac_sb,
                    'context': {
                        'lineup_pos':       lp,
                        'lineup_confirmed': lu_confirmed,
                        'opp_sp_hand':      opp_sp_hand,
                        'park_name':        vname,
                        'day_game':         day_game,
                        'ump_name':         ump.get('umpire_name') if ump else None,
                        'weather_available': wx_avail,
                        'ump_available':    ump_avail,
                        'career_ab':        career_ab,
                    },
                }

                proj_data = {
                    'home_away':        loc,
                    'proj_hits':        proj_hits_v,
                    'proj_tb':          proj_tb_v,
                    'proj_hr':          proj_hr_v,
                    'proj_rbi':         proj_rbi_v,
                    'proj_runs':        proj_runs_v,
                    'proj_sb':          proj_sb_v,
                    'proj_er':          0,
                    'proj_walks':       0,
                    'proj_outs':        0,
                    'confidence_score': conf,
                    'lineup_confirmed': lu_confirmed,
                    'factors_json':     all_factors,
                }

                try:
                    rows = upsert_player_projection(conn, pid, name, team_name, opponent, game_date, proj_data)
                    total_b += rows
                    log.info(
                        f'    [{loc}] {name} (#{lp}) '
                        f'H:{proj_hits_v:.2f} TB:{proj_tb_v:.2f} HR:{proj_hr_v:.3f} '
                        f'RBI:{proj_rbi_v:.2f} R:{proj_runs_v:.2f} SB:{proj_sb_v:.3f} '
                        f'Conf:{conf}'
                    )
                except Exception as exc:
                    log.warning(f'    Failed batter {name}: {exc}')
                    conn.rollback()

        # ── Step 6: Pitcher projections ───────────────────────────────────────
        for sp_info, sp_logs, opp_tl, loc, team_name, opponent, opp_k_rate, opp_bullpen_tired in [
            (home_sp_info, home_sp_logs, away_tl, 'home', home_team, away_team, away_k_rate, away_bp_tired),
            (away_sp_info, away_sp_logs, home_tl, 'away', away_team, home_team, home_k_rate, home_bp_tired),
        ]:
            if not sp_info:
                continue
            pid      = sp_info['id']
            name     = sp_info['name']
            sp_hand  = sp_info.get('throws', 'R')
            dr       = compute_days_rest(sp_logs, game_date)
            arsenal  = get_arsenal_data(conn, pid)
            whiff_r  = get_arsenal_weighted_whiff(arsenal)
            ars_ext  = whiff_r is not None and (whiff_r > 0.30 or whiff_r < 0.20)

            fip  = compute_sp_fip(sp_logs) if len(sp_logs) >= 5 else LEAGUE_AVG['fip']
            era  = compute_sp_season_era(sp_logs)
            sp_fip_confirms = abs(fip - era) > 0.40

            conf_p = compute_confidence(
                prop_type       = 'strikeouts',
                sp_starts       = len(sp_logs),
                lineup_confirmed= lu_confirmed,
                ump_available   = ump_avail,
                weather_available = wx_avail,
                arsenal_extreme = ars_ext,
                sp_fip_confirms = sp_fip_confirms,
            )

            # GAP 8: collect opp lineup splits for handedness factor
            opp_lu = home_lu if side == 'away' else away_lu
            opp_lu_splits = [lineup_splits_map.get(b['id'], {}) for b in opp_lu] if (side == 'home' and away_lu) or (side == 'away' and home_lu) else []
            # Rebuild lineup_splits_map for opp lineup (may differ from current side)
            if not opp_lu_splits and opp_lu:
                opp_lu_splits = [get_batter_splits_db(conn, b['id']) for b in opp_lu]

            proj_k_v,    fac_k    = project_strikeouts(sp_logs, opp_tl, weather, loc, opp_k_rate, dr, sp_hand, arsenal, ump, opp_lineup_splits=opp_lu_splits)
            proj_er_v,   fac_er   = project_earned_runs(sp_logs, opp_tl, weather, park, loc, dr, whiff_r)
            proj_bb_v,   fac_bb   = project_walks(sp_logs, opp_tl, weather, loc, dr, ump, whiff_r)
            proj_out_v,  fac_out  = project_outs_recorded(sp_logs, weather, loc, dr, opp_bullpen_tired, opp_tl, arsenal)

            all_factors = {
                'strikeouts':    fac_k,
                'earned_runs':   fac_er,
                'walks':         fac_bb,
                'outs_recorded': fac_out,
                'context': {
                    'sp_hand':          sp_hand,
                    'days_rest':        dr,
                    'park_name':        vname,
                    'arsenal_whiff':    round(whiff_r, 3) if whiff_r else None,
                    'ump_name':         ump.get('umpire_name') if ump else None,
                    'ump_available':    ump_avail,
                    'weather_available': wx_avail,
                    'sp_starts_in_db':  len(sp_logs),
                },
            }
            proj_data = {
                'home_away':        loc,
                'proj_k':           proj_k_v,
                'proj_er':          proj_er_v,
                'proj_walks':       proj_bb_v,
                'proj_outs':        proj_out_v,
                'proj_hits':        0,
                'proj_tb':          0,
                'proj_hr':          0,
                'proj_rbi':         0,
                'proj_runs':        0,
                'proj_sb':          0,
                'confidence_score': conf_p,
                'factors_json':     all_factors,
            }

            try:
                rows = upsert_player_projection(conn, pid, name, team_name, opponent, game_date, proj_data)
                total_p += rows
                log.info(
                    f'    [{loc} SP] {name} — '
                    f'K:{proj_k_v:.2f} ER:{proj_er_v:.2f} BB:{proj_bb_v:.2f} Outs:{proj_out_v:.1f} Conf:{conf_p}'
                )
            except Exception as exc:
                log.warning(f'    Failed pitcher {name}: {exc}')
                conn.rollback()

        # ── Step 7: Team projections ──────────────────────────────────────────
        proj_total_v, proj_home_r, proj_away_r, total_f = project_total(
            home_tl, away_tl, home_sp_logs, away_sp_logs,
            weather, park, ump, home_bp_tired, away_bp_tired,
            h2h_f=h2h_total_f,
        )
        # GAP 13: pass live home ML for large-favourite regression
        home_cover, away_cover, rl_regressed = project_run_line(
            proj_home_r - proj_away_r,
            home_ml=home_live_ml,
        )
        home_win, away_win, home_ml, away_ml, ml_factors = project_moneyline(
            home_tl, away_tl, home_sp_logs, away_sp_logs,
        )

        posted_total = LEAGUE_AVG['game_total']
        over_prob  = round(_normal_cdf((proj_total_v - posted_total) / TOTAL_STD_DEV), 4)
        under_prob = round(1 - over_prob, 4)

        team_conf = 60
        if len(home_tl) >= 15: team_conf += 5
        team_conf = max(50, min(90, team_conf))

        all_t_factors = {
            'total': total_f,
            'moneyline': ml_factors,
            'run_line': {
                'proj_run_diff': round(proj_home_r - proj_away_r, 3),
                'home_cover': home_cover,
                'away_cover': away_cover,
            },
            'context': {
                'venue': vname,
                'park_hr_f': park.get('hr', 1.0),
                'park_runs_f': park.get('runs', 1.0),
                'weather_temp': weather.get('temp_f') if weather else None,
                'weather_wind': weather.get('wind_mph') if weather else None,
                'ump_name': ump.get('umpire_name') if ump else None,
            },
        }

        for tname, t_loc, proj_r, allowed_r, ml_v, win_p, sp_cov, t_id in [
            (home_team, 'home', proj_home_r, proj_away_r, home_ml, home_win, home_cover, game.get('home_team_id', 0)),
            (away_team, 'away', proj_away_r, proj_home_r, away_ml, away_win, away_cover, game.get('away_team_id', 0)),
        ]:
            tproj = {
                'team_id':                  t_id,
                'team_name':                tname,
                'game_date':                game_date,
                'opponent':                 away_team if t_loc == 'home' else home_team,
                'home_away':                t_loc,
                'proj_points':              round(proj_r, 3),
                'proj_points_allowed':      round(allowed_r, 3),
                'proj_total':               round(proj_total_v, 3),
                'moneyline_projection':     round(ml_v, 2),
                'win_probability':          round(win_p, 4),
                'spread_projection':        round(proj_home_r - proj_away_r if t_loc == 'home' else proj_away_r - proj_home_r, 3),
                'spread_cover_probability': round(sp_cov, 4),
                'over_probability':         over_prob,
                'under_probability':        under_prob,
                'confidence_score':         team_conf,
                'model_version':            MODEL_VERSION,
                'factors_json':             json.dumps(all_t_factors),
            }
            try:
                upsert_team_projection(conn, tname, tproj['opponent'], game_date, tproj)
                total_t += 1
                log.info(f'    [{t_loc}] {tname} — runs:{proj_r:.2f} ML:{ml_v:.0f} win%:{win_p:.3f}')
            except Exception as exc:
                log.warning(f'    Failed team {tname}: {exc}')
                conn.rollback()

    conn.close()
    log.info('\n═══════════════════════════════════════════════════')
    log.info(f'v3.1 complete — batters:{total_b}  pitchers:{total_p}  teams:{total_t}')
    log.info('═══════════════════════════════════════════════════')


if __name__ == '__main__':
    main()
