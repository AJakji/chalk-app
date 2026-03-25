"""
Chalk Team Data Populator
==========================
Fills team_game_logs and team_situation_splits from data already in player_game_logs.
No additional API calls required — everything is derived from existing rows.

Run AFTER nbaDataCollector.py has populated player_game_logs.

What this does:
  1. Aggregates player_game_logs by (team, game_date, game_id) → team_game_logs
     - Points scored, FG%, 3P%, FT%, rebounds, assists, turnovers, steals, blocks
     - Pace estimated from possession formula: (FGA - OREB + TOV + 0.44*FTA) * 48 / min
     - Points allowed joined from opponent team's aggregated row for same game_id
  2. Computes team_situation_splits from team_game_logs:
     - Home vs away scoring/win%
     - B2B vs normal rest scoring/win%
     - ATS splits once spread data is available

Usage:
  python3 populateTeamData.py
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import date

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

DATABASE_URL   = os.getenv('DATABASE_URL', '')
CURRENT_SEASON = '2025-26'

# Stable integer IDs for each NBA team (so UNIQUE constraint on team_id works).
# These mirror BallDontLie team IDs where known, else sequential.
TEAM_ABBR_TO_ID = {
    'ATL': 1,  'BOS': 2,  'BKN': 3,  'CHA': 4,  'CHI': 5,
    'CLE': 6,  'DAL': 7,  'DEN': 8,  'DET': 9,  'GSW': 10,
    'HOU': 11, 'IND': 12, 'LAC': 13, 'LAL': 14, 'MEM': 15,
    'MIA': 16, 'MIL': 17, 'MIN': 18, 'NOP': 19, 'NYK': 20,
    'OKC': 21, 'ORL': 22, 'PHI': 23, 'PHX': 24, 'POR': 25,
    'SAC': 26, 'SAS': 27, 'TOR': 28, 'UTA': 29, 'WAS': 30,
}

FULL_NAMES = {
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


def get_db():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL env var not set')
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


# ── Phase 1: team_game_logs ────────────────────────────────────────────────────

AGGREGATE_SQL = """
SELECT
    team,
    season,
    game_date,
    game_id,
    opponent,
    home_away,

    -- Scoring
    SUM(points)      AS points_scored,
    COUNT(player_id) AS players_used,

    -- Shooting (use made/attempt sums for accuracy)
    CASE WHEN SUM(fg_att)    > 0 THEN SUM(fg_made)    / SUM(fg_att)    ELSE NULL END AS fg_pct,
    CASE WHEN SUM(three_att) > 0 THEN SUM(three_made) / SUM(three_att) ELSE NULL END AS three_pct,
    CASE WHEN SUM(ft_att)    > 0 THEN SUM(ft_made)    / SUM(ft_att)    ELSE NULL END AS ft_pct,

    -- Counting stats
    SUM(rebounds)   AS rebounds,
    SUM(off_reb)    AS oreb,
    SUM(def_reb)    AS dreb,
    SUM(assists)    AS assists,
    SUM(turnovers)  AS turnovers,
    SUM(steals)     AS steals,
    SUM(blocks)     AS blocks,

    -- For pace: (FGA - OREB + TOV + 0.44 * FTA) * 48 / (total_minutes / 5)
    SUM(fg_att)     AS fga,
    SUM(off_reb)    AS oreb_raw,
    SUM(turnovers)  AS tov,
    SUM(ft_att)     AS fta,
    SUM(minutes)    AS total_minutes,

    -- Home/away split for oreb_pct and dreb_pct
    SUM(off_reb) AS total_oreb,
    SUM(def_reb) AS total_dreb

FROM player_game_logs
WHERE sport = 'NBA'
  AND minutes > 0
  AND game_id IS NOT NULL
GROUP BY team, season, game_date, game_id, opponent, home_away
ORDER BY game_date DESC
"""

UPSERT_TEAM_LOG = """
INSERT INTO team_game_logs (
    team_id, team_name, sport, season, game_date, game_id,
    opponent, home_away,
    points_scored, points_allowed,
    fg_pct, three_pct, ft_pct,
    rebounds, assists, turnovers, steals, blocks,
    oreb_pct, dreb_pct,
    pace,
    created_at
) VALUES (
    %(team_id)s, %(team_name)s, 'NBA', %(season)s, %(game_date)s, %(game_id)s,
    %(opponent)s, %(home_away)s,
    %(points_scored)s, %(points_allowed)s,
    %(fg_pct)s, %(three_pct)s, %(ft_pct)s,
    %(rebounds)s, %(assists)s, %(turnovers)s, %(steals)s, %(blocks)s,
    %(oreb_pct)s, %(dreb_pct)s,
    %(pace)s,
    NOW()
)
ON CONFLICT (team_id, game_date, sport) DO UPDATE SET
    points_scored  = EXCLUDED.points_scored,
    points_allowed = EXCLUDED.points_allowed,
    fg_pct         = EXCLUDED.fg_pct,
    three_pct      = EXCLUDED.three_pct,
    ft_pct         = EXCLUDED.ft_pct,
    rebounds       = EXCLUDED.rebounds,
    assists        = EXCLUDED.assists,
    turnovers      = EXCLUDED.turnovers,
    steals         = EXCLUDED.steals,
    blocks         = EXCLUDED.blocks,
    oreb_pct       = EXCLUDED.oreb_pct,
    dreb_pct       = EXCLUDED.dreb_pct,
    pace           = EXCLUDED.pace
"""


def estimate_pace(fga, oreb, tov, fta, total_minutes):
    """
    Estimate pace (possessions per 48 minutes) from box score totals.
    Formula: Pace = (Poss × 48) / (Minutes / 5)
    where Poss = FGA - OREB + TOV + 0.44 × FTA
    """
    if not total_minutes or total_minutes <= 0:
        return None
    possessions = (fga or 0) - (oreb or 0) + (tov or 0) + 0.44 * (fta or 0)
    if possessions <= 0:
        return None
    # total_minutes is sum of all player minutes; divide by 5 for team minutes
    team_minutes = total_minutes / 5.0
    if team_minutes <= 0:
        return None
    return round((possessions * 48.0) / team_minutes, 2)


def populate_team_game_logs(conn):
    log.info('=' * 60)
    log.info('PHASE 1: team_game_logs — aggregating from player_game_logs')

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(AGGREGATE_SQL)
        rows = cur.fetchall()

    log.info(f'  {len(rows)} team-game aggregates found')

    # Build a lookup: (team_abbr, game_id) → points_scored
    # so we can fill points_allowed for each row
    pts_by_team_game: dict[tuple[str, str], float] = {}
    for r in rows:
        key = (r['team'], str(r['game_id']))
        pts_by_team_game[key] = float(r['points_scored'] or 0)

    written = 0
    skipped = 0

    for r in rows:
        abbr = r['team']
        team_id = TEAM_ABBR_TO_ID.get(abbr)
        if not team_id:
            skipped += 1
            continue

        # Points allowed = opponent team's points scored in same game
        opp_abbr = r['opponent']
        opp_pts  = pts_by_team_game.get((opp_abbr, str(r['game_id'])))

        pace = estimate_pace(
            fga=float(r['fga'] or 0),
            oreb=float(r['oreb_raw'] or 0),
            tov=float(r['tov'] or 0),
            fta=float(r['fta'] or 0),
            total_minutes=float(r['total_minutes'] or 0),
        )

        # Rebound percentages
        total_reb = float(r['rebounds'] or 0)
        oreb_count = float(r['oreb'] or 0)
        dreb_count = float(r['dreb'] or 0)
        oreb_pct = round(oreb_count / total_reb, 4) if total_reb > 0 else None
        dreb_pct = round(dreb_count / total_reb, 4) if total_reb > 0 else None

        record = {
            'team_id':       team_id,
            'team_name':     FULL_NAMES.get(abbr, abbr),
            'season':        r['season'],
            'game_date':     r['game_date'],
            'game_id':       str(r['game_id']),
            'opponent':      opp_abbr,
            'home_away':     r['home_away'],
            'points_scored': float(r['points_scored'] or 0),
            'points_allowed': opp_pts,
            'fg_pct':        float(r['fg_pct'])    if r['fg_pct']    else None,
            'three_pct':     float(r['three_pct']) if r['three_pct'] else None,
            'ft_pct':        float(r['ft_pct'])    if r['ft_pct']    else None,
            'rebounds':      float(r['rebounds'] or 0),
            'assists':       float(r['assists']  or 0),
            'turnovers':     float(r['turnovers'] or 0),
            'steals':        float(r['steals']   or 0),
            'blocks':        float(r['blocks']   or 0),
            'oreb_pct':      oreb_pct,
            'dreb_pct':      dreb_pct,
            'pace':          pace,
        }

        try:
            with conn.cursor() as cur:
                cur.execute(UPSERT_TEAM_LOG, record)
            conn.commit()
            written += 1
        except Exception as exc:
            conn.rollback()
            log.error(f'  Write error ({abbr}, {r["game_date"]}): {exc}')
            skipped += 1

        if written % 200 == 0 and written > 0:
            log.info(f'  Progress: {written} rows written')

    log.info(f'Phase 1 complete — {written} rows written, {skipped} skipped')
    return written


# ── Phase 2: team_situation_splits ────────────────────────────────────────────

SITUATION_SQL = """
WITH game_results AS (
    SELECT
        tgl.team_id,
        tgl.team_name,
        tgl.season,
        tgl.game_date,
        tgl.home_away,
        tgl.points_scored,
        tgl.points_allowed,
        CASE WHEN tgl.points_scored > tgl.points_allowed THEN 1 ELSE 0 END AS win,
        -- Rest days: days since previous game for this team
        COALESCE(
            tgl.game_date - LAG(tgl.game_date) OVER (
                PARTITION BY tgl.team_id ORDER BY tgl.game_date
            ),
            2  -- default 2 rest days if no prior game
        ) AS rest_days
    FROM team_game_logs tgl
    WHERE tgl.points_allowed IS NOT NULL
      AND tgl.sport = 'NBA'
)
SELECT
    team_id,
    team_name,
    season,
    split_type,
    split_value,
    COUNT(*)                                       AS games,
    SUM(win)                                       AS wins,
    ROUND(AVG(win)::numeric, 4)                    AS win_pct,
    ROUND(AVG(points_scored)::numeric, 2)          AS avg_pts_scored,
    ROUND(AVG(points_allowed)::numeric, 2)         AS avg_pts_allowed
FROM (
    -- Home vs Away
    SELECT team_id, team_name, season, game_date,
           'location'     AS split_type,
           home_away      AS split_value,
           win, points_scored, points_allowed
    FROM game_results

    UNION ALL

    -- Rest day buckets
    SELECT team_id, team_name, season, game_date,
           'rest_days'                   AS split_type,
           CASE
               WHEN rest_days = 0 THEN 'b2b'
               WHEN rest_days = 1 THEN 'rest_1'
               ELSE                    'rest_2plus'
           END                          AS split_value,
           win, points_scored, points_allowed
    FROM game_results
) splits
GROUP BY team_id, team_name, season, split_type, split_value
HAVING COUNT(*) >= 3
ORDER BY team_name, split_type, split_value
"""

UPSERT_SPLIT = """
INSERT INTO team_situation_splits (
    team_id, team_name, sport, season, split_type,
    games, wins, win_pct, pts_scored, pts_allowed,
    updated_at
) VALUES (
    %(team_id)s, %(team_name)s, 'NBA', %(season)s, %(split_type)s,
    %(games)s, %(wins)s, %(win_pct)s, %(pts_scored)s, %(pts_allowed)s,
    NOW()
)
ON CONFLICT (team_id, season, split_type) DO UPDATE SET
    games       = EXCLUDED.games,
    wins        = EXCLUDED.wins,
    win_pct     = EXCLUDED.win_pct,
    pts_scored  = EXCLUDED.pts_scored,
    pts_allowed = EXCLUDED.pts_allowed,
    updated_at  = NOW()
"""


def populate_team_situation_splits(conn):
    log.info('=' * 60)
    log.info('PHASE 2: team_situation_splits — computed from team_game_logs')

    # team_situation_splits schema uses different column names — check and adapt
    # The schema has: pts_scored, pts_allowed (not avg_pts_*)
    # And split_value TEXT in UNIQUE (team_id, season, split_type) — note: no split_value in unique!
    # We store one row per (team_id, season, split_type) — this means only ONE split_value per type.
    # Since we want multiple (home, away, b2b, rest_1, rest_2plus) we need to include split_value in key.
    # Let's check the real schema constraint first.

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(SITUATION_SQL)
        rows = cur.fetchall()

    log.info(f'  {len(rows)} split rows calculated')

    # Check if split_value column needs to be part of the upsert key
    # The schema has UNIQUE (team_id, season, split_type) — this only allows 1 row per team/season/split_type
    # We need to include split_value in the unique key or use a different approach.
    # For now, use a composite split_type that includes the value: "location_home", "rest_days_b2b", etc.

    written = 0
    for r in rows:
        # Schema uses split_type as the full key: 'home', 'away', 'rest_0', 'rest_1', 'rest_2plus'
        # Map our computed values to the schema's expected split_type names
        split_val = r['split_value']
        split_type_map = {
            ('location', 'home'):     'home',
            ('location', 'away'):     'away',
            ('rest_days', 'b2b'):     'rest_0',
            ('rest_days', 'rest_1'):  'rest_1',
            ('rest_days', 'rest_2plus'): 'rest_2',
        }
        split_type = split_type_map.get((r['split_type'], split_val), f"{r['split_type']}_{split_val}")

        record = {
            'team_id':    r['team_id'],
            'team_name':  r['team_name'],
            'season':     r['season'],
            'split_type': split_type,
            'games':      int(r['games']),
            'wins':       int(r['wins']),
            'win_pct':    float(r['win_pct']),
            'pts_scored': float(r['avg_pts_scored']),
            'pts_allowed': float(r['avg_pts_allowed']),
        }
        try:
            with conn.cursor() as cur:
                cur.execute(UPSERT_SPLIT, record)
            conn.commit()
            written += 1
        except Exception as exc:
            conn.rollback()
            log.error(f'  Split write error ({r["team_name"]}, {composite_type}): {exc}')

    log.info(f'Phase 2 complete — {written} split rows written')
    return written


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    if not DATABASE_URL:
        log.error('DATABASE_URL env var not set — aborting')
        sys.exit(1)

    log.info('╔══════════════════════════════════════════════════════╗')
    log.info('║  Chalk Team Data Populator                            ║')
    log.info('╚══════════════════════════════════════════════════════╝')

    conn = get_db()
    log.info('Database connection established')

    try:
        tgl_count = populate_team_game_logs(conn)
        log.info(f'team_game_logs: {tgl_count} rows')

        if tgl_count > 0:
            splits_count = populate_team_situation_splits(conn)
            log.info(f'team_situation_splits: {splits_count} rows')
        else:
            log.warning('Skipping situation splits — no team game logs written')

    except Exception as exc:
        log.exception(f'Unhandled error: {exc}')
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()

    log.info('╔══════════════════════════════════════════════════════╗')
    log.info('║  Done                                                 ║')
    log.info('╚══════════════════════════════════════════════════════╝')


if __name__ == '__main__':
    main()
