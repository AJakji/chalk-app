#!/usr/bin/env python3
"""
mlbLineupFetcher.py — Fetches confirmed MLB batting orders via MLB Stats API.

Run schedule: 12:00 PM ET daily (after morning lineups are posted).
A second MLB projection model pass runs at 12:30 PM ET using these confirmed orders.

What this does:
  1. Gets today's MLB schedule (all games)
  2. Calls statsapi.boxscore_data() for each game to pull confirmed batting orders
  3. Upserts into mlb_lineups table (Tier 0 for get_teammates_obp/rbi_rate)
  4. Games whose lineups haven't been posted yet are silently skipped

Why this matters:
  get_teammates_obp() and get_teammates_rbi_rate() depend on real batting
  positions. Before noon, the model falls back to yesterday's logs or active
  roster. After this runs, each batter projection uses the actual confirmed
  lineup positions — improving the quality of RBI, runs scored, and HR props.
"""

import os
import sys
import psycopg2
import psycopg2.extras
from datetime import date, timedelta

try:
    import statsapi
except ImportError:
    print('[ERROR] statsapi not installed — run: pip install MLB-StatsAPI')
    sys.exit(1)

DATABASE_URL = os.environ.get('DATABASE_URL')


def safe_int(val):
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def fetch_and_store_lineups(conn, game_date: date) -> int:
    """
    Fetch confirmed batting orders for all games on game_date.
    Upserts into mlb_lineups. Returns count of games with confirmed lineups.
    """
    today_str = game_date.isoformat()
    print(f'\n[mlbLineupFetcher] Fetching lineups for {today_str}')

    try:
        schedule = statsapi.schedule(date=today_str)
    except Exception as e:
        print(f'  [ERROR] statsapi.schedule failed: {e}')
        return 0

    if not schedule:
        print('  No MLB games today.')
        return 0

    print(f'  Found {len(schedule)} games.')
    confirmed_count = 0
    cur = conn.cursor()

    for game in schedule:
        game_pk = game.get('game_id')
        if not game_pk:
            continue

        home_team = game.get('home_name', '')
        away_team = game.get('away_name', '')

        try:
            boxscore = statsapi.boxscore_data(game_pk)
        except Exception as e:
            print(f'  Lineup not posted for game {game_pk} ({away_team} @ {home_team}): {e}')
            continue

        sides_written = 0
        for side_key in ('home', 'away'):
            side_data     = boxscore.get(side_key, {})
            team_name     = side_data.get('team', {}).get('name', '')
            players       = side_data.get('players', {})
            batting_order = side_data.get('battingOrder', [])

            if len(batting_order) < 9:
                continue  # lineup not confirmed yet for this side

            for idx, player_id in enumerate(batting_order):
                pid   = safe_int(player_id)
                pinfo = players.get(f'ID{player_id}', {})
                pname = pinfo.get('person', {}).get('fullName', f'Player {player_id}')

                try:
                    cur.execute("""
                        INSERT INTO mlb_lineups
                          (game_date, game_pk, team_name, player_name, player_id,
                           batting_order, side)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (game_date, game_pk, player_name) DO UPDATE SET
                          batting_order = EXCLUDED.batting_order,
                          player_id     = COALESCE(EXCLUDED.player_id, mlb_lineups.player_id),
                          side          = EXCLUDED.side
                    """, (today_str, game_pk, team_name, pname, pid, idx + 1, side_key))
                except Exception as e:
                    print(f'    DB insert error for {pname}: {e}')
                    conn.rollback()
                    continue

            sides_written += 1

        if sides_written == 2:
            confirmed_count += 1
            print(f'  ✅ {away_team} @ {home_team}: lineup confirmed')
        elif sides_written == 1:
            print(f'  ⚠️  {away_team} @ {home_team}: only one side confirmed')

    conn.commit()
    cur.close()
    print(f'\n[mlbLineupFetcher] Done — {confirmed_count}/{len(schedule)} games with confirmed lineups')
    return confirmed_count


def run():
    game_date = date.today()
    print(f'[mlbLineupFetcher] Date: {game_date}')

    if not DATABASE_URL:
        print('[ERROR] DATABASE_URL not set')
        sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    try:
        fetch_and_store_lineups(conn, game_date)
    finally:
        conn.close()


if __name__ == '__main__':
    run()
