#!/usr/bin/env python3
"""
mlbSplitsCollector.py — Collects batter splits: day/night, count situations, RISP,
handedness (bat_side), and caught-stealing success rate.
Run daily at 1:45 AM ET for all batters with 50+ PA this season.

Confirmed sit codes (tested against MLB Stats API 2026-03-25):
  d     = Day Games
  n     = Night Games
  risp  = Scoring Position (RISP)
  ac    = Ahead in Count
  bc    = Behind in Count
  2s    = Two Strikes
  vl    = vs Left-handed Pitchers
  vr    = vs Right-handed Pitchers
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
    """Fetch day/night, count, RISP, and platoon splits for a batter."""
    # Confirmed working sit codes (tested 2026-03-25 against MLB Stats API):
    #   d=Day, n=Night, risp=RISP, ac=AheadInCount, bc=BehindInCount, 2s=TwoStrikes
    sit_codes = 'd,n,risp,ac,bc,2s'

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
            elif code == 'ac':  # ahead in count (confirmed working)
                result['ahead_count_avg'] = safe_float(s.get('avg'))
            elif code == 'bc':  # behind in count (confirmed working)
                result['behind_count_avg'] = safe_float(s.get('avg'))
            elif code == '2s':  # two strikes (confirmed working; 'tw' does NOT work)
                result['two_strike_avg'] = safe_float(s.get('avg'))

    return result


def fetch_batter_season_stats(player_id, season):
    """Fetch season SB and CS for caught-stealing success rate, and bat_side."""
    try:
        # bat_side from people endpoint
        person_data = mlb_get(f'/people/{player_id}')
        bat_side = None
        for p in (person_data.get('people') or []):
            bat_side = p.get('batSide', {}).get('code')  # 'L', 'R', or 'S'

        # SB + CS from season stats
        stats_data = mlb_get(f'/people/{player_id}/stats', {
            'stats': 'season',
            'season': season,
            'group': 'hitting',
            'sportId': 1,
        })
        sb, cs = None, None
        for sg in (stats_data.get('stats') or []):
            for sp in (sg.get('splits') or []):
                s = sp.get('stat', {})
                sb = s.get('stolenBases')
                cs = s.get('caughtStealing')
                break
            break

        sb_success = None
        if sb is not None and cs is not None:
            total = int(sb) + int(cs)
            if total > 0:
                sb_success = round(int(sb) / total, 3)

        return bat_side, sb_success
    except:
        return None, None

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
        bat_side, sb_success = fetch_batter_season_stats(pid, season)

        if not splits and bat_side is None and sb_success is None:
            continue

        cur.execute("""
            INSERT INTO player_splits (player_id, player_name, sport, season,
                day_avg, day_ops, night_avg, night_ops,
                risp_avg, risp_ops, ahead_count_avg, behind_count_avg, two_strike_avg,
                bat_side, sb_success_rate)
            VALUES (%s, %s, 'MLB', %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (player_id, sport, season) DO UPDATE SET
                day_avg          = COALESCE(EXCLUDED.day_avg,          player_splits.day_avg),
                day_ops          = COALESCE(EXCLUDED.day_ops,          player_splits.day_ops),
                night_avg        = COALESCE(EXCLUDED.night_avg,        player_splits.night_avg),
                night_ops        = COALESCE(EXCLUDED.night_ops,        player_splits.night_ops),
                risp_avg         = COALESCE(EXCLUDED.risp_avg,         player_splits.risp_avg),
                risp_ops         = COALESCE(EXCLUDED.risp_ops,         player_splits.risp_ops),
                ahead_count_avg  = COALESCE(EXCLUDED.ahead_count_avg,  player_splits.ahead_count_avg),
                behind_count_avg = COALESCE(EXCLUDED.behind_count_avg, player_splits.behind_count_avg),
                two_strike_avg   = COALESCE(EXCLUDED.two_strike_avg,   player_splits.two_strike_avg),
                bat_side         = COALESCE(EXCLUDED.bat_side,         player_splits.bat_side),
                sb_success_rate  = COALESCE(EXCLUDED.sb_success_rate,  player_splits.sb_success_rate)
        """, (pid, pname, season,
              splits.get('day_avg'), splits.get('day_ops'),
              splits.get('night_avg'), splits.get('night_ops'),
              splits.get('risp_avg'), splits.get('risp_ops'),
              splits.get('ahead_count_avg'), splits.get('behind_count_avg'),
              splits.get('two_strike_avg'),
              bat_side, sb_success))

        # Also backfill bat_side on player_game_logs
        if bat_side:
            cur.execute("""
                UPDATE player_game_logs SET bat_side = %s
                WHERE player_id = %s::text AND sport = 'MLB' AND bat_side IS NULL
            """, (bat_side, pid))

        updated += 1
        if updated % 50 == 0:
            conn.commit()
            print(f"  {updated}/{len(batters)} processed...")
        time.sleep(0.25)

    conn.commit()
    conn.close()
    print(f"[SplitsCollector] Done — {updated} batters updated")

if __name__ == '__main__':
    run()
