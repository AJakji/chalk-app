"""
Chalk NBA Data Collector
========================
Nightly script that collects player and team game logs from the BallDontLie
GOAT API and stores them in our PostgreSQL database — the foundation of the
projection engine.

DATA SOURCE: BallDontLie GOAT API (https://api.balldontlie.io/v1)
  Requires env var: BALLDONTLIE_API_KEY
  Python dependency: requests  (pip install requests psycopg2-binary python-dotenv)

WHAT THIS COLLECTOR WRITES TO:
  - player_game_logs         (one row per player per game)

Usage:
  python nbaDataCollector.py            (incremental: only new games since last run)
  python nbaDataCollector.py --full     (force full 3-season re-collection)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import date, datetime
from typing import Any, Optional

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

# Load .env two levels up (backend/.env or project root .env)
load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)s  %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

DATABASE_URL       = os.getenv('DATABASE_URL', '')
BALLDONTLIE_API_KEY = os.getenv('BALLDONTLIE_API_KEY', '').strip()
BASE_URL           = 'https://api.balldontlie.io/v1'

# BallDontLie season numbering: 2023-24 = 2023, 2024-25 = 2024, 2025-26 = 2025
SEASON_YEARS       = [2023, 2024, 2025]          # 3-season lookback
CURRENT_SEASON_YR  = 2025
CURRENT_SEASON_STR = '2025-26'

BATCH_SIZE         = 100   # max player_ids[] per request (GOAT tier)
DELAY_BETWEEN_PAGES = 0.5  # seconds between paginated calls
DELAY_BETWEEN_BATCHES = 1.0  # seconds between player batches
RATE_LIMIT_SLEEP   = 60    # seconds to sleep on 429


# ── Position mapping ───────────────────────────────────────────────────────────

def map_position(bdl_pos: str | None) -> str | None:
    """Map BallDontLie position string to standard 5-position format."""
    if not bdl_pos:
        return None
    p = bdl_pos.strip().upper()
    mapping = {
        'PG': 'PG', 'G': 'PG',
        'SG': 'SG',
        'SF': 'SF', 'F': 'SF',
        'PF': 'PF', 'F-C': 'PF',
        'C':  'C',
        'G-F': 'SG',
    }
    return mapping.get(p)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _season_label(yr: int) -> str:
    """Convert BallDontLie season year to human label: 2024 → '2024-25'."""
    return f'{yr}-{str(yr + 1)[-2:]}'


def parse_minutes(min_str: Any) -> Optional[float]:
    """Parse '32:15' → 32.25.  Returns None if unparseable."""
    if min_str is None:
        return None
    s = str(min_str).strip()
    if ':' in s:
        parts = s.split(':', 1)
        try:
            return int(parts[0]) + int(parts[1]) / 60.0
        except ValueError:
            return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def safe_float(val: Any) -> Optional[float]:
    """Cast to float or return None."""
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def safe_date(val: Any) -> Optional[date]:
    """Parse ISO date string or return None."""
    if val is None:
        return None
    if isinstance(val, date):
        return val
    try:
        return datetime.strptime(str(val)[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


# ── HTTP client with rate-limit retry ──────────────────────────────────────────

def _get(endpoint: str, params: dict) -> dict:
    """
    GET {BASE_URL}/{endpoint} with auth header.
    Retries indefinitely on 429 (sleeping RATE_LIMIT_SLEEP seconds).
    Raises requests.HTTPError on other 4xx/5xx after one retry.
    """
    if not BALLDONTLIE_API_KEY:
        raise RuntimeError('BALLDONTLIE_API_KEY env var not set')

    url = f'{BASE_URL}/{endpoint}'
    headers = {'Authorization': BALLDONTLIE_API_KEY}

    while True:
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=30)
        except requests.RequestException as exc:
            log.error(f'Network error on GET {endpoint}: {exc}')
            raise

        if resp.status_code == 429:
            log.warning(f'Rate-limited (429) on {endpoint} — sleeping {RATE_LIMIT_SLEEP}s')
            time.sleep(RATE_LIMIT_SLEEP)
            continue

        resp.raise_for_status()
        return resp.json()


def _paginate(endpoint: str, base_params: dict) -> list[dict]:
    """
    Fully exhaust cursor-based pagination for an endpoint.
    Returns a flat list of all 'data' rows across all pages.
    """
    rows: list[dict] = []
    params = {**base_params, 'per_page': 100}
    cursor: Optional[int] = None

    while True:
        if cursor is not None:
            params['cursor'] = cursor

        payload = _get(endpoint, params)
        data    = payload.get('data', [])
        rows.extend(data)

        meta        = payload.get('meta', {})
        next_cursor = meta.get('next_cursor')

        if not next_cursor:
            break

        cursor = next_cursor
        time.sleep(DELAY_BETWEEN_PAGES)

    return rows


# ── DB connection ──────────────────────────────────────────────────────────────

def get_db() -> psycopg2.extensions.connection:
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL env var not set')
    conn = psycopg2.connect(
        DATABASE_URL,
        keepalives=1,
        keepalives_idle=60,      # send keepalive after 60s idle
        keepalives_interval=10,  # retry every 10s
        keepalives_count=5,      # 5 retries before giving up
    )
    conn.autocommit = False
    return conn


# ── Last-game-date lookup (for incremental mode) ───────────────────────────────

def get_last_game_dates(conn) -> dict[int, date]:
    """
    Returns {player_id: max(game_date)} for all players already in player_game_logs
    where sport='NBA'.  Used to skip already-stored games in incremental mode.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT player_id, MAX(game_date) FROM player_game_logs "
            "WHERE sport = 'NBA' GROUP BY player_id"
        )
        return {row[0]: row[1] for row in cur.fetchall()}


# ── BallDontLie: fetch all active players ─────────────────────────────────────

def fetch_active_players() -> list[dict]:
    """
    Returns list of player dicts:
    { 'id': int, 'full_name': str, 'position': str,
      'team_id': int, 'team': str }
    """
    log.info('Fetching active player list from BallDontLie…')
    rows = _paginate('players', {'per_page': 100})

    players = []
    for r in rows:
        team = r.get('team') or {}
        players.append({
            'id':        r['id'],
            'full_name': f"{r.get('first_name', '')} {r.get('last_name', '')}".strip(),
            'position':  r.get('position', ''),
            'team_id':   team.get('id'),
            'team':      team.get('abbreviation', ''),
        })

    log.info(f'  {len(players)} active players found')
    return players


# ── BallDontLie: fetch stats for a batch of players ───────────────────────────

def fetch_stats_batch(player_ids: list[int], seasons: list[int]) -> list[dict]:
    """
    Fetch /stats for up to BATCH_SIZE player_ids across given seasons.
    Returns flat list of raw stat rows from the API.
    """
    params: dict[str, Any] = {'per_page': 100}
    for pid in player_ids:
        params.setdefault('player_ids[]', [])
        params['player_ids[]'].append(pid)
    for yr in seasons:
        params.setdefault('seasons[]', [])
        params['seasons[]'].append(yr)

    return _paginate('stats', params)


def fetch_advanced_stats_batch(player_ids: list[int], seasons: list[int]) -> list[dict]:
    """
    Fetch /advanced_stats for up to BATCH_SIZE player_ids across given seasons.
    Returns flat list of raw advanced stat rows.
    """
    params: dict[str, Any] = {'per_page': 100}
    for pid in player_ids:
        params.setdefault('player_ids[]', [])
        params['player_ids[]'].append(pid)
    for yr in seasons:
        params.setdefault('seasons[]', [])
        params['seasons[]'].append(yr)

    return _paginate('advanced_stats', params)


# ── BallDontLie: injury report ────────────────────────────────────────────────

def fetch_injuries() -> list[dict]:
    """
    Fetch /player_injuries.
    Returns list of injury dicts (informational — not written to DB here).
    """
    log.info('Fetching injury report…')
    payload = _get('player_injuries', {})
    return payload.get('data', [])


# ── Row normalisation ──────────────────────────────────────────────────────────

def _determine_home_away(game: dict, player_team_id: Optional[int]) -> str:
    """Return 'home' if player's team is the home team, else 'away'."""
    if player_team_id is None:
        return 'away'
    return 'home' if game.get('home_team_id') == player_team_id else 'away'


def _determine_opponent(game: dict, player_team_id: Optional[int],
                         team_id_to_abbr: dict[int, str]) -> str:
    """Return the abbreviation of the opposing team."""
    home_id    = game.get('home_team_id')
    visitor_id = game.get('visitor_team_id')
    if player_team_id == home_id:
        opp_id = visitor_id
    else:
        opp_id = home_id
    return team_id_to_abbr.get(opp_id, '') if opp_id else ''


def normalise_stat_row(raw: dict, adv: Optional[dict],
                        player_map: dict[int, dict],
                        team_id_to_abbr: dict[int, str],
                        season_yr: int) -> Optional[dict]:
    """
    Merge one /stats row with its matching /advanced_stats row into the
    shape required by upsert_player_game_log.  Returns None if row is unusable.
    """
    player_info = raw.get('player') or {}
    game        = raw.get('game') or {}
    team_info   = raw.get('team') or {}

    player_id  = player_info.get('id')
    game_id    = game.get('id')
    game_date  = safe_date(game.get('date'))

    if not player_id or not game_id or not game_date:
        return None

    # minutes: BallDontLie returns "32:15" string
    minutes = parse_minutes(raw.get('min'))

    # Skip DNPs (0 or None minutes)
    if minutes is None or minutes == 0.0:
        return None

    # Team context
    player_detail = player_map.get(player_id, {})
    player_team_id = player_detail.get('team_id') or team_info.get('id')
    team_abbr      = team_info.get('abbreviation') or player_detail.get('team', '')

    home_away = _determine_home_away(game, player_team_id)
    opponent  = _determine_opponent(game, player_team_id, team_id_to_abbr)

    # Advanced metrics (may be None if no matching advanced row)
    usage_rate        = safe_float(adv.get('usg_pct'))    if adv else None
    true_shooting_pct = safe_float(adv.get('ts_pct'))     if adv else None
    off_rtg           = safe_float(adv.get('off_rtg'))    if adv else None
    def_rtg           = safe_float(adv.get('def_rtg'))    if adv else None
    pace              = safe_float(adv.get('pace'))        if adv else None
    plus_minus_adv    = safe_float(adv.get('plus_minus')) if adv else None

    # Prefer advanced plus_minus; fall back to basic row's value if present
    plus_minus = plus_minus_adv if plus_minus_adv is not None else safe_float(raw.get('plus_minus'))

    return {
        'player_id':        player_id,
        'player_name':      player_detail.get('full_name', ''),
        'team':             team_abbr,
        'season':           _season_label(season_yr),
        'game_date':        game_date,
        'game_id':          str(game_id),
        'opponent':         opponent,
        'home_away':        home_away,
        'minutes':          minutes,
        'points':           safe_float(raw.get('pts')),
        'rebounds':         safe_float(raw.get('reb')),
        'assists':          safe_float(raw.get('ast')),
        'steals':           safe_float(raw.get('stl')),
        'blocks':           safe_float(raw.get('blk')),
        'turnovers':        safe_float(raw.get('turnover')),
        'fouls':            safe_float(raw.get('pf')),
        'fg_made':          safe_float(raw.get('fgm')),
        'fg_att':           safe_float(raw.get('fga')),
        'fg_pct':           safe_float(raw.get('fg_pct')),
        'three_made':       safe_float(raw.get('fg3m')),
        'three_att':        safe_float(raw.get('fg3a')),
        'three_pct':        safe_float(raw.get('fg3_pct')),
        'ft_made':          safe_float(raw.get('ftm')),
        'ft_att':           safe_float(raw.get('fta')),
        'ft_pct':           safe_float(raw.get('ft_pct')),
        'off_reb':          safe_float(raw.get('oreb')),
        'def_reb':          safe_float(raw.get('dreb')),
        'usage_rate':       usage_rate,
        'true_shooting_pct': true_shooting_pct,
        'offensive_rating': off_rtg,
        'defensive_rating': def_rtg,
        'pace':             pace,
        'plus_minus':       plus_minus,
        'position':         map_position(player_detail.get('position', '')),
    }


# ── DB writers ─────────────────────────────────────────────────────────────────

_UPSERT_PLAYER_GAME_LOG = """
INSERT INTO player_game_logs (
    player_id, player_name, team, sport, season,
    game_date, game_id, opponent, home_away,
    minutes, points, rebounds, assists, steals, blocks,
    turnovers, fouls,
    fg_made, fg_att, fg_pct,
    three_made, three_att, three_pct,
    ft_made, ft_att, ft_pct,
    off_reb, def_reb,
    usage_rate, true_shooting_pct,
    offensive_rating, defensive_rating,
    plus_minus, pace, position
) VALUES (
    %(player_id)s, %(player_name)s, %(team)s, 'NBA', %(season)s,
    %(game_date)s, %(game_id)s, %(opponent)s, %(home_away)s,
    %(minutes)s, %(points)s, %(rebounds)s, %(assists)s, %(steals)s, %(blocks)s,
    %(turnovers)s, %(fouls)s,
    %(fg_made)s, %(fg_att)s, %(fg_pct)s,
    %(three_made)s, %(three_att)s, %(three_pct)s,
    %(ft_made)s, %(ft_att)s, %(ft_pct)s,
    %(off_reb)s, %(def_reb)s,
    %(usage_rate)s, %(true_shooting_pct)s,
    %(offensive_rating)s, %(defensive_rating)s,
    %(plus_minus)s, %(pace)s, %(position)s
)
ON CONFLICT (player_id, game_date, sport) DO UPDATE SET
    minutes           = EXCLUDED.minutes,
    points            = EXCLUDED.points,
    rebounds          = EXCLUDED.rebounds,
    assists           = EXCLUDED.assists,
    steals            = EXCLUDED.steals,
    blocks            = EXCLUDED.blocks,
    turnovers         = EXCLUDED.turnovers,
    fouls             = EXCLUDED.fouls,
    fg_made           = EXCLUDED.fg_made,
    fg_att            = EXCLUDED.fg_att,
    fg_pct            = EXCLUDED.fg_pct,
    three_made        = EXCLUDED.three_made,
    three_att         = EXCLUDED.three_att,
    three_pct         = EXCLUDED.three_pct,
    ft_made           = EXCLUDED.ft_made,
    ft_att            = EXCLUDED.ft_att,
    ft_pct            = EXCLUDED.ft_pct,
    off_reb           = EXCLUDED.off_reb,
    def_reb           = EXCLUDED.def_reb,
    usage_rate        = EXCLUDED.usage_rate,
    true_shooting_pct = EXCLUDED.true_shooting_pct,
    offensive_rating  = EXCLUDED.offensive_rating,
    defensive_rating  = EXCLUDED.defensive_rating,
    plus_minus        = EXCLUDED.plus_minus,
    pace              = EXCLUDED.pace,
    position          = EXCLUDED.position,
    team              = EXCLUDED.team,
    opponent          = EXCLUDED.opponent,
    home_away         = EXCLUDED.home_away
"""

def bulk_upsert_game_logs(conn, rows: list[dict]) -> None:
    """
    Bulk-insert a list of row dicts in one SQL statement using execute_values.
    Single commit after all rows — dramatically faster than per-row execute+commit.
    """
    if not rows:
        return

    cols = [
        'player_id', 'player_name', 'team', 'season',
        'game_date', 'game_id', 'opponent', 'home_away',
        'minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks',
        'turnovers', 'fouls',
        'fg_made', 'fg_att', 'fg_pct',
        'three_made', 'three_att', 'three_pct',
        'ft_made', 'ft_att', 'ft_pct',
        'off_reb', 'def_reb',
        'usage_rate', 'true_shooting_pct',
        'offensive_rating', 'defensive_rating',
        'plus_minus', 'pace', 'position',
    ]

    sql = f"""
        INSERT INTO player_game_logs (
            {', '.join(cols)}, sport
        ) VALUES %s
        ON CONFLICT (player_id, game_date, sport) DO UPDATE SET
            minutes           = EXCLUDED.minutes,
            points            = EXCLUDED.points,
            rebounds          = EXCLUDED.rebounds,
            assists           = EXCLUDED.assists,
            steals            = EXCLUDED.steals,
            blocks            = EXCLUDED.blocks,
            turnovers         = EXCLUDED.turnovers,
            fouls             = EXCLUDED.fouls,
            fg_made           = EXCLUDED.fg_made,
            fg_att            = EXCLUDED.fg_att,
            fg_pct            = EXCLUDED.fg_pct,
            three_made        = EXCLUDED.three_made,
            three_att         = EXCLUDED.three_att,
            three_pct         = EXCLUDED.three_pct,
            ft_made           = EXCLUDED.ft_made,
            ft_att            = EXCLUDED.ft_att,
            ft_pct            = EXCLUDED.ft_pct,
            off_reb           = EXCLUDED.off_reb,
            def_reb           = EXCLUDED.def_reb,
            usage_rate        = EXCLUDED.usage_rate,
            true_shooting_pct = EXCLUDED.true_shooting_pct,
            offensive_rating  = EXCLUDED.offensive_rating,
            defensive_rating  = EXCLUDED.defensive_rating,
            plus_minus        = EXCLUDED.plus_minus,
            pace              = EXCLUDED.pace,
            position          = EXCLUDED.position,
            team              = EXCLUDED.team,
            opponent          = EXCLUDED.opponent,
            home_away         = EXCLUDED.home_away
    """

    # Build tuple list — each row includes 'NBA' for sport at the end
    values = [tuple(r.get(c) for c in cols) + ('NBA',) for r in rows]

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, sql, values, page_size=500)
    conn.commit()


# ── Core collection logic ──────────────────────────────────────────────────────

def collect_player_logs(conn, players: list[dict], full: bool) -> None:
    """
    Phase 1: collect player_game_logs from /stats + /advanced_stats.

    Strategy:
    - Chunk players into batches of BATCH_SIZE.
    - For each batch fetch ALL seasons in one paginated call (much faster than
      one player at a time).
    - Join basic + advanced rows by (player_id, game_id).
    - In incremental mode, skip any game_date <= last known date for that player.
    """
    log.info('=' * 60)
    log.info('PHASE 1: Player game logs')
    log.info(f'  {len(players)} players  |  mode: {"FULL 3-season" if full else "incremental"}')

    seasons = SEASON_YEARS if full else [CURRENT_SEASON_YR]

    # Build lookup maps
    player_map: dict[int, dict] = {p['id']: p for p in players}
    team_id_to_abbr: dict[int, str] = {
        p['team_id']: p['team'] for p in players if p.get('team_id')
    }

    # Last-game-date per player (incremental cutoff)
    last_dates: dict[int, date] = {} if full else get_last_game_dates(conn)

    total_written = 0
    total_skipped = 0

    player_ids = [p['id'] for p in players]
    batches    = [player_ids[i:i + BATCH_SIZE] for i in range(0, len(player_ids), BATCH_SIZE)]

    for batch_num, batch in enumerate(batches, 1):
        log.info(f'  Batch {batch_num}/{len(batches)}: {len(batch)} players')

        # ── Fetch basic stats ──────────────────────────────────────────────────
        try:
            raw_stats = fetch_stats_batch(batch, seasons)
        except Exception as exc:
            log.error(f'  fetch_stats_batch failed for batch {batch_num}: {exc}')
            time.sleep(DELAY_BETWEEN_BATCHES)
            continue

        # ── Fetch advanced stats ───────────────────────────────────────────────
        try:
            raw_adv = fetch_advanced_stats_batch(batch, seasons)
        except Exception as exc:
            log.warning(f'  fetch_advanced_stats_batch failed for batch {batch_num}: {exc} — proceeding without advanced metrics')
            raw_adv = []

        # ── Build advanced lookup: (player_id, game_id) → adv row ─────────────
        adv_map: dict[tuple[int, int], dict] = {}
        for a in raw_adv:
            pid = (a.get('player') or {}).get('id')
            gid = (a.get('game') or {}).get('id')
            if pid and gid:
                adv_map[(pid, gid)] = a

        # ── Reconnect if Railway closed the idle connection during BDL API calls ──
        if conn.closed:
            log.warning('  DB connection was closed — reconnecting…')
            conn = get_db()
        else:
            try:
                conn.cursor().execute('SELECT 1')
            except Exception:
                log.warning('  DB connection lost — reconnecting…')
                conn = get_db()

        # ── Normalise and write ────────────────────────────────────────────────
        batch_written = 0
        batch_skipped = 0
        batch_rows: list[dict] = []

        for raw in raw_stats:
            player_info = raw.get('player') or {}
            game        = raw.get('game') or {}
            pid         = player_info.get('id')
            gid         = game.get('id')
            gdate       = safe_date(game.get('date'))

            if not pid or not gid or not gdate:
                batch_skipped += 1
                continue

            # Incremental skip: already have this date or earlier for this player
            if not full:
                last = last_dates.get(pid)
                if last and gdate <= last:
                    batch_skipped += 1
                    continue

            adv = adv_map.get((pid, gid))

            # Determine season year from game date (NBA season straddles two years)
            # Approximate: Oct-Dec → same year start; Jan-Jun → previous year start.
            if gdate.month >= 10:
                season_yr = gdate.year
            else:
                season_yr = gdate.year - 1

            row = normalise_stat_row(raw, adv, player_map, team_id_to_abbr, season_yr)
            if row is None:
                batch_skipped += 1
                continue

            batch_rows.append(row)
            # Update local cache so later rows in this batch don't re-insert a date we just staged
            if pid not in last_dates or last_dates[pid] < gdate:
                last_dates[pid] = gdate

        # Bulk insert all rows in one SQL statement — replaces thousands of round-trips
        try:
            bulk_upsert_game_logs(conn, batch_rows)
            batch_written = len(batch_rows)
        except Exception as exc:
            log.error(f'  Batch {batch_num} bulk insert failed: {exc}')
            try:
                conn.rollback()
            except Exception:
                pass
            batch_skipped += len(batch_rows)

        total_written += batch_written
        total_skipped += batch_skipped
        log.info(f'    Written: {batch_written}  |  Skipped/DNP: {batch_skipped}')
        time.sleep(DELAY_BETWEEN_BATCHES)

    log.info(f'Phase 1 complete — total written: {total_written}, skipped: {total_skipped}')
    return conn  # may have been reconnected mid-run


def backfill_positions(conn, players: list[dict]) -> None:
    """One-time backfill: set position on all existing player_game_logs rows."""
    log.info('Backfilling position column in player_game_logs...')
    updated = 0
    for p in players:
        pos = map_position(p.get('position', ''))
        if not pos:
            continue
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE player_game_logs
                       SET position = %s
                       WHERE player_id = %s AND sport = 'NBA'
                         AND position IS NULL""",
                    (pos, p['id'])
                )
                updated += cur.rowcount
            conn.commit()
        except Exception as e:
            conn.rollback()
            log.warning(f'backfill_positions error for player {p["id"]}: {e}')
    log.info(f'  Backfilled {updated} rows with position data')


def log_injury_report() -> None:
    """
    Phase 3 (informational): fetch and log the current injury report.
    Does not write to DB — consumed by the projection model at pick generation time.
    """
    log.info('=' * 60)
    log.info('PHASE 3: Injury report (informational)')
    try:
        injuries = fetch_injuries()
        log.info(f'  {len(injuries)} injury entries retrieved')
        for inj in injuries[:10]:
            player = inj.get('player') or {}
            name   = f"{player.get('first_name', '')} {player.get('last_name', '')}".strip()
            status = inj.get('status', '')
            desc   = inj.get('description', '')
            log.info(f'  {name}: {status} — {desc}')
        if len(injuries) > 10:
            log.info(f'  … and {len(injuries) - 10} more')
    except Exception as exc:
        log.warning(f'  Could not fetch injury report: {exc}')


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description='Chalk NBA Data Collector — BallDontLie GOAT API')
    parser.add_argument(
        '--full',
        action='store_true',
        help='Force full 3-season re-collection instead of incremental',
    )
    args = parser.parse_args()

    log.info('╔══════════════════════════════════════════════════════╗')
    log.info('║  Chalk NBA Data Collector — BallDontLie GOAT API     ║')
    log.info('╚══════════════════════════════════════════════════════╝')
    log.info(f'Mode   : {"FULL 3-season" if args.full else "incremental (new games only)"}')
    log.info(f'Seasons: {[_season_label(y) for y in (SEASON_YEARS if args.full else [CURRENT_SEASON_YR])]}')

    if not BALLDONTLIE_API_KEY:
        log.error('BALLDONTLIE_API_KEY is not set — aborting')
        sys.exit(1)

    if not DATABASE_URL:
        log.error('DATABASE_URL is not set — aborting')
        sys.exit(1)

    conn = get_db()
    log.info('Database connection established')

    try:
        # Phase 1: player game logs
        players = fetch_active_players()
        if players:
            conn = collect_player_logs(conn, players, args.full)
            # Backfill position for existing rows (idempotent — only updates NULL rows)
            backfill_positions(conn, players)
        else:
            log.warning('No active players returned — skipping player log collection')

        # Phase 2: injury report (log only)
        log_injury_report()

    except KeyboardInterrupt:
        log.warning('Interrupted by user — committing any pending work and exiting')
        conn.commit()
    except Exception as exc:
        log.exception(f'Unhandled error in collection run: {exc}')
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()
        log.info('Database connection closed')

    log.info('╔══════════════════════════════════════════════════════╗')
    log.info('║  Collection run complete                              ║')
    log.info('╚══════════════════════════════════════════════════════╝')


if __name__ == '__main__':
    main()
