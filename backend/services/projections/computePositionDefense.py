"""
computePositionDefense.py
=========================
Runs at 1:00 AM nightly after computeDerivedStats.py.

Computes position_defense_ratings from player_game_logs.
No API calls. Reads what players have actually scored against each team.

Writes two sets of rows:
  position='ALL'   — aggregate (always written, used as fallback)
  position='PG/SG/SF/PF/C' — per-position splits (written when position
                               column is populated in player_game_logs)
"""
from __future__ import annotations
import os, sys, logging
from dotenv import load_dotenv
import psycopg2, psycopg2.extras

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))
logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', handlers=[logging.StreamHandler()])
log = logging.getLogger(__name__)

DATABASE_URL   = os.getenv('DATABASE_URL', '')
CURRENT_SEASON = '2025-26'

TEAM_ABBR_TO_ID = {
    'ATL':  1, 'BOS':  2, 'BKN':  3, 'CHA':  4, 'CHI':  5,
    'CLE':  6, 'DAL':  7, 'DEN':  8, 'DET':  9, 'GSW': 10,
    'HOU': 11, 'IND': 12, 'LAC': 13, 'LAL': 14, 'MEM': 15,
    'MIA': 16, 'MIL': 17, 'MIN': 18, 'NOP': 19, 'NYK': 20,
    'OKC': 21, 'ORL': 22, 'PHI': 23, 'PHX': 24, 'POR': 25,
    'SAC': 26, 'SAS': 27, 'TOR': 28, 'UTA': 29, 'WAS': 30,
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
    (%(team_id)s, %(team_name)s, 'NBA', %(season)s, %(position)s,
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

    def upsert_rows(rows, label):
        written = 0
        skipped = 0
        for r in rows:
            abbr    = r['team_abbr']
            team_id = TEAM_ABBR_TO_ID.get(abbr)
            if not team_id:
                log.warning(f'  {label} — unknown abbr: {abbr} — skipped')
                skipped += 1
                continue
            record = {
                'team_id':        team_id,
                'team_name':      abbr,
                'season':         CURRENT_SEASON,
                'position':       r['position'],
                'pts_allowed':    float(r['pts_allowed']),
                'reb_allowed':    float(r['reb_allowed']),
                'ast_allowed':    float(r['ast_allowed']),
                'three_allowed':  float(r['three_allowed']),
                'fg_pct_allowed': float(r['fg_pct_allowed']) if r['fg_pct_allowed'] else None,
            }
            with conn.cursor() as wc:
                wc.execute(UPSERT_SQL, record)
            conn.commit()
            written += 1
        log.info(f'  {label}: {written} written, {skipped} skipped')
        return written

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Pass 1 — aggregate ALL rows (always)
            all_rows = run_batch(cur, AGGREGATE_SQL, 'Aggregate ALL')

        upsert_rows(all_rows, 'ALL')

        # Pass 2 — per-position rows (only when position column is populated)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            pos_rows = run_batch(cur, POSITION_SQL, 'Per-position')

        if pos_rows:
            upsert_rows(pos_rows, 'position-specific')
        else:
            log.info('  No position data in player_game_logs — per-position splits skipped')

        log.info(f'Done')

    except Exception as exc:
        conn.rollback()
        log.exception(f'Error: {exc}')
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
