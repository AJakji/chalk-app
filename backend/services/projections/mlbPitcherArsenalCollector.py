#!/usr/bin/env python3
"""
mlbPitcherArsenalCollector.py — Collects pitcher pitch mix, velocity, and whiff rates.
Run daily at 12:45 AM ET. Collects for all SPs starting in next 3 days.
"""

import os, sys, time, requests, psycopg2
from datetime import datetime, date, timedelta

DATABASE_URL = os.environ.get('DATABASE_URL')
MLB_BASE = 'https://statsapi.mlb.com/api/v1'

PITCH_NAMES = {
    'FF': 'Four-Seam Fastball', 'SI': 'Sinker', 'FC': 'Cutter',
    'SL': 'Slider', 'ST': 'Sweeper', 'CH': 'Changeup',
    'CU': 'Curveball', 'KC': 'Knuckle Curve', 'FS': 'Splitter',
    'FO': 'Forkball', 'KN': 'Knuckleball', 'SC': 'Screwball',
    'EP': 'Eephus', 'CS': 'Slow Curve',
}

def mlb_get(path, params=None):
    url = f"{MLB_BASE}{path}"
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def get_sps_next_3_days():
    """Get all probable starters for tonight + next 2 days."""
    pitchers = {}
    for offset in range(3):
        d = (date.today() + timedelta(days=offset)).strftime('%Y-%m-%d')
        data = mlb_get('/schedule', {
            'sportId': 1,
            'date': d,
            'hydrate': 'probablePitcher,person,team',
        })
        for day in (data.get('dates') or []):
            for g in (day.get('games') or []):
                for side in ('home', 'away'):
                    pp = g.get('teams', {}).get(side, {}).get('probablePitcher')
                    if pp and pp.get('id'):
                        pitchers[pp['id']] = pp.get('fullName', f"ID {pp['id']}")
    return pitchers

def fetch_arsenal(pitcher_id, season):
    """Fetch pitch arsenal stats for a pitcher."""
    try:
        data = mlb_get(f'/people/{pitcher_id}/stats', {
            'stats': 'pitchArsenal',
            'season': season,
            'group': 'pitching',
        })
        splits = []
        for stat_group in (data.get('stats') or []):
            for split in (stat_group.get('splits') or []):
                s = split.get('stat', {})
                pitch_type = s.get('type', {}).get('code') or split.get('stat', {}).get('pitchType', {}).get('code')
                # Try alternate structure
                if not pitch_type:
                    pitch_type = split.get('pitchType') or s.get('pitchCode')
                if pitch_type:
                    splits.append({
                        'pitch_type': pitch_type,
                        'pitch_name': PITCH_NAMES.get(pitch_type, pitch_type),
                        'avg_velocity': float(s.get('averageSpeed') or s.get('avgSpeed') or s.get('avgVelocity') or 0) or None,
                        'usage_pct': float(s.get('percentage') or s.get('usage') or 0) or None,
                        'whiff_rate': float(s.get('whiffPercentage') or s.get('whiffRate') or s.get('whiff_pct') or 0) or None,
                        'ba_against': float(s.get('avg') or s.get('battingAvg') or 0) or None,
                        'slg_against': float(s.get('slg') or 0) or None,
                        'avg_spin_rate': int(s.get('avgSpinRate') or 0) or None,
                    })
        return splits
    except Exception as e:
        print(f"    Arsenal fetch failed for {pitcher_id}: {e}")
        return []

def run():
    season = date.today().year

    print(f"[ArsenalCollector] Collecting pitch arsenals for {season} season")
    pitchers = get_sps_next_3_days()
    print(f"  Found {len(pitchers)} probable starters in next 3 days")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    for pid, pname in pitchers.items():
        print(f"  Fetching arsenal: {pname} ({pid})")
        arsenal = fetch_arsenal(pid, season)

        for pitch in arsenal:
            if not pitch['pitch_type']:
                continue
            cur.execute("""
                INSERT INTO pitcher_arsenal
                    (pitcher_id, pitcher_name, pitch_type, pitch_name,
                     avg_velocity, usage_pct, whiff_rate, ba_against,
                     slg_against, avg_spin_rate, season)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (pitcher_id, pitch_type, season) DO UPDATE SET
                    pitcher_name = EXCLUDED.pitcher_name,
                    pitch_name = EXCLUDED.pitch_name,
                    avg_velocity = EXCLUDED.avg_velocity,
                    usage_pct = EXCLUDED.usage_pct,
                    whiff_rate = EXCLUDED.whiff_rate,
                    ba_against = EXCLUDED.ba_against,
                    slg_against = EXCLUDED.slg_against,
                    avg_spin_rate = EXCLUDED.avg_spin_rate,
                    updated_at = NOW()
            """, (pid, pname, pitch['pitch_type'], pitch['pitch_name'],
                  pitch['avg_velocity'], pitch['usage_pct'], pitch['whiff_rate'],
                  pitch['ba_against'], pitch['slg_against'], pitch['avg_spin_rate'],
                  season))

        if arsenal:
            print(f"    Stored {len(arsenal)} pitch types")
        conn.commit()
        time.sleep(0.3)

    conn.close()
    print(f"[ArsenalCollector] Done")

if __name__ == '__main__':
    run()
