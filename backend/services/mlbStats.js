/**
 * mlbStats.js — MLB Official Stats API client
 * Docs: https://statsapi.mlb.com
 * No auth required.
 */

const BASE = 'https://statsapi.mlb.com/api/v1';

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
  SEASON_AVG: 6  * 60 * 60 * 1000,  // 6 hours
  STANDINGS:  60 * 60 * 1000,       // 1 hour
  ROSTER:     60 * 60 * 1000,       // 1 hour
  TEAMS:      24 * 60 * 60 * 1000,  // 24 hours
  GAME_LOGS:  24 * 60 * 60 * 1000,  // 24 hours (for completed games)
};

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------
async function mlbFetch(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[MLB Stats] HTTP ${res.status} on ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[MLB Stats] Fetch error on ${path}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Get the MLB schedule for a given date.
 * date: MM/DD/YYYY
 * Returns: [{gamePk, gameDate, status:{detailedState}, teams:{home:{team:{id,name,abbreviation},score},away:{...}}}]
 * Cache: 5min
 */
async function getSchedule(date) {
  const key = `schedule_sp:${date}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch('/schedule', {
    sportId: 1,
    date,
    hydrate: 'team,linescore,probablePitcher,person',
  });

  const games = (json?.dates || []).flatMap(d => d.games || []);
  cacheSet(key, games, TTL.SCHEDULE);
  return games;
}

// ---------------------------------------------------------------------------
// Live game data
// ---------------------------------------------------------------------------

/**
 * Get the live linescore for a game.
 * Returns: {currentInning, currentInningOrdinal, inningHalf, outs, balls, strikes, teams:{home:{runs,hits,errors},away:{...}}}
 * Cache: 30s
 */
async function getLiveLinescore(gamePk) {
  const key = `linescore:${gamePk}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch(`/game/${gamePk}/linescore`);
  if (!json) return null;
  cacheSet(key, json, TTL.LIVE);
  return json;
}

/**
 * Get the full box score for a game.
 * Uses 30s TTL for live games, 24hr for final games.
 * Returns: full box score object with player stats
 */
async function getBoxScore(gamePk, isFinal = false) {
  const key = `boxscore:${gamePk}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch(`/game/${gamePk}/boxscore`);
  if (!json) return null;

  const ttl = isFinal ? TTL.GAME_LOGS : TTL.LIVE;
  cacheSet(key, json, ttl);
  return json;
}

/**
 * Get play-by-play for a game.
 * Cache: 30s
 */
async function getPlayByPlay(gamePk) {
  const key = `pbp:${gamePk}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch(`/game/${gamePk}/playByPlay`);
  if (!json) return null;
  cacheSet(key, json, TTL.LIVE);
  return json;
}

// ---------------------------------------------------------------------------
// Player stats
// ---------------------------------------------------------------------------

/**
 * Get a player's game-by-game log for a season.
 * group: 'hitting' | 'pitching' | 'fielding'
 * Returns: game log array
 * Cache: 6hr
 */
async function getPlayerGameLog(personId, season, group = 'hitting') {
  const key = `gamelog:${personId}:${season}:${group}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch(`/people/${personId}/stats`, {
    stats: 'gameLog',
    season,
    sportId: 1,
    group,
  });

  const logs = json?.stats?.[0]?.splits || [];
  cacheSet(key, logs, TTL.SEASON_AVG);
  return logs;
}

/**
 * Get a player's season totals/averages.
 * group: 'hitting' | 'pitching' | 'fielding'
 * Cache: 6hr
 */
async function getPlayerSeasonStats(personId, season, group = 'hitting') {
  const key = `season_stats:${personId}:${season}:${group}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch(`/people/${personId}/stats`, {
    stats: 'season',
    season,
    sportId: 1,
    group,
  });

  const stats = json?.stats?.[0]?.splits || [];
  cacheSet(key, stats, TTL.SEASON_AVG);
  return stats;
}

// ---------------------------------------------------------------------------
// Teams & rosters
// ---------------------------------------------------------------------------

/**
 * Get all MLB teams.
 * Cache: 24hr
 */
async function getTeams() {
  const key = 'teams:all';
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch('/teams', { sportId: 1 });
  const teams = json?.teams || [];
  cacheSet(key, teams, TTL.TEAMS);
  return teams;
}

/**
 * Get division/wild-card standings.
 * Cache: 1hr
 */
async function getStandings(season) {
  const key = `standings:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch('/standings', {
    leagueId: '103,104',
    season,
  });

  const records = json?.records || [];
  cacheSet(key, records, TTL.STANDINGS);
  return records;
}

/**
 * Get active roster for a team.
 * Cache: 1hr
 */
async function getTeamRoster(teamId) {
  const key = `roster:${teamId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch(`/teams/${teamId}/roster`, {
    rosterType: 'active',
  });

  const roster = json?.roster || [];
  cacheSet(key, roster, TTL.ROSTER);
  return roster;
}

/**
 * Get all active players for a season.
 * Returns: [{id, fullName, currentTeam:{id,name,abbreviation}, primaryPosition:{abbreviation,type:{description}}}]
 * Cache: 6hr
 */
async function getActivePlayers(season) {
  const key = `active_players:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await mlbFetch('/sports/1/players', {
    season,
    gameType: 'R',
  });

  const players = json?.people || [];
  cacheSet(key, players, TTL.SEASON_AVG);
  return players;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getSchedule,
  getLiveLinescore,
  getBoxScore,
  getPlayByPlay,
  getPlayerGameLog,
  getPlayerSeasonStats,
  getTeams,
  getStandings,
  getTeamRoster,
  getActivePlayers,
};
