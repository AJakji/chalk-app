/**
 * nhlApi.js — NHL Official API client
 * Primary base: https://api-web.nhle.com/v1
 * Stats base:   https://api.nhle.com/stats/rest/en
 * No auth required.
 */

const BASE       = 'https://api-web.nhle.com/v1';
const STATS_BASE = 'https://api.nhle.com/stats/rest/en';

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

const TTL = {
  LIVE:       30 * 1000,             // 30 seconds
  SCHEDULE:   5  * 60 * 1000,       // 5 minutes
  STANDINGS:  60 * 60 * 1000,       // 1 hour
  ROSTER:     6  * 60 * 60 * 1000,  // 6 hours
  PLAYER:     6  * 60 * 60 * 1000,  // 6 hours
  LEADERS:    6  * 60 * 60 * 1000,  // 6 hours
  TEAMS:      24 * 60 * 60 * 1000,  // 24 hours
};

// ---------------------------------------------------------------------------
// Core fetch helpers
// ---------------------------------------------------------------------------
async function nhlFetch(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[NHL API] HTTP ${res.status} on ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[NHL API] Fetch error on ${url}: ${err.message}`);
    return null;
  }
}

function buildUrl(base, path, params = {}) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Get the NHL schedule for a specific date.
 * date: YYYY-MM-DD
 * Returns: [{id, startTimeUTC, homeTeam:{id,abbrev,name,score}, awayTeam:{...}, gameState, gameType}]
 * Cache: 5min
 */
async function getSchedule(date) {
  const key = `schedule:${date}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/schedule/${date}`));
  const games = json?.gameWeek?.[0]?.games || [];
  cacheSet(key, games, TTL.SCHEDULE);
  return games;
}

/**
 * Get today's NHL schedule.
 * Same shape as getSchedule.
 * Cache: 5min
 */
async function getScheduleNow() {
  const key = 'schedule:now';
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, '/schedule/now'));
  const games = json?.gameWeek?.[0]?.games || [];
  cacheSet(key, games, TTL.SCHEDULE);
  return games;
}

// ---------------------------------------------------------------------------
// Live game data
// ---------------------------------------------------------------------------

/**
 * Get live linescore for a game.
 * Returns: {period, periodDescriptor, timeRemaining, homeTeam:{score,sog}, awayTeam:{...}, situation}
 * Cache: 30s
 */
async function getLiveLinescore(gameId) {
  const key = `linescore:${gameId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/gamecenter/${gameId}/linescore`));
  if (!json) return null;
  cacheSet(key, json, TTL.LIVE);
  return json;
}

/**
 * Get full box score for a game.
 * Cache: 30s
 */
async function getBoxScore(gameId) {
  const key = `boxscore:${gameId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/gamecenter/${gameId}/boxscore`));
  if (!json) return null;
  cacheSet(key, json, TTL.LIVE);
  return json;
}

/**
 * Get play-by-play for a game.
 * Cache: 30s
 */
async function getPlayByPlay(gameId) {
  const key = `pbp:${gameId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/gamecenter/${gameId}/play-by-play`));
  if (!json) return null;
  cacheSet(key, json, TTL.LIVE);
  return json;
}

// ---------------------------------------------------------------------------
// Player data
// ---------------------------------------------------------------------------

/**
 * Get a player's game-by-game log for a season.
 * season: "20242025"
 * gameType: 2 = regular season, 3 = playoffs
 * Returns: {gameLog: [{gameId, teamAbbrev, homeRoadFlag, gameDate, goals, assists, points,
 *           plusMinus, shots, hits, blockedShots, pim, timeOnIce, opponentAbbrev, powerPlayGoals}]}
 * Cache: 6hr
 */
async function getPlayerGameLog(playerId, season, gameType = 2) {
  const key = `gamelog:${playerId}:${season}:${gameType}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/player/${playerId}/game-log/${season}/${gameType}`));
  if (!json) return { gameLog: [] };
  cacheSet(key, json, TTL.PLAYER);
  return json;
}

/**
 * Get a player's full profile and career stats.
 * Cache: 6hr
 */
async function getPlayerProfile(playerId) {
  const key = `player:${playerId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/player/${playerId}/landing`));
  if (!json) return null;
  cacheSet(key, json, TTL.PLAYER);
  return json;
}

// ---------------------------------------------------------------------------
// Teams & rosters
// ---------------------------------------------------------------------------

/**
 * Get the current active roster for a team.
 * teamAbbrev: e.g. "TOR", "EDM"
 * Returns: {forwards:[{id, firstName:{default}, lastName:{default}, positionCode}], defensemen:[...], goalies:[...]}
 * Cache: 6hr
 */
async function getTeamRoster(teamAbbrev) {
  const key = `roster:${teamAbbrev}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/roster/${teamAbbrev}/current`));
  if (!json) return { forwards: [], defensemen: [], goalies: [] };
  cacheSet(key, json, TTL.ROSTER);
  return json;
}

/**
 * Get current standings.
 * Cache: 1hr
 */
async function getStandings() {
  const key = 'standings:now';
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, '/standings/now'));
  const standings = json?.standings || [];
  cacheSet(key, standings, TTL.STANDINGS);
  return standings;
}

/**
 * Get all NHL teams from the stats REST API.
 * Returns: {data: [{id, fullName, triCode, ...}]}
 * Cache: 24hr
 */
async function getTeams() {
  const key = 'teams:all';
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(`${STATS_BASE}/team`);
  if (!json) return { data: [] };
  cacheSet(key, json, TTL.TEAMS);
  return json;
}

// ---------------------------------------------------------------------------
// League leaders
// ---------------------------------------------------------------------------

/**
 * Get the full season schedule for a team.
 * teamAbbrev: e.g. "TOR", "EDM"
 * season: "20252026"
 * Returns: [{id, gameDate, gameState, awayTeam:{abbrev,score}, homeTeam:{abbrev,score}, gameOutcome}]
 * Cache: 1hr
 */
async function getTeamSeasonSchedule(teamAbbrev, season) {
  const key = `team_schedule:${teamAbbrev}:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await nhlFetch(buildUrl(BASE, `/club-schedule-season/${teamAbbrev}/${season}`));
  const games = json?.games || [];
  cacheSet(key, games, TTL.STANDINGS); // 1hr cache
  return games;
}

/**
 * Get skater stat leaders for a season.
 * season: "20242025"
 * category: 'goals' | 'assists' | 'points' | 'plusMinus' | 'shots'
 * Returns: {[category]: [{id, firstName:{default}, lastName:{default}, teamAbbrev, headshot, value}]}
 * Cache: 6hr
 */
async function getSkaterLeaders(category, season, limit = 20) {
  const key = `skater_leaders:${season}:${category}:${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = buildUrl(BASE, `/skater-stats-leaders/${season}/2`, {
    categories: category,
    limit,
  });
  const json = await nhlFetch(url);
  if (!json) return {};
  cacheSet(key, json, TTL.LEADERS);
  return json;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getSchedule,
  getScheduleNow,
  getLiveLinescore,
  getBoxScore,
  getPlayByPlay,
  getPlayerGameLog,
  getPlayerProfile,
  getTeamRoster,
  getStandings,
  getTeams,
  getSkaterLeaders,
  getTeamSeasonSchedule,
};
