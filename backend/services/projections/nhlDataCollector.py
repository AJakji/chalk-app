"""
Chalk NHL Data Collector
========================
Collects player game logs from the NHL Official API (free, no key required)
and writes them to the player_game_logs table in PostgreSQL.

DATA SOURCE: NHL API v1 — https://api-web.nhle.com/v1
  Teams:    GET https://api.nhle.com/stats/rest/en/team
  Roster:   GET https://api-web.nhle.com/v1/roster/{teamAbbrev}/current
  Game log: GET https://api-web.nhle.com/v1/player/{playerId}/game-log/{season}/2
              where season = "20242025" and game_type 2 = regular season
  PP TOI:   GET https://api.nhle.com/stats/rest/en/skater/summary?cayenneExp=seasonId={season}&limit=-1

SKATER COLUMN MAPPING (player_game_logs):
  points         = goals
  three_made     = assists
  assists (col)  = points (combined G+A total)
  fg_made        = shots on goal (SOG)  ← Fix 1
  ft_made        = hits                 ← Fix 4
  ft_att         = blocked shots        ← Fix 4
  turnovers      = PIM (penalty minutes)← Fix 4
  three_att      = power play goals
  fg_att         = PP TOI per game (injected from season summary)  ← Fix 3
  plus_minus     = plus/minus

GOALIE COLUMN MAPPING (player_game_logs):            ← Fix 2
  steals         = saves
  fg_pct         = save percentage (SV%)
  fg_att         = shots against
  blocks         = goals against
  off_reb        = GSAA = saves - shotsAgainst × 0.906
  plus_minus     = decision (W=+1, L=-1, OT=0)
  position       = 'G'

Usage:
  python nhlDataCollector.py                           # incremental: current season
  python nhlDataCollector.py --full                    # all 3 seasons from scratch
  python nhlDataCollector.py --season 20232024         # single season only
  python nhlDataCollector.py --days 60                 # last 60 days only
  python nhlDataCollector.py --days 60 --goalies_only  # re-run goalies only
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import date, timedelta
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

DATABASE_URL   = os.getenv('DATABASE_URL', '')
BASE_WEB       = 'https://api-web.nhle.com/v1'
BASE_STATS     = 'https://api.nhle.com/stats/rest/en'
SEASONS        = ['20222023', '20232024', '20242025', '20252026']
DELAY          = 0.5   # seconds between player API calls
GAME_TYPE      = 2     # 2 = regular season

# Goalie constants
GOALIE_SV_AVG  = 0.906   # league-average SV% for GSAA computation


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


def parse_toi(toi_str: str) -> Optional[float]:
    """
    Convert "MM:SS" time-on-ice string to a float of minutes.
    e.g. "23:14" → 23.233...
    Returns None if the string is missing or malformed.
    """
    if not toi_str or ':' not in str(toi_str):
        return safe_float(toi_str)
    try:
        parts   = str(toi_str).split(':')
        minutes = int(parts[0])
        seconds = int(parts[1])
        return round(minutes + seconds / 60, 4)
    except (IndexError, ValueError):
        return None


def parse_toi_seconds(toi_val) -> Optional[float]:
    """
    Parse PP TOI from season summary — may be "MM:SS" string or integer seconds.
    Returns minutes (float) or None.
    """
    if toi_val is None:
        return None
    if isinstance(toi_val, (int, float)):
        return round(float(toi_val) / 60, 4)   # seconds → minutes
    if ':' in str(toi_val):
        return parse_toi(toi_val)               # "MM:SS" → minutes
    try:
        return round(float(toi_val) / 60, 4)
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
        log.warning(f'  HTTP error [{url}]: {exc}')
        return None


# ── API fetch functions ────────────────────────────────────────────────────────

def fetch_all_teams() -> list[dict]:
    """
    Returns all NHL teams with their abbreviations.

    Response shape used:
      { data: [{ id, triCode, fullName }] }
    """
    data = get_json(f'{BASE_STATS}/team')
    if not data:
        log.warning('  Could not fetch NHL team list')
        return []

    teams = []
    for t in data.get('data', []):
        abbrev = t.get('triCode') or t.get('abbreviation', '')
        if not abbrev:
            continue
        teams.append({
            'id':     t.get('id', 0),
            'name':   t.get('fullName', abbrev),
            'abbrev': abbrev,
        })
    log.info(f'  {len(teams)} NHL teams fetched')
    return teams


def fetch_roster(team_abbrev: str) -> list[dict]:
    """
    Returns the current active roster for a team.

    Response shape:
      {
        forwards:  [{ id, firstName:{default}, lastName:{default}, positionCode }],
        defensemen:[...],
        goalies:   [...]
      }

    Returns each player with 'is_goalie' flag set.
    """
    url  = f'{BASE_WEB}/roster/{team_abbrev}/current'
    data = get_json(url)
    if not data:
        log.warning(f'  No roster data for {team_abbrev}')
        return []

    players = []
    for group, pos_type, is_goalie in [
        ('forwards',   'F', False),
        ('defensemen', 'D', False),
        ('goalies',    'G', True),
    ]:
        for p in data.get(group, []):
            first = p.get('firstName', {}).get('default', '')
            last  = p.get('lastName',  {}).get('default', '')
            players.append({
                'id':        p['id'],
                'name':      f'{first} {last}'.strip(),
                'position':  p.get('positionCode', pos_type),
                'is_goalie': is_goalie,
            })
    return players


def fetch_pp_toi_season(season: str) -> dict[int, float]:
    """
    Fetches PP TOI per game for all skaters in a season from the NHL Stats REST API.
    Returns a dict of player_id → pp_toi_per_game (minutes).

    Endpoint: GET https://api.nhle.com/stats/rest/en/skater/powerplay
    Field: ppTimeOnIcePerGame (seconds per game) → convert to minutes
    """
    url = f'{BASE_STATS}/skater/powerplay'
    params = {
        'cayenneExp': f'seasonId={season}',
        'limit': -1,
    }
    log.info(f'  Fetching PP TOI season summary for {season}...')
    data = get_json(url, params=params)
    if not data:
        log.warning('  Could not fetch PP TOI season summary — all fg_att will be NULL')
        return {}

    result: dict[int, float] = {}
    for p in data.get('data', []):
        pid = p.get('playerId')
        if not pid:
            continue
        # ppTimeOnIcePerGame is seconds per game already — convert to minutes
        pp_toi_sec = safe_float(p.get('ppTimeOnIcePerGame'))
        if pp_toi_sec is not None and pp_toi_sec > 0:
            result[pid] = round(pp_toi_sec / 60, 4)

    log.info(f'  PP TOI loaded for {len(result)} skaters')
    return result


def fetch_player_game_log(player_id: int, season: str,
                          is_goalie: bool = False) -> list[dict]:
    """
    Fetches the regular-season game log for one player in one season.

    season format: "20242025" (no separator)
    game_type 2   = regular season

    For skaters: maps goals/assists/SOG/hits/blocks/PIM to appropriate columns.
    For goalies:  maps saves/SV%/shotsAgainst/goalsAgainst to appropriate columns.
    """
    url  = f'{BASE_WEB}/player/{player_id}/game-log/{season}/{GAME_TYPE}'
    data = get_json(url)
    if not data:
        return []

    rows = []
    for g in data.get('gameLog', []):
        home_flag = g.get('homeRoadFlag', 'R')
        base = {
            'game_id':   str(g.get('gameId', '')),
            'game_date': g.get('gameDate'),
            'team':      g.get('teamAbbrev', ''),
            'opponent':  g.get('opponentAbbrev', ''),
            'home_away': 'home' if home_flag == 'H' else 'away',
        }

        if is_goalie:
            shots_ag = safe_float(g.get('shotsAgainst'))
            goals_ag = safe_float(g.get('goalsAgainst'))
            # saves not returned directly — compute from shotsAgainst - goalsAgainst
            if shots_ag is not None and goals_ag is not None:
                saves = shots_ag - goals_ag
            else:
                saves = None

            # GSAA = saves - shotsAgainst × league-average SV%
            gsaa = None
            if saves is not None and shots_ag is not None and shots_ag > 0:
                gsaa = round(saves - shots_ag * GOALIE_SV_AVG, 4)

            # Decision: W=+1, L=-1, OT/OTL=0
            decision = g.get('decision', '')
            if decision == 'W':
                decision_val = 1.0
            elif decision == 'L':
                decision_val = -1.0
            else:
                decision_val = 0.0   # OT loss or no decision

            rows.append({**base,
                'minutes':    parse_toi(g.get('toi')),          # toi field (not timeOnIce)
                # Goalie-specific mappings
                'steals':     saves,                            # saves → steals
                'fg_pct':     safe_float(g.get('savePctg')),   # savePctg → fg_pct
                'fg_att':     shots_ag,                        # shotsAgainst → fg_att
                'blocks':     safe_float(g.get('goalsAgainst')),# GA → blocks
                'off_reb':    gsaa,                            # GSAA → off_reb
                'plus_minus': decision_val,                    # decision → plus_minus
                # All other columns NULL for goalies
                'points':     None,
                'rebounds':   None,
                'assists':    None,
                'turnovers':  None,
                'fouls':      None,
                'fg_made':    None,
                'three_made': None,
                'three_att':  None,
                'three_pct':  None,
                'ft_made':    None,
                'ft_att':     None,
                'ft_pct':     None,
                'def_reb':    None,
                'offensive_rating':  None,
                'true_shooting_pct': None,
            })
        else:
            rows.append({**base,
                'minutes':    parse_toi(g.get('toi')),          # toi field (not timeOnIce)
                # Skater score columns
                'points':     safe_float(g.get('goals')),          # goals → points
                'three_made': safe_float(g.get('assists')),        # assists → three_made
                'assists':    safe_float(g.get('points')),         # combined G+A → assists
                # Physical stats (hits/blockedShots not in game log endpoint)
                'ft_made':    None,                                # hits not available per game
                'ft_att':     None,                                # blockedShots not available per game
                'turnovers':  safe_float(g.get('pim')),            # PIM → turnovers
                # Shot stats
                'fg_made':    safe_float(g.get('shots')),          # SOG → fg_made (Fix 1)
                'three_att':  safe_float(g.get('powerPlayGoals')), # PP goals → three_att
                'plus_minus': safe_float(g.get('plusMinus')),
                # NULL columns (steals/blocks now cleared; fg_att = PP TOI injected later)
                'rebounds':   None,
                'steals':     None,
                'blocks':     None,
                'fouls':      None,
                'fg_att':     None,   # PP TOI per game — injected from season summary
                'fg_pct':     None,
                'three_pct':  None,
                'ft_pct':     None,
                'off_reb':    None,
                'def_reb':    None,
                'offensive_rating':  None,
                'true_shooting_pct': None,
            })
    return rows


# ── Incremental check ──────────────────────────────────────────────────────────

def last_stored_date(conn, player_id: int) -> Optional[date]:
    """Returns the most recent game_date stored for this NHL player, or None."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(game_date) FROM player_game_logs "
            "WHERE player_id = %s AND sport = 'NHL'",
            (player_id,)
        )
        row = cur.fetchone()
        return row[0] if row else None


# ── DB writer ──────────────────────────────────────────────────────────────────

def upsert_player_game_log(conn, player_id: int, player_name: str, team: str,
                           season: str, row: dict, position: str = None):
    """
    Inserts one game log row. On conflict (same player + game_date + sport)
    updates all relevant stat columns so re-runs (e.g. --goalies_only) apply fixes.
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
                plus_minus, position
            ) VALUES (
                %(player_id)s, %(player_name)s, %(team)s, 'NHL', %(season)s,
                %(game_date)s, %(game_id)s, %(opponent)s, %(home_away)s,
                %(minutes)s, %(points)s, %(rebounds)s, %(assists)s, %(steals)s, %(blocks)s,
                %(turnovers)s, %(fouls)s,
                %(fg_made)s, %(fg_att)s, %(fg_pct)s,
                %(three_made)s, %(three_att)s, %(three_pct)s,
                %(ft_made)s, %(ft_att)s, %(ft_pct)s,
                %(off_reb)s, %(def_reb)s,
                %(offensive_rating)s, %(true_shooting_pct)s,
                %(plus_minus)s, %(position)s
            )
            ON CONFLICT (player_id, game_date, sport) DO UPDATE SET
                points      = EXCLUDED.points,
                three_made  = EXCLUDED.three_made,
                assists     = EXCLUDED.assists,
                steals      = EXCLUDED.steals,
                blocks      = EXCLUDED.blocks,
                plus_minus  = EXCLUDED.plus_minus,
                minutes     = EXCLUDED.minutes,
                ft_made     = EXCLUDED.ft_made,
                ft_att      = EXCLUDED.ft_att,
                turnovers   = EXCLUDED.turnovers,
                fg_made     = EXCLUDED.fg_made,
                fg_att      = EXCLUDED.fg_att,
                fg_pct      = EXCLUDED.fg_pct,
                off_reb     = EXCLUDED.off_reb,
                position    = EXCLUDED.position
            """,
            {
                **row,
                'player_id':   player_id,
                'player_name': player_name,
                'team':        row.get('team') or team,
                'season':      season,
                'position':    position,
            }
        )
    conn.commit()


# ── Season format helper ───────────────────────────────────────────────────────

def season_display(season_code: str) -> str:
    """Convert "20242025" → "2024-25" for display."""
    if len(season_code) == 8:
        return f'{season_code[:4]}-{season_code[6:]}'
    return season_code


# ── Collection runner ──────────────────────────────────────────────────────────

def collect_season(conn, season: str,
                   goalies_only: bool = False,
                   days_cutoff: Optional[date] = None):
    """
    Collect all player game logs for a single NHL season code (e.g. "20242025").
    Iterates over every team roster, then every player on that roster.

    Args:
        goalies_only:  If True, skip skaters and only process goalies.
        days_cutoff:   If set, only store games on or after this date.
    """
    log.info(f'\n--- Season {season_display(season)} ---')
    if goalies_only:
        log.info('  Mode: goalies only')
    if days_cutoff:
        log.info(f'  Days cutoff: {days_cutoff}')

    teams = fetch_all_teams()
    if not teams:
        return

    # Pre-fetch PP TOI season summary for skaters
    pp_toi_map: dict[int, float] = {}
    if not goalies_only:
        pp_toi_map = fetch_pp_toi_season(season)

    seen_player_ids: set[int] = set()   # avoid duplicate API calls for traded players

    for t_idx, team in enumerate(teams):
        abbrev = team['abbrev']
        log.info(f'  Team [{t_idx + 1}/{len(teams)}] {abbrev} — fetching roster')
        roster = fetch_roster(abbrev)
        if not roster:
            continue

        for p_idx, player in enumerate(roster):
            pid       = player['id']
            name      = player['name']
            position  = player['position']
            is_goalie = player['is_goalie']

            # Filter by player type if requested
            if goalies_only and not is_goalie:
                continue

            if pid in seen_player_ids:
                continue
            seen_player_ids.add(pid)

            # Incremental: skip games already in DB (unless days_cutoff overrides)
            cutoff = last_stored_date(conn, pid)
            if days_cutoff:
                # Use whichever is later: existing DB cutoff or the days window
                if cutoff:
                    cutoff = max(cutoff, days_cutoff - timedelta(days=1))
                else:
                    cutoff = days_cutoff - timedelta(days=1)

            log.info(f'    [{p_idx + 1}/{len(roster)}] {name} ({position})  last_stored={cutoff}')

            try:
                game_rows = fetch_player_game_log(pid, season, is_goalie=is_goalie)
            except Exception as exc:
                log.warning(f'    fetch error for {name} season {season}: {exc}')
                time.sleep(DELAY)
                continue

            time.sleep(DELAY)

            if not game_rows:
                continue

            # Inject PP TOI into skater rows from season summary
            if not is_goalie and pid in pp_toi_map:
                pp_toi_val = pp_toi_map[pid]
                for row in game_rows:
                    row['fg_att'] = pp_toi_val

            new_count = 0
            for row in game_rows:
                gd_str = row.get('game_date')
                if not gd_str:
                    continue

                try:
                    gd = date.fromisoformat(gd_str)
                except (ValueError, TypeError):
                    log.warning(f'    Bad date: {gd_str}')
                    continue

                # Skip games before our cutoff
                if cutoff and gd <= cutoff:
                    continue

                try:
                    upsert_player_game_log(
                        conn, pid, name,
                        row.get('team') or abbrev,
                        season,
                        {**row, 'game_date': gd},
                        position=position,
                    )
                    new_count += 1
                except Exception as exc:
                    log.error(f'    DB error for {name} on {gd_str}: {exc}')
                    conn.rollback()

            if new_count:
                log.info(f'    Stored {new_count} new/updated game log(s)')


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Chalk NHL Data Collector')
    parser.add_argument(
        '--full',
        action='store_true',
        help='Force full collection for all 3 seasons (ignores incremental cutoff)',
    )
    parser.add_argument(
        '--season',
        type=str,
        metavar='SEASON_CODE',
        help='Collect a single season only, e.g. --season 20242025',
    )
    parser.add_argument(
        '--days',
        type=int,
        metavar='N',
        help='Only collect/update games from the last N days',
    )
    parser.add_argument(
        '--goalies_only',
        action='store_true',
        help='Re-run only goalies (skips skater API calls)',
    )
    args = parser.parse_args()

    log.info('═══════════════════════════════════════════════')
    log.info('Chalk NHL Data Collector')

    if args.season:
        seasons_to_run = [args.season]
        log.info(f'Mode: single season {args.season}')
    elif args.full:
        seasons_to_run = SEASONS
        log.info(f'Mode: FULL — seasons {SEASONS}')
    else:
        seasons_to_run = [SEASONS[-1]]   # default: current season only
        log.info(f'Mode: incremental — season {seasons_to_run[0]}')

    if args.goalies_only:
        log.info('Filter: goalies only')
    if args.days:
        log.info(f'Window: last {args.days} days')

    log.info('═══════════════════════════════════════════════')

    days_cutoff = None
    if args.days:
        days_cutoff = date.today() - timedelta(days=args.days)

    conn = get_db()
    try:
        for season in seasons_to_run:
            collect_season(
                conn, season,
                goalies_only=args.goalies_only,
                days_cutoff=days_cutoff,
            )
    finally:
        conn.close()

    log.info('\nCollection run complete.')


if __name__ == '__main__':
    main()
