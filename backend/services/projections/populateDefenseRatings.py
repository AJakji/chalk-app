"""
Populate position_defense_ratings from player_game_logs.

Instead of the BallDontLie team_stats endpoint (returns 404 on our plan),
we compute opponent defense strength directly from what players have actually
scored against each team — using the data already in player_game_logs.

Logic:
  For each opponent team, average the stats of all players who faced them
  (minutes > 15, current season). A high pts_allowed means weak defense.
  Position = 'ALL' (aggregate — matches what the projection model reads).

No API calls. Runs in seconds.
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

AGGREGATE_SQL = """
-- Team-level defensive stats: how much each team ALLOWS per game in total.
-- We sum all player stats per game vs each opponent, then average across games.
-- This gives numbers in the same scale as LEAGUE_AVG (pts=112, reb=43.5, ast=24.5).
SELECT
    opponent                                                          AS team_abbr,
    ROUND((SUM(points)      / COUNT(DISTINCT game_date))::numeric, 3) AS pts_allowed,
    ROUND((SUM(rebounds)    / COUNT(DISTINCT game_date))::numeric, 3) AS reb_allowed,
    ROUND((SUM(assists)     / COUNT(DISTINCT game_date))::numeric, 3) AS ast_allowed,
    ROUND((SUM(three_made)  / COUNT(DISTINCT game_date))::numeric, 3) AS three_allowed,
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

UPSERT_SQL = """
INSERT INTO position_defense_ratings
    (team_id, team_name, sport, season, position,
     pts_allowed, reb_allowed, ast_allowed, three_allowed, fg_pct_allowed,
     updated_at)
VALUES
    (%(team_id)s, %(team_name)s, 'NBA', %(season)s, 'ALL',
     %(pts_allowed)s, %(reb_allowed)s, %(ast_allowed)s, %(three_allowed)s, %(fg_pct_allowed)s,
     NOW())
ON CONFLICT (team_id, season, position) DO UPDATE SET
    pts_allowed    = EXCLUDED.pts_allowed,
    reb_allowed    = EXCLUDED.reb_allowed,
    ast_allowed    = EXCLUDED.ast_allowed,
    three_allowed  = EXCLUDED.three_allowed,
    fg_pct_allowed = EXCLUDED.fg_pct_allowed,
    updated_at     = NOW()
"""

def main():
    if not DATABASE_URL:
        log.error('DATABASE_URL not set'); sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(AGGREGATE_SQL, (CURRENT_SEASON,))
            rows = cur.fetchall()

        log.info(f'Computed defense ratings for {len(rows)} teams from player_game_logs')

        written = 0
        for r in rows:
            abbr = r['team_abbr']
            team_id = TEAM_ABBR_TO_ID.get(abbr)
            if not team_id:
                log.warning(f'  Unknown abbreviation: {abbr} — skipped')
                continue

            record = {
                'team_id':       team_id,
                'team_name':     abbr,  # store abbreviation so ILIKE '%BKN%' matches 'BKN'
                'season':        CURRENT_SEASON,
                'pts_allowed':   float(r['pts_allowed']),
                'reb_allowed':   float(r['reb_allowed']),
                'ast_allowed':   float(r['ast_allowed']),
                'three_allowed': float(r['three_allowed']),
                'fg_pct_allowed': float(r['fg_pct_allowed']) if r['fg_pct_allowed'] else None,
            }

            with conn.cursor() as cur:
                cur.execute(UPSERT_SQL, record)
            conn.commit()
            written += 1
            log.info(f'  {FULL_NAMES.get(abbr, abbr)}: {r["pts_allowed"]} pts allowed '
                     f'/ {r["reb_allowed"]} reb / {r["ast_allowed"]} ast '
                     f'({r["sample_games"]} games)')

        log.info(f'Done — {written} teams written to position_defense_ratings')

    except Exception as exc:
        conn.rollback()
        log.exception(f'Error: {exc}')
        sys.exit(1)
    finally:
        conn.close()

if __name__ == '__main__':
    main()
