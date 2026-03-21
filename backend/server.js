require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { clerkAuth } = require('./middleware/auth');
const { generatePicks } = require('./services/aiPicks');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(clerkAuth); // attach Clerk auth info to every request (non-blocking)

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/picks', require('./routes/picks'));
app.use('/api/users', require('./routes/users'));

// Health check — Railway and monitoring tools hit this
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Cron: Generate picks daily at 8:00 AM Eastern ───────────────────────────
// Disabled in MOCK_MODE to avoid API credit usage during development.
// Flip MOCK_MODE=false in .env when ready to go live.
if (process.env.MOCK_MODE !== 'true') {
  cron.schedule('0 13 * * *', async () => {
    console.log('⏰ Daily cron: generating today\'s picks...');
    try {
      const picks = await generatePicks();
      console.log(`✅ Cron: generated ${picks.length} picks`);
    } catch (err) {
      console.error('❌ Cron pick generation failed:', err.message);
    }
  }, { timezone: 'America/New_York' });
} else {
  console.log('ℹ️  MOCK_MODE=true — cron job disabled, no API credits used');
}

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎯 Chalk API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Picks:  http://localhost:${PORT}/api/picks/today\n`);
});
