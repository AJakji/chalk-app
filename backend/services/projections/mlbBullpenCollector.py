#!/usr/bin/env python3
"""
mlbBullpenCollector.py — Collects bullpen usage (pitches/innings thrown) last 3 days.
Run daily at 1:30 AM ET.
"""

import os, sys, time, requests, psycopg2
from datetime import datetime, date, timedelta

DATABASE_URL = os.environ.get('DATABASE_URL')
MLB_BASE = 'https://statsapi.mlb.com/api/v1'

# All 30 MLB team IDs
MLB_TEAM_IDS = [
    108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
    118, 119, 120, 121, 133, 134, 135, 136, 137, 138,
    139, 140, 141, 142, 143, 144, 145, 146, 147, 158,
]

def mlb_get(path, params=None):
    url = f"{MLB_BASE}{path}"
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json()

def get_team_info(team_id):
    data = mlb_get(f'/teams/{team_id}')
    team = data.get('teams', [{}])[0]
    return team.get('abbreviation', str(team_id)), team.get('name', '')

def get_bullpen_usage(team_id, team_abbr):
    """Get each reliever's appearances/pitches in last 3 days."""
    today = date.today()
    three_days_ago = (today - timedelta(days=3)).strftime('%Y-%m-%d')
    end_date = today.strftime('%Y-%m-%d')

    # Get active roster
    try:
        roster_data = mlb_get(f'/teams/{team_id}/roster', {
            'rosterType': 'active',
            'hydrate': 'person,stats(group=pitching,type=gameLog)',
        })
    except Exception as exc:
        print(f'[get_bullpen_usage] roster fetch failed for team {team_id}: {exc}')
        return []

    relievers = []
    for player in (roster_data.get('roster') or []):
        pos = player.get('position', {}).get('abbreviation', '')
        person = player.get('person', {})
        if not person.get('id'):
            continue

        # Include all pitchers; flag closers by role
        if pos == 'P':
            pid = person['id']
            pname = person.get('fullName', '')

            # Get game log for last 3 days
            try:
                stats_data = mlb_get(f'/people/{pid}/stats', {
                    'stats': 'gameLog',
                    'group': 'pitching',
                    'season': today.year,
                    'startDate': three_days_ago,
                    'endDate': end_date,
                })
            except Exception as exc:
                print(f'[get_bullpen_usage] stats fetch failed for pitcher {pid} ({pname}): {exc}')
                continue

            games = 0
            pitches = 0
            innings = 0.0
            last_app_date = None

            for sg in (stats_data.get('stats') or []):
                for split in (sg.get('splits') or []):
                    s = split.get('stat', {})
                    gdate = split.get('date')
                    ip_str = s.get('inningsPitched', '0') or '0'
                    # Convert "1.2" IP notation to float (1.2 means 1 and 2/3 innings)
                    try:
                        ip_parts = str(ip_str).split('.')
                        ip = int(ip_parts[0]) + (int(ip_parts[1]) / 3 if len(ip_parts) > 1 else 0)
                    except:
                        ip = 0.0

                    if ip > 0 or int(s.get('pitchesThrown') or 0) > 0:
                        games += 1
                        pitches += int(s.get('pitchesThrown') or 0)
                        innings += ip
                        if gdate and (last_app_date is None or gdate > last_app_date):
                            last_app_date = gdate

            days_since = None
            if last_app_date:
                try:
                    last_dt = datetime.strptime(last_app_date, '%Y-%m-%d').date()
                    days_since = (today - last_dt).days
                except:
                    pass

            relievers.append({
                'pitcher_id': pid,
                'pitcher_name': pname,
                'games_last_3': games,
                'pitches_last_3': pitches,
                'innings_last_3': round(innings, 1),
                'days_since_last_app': days_since,
            })

            time.sleep(0.15)

    return relievers

def run():
    today = date.today().strftime('%Y-%m-%d')
    print(f"[BullpenCollector] Collecting bullpen usage for {today}")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    total = 0
    for team_id in MLB_TEAM_IDS:
        abbr, name = get_team_info(team_id)
        print(f"  {abbr} ({name})")

        relievers = get_bullpen_usage(team_id, abbr)

        for r in relievers:
            cur.execute("""
                INSERT INTO bullpen_usage
                    (team_id, team_abbr, pitcher_id, pitcher_name,
                     games_last_3, pitches_last_3, innings_last_3,
                     days_since_last_app, collected_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (pitcher_id, collected_date) DO UPDATE SET
                    team_abbr = EXCLUDED.team_abbr,
                    games_last_3 = EXCLUDED.games_last_3,
                    pitches_last_3 = EXCLUDED.pitches_last_3,
                    innings_last_3 = EXCLUDED.innings_last_3,
                    days_since_last_app = EXCLUDED.days_since_last_app
            """, (team_id, abbr, r['pitcher_id'], r['pitcher_name'],
                  r['games_last_3'], r['pitches_last_3'], r['innings_last_3'],
                  r['days_since_last_app'], today))
            total += 1

        conn.commit()
        time.sleep(0.5)

    conn.close()
    print(f"[BullpenCollector] Done — {total} pitcher records stored")

if __name__ == '__main__':
    run()
