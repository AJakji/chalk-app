"""
Chalk MLB Data Collector
========================
Collects player game logs from the MLB Stats API (free, no key required)
and writes them to the player_game_logs table in PostgreSQL.

DATA SOURCE: MLB Stats API — https://statsapi.mlb.com/api/v1
  Hitters:  GET /people/{id}/stats?stats=gameLog&season={year}&sportId=1&group=hitting
  Pitchers: GET /people/{id}/stats?stats=gameLog&season={year}&sportId=1&group=pitching

COLUMN MAPPING (player_game_logs):
  Hitters
  -------
  points         = runs
  fg_made        = hits
  fg_att         = atBats
  fg_pct         = batting average (float)
  three_made     = homeRuns
  steals         = stolenBases

  Pitchers (stored in advanced-stat columns so hitter columns stay NULL)
  --------
  offensive_rating  = ERA
  true_shooting_pct = WHIP
  assists           = strikeOuts

Usage:
  python mlbDataCollector.py                    # incremental: only new games
  python mlbDataCollector.py --full             # all 4 seasons from scratch
  python mlbDataCollector.py --season 2024      # single season only
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import date
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
SEASONS      = [2022, 2023, 2024, 2025, 2026]
DELAY        = 0.3   # seconds between player API calls


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_db():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL env var not set')
    return psycopg2.connect(DATABASE_URL)


def safe_float(val) -> Optional[float]:
    """Convert a value to float, returning None on failure."""
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


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


# ── API fetch functions ────────────────────────────────────────────────────────

def fetch_active_players(year: int) -> list[dict]:
    """
    Returns all active MLB players for a given season year.

    Response shape used:
      { people: [{ id, fullName, currentTeam:{id,name,abbreviation},
                   primaryPosition:{abbreviation} }] }
    """
    url    = f'{BASE_URL}/sports/1/players'
    params = {'season': year, 'gameType': 'R'}
    data   = get_json(url, params)
    if not data:
        log.warning(f'  No player list returned for season {year}')
        return []

    players = []
    for p in data.get('people', []):
        players.append({
            'id':       p['id'],
            'name':     p.get('fullName', ''),
            'team':     p.get('currentTeam', {}).get('abbreviation', ''),
            'position': p.get('primaryPosition', {}).get('abbreviation', ''),
        })
    log.info(f'  Season {year}: {len(players)} active players found')
    return players


def fetch_hitting_logs(player_id: int, year: int) -> list[dict]:
    """
    Fetches game-by-game hitting stats for one player / one season.

    Response shape used:
      { stats: [{ splits: [{ season, date, game:{gamePk},
                              team:{abbreviation}, opponent:{abbreviation},
                              isHome, stat:{...} }] }] }
    """
    url    = f'{BASE_URL}/people/{player_id}/stats'
    params = {
        'stats':   'gameLog',
        'season':  year,
        'sportId': 1,
        'group':   'hitting',
    }
    data = get_json(url, params)
    if not data:
        return []

    rows = []
    for stat_block in data.get('stats', []):
        for split in stat_block.get('splits', []):
            st = split.get('stat', {})

            # Parse batting average — arrives as a string like ".312"
            avg_str = st.get('avg', None)
            avg_val = safe_float(avg_str) if avg_str not in (None, '---', '.---') else None

            rows.append({
                'game_date':  split.get('date'),
                'game_id':    str(split.get('game', {}).get('gamePk', '')),
                'team':       split.get('team', {}).get('abbreviation', ''),
                'opponent':   split.get('opponent', {}).get('abbreviation', ''),
                'home_away':  'home' if split.get('isHome') else 'away',
                'season':     str(split.get('season', year)),
                # Hitter columns
                'points':     safe_float(st.get('runs')),
                'fg_made':    safe_float(st.get('hits')),
                'fg_att':     safe_float(st.get('atBats')),
                'fg_pct':     avg_val,
                'three_made': safe_float(st.get('homeRuns')),
                'steals':     safe_float(st.get('stolenBases')),
                # Extra hitting context stored in available columns
                'rebounds':   safe_float(st.get('rbi')),          # RBI → rebounds col
                'turnovers':  safe_float(st.get('strikeOuts')),   # K → turnovers col
                'fouls':      safe_float(st.get('baseOnBalls')),  # BB → fouls col
                'off_reb':    safe_float(st.get('doubles')),
                'def_reb':    safe_float(st.get('triples')),
                # Pitcher-specific columns left NULL for hitters
                'offensive_rating': None,
                'true_shooting_pct': None,
                'assists':    None,
                'blocks':     None,
                'three_att':  None,
                'three_pct':  None,
                'ft_made':    None,
                'ft_att':     None,
                'ft_pct':     None,
                'plus_minus': None,
                'minutes':    None,
            })
    return rows


def fetch_pitching_logs(player_id: int, year: int) -> list[dict]:
    """
    Fetches game-by-game pitching stats for one player / one season.

    Response shape used:
      stat: { inningsPitched, earnedRuns, hits, runs, strikeOuts,
              baseOnBalls, homeRuns, era, whip, wins, losses, saves, holds }
    """
    url    = f'{BASE_URL}/people/{player_id}/stats'
    params = {
        'stats':   'gameLog',
        'season':  year,
        'sportId': 1,
        'group':   'pitching',
    }
    data = get_json(url, params)
    if not data:
        return []

    rows = []
    for stat_block in data.get('stats', []):
        for split in stat_block.get('splits', []):
            st = split.get('stat', {})

            # innings pitched arrives as "6.2" (6 full innings + 2 outs)
            ip_str = st.get('inningsPitched', '0.0')
            ip_val = safe_float(ip_str)

            rows.append({
                'game_date':  split.get('date'),
                'game_id':    str(split.get('game', {}).get('gamePk', '')),
                'team':       split.get('team', {}).get('abbreviation', ''),
                'opponent':   split.get('opponent', {}).get('abbreviation', ''),
                'home_away':  'home' if split.get('isHome') else 'away',
                'season':     str(split.get('season', year)),
                # Pitcher-specific columns
                'offensive_rating':  safe_float(st.get('era')),    # ERA
                'true_shooting_pct': safe_float(st.get('whip')),   # WHIP
                'assists':           safe_float(st.get('strikeOuts')),  # K
                'minutes':           ip_val,                         # IP as float
                # Hits/runs allowed stored in hitting columns
                'fg_made':    safe_float(st.get('hits')),           # hits allowed
                'fg_att':     None,
                'fg_pct':     None,
                'points':     safe_float(st.get('runs')),           # runs allowed
                'turnovers':  safe_float(st.get('baseOnBalls')),    # BB allowed → turnovers
                'three_made': safe_float(st.get('homeRuns')),       # HR allowed
                # Remaining columns NULL for pitchers
                'rebounds':   None,
                'steals':     None,
                'blocks':     None,
                'fouls':      None,
                'three_att':  None,
                'three_pct':  None,
                'ft_made':    None,
                'ft_att':     None,
                'ft_pct':     None,
                'off_reb':    None,
                'def_reb':    None,
                'plus_minus': None,
            })
    return rows


# ── Platoon splits ─────────────────────────────────────────────────────────────

def fetch_platoon_splits(player_id: int, year: int) -> dict:
    """
    Fetch vs-LHP and vs-RHP splits for a batter.
    sitCodes: vl = vs left-handed pitchers, vr = vs right-handed pitchers
    """
    url = f'{BASE_URL}/people/{player_id}/stats'
    params = {
        'stats':    'statSplits',
        'season':   year,
        'sportId':  1,
        'group':    'hitting',
        'sitCodes': 'vl,vr',
    }
    data = get_json(url, params)
    if not data:
        return {}

    result = {}
    for stat_block in data.get('stats', []):
        for split in stat_block.get('splits', []):
            sit = split.get('split', {}).get('code', '')
            st  = split.get('stat', {})
            if sit == 'vl':
                result['vs_lhp_avg'] = safe_float(st.get('avg'))
                result['vs_lhp_obp'] = safe_float(st.get('obp'))
                result['vs_lhp_slg'] = safe_float(st.get('slg'))
            elif sit == 'vr':
                result['vs_rhp_avg'] = safe_float(st.get('avg'))
                result['vs_rhp_obp'] = safe_float(st.get('obp'))
                result['vs_rhp_slg'] = safe_float(st.get('slg'))
    return result


def upsert_player_splits(conn, player_id: int, season: str, splits: dict) -> None:
    """Store platoon splits for a player in player_splits table."""
    if not splits:
        return
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO player_splits (
                 player_id, sport, season,
                 vs_lhp_avg, vs_lhp_obp, vs_lhp_slg,
                 vs_rhp_avg, vs_rhp_obp, vs_rhp_slg
               ) VALUES (%s, 'MLB', %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (player_id, sport, season) DO UPDATE SET
                 vs_lhp_avg = EXCLUDED.vs_lhp_avg,
                 vs_lhp_obp = EXCLUDED.vs_lhp_obp,
                 vs_lhp_slg = EXCLUDED.vs_lhp_slg,
                 vs_rhp_avg = EXCLUDED.vs_rhp_avg,
                 vs_rhp_obp = EXCLUDED.vs_rhp_obp,
                 vs_rhp_slg = EXCLUDED.vs_rhp_slg,
                 updated_at = NOW()""",
            (
                player_id, season,
                splits.get('vs_lhp_avg'), splits.get('vs_lhp_obp'), splits.get('vs_lhp_slg'),
                splits.get('vs_rhp_avg'), splits.get('vs_rhp_obp'), splits.get('vs_rhp_slg'),
            ),
        )
    conn.commit()


# ── Incremental check ──────────────────────────────────────────────────────────

def last_stored_date(conn, player_id: int) -> Optional[date]:
    """Returns the most recent game_date stored for this MLB player, or None."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(game_date) FROM player_game_logs "
            "WHERE player_id = %s AND sport = 'MLB'",
            (player_id,)
        )
        row = cur.fetchone()
        return row[0] if row else None


# ── DB writer ──────────────────────────────────────────────────────────────────

def upsert_player_game_log(conn, player_id: int, player_name: str, team: str,
                           season: str, row: dict):
    """
    Inserts one game log row. On conflict (same player + game_date + sport)
    updates the key stat columns.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO player_game_logs (
                player_id, player_name, team, sport, season,
                game_date, game_id, opponent, home_away,
                minutes, points, rebounds, assists, steals, blocks,
                turnovers, fouls,
                fg_made, fg_att, fg_pct,
                three_made, three_att, three_pct,
                ft_made, ft_att, ft_pct,
                off_reb, def_reb,
                offensive_rating, true_shooting_pct,
                plus_minus
            ) VALUES (
                %(player_id)s, %(player_name)s, %(team)s, 'MLB', %(season)s,
                %(game_date)s, %(game_id)s, %(opponent)s, %(home_away)s,
                %(minutes)s, %(points)s, %(rebounds)s, %(assists)s, %(steals)s, %(blocks)s,
                %(turnovers)s, %(fouls)s,
                %(fg_made)s, %(fg_att)s, %(fg_pct)s,
                %(three_made)s, %(three_att)s, %(three_pct)s,
                %(ft_made)s, %(ft_att)s, %(ft_pct)s,
                %(off_reb)s, %(def_reb)s,
                %(offensive_rating)s, %(true_shooting_pct)s,
                %(plus_minus)s
            )
            ON CONFLICT (player_id, game_date, sport) DO UPDATE SET
                points             = EXCLUDED.points,
                fg_made            = EXCLUDED.fg_made,
                fg_att             = EXCLUDED.fg_att,
                fg_pct             = EXCLUDED.fg_pct,
                three_made         = EXCLUDED.three_made,
                steals             = EXCLUDED.steals,
                assists            = EXCLUDED.assists,
                offensive_rating   = EXCLUDED.offensive_rating,
                true_shooting_pct  = EXCLUDED.true_shooting_pct
            """,
            {
                **row,
                'player_id':   player_id,
                'player_name': player_name,
                'team':        team if not row.get('team') else row['team'],
                'season':      season,
            }
        )
    conn.commit()


# ── Collection runner ──────────────────────────────────────────────────────────

def collect_season(conn, year: int):
    """Collect all player game logs for a single MLB season year (int)."""
    log.info(f'\n--- Season {year} ---')
    players = fetch_active_players(year)
    if not players:
        return

    for idx, player in enumerate(players):
        pid      = player['id']
        name     = player['name']
        team     = player['team']
        position = player['position']

        # Incremental: find latest row already in DB for this player
        cutoff = last_stored_date(conn, pid)

        log.info(f'  [{idx + 1}/{len(players)}] {name} ({position}, {team})'
                 f'  last_stored={cutoff}')

        # Decide whether to fetch hitting or pitching (or both — some SP hit)
        # TWP = Two-Way Player (e.g. Ohtani); treat as position player for hitting logs
        is_pitcher = position in ('P', 'SP', 'RP', 'CP')

        # Always try hitting for position players; pitchers also bat in NL
        hitting_rows = []
        if not is_pitcher:
            hitting_rows = fetch_hitting_logs(pid, year)
            time.sleep(DELAY)
            # Fetch platoon splits for batters
            try:
                splits = fetch_platoon_splits(pid, year)
                if splits:
                    upsert_player_splits(conn, pid, str(year), splits)
                time.sleep(DELAY)
            except Exception as exc:
                log.warning(f'    Platoon splits fetch failed for {name}: {exc}')
                conn.rollback()

        pitching_rows = []
        if is_pitcher:
            pitching_rows = fetch_pitching_logs(pid, year)
            time.sleep(DELAY)

        all_rows = hitting_rows + pitching_rows
        new_count = 0

        for row in all_rows:
            gd_str = row.get('game_date')
            if not gd_str:
                continue

            # Parse date string "YYYY-MM-DD"
            try:
                gd = date.fromisoformat(gd_str)
            except (ValueError, TypeError):
                log.warning(f'    Bad date: {gd_str}')
                continue

            # Skip games already stored (incremental mode)
            if cutoff and gd <= cutoff:
                continue

            try:
                upsert_player_game_log(
                    conn, pid, name,
                    row.get('team') or team,
                    row['season'],
                    {**row, 'game_date': gd}
                )
                new_count += 1
            except Exception as exc:
                log.error(f'    DB error for {name} on {gd_str}: {exc}')
                conn.rollback()

        if new_count:
            log.info(f'    Stored {new_count} new game log(s)')


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk MLB Data Collector')
    parser.add_argument(
        '--full',
        action='store_true',
        help='Force full collection for all 4 seasons (ignores incremental cutoff)',
    )
    parser.add_argument(
        '--season',
        type=int,
        metavar='YEAR',
        help='Collect a single season only, e.g. --season 2024',
    )
    args = parser.parse_args()

    log.info('═══════════════════════════════════════════════')
    log.info('Chalk MLB Data Collector')
    if args.season:
        seasons_to_run = [args.season]
        log.info(f'Mode: single season {args.season}')
    elif args.full:
        seasons_to_run = SEASONS
        log.info(f'Mode: FULL — seasons {SEASONS}')
    else:
        seasons_to_run = [SEASONS[-1]]   # default: current season only
        log.info(f'Mode: incremental — season {seasons_to_run[0]}')
    log.info('═══════════════════════════════════════════════')

    conn = get_db()
    try:
        for year in seasons_to_run:
            collect_season(conn, year)
    finally:
        conn.close()

    log.info('\nCollection run complete.')


if __name__ == '__main__':
    main()
