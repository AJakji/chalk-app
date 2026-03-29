const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/ufc/event — upcoming event with full fight card
router.get('/event', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        e.id, e.event_name, e.event_date, e.location, e.is_ppv,
        json_agg(
          json_build_object(
            'id',                   f.id,
            'fighter_a',            f.fighter_a_name,
            'fighter_b',            f.fighter_b_name,
            'weight_class',         f.weight_class,
            'is_main_event',        f.is_main_event,
            'is_title_fight',       f.is_title_fight,
            'fighter_a_moneyline',  f.fighter_a_moneyline,
            'fighter_b_moneyline',  f.fighter_b_moneyline,
            'card_position',        f.card_position
          ) ORDER BY f.card_position
        ) AS fights
      FROM ufc_events e
      JOIN ufc_upcoming_fights f ON f.event_id = e.id
      WHERE e.event_date >= CURRENT_DATE
      GROUP BY e.id
      ORDER BY e.event_date
      LIMIT 1
    `);

    if (!result.rows.length) return res.json({ event: null, fights: [] });

    const row = result.rows[0];
    res.json({ event: row, fights: row.fights || [] });
  } catch (err) {
    console.error('UFC /event error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ufc/projections/:fightId
router.get('/projections/:fightId', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM ufc_projections
      WHERE fight_id = $1
      ORDER BY confidence_score DESC
    `, [req.params.fightId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ufc/fighter/:name
router.get('/fighter/:name', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT f.*,
        json_agg(
          json_build_object(
            'result',      fl.result,
            'method',      fl.method,
            'opponent',    fl.opponent_name,
            'round',       fl.round_finished,
            'sig_strikes', fl.sig_strikes_landed,
            'takedowns',   fl.takedowns_landed,
            'date',        fl.fight_date
          ) ORDER BY fl.fight_date DESC
        ) AS fight_history
      FROM ufc_fighters f
      LEFT JOIN ufc_fight_logs fl ON fl.fighter_id = f.id
      WHERE f.fighter_name ILIKE $1
      GROUP BY f.id
      LIMIT 1
    `, [`%${req.params.name}%`]);

    if (!result.rows.length) return res.status(404).json({ error: 'Fighter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ufc/picks — top moneyline picks for upcoming event
router.get('/picks', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        p.fighter_name, p.opponent_name, p.prop_type,
        p.proj_value, p.confidence_score, p.market_line,
        p.edge, p.factors_json, p.fight_date,
        e.event_name, e.is_ppv
      FROM ufc_projections p
      JOIN ufc_upcoming_fights f ON f.id = p.fight_id
      JOIN ufc_events e ON e.id = f.event_id
      WHERE p.fight_date >= CURRENT_DATE
        AND p.prop_type = 'moneyline'
        AND p.confidence_score >= 65
      ORDER BY p.confidence_score DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
