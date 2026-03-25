const express = require('express');
const router = express.Router();
const { fetchAllScores, fetchScoresForDate } = require('../services/scores');

// GET /api/scores/today?date=YYYY-MM-DD
// Omitting date (or date=today) returns today's live data.
// Providing a past/future date fetches scores for that day.
router.get('/today', async (req, res) => {
  const dateParam = req.query.date; // 'YYYY-MM-DD' or undefined

  // Determine if we're looking at today
  const todayStr = new Date().toISOString().split('T')[0];
  const isToday = !dateParam || dateParam === todayStr;

  try {
    const games = isToday
      ? await fetchAllScores()
      : await fetchScoresForDate(dateParam);
    res.json({ games });
  } catch (err) {
    console.error('Error fetching scores:', err.message);
    res.status(500).json({ error: 'Failed to load scores', detail: err.message });
  }
});

module.exports = router;
