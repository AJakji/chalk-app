const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { generateModelPicks, generatePicks, getTodaysPicks } = require('../services/aiPicks');
const { generatePropPicks } = require('../services/propPicks');
const db = require('../db');
const { getTodayET } = require('../utils/dateUtils');

const MOCK_PICKS = [
  // ── GAME PICKS ────────────────────────────────────────────────────────────
  {
    id: 'mock-1', league: 'NBA', sport_key: 'basketball_nba', pick_type: 'Spread',
    pick_category: 'game',
    away_team: 'Golden State Warriors', home_team: 'Boston Celtics',
    game_time: 'Tonight 7:30 PM ET', game_id: 'mock-g1',
    pick_value: 'Celtics -4.5', confidence: 84, result: null,
    short_reason: 'Celtics dominant at home — Warriors on a back-to-back',
    odds_data: { draftkings: '-110', fanduel: '-108', betmgm: '-112', bet365: '-109' },
    analysis: {
      summary: 'Boston is 18-4 ATS at home this season. Golden State is playing the second game of a back-to-back after a loss in New York. The Celtics defend at an elite level and Curry is questionable.',
      sections: [
        { title: 'Why This Pick', icon: '🎯', content: 'Celtics are 18-4 ATS at home — one of the best records in the NBA. Home crowd and defensive intensity consistently lifts their game.' },
        { title: 'Line Value',    icon: '💰', content: 'Warriors on a B2B drop ATS to 2-8 this season. The -4.5 line is underpriced given Boston\'s home dominance.' },
        { title: 'Key Risk',      icon: '⚠️', content: 'If Steph Curry is confirmed healthy at tip-off, the line moves fast. Monitor injury report 90 minutes before tip.' },
      ],
      keyStats: [
        { label: 'Boston Home ATS',   value: '18-4', pct: 82 },
        { label: 'Warriors B2B ATS',  value: '2-8',  pct: 20 },
        { label: 'Model Confidence',  value: '84%',  pct: 84 },
      ],
      trends: [
        'Celtics 7-1 ATS in last 8 home games',
        'Warriors 2-8 ATS on back-to-backs this season',
        'Boston covers by 6+ when opponent is on a B2B',
      ],
    },
  },
  {
    id: 'mock-3', league: 'NBA', sport_key: 'basketball_nba', pick_type: 'Moneyline',
    pick_category: 'game',
    away_team: 'Denver Nuggets', home_team: 'LA Lakers',
    game_time: 'Tonight 10:00 PM ET', game_id: 'mock-g3',
    pick_value: 'Nuggets ML', confidence: 71, result: null,
    short_reason: 'Jokic triple-double machine vs a LeBron-less Lakers',
    odds_data: { draftkings: '-135', fanduel: '-130', betmgm: '-140', bet365: '-132' },
    analysis: {
      summary: 'LeBron is out with a left ankle sprain. Without him the Lakers are 6-14 this season. Jokic is averaging a triple-double over his last 5 games and owns this matchup historically.',
      sections: [
        { title: 'Why This Pick', icon: '🎯', content: 'LeBron ruled out. LA drops from 116.2 to 107.4 PPG without him. Denver\'s model projects a 71% win probability at these odds.' },
        { title: 'Line Value',    icon: '💰', content: 'FanDuel offers -130 vs BetMGM -140 — a meaningful difference on a short-priced ML. Best value is FD.' },
        { title: 'Key Risk',      icon: '⚠️', content: 'Anthony Davis is capable of carrying the Lakers alone. If he drops 35+, this one gets interesting late.' },
      ],
      keyStats: [
        { label: 'Lakers Without LeBron', value: '6-14', pct: 30 },
        { label: 'Jokic Last 5 Avg',      value: '28/13/9', pct: 88 },
        { label: 'Model Confidence',      value: '71%', pct: 71 },
      ],
      trends: [
        'Lakers 6-14 SU without LeBron this season',
        'Jokic 6 triple-doubles in last 10 vs LA',
        'Denver 14-7 ATS on the road this season',
      ],
    },
  },
  // ── PLAYER PROP PICKS ─────────────────────────────────────────────────────
  {
    id: 'mock-prop-1', league: 'NBA', sport_key: 'basketball_nba', pick_type: 'Player Prop',
    pick_category: 'prop',
    player_name: 'Nikola Jokic', player_team: 'Denver Nuggets', player_position: 'C',
    away_team: 'Denver Nuggets', home_team: 'LA Lakers',
    game_time: 'Tonight 10:00 PM ET', game_id: 'mock-g3',
    matchup_text: 'vs LAL · Tonight 10:00 PM ET',
    pick_value: 'Over 11.5 Rebounds', confidence: 82, result: null,
    short_reason: "Jokic averaging 13.1 boards last 5 — Lakers can't box him out",
    odds_data: { draftkings: '-115', fanduel: '-118', betmgm: '-120', bet365: '-112' },
    analysis: {
      summary: "Jokic has cleared 11.5 rebounds in 4 of his last 5 games. The Lakers rank 28th in defensive rebound rate, giving up second-chance opportunities at will. At -112 on bet365, this is clean value.",
      sections: [
        { title: 'Why This Prop', icon: '🎯', content: 'Jokic is averaging 13.1 rebounds in his last 5 games. The Lakers play small without LeBron and struggle on the boards.' },
        { title: 'Line Value',   icon: '💰', content: 'The 11.5 line is conservative. Our projection puts Jokic at 13.4 boards tonight — nearly 2 full boards of edge over the line.' },
        { title: 'Key Risk',     icon: '⚠️', content: 'Anthony Davis is an elite rebounder. If Davis dominates the paint, some of Jokic\'s boards could dry up late.' },
      ],
      keyStats: [
        { label: 'Last 5 Games Avg',  value: '13.1 REB', pct: 82 },
        { label: 'Hit Rate (L10)',     value: '8/10',     pct: 80 },
        { label: 'Model Confidence',  value: '82%',      pct: 82 },
      ],
      trends: [
        'Jokic 8/10 Over 11.5 REB in last 10 games',
        'Lakers rank 28th in opponent defensive rebound rate',
        'Jokic averages 14.2 REB vs LAL historically',
      ],
      last10Games: [
        { date: 'Mar 20', opp: 'GSW', result: 'W', stat: 15 },
        { date: 'Mar 18', opp: 'MEM', result: 'W', stat: 14 },
        { date: 'Mar 16', opp: 'PHX', result: 'W', stat: 12 },
        { date: 'Mar 14', opp: 'SAS', result: 'W', stat: 9 },
        { date: 'Mar 12', opp: 'HOU', result: 'L', stat: 13 },
        { date: 'Mar 10', opp: 'MIL', result: 'W', stat: 16 },
        { date: 'Mar 8',  opp: 'BOS', result: 'L', stat: 11 },
        { date: 'Mar 6',  opp: 'NYK', result: 'W', stat: 14 },
        { date: 'Mar 4',  opp: 'IND', result: 'W', stat: 12 },
        { date: 'Mar 2',  opp: 'OKC', result: 'L', stat: 8 },
      ],
      seasonAvg: 13.1, propLine: 11.5,
      homeAvg: 13.8,   awayAvg: 12.3,
      vsOppHistory: 14.2, injuryStatus: 'Active',
    },
  },
  {
    id: 'mock-prop-2', league: 'NBA', sport_key: 'basketball_nba', pick_type: 'Player Prop',
    pick_category: 'prop',
    player_name: 'Stephen Curry', player_team: 'Golden State Warriors', player_position: 'PG',
    away_team: 'Golden State Warriors', home_team: 'Boston Celtics',
    game_time: 'Tonight 7:30 PM ET', game_id: 'mock-g1',
    matchup_text: '@ BOS · Tonight 7:30 PM ET',
    pick_value: 'Over 4.5 Three-Pointers', confidence: 76, result: null,
    short_reason: "Curry bombing away — 5.8 threes per game over his last 8",
    odds_data: { draftkings: '-120', fanduel: '-115', betmgm: '-125', bet365: '-118' },
    analysis: {
      summary: "Curry has hit 5+ threes in 6 of his last 8 games and is averaging 5.8 per game in that stretch. Boston allows the 18th most threes per game. At -115 on FanDuel, this is legitimate value.",
      sections: [
        { title: 'Why This Prop', icon: '🎯', content: "Curry is in one of his shooting stretches — 5.8 threes per game over his last 8. He shoots regardless of game script, making this a volume play." },
        { title: 'Line Value',   icon: '💰', content: 'FanDuel -115 is 10 cents better than BetMGM -125. With a 76% hit rate in our model, this is clearly +EV at -115.' },
        { title: 'Key Risk',     icon: '⚠️', content: "Boston has Al Horford defending threes at a high rate. If Curry faces heavy attention in the corners, his attempts could be capped." },
      ],
      keyStats: [
        { label: 'Last 8 Games Avg', value: '5.8 3PM', pct: 76 },
        { label: 'Hit Rate (L10)',   value: '7/10',    pct: 70 },
        { label: 'Model Confidence', value: '76%',     pct: 76 },
      ],
      trends: [
        'Curry hit 5+ threes in 6 of his last 8 games',
        'Boston allows 18th most threes per game this season',
        'Curry averages 4.9 threes on the road this season',
      ],
      last10Games: [
        { date: 'Mar 20', opp: 'MEM', result: 'W', stat: 7 },
        { date: 'Mar 18', opp: 'IND', result: 'W', stat: 6 },
        { date: 'Mar 16', opp: 'HOU', result: 'W', stat: 5 },
        { date: 'Mar 14', opp: 'OKC', result: 'L', stat: 3 },
        { date: 'Mar 12', opp: 'MIL', result: 'W', stat: 7 },
        { date: 'Mar 10', opp: 'PHX', result: 'W', stat: 6 },
        { date: 'Mar 8',  opp: 'SAS', result: 'L', stat: 4 },
        { date: 'Mar 6',  opp: 'DEN', result: 'W', stat: 5 },
        { date: 'Mar 4',  opp: 'LAL', result: 'W', stat: 6 },
        { date: 'Mar 2',  opp: 'NYK', result: 'L', stat: 2 },
      ],
      seasonAvg: 4.9, propLine: 4.5,
      homeAvg: 5.1,   awayAvg: 4.8,
      vsOppHistory: 4.7, injuryStatus: 'Questionable (knee bruise)',
    },
  },
];

// GET /api/picks
// Chalky's Picks tab — top 7 across all sports by confidence, Moneyline excluded.
// Optional: ?sport=NBA → top 5 for that sport (legacy query-param support).
router.get('/', async (req, res) => {
  if (false) { // mock mode disabled in production
    let mock = [...MOCK_PICKS].filter(p => p.pick_type !== 'Moneyline').sort((a, b) => b.confidence - a.confidence);
    if (req.query.sport) mock = mock.filter(p => p.league === req.query.sport);
    const limit = parseInt(req.query.limit || (req.query.sport ? '5' : '7'), 10);
    return res.json({ picks: mock.slice(0, limit) });
  }

  try {
    const today = req.query.date || getTodayET();
    const sport = req.query.sport || null;
    const limit = parseInt(req.query.limit || (sport ? '5' : '7'), 10);

    let query, params;
    if (sport) {
      query  = `SELECT * FROM picks WHERE pick_date = $1 AND league = $2 AND pick_type != 'Moneyline' ORDER BY confidence DESC LIMIT $3`;
      params = [today, sport, limit];
    } else {
      query  = `SELECT * FROM picks WHERE pick_date = $1 AND pick_type != 'Moneyline' ORDER BY confidence DESC LIMIT $2`;
      params = [today, limit];
    }

    const { rows } = await db.query(query, params);
    res.json({ picks: rows });
  } catch (err) {
    console.error('Error fetching picks:', err);
    res.status(500).json({ error: 'Failed to load picks' });
  }
});

// GET /api/picks/counts
// Returns capped pick counts for today's tab badges.
// Chalky's ≤7, each sport tab ≤5. Moneyline picks excluded.
router.get('/counts', async (req, res) => {
  if (false) { // mock mode disabled in production
    return res.json({ counts: { CHALKY: 7, NBA: 5, NHL: 5, MLB: 5 } });
  }

  try {
    const today = req.query.date || getTodayET();
    const { rows } = await db.query(
      `SELECT
         LEAST(COUNT(*), 7)                                         AS chalky,
         LEAST(COUNT(*) FILTER (WHERE league = 'NBA'), 5)           AS nba,
         LEAST(COUNT(*) FILTER (WHERE league = 'NHL'), 5)           AS nhl,
         LEAST(COUNT(*) FILTER (WHERE league = 'MLB'), 5)           AS mlb
       FROM picks
       WHERE pick_date = $1
         AND pick_type != 'Moneyline'`,
      [today]
    );
    const r = rows[0] || {};
    res.json({
      counts: {
        CHALKY: parseInt(r.chalky, 10) || 0,
        NBA:    parseInt(r.nba,    10) || 0,
        NHL:    parseInt(r.nhl,    10) || 0,
        MLB:    parseInt(r.mlb,    10) || 0,
      }
    });
  } catch (err) {
    console.error('Error fetching pick counts:', err);
    res.status(500).json({ counts: {} });
  }
});

// GET /api/picks/today
// In MOCK_MODE: returns static picks instantly — no API credits used.
// In live mode: returns picks from DB immediately. If none exist yet, responds with
// generating:true and fires the full pipeline in the background (Railway has a 30s
// HTTP timeout — awaiting Claude synchronously would cause an empty response).
router.get('/today', async (req, res) => {
  if (false) { // mock mode disabled in production
    return res.json({ picks: MOCK_PICKS, mock: true, generatedAt: new Date().toISOString() });
  }

  try {
    const picks = await getTodaysPicks();
    if (picks.length > 0) {
      return res.json({ picks, generatedAt: new Date().toISOString() });
    }

    // No picks yet — respond immediately so Railway doesn't time out,
    // then generate in the background so they're ready for the next poll.
    res.json({ picks: [], generating: true, generatedAt: new Date().toISOString() });

    // Fire-and-forget: do NOT await — response is already sent above
    console.log('[/picks/today] No picks found — triggering background generation…');
    generateModelPicks()
      .catch(e => console.error('[/picks/today] bg generateModelPicks error:', e.message));
    Promise.allSettled([generatePicks(), generatePropPicks()])
      .catch(() => {});

  } catch (err) {
    console.error('Error fetching today\'s picks:', err);
    // Even on error, return empty array rather than 500 (client can retry)
    res.status(500).json({ error: 'Failed to load picks. Try again shortly.' });
  }
});

// GET /api/picks/counts/recent
// Returns pick counts for the most recent date that has picks.
// Used as fallback badge counts when today = 0.
router.get('/counts/recent', async (req, res) => {
  if (false) { // mock mode disabled in production
    return res.json({ counts: { CHALKY: 7, NBA: 5, NHL: 5, MLB: 5 } });
  }

  try {
    const { rows } = await db.query(
      `SELECT
         LEAST(COUNT(*), 7)                                         AS chalky,
         LEAST(COUNT(*) FILTER (WHERE league = 'NBA'), 5)           AS nba,
         LEAST(COUNT(*) FILTER (WHERE league = 'NHL'), 5)           AS nhl,
         LEAST(COUNT(*) FILTER (WHERE league = 'MLB'), 5)           AS mlb
       FROM picks
       WHERE pick_date = (SELECT MAX(pick_date) FROM picks WHERE pick_type != 'Moneyline')
         AND pick_type != 'Moneyline'`
    );
    const r = rows[0] || {};
    res.json({
      counts: {
        CHALKY: parseInt(r.chalky, 10) || 0,
        NBA:    parseInt(r.nba,    10) || 0,
        NHL:    parseInt(r.nhl,    10) || 0,
        MLB:    parseInt(r.mlb,    10) || 0,
      }
    });
  } catch (err) {
    console.error('Error fetching recent pick counts:', err);
    res.status(500).json({ counts: {} });
  }
});

// GET /api/picks/recent
// Returns picks from the most recent date that has any picks.
// Used as a fallback when today has 0 picks (pipeline still running or failed).
// Optional: ?sport=NBA → most recent picks for that sport only
// No sport → Chalky's Picks, default LIMIT 7
router.get('/recent', async (req, res) => {
  if (false) { // mock mode disabled in production
    return res.json({ picks: MOCK_PICKS.slice(0, 7) });
  }

  try {
    const sport = req.query.sport || null;
    const limit = parseInt(req.query.limit || (sport ? '5' : '7'), 10);

    let rows;
    if (sport) {
      ({ rows } = await db.query(
        `SELECT * FROM picks
         WHERE league = $1
           AND pick_type != 'Moneyline'
           AND pick_date = (
             SELECT MAX(pick_date) FROM picks WHERE league = $1 AND pick_type != 'Moneyline'
           )
         ORDER BY confidence DESC
         LIMIT $2`,
        [sport, limit]
      ));
    } else {
      ({ rows } = await db.query(
        `SELECT * FROM picks
         WHERE pick_date = (SELECT MAX(pick_date) FROM picks WHERE pick_type != 'Moneyline')
           AND pick_type != 'Moneyline'
         ORDER BY confidence DESC
         LIMIT $1`,
        [limit]
      ));
    }

    res.json({ picks: rows });
  } catch (err) {
    console.error('Error fetching recent picks:', err);
    res.status(500).json({ picks: [] });
  }
});

// GET /api/picks/:sport  (NBA | NHL | MLB | NFL | Soccer)
// Sport tab — top 5 picks for that sport by confidence, Moneyline excluded.
// Falls back to most recent date if today has 0 picks.
const VALID_SPORT_TABS = new Set(['NBA', 'NHL', 'MLB', 'NFL', 'SOCCER', 'SOCCER']);
router.get('/:sport', async (req, res, next) => {
  const sport = req.params.sport.toUpperCase();
  if (!VALID_SPORT_TABS.has(sport)) return next(); // fall through to /:id handler

  try {
    const today = getTodayET();
    const { rows } = await db.query(
      `SELECT * FROM picks
       WHERE pick_date = $1
         AND league = $2
         AND pick_type != 'Moneyline'
       ORDER BY confidence DESC
       LIMIT 5`,
      [today, req.params.sport.toUpperCase() === 'SOCCER' ? 'Soccer' : req.params.sport.toUpperCase()]
    );

    if (rows.length > 0) return res.json({ picks: rows });

    // Fallback to most recent date with picks for this sport
    const { rows: recent } = await db.query(
      `SELECT * FROM picks
       WHERE league = $1
         AND pick_type != 'Moneyline'
         AND pick_date = (
           SELECT MAX(pick_date) FROM picks WHERE league = $1 AND pick_type != 'Moneyline'
         )
       ORDER BY confidence DESC
       LIMIT 5`,
      [req.params.sport.toUpperCase()]
    );
    res.json({ picks: recent });
  } catch (err) {
    console.error(`Error fetching ${sport} picks:`, err);
    res.status(500).json({ error: 'Failed to load picks' });
  }
});

// GET /api/picks/:id
// Returns a single pick with full analysis detail.
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM picks WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Pick not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching pick:', err);
    res.status(500).json({ error: 'Failed to load pick' });
  }
});

// POST /api/picks/generate
// Admin-only trigger to regenerate today's picks (e.g. from a cron job or manual refresh).
// Protected by a simple admin secret — replace with proper admin auth before launch.
router.post('/generate', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const [modelPicks, gamePicks, propPicks] = await Promise.allSettled([
      generateModelPicks(),
      generatePicks(),
      generatePropPicks(),
    ]);
    const total = (modelPicks.value?.length || 0) + (gamePicks.value?.length || 0) + (propPicks.value?.length || 0);
    const picks = await getTodaysPicks();
    res.json({ generated: total, picks });
  } catch (err) {
    console.error('Error generating picks:', err);
    res.status(500).json({ error: 'Pick generation failed', detail: err.message });
  }
});

// PATCH /api/picks/:id/result
// Update a pick result once the game ends (win / loss / push).
router.patch('/:id/result', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { result } = req.body;
  if (!['win', 'loss', 'push'].includes(result)) {
    return res.status(400).json({ error: 'result must be win, loss, or push' });
  }

  try {
    const { rows } = await db.query(
      'UPDATE picks SET result = $1 WHERE id = $2 RETURNING *',
      [result, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Pick not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating pick result:', err);
    res.status(500).json({ error: 'Failed to update result' });
  }
});

module.exports = router;
