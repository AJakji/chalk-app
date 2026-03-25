#!/usr/bin/env python3
"""
mlbSplitsCollector.py — Collects batter splits: day/night, count situations, RISP.
Run daily at 1:45 AM ET for all batters with 50+ PA this season.
"""

import os, sys, time, requests, psycopg2
from datetime import datetime, date

DATABASE_URL = os.environ.get('DATABASE_URL')
MLB_BASE = 'https://statsapi.mlb.com/api/v1'

def mlb_get(path, params=None):
    url = f"{MLB_BASE}{path}"
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def safe_float(val):
    try:
        return float(val) if val else None
    except:
        return None

def fetch_batter_splits(player_id, season):
    """Fetch day/night, count, and RISP splits for a batter."""
    # Fetch multiple sit codes in one call where possible
    sit_codes = 'd,n,a,b,tw,risp'  # day, night, ahead, behind, two-strike, risp

    try:
        data = mlb_get(f'/people/{player_id}/stats', {
            'stats': 'statSplits',
            'season': season,
            'group': 'hitting',
            'sitCodes': sit_codes,
        })
    except:
        return {}

    result = {}
    for sg in (data.get('stats') or []):
        for split in (sg.get('splits') or []):
            code = split.get('split', {}).get('code', '')
            s = split.get('stat', {})
            if code == 'd':
                result['day_avg'] = safe_float(s.get('avg'))
                result['day_ops'] = safe_float(s.get('ops'))
            elif code == 'n':
                result['night_avg'] = safe_float(s.get('avg'))
                result['night_ops'] = safe_float(s.get('ops'))
            elif code == 'risp':
                result['risp_avg'] = safe_float(s.get('avg'))
                result['risp_ops'] = safe_float(s.get('ops'))
            elif code == 'a':  # ahead in count
                result['ahead_count_avg'] = safe_float(s.get('avg'))
            elif code == 'b':  # behind in count
                result['behind_count_avg'] = safe_float(s.get('avg'))
            elif code == 'tw':  # two strikes
                result['two_strike_avg'] = safe_float(s.get('avg'))

    return result

def get_qualified_batters(conn, season):
    """Get all batters with 50+ PA this season from player_game_logs."""
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT player_name, player_id
        FROM player_game_logs
        WHERE sport = 'MLB'
        AND season = %s::text
        AND fg_att IS NOT NULL
        GROUP BY player_name, player_id
        HAVING SUM(fg_att) >= 50
        AND MAX(player_id::text) IS NOT NULL
    """, (season,))
    return cur.fetchall()

def run():
    season = date.today().year
    if season > 2025:
        season = 2025

    print(f"[SplitsCollector] Collecting batter splits for {season} season")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    batters = get_qualified_batters(conn, season)
    print(f"  Found {len(batters)} qualified batters (50+ PA)")

    updated = 0
    for pname, pid in batters:
        if not pid:
            continue

        splits = fetch_batter_splits(pid, season)
        if not splits:
            continue

        # Upsert into player_splits (vs_lhp/vs_rhp columns already exist; add new columns)
        cur.execute("""
            INSERT INTO player_splits (player_id, player_name, sport, season,
                day_avg, day_ops, night_avg, night_ops,
                risp_avg, risp_ops, ahead_count_avg, behind_count_avg, two_strike_avg)
            VALUES (%s, %s, 'MLB', %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (player_id, sport, season) DO UPDATE SET
                day_avg = COALESCE(EXCLUDED.day_avg, player_splits.day_avg),
                day_ops = COALESCE(EXCLUDED.day_ops, player_splits.day_ops),
                night_avg = COALESCE(EXCLUDED.night_avg, player_splits.night_avg),
                night_ops = COALESCE(EXCLUDED.night_ops, player_splits.night_ops),
                risp_avg = COALESCE(EXCLUDED.risp_avg, player_splits.risp_avg),
                risp_ops = COALESCE(EXCLUDED.risp_ops, player_splits.risp_ops),
                ahead_count_avg = COALESCE(EXCLUDED.ahead_count_avg, player_splits.ahead_count_avg),
                behind_count_avg = COALESCE(EXCLUDED.behind_count_avg, player_splits.behind_count_avg),
                two_strike_avg = COALESCE(EXCLUDED.two_strike_avg, player_splits.two_strike_avg)
        """, (pid, pname, season,
              splits.get('day_avg'), splits.get('day_ops'),
              splits.get('night_avg'), splits.get('night_ops'),
              splits.get('risp_avg'), splits.get('risp_ops'),
              splits.get('ahead_count_avg'), splits.get('behind_count_avg'),
              splits.get('two_strike_avg')))

        updated += 1
        if updated % 50 == 0:
            conn.commit()
            print(f"  {updated}/{len(batters)} processed...")
        time.sleep(0.2)

    conn.commit()
    conn.close()
    print(f"[SplitsCollector] Done — {updated} batters updated")

if __name__ == '__main__':
    run()
