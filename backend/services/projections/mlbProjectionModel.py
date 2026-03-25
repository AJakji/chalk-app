"""
Chalk MLB Projection Model
==========================
Morning script (runs at 10:00 AM via cron) that generates player and team
projections for every MLB game tonight. Reads historical data from our
PostgreSQL database (populated by mlbDataCollector.py), fetches weather
from Open-Meteo, and writes projections to chalk_projections and
team_projections tables.

Column mapping from mlbDataCollector (shared player_game_logs table):
  Hitters
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

DATABASE_URL  = os.getenv('DATABASE_URL', '')
MODEL_VERSION = 'v2.0'
CURRENT_SEASON = '2025'

# League-average baselines — calibrated to 2024 MLB season
LEAGUE_AVG = {
    'hits_per_game':      0.87,   # per batter per game
    'tb_per_game':        1.30,
    'hr_per_game':        0.147,
    'rbi_per_game':       0.50,
    'runs_per_game':      0.50,
    'sb_per_game':        0.08,
    'ba':                 0.243,
    'obp':                0.312,
    'slg':                0.411,
    'ops':                0.723,
    'babip':              0.297,
    'k_pct':              0.224,
    'bb_pct':             0.085,
    'ld_pct':             0.210,
    'hard_contact_pct':   0.380,
    'barrel_pct':         0.078,
    'iso':                0.168,
    'hr_fb_ratio':        0.143,
    'pull_pct':           0.400,
    'sprint_speed':       27.0,   # ft/s
    # Pitcher baselines
    'k_per_9':            8.7,
    'bb_per_9':           3.1,
    'hr_per_9':           1.20,
    'era':                4.20,
    'whip':               1.27,
    'fip':                4.15,
    'swstr_pct':          0.110,  # swinging strike %
    'zone_pct':           0.495,
    'gb_pct':             0.435,
    'fb_pct':             0.360,
    'h_per_9':            8.5,
    'baa':                0.243,
    # Team
    'team_runs_per_game': 4.6,
    'team_ops':           0.723,
    'team_era':           4.20,
    'team_whip':          1.27,
}

# Standard deviations for probability calculations
TOTAL_STD_DEV  = 2.8   # runs (MLB totals)
SPREAD_STD_DEV = 2.2   # runs (MLB run line)

# MLB venue coordinates for weather lookup — keyed by venue name substring
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


def get_venue_coords(venue_name: str) -> Optional[tuple]:
    """Find coordinates for venue by name substring match."""
    if not venue_name:
        return None
    vl = venue_name.lower()
    for key, coords in VENUE_COORDS.items():
        if key.lower() in vl or vl in key.lower():
            return coords
    return None

# HR factor, Runs factor, Hits factor for all 30 MLB parks
# Source: 3-year rolling park factor data
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
    'american_airlines_center': {'hr': 1.03, 'runs': 1.01, 'hits': 1.00, 'altitude_ft': 551},
    'rogers_centre':            {'hr': 1.06, 'runs': 1.04, 'hits': 1.02, 'altitude_ft': 251},
    'globe_life_field':         {'hr': 1.08, 'runs': 1.05, 'hits': 1.03, 'altitude_ft': 551},
    'default':                  {'hr': 1.00, 'runs': 1.00, 'hits': 1.00, 'altitude_ft': 100},
}


# ── Helpers ─────────────────────────────────────────────────────────────────────

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


# ── Weather ──────────────────────────────────────────────────────────────────────

def fetch_weather(lat: float, lon: float) -> dict:
    """
    Fetch current weather from Open-Meteo (no API key required).
    Returns dict with temp_f, wind_mph, wind_dir_deg.
    Returns empty dict on failure — model continues without weather factors.
    """
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
    """Convert wind direction degrees to compass label."""
    dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    idx = round(degrees / 45) % 8
    return dirs[idx]


def weather_hits_factor(weather: dict) -> float:
    """
    Calculate hits multiplier from temperature.
    Cold weather (below 50F) reduces hits by up to 4%.
    Hot weather (above 85F) adds 2%.
    Returns 1.0 if no weather data.
    """
    if not weather:
        return 1.0
    temp = weather.get('temp_f', 72)
    if temp < 40:   return 0.95
    if temp < 50:   return 0.97
    if temp < 60:   return 0.99
    if temp >= 90:  return 1.02
    if temp >= 85:  return 1.01
    return 1.0


def weather_tb_factor(weather: dict, park_name: str) -> float:
    """
    Calculate total bases multiplier from weather + park.
    Wind-out at Wrigley is the most extreme positive case.
    Opposing wind suppresses TB significantly.
    Returns 1.0 if no weather data.
    """
    if not weather:
        return 1.0
    wind_mph = weather.get('wind_mph', 0)
    wind_dir = weather.get('wind_dir_deg', 0)
    temp_f   = weather.get('temp_f', 72)

    # Wrigley wind-out (blowing out to center ~E or SE)
    is_wrigley = 'wrigley' in park_name.lower()
    wind_label = wind_direction_label(wind_dir)
    wrigley_out = is_wrigley and wind_label in ('E', 'SE', 'NE')
    wrigley_in  = is_wrigley and wind_label in ('W', 'SW', 'NW')

    # Base wind factor by speed
    if wind_mph >= 20:
        wind_f = 1.07 if wrigley_out else (0.90 if wrigley_in else 1.03)
    elif wind_mph >= 15:
        wind_f = 1.05 if wrigley_out else (0.93 if wrigley_in else 1.01)
    elif wind_mph >= 10:
        wind_f = 1.02 if wrigley_out else (0.96 if wrigley_in else 1.00)
    else:
        wind_f = 1.0

    # Temperature effect on ball carry
    if temp_f >= 90:   temp_f_mod = 1.03
    elif temp_f >= 80: temp_f_mod = 1.01
    elif temp_f < 50:  temp_f_mod = 0.97
    elif temp_f < 40:  temp_f_mod = 0.94
    else:              temp_f_mod = 1.0

    return max(0.88, min(1.15, wind_f * temp_f_mod))


def weather_hr_factor(weather: dict, park_name: str) -> float:
    """
    Calculate HR rate multiplier from weather + park altitude.
    Most critical weather factor in MLB modeling.
    High altitude + warm + wind-out = significantly elevated HR rate.
    """
    if not weather:
        return 1.0
    wind_mph = weather.get('wind_mph', 0)
    wind_dir = weather.get('wind_dir_deg', 0)
    temp_f   = weather.get('temp_f', 72)

    park_lower = park_name.lower()
    park_data  = get_park_factors(park_name)
    altitude   = park_data.get('altitude_ft', 100)

    wind_label = wind_direction_label(wind_dir)
    # Wind out = blowing to center/outfield = ball carries
    is_wrigley      = 'wrigley' in park_lower
    wind_out_dirs   = ('E', 'SE', 'NE') if is_wrigley else ('S', 'SE', 'SW')
    wind_in_dirs    = ('W', 'SW', 'NW') if is_wrigley else ('N', 'NE', 'NW')
    blowing_out = wind_label in wind_out_dirs
    blowing_in  = wind_label in wind_in_dirs

    # Wind component
    if wind_mph >= 20:
        wind_f = 1.10 if blowing_out else (0.88 if blowing_in else 1.02)
    elif wind_mph >= 15:
        wind_f = 1.06 if blowing_out else (0.92 if blowing_in else 1.01)
    elif wind_mph >= 10:
        wind_f = 1.03 if blowing_out else (0.96 if blowing_in else 1.00)
    else:
        wind_f = 1.0

    # Temperature component — warm air is less dense, ball travels farther
    if temp_f >= 90:   temp_f_mod = 1.06
    elif temp_f >= 80: temp_f_mod = 1.03
    elif temp_f >= 70: temp_f_mod = 1.01
    elif temp_f < 50:  temp_f_mod = 0.94
    elif temp_f < 40:  temp_f_mod = 0.90
    else:              temp_f_mod = 1.0

    # Altitude bonus on top of park factor (Coors gets double hit: park_factor + altitude)
    if altitude >= 5000:   alt_f = 1.08   # Coors Field
    elif altitude >= 1000: alt_f = 1.02
    else:                  alt_f = 1.0

    return max(0.82, min(1.20, wind_f * temp_f_mod * alt_f))


def weather_walks_factor(weather: dict) -> float:
    """
    Cold weather increases walks — grip issues cause pitchers to miss zone.
    Below 45F: +5% walks. Below 35F: +9% walks.
    """
    if not weather:
        return 1.0
    temp_f = weather.get('temp_f', 72)
    if temp_f < 35:  return 1.09
    if temp_f < 45:  return 1.05
    if temp_f < 55:  return 1.02
    return 1.0


# ── Park factor lookup ──────────────────────────────────────────────────────────

def get_park_factors(venue_name: str) -> dict:
    """
    Case-insensitive substring match against MLB_PARK_FACTORS keys.
    Falls back to 'default' if no match found.
    """
    name_lower = venue_name.lower().replace(' ', '_').replace("'", '').replace('.', '')
    for key, factors in MLB_PARK_FACTORS.items():
        if key == 'default':
            continue
        # Try both directions: key in name or name contains key words
        key_words = key.replace('_', ' ')
        if key in name_lower or key_words in venue_name.lower():
            return factors
    return MLB_PARK_FACTORS['default']


# ── Rolling averages ────────────────────────────────────────────────────────────

def rolling_avg(rows: list[dict], col: str, n: int) -> float:
    vals = [safe(r[col]) for r in rows[:n] if r.get(col) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def weighted_avg(rows: list[dict], col: str) -> float:
    """
    MLB weighted rolling average:
      L10 × 0.40 + L20 × 0.30 + L30 × 0.20 + season × 0.10
    Falls back gracefully when fewer games exist.
    More games needed than NBA for statistical stability.
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


def home_away_factor(logs: list[dict], col: str, location: str) -> float:
    """Ratio of player's performance at given location vs overall baseline."""
    home_a = home_away_avg(logs, col, 'home')
    away_a = home_away_avg(logs, col, 'away')
    baseline = (home_a + away_a) / 2 if (home_a + away_a) > 0 else 1.0
    if baseline == 0:
        return 1.0
    loc_avg = home_a if location == 'home' else away_a
    if loc_avg == 0:
        return 1.0
    ratio = loc_avg / baseline
    return max(0.82, min(1.18, ratio))


# ── DB queries ──────────────────────────────────────────────────────────────────

def get_batter_logs(conn, player_id: int, limit: int = 50) -> list[dict]:
    """Most recent `limit` batter game logs for a player (MLB, current season)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'MLB' AND season = %s
                 AND fg_att IS NOT NULL
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_pitcher_logs(conn, player_id: int, limit: int = 30) -> list[dict]:
    """Most recent `limit` pitcher game logs (starts preferred) — MLB current season."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'MLB' AND season = %s
                 AND minutes IS NOT NULL AND minutes > 0
               ORDER BY game_date DESC LIMIT %s""",
            (player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_sp_logs(conn, sp_player_id: int, limit: int = 10) -> list[dict]:
    """Last `limit` starts for an opposing SP (only outings >= 1 IP)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM player_game_logs
               WHERE player_id = %s AND sport = 'MLB' AND season = %s
                 AND minutes >= 1
               ORDER BY game_date DESC LIMIT %s""",
            (sp_player_id, CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_team_logs(conn, team_name: str, limit: int = 20) -> list[dict]:
    """Most recent team game logs for an MLB team."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT * FROM team_game_logs
               WHERE team_name ILIKE %s AND sport = 'MLB' AND season = %s
               ORDER BY game_date DESC LIMIT %s""",
            (f'%{team_name}%', CURRENT_SEASON, limit)
        )
        return cur.fetchall()


def get_rest_days(conn, player_id: int, game_date: date) -> int:
    """Days since the player's last MLB game."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT MAX(game_date) FROM player_game_logs
               WHERE player_id = %s AND game_date < %s AND sport = 'MLB'""",
            (player_id, game_date)
        )
        row = cur.fetchone()
        if row and row[0]:
            return (game_date - row[0]).days
        return 2  # assume normal rest if no history


def get_todays_games(conn, game_date: date) -> list[dict]:
    """
    Fetch today's MLB schedule directly from the MLB Stats API via statsapi.
    Returns a list of game dicts with gamePk, away/home team info, and venue.
    """
    try:
        schedule = statsapi.schedule(date=str(game_date), sportId=1)
    except Exception as exc:
        log.error(f'  statsapi.schedule() failed: {exc}')
        return []

    games = []
    for game in schedule:
        game_pk   = game.get('game_id')
        status    = game.get('status', '')
        if status in ('Final', 'Cancelled', 'Postponed'):
            continue
        games.append({
            'game_pk':          game_pk,
            'away_team':        game.get('away_name', ''),
            'away_team_id':     game.get('away_id', 0),
            'home_team':        game.get('home_name', ''),
            'home_team_id':     game.get('home_id', 0),
            'venue_name':       game.get('venue_name', ''),
            'venue_id':         game.get('venue_id', 0),
            'game_time':        game.get('game_datetime', ''),
            'status':           status,
        })

    log.info(f'  Found {len(games)} MLB games scheduled for {game_date}')
    return games


# ── SP factor helpers ───────────────────────────────────────────────────────────

def sp_strikeout_factor(sp_logs: list[dict]) -> float:
    """
    Opposing SP's K rate as a suppression factor for batter K props.
    High SP K/9 => batters are projected down.
    Falls back to 1.0 if SP has fewer than 5 starts.
    """
    if len(sp_logs) < 5:
        return 1.0
    # assists = strikeOuts in pitcher game logs
    # minutes = inningsPitched
    total_k  = sum(safe(r.get('assists', 0)) for r in sp_logs)
    total_ip = sum(safe(r.get('minutes', 0)) for r in sp_logs)
    if total_ip < 1:
        return 1.0
    sp_k9 = (total_k / total_ip) * 9
    factor = sp_k9 / LEAGUE_AVG['k_per_9']
    return max(0.75, min(1.30, factor))


def sp_hits_allowed_factor(sp_logs: list[dict]) -> float:
    """
    Opposing SP's hits-allowed rate as batter hits suppression factor.
    Low SP BAA => batters project down on hits.
    """
    if len(sp_logs) < 5:
        return 1.0
    total_h  = sum(safe(r.get('fg_made', 0)) for r in sp_logs)
    total_ip = sum(safe(r.get('minutes', 0)) for r in sp_logs)
    if total_ip < 1:
        return 1.0
    sp_h9 = (total_h / total_ip) * 9
    factor = sp_h9 / LEAGUE_AVG['h_per_9']
    return max(0.75, min(1.30, factor))


def sp_hr_allowed_factor(sp_logs: list[dict]) -> float:
    """Opposing SP's HR-per-9 vs league average as a batter HR multiplier."""
    if len(sp_logs) < 5:
        return 1.0
    total_hr = sum(safe(r.get('three_made', 0)) for r in sp_logs)
    total_ip = sum(safe(r.get('minutes', 0)) for r in sp_logs)
    if total_ip < 1:
        return 1.0
    sp_hr9 = (total_hr / total_ip) * 9
    factor = sp_hr9 / LEAGUE_AVG['hr_per_9']
    return max(0.60, min(1.50, factor))


def sp_bb_allowed_factor(sp_logs: list[dict]) -> float:
    """Opposing SP's BB-per-9 — high walk rate means more OBP for batters."""
    if len(sp_logs) < 5:
        return 1.0
    total_bb = sum(safe(r.get('turnovers', 0)) for r in sp_logs)
    total_ip = sum(safe(r.get('minutes', 0)) for r in sp_logs)
    if total_ip < 1:
        return 1.0
    sp_bb9 = (total_bb / total_ip) * 9
    factor = sp_bb9 / LEAGUE_AVG['bb_per_9']
    return max(0.70, min(1.40, factor))


def sp_era_factor(sp_logs: list[dict]) -> float:
    """
    Opposing SP quality as a multiplicative factor for run environment.
    High ERA SP => more run-scoring environment for batting team.
    """
    if len(sp_logs) < 5:
        return 1.0
    # offensive_rating = ERA in pitcher logs
    recent_era = rolling_avg(sp_logs, 'offensive_rating', min(5, len(sp_logs)))
    if recent_era <= 0:
        return 1.0
    factor = recent_era / LEAGUE_AVG['era']
    return max(0.70, min(1.50, factor))


def lineup_position_factor(lineup_pos: int) -> float:
    """
    Lineup position multiplier for RBI/runs projections.
    Top of order (1-2): high runs, fewer RBI.
    Middle (3-5): power/RBI.
    Bottom (6-9): lower across the board.
    """
    if lineup_pos <= 2:   return 1.05  # lead off / 2-hole: see more PA, score runs
    if lineup_pos <= 5:   return 1.10  # heart of order: RBI opportunities
    if lineup_pos <= 7:   return 0.95
    return 0.88  # 8-9 hole


# ── BABIP / ISO computed from existing game log columns ─────────────────────────

def compute_babip(logs: list[dict]) -> float:
    """
    BABIP = (H - HR) / (AB - K - HR)
    Uses game log column mappings:
      fg_made   = hits
      three_made = home_runs
      fg_att    = at_bats
      turnovers = strikeouts (batter K)
    """
    total_h  = sum(safe(r.get('fg_made', 0)) for r in logs)
    total_hr = sum(safe(r.get('three_made', 0)) for r in logs)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in logs)
    total_k  = sum(safe(r.get('turnovers', 0)) for r in logs)
    denom = total_ab - total_k - total_hr
    if denom <= 0:
        return LEAGUE_AVG['babip']
    babip = (total_h - total_hr) / denom
    return max(0.200, min(0.450, babip))


def compute_iso(logs: list[dict]) -> float:
    """
    ISO = (2B + 2*3B + 3*HR) / AB
    Uses game log column mappings:
      off_reb    = doubles
      def_reb    = triples
      three_made = home_runs
      fg_att     = at_bats
    """
    total_2b = sum(safe(r.get('off_reb', 0)) for r in logs)
    total_3b = sum(safe(r.get('def_reb', 0)) for r in logs)
    total_hr = sum(safe(r.get('three_made', 0)) for r in logs)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in logs)
    if total_ab <= 0:
        return LEAGUE_AVG['iso']
    iso = (total_2b + 2 * total_3b + 3 * total_hr) / total_ab
    return max(0.050, min(0.350, iso))


# ── New helper functions (v2.0 tuning) ──────────────────────────────────────────

def compute_ba_trend_factor(logs: list[dict]) -> float:
    """L10 BA vs season BA — most important batter factor."""
    if len(logs) < 5:
        return 1.0
    l10_h  = rolling_avg(logs, 'fg_made', min(10, len(logs)))
    l10_ab = rolling_avg(logs, 'fg_att',  min(10, len(logs)))
    szn_h  = rolling_avg(logs, 'fg_made', len(logs))
    szn_ab = rolling_avg(logs, 'fg_att',  len(logs))
    l10_ba = l10_h / l10_ab if l10_ab > 0 else 0
    szn_ba = szn_h / szn_ab if szn_ab > 0 else 0
    if szn_ba <= 0:
        return 1.0
    ratio = l10_ba / szn_ba
    return max(0.75, min(1.30, ratio))


def compute_contact_rate_factor(logs: list[dict]) -> float:
    """(1 - K_pct) / (1 - league_avg_K_pct). Uses turnovers=K, fg_att=AB."""
    recent = logs[:min(20, len(logs))]
    total_k  = sum(safe(r.get('turnovers', 0)) for r in recent)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in recent)
    if total_ab <= 0:
        return 1.0
    player_k_pct = total_k / total_ab
    league_k_pct = LEAGUE_AVG['k_pct']  # 0.224
    numerator   = max(0.1, 1.0 - player_k_pct)
    denominator = max(0.1, 1.0 - league_k_pct)
    return max(0.80, min(1.25, numerator / denominator))


def compute_obp_factor(logs: list[dict]) -> float:
    """Player OBP (H + BB) / (AB + BB) vs league avg 0.317."""
    recent = logs[:min(20, len(logs))]
    total_h  = sum(safe(r.get('fg_made', 0)) for r in recent)
    total_bb = sum(safe(r.get('fouls', 0)) for r in recent)   # fouls = BB
    total_ab = sum(safe(r.get('fg_att', 0)) for r in recent)
    denom = total_ab + total_bb
    if denom <= 0:
        return 1.0
    player_obp = (total_h + total_bb) / denom
    return max(0.75, min(1.35, player_obp / LEAGUE_AVG['obp']))


def compute_hr_rate_factor(logs: list[dict]) -> float:
    """Player HR/AB vs league avg (0.034)."""
    recent = logs[:min(30, len(logs))]
    total_hr = sum(safe(r.get('three_made', 0)) for r in recent)
    total_ab = sum(safe(r.get('fg_att', 0)) for r in recent)
    if total_ab <= 0:
        return 1.0
    player_hr_rate = total_hr / total_ab
    league_hr_per_ab = 0.034
    return max(0.20, min(2.50, player_hr_rate / league_hr_per_ab))


def compute_sp_fip(sp_logs: list[dict]) -> float:
    """FIP = (13xHR + 3xBB - 2xK) / IP + 3.10"""
    recent = sp_logs[:min(10, len(sp_logs))]
    if not recent:
        return LEAGUE_AVG['fip']
    total_hr = sum(safe(r.get('three_made', 0)) for r in recent)  # three_made = HR allowed
    total_bb = sum(safe(r.get('turnovers', 0)) for r in recent)   # turnovers = BB allowed
    total_k  = sum(safe(r.get('assists', 0)) for r in recent)     # assists = K
    total_ip = sum(safe(r.get('minutes', 0)) for r in recent)     # minutes = IP
    if total_ip <= 0:
        return LEAGUE_AVG['fip']
    fip = (13 * total_hr + 3 * total_bb - 2 * total_k) / total_ip + 3.10
    return max(2.0, min(7.0, fip))


def fip_vs_era_factor(sp_logs: list[dict]) -> float:
    """
    FIP vs ERA: if FIP < ERA by 0.5+ SP is outperforming (regression up => ERA goes down).
    Returns ERA multiplier: < 1.0 means SP ERA likely to drop.
    """
    if len(sp_logs) < 5:
        return 1.0
    fip = compute_sp_fip(sp_logs)
    recent_era = rolling_avg(sp_logs, 'offensive_rating', min(5, len(sp_logs)))
    if recent_era <= 0:
        return 1.0
    diff = fip - recent_era  # positive = FIP higher than ERA (regression up)
    if diff > 0.50:
        f = 1.07   # SP ERA will rise — they've been lucky
    elif diff < -0.50:
        f = 0.93   # SP ERA will fall — they've been unlucky
    else:
        f = 1.0 + diff * 0.14  # linear in between
    return max(0.85, min(1.15, f))


def compute_sp_k9_trend(sp_logs: list[dict]) -> float:
    """L5 K/9 vs season K/9 — rising or falling strikeout stuff."""
    if len(sp_logs) < 5:
        return 1.0
    def k9(rows):
        k  = sum(safe(r.get('assists',  0)) for r in rows)
        ip = sum(safe(r.get('minutes',  0)) for r in rows)
        return (k / ip * 9) if ip > 0 else 0
    l5_k9  = k9(sp_logs[:5])
    szn_k9 = k9(sp_logs)
    if szn_k9 <= 0:
        return 1.0
    return max(0.70, min(1.30, l5_k9 / szn_k9))


def compute_sp_bb9_trend(sp_logs: list[dict]) -> float:
    """L5 BB/9 vs season BB/9."""
    if len(sp_logs) < 5:
        return 1.0
    def bb9(rows):
        bb = sum(safe(r.get('turnovers', 0)) for r in rows)
        ip = sum(safe(r.get('minutes',   0)) for r in rows)
        return (bb / ip * 9) if ip > 0 else 0
    l5  = bb9(sp_logs[:5])
    szn = bb9(sp_logs)
    if szn <= 0:
        return 1.0
    ratio = l5 / szn
    # Higher BB/9 recently = worse command = more walks
    return max(0.70, min(1.40, ratio))


def compute_sp_hr9(sp_logs: list[dict]) -> float:
    """SP HR/9 vs league avg 1.20."""
    recent = sp_logs[:min(10, len(sp_logs))]
    if not recent:
        return LEAGUE_AVG['hr_per_9']
    total_hr = sum(safe(r.get('three_made', 0)) for r in recent)
    total_ip = sum(safe(r.get('minutes', 0)) for r in recent)
    if total_ip <= 0:
        return LEAGUE_AVG['hr_per_9']
    return max(0.20, min(3.0, total_hr / total_ip * 9))


def compute_days_rest(sp_logs: list[dict], game_date) -> int:
    """Days since SP's last appearance."""
    if not sp_logs:
        return 5
    last_date = sp_logs[0].get('game_date')
    if last_date is None:
        return 5
    if hasattr(last_date, 'days'):
        return 5
    try:
        delta = (game_date - last_date).days
        return max(0, delta)
    except Exception:
        return 5


def days_rest_factor_k(days: int) -> float:
    """Rest effect on strikeouts."""
    if days <= 3:  return 0.90   # short rest
    if days == 4:  return 0.97
    if days == 5:  return 1.00
    return 0.98                   # 6+ days: slight rust


def days_rest_factor_bb(days: int) -> float:
    """Rest effect on walks — command degrades more on short rest."""
    if days <= 3:  return 1.15
    if days == 4:  return 1.05
    if days == 5:  return 1.00
    return 1.02


def days_rest_factor_er(days: int) -> float:
    """Rest effect on earned runs."""
    if days <= 3:  return 1.08
    if days == 4:  return 1.03
    if days == 5:  return 1.00
    return 1.02


def get_team_obp_real(conn, team_name: str) -> float:
    """
    Get team OBP from team_game_logs using runs_scored as proxy.
    """
    with conn.cursor() as cur:
        try:
            cur.execute("""
                SELECT AVG(points_scored::float) as avg_runs
                FROM team_game_logs
                WHERE team_name ILIKE %s AND sport = 'MLB'
                  AND season >= '2024'
                ORDER BY game_date DESC
                LIMIT 20
            """, (f'%{team_name}%',))
            row = cur.fetchone()
            if row and row[0]:
                avg_runs = float(row[0])
                obp = LEAGUE_AVG['obp'] + (avg_runs - LEAGUE_AVG['team_runs_per_game']) * (0.01 / 0.3)
                return max(0.270, min(0.370, obp))
        except Exception:
            pass
    return LEAGUE_AVG['obp']


def compute_lineup_pa_factor(lineup_pos: int, lineup_confirmed: bool) -> float:
    """Plate appearance rate by lineup position."""
    if not lineup_confirmed:
        return 1.00  # unknown position — don't assume
    if lineup_pos == 1:   return 1.12
    if lineup_pos == 2:   return 1.08
    if lineup_pos <= 5:   return 1.05
    if lineup_pos <= 8:   return 0.97
    return 0.90  # 9-hole


def compute_sb_rate_factor(logs: list[dict]) -> float:
    """SB/game vs league avg 0.09. Only meaningful for speedsters."""
    recent = logs[:min(30, len(logs))]
    if not recent:
        return 1.0
    total_sb = sum(safe(r.get('steals', 0)) for r in recent)
    avg_sb = total_sb / len(recent)
    return max(0.10, min(5.0, avg_sb / LEAGUE_AVG['sb_per_game']))


def _sp_h9_trend(sp_logs: list[dict]) -> float:
    """SP H/9 last 5 starts vs season H/9."""
    if len(sp_logs) < 5:
        return 1.0
    def h9(rows):
        h  = sum(safe(r.get('fg_made',  0)) for r in rows)  # fg_made = hits allowed
        ip = sum(safe(r.get('minutes',   0)) for r in rows)
        return (h / ip * 9) if ip > 0 else 0
    l5  = h9(sp_logs[:5])
    szn = h9(sp_logs)
    if szn <= 0:
        return 1.0
    # More hits allowed recently = better for batter
    return max(0.80, min(1.25, l5 / szn))


def _wind_direction_tb_factor(weather: dict, park: dict) -> float:
    """Wind direction effect on total bases."""
    if not weather:
        return 1.0
    wind_mph = weather.get('wind_mph', 0)
    wind_dir = weather.get('wind_dir_deg', 180)
    label = wind_direction_label(wind_dir)
    # Out = blowing toward outfield (S/SE/SW for most parks)
    blowing_out = label in ('S', 'SW', 'SE')
    blowing_in  = label in ('N', 'NE', 'NW')
    if wind_mph >= 20:
        f = 1.12 if blowing_out else (0.90 if blowing_in else 1.03)
    elif wind_mph >= 15:
        f = 1.08 if blowing_out else (0.93 if blowing_in else 1.01)
    elif wind_mph >= 10:
        f = 1.04 if blowing_out else (0.97 if blowing_in else 1.00)
    else:
        f = 1.0
    return max(0.88, min(1.18, f))


def _temperature_tb_factor(weather: dict) -> float:
    """Temperature effect on ball carry / total bases."""
    if not weather:
        return 1.0
    temp = weather.get('temp_f', 72)
    if temp < 40:  return 0.93
    if temp < 50:  return 0.96
    if temp < 65:  return 0.98
    if temp >= 85: return 1.05
    if temp >= 75: return 1.02
    return 1.0


def _sp_whip_factor(sp_logs: list[dict]) -> float:
    """league_avg_WHIP / SP WHIP last 5 — high WHIP = more runners."""
    if len(sp_logs) < 5:
        return 1.0
    recent_whip = rolling_avg(sp_logs, 'true_shooting_pct', min(5, len(sp_logs)))  # true_shooting_pct = WHIP
    if recent_whip <= 0:
        return 1.0
    factor = LEAGUE_AVG['whip'] / recent_whip
    return max(0.70, min(1.40, factor))


def _compute_bb9(rows: list[dict]) -> float:
    bb = sum(safe(r.get('turnovers', 0)) for r in rows)
    ip = sum(safe(r.get('minutes', 0)) for r in rows)
    return (bb / ip * 9) if ip > 0 else 0


def get_team_k_rate_from_logs(team_logs: list[dict]) -> float:
    """Compute team batter K rate from team_game_logs if turnovers/fg_att available."""
    total_k = sum(safe(r.get('turnovers', 0) or r.get('strikeouts', 0)) for r in team_logs)
    total_ab = sum(safe(r.get('fg_att', 0) or r.get('at_bats', 0)) for r in team_logs)
    if total_ab > 0:
        return max(0.150, min(0.320, total_k / total_ab))
    # If columns not available, use points_scored as rough proxy
    avg_runs = sum(safe(r.get('points_scored', 4.6)) for r in team_logs) / len(team_logs) if team_logs else 4.6
    # High scoring = low K% (contact hitters), roughly
    return max(0.180, min(0.290, 0.233 + (4.6 - avg_runs) * 0.01))


# ── Batter projection functions ─────────────────────────────────────────────────

def project_hits(
    batter_logs: list[dict],
    sp_logs: list[dict],
    weather: dict,
    park: dict,
    home_away: str,
    lineup_pos: int,
    lineup_confirmed: bool = True,
    batter_splits: dict = None,
    sp_hand: str = 'R',
) -> tuple[float, dict]:
    """
    Project hits for one batter in one game.
    v2.0: adds BA trend, contact rate, platoon splits, lineup PA factor.
    """
    if not batter_logs:
        base = LEAGUE_AVG['hits_per_game']
        ba_trend_f = contact_f = babip_f = 1.0
        platoon_f = home_f = lp_f = 1.0
    else:
        base = weighted_avg(batter_logs, 'fg_made')
        if base == 0:
            base = LEAGUE_AVG['hits_per_game']
        ba_trend_f = compute_ba_trend_factor(batter_logs)
        contact_f  = compute_contact_rate_factor(batter_logs)
        babip      = compute_babip(batter_logs[:30])
        if babip > 0.350:   babip_f = 0.93
        elif babip < 0.270: babip_f = 1.07
        else:               babip_f = 1.0
        home_f  = home_away_factor(batter_logs, 'fg_made', home_away)

        # Platoon split
        season_avg = rolling_avg(batter_logs, 'fg_made', len(batter_logs)) / max(1, rolling_avg(batter_logs, 'fg_att', len(batter_logs))) if batter_logs else LEAGUE_AVG['ba']
        platoon_f = platoon_split_factor(batter_splits or {}, sp_hand, season_avg) if batter_splits else 1.0

        lp_f = compute_lineup_pa_factor(lineup_pos, lineup_confirmed)

    sp_f      = sp_hits_allowed_factor(sp_logs)
    sp_trend_f = _sp_h9_trend(sp_logs)
    park_f    = park.get('hits', 1.0)
    weather_f = weather_hits_factor(weather)

    projection = base * ba_trend_f * contact_f * babip_f * sp_f * sp_trend_f * park_f * weather_f * home_f * lp_f * platoon_f
    factors = {
        'base':              round(base, 3),
        'ba_trend_f':        round(ba_trend_f, 3),
        'contact_f':         round(contact_f, 3),
        'babip_f':           round(babip_f, 3),
        'babip':             round(compute_babip(batter_logs[:30]) if batter_logs else LEAGUE_AVG['babip'], 3),
        'sp_hits_f':         round(sp_f, 3),
        'sp_h9_trend_f':     round(sp_trend_f, 3),
        'park_f':            round(park_f, 3),
        'weather_f':         round(weather_f, 3),
        'home_away_f':       round(home_f, 3),
        'lineup_pa_f':       round(lp_f, 3),
        'platoon_f':         round(platoon_f, 3),
        'sp_hand':           sp_hand,
        'lineup_confirmed':  lineup_confirmed,
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 3), factors


def project_total_bases(
    batter_logs: list[dict],
    sp_logs: list[dict],
    weather: dict,
    park: dict,
    home_away: str,
    lineup_pos: int,
    lineup_confirmed: bool = True,
    batter_splits: dict = None,
    sp_hand: str = 'R',
) -> tuple[float, dict]:
    """
    Project total bases (1B + 2x2B + 3x3B + 4xHR).
    v2.0: adds ISO, HR/FB proxy, wind direction, temperature, platoon SLG split.
    """
    if not batter_logs:
        base = LEAGUE_AVG['tb_per_game']
        iso_f = hr_fb_f = home_f = lp_f = platoon_f = 1.0
    else:
        hits = weighted_avg(batter_logs, 'fg_made')
        dbls = weighted_avg(batter_logs, 'off_reb')
        trpl = weighted_avg(batter_logs, 'def_reb')
        hrs  = weighted_avg(batter_logs, 'three_made')
        singles = max(0, hits - dbls - trpl - hrs)
        base = singles + 2*dbls + 3*trpl + 4*hrs
        if base == 0:
            base = LEAGUE_AVG['tb_per_game']

        iso   = compute_iso(batter_logs[:30])
        iso_f = max(0.55, min(1.65, iso / LEAGUE_AVG['iso']))

        # HR/FB proxy from HR rate
        hr_rate_f = compute_hr_rate_factor(batter_logs)
        hr_fb_f   = max(0.70, min(1.40, 0.70 + hr_rate_f * 0.30))  # dampened

        home_f  = home_away_factor(batter_logs, 'three_made', home_away)
        lp_f    = lineup_position_factor(lineup_pos)

        # Platoon SLG split
        season_slg = base / max(1, rolling_avg(batter_logs, 'fg_att', len(batter_logs)))
        if batter_splits and sp_hand:
            key = 'vs_lhp_slg' if sp_hand == 'L' else 'vs_rhp_slg'
            split_slg = batter_splits.get(key)
            if split_slg and season_slg > 0:
                platoon_f = max(0.70, min(1.40, float(split_slg) / season_slg))
            else:
                platoon_f = 1.0
        else:
            platoon_f = 1.0

    sp_hits_f = sp_hits_allowed_factor(sp_logs)
    sp_hr_f   = sp_hr_allowed_factor(sp_logs)
    sp_f      = sp_hits_f * 0.5 + sp_hr_f * 0.5
    park_f    = park.get('hr', 1.0) * 0.5 + park.get('hits', 1.0) * 0.5

    # Wind direction factor for total bases
    wind_dir_f = _wind_direction_tb_factor(weather, park)

    temp_f = _temperature_tb_factor(weather)

    # Altitude bonus
    alt_ft = park.get('altitude_ft', 100)
    alt_f  = 1.08 if alt_ft >= 5000 else (1.02 if alt_ft >= 1000 else 1.0)

    projection = base * iso_f * hr_fb_f * sp_f * park_f * wind_dir_f * temp_f * alt_f * home_f * (0.9 + lp_f * 0.1) * platoon_f
    factors = {
        'base':          round(base, 3),
        'iso':           round(compute_iso(batter_logs[:30]) if batter_logs else LEAGUE_AVG['iso'], 3),
        'iso_f':         round(iso_f if batter_logs else 1.0, 3),
        'hr_fb_f':       round(hr_fb_f if batter_logs else 1.0, 3),
        'sp_hits_f':     round(sp_hits_f, 3),
        'sp_hr_f':       round(sp_hr_f, 3),
        'park_f':        round(park_f, 3),
        'wind_dir_f':    round(wind_dir_f, 3),
        'temp_f':        round(temp_f, 3),
        'altitude_f':    round(alt_f, 3),
        'home_away_f':   round(home_f if batter_logs else 1.0, 3),
        'lineup_pos_f':  round(lp_f if batter_logs else 1.0, 3),
        'platoon_slg_f': round(platoon_f, 3),
        'sp_hand':       sp_hand,
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 3), factors


def project_home_runs(
    batter_logs: list[dict],
    sp_logs: list[dict],
    weather: dict,
    park: dict,
    home_away: str,
    lineup_pos: int,
    batter_splits: dict = None,
    sp_hand: str = 'R',
) -> tuple[float, dict]:
    """
    Project HR probability for one batter.
    v2.0: adds HR rate factor, GB/FB proxy via SP HR/9, platoon SLG split.
    """
    if not batter_logs:
        base = LEAGUE_AVG['hr_per_game']
        hr_rate_f = iso_f = home_f = lp_f = platoon_f = 1.0
    else:
        base = weighted_avg(batter_logs, 'three_made')
        if base == 0:
            base = LEAGUE_AVG['hr_per_game']

        hr_rate_f = compute_hr_rate_factor(batter_logs)
        iso_f     = max(0.40, min(2.0, compute_iso(batter_logs[:30]) / LEAGUE_AVG['iso']))
        home_f    = home_away_factor(batter_logs, 'three_made', home_away)
        lp_f      = 1.08 if 3 <= lineup_pos <= 5 else (0.88 if lineup_pos >= 8 else 0.95)

        # Platoon HR split
        season_hr_rate = weighted_avg(batter_logs, 'three_made')
        if batter_splits and sp_hand and season_hr_rate > 0:
            key = 'vs_lhp_slg' if sp_hand == 'L' else 'vs_rhp_slg'
            split_slg = batter_splits.get(key)
            szn_slg_approx = compute_iso(batter_logs[:30]) + LEAGUE_AVG['ba']
            if split_slg and szn_slg_approx > 0:
                platoon_f = max(0.65, min(1.50, float(split_slg) / szn_slg_approx))
            else:
                platoon_f = 1.0
        else:
            platoon_f = 1.0

    sp_hr_f   = sp_hr_allowed_factor(sp_logs)
    sp_hr9    = compute_sp_hr9(sp_logs)
    gb_proxy_f = 0.88 if sp_hr9 < 0.90 else (1.10 if sp_hr9 > 1.80 else 1.0)  # GB vs FB pitcher

    park_f    = park.get('hr', 1.0)
    alt_ft    = park.get('altitude_ft', 100)
    alt_f     = 1.08 if alt_ft >= 5000 else (1.02 if alt_ft >= 1000 else 1.0)

    wind_dir_f = _wind_direction_tb_factor(weather, park)  # same logic as TB
    temp_f     = _temperature_tb_factor(weather)

    projection = base * hr_rate_f * iso_f * sp_hr_f * gb_proxy_f * park_f * alt_f * wind_dir_f * temp_f * home_f * lp_f * platoon_f
    factors = {
        'base':         round(base, 4),
        'hr_rate_f':    round(hr_rate_f if batter_logs else 1.0, 3),
        'iso_f':        round(iso_f if batter_logs else 1.0, 3),
        'sp_hr_f':      round(sp_hr_f, 3),
        'sp_hr9':       round(sp_hr9, 3),
        'gb_proxy_f':   round(gb_proxy_f, 3),
        'park_hr_f':    round(park_f, 3),
        'altitude_f':   round(alt_f, 3),
        'wind_dir_f':   round(wind_dir_f, 3),
        'temp_f':       round(temp_f, 3),
        'home_away_f':  round(home_f if batter_logs else 1.0, 3),
        'lineup_pos_f': round(lp_f if batter_logs else 1.0, 3),
        'platoon_f':    round(platoon_f, 3),
        'sp_hand':      sp_hand,
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 4), factors


def project_rbi(
    batter_logs: list[dict],
    sp_logs: list[dict],
    weather: dict,
    park: dict,
    home_away: str,
    lineup_pos: int,
    teammates_obp: float,
    lineup_confirmed: bool = True,
) -> tuple[float, dict]:
    """
    Project RBI.
    v2.0: adds lineup position cleanup bonus, WHIP factor, blended SP quality.
    rebounds column = RBI in mlbDataCollector mapping.
    """
    if not batter_logs:
        base = LEAGUE_AVG['rbi_per_game']
        home_f = 1.0
    else:
        base = weighted_avg(batter_logs, 'rebounds')  # rebounds = RBI
        if base == 0:
            base = LEAGUE_AVG['rbi_per_game']
        home_f = home_away_factor(batter_logs, 'rebounds', home_away)

    # Lineup position — cleanup hitters have most RBI chances
    if lineup_confirmed:
        if lineup_pos == 4:       lp_f = 1.20
        elif lineup_pos in (3,5): lp_f = 1.10
        elif lineup_pos <= 2:     lp_f = 0.85   # bats with bases empty often
        elif lineup_pos <= 6:     lp_f = 0.95
        else:                     lp_f = 0.88
    else:
        lp_f = 1.0

    sp_era_f_v = sp_era_factor(sp_logs)
    sp_whip_f  = _sp_whip_factor(sp_logs)
    sp_f       = sp_era_f_v * 0.5 + sp_whip_f * 0.5

    park_f    = park.get('runs', 1.0)
    weather_f = weather_tb_factor(weather, '') * 0.6 + weather_hits_factor(weather) * 0.4

    # Men on base = RBI opportunities
    mob_f = max(0.75, min(1.30, teammates_obp / LEAGUE_AVG['obp']))

    projection = base * sp_f * park_f * weather_f * home_f * lp_f * mob_f
    factors = {
        'base':             round(base, 3),
        'sp_era_f':         round(sp_era_f_v, 3),
        'sp_whip_f':        round(sp_whip_f, 3),
        'sp_blended_f':     round(sp_f, 3),
        'park_runs_f':      round(park_f, 3),
        'weather_f':        round(weather_f, 3),
        'home_away_f':      round(home_f, 3),
        'lineup_pos_f':     round(lp_f, 3),
        'teammates_obp':    round(teammates_obp, 3),
        'mob_f':            round(mob_f, 3),
        'lineup_confirmed': lineup_confirmed,
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 3), factors


def project_runs(
    batter_logs: list[dict],
    sp_logs: list[dict],
    weather: dict,
    park: dict,
    home_away: str,
    lineup_pos: int,
    lineup_confirmed: bool = True,
) -> tuple[float, dict]:
    """
    Project runs scored.
    v2.0: adds OBP factor, speed/SB proxy, lineup position granularity.
    points column = runs in mlbDataCollector hitter mapping.
    """
    if not batter_logs:
        base = LEAGUE_AVG['runs_per_game']
        obp_f = home_f = 1.0
    else:
        base = weighted_avg(batter_logs, 'points')  # points = runs
        if base == 0:
            base = LEAGUE_AVG['runs_per_game']
        obp_f  = compute_obp_factor(batter_logs)
        home_f = home_away_factor(batter_logs, 'points', home_away)

    if lineup_confirmed:
        if lineup_pos == 1:     lp_f = 1.30
        elif lineup_pos == 2:   lp_f = 1.15
        elif lineup_pos <= 4:   lp_f = 1.05
        elif lineup_pos <= 6:   lp_f = 0.92
        elif lineup_pos <= 8:   lp_f = 0.88
        else:                   lp_f = 0.80
    else:
        lp_f = 1.0

    # Speed proxy from SB rate
    if batter_logs:
        sb_f_val = compute_sb_rate_factor(batter_logs)
        speed_f  = max(0.90, min(1.15, 0.92 + sb_f_val * 0.08))
    else:
        speed_f = 1.0

    sp_bb_f    = sp_bb_allowed_factor(sp_logs)
    sp_era_f_v = sp_era_factor(sp_logs)
    sp_f       = sp_bb_f * 0.5 + sp_era_f_v * 0.5
    park_f     = park.get('runs', 1.0)
    weather_f  = weather_hits_factor(weather)

    projection = base * obp_f * sp_f * park_f * weather_f * home_f * lp_f * speed_f
    factors = {
        'base':             round(base, 3),
        'obp_f':            round(obp_f if batter_logs else 1.0, 3),
        'sp_bb_f':          round(sp_bb_f, 3),
        'sp_era_f':         round(sp_era_f_v, 3),
        'sp_blended_f':     round(sp_f, 3),
        'park_runs_f':      round(park_f, 3),
        'weather_f':        round(weather_f, 3),
        'home_away_f':      round(home_f if batter_logs else 1.0, 3),
        'lineup_pos_f':     round(lp_f, 3),
        'speed_f':          round(speed_f, 3),
        'lineup_confirmed': lineup_confirmed,
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 3), factors


def project_stolen_bases(
    batter_logs: list[dict],
    sp_logs: list[dict],
    weather: dict,
    park: dict,
    home_away: str,
    sp_hand: str = 'R',
) -> tuple[float, dict]:
    """
    Project stolen bases.
    v2.0: adds SB rate factor, OBP factor, pitcher handedness (LHP holds runners).
    steals column maps directly.
    """
    if not batter_logs:
        base = LEAGUE_AVG['sb_per_game']
        sb_rate_f = home_f = obp_f = 1.0
    else:
        base = weighted_avg(batter_logs, 'steals')
        if base < 0.01:
            base = 0.01
        sb_rate_f = compute_sb_rate_factor(batter_logs)
        home_f    = home_away_factor(batter_logs, 'steals', home_away)
        obp_f     = max(0.80, min(1.20, compute_obp_factor(batter_logs)))  # must reach base

    # LHP holds runners better
    handedness_f = 0.88 if sp_hand == 'L' else 1.08

    sp_k_f    = max(0.80, min(1.15, 1.0 / max(0.8, sp_strikeout_factor(sp_logs))))  # fewer baserunners vs K pitcher
    temp_f_val = weather.get('temp_f', 72) if weather else 72
    cold_f     = 0.90 if temp_f_val < 45 else (0.95 if temp_f_val < 55 else 1.0)

    projection = base * sb_rate_f * obp_f * handedness_f * sp_k_f * cold_f * home_f
    factors = {
        'base':          round(base, 4),
        'sb_rate_f':     round(sb_rate_f if batter_logs else 1.0, 3),
        'obp_f':         round(obp_f if batter_logs else 1.0, 3),
        'handedness_f':  round(handedness_f, 3),
        'sp_k_factor':   round(sp_k_f, 3),
        'cold_f':        round(cold_f, 3),
        'home_away_f':   round(home_f if batter_logs else 1.0, 3),
        'sp_hand':       sp_hand,
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 4), factors


# ── Pitcher projection functions ─────────────────────────────────────────────────

def project_strikeouts(
    sp_logs: list[dict],
    opp_team_logs: list[dict],
    weather: dict,
    home_away: str,
    opp_k_rate: float = None,
    days_rest: int = 5,
    sp_hand: str = 'R',
) -> tuple[float, dict]:
    """
    Project SP strikeouts.
    v2.0: adds K/9 trend, declining K signal, opp K% from logs fallback, days rest.
    assists = strikeOuts in pitcher game logs.
    """
    if not sp_logs:
        base = LEAGUE_AVG['k_per_9'] * 5.5 / 9  # ~5.3 Ks in average start
    else:
        base = weighted_avg(sp_logs, 'assists')  # assists = strikeOuts (pitcher)
        if base == 0:
            base = LEAGUE_AVG['k_per_9'] * 5.5 / 9

    k9_trend_f = compute_sp_k9_trend(sp_logs)

    # Declining K proxy (velocity drop signal)
    if len(sp_logs) >= 10:
        k_l3  = rolling_avg(sp_logs, 'assists', 3)
        k_l10 = rolling_avg(sp_logs, 'assists', 10)
        declining_k_f = max(0.88, min(1.0, (k_l3 / k_l10) if k_l10 > 0 else 1.0))
    else:
        declining_k_f = 1.0

    # Opponent K% (from DB or team logs fallback)
    if opp_k_rate and opp_k_rate > 0:
        opp_k_f = max(0.80, min(1.25, opp_k_rate / LEAGUE_AVG['k_pct']))
    elif opp_team_logs:
        opp_k_rate_computed = get_team_k_rate_from_logs(opp_team_logs)
        opp_k_f = max(0.80, min(1.25, opp_k_rate_computed / LEAGUE_AVG['k_pct']))
    else:
        opp_k_f = 1.0

    temp_f_val = weather.get('temp_f', 72) if weather else 72
    cold_k_f   = 0.96 if temp_f_val < 45 else (0.98 if temp_f_val < 55 else 1.0)
    home_f     = 1.03 if home_away == 'home' else 0.98
    rest_f     = days_rest_factor_k(days_rest)

    projection = base * k9_trend_f * declining_k_f * opp_k_f * cold_k_f * home_f * rest_f
    factors = {
        'base':           round(base, 3),
        'k9_trend_f':     round(k9_trend_f, 3),
        'declining_k_f':  round(declining_k_f, 3),
        'opp_k_pct_f':    round(opp_k_f, 3),
        'opp_k_rate':     round(opp_k_rate if opp_k_rate else 0.233, 3),
        'cold_k_f':       round(cold_k_f, 3),
        'home_f':         round(home_f, 3),
        'days_rest_f':    round(rest_f, 3),
        'days_rest':      days_rest,
        'games_used':     len(sp_logs),
        'sp_hand':        sp_hand,
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 3), factors


def project_earned_runs(
    sp_logs: list[dict],
    opp_team_logs: list[dict],
    weather: dict,
    park: dict,
    home_away: str,
    days_rest: int = 5,
) -> tuple[float, dict]:
    """
    Project earned runs allowed by SP.
    v2.0: adds FIP/ERA regression, HR/9 GB-proxy, wind direction, days rest.
    points = runs allowed in pitcher game logs.
    """
    if not sp_logs:
        base = LEAGUE_AVG['era'] * 5.0 / 9
    else:
        base = weighted_avg(sp_logs, 'points')  # points = runs allowed (pitcher)
        if base == 0:
            base = LEAGUE_AVG['era'] * 5.0 / 9

    fip_era_f = fip_vs_era_factor(sp_logs)

    sp_hr9    = compute_sp_hr9(sp_logs)
    hr9_f     = max(0.70, min(1.50, sp_hr9 / LEAGUE_AVG['hr_per_9']))

    # GB/FB proxy
    gb_proxy_f = 0.92 if sp_hr9 < 0.90 else (1.10 if sp_hr9 > 1.80 else 1.0)

    if opp_team_logs:
        opp_avg_scored = weighted_avg(opp_team_logs, 'points_scored')
        opp_off_f = max(0.75, min(1.30, opp_avg_scored / LEAGUE_AVG['team_runs_per_game'])) if opp_avg_scored > 0 else 1.0
    else:
        opp_off_f = 1.0

    park_f    = park.get('runs', 1.0)
    wind_f    = _wind_direction_tb_factor(weather, park)  # same wind logic
    temp_f    = _temperature_tb_factor(weather)
    home_f    = 0.93 if home_away == 'home' else 1.07
    rest_f    = days_rest_factor_er(days_rest)

    if len(sp_logs) >= 5:
        l5_er  = rolling_avg(sp_logs, 'points', 5)
        szn_er = rolling_avg(sp_logs, 'points', len(sp_logs))
        trend_f = max(0.60, min(1.60, l5_er / szn_er)) if szn_er > 0 else 1.0
    else:
        trend_f = 1.0

    projection = base * fip_era_f * hr9_f * gb_proxy_f * opp_off_f * park_f * wind_f * temp_f * home_f * rest_f * trend_f
    factors = {
        'base':        round(base, 3),
        'fip_vs_era_f':round(fip_era_f, 3),
        'fip':         round(compute_sp_fip(sp_logs), 3) if sp_logs else None,
        'era_recent':  round(rolling_avg(sp_logs, 'offensive_rating', min(5, len(sp_logs))), 3) if sp_logs else None,
        'hr9_f':       round(hr9_f, 3),
        'gb_proxy_f':  round(gb_proxy_f, 3),
        'opp_off_f':   round(opp_off_f, 3),
        'park_f':      round(park_f, 3),
        'wind_f':      round(wind_f, 3),
        'temp_f':      round(temp_f, 3),
        'home_f':      round(home_f, 3),
        'days_rest_f': round(rest_f, 3),
        'trend_f':     round(trend_f, 3),
        'games_used':  len(sp_logs),
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 3), factors


def project_walks(
    sp_logs: list[dict],
    opp_team_logs: list[dict],
    weather: dict,
    home_away: str,
    days_rest: int = 5,
) -> tuple[float, dict]:
    """
    Project walks issued by SP.
    v2.0: adds BB/9 trend, command consistency check, days rest factor.
    turnovers = BB allowed in pitcher game logs.
    """
    if not sp_logs:
        base = LEAGUE_AVG['bb_per_9'] * 5.5 / 9  # ~1.9 BB per average start
    else:
        base = weighted_avg(sp_logs, 'turnovers')  # turnovers = BB allowed (pitcher)
        if base == 0:
            base = LEAGUE_AVG['bb_per_9'] * 5.5 / 9

    bb9_trend_f = compute_sp_bb9_trend(sp_logs)

    # Command consistency check
    if len(sp_logs) >= 5:
        l5_bb9  = _compute_bb9(sp_logs[:5])
        szn_bb9 = _compute_bb9(sp_logs)
        command_f = max(0.85, min(1.20, 1.0 + (l5_bb9 - szn_bb9) * 0.10)) if szn_bb9 > 0 else 1.0
    else:
        command_f = 1.0

    weather_f = weather_walks_factor(weather)
    home_f    = 0.97 if home_away == 'home' else 1.03
    rest_f    = days_rest_factor_bb(days_rest)

    projection = base * bb9_trend_f * command_f * weather_f * home_f * rest_f
    factors = {
        'base':        round(base, 3),
        'bb9_trend_f': round(bb9_trend_f, 3),
        'command_f':   round(command_f, 3),
        'weather_f':   round(weather_f, 3),
        'home_f':      round(home_f, 3),
        'days_rest_f': round(rest_f, 3),
        'days_rest':   days_rest,
        'games_used':  len(sp_logs),
        'weather_available': bool(weather),
    }
    return round(max(0.0, projection), 3), factors


def project_outs_recorded(
    sp_logs: list[dict],
    weather: dict,
    bullpen_era: float,
    days_rest: int = 5,
    game_date=None,
) -> tuple[float, dict]:
    """
    Project outs recorded by SP.
    v2.0: adds days rest factor, tighter trend window.
    minutes = inningsPitched (float) in pitcher game logs; 1 out = 0.333 IP.
    """
    if not sp_logs:
        avg_ip = 5.0
    else:
        avg_ip = weighted_avg(sp_logs, 'minutes')  # minutes = IP
        if avg_ip == 0:
            avg_ip = 5.0

    temp_f_val = weather.get('temp_f', 72) if weather else 72
    cold_f = 0.93 if temp_f_val < 40 else (0.97 if temp_f_val < 50 else 1.0)

    # Good bullpen = manager pulls starter sooner
    if bullpen_era > 0:
        bp_f = min(1.05, max(0.93, bullpen_era / LEAGUE_AVG['era']))
    else:
        bp_f = 1.0

    rest_f = 0.93 if days_rest <= 3 else (0.98 if days_rest == 4 else 1.0)

    if len(sp_logs) >= 5:
        l5_ip  = rolling_avg(sp_logs, 'minutes', 5)
        szn_ip = rolling_avg(sp_logs, 'minutes', len(sp_logs))
        trend_f = max(0.80, min(1.15, l5_ip / szn_ip)) if szn_ip > 0 else 1.0
    else:
        trend_f = 1.0

    proj_ip   = avg_ip * cold_f * bp_f * rest_f * trend_f
    proj_outs = proj_ip * 3

    factors = {
        'base_ip':     round(avg_ip, 3),
        'cold_f':      round(cold_f, 3),
        'bullpen_f':   round(bp_f, 3),
        'bullpen_era': round(bullpen_era, 3),
        'days_rest_f': round(rest_f, 3),
        'trend_f':     round(trend_f, 3),
        'proj_ip':     round(proj_ip, 2),
        'games_used':  len(sp_logs),
        'weather_available': bool(weather),
    }
    return round(max(0.0, proj_outs), 3), factors


# ── Team projection functions ────────────────────────────────────────────────────

def _normal_cdf(x: float) -> float:
    """Standard normal CDF approximation using math.erf."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2)))


def project_moneyline(
    home_logs: list[dict],
    away_logs: list[dict],
    home_sp_logs: list[dict],
    away_sp_logs: list[dict],
    weather: dict,
    park: dict,
) -> tuple[float, dict]:
    """
    Project moneyline (win probability) for the home team.
    Uses log5 formula with run-based team strength + SP quality adjustment.
    Returns (moneyline_american_odds, factors_dict).
    """
    # Team win rates from recent games
    home_w = sum(1 for r in home_logs if r.get('result') == 'W')
    away_w = sum(1 for r in away_logs if r.get('result') == 'W')
    home_win_pct = (home_w / len(home_logs)) if home_logs else 0.5
    away_win_pct = (away_w / len(away_logs)) if away_logs else 0.5

    # SP quality adjustments — better SP boosts team's win probability
    home_sp_era = rolling_avg(home_sp_logs, 'offensive_rating', min(5, len(home_sp_logs))) if home_sp_logs else LEAGUE_AVG['era']
    away_sp_era = rolling_avg(away_sp_logs, 'offensive_rating', min(5, len(away_sp_logs))) if away_sp_logs else LEAGUE_AVG['era']

    home_sp_adj = max(0.94, min(1.06, LEAGUE_AVG['era'] / home_sp_era)) if home_sp_era > 0 else 1.0
    away_sp_adj = max(0.94, min(1.06, LEAGUE_AVG['era'] / away_sp_era)) if away_sp_era > 0 else 1.0

    # Home field advantage in MLB (~54% historical)
    home_hfa = 1.05

    home_s = max(0.01, min(0.99, home_win_pct * home_sp_adj * home_hfa))
    away_s = max(0.01, min(0.99, away_win_pct * away_sp_adj))

    # Log5 win probability
    denom    = home_s + away_s - 2 * home_s * away_s
    win_prob = (home_s - home_s * away_s) / denom if denom != 0 else 0.5
    win_prob = max(0.05, min(0.95, win_prob))

    # Convert to American moneyline
    if win_prob >= 0.5:
        ml = -(win_prob / (1 - win_prob)) * 100
    else:
        ml = ((1 - win_prob) / win_prob) * 100

    factors = {
        'home_win_pct':  round(home_win_pct, 4),
        'away_win_pct':  round(away_win_pct, 4),
        'home_sp_era':   round(home_sp_era, 3),
        'away_sp_era':   round(away_sp_era, 3),
        'home_sp_adj':   round(home_sp_adj, 3),
        'away_sp_adj':   round(away_sp_adj, 3),
        'home_hfa':      round(home_hfa, 3),
        'win_probability': round(win_prob, 4),
        'home_logs_used': len(home_logs),
        'away_logs_used': len(away_logs),
    }
    return round(ml, 2), factors


def project_run_line(
    home_logs: list[dict],
    away_logs: list[dict],
    home_sp_logs: list[dict],
    away_sp_logs: list[dict],
    weather: dict,
    park: dict,
) -> tuple[float, dict, float, dict]:
    """
    Project run differential (home - away) and return cover probabilities.
    Standard MLB run line is -1.5 / +1.5.
    Returns (proj_run_diff, factors_dict, run_line_cover_prob, cover_factors).
    """
    # Home team run production
    home_runs_scored  = weighted_avg(home_logs, 'points_scored') if home_logs else LEAGUE_AVG['team_runs_per_game']
    away_runs_scored  = weighted_avg(away_logs, 'points_scored') if away_logs else LEAGUE_AVG['team_runs_per_game']
    home_runs_allowed = weighted_avg(home_logs, 'points_allowed') if home_logs else LEAGUE_AVG['team_runs_per_game']
    away_runs_allowed = weighted_avg(away_logs, 'points_allowed') if away_logs else LEAGUE_AVG['team_runs_per_game']

    # SP ERA adjustment on runs allowed
    home_sp_era = rolling_avg(home_sp_logs, 'offensive_rating', min(5, len(home_sp_logs))) if home_sp_logs else LEAGUE_AVG['era']
    away_sp_era = rolling_avg(away_sp_logs, 'offensive_rating', min(5, len(away_sp_logs))) if away_sp_logs else LEAGUE_AVG['era']
    home_sp_adj = max(0.80, min(1.20, LEAGUE_AVG['era'] / home_sp_era)) if home_sp_era > 0 else 1.0
    away_sp_adj = max(0.80, min(1.20, LEAGUE_AVG['era'] / away_sp_era)) if away_sp_era > 0 else 1.0

    park_runs_f   = park.get('runs', 1.0)
    weather_f     = weather_hits_factor(weather) * 0.5 + weather_hr_factor(weather, '') * 0.5
    home_hfa_runs = 0.3  # home teams score ~0.3 more runs per game historically

    # Projected runs each team scores
    proj_home_runs = (home_runs_scored * away_sp_adj + (LEAGUE_AVG['team_runs_per_game'] - away_runs_allowed)) / 2
    proj_away_runs = (away_runs_scored * home_sp_adj + (LEAGUE_AVG['team_runs_per_game'] - home_runs_allowed)) / 2
    proj_home_runs = proj_home_runs * park_runs_f * weather_f + home_hfa_runs
    proj_away_runs = proj_away_runs * park_runs_f * weather_f

    proj_run_diff = proj_home_runs - proj_away_runs

    # Run line cover probability (home team -1.5)
    # Cover if proj_run_diff > 1.5
    rl_cover_prob = round(_normal_cdf((proj_run_diff - 1.5) / SPREAD_STD_DEV), 4)

    factors = {
        'home_runs_scored_avg':  round(home_runs_scored, 3),
        'away_runs_scored_avg':  round(away_runs_scored, 3),
        'home_runs_allowed_avg': round(home_runs_allowed, 3),
        'away_runs_allowed_avg': round(away_runs_allowed, 3),
        'home_sp_era':           round(home_sp_era, 3),
        'away_sp_era':           round(away_sp_era, 3),
        'home_sp_adj':           round(home_sp_adj, 3),
        'away_sp_adj':           round(away_sp_adj, 3),
        'park_runs_f':           round(park_runs_f, 3),
        'weather_f':             round(weather_f, 3),
        'home_hfa_runs':         home_hfa_runs,
        'proj_home_runs':        round(proj_home_runs, 3),
        'proj_away_runs':        round(proj_away_runs, 3),
    }
    cover_factors = {
        'proj_run_diff':    round(proj_run_diff, 3),
        'run_line':         -1.5,
        'std_dev':          SPREAD_STD_DEV,
        'rl_cover_prob':    rl_cover_prob,
    }
    return round(proj_run_diff, 3), factors, rl_cover_prob, cover_factors


def project_total(
    home_logs: list[dict],
    away_logs: list[dict],
    home_sp_logs: list[dict],
    away_sp_logs: list[dict],
    weather: dict,
    park: dict,
) -> tuple[float, dict]:
    """
    Project game total (combined runs).
    Park factor and weather are the most powerful levers here.
    """
    home_runs_scored  = weighted_avg(home_logs, 'points_scored') if home_logs else LEAGUE_AVG['team_runs_per_game']
    away_runs_scored  = weighted_avg(away_logs, 'points_scored') if away_logs else LEAGUE_AVG['team_runs_per_game']

    home_sp_era = rolling_avg(home_sp_logs, 'offensive_rating', min(5, len(home_sp_logs))) if home_sp_logs else LEAGUE_AVG['era']
    away_sp_era = rolling_avg(away_sp_logs, 'offensive_rating', min(5, len(away_sp_logs))) if away_sp_logs else LEAGUE_AVG['era']

    # SP quality inversely suppresses runs
    home_sp_runs_adj = max(0.70, min(1.30, away_sp_era / LEAGUE_AVG['era'])) if away_sp_era > 0 else 1.0  # away SP faces home batters
    away_sp_runs_adj = max(0.70, min(1.30, home_sp_era / LEAGUE_AVG['era'])) if home_sp_era > 0 else 1.0

    park_runs_f  = park.get('runs', 1.0)
    # Weather is the biggest swing factor for totals
    weather_runs = weather_hr_factor(weather, '') * 0.5 + weather_hits_factor(weather) * 0.5

    proj_home_runs = home_runs_scored * home_sp_runs_adj * park_runs_f * weather_runs
    proj_away_runs = away_runs_scored * away_sp_runs_adj * park_runs_f * weather_runs
    proj_total     = proj_home_runs + proj_away_runs

    factors = {
        'home_runs_scored_avg': round(home_runs_scored, 3),
        'away_runs_scored_avg': round(away_runs_scored, 3),
        'home_sp_era':          round(home_sp_era, 3),
        'away_sp_era':          round(away_sp_era, 3),
        'home_sp_runs_adj':     round(home_sp_runs_adj, 3),
        'away_sp_runs_adj':     round(away_sp_runs_adj, 3),
        'park_runs_f':          round(park_runs_f, 3),
        'weather_runs_f':       round(weather_runs, 3),
        'proj_home_runs':       round(proj_home_runs, 3),
        'proj_away_runs':       round(proj_away_runs, 3),
        'weather_available':    bool(weather),
    }
    return round(max(0.0, proj_total), 3), factors


# ── DB write functions ───────────────────────────────────────────────────────────

def upsert_player_projection(
    conn,
    player_id: int,
    player_name: str,
    team: str,
    opponent: str,
    game_date: date,
    proj: dict,
) -> int:
    """
    Upsert one row per prop type into chalk_projections.
    Architecture: ONE ROW PER PLAYER PER PROP PER GAME matching the NHL model.

    For BATTERS, inserts 6 rows (hits, total_bases, home_runs, rbi, runs, stolen_bases).
    For PITCHERS, inserts 4 rows (strikeouts, earned_runs, walks, outs_recorded).

    Returns the number of rows upserted.
    """
    home_away   = proj.get('home_away', 'home')
    confidence  = proj.get('confidence_score', 60)
    factors_all = proj.get('factors_json', {})
    rows_written = 0

    # Determine batter vs pitcher by which keys are populated
    is_pitcher = proj.get('proj_k', 0) > 0 or proj.get('proj_er', 0) > 0 or proj.get('proj_outs', 0) > 0

    if is_pitcher:
        prop_rows = [
            ('strikeouts',    proj.get('proj_k', 0),    factors_all.get('strikeouts', {})),
            ('earned_runs',   proj.get('proj_er', 0),   factors_all.get('earned_runs', {})),
            ('walks',         proj.get('proj_walks', 0), factors_all.get('walks', {})),
            ('outs_recorded', proj.get('proj_outs', 0), factors_all.get('outs_recorded', {})),
        ]
    else:
        prop_rows = [
            ('hits',          proj.get('proj_hits', 0), factors_all.get('hits', {})),
            ('total_bases',   proj.get('proj_tb', 0),   factors_all.get('tb', {})),
            ('home_runs',     proj.get('proj_hr', 0),   factors_all.get('hr', {})),
            ('rbi',           proj.get('proj_rbi', 0),  factors_all.get('rbi', {})),
            ('runs',          proj.get('proj_runs', 0), factors_all.get('runs', {})),
            ('stolen_bases',  proj.get('proj_sb', 0),   factors_all.get('sb', {})),
        ]

    with conn.cursor() as cur:
        for prop_type, proj_value, prop_factors in prop_rows:
            # Merge context into per-prop factors
            merged_factors = dict(prop_factors)
            if 'context' in factors_all:
                merged_factors['context'] = factors_all['context']
            merged_factors['lineup_confirmed'] = proj.get('lineup_confirmed', True)

            cur.execute(
                """INSERT INTO chalk_projections (
                     player_id, player_name, team, sport, game_date, opponent, home_away,
                     prop_type, proj_value,
                     confidence_score, model_version, factors_json
                   ) VALUES (
                     %s, %s, %s, 'MLB', %s, %s, %s,
                     %s, %s,
                     %s, %s, %s
                   )
                   ON CONFLICT (player_id, game_date, prop_type) DO UPDATE SET
                     proj_value       = EXCLUDED.proj_value,
                     confidence_score = EXCLUDED.confidence_score,
                     factors_json     = EXCLUDED.factors_json,
                     model_version    = EXCLUDED.model_version""",
                (
                    player_id, player_name, team, game_date, opponent, home_away,
                    prop_type, proj_value,
                    confidence, MODEL_VERSION, json.dumps(merged_factors),
                )
            )
            rows_written += 1
    conn.commit()
    return rows_written


def upsert_team_projection(
    conn,
    team_name: str,
    opponent: str,
    game_date: date,
    proj: dict,
) -> None:
    """
    Upsert a team projection into team_projections.
    Uses the actual unique index: (team_name, game_date, prop_type).
    Stores one row with prop_type='game' to hold all team game-level projections.
    """
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
                 %(opponent)s, %(home_away)s,
                 'game',
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


# ── Game processing helpers ──────────────────────────────────────────────────────

def get_pitcher_hand(player_id: int) -> str:
    """Returns 'L' or 'R' for pitcher throwing hand."""
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
    return 'R'  # default to right-handed


def _extract_sps_from_boxscore(boxscore: dict) -> tuple[Optional[dict], Optional[dict]]:
    """
    Extract home and away starting pitchers from a boxscore_data response.
    Returns (home_sp, away_sp) dicts with id, name, throws keys.
    """
    home_sp = None
    away_sp = None

    for side_key in ('home', 'away'):
        side_data = boxscore.get(side_key, {})
        players   = side_data.get('players', {})
        pitching_order = side_data.get('pitchers', [])
        if pitching_order:
            sp_id   = pitching_order[0]
            pid_key = f'ID{sp_id}'
            sp_info = players.get(pid_key, {}).get('person', {})
            sp_dict = {
                'id':     int(sp_id),
                'name':   sp_info.get('fullName', f'Pitcher {sp_id}'),
                'throws': 'R',  # will be fetched separately if needed
            }
            if side_key == 'home':
                home_sp = sp_dict
            else:
                away_sp = sp_dict

    return home_sp, away_sp


def get_batting_lineup_with_fallback(
    conn,
    game_pk: int,
    home_team: str,
    away_team: str,
    home_team_id: int,
    away_team_id: int,
    game_date: date,
) -> tuple[list[dict], list[dict], bool, Optional[dict], Optional[dict]]:
    """
    Three-tier fallback system for batting lineups.

    Tier 1: statsapi.boxscore_data — official lineup if posted (>= 9 batters)
    Tier 2: player_game_logs — batters who played yesterday for each team
    Tier 3: MLB active roster API — non-pitchers, first 9

    Returns:
      (home_lineup, away_lineup, lineup_confirmed, home_sp, away_sp)
      lineup_confirmed = True only when Tier 1 succeeds with >= 9 batters per side
    """
    home_sp = None
    away_sp = None

    # ── Tier 1: Live boxscore ─────────────────────────────────────────
    try:
        boxscore = statsapi.boxscore_data(game_pk)

        home_lineup_t1 = []
        away_lineup_t1 = []

        for side_key, lineup_list in [('home', home_lineup_t1), ('away', away_lineup_t1)]:
            side_data     = boxscore.get(side_key, {})
            players       = side_data.get('players', {})
            batting_order = side_data.get('battingOrder', [])

            for order_idx, player_id in enumerate(batting_order):
                pid_key = f'ID{player_id}'
                player  = players.get(pid_key, {})
                info    = player.get('person', {})
                pos     = player.get('position', {}).get('abbreviation', '')
                lineup_list.append({
                    'id':            int(player_id),
                    'name':          info.get('fullName', f'Player {player_id}'),
                    'batting_order': order_idx + 1,
                    'position':      pos,
                })

        # Only accept Tier 1 if both sides have >= 9 batters
        if len(home_lineup_t1) >= 9 and len(away_lineup_t1) >= 9:
            home_sp, away_sp = _extract_sps_from_boxscore(boxscore)
            log.info(f'  Lineup source: Tier 1 (boxscore) — {len(home_lineup_t1)} home / {len(away_lineup_t1)} away batters')
            return home_lineup_t1, away_lineup_t1, True, home_sp, away_sp

        log.info(f'  Tier 1 incomplete (home={len(home_lineup_t1)}, away={len(away_lineup_t1)}). Trying Tier 2.')
        # Still extract SPs if available
        if home_sp is None and away_sp is None:
            home_sp, away_sp = _extract_sps_from_boxscore(boxscore)

    except Exception as exc:
        log.warning(f'  boxscore_data({game_pk}) failed: {exc}. Trying Tier 2.')

    # ── Tier 2: Yesterday's player_game_logs ──────────────────────────
    yesterday = game_date - timedelta(days=1)

    def get_yesterday_lineup(team_name: str) -> list[dict]:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT player_id, player_name, home_away
                   FROM player_game_logs
                   WHERE team ILIKE %s AND sport = 'MLB'
                     AND game_date = %s
                     AND fg_att IS NOT NULL
                   ORDER BY player_id
                   LIMIT 12""",
                (f'%{team_name[:3]}%', yesterday),
            )
            rows = cur.fetchall()
        if len(rows) >= 7:
            return [
                {
                    'id':            r['player_id'],
                    'name':          r['player_name'],
                    'batting_order': idx + 1,
                    'position':      'DH',
                }
                for idx, r in enumerate(rows[:9])
            ]
        return []

    home_lineup_t2 = get_yesterday_lineup(home_team)
    away_lineup_t2 = get_yesterday_lineup(away_team)

    if home_lineup_t2 and away_lineup_t2:
        log.info(f'  Lineup source: Tier 2 (yesterday logs) — {len(home_lineup_t2)} home / {len(away_lineup_t2)} away')
        return home_lineup_t2, away_lineup_t2, False, home_sp, away_sp

    log.info(f'  Tier 2 insufficient. Trying Tier 3 (active roster).')

    # ── Tier 3: Active roster API ─────────────────────────────────────
    def get_roster_lineup(team_id: int) -> list[dict]:
        try:
            resp = requests.get(
                f'https://statsapi.mlb.com/api/v1/teams/{team_id}/roster',
                params={'rosterType': 'active'},
                timeout=15,
            )
            data = resp.json()
            batters = [
                p for p in data.get('roster', [])
                if p.get('position', {}).get('type', '') != 'Pitcher'
            ]
            return [
                {
                    'id':            p['person']['id'],
                    'name':          p['person'].get('fullName', ''),
                    'batting_order': idx + 1,
                    'position':      p.get('position', {}).get('abbreviation', 'DH'),
                }
                for idx, p in enumerate(batters[:9])
            ]
        except Exception as exc:
            log.warning(f'  Roster API failed for team {team_id}: {exc}')
            return []

    home_lineup_t3 = get_roster_lineup(home_team_id) if home_team_id else []
    away_lineup_t3 = get_roster_lineup(away_team_id) if away_team_id else []

    log.info(f'  Lineup source: Tier 3 (active roster) — {len(home_lineup_t3)} home / {len(away_lineup_t3)} away')
    return home_lineup_t3, away_lineup_t3, False, home_sp, away_sp


def get_platoon_splits(conn, player_id: int) -> dict:
    """Fetch platoon splits for a batter from player_splits table."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT vs_lhp_avg, vs_lhp_obp, vs_lhp_slg,
                      vs_rhp_avg, vs_rhp_obp, vs_rhp_slg
               FROM player_splits
               WHERE player_id = %s AND sport = 'MLB' AND season = %s""",
            (player_id, CURRENT_SEASON),
        )
        row = cur.fetchone()
        return dict(row) if row else {}


def platoon_split_factor(splits: dict, sp_throws: str, season_avg: float) -> float:
    """
    Returns a multiplier based on batter vs pitcher handedness.
    sp_throws: 'L' or 'R'
    season_avg: batter's overall batting average
    """
    if not splits or not sp_throws or season_avg <= 0:
        return 1.0
    if sp_throws == 'L':
        split_avg = splits.get('vs_lhp_avg')
    else:
        split_avg = splits.get('vs_rhp_avg')
    if not split_avg or float(split_avg) <= 0:
        return 1.0
    ratio = float(split_avg) / season_avg
    return max(0.75, min(1.30, ratio))


def get_team_k_rate(conn, team_name: str) -> float:
    """
    Get a team's batter strikeout rate from recent player_game_logs.
    Uses turnovers=strikeouts (batter K) and fg_att=atBats columns.
    Returns K rate as a fraction (e.g. 0.233 = 23.3% K rate).
    """
    with conn.cursor() as cur:
        cur.execute(
            """SELECT
                 SUM(turnovers) AS total_k,
                 SUM(fg_att)    AS total_ab
               FROM player_game_logs
               WHERE team ILIKE %s
                 AND sport = 'MLB'
                 AND season = %s
                 AND fg_att > 0
                 AND game_date >= CURRENT_DATE - INTERVAL '30 days'""",
            (f'%{team_name[:3]}%', CURRENT_SEASON),
        )
        row = cur.fetchone()
        if row and row[0] is not None and row[1] and float(row[1]) > 0:
            k_rate = float(row[0]) / float(row[1])
            return max(0.150, min(0.320, k_rate))
    return 0.233  # league average


def get_team_obp(logs: list[dict]) -> float:
    """
    Approximate team OBP from team game logs.
    We don't have direct OBP in team_game_logs, so we proxy it from
    recent offensive output: more runs/game ~ higher OBP.
    """
    if not logs:
        return LEAGUE_AVG['obp']
    avg_runs = weighted_avg(logs, 'points_scored')
    # Rough calibration: 4.6 R/G ~ .312 OBP, linear scale ±0.01 per 0.3 runs
    obp = LEAGUE_AVG['obp'] + (avg_runs - LEAGUE_AVG['team_runs_per_game']) * (0.01 / 0.3)
    return max(0.270, min(0.370, obp))


def confidence_score_batter(logs: list[dict], rest_days: int, lineup_confirmed: bool = False, sp_logs: list[dict] = None) -> int:
    """Compute confidence score (45–95) for a batter projection. v2.0."""
    confidence = 60
    if len(logs) >= 50: confidence += 5
    elif len(logs) >= 30: confidence += 3
    if len(logs) < 15: confidence -= 6   # small sample
    if rest_days == 0:  confidence -= 5
    if rest_days >= 5:  confidence -= 3
    if lineup_confirmed:  confidence += 4
    else:                 confidence -= 8  # using roster fallback
    if sp_logs and len(sp_logs) >= 5: confidence += 3
    l10_hits = rolling_avg(logs, 'fg_made', min(10, len(logs)))
    l30_hits = rolling_avg(logs, 'fg_made', min(30, len(logs)))
    if l30_hits > 0:
        if l10_hits > l30_hits * 1.15: confidence += 5   # hot streak
        elif l10_hits < l30_hits * 0.80: confidence -= 8  # cold
    return max(45, min(95, confidence))


def confidence_score_pitcher(sp_logs: list[dict], days_rest: int = 5) -> int:
    """Compute confidence score for a pitcher projection. v2.0."""
    confidence = 60
    if len(sp_logs) >= 20: confidence += 5
    elif len(sp_logs) >= 10: confidence += 3
    if len(sp_logs) < 5: confidence -= 8   # small sample
    if days_rest <= 3: confidence -= 5      # short rest
    if len(sp_logs) >= 5:
        l5_er  = rolling_avg(sp_logs, 'points', 5)
        szn_er = rolling_avg(sp_logs, 'points', len(sp_logs))
        if szn_er > 0:
            if l5_er < szn_er * 0.85: confidence += 6
            elif l5_er > szn_er * 1.20: confidence -= 8
    return max(45, min(92, confidence))


# ── Main ─────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk MLB Projection Model')
    parser.add_argument('--date', default=str(date.today()), help='Game date YYYY-MM-DD')
    args   = parser.parse_args()
    game_date = date.fromisoformat(args.date)

    log.info('═══════════════════════════════════════════════════')
    log.info(f'Chalk MLB Projection Model — {game_date}')
    log.info(f'Model version: {MODEL_VERSION}')
    log.info('═══════════════════════════════════════════════════')

    conn = get_db()

    # ── Step 1: Fetch today's MLB schedule ────────────────────────────────────
    log.info('\n▶ STEP 1: Fetching MLB schedule')
    games = get_todays_games(conn, game_date)

    if not games:
        log.info('  No games found for today. Exiting.')
        conn.close()
        return

    # ── Step 2: Fetch weather for each unique venue ───────────────────────────
    log.info('\n▶ STEP 2: Fetching weather per venue')
    weather_cache: dict[str, dict] = {}   # keyed by venue_name now
    for game in games:
        venue_name = game.get('venue_name', '')
        if venue_name in weather_cache:
            continue
        coords = get_venue_coords(venue_name)
        if coords:
            lat, lon = coords
            log.info(f'  Fetching weather for {venue_name}')
            w = fetch_weather(lat, lon)
            if w:
                log.info(f'    Temp={w.get("temp_f")}°F, Wind={w.get("wind_mph")}mph, Dir={wind_direction_label(w.get("wind_dir_deg", 0))}')
            else:
                log.warning(f'    Weather unavailable for {venue_name} — model will run without it')
            weather_cache[venue_name] = w
        else:
            log.warning(f'  No coordinates found for venue "{venue_name}". Weather skipped.')
            weather_cache[venue_name] = {}

    # ── Step 3–7: Process each game ───────────────────────────────────────────
    total_batter_projections  = 0
    total_pitcher_projections = 0
    total_team_projections    = 0

    for game in games:
        game_pk    = game['game_pk']
        home_team  = game['home_team']
        away_team  = game['away_team']
        venue_name = game['venue_name']
        weather    = weather_cache.get(venue_name, {})
        park       = get_park_factors(venue_name)

        log.info(f'\n--- Game {game_pk}: {away_team} @ {home_team} ({venue_name}) ---')
        if not weather:
            log.info('  [Weather unavailable — park factors only]')

        # ── Step 3: Get lineups and SPs (with 3-tier fallback) ───────────────
        home_lineup, away_lineup, lineup_confirmed, home_sp_info, away_sp_info = (
            get_batting_lineup_with_fallback(
                conn, game_pk,
                home_team, away_team,
                game.get('home_team_id', 0), game.get('away_team_id', 0),
                game_date,
            )
        )

        if not lineup_confirmed:
            log.info('  [lineup_confirmed=False — confidence -8 applied to all batters]')

        if not home_lineup and not away_lineup:
            log.warning(f'  All lineup tiers failed for game {game_pk}. Skipping batter projections.')

        # Fetch SP logs and pitcher handedness
        home_sp_logs: list[dict] = []
        away_sp_logs: list[dict] = []
        home_sp_throws = 'R'
        away_sp_throws = 'R'
        if home_sp_info:
            home_sp_logs   = get_sp_logs(conn, home_sp_info['id'])
            home_sp_throws = get_pitcher_hand(home_sp_info['id'])
            home_sp_info['throws'] = home_sp_throws
            log.info(f'  Home SP: {home_sp_info["name"]} ({home_sp_throws}HB) — {len(home_sp_logs)} starts in DB')
        if away_sp_info:
            away_sp_logs   = get_sp_logs(conn, away_sp_info['id'])
            away_sp_throws = get_pitcher_hand(away_sp_info['id'])
            away_sp_info['throws'] = away_sp_throws
            log.info(f'  Away SP: {away_sp_info["name"]} ({away_sp_throws}HB) — {len(away_sp_logs)} starts in DB')

        # ── Fetch team logs for run environment ───────────────────────────────
        home_team_logs = get_team_logs(conn, home_team)
        away_team_logs = get_team_logs(conn, away_team)
        home_obp = get_team_obp(home_team_logs)
        away_obp = get_team_obp(away_team_logs)

        # K rates for opponent K% factor in strikeout projections
        home_k_rate = get_team_k_rate(conn, home_team)
        away_k_rate = get_team_k_rate(conn, away_team)

        # Estimate bullpen ERA from team logs (avg runs allowed minus SP ER share)
        home_runs_allowed_avg = weighted_avg(home_team_logs, 'points_allowed') if home_team_logs else LEAGUE_AVG['team_runs_per_game']
        away_runs_allowed_avg = weighted_avg(away_team_logs, 'points_allowed') if away_team_logs else LEAGUE_AVG['team_runs_per_game']
        # Rough: bullpen ERA ~ (team ERA × 9 - SP ER/IP × 9) as proxy
        home_sp_er_share = rolling_avg(home_sp_logs, 'points', min(5, len(home_sp_logs))) if home_sp_logs else LEAGUE_AVG['era'] * 5.5 / 9
        away_sp_er_share = rolling_avg(away_sp_logs, 'points', min(5, len(away_sp_logs))) if away_sp_logs else LEAGUE_AVG['era'] * 5.5 / 9
        home_bullpen_era = max(2.0, (home_runs_allowed_avg - home_sp_er_share) * 9 / 3.5)
        away_bullpen_era = max(2.0, (away_runs_allowed_avg - away_sp_er_share) * 9 / 3.5)

        # ── Step 4: Batter projections ────────────────────────────────────────
        log.info(f'  Processing batters...')

        for side, lineup, opp_sp_logs, team_obp, loc, opp_sp_throws in [
            ('home', home_lineup, away_sp_logs, away_obp, 'home', away_sp_throws),
            ('away', away_lineup, home_sp_logs, home_obp, 'away', home_sp_throws),
        ]:
            team_name = home_team if side == 'home' else away_team
            opponent  = away_team if side == 'home' else home_team

            for batter in lineup:
                pid       = batter['id']
                name      = batter['name']
                lp        = batter['batting_order']
                rest_days = get_rest_days(conn, pid, game_date)
                bat_logs  = get_batter_logs(conn, pid)

                if len(bat_logs) < 3:
                    log.debug(f'    {name}: insufficient history ({len(bat_logs)} games), skipping')
                    continue

                # Platoon splits (fetched individually for each batter)
                batter_splits = get_platoon_splits(conn, pid)

                # Run all batter projection functions — platoon now handled inside each function
                proj_hits_val,  fac_hits  = project_hits(bat_logs, opp_sp_logs, weather, park, loc, lp, lineup_confirmed, batter_splits, opp_sp_throws)
                proj_tb_val,    fac_tb    = project_total_bases(bat_logs, opp_sp_logs, weather, park, loc, lp, lineup_confirmed, batter_splits, opp_sp_throws)
                proj_hr_val,    fac_hr    = project_home_runs(bat_logs, opp_sp_logs, weather, park, loc, lp, batter_splits, opp_sp_throws)
                proj_rbi_val,   fac_rbi   = project_rbi(bat_logs, opp_sp_logs, weather, park, loc, lp, team_obp, lineup_confirmed)
                proj_runs_val,  fac_runs  = project_runs(bat_logs, opp_sp_logs, weather, park, loc, lp, lineup_confirmed)
                proj_sb_val,    fac_sb    = project_stolen_bases(bat_logs, opp_sp_logs, weather, park, loc, opp_sp_throws)

                conf = confidence_score_batter(bat_logs, rest_days, lineup_confirmed, opp_sp_logs)

                all_factors = {
                    'hits':  fac_hits,
                    'tb':    fac_tb,
                    'hr':    fac_hr,
                    'rbi':   fac_rbi,
                    'runs':  fac_runs,
                    'sb':    fac_sb,
                    'context': {
                        'rest_days':        rest_days,
                        'lineup_pos':       lp,
                        'games_used':       len(bat_logs),
                        'team_obp':         round(team_obp, 3),
                        'park_name':        venue_name,
                        'lineup_confirmed': lineup_confirmed,
                        'opp_sp_throws':    opp_sp_throws,
                        'weather_available': bool(weather),
                    },
                }

                proj_data = {
                    'home_away':        loc,
                    'proj_hits':        proj_hits_val,
                    'proj_tb':          proj_tb_val,
                    'proj_hr':          proj_hr_val,
                    'proj_rbi':         proj_rbi_val,
                    'proj_runs':        proj_runs_val,
                    'proj_sb':          proj_sb_val,
                    'proj_er':          0,
                    'proj_walks':       0,
                    'proj_outs':        0,
                    'confidence_score': conf,
                    'lineup_confirmed': lineup_confirmed,
                    'factors_json':     all_factors,
                }

                try:
                    rows = upsert_player_projection(conn, pid, name, team_name, opponent, game_date, proj_data)
                    total_batter_projections += rows
                    log.info(
                        f'    [{loc}] {name} (#{lp}) — '
                        f'H:{proj_hits_val:.2f} TB:{proj_tb_val:.2f} HR:{proj_hr_val:.3f} '
                        f'RBI:{proj_rbi_val:.2f} R:{proj_runs_val:.2f} SB:{proj_sb_val:.3f} '
                        f'Conf:{conf}'
                    )
                except Exception as exc:
                    log.warning(f'    Could not store batter projection for {name}: {exc}')
                    conn.rollback()

        # ── Step 5: Starting pitcher projections ──────────────────────────────
        log.info(f'  Processing starting pitchers...')

        for sp_info, sp_logs, opp_team_logs, loc, team_name, opponent, bullpen_era, opp_k_rate in [
            (home_sp_info, home_sp_logs, away_team_logs, 'home', home_team, away_team, home_bullpen_era, away_k_rate),
            (away_sp_info, away_sp_logs, home_team_logs, 'away', away_team, home_team, away_bullpen_era, home_k_rate),
        ]:
            if not sp_info:
                continue
            pid      = sp_info['id']
            name     = sp_info['name']
            sp_hand  = sp_info.get('throws', 'R')

            # Compute days rest for this SP
            sp_days_rest = compute_days_rest(sp_logs, game_date)

            proj_k_val,    fac_k    = project_strikeouts(sp_logs, opp_team_logs, weather, loc, opp_k_rate, sp_days_rest, sp_hand)
            proj_er_val,   fac_er   = project_earned_runs(sp_logs, opp_team_logs, weather, park, loc, sp_days_rest)
            proj_bb_val,   fac_bb   = project_walks(sp_logs, opp_team_logs, weather, loc, sp_days_rest)
            proj_outs_val, fac_outs = project_outs_recorded(sp_logs, weather, bullpen_era, sp_days_rest, game_date)

            conf = confidence_score_pitcher(sp_logs, sp_days_rest)

            all_factors = {
                'strikeouts':    fac_k,
                'earned_runs':   fac_er,
                'walks':         fac_bb,
                'outs_recorded': fac_outs,
                'context': {
                    'park_name':        venue_name,
                    'home_away':        loc,
                    'bullpen_era':      round(bullpen_era, 3),
                    'sp_starts_in_db':  len(sp_logs),
                    'sp_hand':          sp_hand,
                    'days_rest':        sp_days_rest,
                    'weather_available': bool(weather),
                },
            }

            proj_data = {
                'home_away':        loc,
                'proj_hits':        0,   # not projected for pitchers
                'proj_tb':          0,
                'proj_hr':          0,
                'proj_rbi':         0,
                'proj_runs':        0,
                'proj_sb':          0,
                'proj_er':          proj_er_val,
                'proj_walks':       proj_bb_val,
                'proj_outs':        proj_outs_val,
                # Store K projection in proj_hits slot for pitchers (displayed as Ks)
                'proj_k':           proj_k_val,
                'confidence_score': conf,
                'factors_json':     all_factors,
            }
            # For pitchers, override proj_hits with proj_k for DB storage clarity
            proj_data['proj_hits'] = proj_k_val

            try:
                rows = upsert_player_projection(conn, pid, name, team_name, opponent, game_date, proj_data)
                total_pitcher_projections += rows
                log.info(
                    f'    [{loc} SP] {name} — '
                    f'K:{proj_k_val:.2f} ER:{proj_er_val:.2f} BB:{proj_bb_val:.2f} '
                    f'Outs:{proj_outs_val:.1f} Conf:{conf}'
                )
            except Exception as exc:
                log.warning(f'    Could not store pitcher projection for {name}: {exc}')
                conn.rollback()

        # ── Step 6: Team projections ──────────────────────────────────────────
        log.info(f'  Processing team projections...')

        ml_val, ml_factors = project_moneyline(
            home_team_logs, away_team_logs,
            home_sp_logs, away_sp_logs,
            weather, park,
        )
        run_diff, rl_factors, rl_cover_prob, cover_factors = project_run_line(
            home_team_logs, away_team_logs,
            home_sp_logs, away_sp_logs,
            weather, park,
        )
        total_val, total_factors = project_total(
            home_team_logs, away_team_logs,
            home_sp_logs, away_sp_logs,
            weather, park,
        )

        # Win probability from ML factors
        win_prob = ml_factors.get('win_probability', 0.5)

        # Over/under probabilities
        # We need a posted total to compare against; default to league avg
        posted_total = LEAGUE_AVG['team_runs_per_game'] * 2  # ~9.2 runs placeholder
        over_prob  = round(_normal_cdf((total_val - posted_total) / TOTAL_STD_DEV), 4)
        under_prob = round(1 - over_prob, 4)

        # Extract projected runs from run_line factors
        proj_home_runs = rl_factors.get('proj_home_runs', total_val / 2)
        proj_away_runs = rl_factors.get('proj_away_runs', total_val / 2)

        home_conf = 60
        if len(home_team_logs) >= 15: home_conf += 5
        home_conf = max(50, min(90, home_conf))

        all_team_factors = {
            'moneyline':  ml_factors,
            'run_line':   {**rl_factors, **cover_factors},
            'total':      total_factors,
            'context': {
                'venue_name':   venue_name,
                'park_hr_f':    park.get('hr', 1.0),
                'park_runs_f':  park.get('runs', 1.0),
                'park_hits_f':  park.get('hits', 1.0),
                'weather_temp': weather.get('temp_f', None),
                'weather_wind': weather.get('wind_mph', None),
                'weather_dir':  wind_direction_label(weather.get('wind_dir_deg', 0)) if weather else None,
            },
        }

        # Upsert home team projection
        home_proj = {
            'team_id':                  game.get('home_team_id', 0),
            'team_name':                home_team,
            'game_date':                game_date,
            'opponent':                 away_team,
            'home_away':                'home',
            'proj_points':              round(proj_home_runs, 3),
            'proj_points_allowed':      round(proj_away_runs, 3),
            'proj_total':               round(total_val, 3),
            'moneyline_projection':     round(ml_val, 2),
            'win_probability':          round(win_prob, 4),
            'spread_projection':        round(run_diff, 3),
            'spread_cover_probability': round(rl_cover_prob, 4),
            'over_probability':         over_prob,
            'under_probability':        under_prob,
            'confidence_score':         home_conf,
            'model_version':            MODEL_VERSION,
            'factors_json':             json.dumps(all_team_factors),
        }

        # Away team is inverse of home — flip probabilities
        away_win_prob = 1 - win_prob
        if away_win_prob >= 0.5:
            away_ml = -(away_win_prob / (1 - away_win_prob)) * 100
        else:
            away_ml = ((1 - away_win_prob) / away_win_prob) * 100

        away_conf = 60
        if len(away_team_logs) >= 15: away_conf += 5
        away_conf = max(50, min(90, away_conf))

        away_proj = {
            'team_id':                  game.get('away_team_id', 0),
            'team_name':                away_team,
            'game_date':                game_date,
            'opponent':                 home_team,
            'home_away':                'away',
            'proj_points':              round(proj_away_runs, 3),
            'proj_points_allowed':      round(proj_home_runs, 3),
            'proj_total':               round(total_val, 3),
            'moneyline_projection':     round(away_ml, 2),
            'win_probability':          round(away_win_prob, 4),
            'spread_projection':        round(-run_diff, 3),
            'spread_cover_probability': round(1 - rl_cover_prob, 4),
            'over_probability':         over_prob,
            'under_probability':        under_prob,
            'confidence_score':         away_conf,
            'model_version':            MODEL_VERSION,
            'factors_json':             json.dumps(all_team_factors),
        }

        for proj, tname in [(home_proj, home_team), (away_proj, away_team)]:
            try:
                upsert_team_projection(conn, tname, proj.get('opponent', ''), game_date, proj)
                total_team_projections += 1
                log.info(
                    f'    [{proj["home_away"]}] {tname} — '
                    f'Proj runs: {proj["proj_points"]:.2f} | '
                    f'Total: {proj["proj_total"]:.2f} | '
                    f'ML: {proj["moneyline_projection"]:.0f} | '
                    f'Win%: {proj["win_probability"]:.3f}'
                )
            except Exception as exc:
                log.warning(f'    Could not store team projection for {tname}: {exc}')
                conn.rollback()

    # ── Summary ───────────────────────────────────────────────────────────────
    conn.close()
    log.info('\n═══════════════════════════════════════════════════')
    log.info('MLB Projection Model complete')
    log.info(f'  Batter projections:  {total_batter_projections}')
    log.info(f'  Pitcher projections: {total_pitcher_projections}')
    log.info(f'  Team projections:    {total_team_projections}')
    log.info('  Next: run edgeDetector.js to compare vs. market lines')
    log.info('═══════════════════════════════════════════════════')


if __name__ == '__main__':
    main()
