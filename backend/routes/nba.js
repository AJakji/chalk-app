/**
 * /api/nba — NBA data routes
 *
 * Powers:
 *   - Scores screen live scoreboard + box scores
 *   - Research screen real-data charts
 *   - Pick detail view stats
 */

const express = require('express');
const router = express.Router();
const nba = require('../services/nba');

// ── Scoreboard ──────────────────────────────────────────────────────────────

// GET /api/nba/scoreboard
// Live scoreboard from NBA Live API (30s cache)
router.get('/scoreboard', async (req, res) => {
  try {
    const data = await nba.getScoreboard();
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'NBA scoreboard unavailable', detail: err.message });
  }
});

// GET /api/nba/scoreboard-v2?date=MM/DD/YYYY
// Stats API scoreboard (game IDs, line scores, leaders)
router.get('/scoreboard-v2', async (req, res) => {
  try {
    const data = await nba.getScoreboardV2(req.query.date);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'NBA scoreboard unavailable', detail: err.message });
  }
});

// ── Box Scores ──────────────────────────────────────────────────────────────

// GET /api/nba/boxscore/:gameId/live
router.get('/boxscore/:gameId/live', async (req, res) => {
  try {
    const data = await nba.getLiveBoxScore(req.params.gameId);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Box score unavailable', detail: err.message });
  }
});

// GET /api/nba/boxscore/:gameId/traditional
router.get('/boxscore/:gameId/traditional', async (req, res) => {
  try {
    const data = await nba.getBoxScoreTraditional(req.params.gameId);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Box score unavailable', detail: err.message });
  }
});

// GET /api/nba/boxscore/:gameId/advanced
router.get('/boxscore/:gameId/advanced', async (req, res) => {
  try {
    const data = await nba.getBoxScoreAdvanced(req.params.gameId);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Box score unavailable', detail: err.message });
  }
});

// ── Play-by-Play ────────────────────────────────────────────────────────────

// GET /api/nba/game/:gameId/playbyplay
router.get('/game/:gameId/playbyplay', async (req, res) => {
  try {
    const data = await nba.getPlayByPlay(req.params.gameId);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Play-by-play unavailable', detail: err.message });
  }
});

// GET /api/nba/game/:gameId/win-probability
router.get('/game/:gameId/win-probability', async (req, res) => {
  try {
    const data = await nba.getWinProbability(req.params.gameId);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Win probability unavailable', detail: err.message });
  }
});

// ── League ──────────────────────────────────────────────────────────────────

// GET /api/nba/standings?season=2024-25
router.get('/standings', async (req, res) => {
  try {
    const data = await nba.getStandings(req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Standings unavailable', detail: err.message });
  }
});

// GET /api/nba/leaders?stat=PTS&season=2024-25
router.get('/leaders', async (req, res) => {
  try {
    const data = await nba.getLeagueLeaders(req.query.stat || 'PTS', req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Leaders unavailable', detail: err.message });
  }
});

// GET /api/nba/team-stats?season=2024-25&per_mode=PerGame
router.get('/team-stats', async (req, res) => {
  try {
    const data = await nba.getLeagueTeamStats(req.query.season, req.query.per_mode);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Team stats unavailable', detail: err.message });
  }
});

// ── Teams ────────────────────────────────────────────────────────────────────

// GET /api/nba/team/:teamId/dashboard?season=2024-25
router.get('/team/:teamId/dashboard', async (req, res) => {
  try {
    const data = await nba.getTeamDashboard(req.params.teamId, req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Team dashboard unavailable', detail: err.message });
  }
});

// GET /api/nba/team/:teamId/last-n?n=10
router.get('/team/:teamId/last-n', async (req, res) => {
  try {
    const data = await nba.getTeamLastN(req.params.teamId, req.query.n || 10, req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Team last-N unavailable', detail: err.message });
  }
});

// GET /api/nba/team/:teamId/roster
router.get('/team/:teamId/roster', async (req, res) => {
  try {
    const data = await nba.getTeamRoster(req.params.teamId, req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Roster unavailable', detail: err.message });
  }
});

// GET /api/nba/pregame/:homeTeamId/:awayTeamId
// Full pregame composite — used by picks engine and research
router.get('/pregame/:homeTeamId/:awayTeamId', async (req, res) => {
  try {
    // Accept team IDs directly
    const homeId = parseInt(req.params.homeTeamId);
    const awayId = parseInt(req.params.awayTeamId);
    const baseUrl = process.env.NBA_SERVICE_URL || 'http://localhost:8000';
    const r = await fetch(`${baseUrl}/nba/pregame/${homeId}/${awayId}?season=${req.query.season || '2024-25'}`);
    const json = await r.json();
    res.json(json);
  } catch (err) {
    res.status(502).json({ error: 'Pregame analysis unavailable', detail: err.message });
  }
});

// GET /api/nba/pregame-by-name?home=Boston+Celtics&away=Miami+Heat
router.get('/pregame-by-name', async (req, res) => {
  const { home, away, season } = req.query;
  if (!home || !away) {
    return res.status(400).json({ error: 'home and away query params required' });
  }
  try {
    const data = await nba.getPregameAnalysis(home, away, season);
    if (!data) return res.status(404).json({ error: 'Could not resolve team IDs' });
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Pregame analysis unavailable', detail: err.message });
  }
});

// ── Players ──────────────────────────────────────────────────────────────────

// GET /api/nba/player/search?name=LeBron
router.get('/player/search', async (req, res) => {
  if (!req.query.name) return res.status(400).json({ error: 'name required' });
  try {
    const data = await nba.searchPlayers(req.query.name);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Player search unavailable', detail: err.message });
  }
});

// GET /api/nba/player/:playerId/career
router.get('/player/:playerId/career', async (req, res) => {
  try {
    const data = await nba.getPlayerCareer(req.params.playerId);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Player career unavailable', detail: err.message });
  }
});

// GET /api/nba/player/:playerId/gamelog?season=2024-25
router.get('/player/:playerId/gamelog', async (req, res) => {
  try {
    const data = await nba.getPlayerGameLog(req.params.playerId, req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Game log unavailable', detail: err.message });
  }
});

// GET /api/nba/player/:playerId/last-n?n=10
router.get('/player/:playerId/last-n', async (req, res) => {
  try {
    const data = await nba.getPlayerLastN(req.params.playerId, req.query.n || 10, req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Player last-N unavailable', detail: err.message });
  }
});

// GET /api/nba/player/:playerId/shot-chart?season=2024-25
router.get('/player/:playerId/shot-chart', async (req, res) => {
  try {
    const data = await nba.getPlayerShotChart(req.params.playerId, req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Shot chart unavailable', detail: err.message });
  }
});

// GET /api/nba/player/:playerId/deep-dive
// All player data in one call — for Research screen
router.get('/player/:playerId/deep-dive', async (req, res) => {
  try {
    const data = await nba.getPlayerDeepDive(req.params.playerId, req.query.season);
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: 'Player deep-dive unavailable', detail: err.message });
  }
});

// ── Health ────────────────────────────────────────────────────────────────────

// GET /api/nba/status
router.get('/status', async (req, res) => {
  const available = await nba.isNBAServiceAvailable();
  res.json({
    nbaService: available ? 'up' : 'down',
    url: process.env.NBA_SERVICE_URL || 'http://localhost:8000',
  });
});

module.exports = router;
