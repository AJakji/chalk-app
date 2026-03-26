"""
Chalk NHL Team Data Collector
==============================
Collects team-level game results for all 32 NHL teams for the current and
previous season using the free NHL public API (no key required).

API endpoint:
  GET https://api-web.nhle.com/v1/club-schedule-season/{teamAbbr}/{season}
  season format: '20242025' for 2024-25 season

Stores into team_game_logs table (sport='NHL').

Usage:
  python3 nhlTeamCollector.py             # current season only
  python3 nhlTeamCollector.py --full      # both seasons (2024-25 + 2025-26)
  python3 nhlTeamCollector.py --season 20242025
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
NHL_API_BASE = 'https://api-web.nhle.com/v1'
DELAY        = 0.25   # seconds between API calls to be polite

# All 32 NHL teams: internal_id → (abbreviation, full_name)
# Internal IDs 101-132 avoid collision with NBA (1-30) and MLB (108-158)
NHL_TEAMS = {
    101: ('ANA', 'Anaheim Ducks'),
    102: ('BOS', 'Boston Bruins'),
    103: ('BUF', 'Buffalo Sabres'),
    104: ('CGY', 'Calgary Flames'),
    105: ('CAR', 'Carolina Hurricanes'),
    106: ('CHI', 'Chicago Blackhawks'),
    107: ('COL', 'Colorado Avalanche'),
    108: ('CBJ', 'Columbus Blue Jackets'),
    109: ('DAL', 'Dallas Stars'),
    110: ('DET', 'Detroit Red Wings'),
    111: ('EDM', 'Edmonton Oilers'),
    112: ('FLA', 'Florida Panthers'),
    113: ('LAK', 'Los Angeles Kings'),
    114: ('MIN', 'Minnesota Wild'),
    115: ('MTL', 'Montreal Canadiens'),
    116: ('NSH', 'Nashville Predators'),
    117: ('NJD', 'New Jersey Devils'),
    118: ('NYI', 'New York Islanders'),
    119: ('NYR', 'New York Rangers'),
    120: ('OTT', 'Ottawa Senators'),
    121: ('PHI', 'Philadelphia Flyers'),
    122: ('PIT', 'Pittsburgh Penguins'),
    123: ('SEA', 'Seattle Kraken'),
    124: ('SJS', 'San Jose Sharks'),
    125: ('STL', 'St. Louis Blues'),
    126: ('TBL', 'Tampa Bay Lightning'),
    127: ('TOR', 'Toronto Maple Leafs'),
    128: ('UTA', 'Utah Hockey Club'),
    129: ('VAN', 'Vancouver Canucks'),
    130: ('VGK', 'Vegas Golden Knights'),
    131: ('WSH', 'Washington Capitals'),
    132: ('WPG', 'Winnipeg Jets'),
}

# Map abbreviation → (team_id, full_name) for quick lookups
ABBR_TO_ID   = {abbr: tid for tid, (abbr, _) in NHL_TEAMS.items()}
ABBR_TO_NAME = {abbr: name for _, (abbr, name) in NHL_TEAMS.items()}


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_db():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL env var not set')
    return psycopg2.connect(DATABASE_URL)


def get_json(url: str) -> Optional[dict]:
    try:
        resp = requests.get(url, timeout=20)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        log.warning(f'  GET {url} failed: {exc}')
        return None


def populate_shot_data(conn) -> int:
    """
    Aggregate shots for/against from player_game_logs into team_game_logs.
    Uses repurposed columns (shared table with NBA):
      steals → NHL shots for  (shots the team generates)
      blocks → NHL shots against (shots the team allows)
    Returns count of rows updated.
    """
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE team_game_logs tgl
               SET steals = (
                   SELECT SUM(pgl.fg_made)
                   FROM player_game_logs pgl
                   WHERE pgl.team = tgl.team_name
                     AND pgl.game_date = tgl.game_date
                     AND pgl.sport = 'NHL'
                     AND pgl.position != 'G'
                     AND pgl.fg_made IS NOT NULL
               ),
               blocks = (
                   SELECT SUM(pgl.fg_made)
                   FROM player_game_logs pgl
                   WHERE pgl.team = tgl.opponent
                     AND pgl.game_date = tgl.game_date
                     AND pgl.sport = 'NHL'
                     AND pgl.position != 'G'
                     AND pgl.fg_made IS NOT NULL
               )
               WHERE tgl.sport = 'NHL'"""
        )
        updated = cur.rowcount
    conn.commit()
    return updated


def upsert_team_game(conn, row: dict) -> bool:
    """Insert or update one team game log row. Returns True if upserted."""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO team_game_logs
                 (team_id, team_name, sport, season, game_date, game_id,
                  opponent, home_away, result, points_scored, points_allowed)
               VALUES (%(team_id)s, %(team_name)s, 'NHL', %(season)s, %(game_date)s,
                       %(game_id)s, %(opponent)s, %(home_away)s, %(result)s,
                       %(points_scored)s, %(points_allowed)s)
               ON CONFLICT (team_id, game_date, sport) DO UPDATE SET
                 points_scored  = EXCLUDED.points_scored,
                 points_allowed = EXCLUDED.points_allowed,
                 result         = EXCLUDED.result,
                 opponent       = EXCLUDED.opponent,
                 home_away      = EXCLUDED.home_away,
                 game_id        = EXCLUDED.game_id,
                 season         = EXCLUDED.season""",
            row,
        )
    return True


# ── Core collection ─────────────────────────────────────────────────────────────

def collect_team_season(conn, team_id: int, abbr: str, full_name: str, season: str) -> int:
    """
    Collect all completed regular-season games for one team in one season.
    Returns the count of rows upserted.
    """
    url = f'{NHL_API_BASE}/club-schedule-season/{abbr}/{season}'
    data = get_json(url)
    if not data or 'games' not in data:
        log.warning(f'  No data for {abbr} season {season}')
        return 0

    games = data['games']
    upserted = 0

    for g in games:
        # Only regular season (gameType=2) and finished games
        if g.get('gameType') != 2:
            continue
        state = g.get('gameState', '')
        if state not in ('OFF', 'FINAL'):
            continue

        game_date_str = g.get('gameDate', '')
        if not game_date_str:
            continue
        try:
            game_date = datetime.strptime(game_date_str[:10], '%Y-%m-%d').date()
        except ValueError:
            continue

        game_id = str(g.get('id', ''))

        away_team = g.get('awayTeam', {})
        home_team = g.get('homeTeam', {})
        away_abbr = away_team.get('abbrev', '')
        home_abbr = home_team.get('abbrev', '')

        # Scores — may be absent if game is ongoing (already filtered above)
        away_score = away_team.get('score')
        home_score = home_team.get('score')
        if away_score is None or home_score is None:
            continue

        away_score = int(away_score)
        home_score = int(home_score)

        if abbr == home_abbr:
            home_away     = 'home'
            points_scored = home_score
            points_allowed = away_score
            opponent_abbr  = away_abbr
            result         = 'W' if home_score > away_score else 'L'
        else:
            home_away      = 'away'
            points_scored  = away_score
            points_allowed = home_score
            opponent_abbr  = home_abbr
            result         = 'W' if away_score > home_score else 'L'

        row = {
            'team_id':       team_id,
            'team_name':     abbr,        # store abbreviation — consistent with nhlProjectionModel.py
            'season':        season,
            'game_date':     game_date,
            'game_id':       game_id,
            'opponent':      opponent_abbr,
            'home_away':     home_away,
            'result':        result,
            'points_scored': points_scored,
            'points_allowed': points_allowed,
        }

        try:
            upsert_team_game(conn, row)
            conn.commit()
            upserted += 1
        except Exception as exc:
            conn.rollback()
            log.warning(f'  Skip {abbr} {game_date}: {exc}')

    return upserted


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk NHL Team Data Collector')
    parser.add_argument('--full',   action='store_true', help='Collect both 2024-25 and 2025-26 seasons')
    parser.add_argument('--season', default=None,        help='Specific season e.g. 20252026')
    args = parser.parse_args()

    if args.season:
        seasons = [args.season]
    elif args.full:
        seasons = ['20242025', '20252026']
    else:
        seasons = ['20252026']

    log.info('═══════════════════════════════════════════')
    log.info(f'Chalk NHL Team Data Collector — {seasons}')
    log.info(f'Teams: {len(NHL_TEAMS)}  Seasons: {len(seasons)}')
    log.info('═══════════════════════════════════════════')

    conn = get_db()
    total_rows = 0

    for season in seasons:
        log.info(f'\n▶ Season {season}')
        season_rows = 0

        for team_id, (abbr, full_name) in NHL_TEAMS.items():
            rows = collect_team_season(conn, team_id, abbr, full_name, season)
            log.info(f'  {abbr:5s} {season}  → {rows} games')
            season_rows += rows
            time.sleep(DELAY)

        log.info(f'  Season {season} total: {season_rows} rows')
        total_rows += season_rows

    log.info('\n▶ Aggregating shots for/against from player_game_logs…')
    shot_rows = populate_shot_data(conn)
    log.info(f'  Shot data populated for {shot_rows} team game rows')

    conn.close()
    log.info(f'\n✅ Done — {total_rows} total rows upserted across all teams/seasons')


if __name__ == '__main__':
    main()
