#!/usr/bin/env python3
"""
mlbMatchupCollector.py — Collects career pitcher vs batter matchup data.
Run daily at 1:00 AM ET. Most valuable single dataset for MLB projections.
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

def get_todays_lineups_and_sps():
    """
    Get probable SPs and all batters likely to face them tonight.
    Returns list of (pitcher_id, pitcher_name, [batter_id, ...])
    """
    today = date.today().strftime('%Y-%m-%d')
    data = mlb_get('/schedule', {
        'sportId': 1,
        'date': today,
        'hydrate': 'probablePitcher,person,team,lineups',
    })

    matchups = []
    for d in (data.get('dates') or []):
        for g in (d.get('games') or []):
            for side in ('home', 'away'):
                opp_side = 'away' if side == 'home' else 'home'
                sp = g.get('teams', {}).get(opp_side, {}).get('probablePitcher')
                if not sp or not sp.get('id'):
                    continue

                # Get batting lineup for the team facing this SP
                lineup = g.get('lineups', {})
                batting_team = 'homePlayers' if side == 'home' else 'awayPlayers'
                batters = [p for p in (lineup.get(batting_team) or [])
                          if p.get('id') and p.get('primaryPosition', {}).get('type') != 'Pitcher']

                # If no confirmed lineup, fall back to roster
                if not batters:
                    team_id = g.get('teams', {}).get(side, {}).get('team', {}).get('id')
                    if team_id:
                        try:
                            roster_data = mlb_get(f'/teams/{team_id}/roster', {
                                'rosterType': 'active',
                                'hydrate': 'person',
                            })
                            batters = [
                                {'id': p['person']['id'], 'fullName': p['person']['fullName']}
                                for p in (roster_data.get('roster') or [])
                                if p.get('position', {}).get('type') != 'Pitcher'
                            ]
                        except:
                            pass

                if batters:
                    matchups.append({
                        'pitcher_id': sp['id'],
                        'pitcher_name': sp.get('fullName', ''),
                        'batters': batters,
                    })
    return matchups

def fetch_matchup(pitcher_id, batter_id):
    """Fetch career stats for a specific pitcher vs batter matchup."""
    try:
        # vsPlayer endpoint
        data = mlb_get(f'/people/{batter_id}/stats', {
            'stats': 'vsPlayer',
            'opposingPlayerId': pitcher_id,
            'group': 'hitting',
        })
        for stat_group in (data.get('stats') or []):
            splits = stat_group.get('splits') or []
            if splits:
                s = splits[0].get('stat', {})
                ab = int(s.get('atBats') or 0)
                if ab == 0:
                    return None
                return {
                    'ab': ab,
                    'hits': int(s.get('hits') or 0),
                    'hr': int(s.get('homeRuns') or 0),
                    'bb': int(s.get('baseOnBalls') or 0),
                    'k': int(s.get('strikeOuts') or 0),
                    'avg': float(s.get('avg') or 0),
                    'ops': float(s.get('ops') or 0),
                }
        return None
    except:
        return None

def run():
    print("[MatchupCollector] Collecting pitcher vs batter career matchups")
    matchups = get_todays_lineups_and_sps()

    if not matchups:
        print("  No games / probable pitchers found today")
        return

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    total = 0
    season = 2025  # career data stored under current season key

    for m in matchups:
        pid = m['pitcher_id']
        pname = m['pitcher_name']
        print(f"  SP: {pname} ({pid}) — {len(m['batters'])} batters")

        for batter in m['batters']:
            bid = batter.get('id') or batter.get('person', {}).get('id')
            bname = batter.get('fullName') or batter.get('person', {}).get('fullName') or f"ID {bid}"
            if not bid:
                continue

            stats = fetch_matchup(pid, bid)
            if stats and stats['ab'] > 0:
                cur.execute("""
                    INSERT INTO pitcher_batter_matchups
                        (pitcher_id, pitcher_name, batter_id, batter_name,
                         ab, hits, hr, bb, k, avg, ops, season)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (pitcher_id, batter_id, season) DO UPDATE SET
                        pitcher_name = EXCLUDED.pitcher_name,
                        batter_name = EXCLUDED.batter_name,
                        ab = EXCLUDED.ab,
                        hits = EXCLUDED.hits,
                        hr = EXCLUDED.hr,
                        bb = EXCLUDED.bb,
                        k = EXCLUDED.k,
                        avg = EXCLUDED.avg,
                        ops = EXCLUDED.ops,
                        updated_at = NOW()
                """, (pid, pname, bid, bname,
                      stats['ab'], stats['hits'], stats['hr'], stats['bb'], stats['k'],
                      stats['avg'], stats['ops'], season))
                total += 1

            time.sleep(0.2)

        conn.commit()

    conn.close()
    print(f"[MatchupCollector] Done — {total} matchup records stored")

if __name__ == '__main__':
    run()
