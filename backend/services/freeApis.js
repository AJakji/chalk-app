/**
 * freeApis.js — Free data sources for game detail tabs
 *
 * NBA  → ESPN (stats + schedule + record) — works server-side, no key needed
 * NHL  → api-web.nhle.com (standings/records) + api.nhle.com (PP%/PK%/SOG/FO%)
 * MLB  → statsapi.mlb.com (fully public)
 */

// ── Team ID maps ───────────────────────────────────────────────────────────────

// ESPN NBA team IDs (abbreviation → ESPN numeric team ID)
const ESPN_NBA_TEAM_IDS = {
  ATL: '1',  BOS: '2',  BKN: '17', CHA: '30', CHI: '4',  CLE: '5',
  DAL: '6',  DEN: '7',  DET: '8',  GSW: '9',  GS:  '9',  HOU: '10',
  IND: '11', LAC: '12', LAL: '13', MEM: '29', MIA: '14', MIL: '15',
  MIN: '16', NOP: '3',  NO:  '3',  NYK: '18', NY:  '18', OKC: '25',
  ORL: '19', PHI: '20', PHX: '21', POR: '22', SAC: '23', SAS: '24',
  SA:  '24', TOR: '28', UTA: '26', WAS: '27',
};

// MLB Stats API team IDs
const MLB_TEAM_IDS = {
  ARI: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CWS: 145,
  CIN: 113, CLE: 114, COL: 115, DET: 116, HOU: 117, KC:  118,
  LAA: 108, LAD: 119, MIA: 146, MIL: 158, MIN: 142, NYM: 121,
  NYY: 147, OAK: 133, PHI: 143, PIT: 134, SD:  135, SF:  137,
  SEA: 136, STL: 138, TB:  139, TEX: 140, TOR: 141, WSH: 120,
};

// BallDontLie team IDs (match NBA abbreviations)
const BDL_TEAM_IDS = {
  ATL: 1,  BOS: 2,  BKN: 3,  CHA: 4,  CHI: 5,  CLE: 6,  DAL: 7,  DEN: 8,
  DET: 9,  GSW: 10, GS: 10,  HOU: 11, IND: 12, LAC: 13, LAL: 14, MEM: 15,
  MIA: 16, MIL: 17, MIN: 18, NOP: 19, NO: 19,  NYK: 20, NY: 20,  OKC: 21,
  ORL: 22, PHI: 23, PHX: 24, POR: 25, SAC: 26, SAS: 27, SA: 27,
  TOR: 28, UTA: 29, WAS: 30,
};

// NHL API team IDs → our abbreviations (stable, only changes if expansion/relocation)
const NHL_TEAMID_ABBR = {
  1: 'NJD', 2: 'NYI', 3: 'NYR', 4: 'PHI', 5: 'PIT', 6: 'BOS', 7: 'BUF',
  8: 'MTL', 9: 'OTT', 10: 'TOR', 12: 'CAR', 13: 'FLA', 14: 'TBL', 15: 'WSH',
  16: 'CHI', 17: 'DET', 18: 'NSH', 19: 'STL', 20: 'CGY', 21: 'COL', 22: 'EDM',
  23: 'VAN', 24: 'ANA', 25: 'DAL', 26: 'LAK', 28: 'SJS', 29: 'CBJ', 30: 'MIN',
  52: 'WPG', 54: 'VGK', 55: 'SEA', 68: 'UTA',
};

// MLB venue data: coordinates + park HR factor (hardcoded, rarely changes)
const MLB_VENUE_DATA = {
  ARI: { name: 'Chase Field',               city: 'Phoenix, AZ',        lat: 33.4455, lon: -112.0667, hrFactor: 1.05, indoor: true  },
  ATL: { name: 'Truist Park',               city: 'Cumberland, GA',     lat: 33.8908, lon: -84.4678,  hrFactor: 1.00, indoor: false },
  BAL: { name: 'Oriole Park',               city: 'Baltimore, MD',      lat: 39.2838, lon: -76.6217,  hrFactor: 1.05, indoor: false },
  BOS: { name: 'Fenway Park',               city: 'Boston, MA',         lat: 42.3467, lon: -71.0972,  hrFactor: 1.03, indoor: false },
  CHC: { name: 'Wrigley Field',             city: 'Chicago, IL',        lat: 41.9484, lon: -87.6553,  hrFactor: 1.10, indoor: false },
  CWS: { name: 'Guaranteed Rate Field',     city: 'Chicago, IL',        lat: 41.8300, lon: -87.6339,  hrFactor: 1.12, indoor: false },
  CIN: { name: 'Great American Ball Park',  city: 'Cincinnati, OH',     lat: 39.0974, lon: -84.5067,  hrFactor: 1.25, indoor: false },
  CLE: { name: 'Progressive Field',         city: 'Cleveland, OH',      lat: 41.4962, lon: -81.6852,  hrFactor: 0.95, indoor: false },
  COL: { name: 'Coors Field',               city: 'Denver, CO',         lat: 39.7559, lon: -104.9942, hrFactor: 1.35, indoor: false },
  DET: { name: 'Comerica Park',             city: 'Detroit, MI',        lat: 42.3390, lon: -83.0485,  hrFactor: 0.92, indoor: false },
  HOU: { name: 'Minute Maid Park',          city: 'Houston, TX',        lat: 29.7573, lon: -95.3555,  hrFactor: 1.02, indoor: true  },
  KC:  { name: 'Kauffman Stadium',          city: 'Kansas City, MO',    lat: 39.0517, lon: -94.4803,  hrFactor: 0.98, indoor: false },
  LAA: { name: 'Angel Stadium',             city: 'Anaheim, CA',        lat: 33.8003, lon: -117.8827, hrFactor: 0.97, indoor: false },
  LAD: { name: 'Dodger Stadium',            city: 'Los Angeles, CA',    lat: 34.0739, lon: -118.2400, hrFactor: 0.96, indoor: false },
  MIA: { name: 'loanDepot park',            city: 'Miami, FL',          lat: 25.7781, lon: -80.2197,  hrFactor: 0.90, indoor: true  },
  MIL: { name: 'American Family Field',     city: 'Milwaukee, WI',      lat: 43.0283, lon: -87.9712,  hrFactor: 1.08, indoor: true  },
  MIN: { name: 'Target Field',              city: 'Minneapolis, MN',    lat: 44.9817, lon: -93.2783,  hrFactor: 0.95, indoor: false },
  NYM: { name: 'Citi Field',               city: 'Queens, NY',         lat: 40.7571, lon: -73.8458,  hrFactor: 0.91, indoor: false },
  NYY: { name: 'Yankee Stadium',            city: 'Bronx, NY',          lat: 40.8296, lon: -73.9262,  hrFactor: 1.18, indoor: false },
  OAK: { name: 'Oakland Coliseum',          city: 'Oakland, CA',        lat: 37.7516, lon: -122.2005, hrFactor: 0.84, indoor: false },
  PHI: { name: 'Citizens Bank Park',        city: 'Philadelphia, PA',   lat: 39.9061, lon: -75.1665,  hrFactor: 1.08, indoor: false },
  PIT: { name: 'PNC Park',                  city: 'Pittsburgh, PA',     lat: 40.4469, lon: -80.0057,  hrFactor: 0.94, indoor: false },
  SD:  { name: 'Petco Park',               city: 'San Diego, CA',      lat: 32.7076, lon: -117.1570, hrFactor: 0.78, indoor: false },
  SF:  { name: 'Oracle Park',              city: 'San Francisco, CA',  lat: 37.7786, lon: -122.3893, hrFactor: 0.82, indoor: false },
  SEA: { name: 'T-Mobile Park',            city: 'Seattle, WA',        lat: 47.5914, lon: -122.3325, hrFactor: 0.93, indoor: true  },
  STL: { name: 'Busch Stadium',            city: 'St. Louis, MO',      lat: 38.6226, lon: -90.1928,  hrFactor: 0.99, indoor: false },
  TB:  { name: 'Tropicana Field',          city: 'St. Petersburg, FL', lat: 27.7683, lon: -82.6534,  hrFactor: 0.99, indoor: true  },
  TEX: { name: 'Globe Life Field',         city: 'Arlington, TX',      lat: 32.7473, lon: -97.0845,  hrFactor: 1.05, indoor: true  },
  TOR: { name: 'Rogers Centre',            city: 'Toronto, ON',        lat: 43.6414, lon: -79.3894,  hrFactor: 1.00, indoor: true  },
  WSH: { name: 'Nationals Park',           city: 'Washington, DC',     lat: 38.8730, lon: -77.0074,  hrFactor: 1.04, indoor: false },
};

// Some ESPN team abbreviations differ from the standard ones we use
const ESPN_ABBR_FIX = {
  UTAH: 'UTA', SA: 'SAS', GS: 'GSW', NO: 'NOP', NY: 'NYK',
  BRK: 'BKN', WSH: 'WAS', PHO: 'PHX',
};
function normalizeAbbr(abbr) {
  const up = (abbr || '').toUpperCase();
  return ESPN_ABBR_FIX[up] || up;
}

// ── Season helpers ─────────────────────────────────────────────────────────────

function currentNBASeason() {
  const now  = new Date();
  const year = now.getFullYear();
  const mon  = now.getMonth() + 1;
  if (mon < 7) return `${year - 1}-${String(year).slice(2)}`;
  return `${year}-${String(year + 1).slice(2)}`;
}

// ESPN season year = ending calendar year (e.g. 2026 for 2025-26)
function espnNBASeasonYear() {
  const season = currentNBASeason(); // "2025-26"
  return parseInt(season.split('-')[0]) + 1; // 2026
}

// BallDontLie season = starting year (e.g. 2024 for 2024-25)
function bdlNBASeason() {
  const season = currentNBASeason(); // "2024-25"
  return parseInt(season.split('-')[0]);
}

// MLB year — returns previous year in pre-season (Jan–March)
// MLB season runs April–October
function currentMLBYear() {
  const now = new Date();
  return (now.getMonth() + 1) < 4 ? now.getFullYear() - 1 : now.getFullYear();
}

// NHL season ID as YYYYYYYY string (e.g. "20252026" for 2025-26 season)
function currentNHLSeasonId() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  // NHL season runs Oct-June; before September = prev-to-current
  return month >= 9 ? `${year}${year + 1}` : `${year - 1}${year}`;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
function f1(v)   { return v != null ? Number(v).toFixed(1) : '--'; }
function f2(v)   { return v != null ? Number(v).toFixed(2) : '--'; }
function f3(v)   { return v != null ? Number(v).toFixed(3) : '--'; }

function degToCardinal(deg) {
  if (deg == null) return '--';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// ── In-memory TTL cache ───────────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e || Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.data;
}
function cacheSet(k, data, ttlMs) {
  _cache.set(k, { data, exp: Date.now() + ttlMs });
}

// ══════════════════════════════════════════════════════════════════════════════
// NBA — ESPN APIs
// ══════════════════════════════════════════════════════════════════════════════

async function getNBATeamGamelog(teamAbbr) {
  const espnId = ESPN_NBA_TEAM_IDS[teamAbbr.toUpperCase()];
  if (!espnId) return [];

  const key = `nba:gamelog:espn:${teamAbbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const year = espnNBASeasonYear();
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/schedule?season=${year}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];

    const json   = await res.json();
    const events = json?.events || [];

    const completed = events.filter(e =>
      e?.competitions?.[0]?.status?.type?.completed === true
    );
    const last5 = completed.slice(-5).reverse();
    const myAbbr = teamAbbr.toUpperCase();

    const result = last5.map(e => {
      const c = e.competitions?.[0];
      if (!c) return null;
      const competitors = c.competitors || [];
      const myTeam  = competitors.find(t => normalizeAbbr(t.team?.abbreviation) === myAbbr);
      const oppTeam = competitors.find(t => normalizeAbbr(t.team?.abbreviation) !== myAbbr);
      const isHome   = myTeam?.homeAway === 'home';
      const myScore  = myTeam?.score?.value  != null ? Math.round(parseFloat(myTeam.score.value))  : null;
      const oppScore = oppTeam?.score?.value != null ? Math.round(parseFloat(oppTeam.score.value)) : null;
      return {
        date:      (e.date || '').split('T')[0],
        opponent:  normalizeAbbr(oppTeam?.team?.abbreviation),
        isHome,
        result:    myTeam?.winner != null ? (myTeam.winner ? 'W' : 'L') : '',
        teamScore: myScore,
        oppScore,
      };
    }).filter(Boolean);

    cacheSet(key, result, 5 * 60 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] NBA gamelog ${teamAbbr}: ${e.message}`);
    return [];
  }
}

async function getNBATeamStats(teamAbbr) {
  const espnId = ESPN_NBA_TEAM_IDS[teamAbbr.toUpperCase()];
  if (!espnId) return null;

  const key = `nba:teamstats:espn:${teamAbbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const [statsRes, teamRes] = await Promise.allSettled([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/statistics`, { signal: AbortSignal.timeout(10000) }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}`,            { signal: AbortSignal.timeout(10000) }),
    ]);

    let statMap = {};
    if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
      const j = await statsRes.value.json();
      for (const cat of (j?.results?.stats?.categories || [])) {
        for (const s of (cat.stats || [])) { statMap[s.name] = s.value; }
      }
    }

    let wins = null, losses = null;
    if (teamRes.status === 'fulfilled' && teamRes.value.ok) {
      const j      = await teamRes.value.json();
      const record = j?.team?.record?.items?.find(r => r.type === 'total');
      if (record) {
        wins   = record.stats?.find(s => s.name === 'wins')?.value   ?? null;
        losses = record.stats?.find(s => s.name === 'losses')?.value ?? null;
      }
    }

    if (!Object.keys(statMap).length && wins == null) return null;

    const result = {
      ppg:    f1(statMap['avgPoints']),
      rpg:    f1(statMap['avgRebounds']),
      apg:    f1(statMap['avgAssists']),
      fg:     statMap['fieldGoalPct']           != null ? Number(statMap['fieldGoalPct']).toFixed(1)           : '--',
      three:  statMap['threePointFieldGoalPct'] != null ? Number(statMap['threePointFieldGoalPct']).toFixed(1) : '--',
      ft:     statMap['freeThrowPct']           != null ? Number(statMap['freeThrowPct']).toFixed(1)           : '--',
      tov:    f1(statMap['avgTurnovers']),
      blk:    f1(statMap['avgBlocks']),
      stl:    f1(statMap['avgSteals']),
      wins:   wins   != null ? Math.round(wins)   : null,
      losses: losses != null ? Math.round(losses) : null,
    };

    cacheSet(key, result, 6 * 3600 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] NBA team stats ${teamAbbr}: ${e.message}`);
    return null;
  }
}

async function getNBAKeyPlayers() {
  return null; // ESPN team stats doesn't expose per-player easily
}

// NBA H2H season series via BallDontLie
async function getNBAH2H(awayAbbr, homeAbbr) {
  const t1 = BDL_TEAM_IDS[awayAbbr.toUpperCase()];
  const t2 = BDL_TEAM_IDS[homeAbbr.toUpperCase()];
  if (!t1 || !t2) return null;

  const season = bdlNBASeason();
  const key    = `nba:h2h:${awayAbbr}:${homeAbbr}:${season}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) return null;
    const url = `https://api.balldontlie.io/v1/games?team_ids[]=${t1}&team_ids[]=${t2}&seasons[]=${season}&per_page=100`;
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const json     = await res.json();
    const allGames = json?.data || [];
    const a1 = awayAbbr.toUpperCase(), a2 = homeAbbr.toUpperCase();

    // Filter to true H2H only (both teams in the same game)
    const h2h = allGames.filter(g => {
      const ha = (g.home_team?.abbreviation || '').toUpperCase();
      const va = (g.visitor_team?.abbreviation || '').toUpperCase();
      return (ha === a1 || ha === a2) && (va === a1 || va === a2);
    });

    let awayWins = 0, homeWins = 0;
    for (const g of h2h) {
      const ha = (g.home_team?.abbreviation || '').toUpperCase();
      const homeWon = (g.home_team_score || 0) > (g.visitor_team_score || 0);
      if (ha === a2) { if (homeWon) homeWins++; else awayWins++; }
      else           { if (homeWon) awayWins++; else homeWins++; }
    }

    const result = { awayWins, homeWins, totalGames: h2h.length };
    cacheSet(key, result, 6 * 3600 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] NBA H2H ${awayAbbr} vs ${homeAbbr}: ${e.message}`);
    return null;
  }
}

// Rest days: days since last game (0 = played today, 1 = back-to-back, etc.)
async function getNBARestDays(teamAbbr) {
  try {
    const gamelog = await getNBATeamGamelog(teamAbbr);
    if (!gamelog || gamelog.length === 0) return null;
    const lastDate = new Date(gamelog[0].date);
    const today    = new Date();
    today.setHours(0, 0, 0, 0);
    lastDate.setHours(0, 0, 0, 0);
    return Math.round((today - lastDate) / 86400000);
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// NHL — api-web.nhle.com + api.nhle.com stats
// ══════════════════════════════════════════════════════════════════════════════

async function _fetchNHLStandings() {
  const key    = 'nhl:standings';
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const seasonId = currentNHLSeasonId();
    const summaryUrl = `https://api.nhle.com/stats/rest/en/team/summary?isAggregate=false&isGame=false&cayenneExp=seasonId%3D${seasonId}%20and%20gameTypeId%3D2&sort=points&limit=40`;

    const [standRes, summaryRes] = await Promise.allSettled([
      fetch('https://api-web.nhle.com/v1/standings/now',  { signal: AbortSignal.timeout(10000) }),
      fetch(summaryUrl,                                     { signal: AbortSignal.timeout(10000) }),
    ]);

    // Build teamId → summary stats map
    const summaryById = {};
    if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
      const j = await summaryRes.value.json();
      for (const t of (j?.data || [])) {
        summaryById[t.teamId] = t;
      }
    }

    // Build reverse lookup: abbr → NHL teamId
    const abbrToNHLId = {};
    for (const [id, abbr] of Object.entries(NHL_TEAMID_ABBR)) {
      abbrToNHLId[abbr] = parseInt(id);
    }

    const byAbbr = {};
    if (standRes.status === 'fulfilled' && standRes.value.ok) {
      const j = await standRes.value.json();
      for (const t of (j?.standings || [])) {
        const abbr = t.teamAbbrev?.default;
        if (!abbr) continue;

        const gp  = t.gamesPlayed || 1;
        const nhlId  = abbrToNHLId[abbr];
        const sum    = nhlId ? summaryById[nhlId] : null;

        const sogFor     = sum?.shotsForPerGame;
        const sogAgainst = sum?.shotsAgainstPerGame;
        const corsiPct   = (sogFor && sogAgainst)
          ? ((sogFor / (sogFor + sogAgainst)) * 100).toFixed(1) : '--';
        const ppPct      = sum?.powerPlayPct  != null ? (sum.powerPlayPct  * 100).toFixed(1) : '--';
        const pkPct      = sum?.penaltyKillPct != null ? (sum.penaltyKillPct * 100).toFixed(1) : '--';
        const foWinPct   = sum?.faceoffWinPct  != null ? (sum.faceoffWinPct  * 100).toFixed(1) : '--';

        byAbbr[abbr] = {
          gf:          f2((t.goalFor     || 0) / gp),
          ga:          f2((t.goalAgainst || 0) / gp),
          ppPct,
          pkPct,
          sog:         sogFor ? f2(sogFor) : '--',
          foWinPct,
          corsiPct,
          wins:        t.wins      || 0,
          losses:      t.losses    || 0,
          otLosses:    t.otLosses  || 0,
          points:      t.points    || 0,
          homeWins:    t.homeWins     || 0,
          homeLosses:  t.homeLosses   || 0,
          homeOtLosses:t.homeOtLosses || 0,
          roadWins:    t.roadWins     || 0,
          roadLosses:  t.roadLosses   || 0,
          roadOtLosses:t.roadOtLosses || 0,
        };
      }
    }

    cacheSet(key, byAbbr, 3600 * 1000); // 1 hr
    return byAbbr;
  } catch (e) {
    console.warn(`[freeApis] NHL standings: ${e.message}`);
    return null;
  }
}

async function getNHLTeamStats(teamAbbr) {
  const all = await _fetchNHLStandings();
  return all?.[teamAbbr.toUpperCase()] || null;
}

async function getNHLTeamLast5(teamAbbr) {
  const abbr   = teamAbbr.toUpperCase();
  const key    = `nhl:last5:${abbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const res  = await fetch(`https://api-web.nhle.com/v1/club-schedule-season/${abbr}/now`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();

    const completed = (json?.games || []).filter(g => ['OFF', 'FINAL', 'CRIT'].includes(g.gameState));
    const last5     = completed.slice(-5).reverse();

    const result = last5.map(g => {
      const isHome  = (g.homeTeam?.abbrev || '').toUpperCase() === abbr;
      const myTeam  = isHome ? g.homeTeam : g.awayTeam;
      const oppTeam = isHome ? g.awayTeam : g.homeTeam;
      const myScore  = myTeam?.score  ?? null;
      const oppScore = oppTeam?.score ?? null;
      const wl = (myScore != null && oppScore != null) ? (myScore > oppScore ? 'W' : 'L') : '';
      return {
        date:      g.gameDate || '',
        opponent:  (oppTeam?.abbrev || '').toUpperCase(),
        isHome,
        result:    wl,
        teamScore: myScore,
        oppScore,
      };
    });

    cacheSet(key, result, 5 * 60 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] NHL last5 ${teamAbbr}: ${e.message}`);
    return [];
  }
}

// NHL H2H season series
async function getNHLH2H(awayAbbr, homeAbbr) {
  const key    = `nhl:h2h:${awayAbbr}:${homeAbbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const res  = await fetch(`https://api-web.nhle.com/v1/club-schedule-season/${awayAbbr.toUpperCase()}/now`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();

    const homeUpper = homeAbbr.toUpperCase();
    const awayUpper = awayAbbr.toUpperCase();
    const meetings  = (json?.games || []).filter(g => {
      const gt = ['OFF', 'FINAL', 'CRIT'];
      if (!gt.includes(g.gameState)) return false;
      const ha = (g.homeTeam?.abbrev || '').toUpperCase();
      const aa = (g.awayTeam?.abbrev || '').toUpperCase();
      return (ha === homeUpper || ha === awayUpper) && (aa === homeUpper || aa === awayUpper);
    });

    let awayWins = 0, homeWins = 0;
    for (const g of meetings) {
      const isHome = (g.homeTeam?.abbrev || '').toUpperCase() === awayUpper;
      const mySc   = isHome ? g.homeTeam?.score : g.awayTeam?.score;
      const oppSc  = isHome ? g.awayTeam?.score : g.homeTeam?.score;
      if (mySc != null && oppSc != null) {
        if (mySc > oppSc) awayWins++; else homeWins++;
      }
    }

    const result = { awayWins, homeWins, totalGames: meetings.length };
    cacheSet(key, result, 3600 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] NHL H2H: ${e.message}`);
    return null;
  }
}

// NHL goalie stats from player landing
async function _getGoalieStats(playerId) {
  try {
    const res  = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/landing`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const json = await res.json();
    const s    = json?.featuredStats?.regularSeason?.subSeason;
    if (!s) return {};
    return {
      svPct:    s.savePctg        != null ? s.savePctg.toFixed(3)        : '--',
      gaa:      s.goalsAgainstAvg != null ? s.goalsAgainstAvg.toFixed(2) : '--',
      wins:     s.wins      ?? '--',
      losses:   s.losses    ?? '--',
      otLosses: s.otLosses  ?? '--',
    };
  } catch { return {}; }
}

// Find starting goalies for tonight's game by scanning NHL schedule → gamecenter boxscore
async function getNHLGameGoalies(awayAbbr, homeAbbr) {
  const key    = `nhl:goalies:${awayAbbr}:${homeAbbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const nullResult = { awayGoalie: null, homeGoalie: null };

  try {
    const today = new Date().toISOString().split('T')[0];
    const schedRes = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`, { signal: AbortSignal.timeout(8000) });
    if (!schedRes.ok) return nullResult;
    const sched    = await schedRes.json();
    const games    = sched?.gameWeek?.[0]?.games || [];

    const awayUp = awayAbbr.toUpperCase(), homeUp = homeAbbr.toUpperCase();
    const game   = games.find(g => {
      const ha = (g.homeTeam?.abbrev || '').toUpperCase();
      const aa = (g.awayTeam?.abbrev || '').toUpperCase();
      return ha === homeUp && aa === awayUp;
    });

    if (!game) {
      cacheSet(key, nullResult, 10 * 60 * 1000);
      return nullResult;
    }

    // Try boxscore for confirmed starters
    let awayGoalieId = null, homeGoalieId = null;
    let awayGoalieName = null, homeGoalieName = null;
    let awayConfirmed = false, homeConfirmed = false;

    try {
      const bsRes = await fetch(`https://api-web.nhle.com/v1/gamecenter/${game.id}/boxscore`, { signal: AbortSignal.timeout(8000) });
      if (bsRes.ok) {
        const bs   = await bsRes.json();
        const pbgs = bs?.playerByGameStats;
        const ag   = pbgs?.awayTeam?.goalies?.[0];
        const hg   = pbgs?.homeTeam?.goalies?.[0];
        if (ag) {
          awayGoalieId   = ag.playerId;
          awayGoalieName = `${ag.firstName?.default || ''} ${ag.lastName?.default || ''}`.trim();
          awayConfirmed  = true;
        }
        if (hg) {
          homeGoalieId   = hg.playerId;
          homeGoalieName = `${hg.firstName?.default || ''} ${hg.lastName?.default || ''}`.trim();
          homeConfirmed  = true;
        }
      }
    } catch { /* fall through to roster */ }

    // Fall back to top goalie on roster if not confirmed
    if (!awayGoalieId) {
      try {
        const r  = await fetch(`https://api-web.nhle.com/v1/roster/${awayUp}/current`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
        const g  = r?.goalies?.[0];
        if (g) { awayGoalieId = g.id; awayGoalieName = `${g.firstName?.default || ''} ${g.lastName?.default || ''}`.trim(); }
      } catch { /* ignore */ }
    }
    if (!homeGoalieId) {
      try {
        const r  = await fetch(`https://api-web.nhle.com/v1/roster/${homeUp}/current`, { signal: AbortSignal.timeout(8000) }).then(r => r.json());
        const g  = r?.goalies?.[0];
        if (g) { homeGoalieId = g.id; homeGoalieName = `${g.firstName?.default || ''} ${g.lastName?.default || ''}`.trim(); }
      } catch { /* ignore */ }
    }

    const [awayStats, homeStats] = await Promise.all([
      awayGoalieId ? _getGoalieStats(awayGoalieId) : Promise.resolve({}),
      homeGoalieId ? _getGoalieStats(homeGoalieId) : Promise.resolve({}),
    ]);

    const result = {
      awayGoalie: awayGoalieId ? { name: awayGoalieName, confirmed: awayConfirmed, ...awayStats } : null,
      homeGoalie: homeGoalieId ? { name: homeGoalieName, confirmed: homeConfirmed, ...homeStats } : null,
    };

    cacheSet(key, result, 30 * 60 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] NHL goalies: ${e.message}`);
    return nullResult;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MLB — statsapi.mlb.com
// ══════════════════════════════════════════════════════════════════════════════

async function getMLBTeamLast5(teamAbbr) {
  const teamId = MLB_TEAM_IDS[teamAbbr.toUpperCase()];
  if (!teamId) return [];

  const key    = `mlb:last5:${teamAbbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const year = currentMLBYear();
    const now  = new Date();
    const currentYear = now.getFullYear();

    // If year < currentYear (pre-season), look at end of previous season
    let startDate, endDate;
    if (year < currentYear) {
      startDate = `${year}-09-01`;
      endDate   = `${year}-11-15`;
    } else {
      startDate = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
      endDate   = now.toISOString().split('T')[0];
    }

    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&season=${year}&gameType=R&startDate=${startDate}&endDate=${endDate}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const json  = await res.json();
    const games = [];
    for (const d of (json?.dates || [])) {
      for (const g of (d.games || [])) {
        if (g.status?.abstractGameState === 'Final') games.push(g);
      }
    }

    const last5  = games.slice(-5).reverse();
    const result = last5.map(g => {
      const isHome  = g.teams?.home?.team?.id === teamId;
      const myTeam  = isHome ? g.teams.home : g.teams.away;
      const oppTeam = isHome ? g.teams.away : g.teams.home;
      return {
        date:      (g.officialDate || '').split('T')[0],
        opponent:  oppTeam?.team?.abbreviation || '',
        isHome,
        result:    myTeam?.isWinner ? 'W' : 'L',
        teamScore: myTeam?.score  ?? null,
        oppScore:  oppTeam?.score ?? null,
      };
    });

    cacheSet(key, result, 5 * 60 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] MLB last5 ${teamAbbr}: ${e.message}`);
    return [];
  }
}

async function getMLBTeamStats(teamAbbr) {
  const teamId = MLB_TEAM_IDS[teamAbbr.toUpperCase()];
  if (!teamId) return null;

  const key    = `mlb:stats:${teamAbbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const year = currentMLBYear();
    const [hitRes, pitRes] = await Promise.allSettled([
      fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&season=${year}&group=hitting`,  { signal: AbortSignal.timeout(10000) }),
      fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&season=${year}&group=pitching`, { signal: AbortSignal.timeout(10000) }),
    ]);

    let hitting = null, pitching = null;
    if (hitRes.status === 'fulfilled' && hitRes.value.ok) {
      const j = await hitRes.value.json();
      hitting = j?.stats?.[0]?.splits?.[0]?.stat || null;
    }
    if (pitRes.status === 'fulfilled' && pitRes.value.ok) {
      const j = await pitRes.value.json();
      pitching = j?.stats?.[0]?.splits?.[0]?.stat || null;
    }

    if (!hitting && !pitching) return null;

    const gp  = hitting?.gamesPlayed || pitching?.gamesPlayed || 1;
    const result = {
      // Hitting
      avg:  hitting?.avg  || '--',
      obp:  hitting?.obp  || '--',
      slg:  hitting?.slg  || '--',
      ops:  hitting?.ops  || '--',
      rpg:  hitting  ? f2((hitting.runs     || 0) / gp) : '--',
      hr:   hitting  ? String(hitting.homeRuns || 0)    : '--',
      // Pitching
      era:  pitching?.era  || '--',
      whip: pitching?.whip || '--',
      k9:   pitching?.strikeoutsPer9Inn ? f2(parseFloat(pitching.strikeoutsPer9Inn)) : '--',
      bb9:  pitching?.walksPer9Inn      ? f2(parseFloat(pitching.walksPer9Inn))      : '--',
      hr9:  pitching?.homeRunsPer9      ? f2(parseFloat(pitching.homeRunsPer9))      : '--',
      // Record
      wins:   pitching?.wins   ?? hitting?.wins   ?? null,
      losses: pitching?.losses ?? hitting?.losses ?? null,
    };

    cacheSet(key, result, 6 * 3600 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] MLB stats ${teamAbbr}: ${e.message}`);
    return null;
  }
}

// Probable starter + season stats + last 3 starts for one team on today's game
async function getMLBProbablePitcher(teamId) {
  const key    = `mlb:pitcher:${teamId}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const nullResult = null;
  try {
    const today    = new Date().toISOString().split('T')[0];
    const schedRes = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&date=${today}&hydrate=probablePitcher`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!schedRes.ok) return nullResult;
    const sched = await schedRes.json();
    const game  = sched?.dates?.[0]?.games?.[0];
    if (!game) { cacheSet(key, nullResult, 5 * 60 * 1000); return nullResult; }

    // Find which side our team is on
    const isHome    = game.teams?.home?.team?.id === teamId;
    const ourSide   = isHome ? game.teams.home : game.teams.away;
    const pitcher   = ourSide?.probablePitcher;
    if (!pitcher?.id) { cacheSet(key, nullResult, 5 * 60 * 1000); return nullResult; }

    const pitcherId = pitcher.id;
    const year      = currentMLBYear();

    // Fetch hand + season stats + last 3 game logs in parallel
    const [personRes, seasonRes, logRes] = await Promise.allSettled([
      fetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}`,                                                                   { signal: AbortSignal.timeout(8000) }),
      fetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&season=${year}&group=pitching`,                  { signal: AbortSignal.timeout(8000) }),
      fetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog&season=${year}&group=pitching&limit=3`,         { signal: AbortSignal.timeout(8000) }),
    ]);

    let hand = '?';
    if (personRes.status === 'fulfilled' && personRes.value.ok) {
      const j  = await personRes.value.json();
      hand = j?.people?.[0]?.pitchHand?.code || '?';
    }

    let seasonStat = {};
    if (seasonRes.status === 'fulfilled' && seasonRes.value.ok) {
      const j = await seasonRes.value.json();
      seasonStat = j?.stats?.[0]?.splits?.[0]?.stat || {};
    }

    let last3 = [];
    if (logRes.status === 'fulfilled' && logRes.value.ok) {
      const j      = await logRes.value.json();
      const splits = j?.stats?.[0]?.splits || [];
      last3 = splits.slice(0, 3).map(s => `${s.stat?.inningsPitched || '?'}-${s.stat?.earnedRuns ?? '?'}`);
    }

    const result = {
      name:   pitcher.fullName || pitcher.name || '',
      hand,
      era:    seasonStat.era   || '--',
      whip:   seasonStat.whip  || '--',
      k9:     seasonStat.strikeoutsPer9Inn ? f2(parseFloat(seasonStat.strikeoutsPer9Inn)) : '--',
      wins:   seasonStat.wins   ?? '--',
      losses: seasonStat.losses ?? '--',
      gs:     seasonStat.gamesStarted ?? '--',
      last3,
    };

    cacheSet(key, result, 30 * 60 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] MLB probable pitcher ${teamId}: ${e.message}`);
    return nullResult;
  }
}

// MLB season series H2H
async function getMLBH2H(team1Id, team2Id) {
  const key    = `mlb:h2h:${team1Id}:${team2Id}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const year = currentMLBYear();
    const url  = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${year}&gameType=R&teamId=${team1Id}&opponentId=${team2Id}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();

    let t1Wins = 0, t2Wins = 0;
    for (const d of (json?.dates || [])) {
      for (const g of (d.games || [])) {
        if (g.status?.abstractGameState !== 'Final') continue;
        const t1IsHome = g.teams?.home?.team?.id === team1Id;
        const homeWon  = g.teams?.home?.isWinner;
        if (t1IsHome) { if (homeWon) t1Wins++; else t2Wins++; }
        else          { if (homeWon) t2Wins++; else t1Wins++; }
      }
    }

    const result = { team1Wins: t1Wins, team2Wins: t2Wins, totalGames: t1Wins + t2Wins };
    cacheSet(key, result, 3600 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] MLB H2H: ${e.message}`);
    return null;
  }
}

// Weather at the home ballpark for today
async function getMLBVenueWeather(homeAbbr) {
  const venue = MLB_VENUE_DATA[homeAbbr.toUpperCase()];
  if (!venue) return null;

  const key    = `mlb:weather:${homeAbbr}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Indoor parks — no weather impact
  if (venue.indoor) {
    const result = {
      venueName: venue.name,
      venueCity: venue.city,
      indoor:    true,
      parkFactor: venue.hrFactor,
      ...parkFactorLabel(venue.hrFactor),
    };
    cacheSet(key, result, 3600 * 1000);
    return result;
  }

  try {
    const { lat, lon } = venue;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const c    = json?.current;
    if (!c) return null;

    const windDeg = c.wind_direction_10m;
    const result  = {
      venueName:    venue.name,
      venueCity:    venue.city,
      indoor:       false,
      tempF:        Math.round(c.temperature_2m || 0),
      windMph:      Math.round(c.wind_speed_10m || 0),
      windDir:      degToCardinal(windDeg),
      windDeg,
      precipChance: c.precipitation_probability || 0,
      weatherCode:  c.weather_code,
      parkFactor:   venue.hrFactor,
      ...parkFactorLabel(venue.hrFactor),
    };

    cacheSet(key, result, 30 * 60 * 1000);
    return result;
  } catch (e) {
    console.warn(`[freeApis] MLB weather ${homeAbbr}: ${e.message}`);
    // Return venue info without weather
    return { venueName: venue.name, venueCity: venue.city, indoor: false, parkFactor: venue.hrFactor, ...parkFactorLabel(venue.hrFactor) };
  }
}

function parkFactorLabel(hrFactor) {
  if (hrFactor >= 1.10) return { parkLabel: 'Hitter Friendly', parkColor: 'green' };
  if (hrFactor <= 0.90) return { parkLabel: 'Pitcher Friendly', parkColor: 'blue' };
  return { parkLabel: 'Neutral Park', parkColor: 'grey' };
}

module.exports = {
  // NBA
  getNBATeamGamelog,
  getNBATeamStats,
  getNBAKeyPlayers,
  getNBAH2H,
  getNBARestDays,
  // NHL
  getNHLTeamStats,
  getNHLTeamLast5,
  getNHLH2H,
  getNHLGameGoalies,
  // MLB
  getMLBTeamLast5,
  getMLBTeamStats,
  getMLBProbablePitcher,
  getMLBH2H,
  getMLBVenueWeather,
  // Data maps (used by games.js)
  MLB_TEAM_IDS,
};
