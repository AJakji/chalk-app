"""
Chalk MLB Team Data Collector
==============================
Collects team-level game results for all 30 MLB teams for the last 3 seasons
using the free MLB Stats API (no key required).

API endpoint used:
  GET https://statsapi.mlb.com/api/v1/schedule
    ?sportId=1&teamId={teamId}&season={year}&gameType=R&hydrate=linescore

Stores into team_game_logs table (shared with NBA/NHL teams).

Usage:
  python3 mlbTeamCollector.py            # current season only
  python3 mlbTeamCollector.py --full     # all 3 seasons (2023, 2024, 2025)
  python3 mlbTeamCollector.py --season 2024
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

# ── Bootstrap ──────────────────────────────────────────────────────────────────

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

DATABASE_URL = os.getenv('DATABASE_URL', '')
BASE_URL     = 'https://statsapi.mlb.com/api/v1'
SEASONS      = [2023, 2024, 2025]
DELAY        = 0.3   # seconds between API calls

# All 30 MLB team IDs
MLB_TEAMS = {
    133: 'Oakland Athletics',
    134: 'Pittsburgh Pirates',
    135: 'San Diego Padres',
    136: 'Seattle Mariners',
    137: 'San Francisco Giants',
    138: 'St. Louis Cardinals',
    139: 'Tampa Bay Rays',
    140: 'Texas Rangers',
    141: 'Toronto Blue Jays',
    142: 'Minnesota Twins',
    143: 'Philadelphia Phillies',
    144: 'Atlanta Braves',
    145: 'Chicago White Sox',
    146: 'Miami Marlins',
    147: 'New York Yankees',
    158: 'Milwaukee Brewers',
    108: 'Los Angeles Angels',
    109: 'Arizona Diamondbacks',
    110: 'Baltimore Orioles',
    111: 'Boston Red Sox',
    112: 'Chicago Cubs',
    113: 'Cincinnati Reds',
    114: 'Cleveland Guardians',
    115: 'Colorado Rockies',
    116: 'Detroit Tigers',
    117: 'Houston Astros',
    118: 'Kansas City Royals',
    119: 'Los Angeles Dodgers',
    120: 'Washington Nationals',
    121: 'New York Mets',
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_db():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL env var not set')
    return psycopg2.connect(DATABASE_URL)


def get_json(url: str, params: dict = None) -> Optional[dict]:
    """GET a URL and return parsed JSON, or None on any error."""
    try:
        resp = requests.get(url, params=params, timeout=20)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        log.warning(f'  HTTP error: {exc}')
        return None


# ── API fetch ─────────────────────────────────────────────────────────────────

def fetch_team_schedule(team_id: int, year: int) -> list[dict]:
    """
    Fetch all regular season completed games for one team in one season.
    Returns list of game dicts ready for DB insertion.
    """
    params = {
        'sportId':  1,
        'teamId':   team_id,
        'season':   year,
        'gameType': 'R',
        'hydrate':  'linescore',
    }
    data = get_json(f'{BASE_URL}/schedule', params)
    if not data:
        return []

    team_name = MLB_TEAMS.get(team_id, f'Team {team_id}')
    rows = []

    for date_entry in data.get('dates', []):
        game_date_str = date_entry.get('date', '')
        for game in date_entry.get('games', []):
            # Only process completed games
            status_code = game.get('status', {}).get('abstractGameState', '')
            if status_code != 'Final':
                continue

            game_pk = game.get('gamePk')
            if not game_pk:
                continue

            teams_data = game.get('teams', {})
            home_team_data = teams_data.get('home', {})
            away_team_data = teams_data.get('away', {})

            home_team_id   = home_team_data.get('team', {}).get('id', 0)
            home_team_name = home_team_data.get('team', {}).get('name', '')
            away_team_name = away_team_data.get('team', {}).get('name', '')

            home_score = home_team_data.get('score')
            away_score = away_team_data.get('score')

            # Skip games where scores are missing
            if home_score is None or away_score is None:
                continue

            # Determine if this team is home or away
            is_home = (home_team_id == team_id)
            home_away = 'home' if is_home else 'away'

            if is_home:
                points_scored  = int(home_score)
                points_allowed = int(away_score)
                opponent_name  = away_team_name
            else:
                points_scored  = int(away_score)
                points_allowed = int(home_score)
                opponent_name  = home_team_name

            # Determine result
            if points_scored > points_allowed:
                result = 'W'
            elif points_scored < points_allowed:
                result = 'L'
            else:
                result = 'T'  # rare tie (shouldn't happen in MLB but handle it)

            rows.append({
                'team_id':       team_id,
                'team_name':     team_name,
                'sport':         'MLB',
                'season':        str(year),
                'game_date':     game_date_str,
                'game_id':       str(game_pk),
                'opponent':      opponent_name,
                'home_away':     home_away,
                'result':        result,
                'points_scored':  points_scored,
                'points_allowed': points_allowed,
            })

    return rows


# ── DB write ──────────────────────────────────────────────────────────────────

def upsert_team_game_logs(conn, rows: list[dict]) -> int:
    """
    Insert or update team game log rows.
    The team_game_logs unique constraint is on (team_id, game_date, sport).
    For MLB we use game_id (gamePk) as a surrogate — we do an UPDATE if the row
    already exists (matched by game_id + team_name), otherwise INSERT.
    Returns count of rows processed.
    """
    if not rows:
        return 0

    inserted = 0
    with conn.cursor() as cur:
        for row in rows:
            # Use a manual upsert: check existence by team_name + game_date + sport
            # since we don't have a team_id for all MLB teams mapped
            cur.execute(
                """INSERT INTO team_game_logs (
                     team_id, team_name, sport, season, game_date, game_id, opponent, home_away,
                     result, points_scored, points_allowed
                   ) VALUES (
                     %(team_id)s, %(team_name)s, %(sport)s, %(season)s, %(game_date)s, %(game_id)s,
                     %(opponent)s, %(home_away)s, %(result)s,
                     %(points_scored)s, %(points_allowed)s
                   )
                   ON CONFLICT (team_id, game_date, sport) DO UPDATE SET
                     points_scored  = EXCLUDED.points_scored,
                     points_allowed = EXCLUDED.points_allowed,
                     result         = EXCLUDED.result,
                     opponent       = EXCLUDED.opponent""",
                row,
            )
            inserted += 1
    conn.commit()
    return inserted


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk MLB Team Data Collector')
    parser.add_argument('--full',   action='store_true', help='Collect all seasons (2023-2025)')
    parser.add_argument('--season', type=int, default=None, help='Single season year e.g. 2024')
    args = parser.parse_args()

    if args.full:
        seasons = SEASONS
    elif args.season:
        seasons = [args.season]
    else:
        seasons = [2025]

    log.info('═══════════════════════════════════════════════════')
    log.info(f'Chalk MLB Team Collector — seasons: {seasons}')
    log.info(f'Teams: {len(MLB_TEAMS)} | Delay: {DELAY}s/call')
    log.info('═══════════════════════════════════════════════════')

    conn = get_db()
    total_rows = 0

    for year in seasons:
        log.info(f'\n▶ Season {year}')
        season_rows = 0

        for team_id, team_name in MLB_TEAMS.items():
            log.info(f'  Fetching {team_name} ({team_id}) — season {year}...')
            try:
                rows = fetch_team_schedule(team_id, year)
                if rows:
                    n = upsert_team_game_logs(conn, rows)
                    season_rows += n
                    log.info(f'    {n} games stored for {team_name}')
                else:
                    log.info(f'    No completed games found for {team_name} in {year}')
            except Exception as exc:
                log.warning(f'    Error for {team_name} season {year}: {exc}')
                conn.rollback()

            time.sleep(DELAY)

        log.info(f'  Season {year} total: {season_rows} rows upserted')
        total_rows += season_rows

    conn.close()
    log.info('\n═══════════════════════════════════════════════════')
    log.info(f'MLB Team Collector complete — {total_rows} total rows')
    log.info('═══════════════════════════════════════════════════')


if __name__ == '__main__':
    main()
