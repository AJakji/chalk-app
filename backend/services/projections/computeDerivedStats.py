"""
computeDerivedStats.py
======================
Runs at 12:30 AM nightly after nbaDataCollector.py.

Fills in derived stat columns in player_game_logs that can be computed
from the raw box score data already stored. No API calls needed.

Columns populated:
  true_shooting_pct = pts / (2 × (fga + 0.44 × fta))
  usage_rate        = (fga + 0.44×fta + tov) / minutes   (per-minute proxy)
  pace              = fga - off_reb + tov + (0.44 × fta)  (per-game possessions)

The projection model computes these on-the-fly during runs, but storing them
here means the data is available for analytics, auditing, and future queries.
"""
from __future__ import annotations
import os, sys, logging
from dotenv import load_dotenv
import psycopg2

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))
logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', handlers=[logging.StreamHandler()])
log = logging.getLogger(__name__)

DATABASE_URL = os.getenv('DATABASE_URL', '')


def main():
    if not DATABASE_URL:
        log.error('DATABASE_URL not set'); sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)

    try:
        with conn.cursor() as cur:
            # Count rows needing update
            cur.execute("""
                SELECT COUNT(*) FROM player_game_logs
                WHERE (true_shooting_pct IS NULL OR usage_rate IS NULL OR pace IS NULL)
                  AND minutes > 0 AND fg_att IS NOT NULL AND ft_att IS NOT NULL
            """)
            pending = cur.fetchone()[0]
            log.info(f'Rows needing derived stats: {pending}')

            if pending == 0:
                log.info('All derived stats already populated — nothing to do')
                conn.close()
                return

            # true_shooting_pct
            cur.execute("""
                UPDATE player_game_logs
                SET true_shooting_pct = CASE
                    WHEN (2.0 * (fg_att + 0.44 * ft_att)) > 0
                    THEN ROUND(points / (2.0 * (fg_att + 0.44 * ft_att)), 4)
                    ELSE NULL
                END
                WHERE true_shooting_pct IS NULL
                  AND minutes > 0
                  AND fg_att IS NOT NULL AND ft_att IS NOT NULL
            """)
            ts_updated = cur.rowcount
            log.info(f'  true_shooting_pct updated: {ts_updated} rows')

            # usage_rate — stored as per-minute rate (not traditional %)
            # usage per min = (fga + 0.44*fta + tov) / minutes
            cur.execute("""
                UPDATE player_game_logs
                SET usage_rate = CASE
                    WHEN minutes > 5
                    THEN ROUND((fg_att + 0.44 * ft_att + COALESCE(turnovers, 0)) / minutes, 4)
                    ELSE NULL
                END
                WHERE usage_rate IS NULL
                  AND minutes > 0
                  AND fg_att IS NOT NULL AND ft_att IS NOT NULL
            """)
            usg_updated = cur.rowcount
            log.info(f'  usage_rate updated:        {usg_updated} rows')

            # pace — possessions estimate for this player's game
            # pace = fga - off_reb + tov + (0.44 × fta)
            cur.execute("""
                UPDATE player_game_logs
                SET pace = ROUND(
                    fg_att
                    - COALESCE(off_reb, 0)
                    + COALESCE(turnovers, 0)
                    + (0.44 * ft_att),
                    2
                )
                WHERE pace IS NULL
                  AND minutes > 0
                  AND fg_att IS NOT NULL AND ft_att IS NOT NULL
            """)
            pace_updated = cur.rowcount
            log.info(f'  pace updated:              {pace_updated} rows')

        conn.commit()
        log.info(f'Done — derived stats computed for {pending} rows')

    except Exception as exc:
        conn.rollback()
        log.exception(f'Error: {exc}')
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
