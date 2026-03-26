#!/usr/bin/env python3
"""
statcastCollector.py — Fetches Statcast data from Baseball Savant CSV exports.

Two jobs:
  1. Pitcher arsenal whiff rates + hard_hit_pct  → UPDATE pitcher_arsenal
  2. Batter Statcast (barrel, sprint speed, xba, etc.)  → UPSERT player_statcast

Run every Monday at 2:00 AM ET (scheduled via node-cron in server.js).
No API key required — Baseball Savant CSV exports are public.
"""

import os, sys, time, io, requests, psycopg2
from datetime import date

DATABASE_URL = os.environ.get('DATABASE_URL')

SEASON = 2025

# Baseball Savant pitcher arsenal leaderboard CSV
# min=50 pitches thrown of that pitch type
SAVANT_PITCHER_URL = (
    'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats'
    '?type=pitcher&pitchType=&year={year}&position=&team=&min=50&csv=true'
)

# Baseball Savant batter Statcast leaderboard CSV
# min=25 batted ball events
SAVANT_BATTER_URL = (
    'https://baseballsavant.mlb.com/leaderboard/custom'
    '?year={year}&type=batter&filter=&sort=4&sortDir=desc&min=25'
    '&selections=barrel_batted_rate,hard_hit_percent,exit_velocity_avg,'
    'launch_angle_avg,sprint_speed,xba,xslg,xwoba'
    '&chart=false&csv=true'
)


def safe_float(val):
    try:
        v = str(val).strip()
        if v in ('', 'null', 'NULL', 'None', 'na', 'N/A'):
            return None
        return float(v)
    except Exception:
        return None


def safe_int(val):
    try:
        v = str(val).strip()
        if v in ('', 'null', 'NULL', 'None'):
            return None
        return int(float(v))
    except Exception:
        return None


def fetch_csv(url):
    """Download a CSV from Baseball Savant. Returns list of dicts."""
    try:
        r = requests.get(url, timeout=30, headers={'User-Agent': 'ChalkApp/3.1'})
        r.raise_for_status()
        import csv
        reader = csv.DictReader(io.StringIO(r.text))
        rows = list(reader)
        print(f"  Fetched {len(rows)} rows from {url[:80]}...")
        return rows
    except Exception as e:
        print(f"  [ERROR] CSV fetch failed: {e}")
        return []


def collect_pitcher_arsenal(conn, season):
    """
    Fetch pitcher arsenal CSV and update pitcher_arsenal rows with:
      whiff_rate, ba_against, slg_against, hard_hit_pct
    Only updates rows that already exist (inserted by the arsenal collector).
    """
    url = SAVANT_PITCHER_URL.format(year=season)
    rows = fetch_csv(url)
    if not rows:
        print("  [SKIP] No pitcher arsenal data returned")
        return 0

    cur = conn.cursor()
    updated = 0

    for row in rows:
        pitcher_id = safe_int(row.get('pitcher_id') or row.get('player_id') or row.get('MLBID'))
        pitch_type  = (row.get('pitch_type') or row.get('pitch_name_abbrev') or '').strip().upper()

        if not pitcher_id or not pitch_type:
            continue

        whiff_rate   = safe_float(row.get('whiff_percent') or row.get('whiff_pct'))
        if whiff_rate and whiff_rate > 1:
            whiff_rate = whiff_rate / 100.0  # convert pct to decimal

        ba_against   = safe_float(row.get('ba'))
        slg_against  = safe_float(row.get('slg'))
        hard_hit_pct = safe_float(row.get('hard_hit_percent') or row.get('hard_hit_pct'))
        if hard_hit_pct and hard_hit_pct > 1:
            hard_hit_pct = hard_hit_pct / 100.0

        cur.execute("""
            UPDATE pitcher_arsenal
            SET whiff_rate   = COALESCE(%s, whiff_rate),
                ba_against   = COALESCE(%s, ba_against),
                slg_against  = COALESCE(%s, slg_against),
                hard_hit_pct = COALESCE(%s, hard_hit_pct),
                updated_at   = NOW()
            WHERE pitcher_id = %s AND pitch_type = %s AND season = %s
        """, (whiff_rate, ba_against, slg_against, hard_hit_pct,
              pitcher_id, pitch_type, season))

        if cur.rowcount > 0:
            updated += 1

    conn.commit()
    cur.close()
    print(f"  Pitcher arsenal: {updated} pitch-type rows updated with Statcast data")
    return updated


def collect_batter_statcast(conn, season):
    """
    Fetch batter Statcast CSV and upsert into player_statcast.
    Columns: barrel_pct, hard_hit_pct, exit_velocity_avg, launch_angle_avg,
             sprint_speed, xba, xslg, xwoba
    """
    url = SAVANT_BATTER_URL.format(year=season)
    rows = fetch_csv(url)
    if not rows:
        print("  [SKIP] No batter Statcast data returned")
        return 0

    cur = conn.cursor()
    upserted = 0

    for row in rows:
        player_id   = safe_int(row.get('player_id') or row.get('MLBID') or row.get('batter'))
        player_name = (row.get('player_name') or row.get('name') or '').strip()

        if not player_id:
            continue

        def pct(col):
            v = safe_float(row.get(col))
            return v / 100.0 if (v is not None and v > 1) else v

        barrel_pct        = pct('barrel_batted_rate')
        hard_hit_pct      = pct('hard_hit_percent')
        exit_velocity_avg = safe_float(row.get('exit_velocity_avg'))
        launch_angle_avg  = safe_float(row.get('launch_angle_avg'))
        sprint_speed      = safe_float(row.get('sprint_speed'))
        xba               = safe_float(row.get('xba'))
        xslg              = safe_float(row.get('xslg'))
        xwoba             = safe_float(row.get('xwoba'))

        cur.execute("""
            INSERT INTO player_statcast (
                player_id, player_name, season,
                barrel_pct, hard_hit_pct, exit_velocity_avg, launch_angle_avg,
                sprint_speed, xba, xslg, xwoba, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (player_id, season) DO UPDATE SET
                player_name       = COALESCE(EXCLUDED.player_name,       player_statcast.player_name),
                barrel_pct        = COALESCE(EXCLUDED.barrel_pct,        player_statcast.barrel_pct),
                hard_hit_pct      = COALESCE(EXCLUDED.hard_hit_pct,      player_statcast.hard_hit_pct),
                exit_velocity_avg = COALESCE(EXCLUDED.exit_velocity_avg, player_statcast.exit_velocity_avg),
                launch_angle_avg  = COALESCE(EXCLUDED.launch_angle_avg,  player_statcast.launch_angle_avg),
                sprint_speed      = COALESCE(EXCLUDED.sprint_speed,      player_statcast.sprint_speed),
                xba               = COALESCE(EXCLUDED.xba,               player_statcast.xba),
                xslg              = COALESCE(EXCLUDED.xslg,              player_statcast.xslg),
                xwoba             = COALESCE(EXCLUDED.xwoba,             player_statcast.xwoba),
                updated_at        = NOW()
        """, (player_id, player_name, season,
              barrel_pct, hard_hit_pct, exit_velocity_avg, launch_angle_avg,
              sprint_speed, xba, xslg, xwoba))

        upserted += 1
        if upserted % 100 == 0:
            conn.commit()

    conn.commit()
    cur.close()
    print(f"  Batter Statcast: {upserted} player rows upserted into player_statcast")
    return upserted


def run():
    season = date.today().year
    if season > SEASON:
        season = SEASON

    print(f"[StatcastCollector] Season {season}")

    if not DATABASE_URL:
        print("[ERROR] DATABASE_URL not set")
        sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    print("  DB connected")

    print("\n── Pitcher Arsenal (whiff rates) ──")
    collect_pitcher_arsenal(conn, season)

    print("\n── Batter Statcast (barrel/sprint) ──")
    collect_batter_statcast(conn, season)

    conn.close()
    print("\n[StatcastCollector] Done")


if __name__ == '__main__':
    run()
