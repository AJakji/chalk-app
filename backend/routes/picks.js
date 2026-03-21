const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { generatePicks, getTodaysPicks } = require('../services/aiPicks');
const db = require('../db');

const MOCK_PICKS = [
  {
    id: 'mock-1', league: 'NBA', sport_key: 'basketball_nba', pick_type: 'Spread',
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
    id: 'mock-2', league: 'NFL', sport_key: 'americanfootball_nfl', pick_type: 'Total',
    away_team: 'Buffalo Bills', home_team: 'Kansas City Chiefs',
    game_time: 'Sunday 4:25 PM ET', game_id: 'mock-g2',
    pick_value: 'Over 51.5', confidence: 76, result: null,
    short_reason: 'Elite QBs, fast pace, weak secondaries on both sides',
    odds_data: { draftkings: '-115', fanduel: '-112', betmgm: '-110', bet365: '-113' },
    analysis: {
      summary: 'Mahomes vs Allen — two elite QBs in ideal scoring conditions. Both offenses rank top-5 in pace and both defenses have struggled defending the deep ball this season.',
      sections: [
        { title: 'Why This Pick', icon: '🎯', content: 'When Mahomes and Allen face each other, the over has hit 7 of their last 9 matchups. Combined TDs average 6.2 per game.' },
        { title: 'Line Value',    icon: '💰', content: 'BetMGM offering -110 vs the market standard -115. Small edge worth taking on a high-confidence over.' },
        { title: 'Key Risk',      icon: '⚠️', content: 'Wind above 15 mph kills passing offenses. Check forecast at game time — current projection is 8 mph.' },
      ],
      keyStats: [
        { label: 'Over % in Mahomes/Allen games', value: '7-2', pct: 78 },
        { label: 'Chiefs Scoring Avg',            value: '29.4 PPG', pct: 75 },
        { label: 'Model Confidence',              value: '76%', pct: 76 },
      ],
      trends: [
        'Over 7-2 in last 9 Mahomes vs Allen matchups',
        'Chiefs over 27 points in 8 of last 10 home games',
        'Bills score 35+ in 5 of last 7 road games',
      ],
    },
  },
  {
    id: 'mock-3', league: 'NBA', sport_key: 'basketball_nba', pick_type: 'Moneyline',
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
];

// GET /api/picks/today
// In MOCK_MODE: returns static picks instantly — no API credits used.
// In live mode: fetches from DB, generates via Claude if none exist yet.
router.get('/today', async (req, res) => {
  if (process.env.MOCK_MODE === 'true') {
    return res.json({ picks: MOCK_PICKS, mock: true, generatedAt: new Date().toISOString() });
  }

  try {
    let picks = await getTodaysPicks();
    if (picks.length === 0) {
      console.log('No picks for today yet — generating now...');
      await generatePicks();
      picks = await getTodaysPicks();
    }
    res.json({ picks, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error fetching today\'s picks:', err);
    res.status(500).json({ error: 'Failed to load picks. Try again shortly.' });
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
    const picks = await generatePicks();
    res.json({ generated: picks.length, picks });
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
