/**
 * leaders.js — Top player per key stat category for both teams
 *
 * NBA : BallDontLie /v1/players + /v1/season_averages
 * NHL : api.nhle.com/stats/rest/en/skater/summary (by team + season)
 * MLB : statsapi.mlb.com team hitting + pitching stats
 */

// ── Inline ID maps (no circular dependency with freeApis.js) ─────────────────

const BDL_TEAM_IDS = {
  ATL: 1,  BOS: 2,  BKN: 3,  CHA: 4,  CHI: 5,  CLE: 6,  DAL: 7,  DEN: 8,
  DET: 9,  GSW: 10, GS:  10, HOU: 11, IND: 12, LAC: 13, LAL: 14, MEM: 15,
  MIA: 16, MIL: 17, MIN: 18, NOP: 19, NO:  19, NYK: 20, NY:  20, OKC: 21,
  ORL: 22, PHI: 23, PHX: 24, POR: 25, SAC: 26, SAS: 27, SA:  27,
  TOR: 28, UTA: 29, WAS: 30,
};

const MLB_TEAM_IDS = {
  ARI: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CWS: 145,
  CIN: 113, CLE: 114, COL: 115, DET: 116, HOU: 117, KC:  118,
  LAA: 108, LAD: 119, MIA: 146, MIL: 158, MIN: 142, NYM: 121,
  NYY: 147, OAK: 133, PHI: 143, PIT: 134, SD:  135, SF:  137,
  SEA: 136, STL: 138, TB:  139, TEX: 140, TOR: 141, WSH: 120,
};

// ── TTL in-memory cache (6 hours) ─────────────────────────────────────────────

const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e || Date.now() > e.exp) return null;
  return e.data;
}
function cacheSet(k, data, ttlMs) {
  _cache.set(k, { data, exp: Date.now() + ttlMs });
}
const TTL = 6 * 3600 * 1000;

// ── Season helpers ─────────────────────────────────────────────────────────────

function bdlSeason() {
  const mon = new Date().getMonth() + 1;
  return mon < 7 ? new Date().getFullYear() - 1 : new Date().getFullYear();
}
function nhlSeasonId() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
  return m >= 9 ? `${y}${y + 1}` : `${y - 1}${y}`;
}
function mlbYear() {
  return (new Date().getMonth() + 1) < 4 ? new Date().getFullYear() - 1 : new Date().getFullYear();
}

// ── NBA ───────────────────────────────────────────────────────────────────────

async function getNBATeamLeaders(awayAbbr, homeAbbr) {
  const key = `nba:leaders:${awayAbbr}:${homeAbbr}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) return null;

  try {
    const awayId = BDL_TEAM_IDS[awayAbbr.toUpperCase()];
    const homeId = BDL_TEAM_IDS[homeAbbr.toUpperCase()];
    if (!awayId || !homeId) return null;

    const headers = { Authorization: apiKey };

    // Fetch ACTIVE roster only (not historical) for both teams simultaneously
    const [arRes, hrRes] = await Promise.all([
      fetch(`https://api.balldontlie.io/v1/players/active?team_ids[]=${awayId}&per_page=100`, { headers, signal: AbortSignal.timeout(10000) }),
      fetch(`https://api.balldontlie.io/v1/players/active?team_ids[]=${homeId}&per_page=100`, { headers, signal: AbortSignal.timeout(10000) }),
    ]);
    if (!arRes.ok || !hrRes.ok) return null;

    const awayPlayers = (await arRes.json()).data || [];
    const homePlayers = (await hrRes.json()).data || [];
    const allPlayers  = [...awayPlayers, ...homePlayers];
    if (!allPlayers.length) return null;

    // Fetch season averages individually (API only accepts single player_id)
    const season = bdlSeason();
    const avgResults = await Promise.all(
      allPlayers.map(p =>
        fetch(`https://api.balldontlie.io/v1/season_averages?season=${season}&player_id=${p.id}`, { headers, signal: AbortSignal.timeout(10000) })
          .then(r => r.ok ? r.json() : { data: [] })
          .then(j => (j.data || [])[0] || null)
          .catch(() => null)
      )
    );

    const avgMap = {};
    avgResults.forEach((avg, i) => { if (avg) avgMap[allPlayers[i].id] = avg; });
    const nameMap = Object.fromEntries(allPlayers.map(p => [p.id, `${p.first_name} ${p.last_name}`]));

    const awayIds = awayPlayers.map(p => p.id);
    const homeIds = homePlayers.map(p => p.id);

    function leader(ids, stat) {
      let bestId = null, bestV = -Infinity;
      for (const id of ids) {
        const a = avgMap[id];
        if (!a) continue;
        const v = parseFloat(a[stat] || 0);
        if (v > bestV) { bestV = v; bestId = id; }
      }
      if (!bestId || bestV <= 0) return null;
      return { name: nameMap[bestId] || '?', value: bestV.toFixed(1) };
    }

    const result = {
      rows: [
        { label: 'Points',   unit: 'PPG', away: leader(awayIds, 'pts'), home: leader(homeIds, 'pts') },
        { label: 'Rebounds', unit: 'RPG', away: leader(awayIds, 'reb'), home: leader(homeIds, 'reb') },
        { label: 'Assists',  unit: 'APG', away: leader(awayIds, 'ast'), home: leader(homeIds, 'ast') },
        { label: 'Steals',   unit: 'SPG', away: leader(awayIds, 'stl'), home: leader(homeIds, 'stl') },
      ],
    };

    cacheSet(key, result, TTL);
    return result;
  } catch (e) {
    console.warn(`[leaders] NBA ${awayAbbr}/${homeAbbr}: ${e.message}`);
    return null;
  }
}

// ── NHL ───────────────────────────────────────────────────────────────────────

async function getNHLTeamLeaders(awayAbbr, homeAbbr) {
  const key = `nhl:leaders:${awayAbbr}:${homeAbbr}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  try {
    const seasonId = nhlSeasonId();
    const q = (abbr) =>
      `teamAbbrevs%3D%22${encodeURIComponent(abbr)}%22%20and%20seasonId%3D${seasonId}%20and%20gameTypeId%3D2`;

    const [awayRes, homeRes] = await Promise.all([
      fetch(`https://api.nhle.com/stats/rest/en/skater/summary?cayenneExp=${q(awayAbbr)}&sort=points&limit=50`, { signal: AbortSignal.timeout(10000) }),
      fetch(`https://api.nhle.com/stats/rest/en/skater/summary?cayenneExp=${q(homeAbbr)}&sort=points&limit=50`, { signal: AbortSignal.timeout(10000) }),
    ]);
    if (!awayRes.ok || !homeRes.ok) return null;

    const awayS = (await awayRes.json()).data || [];
    const homeS = (await homeRes.json()).data || [];
    if (!awayS.length && !homeS.length) return null;

    // Find the player with the highest value for a given stat
    function nhlLeader(skaters, stat) {
      if (!skaters.length) return null;
      let best = null, bestV = -Infinity;
      for (const s of skaters) {
        const v = s[stat] ?? -999;
        if (v > bestV) { bestV = v; best = s; }
      }
      if (!best || best[stat] == null) return null;
      return { name: best.skaterFullName || '?', value: String(best[stat]) };
    }

    function pmLeader(skaters) {
      const p = nhlLeader(skaters, 'plusMinus');
      if (!p) return null;
      const n = parseInt(p.value, 10);
      return { name: p.name, value: n >= 0 ? `+${n}` : String(n) };
    }

    const result = {
      rows: [
        { label: 'Points',     unit: 'PTS', away: nhlLeader(awayS, 'points'),  home: nhlLeader(homeS, 'points')  },
        { label: 'Goals',      unit: 'G',   away: nhlLeader(awayS, 'goals'),   home: nhlLeader(homeS, 'goals')   },
        { label: 'Assists',    unit: 'A',   away: nhlLeader(awayS, 'assists'), home: nhlLeader(homeS, 'assists') },
        { label: 'Plus/Minus', unit: '+/-', away: pmLeader(awayS),             home: pmLeader(homeS)             },
      ],
    };

    cacheSet(key, result, TTL);
    return result;
  } catch (e) {
    console.warn(`[leaders] NHL ${awayAbbr}/${homeAbbr}: ${e.message}`);
    return null;
  }
}

// ── MLB ───────────────────────────────────────────────────────────────────────

async function getMLBTeamLeaders(awayAbbr, homeAbbr) {
  const key = `mlb:leaders:${awayAbbr}:${homeAbbr}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  try {
    const awayId = MLB_TEAM_IDS[awayAbbr.toUpperCase()];
    const homeId = MLB_TEAM_IDS[homeAbbr.toUpperCase()];
    if (!awayId || !homeId) return null;

    const year = mlbYear();

    // Fetch hitting + pitching for both teams (4 requests in parallel)
    const [awayHitR, homeHitR, awayPitR, homePitR] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season=${year}&teamId=${awayId}&sportId=1&limit=40`,  { signal: AbortSignal.timeout(10000) }),
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season=${year}&teamId=${homeId}&sportId=1&limit=40`,  { signal: AbortSignal.timeout(10000) }),
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&season=${year}&teamId=${awayId}&sportId=1&limit=40`, { signal: AbortSignal.timeout(10000) }),
      fetch(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&season=${year}&teamId=${homeId}&sportId=1&limit=40`, { signal: AbortSignal.timeout(10000) }),
    ]);

    async function splits(res) {
      if (!res.ok) return [];
      try { return (await res.json())?.stats?.[0]?.splits || []; } catch { return []; }
    }

    const [awayHit, homeHit, awayPit, homePit] = await Promise.all([
      splits(awayHitR), splits(homeHitR), splits(awayPitR), splits(homePitR),
    ]);

    function hitLeader(rows, stat, fmt) {
      if (!rows.length) return null;
      let best = null, bestV = -Infinity;
      for (const r of rows) {
        const v = parseFloat(r.stat?.[stat] || 0);
        if (v > bestV) { bestV = v; best = r; }
      }
      if (!best || bestV <= 0) return null;
      const raw = best.stat?.[stat];
      return { name: best.player?.fullName || '?', value: fmt ? fmt(raw) : String(raw ?? '--') };
    }

    function pitKLeader(rows) {
      // K leader among starters (gamesStarted > 0)
      const starters = rows.filter(r => (r.stat?.gamesStarted || 0) > 0);
      if (!starters.length) return null;
      let best = null, bestK = -1;
      for (const r of starters) {
        const k = parseInt(r.stat?.strikeOuts || 0, 10);
        if (k > bestK) { bestK = k; best = r; }
      }
      if (!best || bestK <= 0) return null;
      return { name: best.player?.fullName || '?', value: String(bestK) };
    }

    const fmtAvg = v => {
      const n = parseFloat(v);
      if (isNaN(n) || n <= 0) return '--';
      return n.toFixed(3).replace(/^0/, '');
    };

    const result = {
      rows: [
        { label: 'Batting Avg',     unit: 'AVG', away: hitLeader(awayHit, 'avg', fmtAvg), home: hitLeader(homeHit, 'avg', fmtAvg) },
        { label: 'Home Runs',       unit: 'HR',  away: hitLeader(awayHit, 'homeRuns'),     home: hitLeader(homeHit, 'homeRuns')     },
        { label: 'RBI',             unit: 'RBI', away: hitLeader(awayHit, 'rbi'),           home: hitLeader(homeHit, 'rbi')          },
        { label: 'Strikeouts (SP)', unit: 'K',   away: pitKLeader(awayPit),                 home: pitKLeader(homePit)                },
      ],
    };

    cacheSet(key, result, TTL);
    return result;
  } catch (e) {
    console.warn(`[leaders] MLB ${awayAbbr}/${homeAbbr}: ${e.message}`);
    return null;
  }
}

module.exports = { getNBATeamLeaders, getNHLTeamLeaders, getMLBTeamLeaders };
