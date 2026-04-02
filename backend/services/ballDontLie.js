/**
 * ballDontLie.js — BallDontLie GOAT NBA API client
 * Docs: https://docs.balldontlie.io
 * Auth: Authorization header with API key
 */

const BASE = 'https://api.balldontlie.io/v1';

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
  LIVE:       30 * 1000,         // 30 seconds
  SCHEDULE:   5  * 60 * 1000,   // 5 minutes
  PROPS:      5  * 60 * 1000,   // 5 minutes
  STANDINGS:  60 * 60 * 1000,   // 1 hour
  INJURIES:   60 * 60 * 1000,   // 1 hour
  SEASON_AVG: 6  * 60 * 60 * 1000,  // 6 hours
  TEAMS:      24 * 60 * 60 * 1000,  // 24 hours
  GAME_LOGS:  24 * 60 * 60 * 1000,  // 24 hours
};

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------
function apiKey() {
  return process.env.BALLDONTLIE_API_KEY || '';
}

async function bdlFetch(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.forEach(item => url.searchParams.append(k, item));
    } else {
      url.searchParams.set(k, v);
    }
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: apiKey() },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 429) {
      console.warn('[BallDontLie] Rate limited (429) on', path);
      return null;
    }
    if (!res.ok) {
      console.warn(`[BallDontLie] HTTP ${res.status} on ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[BallDontLie] Fetch error on ${path}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pagination helper — follows meta.next_cursor until exhausted
// ---------------------------------------------------------------------------
async function fetchAllPages(path, params = {}) {
  const results = [];
  let cursor = null;

  do {
    const pageParams = { ...params, per_page: 100 };
    if (cursor !== null) pageParams.cursor = cursor;

    const json = await bdlFetch(path, pageParams);
    if (!json) break;

    if (Array.isArray(json.data)) results.push(...json.data);
    cursor = json.meta?.next_cursor ?? null;
  } while (cursor !== null);

  return results;
}

// ---------------------------------------------------------------------------
// Batch helper — splits an array into chunks of `size`
// ---------------------------------------------------------------------------
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/**
 * Get all NBA players (paginated).
 * Returns: [{id, first_name, last_name, position, team:{id,abbreviation,full_name}}]
 * Cache: 6hr
 */
async function getPlayers() {
  const key = 'players:all';
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchAllPages('/players');
  cacheSet(key, data, TTL.SEASON_AVG);
  return data;
}

/**
 * Search players by name.
 * Returns: same shape as getPlayers
 * Cache: 5min per query
 */
async function searchPlayers(name) {
  const key = `players:search:${name}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/players', { search: name, per_page: 10 });
  const data = json?.data || [];
  cacheSet(key, data, TTL.SCHEDULE);
  return data;
}

/**
 * Get a single player by ID.
 * Cache: 6hr
 */
async function getPlayerById(playerId) {
  const key = `player:${playerId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch(`/players/${playerId}`);
  const data = json?.data || null;
  if (data) cacheSet(key, data, TTL.SEASON_AVG);
  return data;
}

// ---------------------------------------------------------------------------
// Season averages & game logs
// ---------------------------------------------------------------------------

/**
 * Get season averages for one or more players (batched up to 100 per request).
 * Returns: [{player_id, pts, reb, ast, stl, blk, fg_pct, fg3_pct, ft_pct, min, games_played, turnover}]
 * Cache: 6hr per season
 */
async function getSeasonAverages(playerIds, season = 2024) {
  const ids = Array.isArray(playerIds) ? playerIds : [playerIds];
  const key = `season_averages:${season}:${ids.slice().sort().join(',')}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const batches = chunk(ids, 100);
  const allData = [];

  for (const batch of batches) {
    const json = await bdlFetch('/season_averages', {
      season,
      'player_ids[]': batch,
    });
    if (json?.data) allData.push(...json.data);
  }

  cacheSet(key, allData, TTL.SEASON_AVG);
  return allData;
}

/**
 * Get game-by-game stats for one or more players across one or more seasons.
 * Returns all rows (paginated).
 * Cache: 24hr
 */
async function getPlayerStats(playerIds, seasons = [2024]) {
  const ids = Array.isArray(playerIds) ? playerIds : [playerIds];
  const yrs = Array.isArray(seasons) ? seasons : [seasons];
  const key = `player_stats:${yrs.join(',')}:${ids.slice().sort().join(',')}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchAllPages('/stats', {
    'player_ids[]': ids,
    'seasons[]': yrs,
  });

  cacheSet(key, data, TTL.GAME_LOGS);
  return data;
}

/**
 * Get advanced stats for one or more players across one or more seasons.
 * Returns: [{player_id, game_id, usg_pct, ts_pct, off_rtg, def_rtg, pace, plus_minus}]
 * Cache: 24hr
 */
async function getAdvancedStats(playerIds, seasons = [2024]) {
  const ids = Array.isArray(playerIds) ? playerIds : [playerIds];
  const yrs = Array.isArray(seasons) ? seasons : [seasons];
  const key = `advanced_stats:${yrs.join(',')}:${ids.slice().sort().join(',')}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchAllPages('/advanced_stats', {
    'player_ids[]': ids,
    'seasons[]': yrs,
  });

  cacheSet(key, data, TTL.GAME_LOGS);
  return data;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/**
 * Get all NBA teams.
 * Returns: [{id, full_name, abbreviation, city, conference, division}]
 * Cache: 24hr
 */
async function getTeams() {
  const key = 'teams:all';
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchAllPages('/teams');
  cacheSet(key, data, TTL.TEAMS);
  return data;
}

async function getStandings(season = 2024) {
  const key = `standings:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/standings', { season });
  const data = json?.data || [];
  cacheSet(key, data, TTL.STANDINGS);
  return data;
}

/**
 * Get team season averages.
 * Cache: 1hr
 */
async function getTeamStats(season = 2024) {
  const key = `team_stats:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/team_stats', { season });
  const data = json?.data || [];
  cacheSet(key, data, TTL.STANDINGS);
  return data;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

/**
 * Get games for a specific date.
 * date: YYYY-MM-DD
 * Returns: [{id, date, status, home_team, visitor_team, home_team_score, visitor_team_score, period, time}]
 * Cache: 5min
 */
async function getGames(date) {
  const key = `games:${date}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchAllPages('/games', { 'dates[]': [date] });
  cacheSet(key, data, TTL.SCHEDULE);
  return data;
}

/**
 * Get live box scores for a date.
 * Returns: [{game:{...}, home_team:{team, players:[...]}, visitor_team:{...}}]
 * Cache: 30s
 */
async function getLiveBoxScores(date) {
  const key = `box_scores:${date}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/box_scores', { date });
  const data = json?.data || [];
  cacheSet(key, data, TTL.LIVE);
  return data;
}

// ---------------------------------------------------------------------------
// Props & Odds
// ---------------------------------------------------------------------------

/**
 * Get player props for a game.
 * Returns: [{player:{id,first_name,last_name}, type, line, over_odds, under_odds, book}]
 * Cache: 5min
 */
async function getPlayerProps(gameId) {
  const key = `player_props:${gameId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/player_props', { game_id: gameId });
  const data = json?.data || [];
  cacheSet(key, data, TTL.PROPS);
  return data;
}

/**
 * Get odds for a game.
 * Cache: 5min
 */
async function getOdds(gameId) {
  const key = `odds:${gameId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/odds', { game_id: gameId });
  const data = json?.data || null;
  if (data !== null) cacheSet(key, data, TTL.PROPS);
  return data;
}

// ---------------------------------------------------------------------------
// Injuries
// ---------------------------------------------------------------------------

/**
 * Get all current player injuries.
 * Returns: [{player:{id,first_name,last_name}, status, description, date}]
 * Cache: 1hr
 */
async function getInjuries() {
  const key = 'injuries';
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/player_injuries');
  const data = json?.data || [];
  cacheSet(key, data, TTL.INJURIES);
  return data;
}

// ---------------------------------------------------------------------------
// Play-by-play
// ---------------------------------------------------------------------------

/**
 * Get play-by-play for a game.
 * Cache: 30s
 */
async function getPlayByPlay(gameId) {
  const key = `pbp:${gameId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const json = await bdlFetch('/play_by_play', { game_id: gameId });
  const data = json?.data || [];
  cacheSet(key, data, TTL.LIVE);
  return data;
}

/**
 * Get all games for a specific team in a season.
 * teamId: BDL integer team ID
 * season: e.g. 2025 (the year the season started)
 * Returns all games (home + away), sorted by date ascending.
 * Cache: 1hr
 */
async function getTeamGames(teamId, season) {
  const key = `team_games:${teamId}:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchAllPages('/games', {
    'seasons[]': [season],
    'team_ids[]': [teamId],
  });

  cacheSet(key, data, TTL.STANDINGS); // 1hr
  return data;
}

/**
 * Get per-player stats for a single game (used by pickGrader.js for NBA box scores).
 * Endpoint: GET /stats?game_ids[]=gameId
 * Cache: 5 min (score is final by the time grader runs)
 */
async function getStatsByGame(gameId) {
  const key = `stats_game:${gameId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const rows = await fetchAllPages('/stats', { 'game_ids[]': gameId });
  cacheSet(key, rows, TTL.SCHEDULE);
  return rows;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getPlayers,
  searchPlayers,
  getPlayerById,
  getSeasonAverages,
  getPlayerStats,
  getAdvancedStats,
  getTeams,
  getStandings,
  getTeamStats,
  getGames,
  getLiveBoxScores,
  getPlayerProps,
  getOdds,
  getInjuries,
  getPlayByPlay,
  getStatsByGame,
  getTeamGames,
};
