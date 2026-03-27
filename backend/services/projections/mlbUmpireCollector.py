#!/usr/bin/env python3
"""
mlbUmpireCollector.py — Collects MLB home plate umpire assignments and historical tendencies.
Run daily at 1:15 AM ET after game logs are collected.
"""

import os, sys, time, requests, psycopg2
from datetime import datetime, date, timedelta

DATABASE_URL = os.environ.get('DATABASE_URL')
MLB_BASE = 'https://statsapi.mlb.com/api/v1'

def mlb_get(path, params=None):
    url = f"{MLB_BASE}{path}"
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def get_todays_umpires(target_date):
    """Fetch HP umpire for each game today."""
    data = mlb_get('/schedule', {
        'sportId': 1,
        'date': target_date,
        'hydrate': 'officials,team',
    })
    results = []
    for d in (data.get('dates') or []):
        for g in (d.get('games') or []):
            officials = g.get('officials') or []
            hp = next((o for o in officials if o.get('officialType') == 'Home Plate'), None)
            if hp:
                results.append({
                    'game_pk': g['gamePk'],
                    'game_date': target_date,
                    'home_team_id': g.get('teams', {}).get('home', {}).get('team', {}).get('id'),
                    'away_team_id': g.get('teams', {}).get('away', {}).get('team', {}).get('id'),
                    'hp_umpire_id': hp['official']['id'],
                    'hp_umpire_name': hp['official'].get('fullName', ''),
                })
    return results

def compute_umpire_tendencies(umpire_id, conn):
    """
    Compute umpire tendencies by looking at games where they worked.
    Uses game_umpires table joined to team_game_logs for run data.
    """
    cur = conn.cursor()
    # Get all games this umpire has worked (from our collected data)
    cur.execute("""
        SELECT gu.game_pk, gu.game_date, gu.home_team_id, gu.away_team_id
        FROM game_umpires gu
        WHERE gu.hp_umpire_id = %s
        AND gu.game_date >= CURRENT_DATE - INTERVAL '2 years'
        ORDER BY gu.game_date DESC
        LIMIT 100
    """, (umpire_id,))
    games = cur.fetchall()

    if len(games) < 5:
        return None

    # For each game, get runs scored from team_game_logs
    total_runs = 0
    total_k = 0
    total_bb = 0
    game_count = 0

    for game_pk, game_date, home_id, away_id in games:
        # Runs: from team_game_logs (points_scored = runs scored per team)
        cur.execute("""
            SELECT SUM(points_scored) as runs
            FROM team_game_logs
            WHERE sport = 'MLB'
            AND game_date = %s
            AND (team_id = %s OR team_id = %s)
        """, (game_date, home_id, away_id))
        run_row = cur.fetchone()

        # K and BB: from pitcher game logs (assists=K, turnovers=BB)
        # offensive_rating IS NOT NULL identifies pitcher rows (ERA field populated)
        cur.execute("""
            SELECT SUM(assists) as k, SUM(turnovers) as bb
            FROM player_game_logs
            WHERE sport = 'MLB'
            AND game_date = %s
            AND game_id = %s::text
            AND offensive_rating IS NOT NULL
        """, (game_date, game_pk))
        pitch_row = cur.fetchone()

        if run_row and run_row[0] is not None:
            total_runs += float(run_row[0] or 0)
            total_k += float(pitch_row[0] or 0) if pitch_row else 0
            total_bb += float(pitch_row[1] or 0) if pitch_row else 0
            game_count += 1

    if game_count < 5:
        return None

    avg_runs = total_runs / game_count
    avg_k = total_k / game_count
    avg_bb = total_bb / game_count

    # League averages approximately
    league_avg_runs = 8.8  # per game (both teams)
    league_avg_k = 17.0
    league_avg_bb = 6.2

    if avg_k > league_avg_k * 1.05:
        zone = 'tight'
    elif avg_k < league_avg_k * 0.95:
        zone = 'generous'
    else:
        zone = 'normal'

    return {
        'games_sampled': game_count,
        'avg_runs_per_game': round(avg_runs, 2),
        'avg_k_per_game': round(avg_k, 2),
        'avg_bb_per_game': round(avg_bb, 2),
        'zone_rating': zone,
    }

def run(target_date=None):
    if target_date is None:
        target_date = date.today().strftime('%Y-%m-%d')

    print(f"[UmpireCollector] Collecting umpires for {target_date}")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    umpire_games = get_todays_umpires(target_date)
    print(f"  Found {len(umpire_games)} games with HP umpire data")

    for ug in umpire_games:
        # Upsert umpire into tendencies table
        cur.execute("""
            INSERT INTO umpire_tendencies (umpire_id, umpire_name, games_sampled)
            VALUES (%s, %s, 0)
            ON CONFLICT (umpire_id) DO NOTHING
        """, (ug['hp_umpire_id'], ug['hp_umpire_name']))

        # Store game assignment
        cur.execute("""
            INSERT INTO game_umpires (game_pk, game_date, home_team_id, away_team_id, hp_umpire_id, hp_umpire_name)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (game_pk) DO UPDATE SET
                hp_umpire_id = EXCLUDED.hp_umpire_id,
                hp_umpire_name = EXCLUDED.hp_umpire_name
        """, (ug['game_pk'], ug['game_date'], ug['home_team_id'], ug['away_team_id'],
              ug['hp_umpire_id'], ug['hp_umpire_name']))

    conn.commit()

    # Recompute tendencies for each unique umpire we saw today
    umpire_ids = list({u['hp_umpire_id'] for u in umpire_games})
    for uid in umpire_ids:
        name = next(u['hp_umpire_name'] for u in umpire_games if u['hp_umpire_id'] == uid)
        tend = compute_umpire_tendencies(uid, conn)
        if tend:
            cur.execute("""
                UPDATE umpire_tendencies SET
                    games_sampled = %s,
                    avg_k_per_game = %s,
                    avg_bb_per_game = %s,
                    avg_runs_per_game = %s,
                    zone_rating = %s,
                    updated_at = NOW()
                WHERE umpire_id = %s
            """, (tend['games_sampled'], tend['avg_k_per_game'], tend['avg_bb_per_game'],
                  tend['avg_runs_per_game'], tend['zone_rating'], uid))
            print(f"  {name}: zone={tend['zone_rating']}, K/g={tend['avg_k_per_game']}, runs/g={tend['avg_runs_per_game']}")

    conn.commit()
    conn.close()
    print(f"[UmpireCollector] Done — {len(umpire_ids)} umpires processed")

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', type=str, default=None)
    args = parser.parse_args()
    run(args.date)
