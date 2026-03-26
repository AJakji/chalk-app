import { API_URL, AFFILIATE_LINKS } from '../config';

// ── Scores ────────────────────────────────────────────────────────────────────

// date: 'YYYY-MM-DD' string — always required
export async function fetchTodaysScores(date) {
  const res = await fetch(`${API_URL}/api/scores/today?date=${date}`);
  if (!res.ok) throw new Error(`Scores API error: ${res.status}`);
  const { games } = await res.json();
  return games;
}

/**
 * Fetch live box score for an NBA game.
 * gameId: the 10-digit nbaGameId (e.g. "0022501034")
 * Returns { away: { players, totals }, home: { players, totals }, quarters } or null.
 */
export async function fetchNBALiveBoxScore(gameId) {
  try {
    const res = await fetch(`${API_URL}/api/nba/boxscore/${gameId}/live`);
    if (!res.ok) return null;
    const json = await res.json();
    return mapNBABoxScore(json.data);
  } catch {
    return null;
  }
}

/**
 * Fetch live play-by-play for an NBA game.
 * Returns array of { time, event } objects (most recent first).
 */
export async function fetchNBAPlayByPlay(gameId) {
  try {
    const res = await fetch(`${API_URL}/api/nba/game/${gameId}/playbyplay`);
    if (!res.ok) return [];
    const json = await res.json();
    return mapNBAPBP(json.data);
  } catch {
    return [];
  }
}

// ── NBA data mappers ──────────────────────────────────────────────────────────

function mapNBABoxScore(data) {
  const game = data?.game;
  if (!game) return null;

  const mapPlayers = (team) =>
    (team?.players || [])
      .filter((p) => p.status === 'ACTIVE' && p.statistics)
      .map((p) => ({
        name: p.nameI || p.name,
        pos:  p.position || '--',
        pts:  p.statistics.points,
        reb:  p.statistics.reboundsTotal,
        ast:  p.statistics.assists,
        fg:   `${p.statistics.fieldGoalsMade}-${p.statistics.fieldGoalsAttempted}`,
        pm:   Math.round(p.statistics.plusMinusPoints || 0),
      }))
      .sort((a, b) => b.pts - a.pts);

  const mapTotals = (team) => {
    const players = (team?.players || []).filter(
      (p) => p.status === 'ACTIVE' && p.statistics
    );
    const fgm = players.reduce((s, p) => s + p.statistics.fieldGoalsMade, 0);
    const fga = players.reduce((s, p) => s + p.statistics.fieldGoalsAttempted, 0);
    return { fg: `${fgm}-${fga}` };
  };

  const mapQuarters = (team) => {
    const periods = team?.periods || [];
    return [1, 2, 3, 4].map((q) => {
      const period = periods.find((p) => p.period === q);
      // score 0 in an unplayed period still comes back as 0 — treat as null
      return period && period.score !== undefined ? period.score : null;
    });
  };

  return {
    away: { players: mapPlayers(game.awayTeam), totals: mapTotals(game.awayTeam) },
    home: { players: mapPlayers(game.homeTeam), totals: mapTotals(game.homeTeam) },
    quarters: {
      away: mapQuarters(game.awayTeam),
      home: mapQuarters(game.homeTeam),
    },
  };
}

function _formatClock(ptClock) {
  // "PT11M43.00S" → "11:43"
  if (!ptClock) return '';
  const match = ptClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return ptClock;
  const secs = Math.floor(parseFloat(match[2]));
  return `${match[1]}:${secs.toString().padStart(2, '0')}`;
}

function mapNBAPBP(data) {
  const actions = data?.game?.actions || [];
  return [...actions]
    .reverse() // most recent first
    .slice(0, 50)
    .map((a) => ({
      time:  `Q${a.period} ${_formatClock(a.clock)}`,
      event: `${a.teamTricode ? a.teamTricode + ' — ' : ''}${a.description}`,
    }));
}

/**
 * Fetch box score for any league via SportsData.io.
 * league: 'NBA' | 'NHL' | 'MLB' | 'NFL'
 * gameId: SportsData.io game ID (sdGameId from the game object)
 */
export async function fetchSportsBoxScore(league, gameId) {
  try {
    const res = await fetch(`${API_URL}/api/sports/boxscore?league=${league}&gameId=${gameId}`);
    if (!res.ok) return null;
    const { data } = await res.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Fetch live MLB at-bat state for a specific game.
 * gameId: SportsData.io game ID
 * date: 'YYYY-MM-DD'
 * Returns { inning, inningHalf, balls, strikes, outs, firstBase, secondBase, thirdBase,
 *           currentPitcher, currentHitter } or null
 */
export async function fetchMLBLiveState(gameId, date) {
  try {
    const params = new URLSearchParams({ date, gameId });
    const res = await fetch(`${API_URL}/api/sports/mlblive?${params}`);
    if (!res.ok) return null;
    const { liveState } = await res.json();
    return liveState || null;
  } catch {
    return null;
  }
}

/**
 * Fetch Game Info tab data: arena, officials, injuries, last 5 games, head-to-head.
 * league: 'NBA' | 'NHL' | 'MLB' | 'NFL'
 * gameId: SportsData.io game ID
 * awayAbbr / homeAbbr: team abbreviations for filtering injuries + last-5
 */
export async function fetchGameInfo(league, gameId, awayAbbr, homeAbbr) {
  try {
    const params = new URLSearchParams({ league, gameId });
    if (awayAbbr) params.set('awayAbbr', awayAbbr);
    if (homeAbbr) params.set('homeAbbr', homeAbbr);
    const res = await fetch(`${API_URL}/api/sports/gameinfo?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch pre-match tab data via free APIs (stats.nba.com / NHL API / MLB Stats API).
 * Does NOT require a SportsData.io game ID — works for any upcoming game.
 * league: 'NBA' | 'NHL' | 'MLB'
 * awayAbbr / homeAbbr: team abbreviations
 */
export async function fetchGameDetails(league, awayAbbr, homeAbbr) {
  try {
    const params = new URLSearchParams({ league, awayAbbr, homeAbbr });
    const res = await fetch(`${API_URL}/api/games/info?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch live odds from The Odds API for a specific game.
 * Returns { moneyline, spread, total, bestMLAway, bestMLHome, bestSpAway, bestSpHome, bestOver, bestUnder }
 */
export async function fetchGameOdds(league, awayAbbr, homeAbbr, awayName, homeName) {
  try {
    const params = new URLSearchParams({ league, awayAbbr, homeAbbr });
    if (awayName) params.set('awayName', awayName);
    if (homeName) params.set('homeName', homeName);
    const res = await fetch(`${API_URL}/api/games/odds?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch play-by-play for any league via SportsData.io.
 * Returns array of { time, event } objects.
 */
export async function fetchSportsPBP(league, gameId) {
  try {
    const res = await fetch(`${API_URL}/api/sports/playbyplay?league=${league}&gameId=${gameId}`);
    if (!res.ok) return [];
    const { data } = await res.json();
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Fetch top player per key stat for both teams in a matchup.
 * Returns { rows: [{ label, unit, away: { name, value }, home: { name, value } }] }
 */
export async function fetchTeamLeaders(league, awayAbbr, homeAbbr) {
  try {
    const params = new URLSearchParams({ league, awayAbbr, homeAbbr });
    const res = await fetch(`${API_URL}/api/games/leaders?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch Chalky's one-sentence AI betting insight for a matchup.
 * Accepts optional spread, total, awayRecord, homeRecord for richer context.
 * Returns a string or null.
 */
export async function fetchChalkyTake(league, awayAbbr, homeAbbr, context = {}) {
  try {
    const params = new URLSearchParams({ league, awayAbbr, homeAbbr, ...context });
    const res = await fetch(`${API_URL}/api/games/chalky-take?${params}`);
    if (!res.ok) return null;
    const j = await res.json();
    return j.take || null;
  } catch {
    return null;
  }
}

// ── Picks ─────────────────────────────────────────────────────────────────────

export async function fetchTodaysPicks() {
  const res = await fetch(`${API_URL}/api/picks/today`);
  if (!res.ok) throw new Error(`Picks API error: ${res.status}`);
  const { picks } = await res.json();
  return picks.map(normalizePick);
}

export async function fetchPickById(id) {
  const res = await fetch(`${API_URL}/api/picks/${id}`);
  if (!res.ok) throw new Error(`Pick not found: ${res.status}`);
  return normalizePick(await res.json());
}

// ── Research ──────────────────────────────────────────────────────────────────

export async function askChalky(message, history = []) {
  const res = await fetch(`${API_URL}/api/research/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Research API error: ${res.status}`);
  }
  return res.json(); // { response: string, history: [...] }
}


// ── Users ─────────────────────────────────────────────────────────────────────

export async function syncUser({ clerkToken, username, displayName, avatar }) {
  const res = await fetch(`${API_URL}/api/users/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clerkToken}`,
    },
    body: JSON.stringify({ username, displayName, avatar }),
  });
  if (!res.ok) throw new Error(`User sync failed: ${res.status}`);
  return res.json();
}

export async function fetchMe(clerkToken) {
  const res = await fetch(`${API_URL}/api/users/me`, {
    headers: { Authorization: `Bearer ${clerkToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  return res.json();
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizePick(row) {
  const odds = row.odds_data || {};
  const analysis = normalizeAnalysis(row.analysis);
  const bestBook = findBestBook(odds);
  const pickCategory = row.pick_category || 'game';

  return {
    id:           row.id,
    league:       row.league,
    pickCategory,                      // 'game' | 'prop'
    pickType:     row.pick_type,
    awayTeam:     row.away_team,
    homeTeam:     row.home_team,
    gameTime:     row.game_time,
    pick:         row.pick_value,
    confidence:   row.confidence,
    shortReason:  row.short_reason,
    result:       row.result ?? null,
    odds,
    bestOdds:     bestBook,
    affiliateLinks: AFFILIATE_LINKS,
    analysis,
    // Prop-specific fields (null for game picks)
    playerName:     row.player_name     ?? null,
    playerTeam:     row.player_team     ?? null,
    playerPosition: row.player_position ?? null,
    matchupText:    row.matchup_text    ?? null,
    headshotUrl:    row.headshot_url    ?? null,
  };
}

function normalizeAnalysis(raw) {
  if (!raw) return { summary: '', sections: [], keyStats: [], trends: [] };

  // New Chalky format — prop picks with 3-field model analysis
  if (raw.chalky_headline !== undefined) {
    return {
      chalky_headline:   raw.chalky_headline   || '',
      chalky_projection: raw.chalky_projection || '',
      chalky_research:   raw.chalky_research   || '',
      keyStats:          raw.keyStats          || [],
      key_factors:       raw.key_factors       || [],
    };
  }

  if (raw.summary !== undefined) {
    return {
      summary:  raw.summary  || '',
      sections: raw.sections || [],
      keyStats: raw.keyStats || [],
      trends:   raw.trends   || [],
    };
  }

  if (Array.isArray(raw)) {
    return {
      summary:  raw[0]?.body || '',
      sections: raw.map((s, i) => ({
        title:   s.title,
        icon:    ['🎯', '💰', '⚠️', '📊'][i] || '📋',
        content: s.body || s.content || '',
      })),
      keyStats: [],
      trends:   [],
    };
  }

  return { summary: '', sections: [], keyStats: [], trends: [] };
}

function findBestBook(odds) {
  let bestBook = null;
  let bestVal = -Infinity;
  for (const [book, oddsStr] of Object.entries(odds)) {
    if (!oddsStr || oddsStr === 'N/A') continue;
    const num = parseInt(String(oddsStr).replace(/[^-\d]/g, ''), 10);
    if (!isNaN(num) && num > bestVal) {
      bestVal = num;
      bestBook = book;
    }
  }
  return bestBook;
}
