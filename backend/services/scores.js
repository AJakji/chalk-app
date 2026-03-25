/**
 * scores.js — Scores data layer
 *
 * Priority:
 *   1. SportsData.io (primary) — all leagues
 *   2. nba_api Python service (supplement) — NBA live clock accuracy
 *   3. ESPN public API (fallback) — if SD.io returns nothing
 */

const db  = require('../db');
const sd  = require('./sportsdata');
const nba = require('./nba');
const espn = require('./espn');

async function loadTodaysPicks() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { rows } = await db.query(`SELECT * FROM picks WHERE created_at::date = $1`, [today]);
    return rows;
  } catch {
    return [];
  }
}

function matchPick(picks, awayTeam, homeTeam) {
  for (const pick of picks) {
    const val  = (pick.pick_value || '').toLowerCase();
    const away = (awayTeam || '').toLowerCase().split(' ').pop();
    const home = (homeTeam || '').toLowerCase().split(' ').pop();
    if (val.includes(away) || val.includes(home)) {
      return { pick: pick.pick_value, result: pick.result };
    }
  }
  return null;
}

async function fetchAllScores() {
  const todaysPicks = await loadTodaysPicks();
  const today = new Date().toISOString().split('T')[0];
  const match = (away, home) => matchPick(todaysPicks, away, home);

  // Primary: SportsData.io for all leagues
  let games = await sd.getScoresForDate(today, match);

  // Supplement NBA with nba_api live scoreboard (more real-time clock updates)
  try {
    const nbaAvail = await nba.isNBAServiceAvailable();
    if (nbaAvail) {
      const scoreboard = await nba.getScoreboard();
      const liveNBA = (scoreboard?.scoreboard?.games || []).map(g => {
        let status;
        if (g.gameStatus === 1) status = 'upcoming';
        else if (g.gameStatus === 3) status = 'final';
        else status = 'live';
        const awayName = `${g.awayTeam.teamCity} ${g.awayTeam.teamName}`;
        const homeName = `${g.homeTeam.teamCity} ${g.homeTeam.teamName}`;
        return {
          id: g.gameId, nbaGameId: g.gameId, league: 'NBA', status,
          clock: g.gameStatusText?.trim() || '',
          awayTeam: { name: awayName, abbr: g.awayTeam.teamTricode, score: status === 'upcoming' ? null : g.awayTeam.score },
          homeTeam: { name: homeName, abbr: g.homeTeam.teamTricode, score: status === 'upcoming' ? null : g.homeTeam.score },
          chalkPick: match(awayName, homeName),
          boxScore: null, playByPlay: [],
        };
      });
      // Replace SD NBA games with live nba_api data; keep sdGameId from SD where possible
      const sdNBAById = Object.fromEntries(games.filter(g => g.league === 'NBA').map(g => [g.awayTeam.abbr + g.homeTeam.abbr, g]));
      const mergedNBA = liveNBA.map(g => {
        const sdMatch = sdNBAById[g.awayTeam.abbr + g.homeTeam.abbr];
        return sdMatch ? { ...g, sdGameId: sdMatch.sdGameId } : g;
      });
      games = [...games.filter(g => g.league !== 'NBA'), ...mergedNBA];
    }
  } catch (err) {
    console.warn(`[Scores] NBA supplement failed: ${err.message}`);
  }

  // Fallback to ESPN if SD.io returned nothing
  if (games.length === 0) {
    console.warn('[Scores] SD.io returned no games for today — falling back to ESPN');
    games = await espn.getESPNScoresForDate(today);
  }

  return games.sort((a, b) => {
    const order = { live: 0, upcoming: 1, final: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });
}

async function fetchScoresForDate(dateStr) {
  const todaysPicks = await loadTodaysPicks();
  const match = (away, home) => matchPick(todaysPicks, away, home);

  let games = await sd.getScoresForDate(dateStr, match);

  if (games.length === 0) {
    console.warn(`[Scores] SD.io returned no games for ${dateStr} — falling back to ESPN`);
    games = await espn.getESPNScoresForDate(dateStr);
  }

  return games;
}

const MOCK_SCORES = [
  {
    id: 'mock-g1', nbaGameId: '0022501034', sdGameId: null, league: 'NBA', status: 'live', clock: 'Q3 4:22',
    awayTeam: { name: 'Golden State Warriors', abbr: 'GSW', score: 78 },
    homeTeam: { name: 'Boston Celtics', abbr: 'BOS', score: 91 },
    chalkPick: { pick: 'Celtics -4.5', result: 'winning' }, boxScore: null, playByPlay: [],
  },
  {
    id: 'mock-g2', nbaGameId: '0022501035', sdGameId: null, league: 'NBA', status: 'live', clock: 'Q2 11:04',
    awayTeam: { name: 'Denver Nuggets', abbr: 'DEN', score: 48 },
    homeTeam: { name: 'LA Lakers', abbr: 'LAL', score: 41 },
    chalkPick: { pick: 'Nuggets ML', result: 'winning' }, boxScore: null, playByPlay: [],
  },
  {
    id: 'mock-g3', nbaGameId: '0022501036', sdGameId: null, league: 'NBA', status: 'final', clock: 'Final',
    awayTeam: { name: 'Phoenix Suns', abbr: 'PHX', score: 108 },
    homeTeam: { name: 'Miami Heat', abbr: 'MIA', score: 114 },
    chalkPick: { pick: 'Heat ML', result: 'win' }, boxScore: null, playByPlay: [],
  },
];

module.exports = { fetchAllScores, fetchScoresForDate, MOCK_SCORES };
