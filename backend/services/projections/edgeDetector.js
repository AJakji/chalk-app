/**
 * Chalk Edge Detector
 * ===================
 * Runs at 10:30 AM after the projection model completes.
 *
 * What it does:
 *   1. Reads today's player projections from chalk_projections table
 *   2. Fetches today's NBA prop lines from The Odds API (player_props markets)
 *   3. Compares our projection to each market line → calculates edge
 *   4. Scores confidence for every edge using 20+ signal factors
 *   5. Writes the top edges to player_props_history so aiPicks.js can
 *      generate Chalky's picks with quantitative backing
 *   6. Also updates team projections with real posted spreads / totals
 *      and flags team picks where our model diverges from the market
 *
 * Exported:
 *   detectEdges()          — main pipeline, called by cron in server.js
 *   getTodaysEdges()       — read top edges from DB (used by aiPicks.js)
 *   collectPropsLines()    — fetch + store raw prop lines only (9 AM cron)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const db   = require('../../db');
const bdl  = require('../ballDontLie');
const espn = require('../espn');

const BASE_URL     = 'https://api.the-odds-api.com/v4';
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const MODEL_VERSION = 'v1.0';

// Returns today's date in ET (YYYY-MM-DD), correct on UTC servers
function getTodayET() {
  const d = new Date();
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = d.getTimezoneOffset() < Math.max(jan, jul);
  const etOffset = isDST ? 4 : 5;
  const etNow = new Date(Date.now() - etOffset * 60 * 60 * 1000);
  return etNow.toISOString().split('T')[0];
}

// Per-sport minimum edge thresholds (projection − market line)
// Different for each sport because scales differ (HR rate vs K count vs points)
const MIN_EDGE_BY_SPORT = {
  NBA: {
    default:  1.5,  // points/rebounds/assists
  },
  MLB: {
    hits:          0.25,
    total_bases:   0.35,
    home_runs:     0.08,
    strikeouts:    1.5,
    earned_runs:   0.40,
    walks:         0.30,
    outs_recorded: 1.5,
    rbi:           0.30,
    runs:          0.30,
    stolen_bases:  0.06,
    default:       0.25,
  },
  NHL: {
    goals:         0.12,
    assists:       0.15,
    points:        0.20,
    shots_on_goal: 1.0,
    saves:         1.5,
    goals_against: 0.30,
    hits:          0.50,
    blocks:        0.40,
    default:       0.20,
  },
};

// Minimum confidence score to include in top-picks list
const MIN_CONFIDENCE = 62;
// Max prop picks to generate per sport per day
const MAX_PICKS      = 25;

// Convenience: NBA minimum edge (existing logic uses this constant)
const MIN_EDGE = MIN_EDGE_BY_SPORT.NBA.default;

// Map Odds API full team names → BDL/BDL abbreviation (for chalk_projections.team)
const NBA_TEAM_ABBR = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
  'LA Clippers': 'LAC', 'Los Angeles Clippers': 'LAC', 'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM', 'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN', 'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK', 'Oklahoma City Thunder': 'OKC', 'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX', 'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
};

// Odds API sport keys per league
const SPORT_KEY_MAP = {
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
};

// Map our internal prop_type names to The Odds API market keys
const PROP_MARKET_MAP = {
  points:   'player_points',
  rebounds: 'player_rebounds',
  assists:  'player_assists',
  threes:   'player_threes',
  pra:      'player_points_rebounds_assists',
  pts_ast:  'player_points_assists',
  pts_reb:  'player_points_rebounds',
  ast_reb:  'player_rebounds_assists',
  steals:   'player_steals',
  blocks:   'player_blocks',
};

// Reverse: Odds API market key → our projection column name (legacy named-column schema)
const MARKET_TO_PROJ = {
  player_points:                    'proj_points',
  player_rebounds:                  'proj_rebounds',
  player_assists:                   'proj_assists',
  player_threes:                    'proj_threes',
  player_points_rebounds_assists:   'proj_pra',
  player_points_assists:            'proj_pts_ast',
  player_points_rebounds:           'proj_pts_reb',
  player_rebounds_assists:          'proj_ast_reb',
  player_steals:                    'proj_steals',
  player_blocks:                    'proj_blocks',
};

// Odds API market key → prop_type value stored in chalk_projections.prop_type
// (matches PROP_TYPE_TO_DB values in nbaProjectionModel.py)
// Used to look up the correct row when each prop is stored as its own row with proj_value.
const MARKET_TO_DB_PROP = {
  player_points:                    'points',
  player_rebounds:                  'rebounds',
  player_assists:                   'assists',
  player_threes:                    'threes',
  player_steals:                    'steals',
  player_blocks:                    'blocks',
  player_points_rebounds_assists:   'points_rebounds_assists',
  player_points_assists:            'points_assists',
  player_points_rebounds:           'points_rebounds',
  player_rebounds_assists:          'rebounds_assists',
};

// Odds API market key → prop_type stored in chalk_projections (NHL)
const NHL_MARKET_TO_DB_PROP = {
  player_goals:          'goals',
  player_assists:        'assists',
  player_points:         'points',
  player_shots_on_goal:  'shots_on_goal',
  player_saves:          'saves',
  player_goals_against:  'goals_against',
};

// Odds API market key → prop_type stored in chalk_projections (MLB)
// Model stores: batters → hits/total_bases/home_runs/rbis/runs_scored/stolen_bases
//               pitchers → strikeouts/earned_runs/walks/outs_recorded
// batter_strikeouts, batter_walks, batter_hits_runs_rbis, pitcher_hits_allowed
// are not projected by the model — omitted here so they're skipped gracefully.
const MLB_MARKET_TO_DB_PROP = {
  batter_hits:                  'hits',
  batter_total_bases:           'total_bases',
  batter_rbis:                  'rbis',
  batter_runs_scored:           'runs_scored',
  batter_home_runs:             'home_runs',
  batter_stolen_bases:          'stolen_bases',
  pitcher_strikeouts:           'strikeouts',
  pitcher_walks:                'walks',
  pitcher_earned_runs:          'earned_runs',
  pitcher_outs:                 'outs',
};

// Odds API market key → edge column name in chalk_projections
const MARKET_TO_EDGE_COL = {
  player_points:                    'edge_pts',
  player_rebounds:                  'edge_reb',
  player_assists:                   'edge_ast',
  player_threes:                    'edge_threes',
  player_points_rebounds_assists:   'edge_pra',
  player_points_assists:            'edge_pts_ast',
  player_points_rebounds:           'edge_pts_reb',
  player_rebounds_assists:          'edge_ast_reb',
};

// ── Odds API helpers ───────────────────────────────────────────────────────────

/**
 * Fetch a URL with exponential backoff on 429 rate-limit responses.
 * Retries up to maxRetries times, waiting 2^attempt * baseDelayMs between retries.
 * Returns the parsed JSON on success, or null/fallback on permanent failure.
 */
async function fetchWithRetry(url, { fallback = null, maxRetries = 3, baseDelayMs = 2000, timeoutMs = 12000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

      if (res.ok) {
        return await res.json();
      }

      if (res.status === 429) {
        // Rate limited — check Retry-After header first, otherwise use exponential backoff
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : baseDelayMs * Math.pow(2, attempt);

        if (attempt < maxRetries) {
          console.warn(`  [Odds API] 429 rate-limited — waiting ${(waitMs / 1000).toFixed(1)}s before retry ${attempt + 1}/${maxRetries}…`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        console.error(`  [Odds API] 429 rate-limit exceeded after ${maxRetries} retries: ${url.split('?')[0]}`);
        return fallback;
      }

      if (res.status === 401) {
        console.error(`  [Odds API] 401 Unauthorized — check ODDS_API_KEY`);
        return fallback;
      }

      console.warn(`  [Odds API] HTTP ${res.status} for ${url.split('?')[0]}`);
      return fallback;
    } catch (err) {
      if (attempt < maxRetries) {
        const waitMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(`  [Odds API] fetch error (attempt ${attempt + 1}): ${err.message} — retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
      } else {
        console.warn(`  [Odds API] fetch failed after ${maxRetries} retries: ${err.message}`);
        return fallback;
      }
    }
  }
  return fallback;
}

async function fetchPlayerProps(sportKey, eventId) {
  if (!ODDS_API_KEY) return null;
  const markets = Object.values(PROP_MARKET_MAP).join(',');
  const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american`;
  return await fetchWithRetry(url, { fallback: null });
}

async function fetchNBAEvents() {
  if (!ODDS_API_KEY) return [];
  const url = `${BASE_URL}/sports/basketball_nba/events?apiKey=${ODDS_API_KEY}`;
  return (await fetchWithRetry(url, { fallback: [] })) || [];
}

async function fetchNBAGameOdds() {
  if (!ODDS_API_KEY) return [];
  const url = `${BASE_URL}/sports/basketball_nba/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,bet365`;
  return (await fetchWithRetry(url, { fallback: [] })) || [];
}

// ── MLB prop market maps ───────────────────────────────────────────────────────
const MLB_PROP_MARKET_MAP = {
  hits:          'batter_hits',
  total_bases:   'batter_total_bases',
  home_runs:     'batter_home_runs',
  rbi:           'batter_rbis',
  runs:          'batter_runs_scored',
  stolen_bases:  'batter_stolen_bases',
  strikeouts:    'pitcher_strikeouts',
  earned_runs:   'pitcher_earned_runs',
  walks:         'pitcher_walks',
  outs_recorded: 'pitcher_outs',
};

const MLB_MARKET_TO_PROJ = {
  batter_hits:         'proj_points',       // hits stored in proj_points for MLB
  batter_total_bases:  'proj_pra',          // total bases in proj_pra
  batter_home_runs:    'proj_threes',       // HR rate in proj_threes
  batter_rbis:         'proj_rebounds',     // RBI in proj_rebounds
  batter_runs_scored:  'proj_assists',      // runs in proj_assists
  batter_stolen_bases: 'proj_steals',
  pitcher_strikeouts:  'proj_blocks',       // K count in proj_blocks
  pitcher_earned_runs: 'proj_pts_ast',
  pitcher_walks:       'proj_ast_reb',
  pitcher_outs:        'proj_pts_reb',
};

// ── NHL prop market maps ───────────────────────────────────────────────────────
// player_saves and player_goals_against are not offered by Odds API — omitted to prevent 422
// player_goals on Odds API is a season-remaining goals market (lines 1.5-5.5), not per-game — omitted
const NHL_PROP_MARKET_MAP = {
  assists:       'player_assists',
  points:        'player_points',
  shots_on_goal: 'player_shots_on_goal',
};

const NHL_MARKET_TO_PROJ = {
  player_goals:          'proj_points',
  player_assists:        'proj_assists',
  player_points:         'proj_pra',
  player_shots_on_goal:  'proj_rebounds',
  player_saves:          'proj_steals',
  player_goals_against:  'proj_blocks',
  player_hits:           'proj_threes',
  player_blocked_shots:  'proj_pts_ast',
};

// ── Helper: get min edge threshold for sport + prop type ──────────────────────
function getMinEdge(sport, propType) {
  const sportMap = MIN_EDGE_BY_SPORT[sport] || MIN_EDGE_BY_SPORT.NBA;
  return sportMap[propType] ?? sportMap.default ?? MIN_EDGE;
}

// ── Helper: get prop map for a sport ──────────────────────────────────────────
function getPropMapsForSport(sport) {
  if (sport === 'MLB') return { propMap: MLB_PROP_MARKET_MAP, projMap: MLB_MARKET_TO_PROJ, dbPropMap: MLB_MARKET_TO_DB_PROP };
  if (sport === 'NHL') return { propMap: NHL_PROP_MARKET_MAP, projMap: NHL_MARKET_TO_PROJ, dbPropMap: NHL_MARKET_TO_DB_PROP };
  return { propMap: PROP_MARKET_MAP, projMap: MARKET_TO_PROJ, dbPropMap: MARKET_TO_DB_PROP };
}

// ── BallDontLie player props helper ───────────────────────────────────────────

/**
 * Fetch BDL player props for a game and merge them into a playerLines map.
 * BDL props are used to fill in lines missing from The Odds API, or to confirm
 * lines already found (we keep The Odds API line when both sources agree).
 *
 * Returns: playerName → { marketKey: { line } }  (same shape as extractPlayerLines)
 */
const BDL_PROP_TYPE_MAP = {
  'player_points':   'points',
  'player_rebounds': 'rebounds',
  'player_assists':  'assists',
  'player_threes':   'threes',
  'player_steals':   'steals',
  'player_blocks':   'blocks',
};

async function fetchBdlPlayerLines(gameId) {
  try {
    const props = await bdl.getPlayerProps(gameId);
    const result = {};
    for (const prop of (props || [])) {
      const playerName = prop.player?.display_fi_last || prop.player_name;
      if (!playerName) continue;
      // BDL returns { prop_type, line_score, over_odds, under_odds }
      const propType  = prop.prop_type;  // e.g. 'player_points'
      const line      = parseFloat(prop.line_score);
      if (!propType || isNaN(line)) continue;
      if (!result[playerName]) result[playerName] = {};
      if (!result[playerName][propType]) {
        result[playerName][propType] = { line, dk_odds: null, fd_odds: null, mgm_odds: null, bet365_odds: null, source: 'bdl' };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Merge BDL lines into an existing playerLines map from The Odds API.
 * Only adds entries that The Odds API didn't have.
 */
function mergeBdlLines(oddsLines, bdlLines) {
  for (const [player, markets] of Object.entries(bdlLines)) {
    if (!oddsLines[player]) oddsLines[player] = {};
    for (const [mktKey, lineData] of Object.entries(markets)) {
      if (!oddsLines[player][mktKey]) {
        oddsLines[player][mktKey] = lineData;
      }
    }
  }
  return oddsLines;
}

// ── Extract lines from Odds API response ───────────────────────────────────────

/**
 * Returns a map: playerName → { marketKey: { line, dk_odds, fd_odds, mgm_odds, bet365_odds } }
 * from a player props response object.
 */
function extractPlayerLines(propsData) {
  const result = {};
  if (!propsData?.bookmakers) return result;

  for (const bm of propsData.bookmakers) {
    const bmKey = bm.key; // 'draftkings', 'fanduel', etc.
    for (const market of (bm.markets || [])) {
      for (const outcome of (market.outcomes || [])) {
        if (outcome.description == null || outcome.point == null) continue;
        const playerName = outcome.description;
        const propType   = market.key;
        const direction  = outcome.name;  // 'Over' | 'Under'

        if (!result[playerName]) result[playerName] = {};
        if (!result[playerName][propType]) {
          result[playerName][propType] = { line: outcome.point, dk_odds: null, fd_odds: null, mgm_odds: null, bet365_odds: null };
        }

        if (direction === 'Over') {
          const entry = result[playerName][propType];
          if (bmKey === 'draftkings') entry.dk_odds  = String(outcome.price);
          if (bmKey === 'fanduel')    entry.fd_odds  = String(outcome.price);
          if (bmKey === 'betmgm')     entry.mgm_odds = String(outcome.price);
          if (bmKey === 'bet365')     entry.bet365_odds = String(outcome.price);
        }
      }
    }
  }
  return result;
}

/**
 * Extract spread and total lines from game odds.
 * Returns { homeSpread, awaySpread, total }
 */
function extractGameLines(gameOddsData) {
  const result = {};
  if (!gameOddsData?.bookmakers) return result;

  // Use DraftKings as primary; fall back to FanDuel
  const bm = gameOddsData.bookmakers.find(b => b.key === 'draftkings')
          || gameOddsData.bookmakers[0];
  if (!bm) return result;

  for (const market of (bm.markets || [])) {
    if (market.key === 'spreads') {
      for (const o of market.outcomes) {
        if (o.name === gameOddsData.home_team) result.homeSpread = o.point;
        if (o.name === gameOddsData.away_team) result.awaySpread = o.point;
      }
    }
    if (market.key === 'totals') {
      const over = market.outcomes.find(o => o.name === 'Over');
      if (over) result.total = over.point;
    }
  }
  return result;
}

// ── Real-time DB signal helpers for confidence scoring ────────────────────────

/** Map prop type to SQL expression over player_game_logs columns */
function propTypeToSqlExpr(propType) {
  const map = {
    points:   'points',
    rebounds: 'rebounds',
    assists:  'assists',
    threes:   'three_made',
    steals:   'steals',
    blocks:   'blocks',
    pra:      '(points + rebounds + assists)',
    pts_reb:  '(points + rebounds)',
    pts_ast:  '(points + assists)',
    ast_reb:  '(rebounds + assists)',
  };
  return map[propType] || null;
}

/** Player's L5 and L20 averages for a prop type, plus season games played. */
async function getPlayerRecentStats(playerId, propType, gameDate) {
  const col = propTypeToSqlExpr(propType);
  if (!col) return { l5: null, l20: null, gamesPlayed: 0 };
  try {
    const { rows } = await db.query(
      `SELECT ${col} AS stat_val
       FROM player_game_logs
       WHERE player_id = $1 AND game_date < $2 AND sport = 'NBA' AND minutes >= 5
       ORDER BY game_date DESC LIMIT 20`,
      [playerId, gameDate]
    );
    const vals = rows.map(r => parseFloat(r.stat_val)).filter(v => !isNaN(v));
    const l5  = vals.length >= 5  ? vals.slice(0, 5).reduce((a, b) => a + b, 0) / 5               : null;
    const l20 = vals.length >= 10 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { l5, l20, gamesPlayed: vals.length };
  } catch {
    return { l5: null, l20: null, gamesPlayed: 0 };
  }
}

/**
 * Opponent's defensive rank for a stat (1 = worst defense / allows most, 30 = best).
 * Built from player_game_logs over the last 60 days.
 */
async function getOppDefenseRank(opponentAbbr, propType, gameDate) {
  if (!opponentAbbr) return null;
  const col = propTypeToSqlExpr(propType);
  if (!col) return null;
  try {
    const { rows } = await db.query(
      `SELECT opponent, AVG(${col}) AS avg_allowed
       FROM player_game_logs
       WHERE game_date < $1 AND game_date > $1::date - interval '60 days'
         AND sport = 'NBA' AND minutes >= 10
       GROUP BY opponent
       ORDER BY avg_allowed DESC`,
      [gameDate]
    );
    if (!rows.length) return null;
    const idx = rows.findIndex(r => r.opponent === opponentAbbr);
    if (idx === -1) return null;
    return idx + 1;  // 1 = worst defense (allows most)
  } catch {
    return null;
  }
}

/**
 * Rest days for a team before gameDate (0 = back-to-back).
 * Derived from player_game_logs since team_game_logs is not populated.
 */
async function getTeamRestDays(teamAbbr, gameDate) {
  try {
    const { rows } = await db.query(
      `SELECT MAX(game_date) AS last_game
       FROM player_game_logs
       WHERE team = $1 AND game_date < $2 AND sport = 'NBA'`,
      [teamAbbr, gameDate]
    );
    if (!rows.length || !rows[0].last_game) return 2;
    const last  = new Date(rows[0].last_game);
    const today = new Date(gameDate);
    return Math.floor((today - last) / (1000 * 60 * 60 * 24));
  } catch {
    return 2;
  }
}

/**
 * True if player averages 15%+ above their season average vs this opponent
 * (minimum 2 head-to-head games required).
 */
async function getH2HStrong(playerId, opponentAbbr, propType, gameDate) {
  if (!opponentAbbr) return false;
  const col = propTypeToSqlExpr(propType);
  if (!col) return false;
  try {
    const { rows } = await db.query(
      `SELECT
         AVG(CASE WHEN opponent = $2 THEN ${col} END) AS h2h_avg,
         AVG(${col}) AS season_avg,
         COUNT(CASE WHEN opponent = $2 THEN 1 END) AS h2h_games
       FROM player_game_logs
       WHERE player_id = $1 AND game_date < $3 AND sport = 'NBA' AND minutes >= 10`,
      [playerId, opponentAbbr, gameDate]
    );
    if (!rows.length) return false;
    const h2h    = parseFloat(rows[0].h2h_avg);
    const season = parseFloat(rows[0].season_avg);
    const games  = parseInt(rows[0].h2h_games, 10);
    if (games < 2 || isNaN(h2h) || isNaN(season) || season === 0) return false;
    return h2h > season * 1.15;
  } catch {
    return false;
  }
}

// ── Universal confidence formula ──────────────────────────────────────────────

/**
 * Universal confidence formula tied to edge size.
 * Returns null if edge is too small (caller should skip this pick).
 * Returns integer confidence score 62–87 if edge qualifies.
 */
function calculateConfidence(edge, propType, sport, sampleSize = 10) {
  const MIN_EDGES = {
    points: 1.5, rebounds: 0.8, assists: 0.8, threes: 0.4,
    pra: 2.0, pr: 1.5, pa: 1.5, ar: 1.2, blocks: 0.3, steals: 0.3,
    spread: 1.5, total: 2.0,
    shots_on_goal: 0.8, goals: 0.3,
    puck_line: 0.4,
    hits: 0.3, total_bases: 0.5, home_runs: 0.2, rbis: 0.4,
    strikeouts: 0.8, earned_runs: 0.5,
    run_line: 0.5,
  }
  const minEdge = MIN_EDGES[propType] || 1.0
  if (Math.abs(edge) < minEdge) return null
  const base = 62
  const edgeRatio = Math.abs(edge) / minEdge
  const edgeBonus = Math.min(20, Math.floor((edgeRatio - 1) * 10))
  let sampleBonus = 0
  if (sampleSize >= 20) sampleBonus = 5
  else if (sampleSize >= 10) sampleBonus = 3
  else if (sampleSize >= 5) sampleBonus = 1
  return Math.min(87, base + edgeBonus + sampleBonus)
}

// ── Today's projections from DB ────────────────────────────────────────────────

async function getTodaysProjections(gameDate, sport = 'NBA') {
  const { rows } = await db.query(
    `SELECT * FROM chalk_projections
     WHERE game_date = $1 AND sport = $2
     ORDER BY confidence_score DESC`,
    [gameDate, sport]
  );
  return rows;
}

async function getTodaysTeamProjections(gameDate, sport = 'NBA') {
  const { rows } = await db.query(
    `SELECT * FROM team_projections
     WHERE game_date = $1 AND sport = $2`,
    [gameDate, sport]
  );
  return rows;
}

// ── Store edge in DB ───────────────────────────────────────────────────────────

async function storeEdge({
  playerId, playerName, team, sport = 'NBA', gameDate, propType,
  propLine, dkOdds, fdOdds, mgmOdds, bet365Odds,
  chalkProjection, chalkEdge, confidence,
}) {
  await db.query(
    `INSERT INTO player_props_history (
       player_id, player_name, team, sport, game_date,
       prop_type, prop_line,
       dk_odds, fd_odds, mgm_odds, bet365_odds,
       chalk_projection, chalk_edge, confidence, model_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (player_name, sport, prop_type, game_date) DO UPDATE SET
       prop_line        = EXCLUDED.prop_line,
       dk_odds          = EXCLUDED.dk_odds,
       fd_odds          = EXCLUDED.fd_odds,
       mgm_odds         = EXCLUDED.mgm_odds,
       bet365_odds      = EXCLUDED.bet365_odds,
       chalk_projection = EXCLUDED.chalk_projection,
       chalk_edge       = EXCLUDED.chalk_edge,
       confidence       = EXCLUDED.confidence,
       model_version    = EXCLUDED.model_version`,
    [
      playerId, playerName, team, sport, gameDate,
      propType, propLine,
      dkOdds, fdOdds, mgmOdds, bet365Odds,
      chalkProjection, chalkEdge, confidence, MODEL_VERSION,
    ]
  );
}

async function updateTeamProjectionLines(teamName, gameDate, spread, total) {
  // Cast to numeric explicitly so null values don't cause type errors
  const spreadVal = spread != null ? parseFloat(spread) : null;
  const totalVal  = total  != null ? parseFloat(total)  : null;
  await db.query(
    `UPDATE team_projections
     SET spread_cover_probability = CASE
           WHEN $3::numeric IS NOT NULL AND spread_projection IS NOT NULL
           THEN LEAST(0.95, GREATEST(0.05,
             ${normalCDF_SQL('spread_projection', '$3::numeric', 12.5)}))
           ELSE spread_cover_probability
         END,
         over_probability = CASE
           WHEN $4::numeric IS NOT NULL AND proj_total IS NOT NULL
           THEN LEAST(0.95, GREATEST(0.05,
             ${normalCDF_SQL('proj_total', '$4::numeric', 12.0)}))
           ELSE over_probability
         END,
         under_probability = CASE
           WHEN $4::numeric IS NOT NULL AND proj_total IS NOT NULL
           THEN LEAST(0.95, GREATEST(0.05,
             1.0 - ${normalCDF_SQL('proj_total', '$4::numeric', 12.0)}))
           ELSE under_probability
         END
     WHERE team_name ILIKE $1 AND game_date = $2`,
    [`%${teamName}%`, gameDate, spreadVal, totalVal]
  );
}

// ── Normal CDF helpers for cover probability ──────────────────────────────────

/** Abramowitz & Stegun approximation for erf — max error < 1.5e-7 */
function erfApprox(x) {
  const sign = x >= 0 ? 1 : -1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-x * x));
}

/** Standard normal CDF: P(X ≤ x) where X ~ N(mu, sigma²) */
function normalCDF(x, mu = 0, sigma = 1) {
  if (sigma <= 0) return 0.5;
  return 0.5 * (1 + erfApprox((x - mu) / (sigma * Math.sqrt(2))));
}

/**
 * Inline SQL fragment that approximates normalCDF using PostgreSQL arithmetic.
 * Returns the SQL string (not a value) for use inside UPDATE SET.
 * Only used by updateTeamProjectionLines to avoid pulling all rows to JS.
 */
function normalCDF_SQL(projCol, postedParam, sigma) {
  // 0.5 * (1 + erf(z / sqrt(2))) — linear approximation in SQL:
  // We use the crude but adequate linear: 0.5 + (proj - posted) / (sigma * 2.507)
  // where 2.507 ≈ sqrt(2π). This is good enough for the UPDATE-in-DB path.
  const scale = (sigma * 2.507).toFixed(3);
  return `0.5 + (${projCol} - ${postedParam}) / ${scale}`;
}

// ── NHL team name → abbreviation map (Odds API → DB) ─────────────────────────

const NHL_TEAM_ABBR = {
  'Anaheim Ducks':        'ANA', 'Boston Bruins':         'BOS',
  'Buffalo Sabres':       'BUF', 'Calgary Flames':        'CGY',
  'Carolina Hurricanes':  'CAR', 'Chicago Blackhawks':    'CHI',
  'Colorado Avalanche':   'COL', 'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars':         'DAL', 'Detroit Red Wings':     'DET',
  'Edmonton Oilers':      'EDM', 'Florida Panthers':      'FLA',
  'Los Angeles Kings':    'LAK', 'Minnesota Wild':        'MIN',
  'Montreal Canadiens':   'MTL', 'Nashville Predators':   'NSH',
  'New Jersey Devils':    'NJD', 'New York Islanders':    'NYI',
  'New York Rangers':     'NYR', 'Ottawa Senators':       'OTT',
  'Philadelphia Flyers':  'PHI', 'Pittsburgh Penguins':   'PIT',
  'Seattle Kraken':       'SEA', 'San Jose Sharks':       'SJS',
  'St. Louis Blues':      'STL', 'Tampa Bay Lightning':   'TBL',
  'Toronto Maple Leafs':  'TOR', 'Utah Hockey Club':      'UTA',
  'Vancouver Canucks':    'VAN', 'Vegas Golden Knights':  'VGK',
  'Washington Capitals':  'WSH', 'Winnipeg Jets':         'WPG',
};

// ── Team bet constants ────────────────────────────────────────────────────────

// Standard deviations used for normalCDF cover probability calculation
const TEAM_BET_STD = {
  NBA: { spread: 12.5,  total: 12.0 },
  MLB: { run_line: 2.5, total: 3.5  },
  NHL: { puck_line: 1.8, total: 1.2 },
};

// Minimum raw edge (in sport units) before computing cover probability
const MIN_TEAM_EDGE = {
  NBA: { spread: 3.5, total: 4.5 },
  MLB: { run_line: 0.7, total: 1.0 },
  NHL: { puck_line: 0.25, total: 0.35 },
};

// Minimum cover probability (0–1) to generate a pick
const MIN_COVER_PROB  = 0.60;
// Max team bet picks to write per day across all sports
const MAX_TEAM_PICKS  = 12;

// ── Fetch game odds for any sport ────────────────────────────────────────────

async function fetchGameOdds(sportKey) {
  if (!ODDS_API_KEY) return [];
  const url = `${BASE_URL}/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,bet365`;
  return (await fetchWithRetry(url, { fallback: [] })) || [];
}

// ── Read team projections from DB ─────────────────────────────────────────────

async function getTeamProjectionsForGame(sport, teamNameOrAbbr, gameDate) {
  const { rows } = await db.query(
    `SELECT * FROM team_projections
     WHERE game_date = $1 AND sport = $2
       AND (team_name ILIKE $3 OR team_name = $4)`,
    [gameDate, sport, `%${teamNameOrAbbr}%`, teamNameOrAbbr]
  );
  return rows;
}

// ── Write a team bet pick to the picks table ──────────────────────────────────

async function storeTeamBetPick({
  league, sportKey, pickType, awayTeam, homeTeam, gameTime, gameId,
  pickValue, confidence, shortReason, analysis, keyStats, oddsData,
}) {
  try {
    await db.query(
      `INSERT INTO picks
         (league, sport_key, pick_type, away_team, home_team, game_time, game_id,
          pick_value, confidence, short_reason, analysis, key_stats, odds_data,
          pick_date, pick_category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CURRENT_DATE, 'game')
       ON CONFLICT (game_id, pick_type, COALESCE(player_name, '')) DO UPDATE SET
         pick_value   = EXCLUDED.pick_value,
         confidence   = EXCLUDED.confidence,
         short_reason = EXCLUDED.short_reason,
         analysis     = EXCLUDED.analysis,
         key_stats    = EXCLUDED.key_stats,
         odds_data    = EXCLUDED.odds_data`,
      [
        league, sportKey, pickType, awayTeam, homeTeam, gameTime, gameId,
        pickValue, confidence, shortReason,
        JSON.stringify(analysis), JSON.stringify(keyStats), JSON.stringify(oddsData),
      ]
    );
    return true;
  } catch (err) {
    console.error(`  ⚠️ storeTeamBetPick failed (${pickType} ${awayTeam}@${homeTeam}): ${err.message}`);
    return false;
  }
}

// ── Confidence scoring for team bets ─────────────────────────────────────────

function calculateTeamBetConfidence({ coverProb, gamesUsed = 0, backupGoalie = false, windMph = 0, sport }) {
  let conf = 60;
  const breakdown = { base: 60 };

  // Cover probability bonus (primary driver)
  if      (coverProb >= 0.75) { conf += 12; breakdown.cover_prob_bonus = 12; }
  else if (coverProb >= 0.70) { conf +=  8; breakdown.cover_prob_bonus =  8; }
  else if (coverProb >= 0.65) { conf +=  5; breakdown.cover_prob_bonus =  5; }

  // Sample size reliability
  if      (gamesUsed >= 20) { conf += 5; breakdown.sample_bonus =  5; }
  else if (gamesUsed >= 12) { conf += 3; breakdown.sample_bonus =  3; }
  else if (gamesUsed <   5) { conf -= 10; breakdown.sample_penalty = -10; }

  // Sport-specific post-projection signals
  if (sport === 'NHL' && backupGoalie) { conf += 8; breakdown.backup_goalie_bonus = 8; }
  if (sport === 'MLB' && windMph > 15) { conf += 5; breakdown.wind_bonus = 5; }

  conf = Math.max(50, Math.min(85, conf));
  breakdown.final = conf;
  return { confidence: conf, breakdown };
}

// ── Main team bet edge detection pipeline ─────────────────────────────────────

/**
 * Detect team bet edges (spread / total) for a given sport.
 * Reads team_projections from DB, fetches Odds API game lines, computes
 * cover probability via normalCDF, and writes qualifying picks to picks table.
 *
 * Returns array of team bet pick objects.
 */
async function detectTeamBetEdges(sport, gameDate) {
  const today = gameDate || getTodayET();
  const sportKey = SPORT_KEY_MAP[sport];
  if (!sportKey) return [];

  console.log(`\n🏟️  Team Bet Edge Detector [${sport}] — ${today}`);

  // Fetch Odds API game lines
  const gameOddsAll = await fetchGameOdds(sportKey);
  if (!gameOddsAll.length) {
    console.log(`  No Odds API game odds for ${sport}`);
    return [];
  }
  console.log(`  ${gameOddsAll.length} ${sport} games with odds`);

  const teamPicks = [];

  for (const game of gameOddsAll) {
    const { id: gameId, home_team: homeTeamFull, away_team: awayTeamFull } = game;
    const gameTime = game.commence_time || '';

    // Extract posted lines from Odds API
    const lines = extractGameLines(game);
    const { homeSpread, total: postedTotal } = lines;

    // Resolve team identifiers for DB lookup
    // NBA: Odds API name matches DB team_name directly
    // NHL: need to map Odds API full name → abbreviation stored in DB
    const homeKey = sport === 'NHL' ? (NHL_TEAM_ABBR[homeTeamFull] || homeTeamFull) : homeTeamFull;
    const awayKey = sport === 'NHL' ? (NHL_TEAM_ABBR[awayTeamFull] || awayTeamFull) : awayTeamFull;

    // Load projections for both teams
    const homeRows = await getTeamProjectionsForGame(sport, homeKey, today);
    const awayRows = await getTeamProjectionsForGame(sport, awayKey, today);
    if (!homeRows.length && !awayRows.length) continue;

    // ── Spread / Run Line / Puck Line pick ───────────────────────────────────
    if (homeSpread != null) {
      let spreadProj = null;
      let coverProb  = null;
      let gamesUsed  = 0;
      let backupGoalie = false;
      let factors    = {};

      if (sport === 'NBA') {
        // NBA: prop_type='game' row has spread_projection and spread_cover_probability
        const homeGame = homeRows.find(r => r.prop_type === 'game');
        if (homeGame) {
          spreadProj = parseFloat(homeGame.spread_projection);
          gamesUsed  = homeGame.factors_json?.games_used || 0;
          factors    = homeGame.factors_json || {};
          const sigma = TEAM_BET_STD.NBA.spread;
          const edge  = spreadProj - homeSpread;
          if (Math.abs(edge) >= MIN_TEAM_EDGE.NBA.spread) {
            coverProb = normalCDF(spreadProj, homeSpread, sigma);
          }
        }
      } else if (sport === 'NHL') {
        // NHL: prop_type='puck_line_cover' row for each team
        const homePL = homeRows.find(r => r.prop_type === 'puck_line_cover');
        const awayPL = awayRows.find(r => r.prop_type === 'puck_line_cover');
        // Use the team with the strongest cover signal
        const bestPL = [homePL, awayPL].filter(Boolean).sort((a, b) =>
          Math.abs(parseFloat(b.proj_value || 0.5) - 0.5) -
          Math.abs(parseFloat(a.proj_value || 0.5) - 0.5)
        )[0];
        if (bestPL) {
          const rawCover = parseFloat(bestPL.proj_value);
          const isFave   = rawCover > 0.5;
          const edge     = Math.abs(rawCover - 0.5);
          gamesUsed      = bestPL.factors_json?.games_used || 0;
          factors        = bestPL.factors_json || {};
          backupGoalie   = factors.home_backup_goalie || factors.away_backup_goalie || false;
          if (edge >= MIN_TEAM_EDGE.NHL.puck_line) {
            coverProb = rawCover;
          }
        }
      } else if (sport === 'MLB') {
        // MLB: prop_type='game' row has spread_projection (run differential)
        const homeGame = homeRows.find(r => r.prop_type === 'game');
        if (homeGame) {
          spreadProj = parseFloat(homeGame.spread_projection);
          gamesUsed  = homeGame.factors_json?.games_used || 0;
          factors    = homeGame.factors_json || {};
          const sigma = TEAM_BET_STD.MLB.run_line;
          const edge  = spreadProj - homeSpread;
          if (Math.abs(edge) >= MIN_TEAM_EDGE.MLB.run_line) {
            coverProb = normalCDF(spreadProj, homeSpread, sigma);
          }
        }
      }

      if (coverProb != null && coverProb >= MIN_COVER_PROB) {
        const isHomeFave  = coverProb > 0.5;
        const favTeam     = isHomeFave ? homeTeamFull : awayTeamFull;
        const pickTypeName = sport === 'NHL' ? 'Puck Line' : sport === 'MLB' ? 'Run Line' : 'Spread';
        const lineStr      = homeSpread > 0 ? `+${homeSpread}` : `${homeSpread}`;
        const pickValue    = `${favTeam} ${isHomeFave ? lineStr : (homeSpread > 0 ? `-${homeSpread}` : `+${Math.abs(homeSpread)}`)}`;

        const { confidence, breakdown } = calculateTeamBetConfidence({
          coverProb, gamesUsed, backupGoalie, sport,
        });

        if (confidence >= MIN_CONFIDENCE) {
          const edge = spreadProj != null
            ? `${(spreadProj - homeSpread) > 0 ? '+' : ''}${(spreadProj - homeSpread).toFixed(1)}`
            : `cover prob ${(coverProb * 100).toFixed(0)}%`;

          const shortReason = sport === 'NHL'
            ? `Model projects ${(coverProb * 100).toFixed(0)}% cover probability${backupGoalie ? ' — backup goalie detected' : ''}`
            : `Model projects ${edge} edge over posted line`;

          teamPicks.push({ gameId, homeTeamFull, awayTeamFull, pickType: pickTypeName, coverProb, confidence });

          await storeTeamBetPick({
            league: sport, sportKey, pickType: pickTypeName,
            awayTeam: awayTeamFull, homeTeam: homeTeamFull,
            gameTime, gameId,
            pickValue, confidence, shortReason,
            analysis: { ...factors, cover_probability: coverProb, confidence_breakdown: breakdown },
            keyStats: { cover_probability: coverProb, games_used: gamesUsed },
            oddsData: { homeSpread, bookmaker: 'draftkings' },
          });
          console.log(`  ✅ ${pickTypeName}: ${pickValue} (conf: ${confidence}, cover: ${(coverProb * 100).toFixed(0)}%)`);
        }
      }
    }

    // ── Over / Under pick ────────────────────────────────────────────────────
    if (postedTotal != null) {
      let projTotal   = null;
      let gamesUsed   = 0;
      let backupGoalie = false;
      let factors     = {};
      let windMph     = 0;

      if (sport === 'NBA') {
        const homeGame = homeRows.find(r => r.prop_type === 'game');
        if (homeGame) {
          projTotal  = parseFloat(homeGame.proj_total);
          gamesUsed  = homeGame.factors_json?.games_used || 0;
          factors    = homeGame.factors_json || {};
        }
      } else if (sport === 'NHL') {
        const totalRow = homeRows.find(r => r.prop_type === 'total')
                      || awayRows.find(r => r.prop_type === 'total');
        if (totalRow) {
          projTotal    = parseFloat(totalRow.proj_value);
          gamesUsed    = totalRow.factors_json?.games_used || 0;
          factors      = totalRow.factors_json || {};
          backupGoalie = factors.backup_goalie_over_signal || false;
        }
      } else if (sport === 'MLB') {
        const homeGame = homeRows.find(r => r.prop_type === 'game');
        if (homeGame) {
          projTotal = parseFloat(homeGame.proj_total);
          gamesUsed = homeGame.factors_json?.games_used || 0;
          factors   = homeGame.factors_json || {};
          windMph   = factors.wind_mph || 0;
        }
      }

      if (projTotal != null && !isNaN(projTotal)) {
        const std    = (TEAM_BET_STD[sport] || {}).total || 6.0;
        const edge   = projTotal - postedTotal;
        const minEdge = ((MIN_TEAM_EDGE[sport] || {}).total || 1.5);

        if (Math.abs(edge) >= minEdge) {
          const isOver   = edge > 0;
          const coverProb = normalCDF(projTotal, postedTotal, std);
          const finalProb = isOver ? coverProb : 1 - coverProb;

          if (finalProb >= MIN_COVER_PROB) {
            const direction  = isOver ? 'Over' : 'Under';
            const pickValue  = `${direction} ${postedTotal}`;
            const pickType   = 'Total';
            const shortReason = `Model projects ${projTotal.toFixed(1)} total (${edge > 0 ? '+' : ''}${edge.toFixed(1)} vs line ${postedTotal})`;

            const { confidence, breakdown } = calculateTeamBetConfidence({
              coverProb: finalProb, gamesUsed, backupGoalie, windMph, sport,
            });

            if (confidence >= MIN_CONFIDENCE) {
              teamPicks.push({ gameId, homeTeamFull, awayTeamFull, pickType, coverProb: finalProb, confidence });

              await storeTeamBetPick({
                league: sport, sportKey, pickType,
                awayTeam: awayTeamFull, homeTeam: homeTeamFull,
                gameTime, gameId,
                pickValue, confidence, shortReason,
                analysis: { ...factors, proj_total: projTotal, posted_total: postedTotal, direction, confidence_breakdown: breakdown },
                keyStats: { proj_total: projTotal, posted_total: postedTotal, edge: parseFloat(edge.toFixed(2)) },
                oddsData: { total: postedTotal, bookmaker: 'draftkings' },
              });
              console.log(`  ✅ Total: ${pickValue} for ${awayTeamFull}@${homeTeamFull} (conf: ${confidence}, proj: ${projTotal.toFixed(1)})`);
            }
          }
        }
      }
    }
  }

  // Sort and cap
  const topPicks = teamPicks
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TEAM_PICKS);

  console.log(`  ${sport} team bets: ${teamPicks.length} qualifying → ${topPicks.length} stored`);
  return topPicks;
}

// ── Player name normalization ──────────────────────────────────────────────────

/**
 * Normalize a player name for fuzzy matching:
 *   • NFD decompose → strip combining accent marks (Jokić → Jokic)
 *   • lowercase
 *   • keep only a-z and spaces
 * Apply on BOTH sides of every comparison so accents never cause a mismatch.
 */
function normalizePlayerName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z ]/g, '')          // drop punctuation / apostrophes / hyphens
    .trim();
}

// ── Fuzzy player name matching ─────────────────────────────────────────────────

/**
 * Match Odds API player name to our DB player_name.
 * Handles last-name-only variants, initials, minor typos, and accented chars.
 */
function matchPlayerName(oddsName, projectionRows) {
  if (!oddsName) return null;
  const norm = normalizePlayerName(oddsName);

  // Exact match (normalized)
  let match = projectionRows.find(p => normalizePlayerName(p.player_name) === norm);
  if (match) return match;

  // Last name match
  const oddsLast = norm.split(' ').pop();
  match = projectionRows.find(p => normalizePlayerName(p.player_name).endsWith(oddsLast));
  if (match) return match;

  // First + last token contains
  const parts = norm.split(' ');
  if (parts.length >= 2) {
    const first = parts[0];
    const last  = parts[parts.length - 1];
    match = projectionRows.find(p => {
      const pl = normalizePlayerName(p.player_name);
      return pl.includes(first) && pl.includes(last);
    });
    if (match) return match;
  }

  return null;
}

/**
 * Return ALL chalk_projections rows for a player (one per prop type).
 * Used by detectEdges when the schema stores one row per prop_type + proj_value
 * instead of a single row with named columns (proj_points, proj_pra, etc.).
 */
function matchAllPlayerRows(oddsName, projectionRows) {
  if (!oddsName) return [];
  const norm = normalizePlayerName(oddsName);

  let rows = projectionRows.filter(p => normalizePlayerName(p.player_name) === norm);
  if (rows.length) return rows;

  const oddsLast = norm.split(' ').pop();
  rows = projectionRows.filter(p => normalizePlayerName(p.player_name).endsWith(oddsLast));
  if (rows.length) return rows;

  const parts = norm.split(' ');
  if (parts.length >= 2) {
    const first = parts[0];
    const last  = parts[parts.length - 1];
    rows = projectionRows.filter(p => {
      const pl = normalizePlayerName(p.player_name);
      return pl.includes(first) && pl.includes(last);
    });
    if (rows.length) return rows;
  }

  return [];
}

// ── Hot/cold streak detection ──────────────────────────────────────────────────

function detectStreak(factors) {
  const ctx = factors?.context || {};
  const baseL5  = factors?.context?.base_pts || 0;
  // We don't store L5 explicitly; use pace factor as a proxy
  // (cold factor is baked into the model; extract from factors_json if available)
  return { isHotStreak: false, isColdStreak: false };
}

// ── Projection internal sanity checks (Bug 2) ─────────────────────────────────

/**
 * Validate that our own projection values are internally consistent:
 *   NBA: PRA ≥ Points, PRA ≥ Rebounds, P+R ≥ Points, P+A ≥ Points
 * Returns { ok: bool, reason: string }
 */
function validateProjectionConsistency(proj, sport = 'NBA') {
  if (sport !== 'NBA') return { ok: true };

  const pts    = parseFloat(proj.proj_points)  || 0;
  const reb    = parseFloat(proj.proj_rebounds) || 0;
  const ast    = parseFloat(proj.proj_assists)  || 0;
  const pra    = parseFloat(proj.proj_pra)      || 0;
  const ptsReb = parseFloat(proj.proj_pts_reb)  || 0;
  const ptsAst = parseFloat(proj.proj_pts_ast)  || 0;
  const astReb = parseFloat(proj.proj_ast_reb)  || 0;

  const tolerance = 0.5; // allow small float drift

  if (pra > 0 && pts > 0 && pra < pts - tolerance) {
    return { ok: false, reason: `proj_pra (${pra}) < proj_points (${pts}) — impossible` };
  }
  if (pra > 0 && reb > 0 && pra < reb - tolerance) {
    return { ok: false, reason: `proj_pra (${pra}) < proj_rebounds (${reb}) — impossible` };
  }
  if (ptsReb > 0 && pts > 0 && ptsReb < pts - tolerance) {
    return { ok: false, reason: `proj_pts_reb (${ptsReb}) < proj_points (${pts}) — impossible` };
  }
  if (ptsAst > 0 && pts > 0 && ptsAst < pts - tolerance) {
    return { ok: false, reason: `proj_pts_ast (${ptsAst}) < proj_points (${pts}) — impossible` };
  }
  if (astReb > 0 && ast > 0 && astReb < ast - tolerance) {
    return { ok: false, reason: `proj_ast_reb (${astReb}) < proj_assists (${ast}) — impossible` };
  }
  if (pra > 0 && ptsReb > 0 && pra < ptsReb - tolerance) {
    return { ok: false, reason: `proj_pra (${pra}) < proj_pts_reb (${ptsReb}) — impossible` };
  }
  if (pra > 0 && ptsAst > 0 && pra < ptsAst - tolerance) {
    return { ok: false, reason: `proj_pra (${pra}) < proj_pts_ast (${ptsAst}) — impossible` };
  }

  return { ok: true };
}

/**
 * Validate that the market line makes sense against our projection.
 * Catches cases where we're comparing a combo-prop line against the wrong projection column
 * (e.g. pts_reb line of 20.5 matched against a proj_pts_reb of 13.2 — edge of -7.3 is suspicious).
 *
 * Rules:
 *  - |edge| must be < 50% of the line (if edge is half the line, something is wrong)
 *  - For combo props (pts_reb, pra, pts_ast): market line must be ≥ our projected points alone
 *    (you can't have a pts_reb line lower than points — the market would never post that)
 */
function validateLineConsistency(propType, line, projValue, proj, sport = 'NBA') {
  if (sport !== 'NBA') return { ok: true };

  const absEdge = Math.abs(projValue - line);

  // Edge magnitude check: if edge > 40% of the line, it's almost certainly a wrong-column match
  // (standard sportsbook lines are set near the player average; a 40%+ gap means something is wrong)
  if (line > 0 && absEdge / line > 0.40) {
    return {
      ok: false,
      reason: `Edge too large: |${(projValue - line).toFixed(1)}| is ${Math.round(absEdge / line * 100)}% of line ${line} — likely wrong projection column`,
    };
  }

  // Combo prop sanity: market line must be ≥ solo points projection
  const projPts = parseFloat(proj.proj_points) || 0;
  const combos  = ['pra', 'pts_reb', 'pts_ast'];
  if (projPts > 0 && combos.includes(propType) && line < projPts - 1.0) {
    return {
      ok: false,
      reason: `${propType} line ${line} < proj_points ${projPts} — market would never post a combo line below points alone`,
    };
  }

  return { ok: true };
}

// ── Playing-tonight gate (Bug 3) ───────────────────────────────────────────────

/**
 * Returns true if the player is confirmed playing tonight per nightly_roster.
 * Returns false if OUT. Returns null if player not in nightly_roster at all.
 * Call buildNightlyRoster() before detectEdges() to populate the table.
 */
/**
 * Returns:
 *   false           — player confirmed OUT (skip this player)
 *   true            — player confirmed playing
 *   'questionable'  — player listed but status uncertain (-10 confidence)
 *   'not_in_roster' — player's team not in nightly_roster (proceed, just unknown)
 */
async function isPlayerConfirmedPlaying(playerName, sport, gameDate) {
  // Use the original last name token (last whitespace-delimited word), NOT normalized,
  // so hyphenated names like "Gilgeous-Alexander" still match in the DB.
  const nameParts = (playerName || '').trim().split(/\s+/);
  const lastName = nameParts[nameParts.length - 1]; // "Gilgeous-Alexander", "Jokić", etc.

  const { rows } = await db.query(
    `SELECT is_confirmed_playing, injury_status
     FROM nightly_roster
     WHERE game_date = $1 AND sport = $2
       AND player_name ILIKE $3`,
    [gameDate, sport, `%${lastName}%`]
  );

  if (rows.length === 0) return 'not_in_roster'; // team may not be in BDL game list; don't skip
  if (rows[0].is_confirmed_playing === false) return false;        // confirmed OUT
  if (rows[0].is_confirmed_playing === null)  return 'questionable'; // GTD/questionable
  return true; // confirmed playing
}

// ── Build nightly roster (Bug 3) ───────────────────────────────────────────────

/**
 * Populate nightly_roster for NBA:
 *  1. Get tonight's games from BallDontLie
 *  2. For each game, collect both teams' players
 *  3. Fetch injury report; mark OUT players as is_confirmed_playing = false
 *  4. Mark everyone else on a playing team as is_confirmed_playing = true
 *     (unless status is 'questionable' → null)
 */
async function buildNightlyRoster(gameDate) {
  const today = gameDate || getTodayET();
  console.log(`\n📋 Building nightly_roster for ${today}...`);

  // Get tonight's NBA games
  const games = await bdl.getGames(today);
  if (!games || games.length === 0) {
    console.log('  No NBA games tonight — nightly_roster will be empty');
    return;
  }

  const playingTeamIds = new Set();
  for (const g of games) {
    if (g.home_team?.id) playingTeamIds.add(g.home_team.id);
    if (g.visitor_team?.id) playingTeamIds.add(g.visitor_team.id);
  }
  console.log(`  ${games.length} NBA games tonight — ${playingTeamIds.size} teams`);

  // Fetch injuries once
  const injuries = await bdl.getInjuries();
  // Build injury map: player_id → { status, description }
  const injuryMap = {};
  for (const inj of (injuries || [])) {
    const pid = inj.player?.id;
    if (pid) {
      const statusRaw = (inj.status || '').toLowerCase();
      injuryMap[pid] = { status: statusRaw, description: inj.description || '' };
    }
  }

  // Delete today's existing nightly_roster rows before rebuilding
  await db.query(
    `DELETE FROM nightly_roster WHERE game_date = $1 AND sport = 'NBA'`,
    [today]
  );

  // Fetch ALL NBA players, filter to tonight's playing teams
  const allPlayers = await bdl.getPlayers();
  const players = (allPlayers || []).filter(p => p.team?.id && playingTeamIds.has(p.team.id));

  let inserted = 0;
  for (const player of players) {
    const pid        = player.id;
    const firstName  = player.first_name || '';
    const lastName   = player.last_name  || '';
    const fullName   = `${firstName} ${lastName}`.trim();
    const teamName   = player.team?.full_name || player.team?.abbreviation || '';
    const inj        = injuryMap[pid];

    let isPlaying    = true;  // assume active unless injured
    let injuryStatus = null;

    if (inj) {
      injuryStatus = inj.status;
      if (['out', 'gtd-out', 'suspended', 'inactive'].some(s => inj.status.includes(s))) {
        isPlaying = false;
      } else if (inj.status.includes('questionable') || inj.status.includes('doubtful') || inj.status.includes('gtd')) {
        isPlaying = null; // uncertain — engine will lower confidence but not skip
      }
    }

    try {
      await db.query(
        `INSERT INTO nightly_roster
           (player_id, player_name, team, sport, game_date, is_confirmed_playing, injury_status)
         VALUES ($1, $2, $3, 'NBA', $4, $5, $6)
         ON CONFLICT (player_id, game_date, sport) DO UPDATE SET
           is_confirmed_playing = EXCLUDED.is_confirmed_playing,
           injury_status        = EXCLUDED.injury_status`,
        [pid, fullName, teamName, today, isPlaying, injuryStatus]
      );
      inserted++;
    } catch { /* skip individual insert errors */ }
  }

  const outCount          = Object.values(injuryMap).filter(i => i.status.includes('out')).length;
  const questionableCount = Object.values(injuryMap).filter(i => i.status.includes('questionable') || i.status.includes('gtd')).length;
  console.log(`  ✅ nightly_roster: ${inserted} players inserted (${outCount} OUT, ${questionableCount} questionable)`);

  // Build NHL and MLB rosters for tonight's games
  await buildNHLRoster(today);
  await buildMLBRoster(today);
}

/**
 * Populate nightly_roster for NHL:
 *  1. Get tonight's games from the NHL schedule API
 *  2. For each playing team, fetch current active roster
 *  3. Insert all players as is_confirmed_playing = true (active roster = healthy)
 *     Goalies are inserted with is_confirmed_starter = null (set by runGoalieConfirmation)
 *
 * Note: IR players don't appear on the active roster endpoint, so filtering is automatic.
 * Goalie starter status is resolved separately at puck-drop minus 90 min.
 */
async function buildNHLRoster(gameDate) {
  const today = gameDate || getTodayET();
  console.log(`\n🏒 Building NHL nightly_roster for ${today}…`);

  let schedData = null;
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`, {
      signal: AbortSignal.timeout(10000),
    });
    schedData = await res.json();
  } catch (e) {
    console.log(`  [WARN] NHL schedule fetch failed: ${e.message}`);
    return;
  }

  const games = schedData?.gameWeek?.[0]?.games || [];
  if (games.length === 0) {
    console.log('  No NHL games tonight.');
    return;
  }

  // Collect unique team abbreviations for tonight's games
  const teams = new Set();
  for (const g of games) {
    if (g.homeTeam?.abbrev) teams.add(g.homeTeam.abbrev);
    if (g.awayTeam?.abbrev) teams.add(g.awayTeam.abbrev);
  }
  console.log(`  ${games.length} NHL games — ${teams.size} teams`);

  // Delete today's existing NHL roster entries before rebuild
  await db.query(
    `DELETE FROM nightly_roster WHERE game_date = $1 AND sport = 'NHL'`,
    [today]
  );

  let totalInserted = 0;

  for (const teamAbbrev of teams) {
    let rosterData = null;
    try {
      const res = await fetch(`https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`, {
        signal: AbortSignal.timeout(8000),
      });
      rosterData = await res.json();
    } catch (e) {
      console.log(`  [WARN] Roster fetch failed for ${teamAbbrev}: ${e.message}`);
      continue;
    }

    const forwards   = rosterData?.forwards   || [];
    const defensemen = rosterData?.defensemen || [];
    const goalies    = rosterData?.goalies    || [];

    const allPlayers = [
      ...forwards.map(p => ({ ...p, posGroup: 'F' })),
      ...defensemen.map(p => ({ ...p, posGroup: 'D' })),
      ...goalies.map(p => ({ ...p, posGroup: 'G' })),
    ];

    for (const player of allPlayers) {
      const pid      = player.id;
      const fullName = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();
      const position = player.positionCode || player.posGroup;
      const isGoalie = player.posGroup === 'G';

      try {
        await db.query(
          `INSERT INTO nightly_roster
             (player_id, player_name, team, sport, game_date, position,
              is_confirmed_playing, is_confirmed_starter, injury_status)
           VALUES ($1, $2, $3, 'NHL', $4, $5, $6, $7, NULL)
           ON CONFLICT (player_id, game_date, sport) DO UPDATE SET
             is_confirmed_playing  = EXCLUDED.is_confirmed_playing,
             position              = EXCLUDED.position,
             is_confirmed_starter  = EXCLUDED.is_confirmed_starter`,
          [
            pid,
            fullName,
            teamAbbrev,
            today,
            position,
            true,           // active roster = confirmed playing
            isGoalie ? null : null,  // goalie starter status set later by runGoalieConfirmation
          ]
        );
        totalInserted++;
      } catch { /* skip individual insert errors */ }
    }
  }

  console.log(`  ✅ NHL nightly_roster: ${totalInserted} players inserted across ${teams.size} teams`);

  // Cross-reference ESPN NHL injuries to downgrade GTD/questionable players.
  // Active roster = healthy enough to dress, but GTD players may still be listed.
  // IR players already absent from active roster so no false positives here.
  try {
    const espnInjuries = await espn.getInjuries('NHL');
    let gtdCount = 0;
    for (const inj of espnInjuries) {
      const s = (inj.status || '').toLowerCase();
      const isGTD = s.includes('questionable') || s.includes('doubtful') || s.includes('day-to-day') || s.includes('gtd');
      if (!isGTD) continue;
      // Set is_confirmed_playing = null (questionable) for this player
      const lastName = (inj.playerName || '').split(' ').pop();
      if (!lastName) continue;
      const result = await db.query(
        `UPDATE nightly_roster
         SET is_confirmed_playing = NULL, injury_status = $1
         WHERE game_date = $2 AND sport = 'NHL'
           AND player_name ILIKE $3
           AND is_confirmed_playing = true`,
        [inj.status, today, `%${lastName}%`]
      );
      if (result.rowCount > 0) gtdCount++;
    }
    if (gtdCount > 0) console.log(`  📋 NHL ESPN: ${gtdCount} players downgraded to questionable`);
  } catch (e) {
    console.log(`  [WARN] ESPN NHL injury cross-reference failed: ${e.message}`);
  }
}

/**
 * Populate nightly_roster for MLB:
 *  1. Get tonight's games from MLB Stats API
 *  2. Fetch each team's active 26-man roster
 *  3. Cross-reference ESPN MLB injuries to mark OUT / questionable
 *  4. Insert all players into nightly_roster
 */
async function buildMLBRoster(gameDate) {
  const today = gameDate || getTodayET();
  console.log(`\n⚾ Building MLB nightly_roster for ${today}...`);

  // Convert YYYY-MM-DD to MM/DD/YYYY for MLB Stats API
  const [y, m, d] = today.split('-');
  const mlbDate = `${m}/${d}/${y}`;

  let games = [];
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${mlbDate}&hydrate=team`,
      { signal: AbortSignal.timeout(10000) }
    );
    const json = await res.json();
    games = (json?.dates || []).flatMap(dg => dg.games || []);
  } catch (e) {
    console.log(`  [WARN] MLB schedule fetch failed: ${e.message}`);
    return;
  }

  if (games.length === 0) {
    console.log('  No MLB games today.');
    return;
  }

  const teamMap = new Map(); // teamId → abbreviation
  for (const g of games) {
    const ht = g.teams?.home?.team;
    const at = g.teams?.away?.team;
    if (ht?.id) teamMap.set(ht.id, ht.abbreviation || String(ht.id));
    if (at?.id) teamMap.set(at.id, at.abbreviation || String(at.id));
  }
  console.log(`  ${games.length} MLB games — ${teamMap.size} teams`);

  // Fetch ESPN MLB injuries → normalized name → status
  const injuryMap = {};
  try {
    const espnInjuries = await espn.getInjuries('MLB');
    for (const inj of espnInjuries) {
      const key = (inj.playerName || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
      if (key) injuryMap[key] = (inj.status || '').toLowerCase();
    }
    console.log(`  ESPN MLB injuries loaded: ${Object.keys(injuryMap).length} players`);
  } catch (e) {
    console.log(`  [WARN] ESPN MLB injuries failed: ${e.message}`);
  }

  // Delete today's existing MLB roster entries before rebuild
  await db.query(
    `DELETE FROM nightly_roster WHERE game_date = $1 AND sport = 'MLB'`,
    [today]
  );

  let totalInserted = 0;

  for (const [teamId, teamAbbr] of teamMap.entries()) {
    let roster = [];
    try {
      const res = await fetch(
        `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active`,
        { signal: AbortSignal.timeout(8000) }
      );
      const json = await res.json();
      roster = json?.roster || [];
    } catch (e) {
      console.log(`  [WARN] MLB roster fetch failed for ${teamAbbr}: ${e.message}`);
      continue;
    }

    for (const player of roster) {
      const pid      = player.person?.id;
      const fullName = player.person?.fullName || '';
      const position = player.position?.abbreviation || '';
      if (!pid) continue;

      const nameKey    = fullName.toLowerCase().replace(/[^a-z ]/g, '').trim();
      const statusRaw  = injuryMap[nameKey] || '';

      let isPlaying    = true;
      let injuryStatus = null;

      if (statusRaw) {
        injuryStatus = statusRaw;
        if (['out', 'il', '10-day', '15-day', '60-day', 'suspended'].some(s => statusRaw.includes(s))
            && !statusRaw.includes('questionable')) {
          isPlaying = false;
        } else if (statusRaw.includes('questionable') || statusRaw.includes('day-to-day') || statusRaw.includes('dtd')) {
          isPlaying = null; // GTD — lower confidence but don't skip
        }
      }

      try {
        await db.query(
          `INSERT INTO nightly_roster
             (player_id, player_name, team, sport, game_date, position,
              is_confirmed_playing, injury_status)
           VALUES ($1, $2, $3, 'MLB', $4, $5, $6, $7)
           ON CONFLICT (player_id, game_date, sport) DO UPDATE SET
             is_confirmed_playing = EXCLUDED.is_confirmed_playing,
             position             = EXCLUDED.position,
             injury_status        = EXCLUDED.injury_status`,
          [pid, fullName, teamAbbr, today, position, isPlaying, injuryStatus]
        );
        totalInserted++;
      } catch { /* skip individual insert errors */ }
    }
  }

  const outCount = Object.values(injuryMap).filter(s => s.includes('out')).length;
  const qtCount  = Object.values(injuryMap).filter(s => s.includes('questionable') || s.includes('day-to-day')).length;
  console.log(`  ✅ MLB nightly_roster: ${totalInserted} players inserted (ESPN: ${outCount} OUT, ${qtCount} questionable)`);
}

// ── Teammate injury cascading for assist props ──────────────────────────────────

/**
 * For assist-sensitive props (assists, pra, pts_ast, ast_reb):
 * Check if a primary scorer or primary ball-handler on the player's team is out.
 * Returns { delta: number } — positive means role expansion, negative means fewer options.
 *
 * Requires nightly_roster to be populated (built at start of detectEdges).
 */
async function getTeammateAstInjuryAdj(team, playerId, sport, gameDate) {
  try {
    const { rows: outPlayers } = await db.query(
      `SELECT nr.player_id, nr.player_name
       FROM nightly_roster nr
       WHERE nr.team ILIKE $1 AND nr.sport = $2 AND nr.game_date = $3
         AND nr.is_confirmed_playing = false
         AND nr.player_id != $4`,
      [`%${team}%`, sport, gameDate, playerId]
    );
    if (!outPlayers.length) return { delta: 0 };

    let primaryScorerOut = false;
    let primaryPgOut     = false;

    for (const p of outPlayers) {
      const { rows: avgRows } = await db.query(
        `SELECT AVG(points) AS avg_pts, AVG(assists) AS avg_ast
         FROM player_game_logs
         WHERE player_id = $1 AND sport = $2 AND minutes >= 10
         ORDER BY game_date DESC LIMIT 30`,
        [p.player_id, sport]
      );
      if (avgRows.length) {
        const avgPts = parseFloat(avgRows[0].avg_pts) || 0;
        const avgAst = parseFloat(avgRows[0].avg_ast) || 0;
        if (avgPts > 15) primaryScorerOut = true;  // key scoring target is gone
        if (avgAst > 6)  primaryPgOut     = true;  // primary playmaker is gone
      }
    }

    // Primary scorer out → player has fewer options to find → assist ceiling drops
    if (primaryScorerOut) return { delta: -8 };
    // Multiple teammates out → fewer reliable passing targets
    if (outPlayers.length >= 2) return { delta: -5 };
    return { delta: 0 };
  } catch {
    return { delta: 0 };
  }
}

// ── Main pipeline ──────────────────────────────────────────────────────────────

async function detectEdges(gameDate) {
  const today = gameDate || getTodayET();
  console.log(`\n🔍 Edge Detector — ${today}`);

  // ── Step 1: Load our projections ────────────────────────────────────────────
  const projections = await getTodaysProjections(today);
  console.log(`  Loaded ${projections.length} player projections from DB`);

  if (projections.length === 0) {
    console.log('  No projections found. Run nbaProjectionModel.py first.');
    return [];
  }

  // ── Step 2: Get tonight's NBA events from Odds API ───────────────────────────
  const events = await fetchNBAEvents();
  const gameOdds = await fetchNBAGameOdds();
  console.log(`  Found ${events.length} NBA events, ${gameOdds.length} game odds`);

  // ── Patch chalk_projections with real opponent names from tonight's events ──
  // The Python model stores 'OPP' as a placeholder; replace it with actual matchup data.
  // chalk_projections.team uses BDL abbreviations (SAC, DEN…); map from Odds API full names.
  for (const ev of events) {
    const homeAbbr = NBA_TEAM_ABBR[ev.home_team];
    const awayAbbr = NBA_TEAM_ABBR[ev.away_team];
    if (homeAbbr) {
      await db.query(
        `UPDATE chalk_projections
         SET opponent = $1, home_away = 'home'
         WHERE game_date = $2 AND sport = 'NBA' AND team = $3`,
        [ev.away_team, today, homeAbbr]
      );
    }
    if (awayAbbr) {
      await db.query(
        `UPDATE chalk_projections
         SET opponent = $1, home_away = 'away'
         WHERE game_date = $2 AND sport = 'NBA' AND team = $3`,
        [ev.home_team, today, awayAbbr]
      );
    }
  }

  // Update team projections with real posted lines
  for (const game of gameOdds) {
    const lines = extractGameLines(game);
    if (lines.homeSpread != null) {
      await updateTeamProjectionLines(game.home_team, today, lines.homeSpread, lines.total);
    }
  }

  // Build a set of team abbreviations playing tonight using NBA_TEAM_ABBR map.
  // chalk_projections.team stores BDL abbreviations (SAC, DEN, PHX, OKC…)
  // so we must compare abbreviations, not full names.
  const teamAbbrsPlayingTonight = new Set();
  for (const ev of events) {
    const ha = NBA_TEAM_ABBR[ev.home_team];
    const aa = NBA_TEAM_ABBR[ev.away_team];
    if (ha) teamAbbrsPlayingTonight.add(ha);
    if (aa) teamAbbrsPlayingTonight.add(aa);
  }

  const allEdges = [];

  // ── Step 3: For each event, fetch player props and compare ───────────────────
  for (const event of events) {
    console.log(`  Processing: ${event.away_team} @ ${event.home_team}`);

    const propsData = await fetchPlayerProps('basketball_nba', event.id);
    const oddsLines = propsData ? extractPlayerLines(propsData) : {};

    // Supplement with BallDontLie player props for any lines missing from Odds API
    const bdlGameId = event.id;  // BDL uses the same UUID when available; gracefully returns [] otherwise
    const bdlLines  = await fetchBdlPlayerLines(bdlGameId);
    const playerLines = mergeBdlLines(oddsLines, bdlLines);

    const playerCount = Object.keys(playerLines).length;
    console.log(`    ${playerCount} players with prop lines (odds: ${Object.keys(oddsLines).length}, bdl supplement: ${Object.keys(bdlLines).length})`);

    // Find posted game total (for confidence scoring)
    const gameOddsEntry = gameOdds.find(g => g.id === event.id);
    const gameLines     = gameOddsEntry ? extractGameLines(gameOddsEntry) : {};
    const impliedTotal  = gameLines.total;

    // ── Step 4: Compare each player's line to our projection ──────────────────
    for (const [oddsPlayerName, marketData] of Object.entries(playerLines)) {
      // The model writes one row per prop_type (using proj_value column).
      // Get ALL rows for this player so we can look up the right one per market.
      const playerProjs = matchAllPlayerRows(oddsPlayerName, projections);
      if (!playerProjs || playerProjs.length === 0) continue;
      const proj = playerProjs[0]; // use first row for team/position/injury metadata

      // ── Team gate: skip players whose team isn't in tonight's Odds API events ─
      if (!teamAbbrsPlayingTonight.has(proj.team)) {
        console.log(`  SKIP (team not playing tonight): ${proj.player_name} (${proj.team})`);
        continue;
      }

      // ── Bug 3: Injury gate ────────────────────────────────────────────────
      const playingStatus = await isPlayerConfirmedPlaying(proj.player_name, 'NBA', today);
      if (playingStatus === false) {
        // Confirmed OUT — hard skip
        console.log(`  SKIP (confirmed OUT): ${proj.player_name}`);
        continue;
      }
      // 'not_in_roster' → team may not be in BDL yet; proceed but note as uncertain
      // 'questionable'  → GTD; will reduce confidence by 10
      // true            → confirmed playing; full confidence

      const isQuestionable = playingStatus === 'questionable';

      // Determine opponent abbreviation from the event (proj.team is already an abbreviation)
      const homeAbbr     = NBA_TEAM_ABBR[event.home_team];
      const awayAbbr     = NBA_TEAM_ABBR[event.away_team];
      const opponentAbbr = proj.team === homeAbbr ? awayAbbr : homeAbbr;
      const opponentFullName = proj.team === homeAbbr ? event.away_team : event.home_team;

      for (const [marketKey, lineData] of Object.entries(marketData)) {
        // Look up the row whose prop_type matches this market (new per-prop-row schema).
        // Fallback: try legacy named column (proj_points etc.) for backwards compatibility.
        const dbPropType = MARKET_TO_DB_PROP[marketKey];
        const projRow    = dbPropType
          ? playerProjs.find(p => p.prop_type === dbPropType)
          : null;
        const legacyCol  = MARKET_TO_PROJ[marketKey];
        const projValue  = projRow
          ? parseFloat(projRow.proj_value)
          : (legacyCol ? parseFloat(proj[legacyCol]) : NaN);

        if (projValue == null || isNaN(projValue)) continue;

        const line = parseFloat(lineData.line);
        if (!line || isNaN(line)) continue;

        // ── Bug 2: Line plausibility check ──────────────────────────────────
        const propTypeForCheck = Object.entries(PROP_MARKET_MAP).find(([k, v]) => v === marketKey)?.[0] || marketKey;
        const lineCheck = validateLineConsistency(propTypeForCheck, line, projValue, proj, 'NBA');
        if (!lineCheck.ok) {
          console.log(`  SKIP (bad line): ${proj.player_name} ${propTypeForCheck} line=${line} proj=${projValue} — ${lineCheck.reason}`);
          continue;
        }

        // Read factors from the matching prop row (contains rest/pace context)
        const activeRow = projRow || proj;
        let factors = {};
        try { factors = typeof activeRow.factors_json === 'string' ? JSON.parse(activeRow.factors_json) : (activeRow.factors_json || {}); } catch {}

        const edge = projValue - line;

        // propType already determined above for the line check
        const propType = propTypeForCheck;

        // Low-minutes players require a wider edge to generate a pick
        const ctxFactors   = factors?.context || {};
        const baseMinEdge  = getMinEdge('NBA', propType);
        const effectiveMin = (ctxFactors.season_min_avg && ctxFactors.season_min_avg < 20)
          ? 2.5
          : baseMinEdge;
        if (Math.abs(edge) < effectiveMin) continue;

        // Determine if over or under
        const direction = edge > 0 ? 'over' : 'under';

        // ── Sample size for reliability signal ────────────────────────────
        const playerStats = await getPlayerRecentStats(proj.player_id, propType, today);

        const confidence = calculateConfidence(edge, propType, 'NBA', playerStats.gamesPlayed);
        if (confidence === null) continue; // edge below threshold — skip
        const breakdown = {};

        // ── Teammate injury cascading for assist-sensitive props ──────────
        let finalConfidence = confidence;
        const astProps = ['assists', 'pra', 'pts_ast', 'ast_reb'];
        if (astProps.includes(propType)) {
          const injAdj = await getTeammateAstInjuryAdj(proj.team, proj.player_id, 'NBA', today);
          if (injAdj.delta !== 0) {
            finalConfidence = Math.max(50, Math.min(92, confidence + injAdj.delta));
          }
        }

        if (finalConfidence < MIN_CONFIDENCE) continue;

        const edgeObj = {
          playerId:        proj.player_id,
          playerName:      proj.player_name,
          team:            proj.team,
          opponent:        opponentFullName,
          gameDate:        today,
          propType,
          line,
          direction,
          chalkProjection: projValue,
          chalkEdge:       parseFloat(edge.toFixed(3)),
          confidence:      finalConfidence,
          confidenceBreakdown: breakdown,
          dkOdds:          lineData.dk_odds,
          fdOdds:          lineData.fd_odds,
          mgmOdds:         lineData.mgm_odds,
          bet365Odds:      lineData.bet365_odds,
          impliedTotal,
          factors,
        };

        allEdges.push(edgeObj);

        // Store to DB — wrapped so one failure doesn't abort the rest of the player loop
        try {
          await storeEdge({
            playerId:        edgeObj.playerId,
            playerName:      edgeObj.playerName,
            team:            edgeObj.team,
            gameDate:        today,
            propType,
            propLine:        line,
            dkOdds:          lineData.dk_odds,
            fdOdds:          lineData.fd_odds,
            mgmOdds:         lineData.mgm_odds,
            bet365Odds:      lineData.bet365_odds,
            chalkProjection: projValue,
            chalkEdge:       edgeObj.chalkEdge,
            confidence:      finalConfidence,
          });
        } catch (err) {
          console.error(`  [storeEdge] Failed for ${edgeObj.playerName} ${propType}: ${err.message}`);
        }
      }
    }
  }

  // Update edge columns in chalk_projections
  for (const edge of allEdges) {
    const mktKey = Object.entries(PROP_MARKET_MAP).find(([k]) => k === edge.propType)?.[1];
    const edgeCol = MARKET_TO_EDGE_COL[mktKey];
    if (edgeCol) {
      await db.query(
        `UPDATE chalk_projections SET ${edgeCol} = $1 WHERE player_id = $2 AND game_date = $3`,
        [edge.chalkEdge, edge.playerId, today]
      );
    }
  }

  // Sort by confidence × edge and take top MAX_PICKS
  const topEdges = allEdges
    .sort((a, b) => (b.confidence + Math.abs(b.chalkEdge) * 3) - (a.confidence + Math.abs(a.chalkEdge) * 3))
    .slice(0, MAX_PICKS);

  console.log(`\n  ✅ Found ${allEdges.length} raw edges → ${topEdges.length} top picks`);
  for (const e of topEdges) {
    const dir = e.direction === 'over' ? '▲' : '▼';
    console.log(`    ${dir} ${e.playerName} ${e.propType} ${e.direction.toUpperCase()} ${e.line} (proj: ${e.chalkProjection.toFixed(1)}, edge: ${e.chalkEdge > 0 ? '+' : ''}${e.chalkEdge}, conf: ${e.confidence})`);
  }

  return topEdges;
}

// ── Read today's top edges across all sports (called by aiPicks.js) ──────────

async function getTodaysEdges(gameDate, sport = null) {
  const today = gameDate || getTodayET();
  // Use parameterized sport filter to avoid SQL injection and handle null cleanly
  const params = sport
    ? [today, MIN_CONFIDENCE, MAX_PICKS, sport]
    : [today, MIN_CONFIDENCE, MAX_PICKS];
  const sportClause = sport ? `AND pph.sport = $4` : '';

  try {
    const { rows } = await db.query(
      `SELECT pph.*, cp.opponent, cp.home_away, cp.factors_json
       FROM player_props_history pph
       LEFT JOIN chalk_projections cp
         ON cp.player_id = pph.player_id
         AND cp.game_date = pph.game_date
         AND cp.prop_type = pph.prop_type
       WHERE pph.game_date = $1
         ${sportClause}
         AND pph.chalk_edge IS NOT NULL
         AND pph.confidence >= $2
       ORDER BY pph.confidence DESC, ABS(pph.chalk_edge) DESC
       LIMIT $3`,
      params
    );
    return rows;
  } catch (err) {
    console.error(`[getTodaysEdges] DB query failed: ${err.message}`);
    return [];
  }
}

// ── Detect edges for MLB or NHL (same architecture as NBA detectEdges) ────────

async function detectEdgesForSport(sport, gameDate) {
  const today = gameDate || getTodayET();
  const sportKey = SPORT_KEY_MAP[sport];
  if (!sportKey) return [];

  console.log(`\n🔍 Edge Detector [${sport}] — ${today}`);

  const projections = await getTodaysProjections(today, sport);
  console.log(`  Loaded ${projections.length} ${sport} player projections`);
  if (projections.length === 0) return [];

  const { propMap, projMap, dbPropMap } = getPropMapsForSport(sport);

  // Fetch events from Odds API for this sport
  let events = [];
  if (ODDS_API_KEY) {
    const url = `${BASE_URL}/sports/${sportKey}/events?apiKey=${ODDS_API_KEY}`;
    events = (await fetchWithRetry(url, { fallback: [] })) || [];
  }
  console.log(`  Found ${events.length} ${sport} events from Odds API`);

  const allEdges = [];

  for (const event of events) {
    let propsData = null;
    if (ODDS_API_KEY) {
      const markets = Object.values(propMap).join(',');
      const url = `${BASE_URL}/sports/${sportKey}/events/${event.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=american`;
      propsData = await fetchWithRetry(url, { fallback: null });
    }

    const playerLines = propsData ? extractPlayerLines(propsData) : {};
    const playerCount = Object.keys(playerLines).length;
    if (playerCount === 0) continue;

    console.log(`  ${event.away_team} @ ${event.home_team}: ${playerCount} players`);

    for (const [oddsPlayerName, marketData] of Object.entries(playerLines)) {
      const playerProjs = matchAllPlayerRows(oddsPlayerName, projections);
      if (!playerProjs || playerProjs.length === 0) continue;

      const proj = playerProjs[0]; // use first row for team/position/injury metadata
      const sampleSize = (() => {
        try { return JSON.parse(typeof proj.factors_json === 'string' ? proj.factors_json : JSON.stringify(proj.factors_json || {}))?.context?.games_used ?? null; } catch { return null; }
      })();

      // ── Injury gate (same as NBA path) ──────────────────────────────────────
      const playingStatus = await isPlayerConfirmedPlaying(proj.player_name, sport, today);
      if (playingStatus === false) {
        console.log(`  SKIP (confirmed OUT): ${proj.player_name} [${sport}]`);
        continue;
      }
      const isQuestionable = playingStatus === 'questionable';

      for (const [marketKey, lineData] of Object.entries(marketData)) {
        // Look up the row whose prop_type matches this market (new per-prop-row schema).
        // Fallback: try legacy named column for backwards compatibility.
        const dbPropType = dbPropMap[marketKey];
        const projRow    = dbPropType
          ? playerProjs.find(p => p.prop_type === dbPropType)
          : null;
        const legacyCol  = projMap[marketKey];
        const projValue  = projRow
          ? parseFloat(projRow.proj_value)
          : (legacyCol ? parseFloat(proj[legacyCol]) : NaN);

        if (projValue == null || isNaN(projValue)) continue;

        const line = parseFloat(lineData.line);
        if (!line || isNaN(line)) continue;

        const edge    = projValue - line;
        const propTypeInternal = Object.entries(propMap).find(([, v]) => v === marketKey)?.[0] || marketKey;
        const minEdge = getMinEdge(sport, propTypeInternal);
        if (Math.abs(edge) < minEdge) continue;

        const direction = edge > 0 ? 'over' : 'under';

        // Read factors from the matching prop row
        const activeRow = projRow || proj;
        let factors = {};
        try { factors = typeof activeRow.factors_json === 'string' ? JSON.parse(activeRow.factors_json) : (activeRow.factors_json || {}); } catch {}

        const confidence = calculateConfidence(edge, propTypeInternal, sport, sampleSize ?? 10);
        if (confidence === null || confidence < MIN_CONFIDENCE) continue;

        const edgeObj = {
          playerId:        proj.player_id,
          playerName:      proj.player_name,
          team:            proj.team,
          sport,
          opponent:        event.home_team === proj.team ? event.away_team : event.home_team,
          gameDate:        today,
          propType:        propTypeInternal,
          line,
          direction,
          chalkProjection: projValue,
          chalkEdge:       parseFloat(edge.toFixed(3)),
          confidence,
          dkOdds:          lineData.dk_odds,
          fdOdds:          lineData.fd_odds,
          mgmOdds:         lineData.mgm_odds,
          bet365Odds:      lineData.bet365_odds,
          factors,
        };

        allEdges.push(edgeObj);
        try {
          await storeEdge({
            playerId:        edgeObj.playerId,
            playerName:      edgeObj.playerName,
            team:            edgeObj.team,
            sport,
            gameDate:        today,
            propType:        propTypeInternal,
            propLine:        line,
            dkOdds:          lineData.dk_odds,
            fdOdds:          lineData.fd_odds,
            mgmOdds:         lineData.mgm_odds,
            bet365Odds:      lineData.bet365_odds,
            chalkProjection: projValue,
            chalkEdge:       edgeObj.chalkEdge,
            confidence,
          });
        } catch (err) {
          console.error(`  [storeEdge] Failed for ${edgeObj.playerName} ${propTypeInternal}: ${err.message}`);
        }
      }
    }
  }

  const topEdges = allEdges
    .sort((a, b) => (b.confidence + Math.abs(b.chalkEdge) * 3) - (a.confidence + Math.abs(a.chalkEdge) * 3))
    .slice(0, MAX_PICKS);

  console.log(`  ✅ ${sport}: ${allEdges.length} raw edges → ${topEdges.length} top picks`);
  return topEdges;
}

// ── Collect prop lines for all sports (9 AM cron) ─────────────────────────────

async function collectPropsLines() {
  console.log('📥 Collecting prop lines from The Odds API (NBA + MLB + NHL)…');
  const sports = ['basketball_nba', 'baseball_mlb', 'icehockey_nhl'];
  let totalEvents = 0;

  for (const sportKey of sports) {
    const url = `${BASE_URL}/sports/${sportKey}/events?apiKey=${ODDS_API_KEY}`;
    const data = (await fetchWithRetry(url, { fallback: [] })) || [];
    totalEvents += data.length;
    console.log(`  ${sportKey}: ${data.length} events tonight`);
  }

  console.log(`  Total: ${totalEvents} events across all sports`);
  return totalEvents;
}

module.exports = {
  detectEdges,
  detectEdgesForSport,
  detectTeamBetEdges,
  getTodaysEdges,
  collectPropsLines,
  buildNightlyRoster,
  buildMLBRoster,
  normalizePlayerName,
};
