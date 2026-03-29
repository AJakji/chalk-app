"""
UFC Projection Model — generates fight winner, method, round, and
fighter prop projections from historical fight data in PostgreSQL.
"""
import psycopg2
import os
import json
from datetime import date


# ── helpers ──────────────────────────────────────────────────────────────────

def get_fighter_logs(conn, fighter_name, last_n=10):
    cur = conn.cursor()
    cur.execute("""
        SELECT fl.result, fl.method, fl.round_finished,
               fl.sig_strikes_landed, fl.sig_strikes_attempted,
               fl.takedowns_landed, fl.takedowns_attempted,
               fl.submission_attempts, fl.control_time_seconds,
               fl.knockdowns, fl.fight_date, fl.opponent_name
        FROM ufc_fight_logs fl
        JOIN ufc_fighters f ON f.id = fl.fighter_id
        WHERE f.fighter_name ILIKE %s
        ORDER BY fl.fight_date DESC
        LIMIT %s
    """, [f'%{fighter_name}%', last_n])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def get_fighter_record(conn, fighter_name):
    cur = conn.cursor()
    cur.execute("""
        SELECT record_wins, record_losses, record_draws
        FROM ufc_fighters WHERE fighter_name ILIKE %s LIMIT 1
    """, [f'%{fighter_name}%'])
    row = cur.fetchone()
    return {'wins': row[0], 'losses': row[1], 'draws': row[2]} if row else {'wins': 0, 'losses': 0, 'draws': 0}


def avg(fights, field, default=0):
    vals = [f.get(field) or 0 for f in fights if f.get(field) is not None]
    return round(sum(vals) / len(vals), 3) if vals else default


def win_rate(fights):
    if not fights: return 0.5
    wins = sum(1 for f in fights if (f.get('result') or '').upper() in ('W', 'WIN'))
    return round(wins / len(fights), 3)


def finish_rate(fights):
    if not fights: return 0.5
    fins = sum(1 for f in fights if f.get('method') in ('KO/TKO', 'Submission'))
    return round(fins / len(fights), 3)


def ko_rate(fights):
    if not fights: return 0.25
    return round(sum(1 for f in fights if f.get('method') == 'KO/TKO') / len(fights), 3)


def sub_rate(fights):
    if not fights: return 0.15
    return round(sum(1 for f in fights if f.get('method') == 'Submission') / len(fights), 3)


def ml_to_prob(ml):
    if not ml: return 0.5
    return 100 / (ml + 100) if ml > 0 else abs(ml) / (abs(ml) + 100)


def classify_style(fights):
    if not fights: return 'WELL_ROUNDED'
    a_td  = avg(fights, 'takedowns_landed')
    a_sub = avg(fights, 'submission_attempts')
    a_sig = avg(fights, 'sig_strikes_landed')
    a_ko  = ko_rate(fights)
    if a_ko > 0.4 and a_td < 1.0:   return 'STRIKER'
    if a_td > 2.0 and a_sig < 30:   return 'WRESTLER'
    if a_sub > 1.5:                  return 'SUBMISSION_ARTIST'
    return 'WELL_ROUNDED'


# ── core projection ───────────────────────────────────────────────────────────

def project_fight(conn, fa, fb, weight_class, ml_a=None, ml_b=None):
    logs_a = get_fighter_logs(conn, fa)
    logs_b = get_fighter_logs(conn, fb)

    # Per-fighter aggregates
    wr_a, wr_b         = win_rate(logs_a),    win_rate(logs_b)
    fr_a, fr_b         = finish_rate(logs_a), finish_rate(logs_b)
    ko_a, ko_b         = ko_rate(logs_a),     ko_rate(logs_b)
    sub_a, sub_b       = sub_rate(logs_a),    sub_rate(logs_b)
    sig_a, sig_b       = avg(logs_a, 'sig_strikes_landed', 40), avg(logs_b, 'sig_strikes_landed', 40)
    td_a, td_b         = avg(logs_a, 'takedowns_landed', 1),    avg(logs_b, 'takedowns_landed', 1)
    style_a, style_b   = classify_style(logs_a), classify_style(logs_b)

    # Market probs
    mp_a = ml_to_prob(ml_a) if ml_a else 0.5
    mp_b = 1 - mp_a

    # Model adjustments
    adj = (wr_a - wr_b) * 0.30 + (fr_a - fr_b) * 0.10
    if sig_a + sig_b > 0:
        adj += ((sig_a - sig_b) / (sig_a + sig_b)) * 0.15
    # Style matchup
    if style_a == 'WRESTLER'          and style_b == 'STRIKER':          adj += 0.05
    elif style_a == 'STRIKER'         and style_b == 'WRESTLER':         adj -= 0.05
    elif style_a == 'SUBMISSION_ARTIST' and style_b == 'WRESTLER':       adj += 0.04

    model_a = max(0.05, min(0.95, mp_a * 0.6 + (mp_a + adj) * 0.4)) if ml_a else max(0.05, min(0.95, 0.5 + adj))
    model_b = 1 - model_a
    edge_a  = model_a - mp_a

    # Method probs
    comb_ko  = round((ko_a + ko_b) / 2, 3)
    comb_sub = round((sub_a + sub_b) / 2, 3)
    comb_fin = round((fr_a + fr_b) / 2, 3)
    prob_dec = round(max(0.1, 1 - comb_fin), 3)

    # Round probs from history
    all_rounds = [f['round_finished'] for f in logs_a + logs_b if (f.get('round_finished') or 0) > 0]
    if all_rounds:
        r1 = len([r for r in all_rounds if r == 1]) / len(all_rounds)
        r2 = len([r for r in all_rounds if r == 2]) / len(all_rounds)
        r3 = len([r for r in all_rounds if r >= 3]) / len(all_rounds)
    else:
        r1, r2, r3 = 0.25, 0.25, 0.15

    r1f = round(r1 * comb_fin, 3)
    r2f = round(r2 * comb_fin, 3)
    r3f = round(r3 * comb_fin, 3)

    # Projected props (simple blend of own avg + opponent allowed)
    sig_proj_a = round(sig_a * 0.6 + sig_b * 0.4, 1)
    td_proj_a  = round(td_a  * 0.6 + td_b  * 0.4, 1)
    sig_proj_b = round(sig_b * 0.6 + sig_a * 0.4, 1)
    td_proj_b  = round(td_b  * 0.6 + td_a  * 0.4, 1)

    def conf(n_fights, edge_val, base=60):
        c = base + (10 if n_fights >= 10 else 5 if n_fights >= 5 else 0) + abs(edge_val) * 80
        return min(90, max(50, int(c)))

    factors_a = {
        'style': style_a, 'style_b': style_b,
        'win_rate_l10': wr_a, 'finish_rate': fr_a, 'ko_rate': ko_a, 'sub_rate': sub_a,
        'avg_sig': sig_a, 'avg_td': td_a, 'market_prob': mp_a,
        'model_prob': round(model_a, 3), 'edge': round(edge_a, 3),
        'fights_sampled': len(logs_a),
        'method_probs': {'ko_tko': comb_ko, 'submission': comb_sub, 'decision': prob_dec},
        'round_probs': {'r1': r1f, 'r2': r2f, 'r3plus': r3f, 'decision': prob_dec},
    }

    return {
        'a': {'name': fa, 'win_prob': round(model_a, 3), 'market_prob': mp_a,
              'edge': round(edge_a, 3), 'conf': conf(len(logs_a), edge_a),
              'sig_proj': sig_proj_a, 'td_proj': td_proj_a, 'style': style_a, 'factors': factors_a},
        'b': {'name': fb, 'win_prob': round(model_b, 3), 'market_prob': mp_b,
              'edge': round(-edge_a, 3), 'conf': conf(len(logs_b), -edge_a),
              'sig_proj': sig_proj_b, 'td_proj': td_proj_b, 'style': style_b,
              'factors': {'style': style_b, 'win_rate_l10': wr_b, 'fights_sampled': len(logs_b)}},
        'method': {'ko_tko': comb_ko, 'submission': comb_sub, 'decision': prob_dec},
        'rounds': {'r1': r1f, 'r2': r2f, 'r3plus': r3f},
        'weight_class': weight_class,
    }


def upsert_proj(conn, fight_id, event_name, fight_date, fighter, opponent,
                prop_type, value, confidence, market_line, edge, factors):
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO ufc_projections
            (fight_id, event_name, fight_date, fighter_name, opponent_name,
             prop_type, proj_value, confidence_score, market_line, edge, factors_json, game_date)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (fight_id, fighter_name, prop_type) DO UPDATE SET
            proj_value = EXCLUDED.proj_value,
            confidence_score = EXCLUDED.confidence_score,
            market_line = EXCLUDED.market_line,
            edge = EXCLUDED.edge,
            factors_json = EXCLUDED.factors_json
    """, [fight_id, event_name, fight_date, fighter, opponent,
          prop_type, value, confidence, market_line, edge,
          json.dumps(factors), fight_date])
    conn.commit()


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()

    print('Running UFC projection model...')
    cur.execute("""
        SELECT id, event_name, fight_date, fighter_a_name, fighter_b_name,
               weight_class, fighter_a_moneyline, fighter_b_moneyline
        FROM ufc_upcoming_fights
        WHERE fight_date >= CURRENT_DATE
        ORDER BY fight_date, card_position
    """)
    fights = cur.fetchall()
    print(f'Found {len(fights)} upcoming fights')

    total = 0
    for row in fights:
        fid, ename, fdate, fa, fb, wc, ml_a, ml_b = row
        print(f'  Projecting: {fa} vs {fb}')
        try:
            p = project_fight(conn, fa, fb, wc, ml_a, ml_b)
            a, b, meth, rnds = p['a'], p['b'], p['method'], p['rounds']

            # Fighter A — moneyline
            upsert_proj(conn, fid, ename, fdate, fa, fb, 'moneyline',
                        a['win_prob'], a['conf'], ml_a, a['edge'], a['factors'])
            # Fighter B — moneyline
            upsert_proj(conn, fid, ename, fdate, fb, fa, 'moneyline',
                        b['win_prob'], b['conf'], ml_b, b['edge'], b['factors'])

            # Method props (both fighters share these)
            for prop, val in [('ko_tko', meth['ko_tko']),
                               ('submission', meth['submission']),
                               ('decision', meth['decision'])]:
                c = max(50, min(85, int(val * 100 + 50)))
                upsert_proj(conn, fid, ename, fdate, fa, fb, prop, val, c, None, 0, {'prob': val})

            # Round props
            for prop, val in [('round_1', rnds['r1']),
                               ('round_2', rnds['r2']),
                               ('round_3_plus', rnds['r3plus'])]:
                c = max(50, min(82, int(val * 150 + 50)))
                upsert_proj(conn, fid, ename, fdate, fa, fb, prop, val, c, None, 0, {'prob': val})

            # Fighter props
            upsert_proj(conn, fid, ename, fdate, fa, fb, 'sig_strikes',
                        a['sig_proj'], 65, None, 0, {'proj': a['sig_proj']})
            upsert_proj(conn, fid, ename, fdate, fa, fb, 'takedowns',
                        a['td_proj'], 62, None, 0, {'proj': a['td_proj']})
            upsert_proj(conn, fid, ename, fdate, fb, fa, 'sig_strikes',
                        b['sig_proj'], 65, None, 0, {'proj': b['sig_proj']})
            upsert_proj(conn, fid, ename, fdate, fb, fa, 'takedowns',
                        b['td_proj'], 62, None, 0, {'proj': b['td_proj']})

            total += 1
        except Exception as e:
            print(f'  Error: {fa} vs {fb}: {e}')

    print(f'\n✅ UFC model complete — {total} fights projected')
    conn.close()


if __name__ == '__main__':
    main()
