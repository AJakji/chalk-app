#!/usr/bin/env python3
"""
computeLeagueAverages.py — Computes rolling 30-day league averages and
stores them in the league_averages table.

Run schedule: Every Monday at 3:00 AM ET (after Statcast collector).

Why this matters:
  All three projection models have LEAGUE_AVG dicts with 2024-25 hardcoded
  constants. If the 2025-26 season plays at a different pace, scoring rate,
  or SV%, every relative factor drifts. This script recomputes the baselines
  from actual game log data and stores them in the DB. Each model reads from
  the DB at startup and updates its in-memory LEAGUE_AVG, falling back to
  hardcoded values if the DB is empty.

Stats computed:
  NBA:  pts, reb, ast, stl, blk, threes, ts_pct, pace, fg_pct, three_rate
  MLB:  ba, obp, era, game_total, k_per_9, bb_per_9, hr_per_9
  NHL:  sv_pct, goals_pg, sog_pg, save_pct
"""

import os
import sys
import psycopg2
import psycopg2.extras
from datetime import date, timedelta

DATABASE_URL = os.environ.get('DATABASE_URL')
LOOKBACK_DAYS = 30


def run_query(conn, sql: str, params: tuple = ()) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def upsert_avg(cur, sport: str, stat_name: str, value, today: date):
    if value is None:
        return
    try:
        cur.execute("""
            INSERT INTO league_averages (sport, stat_name, stat_value, computed_date)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (sport, stat_name, computed_date) DO UPDATE
              SET stat_value = EXCLUDED.stat_value
        """, (sport, stat_name, float(value), today))
    except Exception as e:
        print(f'  [WARN] Could not upsert {sport}/{stat_name}: {e}')


def safe_float(val, default=None):
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def compute_nba(conn, cur, since: date, today: date):
    print('\n  ── NBA ──')

    rows = run_query(conn, """
        SELECT
          AVG(points)    AS pts,
          AVG(rebounds)  AS reb,
          AVG(assists)   AS ast,
          AVG(steals)    AS stl,
          AVG(blocks)    AS blk,
          AVG(three_made) AS threes,
          AVG(turnovers)  AS tov,
          AVG(minutes)    AS min_pg
        FROM player_game_logs
        WHERE sport = 'NBA'
          AND game_date >= %s
          AND minutes > 10
    """, (since,))

    if rows and rows[0]['pts']:
        r = rows[0]
        upsert_avg(cur, 'NBA', 'pts',     r['pts'],    today)
        upsert_avg(cur, 'NBA', 'reb',     r['reb'],    today)
        upsert_avg(cur, 'NBA', 'ast',     r['ast'],    today)
        upsert_avg(cur, 'NBA', 'stl',     r['stl'],    today)
        upsert_avg(cur, 'NBA', 'blk',     r['blk'],    today)
        upsert_avg(cur, 'NBA', 'threes',  r['threes'], today)
        upsert_avg(cur, 'NBA', 'tov',     r['tov'],    today)
        print(f'    pts={r["pts"]:.1f}  reb={r["reb"]:.1f}  ast={r["ast"]:.1f}  3pm={r["threes"]:.1f}')

    # Pace from team_game_logs
    pace_rows = run_query(conn, """
        SELECT AVG(pace) AS pace FROM team_game_logs
        WHERE sport = 'NBA' AND game_date >= %s AND pace IS NOT NULL
    """, (since,))
    if pace_rows and pace_rows[0]['pace']:
        upsert_avg(cur, 'NBA', 'pace', pace_rows[0]['pace'], today)
        print(f'    pace={pace_rows[0]["pace"]:.1f}')

    # True shooting %: pts / (2*(fga+0.44*fta))
    ts_rows = run_query(conn, """
        SELECT AVG(ts) AS ts_pct FROM (
          SELECT points / NULLIF(2.0 * (fg_att + 0.44 * ft_att), 0) AS ts
          FROM player_game_logs
          WHERE sport = 'NBA' AND game_date >= %s
            AND points > 0 AND fg_att > 0
        ) sub
    """, (since,))
    if ts_rows and ts_rows[0]['ts_pct']:
        upsert_avg(cur, 'NBA', 'ts_pct', ts_rows[0]['ts_pct'], today)

    # FG%
    fg_rows = run_query(conn, """
        SELECT AVG(fg_pct) AS fg_pct FROM player_game_logs
        WHERE sport = 'NBA' AND game_date >= %s AND fg_pct IS NOT NULL AND fg_pct > 0
    """, (since,))
    if fg_rows and fg_rows[0]['fg_pct']:
        upsert_avg(cur, 'NBA', 'fg_pct', fg_rows[0]['fg_pct'], today)

    print('    NBA averages written')


def compute_mlb(conn, cur, since: date, today: date):
    print('\n  ── MLB ──')

    # Pitcher stats
    rows = run_query(conn, """
        SELECT
          AVG(offensive_rating) AS era_proxy,
          AVG(fg_made)          AS k_per_9,
          AVG(three_made)       AS bb_per_9,
          AVG(three_att)        AS hr_per_9,
          AVG(true_shooting_pct) AS whip
        FROM player_game_logs
        WHERE sport = 'MLB' AND game_date >= %s
          AND minutes >= 3
          AND position IN ('SP','RP','P','1','10','11','12')
    """, (since,))

    if rows and rows[0]['era_proxy'] is not None:
        r = rows[0]
        upsert_avg(cur, 'MLB', 'era',       r['era_proxy'], today)
        upsert_avg(cur, 'MLB', 'k_per_9',   r['k_per_9'],   today)
        upsert_avg(cur, 'MLB', 'bb_per_9',  r['bb_per_9'],  today)
        upsert_avg(cur, 'MLB', 'hr_per_9',  r['hr_per_9'],  today)
        upsert_avg(cur, 'MLB', 'whip',      r['whip'],      today)
        print(f'    era={r["era_proxy"]:.2f}  k9={r["k_per_9"]:.1f}  bb9={r["bb_per_9"]:.1f}')

    # Batter stats: BA proxy from fg_pct (BA stored as fg_pct in MLB mappings)
    bat_rows = run_query(conn, """
        SELECT
          AVG(fg_pct)    AS ba,
          AVG(points)    AS hits_per_game,
          AVG(rebounds)  AS rbi_per_game,
          AVG(assists)   AS runs_per_game,
          AVG(fg_made)   AS hr_per_game
        FROM player_game_logs
        WHERE sport = 'MLB' AND game_date >= %s
          AND position NOT IN ('SP','RP','P','1','10','11','12')
          AND minutes >= 1
    """, (since,))

    if bat_rows and bat_rows[0]['ba'] is not None:
        r = bat_rows[0]
        upsert_avg(cur, 'MLB', 'ba',           r['ba'],           today)
        upsert_avg(cur, 'MLB', 'hits_per_game', r['hits_per_game'], today)
        upsert_avg(cur, 'MLB', 'rbi_per_game',  r['rbi_per_game'],  today)
        upsert_avg(cur, 'MLB', 'hr_per_game',   r['hr_per_game'],   today)
        print(f'    ba={r["ba"]:.3f}  rbi/g={r["rbi_per_game"]:.2f}  hr/g={r["hr_per_game"]:.3f}')

    # Game totals from team_game_logs
    total_rows = run_query(conn, """
        SELECT AVG(points_scored + points_allowed) AS game_total
        FROM team_game_logs
        WHERE sport = 'MLB' AND game_date >= %s
          AND points_scored IS NOT NULL
          AND points_allowed IS NOT NULL
    """, (since,))
    if total_rows and total_rows[0]['game_total']:
        upsert_avg(cur, 'MLB', 'game_total', total_rows[0]['game_total'], today)
        print(f'    game_total={total_rows[0]["game_total"]:.1f}')

    print('    MLB averages written')


def compute_nhl(conn, cur, since: date, today: date):
    print('\n  ── NHL ──')

    # Skater stats
    skater_rows = run_query(conn, """
        SELECT
          AVG(points)    AS goals_pg,
          AVG(assists)   AS points_pg,
          AVG(fg_made)   AS sog_pg,
          AVG(minutes)   AS toi_pg
        FROM player_game_logs
        WHERE sport = 'NHL' AND game_date >= %s
          AND position NOT IN ('G', 'G ')
          AND minutes >= 8
    """, (since,))

    if skater_rows and skater_rows[0]['goals_pg'] is not None:
        r = skater_rows[0]
        upsert_avg(cur, 'NHL', 'goals_pg',  r['goals_pg'],  today)
        upsert_avg(cur, 'NHL', 'points_pg', r['points_pg'], today)
        upsert_avg(cur, 'NHL', 'sog_pg',    r['sog_pg'],    today)
        upsert_avg(cur, 'NHL', 'toi_pg',    r['toi_pg'],    today)
        print(f'    goals/g={r["goals_pg"]:.2f}  sog/g={r["sog_pg"]:.1f}')

    # Goalie SV%
    goalie_rows = run_query(conn, """
        SELECT AVG(fg_pct) AS sv_pct
        FROM player_game_logs
        WHERE sport = 'NHL' AND game_date >= %s
          AND position IN ('G', 'G ')
          AND fg_pct IS NOT NULL AND fg_pct > 0.800
    """, (since,))

    if goalie_rows and goalie_rows[0]['sv_pct'] is not None:
        upsert_avg(cur, 'NHL', 'sv_pct', goalie_rows[0]['sv_pct'], today)
        print(f'    sv_pct={goalie_rows[0]["sv_pct"]:.4f}')

    # Team goals per game
    team_rows = run_query(conn, """
        SELECT AVG(points_scored) AS goals_pg_team
        FROM team_game_logs
        WHERE sport = 'NHL' AND game_date >= %s
          AND points_scored IS NOT NULL
    """, (since,))
    if team_rows and team_rows[0]['goals_pg_team'] is not None:
        upsert_avg(cur, 'NHL', 'goals_pg_team', team_rows[0]['goals_pg_team'], today)
        print(f'    team_goals/g={team_rows[0]["goals_pg_team"]:.2f}')

    print('    NHL averages written')


def run():
    today = date.today()
    since = today - timedelta(days=LOOKBACK_DAYS)
    print(f'[computeLeagueAverages] {today}  (lookback: {since} → {today})')

    if not DATABASE_URL:
        print('[ERROR] DATABASE_URL not set')
        sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    cur  = conn.cursor()

    try:
        compute_nba(conn, cur, since, today)
        compute_mlb(conn, cur, since, today)
        compute_nhl(conn, cur, since, today)
        conn.commit()
        print('\n[computeLeagueAverages] Done — all averages written to league_averages')
    except Exception as e:
        conn.rollback()
        print(f'[ERROR] {e}')
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    run()
