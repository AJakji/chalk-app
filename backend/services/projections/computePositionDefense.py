"""
computePositionDefense.py
=========================
Runs at 1:00 AM nightly after computeDerivedStats.py.

Computes position_defense_ratings from player_game_logs.
No API calls. Reads what players have actually scored against each team.

Handles NBA and NHL.

NBA writes two sets of rows:
  position='ALL'   — aggregate (always written, used as fallback)
  position='PG/SG/SF/PF/C' — per-position splits (written when position
                               column is populated in player_game_logs)

NHL writes:
  position='ALL'   — aggregate goals + assists allowed per team
  position='C','L','R','D' — per forward/defense position (when populated)
  position='G'     — goalie goals-against per team (GAA proxy)
"""
from __future__ import annotations
import os, sys, logging
from dotenv import load_dotenv
import psycopg2, psycopg2.extras

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))
logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', handlers=[logging.StreamHandler()])
log = logging.getLogger(__name__)

DATABASE_URL    = os.getenv('DATABASE_URL', '')
CURRENT_SEASON  = '2025-26'
NHL_SEASON_DATE = '2025-10-01'   # start of current NHL season

# NBA team abbreviation → integer team_id (30 NBA teams)
TEAM_ABBR_TO_ID = {
    'ATL':  1, 'BOS':  2, 'BKN':  3, 'CHA':  4, 'CHI':  5,
    'CLE':  6, 'DAL':  7, 'DEN':  8, 'DET':  9, 'GSW': 10,
    'HOU': 11, 'IND': 12, 'LAC': 13, 'LAL': 14, 'MEM': 15,
    'MIA': 16, 'MIL': 17, 'MIN': 18, 'NOP': 19, 'NYK': 20,
    'OKC': 21, 'ORL': 22, 'PHI': 23, 'PHX': 24, 'POR': 25,
    'SAC': 26, 'SAS': 27, 'TOR': 28, 'UTA': 29, 'WAS': 30,
}

# NHL team abbreviation → integer team_id (32 NHL teams)
NHL_TEAM_ABBR_TO_ID = {
    'ANA': 101, 'ARI': 102, 'UTA': 102, 'BOS': 103, 'BUF': 104, 'CGY': 105,
    'CAR': 106, 'CHI': 107, 'COL': 108, 'CBJ': 109, 'DAL': 110,
    'DET': 111, 'EDM': 112, 'FLA': 113, 'LAK': 114, 'MIN': 115,
    'MTL': 116, 'NSH': 117, 'NJD': 118, 'NYI': 119, 'NYR': 120,
    'OTT': 121, 'PHI': 122, 'PIT': 123, 'STL': 124, 'SJS': 125,
    'SEA': 126, 'TBL': 127, 'TOR': 128, 'VAN': 129, 'VGK': 130,
    'WSH': 131, 'WPG': 132,
}

# Team-level defensive stats aggregated from player game logs.
# SUM(stat) / COUNT(DISTINCT game_date) gives team totals per game.
# Only games where the team actually played (minutes > 5, last 30 games = ~1 month).
AGGREGATE_SQL = """
SELECT
    opponent                                                          AS team_abbr,
    'ALL'                                                             AS position,
    ROUND((SUM(points)     / COUNT(DISTINCT game_date))::numeric, 3) AS pts_allowed,
    ROUND((SUM(rebounds)   / COUNT(DISTINCT game_date))::numeric, 3) AS reb_allowed,
    ROUND((SUM(assists)    / COUNT(DISTINCT game_date))::numeric, 3) AS ast_allowed,
    ROUND((SUM(three_made) / COUNT(DISTINCT game_date))::numeric, 3) AS three_allowed,
    CASE WHEN SUM(fg_att) > 0
         THEN ROUND((SUM(fg_made) / SUM(fg_att))::numeric, 4)
         ELSE NULL END                                                AS fg_pct_allowed,
    COUNT(DISTINCT game_date)                                         AS sample_games
FROM player_game_logs
WHERE sport    = 'NBA'
  AND season   = %s
  AND minutes  > 5
  AND opponent IS NOT NULL
  AND opponent != ''
GROUP BY opponent
HAVING COUNT(DISTINCT game_date) >= 5
ORDER BY pts_allowed DESC
"""

# Per-position split — only runs when position column is populated.
POSITION_SQL = """
SELECT
    opponent                                                          AS team_abbr,
    position,
    ROUND((SUM(points)     / COUNT(DISTINCT game_date))::numeric, 3) AS pts_allowed,
    ROUND((SUM(rebounds)   / COUNT(DISTINCT game_date))::numeric, 3) AS reb_allowed,
    ROUND((SUM(assists)    / COUNT(DISTINCT game_date))::numeric, 3) AS ast_allowed,
    ROUND((SUM(three_made) / COUNT(DISTINCT game_date))::numeric, 3) AS three_allowed,
    CASE WHEN SUM(fg_att) > 0
         THEN ROUND((SUM(fg_made) / SUM(fg_att))::numeric, 4)
         ELSE NULL END                                                AS fg_pct_allowed,
    COUNT(DISTINCT game_date)                                         AS sample_games
FROM player_game_logs
WHERE sport    = 'NBA'
  AND season   = %s
  AND minutes  > 5
  AND opponent IS NOT NULL
  AND opponent != ''
  AND position IS NOT NULL
  AND position IN ('PG','SG','SF','PF','C','G','F')
GROUP BY opponent, position
HAVING COUNT(DISTINCT game_date) >= 5
ORDER BY opponent, position
"""

UPSERT_SQL = """
INSERT INTO position_defense_ratings
    (team_id, team_name, sport, season, position,
     pts_allowed, reb_allowed, ast_allowed, three_allowed, fg_pct_allowed,
     updated_at)
VALUES
    (%(team_id)s, %(team_name)s, %(sport)s, %(season)s, %(position)s,
     %(pts_allowed)s, %(reb_allowed)s, %(ast_allowed)s, %(three_allowed)s, %(fg_pct_allowed)s,
     NOW())
ON CONFLICT (team_id, season, position) DO UPDATE SET
    pts_allowed    = EXCLUDED.pts_allowed,
    reb_allowed    = EXCLUDED.reb_allowed,
    ast_allowed    = EXCLUDED.ast_allowed,
    three_allowed  = EXCLUDED.three_allowed,
    fg_pct_allowed = EXCLUDED.fg_pct_allowed,
    team_name      = EXCLUDED.team_name,
    updated_at     = NOW()
"""

# ── NHL position defense queries ──────────────────────────────────────────────
# NHL column mapping in player_game_logs:
#   points    = goals
#   three_made = assists
#   fg_made   = shots on goal
#   minutes   = TOI
#   steals/blocks/fg_pct = goalie-only columns
#
# We compute "goals allowed" (points) and "assists allowed" (three_made) per team
# for skaters (minutes > 5), and "goals_against" (blocks) for goalies (minutes > 30).

NHL_AGGREGATE_SQL = """
SELECT
    opponent                                                                AS team_abbr,
    'ALL'                                                                   AS position,
    ROUND((SUM(points)     / NULLIF(COUNT(DISTINCT game_date), 0))::numeric, 3) AS pts_allowed,
    ROUND((SUM(three_made) / NULLIF(COUNT(DISTINCT game_date), 0))::numeric, 3) AS reb_allowed,
    ROUND((SUM(fg_made)    / NULLIF(COUNT(DISTINCT game_date), 0))::numeric, 3) AS ast_allowed,
    NULL::numeric                                                           AS three_allowed,
    NULL::numeric                                                           AS fg_pct_allowed,
    COUNT(DISTINCT game_date)                                               AS sample_games
FROM player_game_logs
WHERE sport    = 'NHL'
  AND game_date >= %s
  AND minutes   > 5
  AND opponent  IS NOT NULL
  AND opponent  != ''
  AND points    IS NOT NULL
GROUP BY opponent
HAVING COUNT(DISTINCT game_date) >= 10
ORDER BY pts_allowed DESC
"""

# Per-position NHL: C / L / R / D (skaters, position column populated by nhlDataCollector)
NHL_POSITION_SQL = """
SELECT
    opponent                                                                AS team_abbr,
    CASE position
        WHEN 'C'  THEN 'C'
        WHEN 'L'  THEN 'LW'
        WHEN 'LW' THEN 'LW'
        WHEN 'R'  THEN 'RW'
        WHEN 'RW' THEN 'RW'
        WHEN 'D'  THEN 'D'
        ELSE position
    END                                                                     AS position,
    ROUND((SUM(points)     / NULLIF(COUNT(DISTINCT game_date), 0))::numeric, 3) AS pts_allowed,
    ROUND((SUM(three_made) / NULLIF(COUNT(DISTINCT game_date), 0))::numeric, 3) AS reb_allowed,
    ROUND((SUM(fg_made)    / NULLIF(COUNT(DISTINCT game_date), 0))::numeric, 3) AS ast_allowed,
    NULL::numeric                                                           AS three_allowed,
    NULL::numeric                                                           AS fg_pct_allowed,
    COUNT(DISTINCT game_date)                                               AS sample_games
FROM player_game_logs
WHERE sport    = 'NHL'
  AND game_date >= %s
  AND minutes   > 5
  AND opponent  IS NOT NULL
  AND opponent  != ''
  AND points    IS NOT NULL
  AND position  IN ('C', 'L', 'LW', 'R', 'RW', 'D')
GROUP BY opponent, CASE position
    WHEN 'C'  THEN 'C'
    WHEN 'L'  THEN 'LW'
    WHEN 'LW' THEN 'LW'
    WHEN 'R'  THEN 'RW'
    WHEN 'RW' THEN 'RW'
    WHEN 'D'  THEN 'D'
    ELSE position
END
HAVING COUNT(DISTINCT game_date) >= 5
ORDER BY opponent, CASE position
    WHEN 'C'  THEN 'C'
    WHEN 'L'  THEN 'LW'
    WHEN 'LW' THEN 'LW'
    WHEN 'R'  THEN 'RW'
    WHEN 'RW' THEN 'RW'
    WHEN 'D'  THEN 'D'
    ELSE position
END
"""

# Goalie position: average goals_against per game faced per opposing team
NHL_GOALIE_SQL = """
SELECT
    opponent                                                                AS team_abbr,
    'G'                                                                     AS position,
    ROUND((SUM(blocks) / NULLIF(COUNT(DISTINCT game_date), 0))::numeric, 3) AS pts_allowed,
    NULL::numeric                                                           AS reb_allowed,
    NULL::numeric                                                           AS ast_allowed,
    NULL::numeric                                                           AS three_allowed,
    ROUND((AVG(fg_pct))::numeric, 3)                                       AS fg_pct_allowed,
    COUNT(DISTINCT game_date)                                               AS sample_games
FROM player_game_logs
WHERE sport    = 'NHL'
  AND game_date >= %s
  AND minutes   > 30
  AND opponent  IS NOT NULL
  AND blocks    IS NOT NULL
GROUP BY opponent
HAVING COUNT(DISTINCT game_date) >= 5
ORDER BY pts_allowed DESC
"""


def main():
    if not DATABASE_URL:
        log.error('DATABASE_URL not set'); sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    def run_batch(cur, sql, label):
        cur.execute(sql, (CURRENT_SEASON,))
        rows = cur.fetchall()
        log.info(f'{label}: {len(rows)} rows found')
        return rows

    def upsert_rows(rows, label, abbr_map=None, sport='NBA'):
        if abbr_map is None:
            abbr_map = TEAM_ABBR_TO_ID
        written = 0
        skipped = 0
        for r in rows:
            abbr    = r['team_abbr']
            team_id = abbr_map.get(abbr)
            if not team_id:
                log.warning(f'  {label} — unknown abbr: {abbr} — skipped')
                skipped += 1
                continue
            record = {
                'team_id':        team_id,
                'team_name':      abbr,
                'sport':          sport,
                'season':         CURRENT_SEASON,
                'position':       r['position'],
                'pts_allowed':    float(r['pts_allowed']) if r['pts_allowed'] is not None else None,
                'reb_allowed':    float(r['reb_allowed']) if r['reb_allowed'] is not None else None,
                'ast_allowed':    float(r['ast_allowed']) if r['ast_allowed'] is not None else None,
                'three_allowed':  float(r['three_allowed']) if r['three_allowed'] is not None else None,
                'fg_pct_allowed': float(r['fg_pct_allowed']) if r['fg_pct_allowed'] is not None else None,
            }
            with conn.cursor() as wc:
                wc.execute(UPSERT_SQL, record)
            conn.commit()
            written += 1
        log.info(f'  {label}: {written} written, {skipped} skipped')
        return written

    def run_nhl_batch(cur, sql, label):
        cur.execute(sql, (NHL_SEASON_DATE,))
        rows = cur.fetchall()
        log.info(f'{label}: {len(rows)} rows found')
        return rows

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Pass 1 — aggregate ALL rows (always)
            all_rows = run_batch(cur, AGGREGATE_SQL, 'Aggregate ALL')

        upsert_rows(all_rows, 'ALL', sport='NBA')

        # Pass 2 — per-position rows (only when position column is populated)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            pos_rows = run_batch(cur, POSITION_SQL, 'Per-position')

        if pos_rows:
            upsert_rows(pos_rows, 'position-specific', sport='NBA')
        else:
            log.info('  No position data in player_game_logs — per-position splits skipped')

        # Pass 3 — NHL aggregate ALL
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            nhl_all_rows = run_nhl_batch(cur, NHL_AGGREGATE_SQL, 'NHL Aggregate ALL')

        upsert_rows(nhl_all_rows, 'NHL ALL', abbr_map=NHL_TEAM_ABBR_TO_ID, sport='NHL')

        # Pass 4 — NHL per-position (C / LW / RW / D)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            nhl_pos_rows = run_nhl_batch(cur, NHL_POSITION_SQL, 'NHL Per-position')

        if nhl_pos_rows:
            upsert_rows(nhl_pos_rows, 'NHL position-specific', abbr_map=NHL_TEAM_ABBR_TO_ID, sport='NHL')
        else:
            log.info('  No NHL position data — per-position splits skipped')

        # Pass 5 — NHL goalies
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            nhl_goalie_rows = run_nhl_batch(cur, NHL_GOALIE_SQL, 'NHL Goalies')

        if nhl_goalie_rows:
            upsert_rows(nhl_goalie_rows, 'NHL goalies', abbr_map=NHL_TEAM_ABBR_TO_ID, sport='NHL')
        else:
            log.info('  No NHL goalie data found')

        log.info(f'Done')

    except Exception as exc:
        conn.rollback()
        log.exception(f'Error: {exc}')
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
