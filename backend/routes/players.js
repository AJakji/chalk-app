// Chalk Players API — all live data, no hardcoded values
// Data sources (all free):
//   NBA  — stats.nba.com (leagueleaders + playergamelog)
//   NHL  — NHL Official API (api-web.nhle.com)
//   MLB  — MLB Stats API (statsapi.mlb.com)

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bdl     = require('../services/ballDontLie');
const mlb     = require('../services/mlbStats');
const nhl     = require('../services/nhlApi');

// ── In-memory cache ────────────────────────────────────────────────────────────

const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data, ttlSec) {
  _cache.set(key, { data, expires: Date.now() + ttlSec * 1000 });
}

const TTL = {
  LEADERS:  6 * 3600,    // 6 hours
  SEARCH:   24 * 3600,   // 24 hours
  PROFILE:  6 * 3600,    // 6 hours
  GAMELOGS: 6 * 3600,    // 6 hours
  INJURIES: 3600,        // 1 hour
  TRENDING: 30 * 60,     // 30 minutes
  TONIGHT:  30 * 60,     // 30 minutes
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function safe(v, d = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? d : n;
}

function round1(v) { return Math.round(safe(v) * 10) / 10; }
function round2(v) { return Math.round(safe(v) * 100) / 100; }
function round3(v) { return Math.round(safe(v) * 1000) / 1000; }

// Current date YYYY-MM-DD
function today() { return new Date().toISOString().split('T')[0]; }

// Current NHL season string e.g. "20252026"
function currentNHLSeason() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  return month < 7 ? `${year - 1}${year}` : `${year}${year + 1}`;
}

// Current NBA season string e.g. "2025-26"
function currentNBASeason() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  // NBA season starts in October; before July = still in season that started last year
  if (month < 7)  return `${year - 1}-${String(year).slice(2)}`;
  if (month >= 10) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`; // off-season: show last completed season
}

// Required headers for stats.nba.com (blocks requests without Referer/Origin)
const NBA_STATS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer':    'https://www.nba.com/',
  'Origin':     'https://www.nba.com',
  'Accept':     'application/json, text/plain, */*',
};

// Column indices for stats.nba.com/stats/leagueleaders (PerMode=PerGame)
// Row format: [PLAYER_ID, RANK, PLAYER, TEAM_ID, TEAM, GP, MIN, FGM, FGA, FG_PCT,
//              FG3M, FG3A, FG3_PCT, FTM, FTA, FT_PCT, OREB, DREB, REB,
//              AST, STL, BLK, TOV, PTS, EFF]
const NBA_STAT_MAP = {
  PTS:   { category: 'PTS',  col: 23, decimals: 1 },
  REB:   { category: 'REB',  col: 18, decimals: 1 },
  AST:   { category: 'AST',  col: 19, decimals: 1 },
  '3PM': { category: 'FG3M', col: 10, decimals: 1 },
  STL:   { category: 'STL',  col: 20, decimals: 2 },
  BLK:   { category: 'BLK',  col: 21, decimals: 2 },
};

// MLB season year — use previous year before April (before Opening Day)
function currentMLBSeason() {
  const now = new Date();
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

// MLB team abbreviation from full team name
function mlbTeamAbbr(name) {
  if (!name) return '';
  const MAP = {
    'Boston Red Sox': 'BOS', 'New York Yankees': 'NYY', 'Baltimore Orioles': 'BAL',
    'Tampa Bay Rays': 'TBR', 'Toronto Blue Jays': 'TOR', 'Chicago White Sox': 'CWS',
    'Cleveland Guardians': 'CLE', 'Detroit Tigers': 'DET', 'Kansas City Royals': 'KCR',
    'Minnesota Twins': 'MIN', 'Houston Astros': 'HOU', 'Los Angeles Angels': 'LAA',
    'Oakland Athletics': 'OAK', 'Athletics': 'OAK', 'Seattle Mariners': 'SEA',
    'Texas Rangers': 'TEX', 'New York Mets': 'NYM', 'Atlanta Braves': 'ATL',
    'Miami Marlins': 'MIA', 'Philadelphia Phillies': 'PHI', 'Washington Nationals': 'WSH',
    'Chicago Cubs': 'CHC', 'Cincinnati Reds': 'CIN', 'Milwaukee Brewers': 'MIL',
    'Pittsburgh Pirates': 'PIT', 'St. Louis Cardinals': 'STL',
    'Arizona Diamondbacks': 'ARI', 'Colorado Rockies': 'COL',
    'Los Angeles Dodgers': 'LAD', 'San Diego Padres': 'SDP', 'San Francisco Giants': 'SFG',
  };
  return MAP[name] || name.split(' ').pop().slice(0, 3).toUpperCase();
}

// ── Tonight's playing teams ────────────────────────────────────────────────────

async function getTonightTeams(league) {
  const ckey = `tonight:${league}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const teams = new Set();
  try {
    if (league === 'NBA') {
      const games = await bdl.getGames(today());
      for (const g of (games || [])) {
        if (g.home_team?.abbreviation)    teams.add(g.home_team.abbreviation);
        if (g.visitor_team?.abbreviation) teams.add(g.visitor_team.abbreviation);
      }
    } else if (league === 'NHL') {
      // getScheduleNow() returns the games array directly
      const games = await nhl.getScheduleNow();
      for (const g of (Array.isArray(games) ? games : [])) {
        if (g.homeTeam?.abbrev) teams.add(g.homeTeam.abbrev);
        if (g.awayTeam?.abbrev) teams.add(g.awayTeam.abbrev);
      }
    } else if (league === 'MLB') {
      const games = await mlb.getSchedule(today());
      for (const g of (games || [])) {
        if (g.teams?.home?.team?.name) teams.add(mlbTeamAbbr(g.teams.home.team.name));
        if (g.teams?.away?.team?.name) teams.add(mlbTeamAbbr(g.teams.away.team.name));
      }
    }
  } catch (err) {
    console.warn(`[players] getTonightTeams(${league}) failed:`, err.message);
  }

  cacheSet(ckey, teams, TTL.TONIGHT);
  return teams;
}

// ── NBA injuries ───────────────────────────────────────────────────────────────

async function getNBAInjuries() {
  const ckey = 'injuries:NBA';
  const cached = cacheGet(ckey);
  if (cached) return cached;

  try {
    const raw = await bdl.getInjuries();
    const map = {};
    for (const p of (raw || [])) {
      const name = `${p.player?.first_name || ''} ${p.player?.last_name || ''}`.trim();
      if (name) map[name] = p.status || 'Questionable';
    }
    cacheSet(ckey, map, TTL.INJURIES);
    return map;
  } catch { return {}; }
}

// ── NBA All-Players index (cached 24h) — gives real NBA IDs for headshots/profiles ──

let _nbaPlayerIndex     = null;
let _nbaPlayerIndexExp  = 0;

async function getNBAPlayerIndex() {
  if (_nbaPlayerIndex && Date.now() < _nbaPlayerIndexExp) return _nbaPlayerIndex;
  const season = currentNBASeason();
  const url = `https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=${season}`;
  const res = await fetch(url, { headers: NBA_STATS_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const data = await res.json();
  const rs = data?.resultSets?.[0];
  if (!rs) return null;
  const idx = {};
  (rs.headers || []).forEach((h, i) => { idx[h] = i; });
  _nbaPlayerIndex = (rs.rowSet || []).map(r => ({
    id:       r[idx['PERSON_ID']],
    name:     r[idx['DISPLAY_FIRST_LAST']] || '',
    nameKey:  (r[idx['DISPLAY_FIRST_LAST']] || '').toLowerCase(),
    team:     r[idx['TEAM_ABBREVIATION']] || '',
  }));
  _nbaPlayerIndexExp = Date.now() + 24 * 3600 * 1000;
  return _nbaPlayerIndex;
}

// ── NBA Leaders — stats.nba.com leagueleaders (sorted, real-time) ─────────────

async function getNBALeaders(stat) {
  const ckey = `leaders:NBA:${stat}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const statDef = NBA_STAT_MAP[stat];
  if (!statDef) return null;

  const season  = currentNBASeason();
  const roundFn = statDef.decimals === 2 ? round2 : round1;

  try {
    const url = `https://stats.nba.com/stats/leagueleaders`
      + `?LeagueID=00&PerMode=PerGame&Scope=S&Season=${season}`
      + `&SeasonType=Regular+Season&StatCategory=${statDef.category}`;

    const res = await fetch(url, {
      headers: NBA_STATS_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.warn('[players] stats.nba.com leagueleaders returned', res.status);
      return null;
    }
    const data = await res.json();

    // resultSet (singular) or resultSets[0] depending on endpoint version
    const rs   = data?.resultSet || data?.resultSets?.[0];
    const rows = rs?.rowSet || [];
    if (!rows.length) return null;

    const [tonightRes, injRes] = await Promise.allSettled([
      getTonightTeams('NBA'),
      getNBAInjuries(),
    ]);
    const tonightSet = tonightRes.status === 'fulfilled' ? tonightRes.value : new Set();
    const injMap     = injRes.status === 'fulfilled'    ? injRes.value    : {};

    // Row: [PLAYER_ID(0), RANK(1), PLAYER(2), TEAM_ID(3), TEAM(4), GP(5), MIN(6),
    //       FGM(7), FGA(8), FG_PCT(9), FG3M(10), ..., REB(18), AST(19),
    //       STL(20), BLK(21), TOV(22), PTS(23), EFF(24)]
    // Sort explicitly — stats.nba.com doesn't always return rows in stat order
    const sorted = [...rows].sort((a, b) => b[statDef.col] - a[statDef.col]);

    const leaders = sorted.slice(0, 20).map((row, i) => ({
      rank:           i + 1,
      playerId:       row[0],
      name:           row[2],
      team:           row[4],
      value:          roundFn(row[statDef.col]),
      gp:             row[5] || 0,
      headshot:       `https://cdn.nba.com/headshots/nba/latest/1040x760/${row[0]}.png`,
      playingTonight: tonightSet.has(row[4]),
      injuryStatus:   injMap[row[2]] || null,
    }));

    cacheSet(ckey, leaders, TTL.LEADERS);
    return leaders;
  } catch (err) {
    console.warn('[players] getNBALeaders failed:', err.message);
    return null;
  }
}

// ── NHL Leaders — official NHL API (/current endpoint) ────────────────────────

const NHL_CAT_MAP = {
  G:    'goals',
  A:    'assists',
  PTS:  'points',
  '+/-':'plusMinus',
  SOG:  'shots',
};

async function getNHLLeaders(stat) {
  const ckey = `leaders:NHL:${stat}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const category = NHL_CAT_MAP[stat];
  if (!category) return null;

  try {
    // Use /current so it always reflects the active season
    const url = `https://api-web.nhle.com/v1/skater-stats-leaders/current?categories=${category}&limit=20`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();

    // NHL API returns { goals: [...] } or { goals: { leaders: [...] } }
    const rows = Array.isArray(data?.[category])
      ? data[category]
      : (data?.[category]?.leaders || []);

    if (!rows.length) return null;

    const tonight = await getTonightTeams('NHL').catch(() => new Set());

    const leaders = rows.map((r, i) => ({
      rank:           i + 1,
      // NHL API uses playerId (not id)
      playerId:       r.playerId || r.id,
      name:           `${r.firstName?.default || ''} ${r.lastName?.default || ''}`.trim(),
      team:           r.teamAbbrev || r.teamAbbreviation || '',
      value:          r.value,
      headshot:       r.headshot || null,
      playingTonight: tonight.has(r.teamAbbrev || r.teamAbbreviation || ''),
      injuryStatus:   null,
    }));

    cacheSet(ckey, leaders, TTL.LEADERS);
    return leaders;
  } catch (err) {
    console.warn('[players] getNHLLeaders failed:', err.message);
    return null;
  }
}

// ── MLB Leaders — official MLB Stats API ──────────────────────────────────────

const MLB_STAT_MAP = {
  AVG: { category: 'battingAverage',   group: 'hitting',  pool: 'Qualified', fmt: v => round3(v) },
  HR:  { category: 'homeRuns',         group: 'hitting',  pool: 'ALL',       fmt: v => Math.round(v) },
  RBI: { category: 'runsBattedIn',     group: 'hitting',  pool: 'ALL',       fmt: v => Math.round(v) },
  ERA: { category: 'earnedRunAverage', group: 'pitching', pool: 'Qualified', fmt: v => round2(v) },
  K:   { category: 'strikeouts',       group: 'pitching', pool: 'ALL',       fmt: v => Math.round(v) },
};

async function getMLBLeaders(stat) {
  const ckey = `leaders:MLB:${stat}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const statDef = MLB_STAT_MAP[stat];
  if (!statDef) return null;

  const year = currentMLBSeason();

  try {
    const url = `https://statsapi.mlb.com/api/v1/stats/leaders`
      + `?leaderCategories=${statDef.category}&limit=20&season=${year}`
      + `&statGroup=${statDef.group}&playerPool=${statDef.pool}&sportId=1`;

    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();

    const rows = data?.leagueLeaders?.[0]?.leaders || [];
    if (!rows.length) return null;

    const tonight = await getTonightTeams('MLB').catch(() => new Set());

    const leaders = rows.map(r => {
      const pid  = r.person?.id;
      const team = mlbTeamAbbr(r.team?.name);
      return {
        rank:           r.rank,
        playerId:       pid,
        name:           r.person?.fullName || '',
        team,
        value:          statDef.fmt(parseFloat(r.value) || 0),
        headshot:       pid
          ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${pid}/headshot/silo/current`
          : null,
        playingTonight: tonight.has(team),
        injuryStatus:   null,
      };
    });

    cacheSet(ckey, leaders, TTL.LEADERS);
    return leaders;
  } catch (err) {
    console.warn('[players] getMLBLeaders failed:', err.message);
    return null;
  }
}

// ── Trending Today ─────────────────────────────────────────────────────────────

async function buildTrending(league) {
  const ckey = `trending:${league}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const results = [];
  const leagues = league === 'All' ? ['NBA', 'NHL', 'MLB'] : [league];

  // 1. Chalky prop picks from DB (silently skip if DB not available)
  try {
    const { rows } = await db.query(
      `SELECT player_name, pick_value, matchup_text, player_team,
              player_position, sport, confidence
       FROM picks
       WHERE pick_date = CURRENT_DATE AND pick_category = 'prop'
         AND player_name IS NOT NULL
       ORDER BY confidence DESC LIMIT 6`
    );
    for (const r of rows) {
      if (!leagues.includes(r.sport || 'NBA')) continue;
      results.push({
        id:         `chalky-${r.player_name.replace(/\s+/g, '-')}`,
        name:       r.player_name,
        team:       r.player_team || '',
        position:   r.player_position || '',
        league:     r.sport || 'NBA',
        badge:      'chalky',
        badgeLabel: 'Chalky Pick',
        note:       `${r.pick_value || ''} ${r.matchup_text || 'tonight'}`.trim(),
      });
    }
  } catch { /* DB not yet available — skip */ }

  // 2. NBA injuries from BallDontLie (real-time)
  if (leagues.includes('NBA')) {
    try {
      const raw = await bdl.getInjuries();
      const notable = (raw || [])
        .filter(p => p.status === 'Out' || p.status === 'Day-To-Day')
        .slice(0, 4);
      for (const p of notable) {
        const name = `${p.player?.first_name || ''} ${p.player?.last_name || ''}`.trim();
        if (!name) continue;
        results.push({
          id:         `inj-NBA-${p.player?.id || name}`,
          name,
          team:       p.player?.team?.abbreviation || '',
          position:   p.player?.position || '',
          league:     'NBA',
          badge:      'injury',
          badgeLabel: p.status === 'Out' ? `OUT — ${p.body_part || 'Injury'}` : `GTD — ${p.body_part || 'Injury'}`,
          note:       p.return_date ? `Expected back ${p.return_date}` : p.status || '',
        });
      }
    } catch { /* skip */ }
  }

  // 3. NHL hot streaks via DB game logs (silently skip if empty)
  if (leagues.includes('NHL')) {
    try {
      const { rows } = await db.query(
        `WITH recent AS (
           SELECT player_id, player_name, team,
                  SUM(assists) AS total_pts,
                  COUNT(*) AS gp
           FROM player_game_logs
           WHERE sport = 'NHL'
             AND game_date >= CURRENT_DATE - INTERVAL '14 days'
           GROUP BY player_id, player_name, team
           HAVING COUNT(*) >= 4
         )
         SELECT *, ROUND((total_pts::numeric/gp),1) AS avg_pts
         FROM recent
         WHERE total_pts >= 6
         ORDER BY total_pts DESC LIMIT 3`
      );
      for (const r of rows) {
        results.push({
          id:         `hot-NHL-${r.player_id}`,
          name:       r.player_name,
          team:       r.team || '',
          position:   '',
          league:     'NHL',
          badge:      'hot',
          badgeLabel: 'Hot Streak',
          note:       `${r.total_pts} pts in last ${r.gp} games`,
        });
      }
    } catch { /* DB not yet available */ }
  }

  // 4. MLB hot streaks via DB (silently skip if empty)
  if (leagues.includes('MLB')) {
    try {
      const { rows } = await db.query(
        `WITH recent AS (
           SELECT player_id, player_name, team,
                  AVG(fg_pct) AS avg_ba,
                  COUNT(*) AS gp
           FROM player_game_logs
           WHERE sport = 'MLB'
             AND game_date >= CURRENT_DATE - INTERVAL '14 days'
             AND fg_pct > 0
           GROUP BY player_id, player_name, team
           HAVING COUNT(*) >= 7
         )
         SELECT * FROM recent
         WHERE avg_ba >= 0.360
         ORDER BY avg_ba DESC LIMIT 3`
      );
      for (const r of rows) {
        results.push({
          id:         `hot-MLB-${r.player_id}`,
          name:       r.player_name,
          team:       r.team || '',
          position:   '',
          league:     'MLB',
          badge:      'hot',
          badgeLabel: 'Hot Streak',
          note:       `.${Math.round(parseFloat(r.avg_ba) * 1000)} BA over last ${r.gp} games`,
        });
      }
    } catch { /* DB not yet available */ }
  }

  if (!results.length) return null;

  const filtered = league === 'All' ? results : results.filter(r => r.league === league);
  if (!filtered.length) return null;

  cacheSet(ckey, filtered, TTL.TRENDING);
  return filtered;
}

// ── NBA Player Profile ─────────────────────────────────────────────────────────

async function buildNBAProfile(playerId) {
  const ckey = `profile:NBA:${playerId}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const pid = parseInt(playerId, 10);
  if (isNaN(pid)) return null;

  const season = currentNBASeason();

  // All three calls use stats.nba.com — same ID system as leagueleaders
  const [infoRes, gamelogRes, careerRes] = await Promise.allSettled([
    fetch(`https://stats.nba.com/stats/commonplayerinfo?PlayerID=${pid}`,
      { headers: NBA_STATS_HEADERS, signal: AbortSignal.timeout(12000) }
    ).then(r => r.ok ? r.json() : null),
    fetch(
      `https://stats.nba.com/stats/playergamelog?PlayerID=${pid}&Season=${season}&SeasonType=Regular+Season`,
      { headers: NBA_STATS_HEADERS, signal: AbortSignal.timeout(12000) }
    ).then(r => r.ok ? r.json() : null),
    fetch(`https://stats.nba.com/stats/playercareerstats?PlayerID=${pid}&PerMode=PerGame`,
      { headers: NBA_STATS_HEADERS, signal: AbortSignal.timeout(12000) }
    ).then(r => r.ok ? r.json() : null),
  ]);

  const infoData   = infoRes.status   === 'fulfilled' ? infoRes.value   : null;
  const glData     = gamelogRes.status === 'fulfilled' ? gamelogRes.value : null;
  const careerData = careerRes.status  === 'fulfilled' ? careerRes.value  : null;

  // commonplayerinfo: resultSets[0], headers + rowSet[0]
  const infoRS  = infoData?.resultSets?.[0];
  const infoRow = infoRS?.rowSet?.[0];
  if (!infoRow) return null;

  const ih = {};
  (infoRS.headers || []).forEach((h, i) => { ih[h] = i; });

  const name     = infoRow[ih['DISPLAY_FIRST_LAST']] || '';
  const teamAbbr = infoRow[ih['TEAM_ABBREVIATION']] || '';
  const team     = `${infoRow[ih['TEAM_CITY']] || ''} ${infoRow[ih['TEAM_NAME']] || ''}`.trim() || teamAbbr;
  const position = infoRow[ih['POSITION']] || '';
  const jersey   = infoRow[ih['JERSEY']] || '';
  const height   = infoRow[ih['HEIGHT']] || '';
  const weight   = infoRow[ih['WEIGHT']] || '';
  const country  = infoRow[ih['COUNTRY']] || '';
  const college  = infoRow[ih['SCHOOL']] || '';

  if (!name) return null;

  // Game log — newest-first from stats.nba.com
  // Cols: [0]SEASON_ID [1]Player_ID [2]Game_ID [3]GAME_DATE [4]MATCHUP [5]WL [6]MIN
  //       [7]FGM [8]FGA [9]FG_PCT [10]FG3M [11]FG3A [12]FG3_PCT [13]FTM [14]FTA [15]FT_PCT
  //       [16]OREB [17]DREB [18]REB [19]AST [20]STL [21]BLK [22]TOV [23]PF [24]PTS [25]PLUS_MINUS
  const glRows   = glData?.resultSets?.[0]?.rowSet || [];
  const gameLogs = glRows.map(r => ({
    date: r[3], matchup: r[4], result: r[5], min: safe(r[6]),
    fgm: safe(r[7]), fg_pct: safe(r[9]),
    fg3m: safe(r[10]), fg3_pct: safe(r[12]),
    ft_pct: safe(r[15]),
    reb: safe(r[18]), ast: safe(r[19]), stl: safe(r[20]), blk: safe(r[21]),
    pts: safe(r[24]), plus_minus: safe(r[25]),
  }));

  const last10 = gameLogs.slice(0, 10);
  const last5  = gameLogs.slice(0, 5);

  const avg = (arr, field) =>
    arr.length ? round1(arr.reduce((s, g) => s + safe(g[field]), 0) / arr.length) : 0;

  const homeGames = gameLogs.filter(g => g.matchup?.includes('vs.'));
  const awayGames = gameLogs.filter(g => g.matchup?.includes('@'));

  // Season + career averages from playercareerstats
  const seasonRS   = careerData?.resultSets?.find(rs => rs.name === 'SeasonTotalsRegularSeason')
                  || careerData?.resultSets?.[0];
  const seasonRows = seasonRS?.rowSet || [];
  const ch = {};
  (seasonRS?.headers || []).forEach((h, i) => { ch[h] = i; });
  const seasonRow = seasonRows.find(r => r[ch['SEASON_ID']] === season)
                 || seasonRows[seasonRows.length - 1]
                 || [];

  const getS = (f) => seasonRow ? safe(seasonRow[ch[f]]) : 0;
  const pct  = (f) => seasonRow && seasonRow[ch[f]] != null
    ? round1(parseFloat(seasonRow[ch[f]]) * 100) : 0;

  const seasonStats = {
    PTS:   round1(getS('PTS')),
    REB:   round1(getS('REB')),
    AST:   round1(getS('AST')),
    STL:   round2(getS('STL')),
    BLK:   round2(getS('BLK')),
    '3PM': round1(getS('FG3M')),
    'FG%': pct('FG_PCT'),
    '3P%': pct('FG3_PCT'),
    'FT%': pct('FT_PCT'),
    MIN:   round1(getS('MIN')),
    GP:    parseInt(getS('GP')) || gameLogs.length,
  };

  const last10Games = last10.map(g => ({
    date:      g.date || '',
    opp:       (g.matchup || '').split(' ').pop() || '',
    result:    g.result || '',
    pts:       g.pts,
    reb:       g.reb,
    ast:       g.ast,
    plusMinus: g.plus_minus,
  }));

  const splits = {
    home:   { PTS: avg(homeGames, 'pts'), REB: avg(homeGames, 'reb'), AST: avg(homeGames, 'ast') },
    away:   { PTS: avg(awayGames, 'pts'), REB: avg(awayGames, 'reb'), AST: avg(awayGames, 'ast') },
    last5:  { PTS: avg(last5,  'pts'), REB: avg(last5,  'reb'), AST: avg(last5,  'ast') },
    last10: { PTS: avg(last10, 'pts'), REB: avg(last10, 'reb'), AST: avg(last10, 'ast') },
    season: { PTS: seasonStats.PTS, REB: seasonStats.REB, AST: seasonStats.AST },
  };

  const careerStats = seasonRows.map(r => ({
    season: r[ch['SEASON_ID']] || '',
    team:   r[ch['TEAM_ABBREVIATION']] || '',
    gp:     parseInt(safe(r[ch['GP']])) || 0,
    pts:    round1(safe(r[ch['PTS']])),
    reb:    round1(safe(r[ch['REB']])),
    ast:    round1(safe(r[ch['AST']])),
  })).filter(r => r.season);

  const tonight = await getTonightTeams('NBA').catch(() => new Set());

  const profile = {
    id: String(pid), playerId: pid, name, team, teamAbbr, position,
    jerseyNumber: jersey, height, weight, country, college,
    league:   'NBA',
    status:   'Active',
    headshot: `https://cdn.nba.com/headshots/nba/latest/1040x760/${pid}.png`,
    tonightGame: tonight.has(teamAbbr) ? 'Playing tonight' : null,
    seasonStats, last10Games, splits, careerStats, injury: null,
  };

  cacheSet(ckey, profile, TTL.PROFILE);
  return profile;
}

// ── NHL Player Profile ─────────────────────────────────────────────────────────

async function buildNHLProfile(playerId) {
  const ckey = `profile:NHL:${playerId}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const season = currentNHLSeason(); // e.g. "20252026"

  const [profileRes, gamelogRes] = await Promise.allSettled([
    nhl.getPlayerProfile(playerId),
    nhl.getPlayerGameLog(playerId, season, 2),
  ]);

  const p   = profileRes.status === 'fulfilled' ? profileRes.value : null;
  const log = gamelogRes.status === 'fulfilled'
    ? (gamelogRes.value?.gameLog || gamelogRes.value || [])
    : [];

  if (!p) return null;

  const name     = `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim();
  const teamAbbr = p.currentTeamAbbrev || p.teamAbbrev || '';
  const team     = p.fullTeamName?.default || teamAbbr;

  const sorted = [...(Array.isArray(log) ? log : [])].sort((a, b) =>
    (b.gameDate || '').localeCompare(a.gameDate || '')
  );
  const last10 = sorted.slice(0, 10);
  const last5  = sorted.slice(0, 5);

  const avg   = (arr, f) => arr.length ? round1(arr.reduce((s, g) => s + safe(g[f]), 0) / arr.length) : 0;
  const total = (arr, f) => Math.round(arr.reduce((s, g) => s + safe(g[f]), 0));

  // Find current season totals from the player landing page
  const currentSeasonStats = (p.seasonTotals || []).find(s =>
    String(s.season) === season && s.gameTypeId === 2
  ) || {};

  const seasonStats = {
    G:     currentSeasonStats.goals    ?? total(sorted, 'goals'),
    A:     currentSeasonStats.assists  ?? total(sorted, 'assists'),
    PTS:   currentSeasonStats.points   ?? total(sorted, 'points'),
    SOG:   currentSeasonStats.shots    ?? total(sorted, 'shots'),
    '+/-': currentSeasonStats.plusMinus ?? total(sorted, 'plusMinus'),
    TOI:   avg(sorted, 'toi'),
    GP:    currentSeasonStats.gamesPlayed ?? sorted.length,
  };

  // Fetch boxscores for last 10 games in parallel to get final scores + W/L/OT
  const scoreMap = {};
  await Promise.allSettled(
    last10.map(g => {
      if (!g.gameId) return Promise.resolve();
      return fetch(
        `https://api-web.nhle.com/v1/gamecenter/${g.gameId}/boxscore`,
        { signal: AbortSignal.timeout(8000) }
      )
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          scoreMap[g.gameId] = {
            homeAbbrev:     d.homeTeam?.abbrev || '',
            awayAbbrev:     d.awayTeam?.abbrev || '',
            homeScore:      d.homeTeam?.score  ?? null,
            awayScore:      d.awayTeam?.score  ?? null,
            lastPeriodType: d.gameOutcome?.lastPeriodType || 'REG',
          };
        })
        .catch(() => {});
    })
  );

  const last10Games = last10.map(g => {
    const sc     = scoreMap[g.gameId];
    let result   = '';
    let score    = '';

    if (sc && sc.homeScore != null) {
      const isHome       = g.homeRoadFlag === 'H';
      const playerScore  = isHome ? sc.homeScore : sc.awayScore;
      const oppScore     = isHome ? sc.awayScore : sc.homeScore;
      const isExtra      = sc.lastPeriodType !== 'REG'; // OT or SO

      if (playerScore > oppScore)      result = 'W';
      else if (playerScore < oppScore) result = isExtra ? 'OT' : 'L';
      else                             result = isExtra ? 'OT' : '';

      score = `${playerScore}-${oppScore}`;
    }

    return {
      date:      (g.gameDate || '').slice(0, 10),
      opp:       g.opponentAbbrev || '',
      result,
      score,
      goals:     safe(g.goals),
      assists:   safe(g.assists),
      points:    safe(g.points),
      sog:       safe(g.shots),
      plusMinus: safe(g.plusMinus),
    };
  });

  const homeGames = sorted.filter(g => g.homeRoadFlag === 'H');
  const roadGames = sorted.filter(g => g.homeRoadFlag === 'R');

  const splits = {
    home:   { G: avg(homeGames, 'goals'), A: avg(homeGames, 'assists'), PTS: avg(homeGames, 'points') },
    away:   { G: avg(roadGames, 'goals'), A: avg(roadGames, 'assists'), PTS: avg(roadGames, 'points') },
    last5:  { G: avg(last5,  'goals'), A: avg(last5,  'assists'), PTS: avg(last5,  'points') },
    last10: { G: avg(last10, 'goals'), A: avg(last10, 'assists'), PTS: avg(last10, 'points') },
    season: { G: seasonStats.G, A: seasonStats.A, PTS: seasonStats.PTS },
  };

  const tonight = await getTonightTeams('NHL').catch(() => new Set());

  const profile = {
    id: String(playerId), playerId,
    name, team, teamAbbr,
    position:     p.position || '',
    jerseyNumber: p.sweaterNumber || '',
    league:       'NHL',
    status:       'Active',
    headshot:     p.headshot || null,
    tonightGame:  tonight.has(teamAbbr) ? 'Playing tonight' : null,
    seasonStats,
    last10Games,
    splits,
    careerStats:  [],
    injury:       null,
  };

  cacheSet(ckey, profile, TTL.PROFILE);
  return profile;
}

// ── MLB Player Profile ─────────────────────────────────────────────────────────

async function buildMLBProfile(playerId) {
  const ckey = `profile:MLB:${playerId}`;
  const cached = cacheGet(ckey);
  if (cached) return cached;

  const pid  = parseInt(playerId, 10);
  if (isNaN(pid)) return null;

  const year = currentMLBSeason();

  try {
    const [infoRes, statsRes, gamelogRes] = await Promise.allSettled([
      fetch(`https://statsapi.mlb.com/api/v1/people/${pid}?hydrate=currentTeam`, { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null),
      fetch(
        `https://statsapi.mlb.com/api/v1/people/${pid}/stats?stats=season&season=${year}&group=hitting,pitching&sportId=1`,
        { signal: AbortSignal.timeout(8000) }
      ).then(r => r.ok ? r.json() : null),
      mlb.getPlayerGameLog(pid, year),
    ]);

    const info      = infoRes.status === 'fulfilled'    ? infoRes.value?.people?.[0] : null;
    const rawStats  = statsRes.status === 'fulfilled'   ? statsRes.value?.stats : null;
    const gamelog   = gamelogRes.status === 'fulfilled' ? (gamelogRes.value || []) : [];

    if (!info) return null;

    const name     = info.fullName || '';
    const teamAbbr = mlbTeamAbbr(info.currentTeam?.name || '');
    const team     = info.currentTeam?.name || teamAbbr;
    const position = info.primaryPosition?.abbreviation || '';

    const hittingStats  = rawStats?.find(s => s.group?.displayName === 'hitting')?.splits?.[0]?.stat || {};
    const pitchingStats = rawStats?.find(s => s.group?.displayName === 'pitching')?.splits?.[0]?.stat || {};

    const isPitcher = ['SP', 'RP', 'P'].includes(position);

    const seasonStats = isPitcher ? {
      ERA:   round2(parseFloat(pitchingStats.era || 0)),
      K:     parseInt(pitchingStats.strikeOuts || 0),
      W:     parseInt(pitchingStats.wins || 0),
      IP:    parseFloat(parseFloat(pitchingStats.inningsPitched || 0).toFixed(1)),
      WHIP:  round2(parseFloat(pitchingStats.whip || 0)),
      'K/9': round1(parseFloat(pitchingStats.strikeoutsPer9Inn || 0)),
      GP:    parseInt(pitchingStats.gamesPlayed || 0),
    } : {
      AVG: round3(parseFloat(hittingStats.avg || 0)),
      HR:  parseInt(hittingStats.homeRuns || 0),
      RBI: parseInt(hittingStats.rbi || 0),
      OBP: round3(parseFloat(hittingStats.obp || 0)),
      SLG: round3(parseFloat(hittingStats.slg || 0)),
      OPS: round3(parseFloat(hittingStats.ops || 0)),
      SB:  parseInt(hittingStats.stolenBases || 0),
      GP:  parseInt(hittingStats.gamesPlayed || 0),
    };

    // Game log: MLB returns splits array [{date, stat:{...}, opponent:{...}}]
    const sorted = [...gamelog].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    const last10 = sorted.slice(0, 10);
    const last5  = sorted.slice(0, 5);

    const bAvg = (arr, f) => arr.length
      ? round1(arr.reduce((s, g) => s + safe(g.stat?.[f] ?? g[f]), 0) / arr.length)
      : 0;

    const last10Games = last10.map(g => ({
      date:   (g.date || '').slice(0, 10),
      opp:    g.opponent?.abbreviation || g.opponent?.name?.slice(0, 3) || '',
      result: g.isWin ? 'W' : (g.isWin === false ? 'L' : ''),
      hits:   safe(g.stat?.hits ?? g.hits),
      rbi:    safe(g.stat?.rbi  ?? g.rbi),
      hr:     safe(g.stat?.homeRuns ?? g.hr),
    }));

    const splits = {
      last5:  { AVG: bAvg(last5,  'avg'), HR: bAvg(last5,  'homeRuns'), RBI: bAvg(last5,  'rbi') },
      last10: { AVG: bAvg(last10, 'avg'), HR: bAvg(last10, 'homeRuns'), RBI: bAvg(last10, 'rbi') },
      season: { AVG: seasonStats.AVG || 0, HR: seasonStats.HR || 0, RBI: seasonStats.RBI || 0 },
    };

    const tonight = await getTonightTeams('MLB').catch(() => new Set());

    const profile = {
      id: String(pid), playerId: pid, name, team, teamAbbr, position,
      jerseyNumber: info.primaryNumber || '',
      league:       'MLB',
      status:       info.active ? 'Active' : 'Inactive',
      headshot:     `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${pid}/headshot/silo/current`,
      tonightGame:  tonight.has(teamAbbr) ? 'Playing tonight' : null,
      seasonStats,
      last10Games,
      splits,
      careerStats:  [],
      injury:       null,
    };

    cacheSet(ckey, profile, TTL.PROFILE);
    return profile;
  } catch (err) {
    console.warn('[players] buildMLBProfile failed:', err.message);
    return null;
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/players/leaders?league=NBA&stat=PTS
router.get('/leaders', async (req, res) => {
  const { league = 'NBA', stat = 'PTS' } = req.query;

  try {
    let leaders = null;
    if (league === 'NBA')      leaders = await getNBALeaders(stat);
    else if (league === 'NHL') leaders = await getNHLLeaders(stat);
    else if (league === 'MLB') leaders = await getMLBLeaders(stat);

    if (leaders?.length) return res.json({ leaders, live: true });
  } catch (err) {
    console.warn('[players] /leaders failed:', err.message);
  }

  res.json({ leaders: [], live: false, note: 'Stats are loading. Check back in a moment.' });
});

// GET /api/players/trending?league=All
router.get('/trending', async (req, res) => {
  const { league = 'All' } = req.query;

  try {
    const trending = await buildTrending(league);
    if (trending?.length) return res.json({ trending, live: true });
  } catch (err) {
    console.warn('[players] /trending failed:', err.message);
  }

  res.json({ trending: [], live: false });
});

// GET /api/players/search?q=jokic&league=NBA
router.get('/search', async (req, res) => {
  const { q = '', league = 'NBA' } = req.query;
  if (!q.trim()) return res.json({ players: [] });

  const ckey = `search:${league}:${q.toLowerCase().trim()}`;
  const cached = cacheGet(ckey);
  if (cached) return res.json({ players: cached, live: true });

  try {
    if (league === 'NBA' || league === 'All') {
      // Use stats.nba.com player index so IDs match headshot CDN + profile endpoint
      const allPlayers = await getNBAPlayerIndex().catch(() => null);
      if (allPlayers?.length) {
        const qLower = q.toLowerCase().trim();
        const matches = allPlayers.filter(p => p.nameKey.includes(qLower)).slice(0, 10);
        if (matches.length) {
          // Fetch injuries once for badge display
          const injMap = await getNBAInjuries().catch(() => ({}));
          const players = matches.map(p => ({
            id:           String(p.id),
            playerId:     p.id,
            name:         p.name,
            team:         p.team,
            position:     '',
            league:       'NBA',
            headshot:     `https://cdn.nba.com/headshots/nba/latest/1040x760/${p.id}.png`,
            injuryStatus: injMap[p.name] || null,
          }));
          cacheSet(ckey, players, TTL.SEARCH);
          return res.json({ players, live: true });
        }
      }
      // Fallback to BDL (active players only)
      const results = await bdl.searchPlayers(q);
      const active  = (results || []).filter(p => p.is_active !== false);
      if (active.length) {
        const players = active.slice(0, 10).map(p => ({
          id:       String(p.id),
          playerId: p.id,
          name:     `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          team:     p.team?.abbreviation || '',
          position: p.position || '',
          league:   'NBA',
          headshot: null,
        }));
        cacheSet(ckey, players, TTL.SEARCH);
        return res.json({ players, live: true });
      }
    }

    if (league === 'NHL') {
      // Search via NHL API
      const url = `https://api-web.nhle.com/v1/player/search?q=${encodeURIComponent(q)}`;
      const r2  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r2.ok) {
        const data = await r2.json();
        const people = Array.isArray(data) ? data : (data?.players || []);
        if (people.length) {
          const players = people.slice(0, 10).map(p => ({
            id:       String(p.playerId || p.id),
            playerId: p.playerId || p.id,
            name:     `${p.firstName?.default || p.name?.split(' ')[0] || ''} ${p.lastName?.default || p.name?.split(' ').slice(1).join(' ') || ''}`.trim() || p.name || '',
            team:     p.teamAbbrev || p.currentTeamAbbrev || '',
            position: p.positionCode || '',
            league:   'NHL',
            status:   'Active',
          }));
          cacheSet(ckey, players, TTL.SEARCH);
          return res.json({ players, live: true });
        }
      }
      // Fallback: filter current leaders
      const leaders = await getNHLLeaders('PTS').catch(() => null);
      if (Array.isArray(leaders)) {
        const qLower  = q.toLowerCase();
        const players = leaders
          .filter(r => r.name.toLowerCase().includes(qLower))
          .map(r => ({ id: String(r.playerId), playerId: r.playerId, name: r.name, team: r.team, position: 'F', league: 'NHL', status: 'Active' }));
        if (players.length) {
          cacheSet(ckey, players, TTL.SEARCH);
          return res.json({ players, live: true });
        }
      }
    }

    if (league === 'MLB') {
      const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(q)}&sportId=1`;
      const r2  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r2.ok) {
        const data   = await r2.json();
        const people = (data?.people || []).filter(p => p.active !== false);
        if (people.length) {
          const players = people.slice(0, 10).map(p => ({
            id:       String(p.id),
            playerId: p.id,
            name:     p.fullName || '',
            team:     mlbTeamAbbr(p.currentTeam?.name || ''),
            position: p.primaryPosition?.abbreviation || '',
            league:   'MLB',
            headshot: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${p.id}/headshot/silo/current`,
          }));
          cacheSet(ckey, players, TTL.SEARCH);
          return res.json({ players, live: true });
        }
      }
    }
  } catch (err) {
    console.warn('[players] /search failed:', err.message);
  }

  res.json({ players: [] });
});

// ── Live in-game stats ─────────────────────────────────────────────────────────

async function getNBALiveStats(playerName) {
  const playerRes = await fetch(
    `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(playerName)}&per_page=5`,
    { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } }
  );
  if (!playerRes.ok) return null;
  const playerData = await playerRes.json();
  const player = playerData.data?.[0];
  if (!player) return null;

  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const statsRes = await fetch(
    `https://api.balldontlie.io/v1/stats?dates[]=${todayET}&player_ids[]=${player.id}&per_page=5`,
    { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } }
  );
  if (!statsRes.ok) return null;
  const statsData = await statsRes.json();
  const stat = statsData.data?.[0];
  if (!stat) return null;

  const game   = stat.game;
  const isLive = game?.status && game.status !== 'Final' && !game.status.includes('Final');

  return {
    points:    stat.pts,
    rebounds:  stat.reb,
    assists:   stat.ast,
    steals:    stat.stl,
    blocks:    stat.blk,
    turnovers: stat.turnover,
    fg:        `${stat.fgm}/${stat.fga}`,
    fg_pct:    stat.fg_pct,
    three_pt:  `${stat.fg3m}/${stat.fg3a}`,
    minutes:   stat.min,
    isLive,
    gameStatus: game?.status,
    opponent:  game?.home_team_id === player.team_id
      ? game?.visitor_team?.abbreviation
      : game?.home_team?.abbreviation,
    isHome:   game?.home_team_id === player.team_id,
    period:   game?.period,
    clock:    game?.time,
  };
}

async function getNHLLiveStats(playerName) {
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const schedRes = await fetch(`https://api-web.nhle.com/v1/schedule/${todayET}`);
  if (!schedRes.ok) return null;
  const schedData = await schedRes.json();
  const games = schedData.gameWeek?.[0]?.games || [];

  const liveGame = games.find(g => g.gameState === 'LIVE' || g.gameState === 'CRIT');
  if (!liveGame) return null;

  const boxRes = await fetch(`https://api-web.nhle.com/v1/gamecenter/${liveGame.id}/boxscore`);
  if (!boxRes.ok) return null;
  const boxData = await boxRes.json();

  const allPlayers = [
    ...(boxData.playerByGameStats?.homeTeam?.forwards  || []),
    ...(boxData.playerByGameStats?.homeTeam?.defense   || []),
    ...(boxData.playerByGameStats?.homeTeam?.goalies   || []),
    ...(boxData.playerByGameStats?.awayTeam?.forwards  || []),
    ...(boxData.playerByGameStats?.awayTeam?.defense   || []),
    ...(boxData.playerByGameStats?.awayTeam?.goalies   || []),
  ];

  const surname = playerName.split(' ').pop().toLowerCase();
  const player  = allPlayers.find(p =>
    (p.name?.default || '').toLowerCase().includes(surname)
  );
  if (!player) return null;

  const base = {
    isLive:     liveGame.gameState === 'LIVE',
    gameStatus: liveGame.gameState,
    period:     boxData.periodDescriptor?.number,
    clock:      boxData.clock?.timeRemaining,
  };

  if (player.savePctg !== undefined) {
    return { ...base, isGoalie: true, saves: player.saves, shotsAgainst: player.shotsAgainst,
             savePct: player.savePctg, goalsAgainst: player.goalsAgainst, toi: player.toi };
  }
  return { ...base, goals: player.goals, assists: player.assists,
           points: (player.goals || 0) + (player.assists || 0),
           shots: player.shots, hits: player.hits, blocked: player.blocked,
           plusMinus: player.plusMinus, toi: player.toi };
}

async function getMLBLiveStats(playerName) {
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const schedRes = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayET}&hydrate=linescore`
  );
  if (!schedRes.ok) return null;
  const schedData = await schedRes.json();
  const games     = schedData.dates?.[0]?.games || [];

  const liveGame = games.find(g => g.status?.abstractGameState === 'Live');
  if (!liveGame) return null;

  const boxRes = await fetch(`https://statsapi.mlb.com/api/v1/game/${liveGame.gamePk}/boxscore`);
  if (!boxRes.ok) return null;
  const boxData = await boxRes.json();

  const surname = playerName.split(' ').pop().toLowerCase();
  for (const side of ['home', 'away']) {
    const players = Object.values(boxData.teams?.[side]?.players || {});
    const player  = players.find(p =>
      p.person?.fullName?.toLowerCase().includes(surname)
    );
    if (!player) continue;

    const batting  = player.stats?.batting;
    const pitching = player.stats?.pitching;
    const base = {
      isLive:      true,
      inning:      liveGame.linescore?.currentInning,
      inningHalf:  liveGame.linescore?.inningHalf,
    };

    if (pitching?.inningsPitched) {
      return { ...base, isPitcher: true,
               inningsPitched: pitching.inningsPitched,
               strikeouts: pitching.strikeOuts, earnedRuns: pitching.earnedRuns,
               hits: pitching.hits, walks: pitching.baseOnBalls,
               pitchCount: pitching.numberOfPitches, era: pitching.era };
    }
    if (batting) {
      return { ...base, isBatter: true,
               atBats: batting.atBats, hits: batting.hits, homeRuns: batting.homeRuns,
               rbi: batting.rbi, runs: batting.runs, strikeouts: batting.strikeOuts,
               walks: batting.baseOnBalls, avg: batting.avg };
    }
  }
  return null;
}

// GET /api/players/:name/live?sport=NBA
router.get('/:name/live', async (req, res) => {
  const playerName = req.params.name;
  const sport      = req.query.sport || 'NBA';

  try {
    let liveStats = null;
    if (sport === 'NBA')      liveStats = await getNBALiveStats(playerName);
    else if (sport === 'NHL') liveStats = await getNHLLiveStats(playerName);
    else if (sport === 'MLB') liveStats = await getMLBLiveStats(playerName);

    res.json({ isPlaying: !!liveStats, liveStats });
  } catch (err) {
    console.warn('[players] /live failed:', err.message);
    res.json({ isPlaying: false, liveStats: null });
  }
});

// GET /api/players/:id?league=NBA
router.get('/:id', async (req, res) => {
  const { id }              = req.params;
  const { league = 'NBA' } = req.query;

  try {
    let profile = null;
    if (league === 'NBA')      profile = await buildNBAProfile(id);
    else if (league === 'NHL') profile = await buildNHLProfile(id);
    else if (league === 'MLB') profile = await buildMLBProfile(id);

    if (profile) return res.json({ player: profile, live: true });
  } catch (err) {
    console.warn('[players] /profile failed:', err.message);
  }

  res.status(404).json({ error: 'Player not found' });
});

module.exports = router;
