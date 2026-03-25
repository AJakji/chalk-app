/**
 * Chalk NBA Service Client
 * ========================
 * Node.js interface to the Python nba_api microservice.
 * All calls fail gracefully — if the NBA service is down the picks engine
 * and research routes still work, just without real data context.
 *
 * NBA_SERVICE_URL defaults to http://localhost:8000 for local dev.
 * Set it in .env to point at the Railway/production URL.
 */

const NBA_SERVICE_URL = process.env.NBA_SERVICE_URL || 'http://localhost:8000';
const TIMEOUT_MS = 15000; // 15s — nba_api can be slow on cold cache

// ── Team name → NBA.com ID map (mirrors teams.py) ────────────────────────────
const TEAM_IDS = {
  'Atlanta Hawks':          1610612737,
  'Boston Celtics':         1610612738,
  'Brooklyn Nets':          1610612751,
  'Charlotte Hornets':      1610612766,
  'Chicago Bulls':          1610612741,
  'Cleveland Cavaliers':    1610612739,
  'Dallas Mavericks':       1610612742,
  'Denver Nuggets':         1610612743,
  'Detroit Pistons':        1610612765,
  'Golden State Warriors':  1610612744,
  'Houston Rockets':        1610612745,
  'Indiana Pacers':         1610612754,
  'LA Clippers':            1610612746,
  'Los Angeles Clippers':   1610612746,
  'LA Lakers':              1610612747,
  'Los Angeles Lakers':     1610612747,
  'Memphis Grizzlies':      1610612763,
  'Miami Heat':             1610612748,
  'Milwaukee Bucks':        1610612749,
  'Minnesota Timberwolves': 1610612750,
  'New Orleans Pelicans':   1610612740,
  'New York Knicks':        1610612752,
  'Oklahoma City Thunder':  1610612760,
  'Orlando Magic':          1610612753,
  'Philadelphia 76ers':     1610612755,
  'Phoenix Suns':           1610612756,
  'Portland Trail Blazers': 1610612757,
  'Sacramento Kings':       1610612758,
  'San Antonio Spurs':      1610612759,
  'Toronto Raptors':        1610612761,
  'Utah Jazz':              1610612762,
  'Washington Wizards':     1610612764,
};

function getTeamId(teamName) {
  if (!teamName) return null;
  if (TEAM_IDS[teamName]) return TEAM_IDS[teamName];
  // Partial match (e.g. "Celtics" → "Boston Celtics")
  const lower = teamName.toLowerCase();
  for (const [name, id] of Object.entries(TEAM_IDS)) {
    if (name.toLowerCase().includes(lower) || lower.includes(name.split(' ').pop().toLowerCase())) {
      return id;
    }
  }
  return null;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function nbaFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${NBA_SERVICE_URL}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`NBA service ${res.status}: ${path}`);
    const json = await res.json();
    return json.data ?? json;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`NBA service timeout: ${path}`);
    throw err;
  }
}

async function nbaFetchSafe(path) {
  try {
    return await nbaFetch(path);
  } catch (err) {
    console.warn(`[NBA] Fetch failed (non-fatal): ${err.message}`);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Live scoreboard from NBA.com */
async function getScoreboard() {
  return nbaFetch('/nba/league/scoreboard');
}

/** Today's games from stats API scoreboard */
async function getScoreboardV2(date) {
  const q = date ? `?game_date=${date}` : '';
  return nbaFetch(`/nba/league/scoreboard-v2${q}`);
}

/** Live box score for a game */
async function getLiveBoxScore(gameId) {
  return nbaFetch(`/nba/boxscore/${gameId}/live`);
}

/** Full traditional box score */
async function getBoxScoreTraditional(gameId) {
  return nbaFetch(`/nba/boxscore/${gameId}/traditional`);
}

/** Advanced box score */
async function getBoxScoreAdvanced(gameId) {
  return nbaFetch(`/nba/boxscore/${gameId}/advanced`);
}

/** Play-by-play (live) */
async function getPlayByPlay(gameId) {
  return nbaFetch(`/nba/game/${gameId}/playbyplay`);
}

/** Win probability curve */
async function getWinProbability(gameId) {
  return nbaFetch(`/nba/game/${gameId}/win-probability`);
}

/** League standings */
async function getStandings(season = '2024-25') {
  return nbaFetch(`/nba/league/standings?season=${season}`);
}

/** League leaders for a stat category (PTS, REB, AST, STL, BLK, ...) */
async function getLeagueLeaders(statCategory = 'PTS', season = '2024-25') {
  return nbaFetch(`/nba/league/leaders?season=${season}&stat_category=${statCategory}`);
}

/** Season team stats (for all 30 teams) */
async function getLeagueTeamStats(season = '2024-25', perMode = 'PerGame') {
  return nbaFetch(`/nba/league/team-stats?season=${season}&per_mode=${perMode}`);
}

/** Clutch team stats */
async function getClutchTeamStats(season = '2024-25') {
  return nbaFetch(`/nba/league/clutch-teams?season=${season}`);
}

/** Team general dashboard (season averages + splits) */
async function getTeamDashboard(teamId, season = '2024-25') {
  return nbaFetch(`/nba/team/${teamId}/dashboard?season=${season}`);
}

/** Team last-N games */
async function getTeamLastN(teamId, n = 10, season = '2024-25') {
  return nbaFetch(`/nba/team/${teamId}/last-n?n=${n}&season=${season}`);
}

/** Team opponent splits (how they defend) */
async function getTeamOpponentSplits(teamId, season = '2024-25') {
  return nbaFetch(`/nba/team/${teamId}/opponent-splits?season=${season}`);
}

/** Team clutch performance */
async function getTeamClutch(teamId, season = '2024-25') {
  return nbaFetch(`/nba/team/${teamId}/clutch?season=${season}`);
}

/** Team roster */
async function getTeamRoster(teamId, season = '2024-25') {
  return nbaFetch(`/nba/team/${teamId}/roster?season=${season}`);
}

/** Player info */
async function getPlayerInfo(playerId) {
  return nbaFetch(`/nba/player/${playerId}/info`);
}

/** Player career stats */
async function getPlayerCareer(playerId) {
  return nbaFetch(`/nba/player/${playerId}/career`);
}

/** Player game log */
async function getPlayerGameLog(playerId, season = '2024-25') {
  return nbaFetch(`/nba/player/${playerId}/gamelog?season=${season}`);
}

/** Player last-N games dashboard */
async function getPlayerLastN(playerId, n = 10, season = '2024-25') {
  return nbaFetch(`/nba/player/${playerId}/last-n?n=${n}&season=${season}`);
}

/** Player shot chart */
async function getPlayerShotChart(playerId, season = '2024-25') {
  return nbaFetch(`/nba/player/${playerId}/shot-chart?season=${season}`);
}

/** All-data player deep dive (composite) */
async function getPlayerDeepDive(playerId, season = '2024-25') {
  return nbaFetch(`/nba/player/${playerId}/deep-dive?season=${season}`);
}

/** Search players by name */
async function searchPlayers(name) {
  return nbaFetch(`/nba/players/search?name=${encodeURIComponent(name)}`);
}

/**
 * PREGAME ANALYSIS (composite)
 * The most important call for the picks engine.
 * Returns everything Chalky needs to analyze a matchup:
 *   home.dashboard, home.last_10_games, home.opponent_splits,
 *   home.clutch, home.shooting_splits, home.players,
 *   away.{same}, league.standings, league.team_stats
 */
async function getPregameAnalysis(homeTeamName, awayTeamName, season = '2024-25') {
  const homeId = getTeamId(homeTeamName);
  const awayId = getTeamId(awayTeamName);
  if (!homeId || !awayId) {
    console.warn(`[NBA] Could not resolve team IDs: home="${homeTeamName}" away="${awayTeamName}"`);
    return null;
  }
  return nbaFetchSafe(`/nba/pregame/${homeId}/${awayId}?season=${season}`);
}

/**
 * Format pregame data as a concise context string for Claude.
 * Extracts the most signal-rich stats and writes them as structured text.
 * Claude reads this before generating a pick.
 */
function formatPregameContext(data, homeTeamName, awayTeamName) {
  if (!data) return '';

  const lines = [`=== NBA REAL DATA: ${awayTeamName} @ ${homeTeamName} ===`];

  // Helper: safely pull first row from a result set
  const firstRow = (obj, key) => {
    if (!obj) return null;
    const sets = Object.values(obj);
    for (const set of sets) {
      if (Array.isArray(set) && set.length > 0) {
        const row = set.find(r => r[key] !== undefined);
        if (row) return row;
      }
    }
    return null;
  };

  for (const [side, name] of [['home', homeTeamName], ['away', awayTeamName]]) {
    const team = data[side];
    if (!team) continue;

    lines.push(`\n--- ${name} ---`);

    // Season dashboard
    const dash = firstRow(team.dashboard, 'W');
    if (dash) {
      lines.push(`Record: ${dash.W}-${dash.L} | PPG: ${dash.PTS} | Opp PPG: ${dash.OPP_PTS ?? 'N/A'}`);
      lines.push(`ATS %: ${dash.PCT ?? 'N/A'} | Home/Away splits available`);
    }

    // Last 10 games
    const last10 = firstRow(team.last_10_games, 'W');
    if (last10) {
      lines.push(`Last 10: ${last10.W}-${last10.L} | PPG: ${last10.PTS} | Net Rtg: ${last10.NET_RATING ?? 'N/A'}`);
    }

    // Clutch
    const clutch = firstRow(team.clutch, 'W');
    if (clutch) {
      lines.push(`Clutch (≤5pts, last 5min): ${clutch.W}-${clutch.L} | Net Rtg: ${clutch.NET_RATING ?? 'N/A'}`);
    }

    // Shooting splits
    const shoot = firstRow(team.shooting_splits, 'FG_PCT');
    if (shoot) {
      lines.push(`FG%: ${shoot.FG_PCT} | 3P%: ${shoot.FG3_PCT} | FT%: ${shoot.FT_PCT}`);
    }

    // Opponent splits (defensive context)
    const opp = firstRow(team.opponent_splits, 'OPP_PTS');
    if (opp) {
      lines.push(`Defense — Opp PPG: ${opp.OPP_PTS} | Opp FG%: ${opp.OPP_FG_PCT ?? 'N/A'}`);
    }
  }

  // Standings context
  if (data.league?.standings) {
    const allTeams = Object.values(data.league.standings).flat();
    const homeStanding = allTeams.find(r => r.TeamID === data.home_team_id);
    const awayStanding = allTeams.find(r => r.TeamID === data.away_team_id);
    if (homeStanding || awayStanding) {
      lines.push('\n--- Standings ---');
      if (homeStanding) lines.push(`${homeTeamName}: ${homeStanding.Conference} ${homeStanding.PlayoffRank ?? ''} | ${homeStanding.WINS}-${homeStanding.LOSSES}`);
      if (awayStanding) lines.push(`${awayTeamName}: ${awayStanding.Conference} ${awayStanding.PlayoffRank ?? ''} | ${awayStanding.WINS}-${awayStanding.LOSSES}`);
    }
  }

  lines.push('\n=== END NBA DATA ===');
  return lines.join('\n');
}

/**
 * Format player deep-dive data as context for Claude.
 */
function formatPlayerContext(data, playerName) {
  if (!data) return '';

  const lines = [`=== NBA REAL DATA: ${playerName} ===`];

  const firstRow = (obj, key) => {
    if (!obj) return null;
    for (const set of Object.values(obj)) {
      if (Array.isArray(set) && set.length > 0) {
        const row = set.find(r => r[key] !== undefined);
        if (row) return row;
      }
    }
    return null;
  };

  // Career context
  const career = firstRow(data.career, 'PTS');
  if (career) {
    lines.push(`Career PPG: ${career.PTS} | RPG: ${career.REB} | APG: ${career.AST}`);
  }

  // Current season
  const dash = firstRow(data.dashboard, 'PTS');
  if (dash) {
    lines.push(`${data.season} PPG: ${dash.PTS} | RPG: ${dash.REB} | APG: ${dash.AST} | FG%: ${dash.FG_PCT}`);
    lines.push(`TS%: ${dash.TS_PCT ?? 'N/A'} | USG%: ${dash.USG_PCT ?? 'N/A'} | Net Rtg: ${dash.NET_RATING ?? 'N/A'}`);
  }

  // Last 10
  const last10 = firstRow(data.last_10_games, 'PTS');
  if (last10) {
    lines.push(`Last 10 games — PPG: ${last10.PTS} | FG%: ${last10.FG_PCT}`);
  }

  // Clutch
  const clutch = firstRow(data.clutch, 'PTS');
  if (clutch) {
    lines.push(`Clutch PPG: ${clutch.PTS} | FG%: ${clutch.FG_PCT ?? 'N/A'}`);
  }

  lines.push('=== END PLAYER DATA ===');
  return lines.join('\n');
}

/** Check if the NBA service is reachable */
async function isNBAServiceAvailable() {
  try {
    const res = await fetch(`${NBA_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = {
  getTeamId,
  getScoreboard,
  getScoreboardV2,
  getLiveBoxScore,
  getBoxScoreTraditional,
  getBoxScoreAdvanced,
  getPlayByPlay,
  getWinProbability,
  getStandings,
  getLeagueLeaders,
  getLeagueTeamStats,
  getClutchTeamStats,
  getTeamDashboard,
  getTeamLastN,
  getTeamOpponentSplits,
  getTeamClutch,
  getTeamRoster,
  getPlayerInfo,
  getPlayerCareer,
  getPlayerGameLog,
  getPlayerLastN,
  getPlayerShotChart,
  getPlayerDeepDive,
  searchPlayers,
  getPregameAnalysis,
  formatPregameContext,
  formatPlayerContext,
  isNBAServiceAvailable,
  TEAM_IDS,
};
