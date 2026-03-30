const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ── POST /api/reports/research ────────────────────────────────────────────────
// Stores a user-submitted report about a bad Chalky answer.
// Body: { question, chalkyResponse, details, sport, screenshotBase64 }
router.post('/research', async (req, res) => {
  const { question, chalkyResponse, details, sport, screenshotBase64 } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  const userId      = req.auth?.userId || null;
  const screenshotUrl = screenshotBase64 || null; // stored as base64 for now

  try {
    await db.query(
      `INSERT INTO research_reports
         (user_id, question, chalky_response, details, sport, screenshot_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, question, chalkyResponse || null, details || null, sport || null, screenshotUrl]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[reports] Failed to store report:', err.message);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// ── POST /api/reports/feedback ────────────────────────────────────────────────
// Stores user-submitted support reports and feature suggestions.
// Body: { type, message, userEmail, userId }
router.post('/feedback', async (req, res) => {
  const { type, message, userEmail, userId, screenshotBase64 } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message required' });
  }

  const prefix = type === 'support' ? '[SUPPORT] ' : '[SUGGESTION] ';

  try {
    await db.query(
      `INSERT INTO research_reports
         (user_id, question, chalky_response, sport, status, screenshot_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId || null, prefix + message.trim(), userEmail || 'anonymous', type, 'open', screenshotBase64 || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[reports] Failed to store feedback:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ── GET /api/reports/admin?secret=... ─────────────────────────────────────────
// Simple admin view — browse open reports in a browser.
router.get('/admin', async (req, res) => {
  const { secret } = req.query;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await db.query(
      `SELECT
         id, user_id, question, chalky_response, details, sport, status,
         screenshot_url IS NOT NULL AS has_screenshot,
         created_at
       FROM research_reports
       ORDER BY created_at DESC
       LIMIT 100`
    );
    res.json({ reports: rows });
  } catch (err) {
    console.error('[reports] Admin fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

module.exports = router;
