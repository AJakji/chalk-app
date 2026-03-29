"""
UFC Data Collector — scrapes ufcstats.com for upcoming event,
fighter stats, and fight history, then writes to PostgreSQL.
"""
import requests
from bs4 import BeautifulSoup
import psycopg2
import os
import time
import re
from datetime import datetime, date

BASE_URL = 'http://ufcstats.com/statistics'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/120.0.0.0 Safari/537.36'
}


def get_upcoming_event():
    """Scrape next UFC event from ufcstats upcoming page."""
    url = 'http://ufcstats.com/statistics/events/upcoming'
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(resp.content, 'html.parser')

        rows = soup.select('tr.b-statistics__table-row')
        for row in rows:
            link = row.select_one('a.b-link')
            if not link:
                continue
            event_url = link['href']
            event_name = link.text.strip()
            if not event_name or not event_url.startswith('http://ufcstats.com/event-details'):
                continue
            # Date is in the full row text — search all td cells
            event_date = None
            for td in row.select('td'):
                txt = ' '.join(td.text.split())  # normalise whitespace
                for fmt in ('%B %d, %Y', '%b %d, %Y'):
                    try:
                        event_date = datetime.strptime(txt, fmt).date()
                        break
                    except Exception:
                        pass
                if event_date:
                    break
            # Fallback: scan raw text for date pattern
            if not event_date:
                raw = ' '.join(row.text.split())
                m = re.search(r'([A-Z][a-z]+ \d{1,2}, \d{4})', raw)
                if m:
                    try:
                        event_date = datetime.strptime(m.group(1), '%B %d, %Y').date()
                    except Exception:
                        pass
            return {'name': event_name, 'url': event_url, 'date': event_date}
    except Exception as e:
        print(f'Error fetching upcoming events: {e}')
    return None


def scrape_event_fights(event_url):
    """Return list of fights from an event page."""
    fights = []
    try:
        resp = requests.get(event_url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(resp.content, 'html.parser')

        rows = soup.select('tr.b-fight-details__table-row.b-fight-details__table-row__hover')
        for i, row in enumerate(rows):
            cols = row.select('td')
            if len(cols) < 7:
                continue
            fighter_links = cols[1].select('a')
            if len(fighter_links) < 2:
                continue
            fighter_a = fighter_links[0].text.strip()
            fighter_b = fighter_links[1].text.strip()
            weight_class = cols[6].text.strip() if len(cols) > 6 else ''
            if fighter_a and fighter_b:
                fights.append({
                    'fighter_a': fighter_a,
                    'fighter_b': fighter_b,
                    'weight_class': weight_class,
                    'card_position': i + 1,
                    'is_main_event': i == 0,
                })
    except Exception as e:
        print(f'Error scraping event fights: {e}')
    return fights


def scrape_fighter(fighter_name):
    """Search ufcstats for a fighter, return stats + fight history."""
    # ufcstats search works best with last name only
    last_name = fighter_name.split()[-1]
    search_url = f'http://ufcstats.com/statistics/fighters/search?query={last_name}'
    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(resp.content, 'html.parser')

        # Find the fighter link that matches the full name
        # Each result row has first+last name as separate links to the same URL
        fighter_link = None
        seen_urls = set()
        for a in soup.select('a.b-link.b-link_style_black'):
            href = a.get('href', '')
            if not href.startswith('http://ufcstats.com/fighter-details'):
                continue
            if href in seen_urls:
                continue
            seen_urls.add(href)
            # Check if full name matches by fetching the row text
            row_text = a.find_parent('tr')
            if row_text:
                row_str = row_text.text.lower()
                name_parts = fighter_name.lower().split()
                if all(p in row_str for p in name_parts):
                    fighter_link = a
                    break
        # Fallback: first result if only one unique URL found
        if not fighter_link and len(seen_urls) == 1:
            for a in soup.select('a.b-link.b-link_style_black'):
                href = a.get('href', '')
                if href.startswith('http://ufcstats.com/fighter-details'):
                    fighter_link = a
                    break

        if not fighter_link:
            print(f'  Fighter not found on ufcstats: {fighter_name}')
            return None

        fighter_url = fighter_link['href']
        resp2 = requests.get(fighter_url, headers=HEADERS, timeout=15)
        soup2 = BeautifulSoup(resp2.content, 'html.parser')

        # Record
        record = {'wins': 0, 'losses': 0, 'draws': 0}
        rec_elem = soup2.select_one('span.b-content__title-record')
        if rec_elem:
            parts = re.findall(r'\d+', rec_elem.text)
            if len(parts) >= 3:
                record = {'wins': int(parts[0]), 'losses': int(parts[1]), 'draws': int(parts[2])}

        # Fight history
        fight_history = []
        rows = soup2.select('tr.b-fight-details__table-row.b-fight-details__table-row__hover')
        for row in rows[:20]:
            cols = row.select('td')
            if len(cols) < 10:
                continue
            try:
                result_i = cols[0].select_one('i')
                result_text = result_i.text.strip() if result_i else ''

                opponent_links = cols[1].select('a')
                opponent = opponent_links[1].text.strip() if len(opponent_links) > 1 else ''

                kd_txt = cols[2].text.strip()
                sig_txt = cols[3].text.strip()  # "X of Y"
                td_txt = cols[5].text.strip()   # "X of Y"

                method_p = cols[7].select('p')
                method_text = method_p[0].text.strip() if method_p else ''

                round_txt = cols[8].text.strip()
                time_txt = cols[9].text.strip()

                # Parse "X of Y"
                def parse_of(txt):
                    parts = txt.split(' of ')
                    try:
                        return int(parts[0]), int(parts[1])
                    except Exception:
                        return 0, 0

                sig_l, sig_a = parse_of(sig_txt)
                td_l, td_a = parse_of(td_txt)

                try:
                    round_num = int(round_txt)
                except Exception:
                    round_num = 0

                # Normalise method
                if 'KO' in method_text or 'TKO' in method_text:
                    method_clean = 'KO/TKO'
                elif 'Sub' in method_text or 'submission' in method_text.lower():
                    method_clean = 'Submission'
                elif 'Decision' in method_text:
                    method_clean = 'Decision'
                else:
                    method_clean = method_text

                fight_history.append({
                    'result': result_text,
                    'opponent': opponent,
                    'method': method_clean,
                    'method_detail': method_text,
                    'round': round_num,
                    'time': time_txt,
                    'sig_strikes_landed': sig_l,
                    'sig_strikes_attempted': sig_a,
                    'takedowns_landed': td_l,
                    'takedowns_attempted': td_a,
                    'knockdowns': int(kd_txt) if kd_txt.isdigit() else 0,
                })
            except Exception as ex:
                continue

        return {
            'name': fighter_name,
            'url': fighter_url,
            'record': record,
            'fight_history': fight_history,
        }
    except Exception as e:
        print(f'  Error scraping {fighter_name}: {e}')
        return None


def upsert_fighter(conn, data):
    cur = conn.cursor()
    rec = data.get('record', {})
    cur.execute("""
        INSERT INTO ufc_fighters (fighter_name, ufcstats_url, record_wins, record_losses, record_draws, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (ufcstats_url) DO UPDATE SET
            record_wins = EXCLUDED.record_wins,
            record_losses = EXCLUDED.record_losses,
            record_draws = EXCLUDED.record_draws,
            updated_at = NOW()
        RETURNING id
    """, [data['name'], data.get('url'), rec.get('wins', 0), rec.get('losses', 0), rec.get('draws', 0)])
    row = cur.fetchone()
    if not row:
        cur.execute("SELECT id FROM ufc_fighters WHERE ufcstats_url = %s", [data.get('url')])
        row = cur.fetchone()
    conn.commit()
    return row[0] if row else None


def upsert_fight_log(conn, fighter_id, fighter_name, fight, event_id=None):
    cur = conn.cursor()
    # Use a synthetic date — ufcstats fight history rows don't have exact dates
    # We'll use a placeholder so UNIQUE doesn't collide. Real dates would need
    # per-fight event page scraping (too slow for initial collection).
    cur.execute("""
        INSERT INTO ufc_fight_logs (
            fighter_id, fighter_name, opponent_name, fight_date,
            result, method, method_detail, round_finished, time_finished,
            sig_strikes_landed, sig_strikes_attempted,
            takedowns_landed, takedowns_attempted, knockdowns
        ) VALUES (%s,%s,%s, CURRENT_DATE - INTERVAL '1 year',
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (fighter_id, fight_date, opponent_name) DO UPDATE SET
            sig_strikes_landed = EXCLUDED.sig_strikes_landed,
            sig_strikes_attempted = EXCLUDED.sig_strikes_attempted,
            takedowns_landed = EXCLUDED.takedowns_landed,
            method = EXCLUDED.method
    """, [
        fighter_id, fighter_name, fight.get('opponent', ''),
        fight.get('result', ''), fight.get('method', ''),
        fight.get('method_detail', ''), fight.get('round', 0), fight.get('time', ''),
        fight.get('sig_strikes_landed', 0), fight.get('sig_strikes_attempted', 0),
        fight.get('takedowns_landed', 0), fight.get('takedowns_attempted', 0),
        fight.get('knockdowns', 0),
    ])
    conn.commit()


def collect_upcoming_event(conn):
    print('Fetching upcoming UFC event...')
    event = get_upcoming_event()
    if not event:
        print('No upcoming event found.')
        return

    print(f'Event: {event["name"]}')
    print(f'Date:  {event["date"]}')

    cur = conn.cursor()
    is_ppv = bool(re.search(r'UFC\s+\d+', event['name']))
    cur.execute("""
        INSERT INTO ufc_events (event_name, event_date, ufcstats_url, is_ppv)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        RETURNING id
    """, [event['name'], event['date'], event['url'], is_ppv])
    row = cur.fetchone()
    conn.commit()
    if not row:
        cur.execute("SELECT id FROM ufc_events WHERE event_name = %s", [event['name']])
        row = cur.fetchone()
    event_id = row[0] if row else None

    print('Scraping fight card...')
    fights = scrape_event_fights(event['url'])
    print(f'Found {len(fights)} fights')

    for fight in fights:
        cur.execute("""
            INSERT INTO ufc_upcoming_fights
                (event_id, event_name, fight_date, fighter_a_name, fighter_b_name,
                 weight_class, card_position, is_main_event)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT DO NOTHING
        """, [
            event_id, event['name'], event['date'],
            fight['fighter_a'], fight['fighter_b'],
            fight['weight_class'], fight['card_position'], fight['is_main_event'],
        ])
        conn.commit()

        print(f'  {fight["fighter_a"]} vs {fight["fighter_b"]} ({fight["weight_class"]})')

        for name in [fight['fighter_a'], fight['fighter_b']]:
            print(f'    Scraping {name}...')
            data = scrape_fighter(name)
            if data:
                fid = upsert_fighter(conn, data)
                if fid:
                    for fl in data['fight_history'][:10]:
                        upsert_fight_log(conn, fid, name, fl, event_id)
                    print(f'    ✅ {name} — {len(data["fight_history"])} fights saved')
                else:
                    print(f'    ⚠️  Could not save {name}')
            time.sleep(1.5)

    print(f'\n✅ UFC data collection complete — {len(fights)} fights')


if __name__ == '__main__':
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        collect_upcoming_event(conn)
    finally:
        conn.close()
