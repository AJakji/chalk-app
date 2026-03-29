"""
UFC Data Collector — scrapes ufcstats.com for upcoming event,
fighter stats, and fight history, then writes to PostgreSQL.

Column layout for the fighter history stats row:
  [0]=Result  [1]=Opponent  [2]=KD  [3]=Sig.Str  [4]=Sig.Str%
  [5]=Total.Str  [6]=Td  [7]=Td%  [8]=Sub.  [9]=Rev.  [10]=Ctrl

Method / Round / Time / Date live in the NON-hover sibling row
that immediately follows each stats row.
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


# ── DB schema helpers ─────────────────────────────────────────────────────────

def ensure_columns(conn):
    """Add any columns/constraints the original schema may have omitted."""
    cur = conn.cursor()
    ddl = [
        "ALTER TABLE ufc_fight_logs ADD COLUMN IF NOT EXISTS submission_attempts INTEGER DEFAULT 0",
        "ALTER TABLE ufc_fight_logs ADD COLUMN IF NOT EXISTS control_time_seconds INTEGER DEFAULT 0",
        # UNIQUE constraints so ON CONFLICT clauses actually fire
        "ALTER TABLE ufc_events ADD CONSTRAINT ufc_events_event_name_unique UNIQUE (event_name)",
        "ALTER TABLE ufc_upcoming_fights ADD CONSTRAINT ufc_upcoming_fights_matchup_unique UNIQUE (event_id, fighter_a_name, fighter_b_name)",
    ]
    for sql in ddl:
        try:
            cur.execute(sql)
            conn.commit()
        except Exception:
            conn.rollback()  # constraint already exists — skip silently


# ── Upcoming event ─────────────────────────────────────────────────────────────

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
            event_date = None
            for td in row.select('td'):
                txt = ' '.join(td.text.split())
                for fmt in ('%B %d, %Y', '%b %d, %Y'):
                    try:
                        event_date = datetime.strptime(txt, fmt).date()
                        break
                    except Exception:
                        pass
                if event_date:
                    break
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


# ── Fighter scraper ────────────────────────────────────────────────────────────

def split_pair(txt):
    """
    ufcstats fighter history cells contain BOTH fighters' values
    separated by whitespace: e.g. '31 56' means fighter=31, opponent=56.
    Returns (fighter_val, opponent_val).
    """
    parts = txt.split()
    try:
        return int(parts[0]), int(parts[1])
    except Exception:
        return 0, 0


def parse_fight_date(text):
    """Try to extract a date from event cell text like 'UFC 311 Jan. 18, 2025'."""
    for pattern, fmt in [
        (r'[A-Z][a-z]+\.\s*\d{1,2},\s*\d{4}', '%b. %d, %Y'),
        (r'[A-Z][a-z]+ \d{1,2}, \d{4}',        '%B %d, %Y'),
        (r'[A-Z][a-z]+\. \d{1,2}, \d{4}',       '%b. %d, %Y'),
    ]:
        m = re.search(pattern, text)
        if m:
            raw = re.sub(r'\s+', ' ', m.group(0))
            try:
                return datetime.strptime(raw, fmt).date()
            except Exception:
                pass
    return None


def scrape_fighter(fighter_name):
    """Search ufcstats for a fighter, return stats + corrected fight history."""
    last_name = fighter_name.split()[-1]
    search_url = f'http://ufcstats.com/statistics/fighters/search?query={last_name}'
    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(resp.content, 'html.parser')

        fighter_link = None
        seen_urls = set()
        for a in soup.select('a.b-link.b-link_style_black'):
            href = a.get('href', '')
            if not href.startswith('http://ufcstats.com/fighter-details'):
                continue
            if href in seen_urls:
                continue
            seen_urls.add(href)
            row_text = a.find_parent('tr')
            if row_text:
                row_str = row_text.text.lower()
                name_parts = fighter_name.lower().split()
                if all(p in row_str for p in name_parts):
                    fighter_link = a
                    break
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

        # ── Fight history ─────────────────────────────────────────────────────
        # ufcstats fighter history: ONE row per fight, 10 columns.
        # Stats cells contain BOTH fighters' values as "A B" (fighter first).
        #
        # Actual column layout (confirmed from live HTML):
        #   [0] = result text  ('win' / 'loss' / 'nc')
        #   [1] = fighter + opponent names (two <a> tags)
        #   [2] = "kd_f kd_opp"        knockdowns
        #   [3] = "sig_f sig_opp"       significant strikes landed
        #   [4] = "td_f td_opp"         takedowns landed
        #   [5] = "sub_f sub_opp"       submission attempts
        #   [6] = "Event Name  Date"    event title + date in same cell
        #   [7] = method                e.g. 'KO/TKO', 'U-DEC', 'SUB ...'
        #   [8] = round                 '1', '2', '3' …
        #   [9] = time                  '5:00', '4:35' …
        #
        # There is NO separate sibling event row.

        hover_rows = soup2.select(
            'tr.b-fight-details__table-row.b-fight-details__table-row__hover'
        )

        fight_history = []

        for row in hover_rows[:20]:
            if len(fight_history) >= 10:
                break

            cols = row.select('td')
            if len(cols) < 9:
                continue

            try:
                # [0] Result — text or CSS-class fallback
                result_text = ' '.join(cols[0].text.split()).lower()
                if not result_text:
                    result_i = cols[0].select_one('i')
                    if result_i:
                        cls = ' '.join(result_i.get('class', []))
                        if 'green' in cls:
                            result_text = 'win'
                        elif 'red' in cls:
                            result_text = 'loss'
                        else:
                            result_text = 'nc'

                # [1] Opponent (second <a> tag)
                opponent_links = cols[1].select('a')
                opponent = opponent_links[1].text.strip() if len(opponent_links) > 1 else ''

                # [2] KD — "fighter_kd opp_kd"
                kd_f, _ = split_pair(' '.join(cols[2].text.split()))

                # [3] Significant strikes landed — "fighter_sig opp_sig"
                sig_f, sig_opp = split_pair(' '.join(cols[3].text.split()))

                # [4] Takedowns landed — "fighter_td opp_td"
                td_f, _ = split_pair(' '.join(cols[4].text.split()))

                # [5] Submission attempts — "fighter_sub opp_sub"
                sub_f, _ = split_pair(' '.join(cols[5].text.split()))

                # [6] Event name + date (same cell)
                event_cell = ' '.join(cols[6].text.split())
                fight_date = parse_fight_date(event_cell)

                # [7] Method
                method_raw   = ' '.join(cols[7].text.split())
                method_clean = ''
                mu = method_raw.upper()
                if 'KO' in mu or 'TKO' in mu:
                    method_clean = 'KO/TKO'
                elif 'SUB' in mu or 'SUBMISSION' in mu:
                    method_clean = 'Submission'
                elif 'DEC' in mu or 'DECISION' in mu:
                    method_clean = 'Decision'
                elif 'NO CONTEST' in mu or 'NC' == mu:
                    method_clean = 'NC'
                elif 'DQ' in mu:
                    method_clean = 'DQ'

                # [8] Round
                round_num = 0
                try:
                    round_num = int(' '.join(cols[8].text.split()))
                except Exception:
                    pass

                # [9] Time
                time_str = ' '.join(cols[9].text.split())

                fight_history.append({
                    'result':               result_text,
                    'opponent':             opponent,
                    'method':               method_clean,
                    'method_detail':        method_raw,
                    'round':                round_num,
                    'time':                 time_str,
                    'fight_date':           fight_date,
                    'sig_strikes_landed':   sig_f,
                    'sig_strikes_attempted': sig_opp,   # opp sig = proxy for attempts in context
                    'takedowns_landed':     td_f,
                    'takedowns_attempted':  0,          # not available in fighter history view
                    'knockdowns':           kd_f,
                    'submission_attempts':  sub_f,
                    'control_time_seconds': 0,          # not available in fighter history view
                })
            except Exception:
                continue

        return {
            'name':         fighter_name,
            'url':          fighter_url,
            'record':       record,
            'fight_history': fight_history,
        }
    except Exception as e:
        print(f'  Error scraping {fighter_name}: {e}')
        return None


# ── DB writes ─────────────────────────────────────────────────────────────────

def upsert_fighter(conn, data):
    cur = conn.cursor()
    rec = data.get('record', {})
    cur.execute("""
        INSERT INTO ufc_fighters (fighter_name, ufcstats_url, record_wins, record_losses, record_draws, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (ufcstats_url) DO UPDATE SET
            fighter_name  = EXCLUDED.fighter_name,
            record_wins   = EXCLUDED.record_wins,
            record_losses = EXCLUDED.record_losses,
            record_draws  = EXCLUDED.record_draws,
            updated_at    = NOW()
        RETURNING id
    """, [data['name'], data.get('url'), rec.get('wins', 0), rec.get('losses', 0), rec.get('draws', 0)])
    row = cur.fetchone()
    if not row:
        cur.execute("SELECT id FROM ufc_fighters WHERE ufcstats_url = %s", [data.get('url')])
        row = cur.fetchone()
    conn.commit()
    fid = row[0] if row else None

    # Wipe old fight logs so re-runs get fresh real dates (not synthetic ones)
    if fid:
        cur.execute("DELETE FROM ufc_fight_logs WHERE fighter_id = %s", [fid])
        conn.commit()

    return fid


def upsert_fight_log(conn, fighter_id, fighter_name, fight, position=0):
    cur = conn.cursor()

    fd = fight.get('fight_date')
    if not fd:
        # Date unknown — use position as a unique offset so multiple unknown-date
        # fights for the same fighter don't collapse into one row via the
        # (fighter_id, fight_date, opponent_name) unique constraint.
        # Epoch-era dates are easily identifiable as placeholders.
        fd = date(1900, 1, 1 + (position % 365))

    cur.execute("""
        INSERT INTO ufc_fight_logs (
            fighter_id, fighter_name, opponent_name, fight_date,
            result, method, method_detail, round_finished, time_finished,
            sig_strikes_landed, sig_strikes_attempted,
            takedowns_landed, takedowns_attempted,
            knockdowns, submission_attempts, control_time_seconds
        ) VALUES (%s,%s,%s,%s, %s,%s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s)
        ON CONFLICT (fighter_id, fight_date, opponent_name) DO UPDATE SET
            result                 = EXCLUDED.result,
            method                 = EXCLUDED.method,
            method_detail          = EXCLUDED.method_detail,
            round_finished         = EXCLUDED.round_finished,
            time_finished          = EXCLUDED.time_finished,
            sig_strikes_landed     = EXCLUDED.sig_strikes_landed,
            sig_strikes_attempted  = EXCLUDED.sig_strikes_attempted,
            takedowns_landed       = EXCLUDED.takedowns_landed,
            takedowns_attempted    = EXCLUDED.takedowns_attempted,
            knockdowns             = EXCLUDED.knockdowns,
            submission_attempts    = EXCLUDED.submission_attempts,
            control_time_seconds   = EXCLUDED.control_time_seconds
    """, [
        fighter_id, fighter_name, fight.get('opponent', ''),
        fd,
        fight.get('result', ''), fight.get('method', ''),
        fight.get('method_detail', ''), fight.get('round', 0), fight.get('time', ''),
        fight.get('sig_strikes_landed', 0),  fight.get('sig_strikes_attempted', 0),
        fight.get('takedowns_landed', 0),    fight.get('takedowns_attempted', 0),
        fight.get('knockdowns', 0),
        fight.get('submission_attempts', 0),
        fight.get('control_time_seconds', 0),
    ])
    conn.commit()


# ── Main pipeline ─────────────────────────────────────────────────────────────

def collect_upcoming_event(conn):
    ensure_columns(conn)

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
                    saved = 0
                    for pos, fl in enumerate(data['fight_history']):
                        upsert_fight_log(conn, fid, name, fl, position=pos)
                        saved += 1
                    # Print sample for the first fighter to verify column mapping
                    if data['fight_history']:
                        sample = data['fight_history'][0]
                        print(f'    ✅ {name} — {saved} fights | '
                              f'method={sample["method"] or "?"} '
                              f'r{sample["round"]} '
                              f'td={sample["takedowns_landed"]} '
                              f'sub={sample["submission_attempts"]} '
                              f'date={sample["fight_date"]}')
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
