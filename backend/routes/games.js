/**
 * /api/games — Game detail tabs via free APIs + The Odds API
 *
 * GET /api/games/info?league=NBA&awayAbbr=SAC&homeAbbr=CHA
 *   Returns preview/matchup/injuries data for all 4 pre-match tabs
 *
 * GET /api/games/odds?league=NBA&awayAbbr=SAC&homeAbbr=CHA
 *   Returns live moneyline / spread / total odds from The Odds API
 */

const express    = require('express');
const router     = express.Router();
const fa         = require('../services/freeApis');
const leaders    = require('../services/leaders');
const Anthropic  = require('@anthropic-ai/sdk');

// ── Chalky-take TTL cache (30 min) ────────────────────────────────────────────
const _chalkyCache = new Map();
function chalkyGet(k) {
  const e = _chalkyCache.get(k);
  if (!e || Date.now() > e.exp) return null;
  return e.data;
}
function chalkySet(k, v) {
  _chalkyCache.set(k, { data: v, exp: Date.now() + 30 * 60 * 1000 });
}

// League → The Odds API sport key
const SPORT_KEYS = {
  NBA:    'basketball_nba',
  MLB:    'baseball_mlb',
  NHL:    'icehockey_nhl',
  SOCCER: 'soccer_fifa_world_cup',
};

// League → ESPN sport path (for injury fallback)
const ESPN_SPORT = {
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
};

// ── GET /api/games/info ────────────────────────────────────────────────────────
// Returns data for all 4 pre-match tabs: last5, team stats, key players, injuries
router.get('/info', async (req, res) => {
  const { league, awayAbbr, homeAbbr } = req.query;
  if (!league || !awayAbbr || !homeAbbr) {
    return res.status(400).json({ error: 'league, awayAbbr, homeAbbr required' });
  }

  const L     = league.toUpperCase();
  const empty = {
    awayLast5: [], homeLast5: [], headToHead: [],
    awayTeamStats: null, homeTeamStats: null,
    keyPlayers: null, goalieMatchup: null,
    awayInjuries: [], homeInjuries: [],
    awayRecord: null, homeRecord: null,
    awayPitcher: null, homePitcher: null,
    h2hSeries: null, venueWeather: null,
    awayRestDays: null, homeRestDays: null,
    awayHomeRecord: null, homeHomeRecord: null,
    awayRoadRecord: null, homeRoadRecord: null,
  };

  try {
    let awayLast5 = [], homeLast5 = [], headToHead = [];
    let awayTeamStats = null, homeTeamStats = null;
    let keyPlayers = null, goalieMatchup = null;
    let awayInjuries = [], homeInjuries = [];
    let awayRecord = null, homeRecord = null;
    // New enriched fields
    let awayPitcher = null, homePitcher = null;
    let h2hSeries   = null;
    let venueWeather = null;
    let awayRestDays = null, homeRestDays = null;
    let awayHomeRecord = null, homeHomeRecord = null;
    let awayRoadRecord = null, homeRoadRecord = null;

    if (L === 'NBA') {
      const [
        [awayLog, homeLog],
        [awayStats, homeStats],
        h2h,
        [awayRest, homeRest],
      ] = await Promise.all([
        Promise.all([ fa.getNBATeamGamelog(awayAbbr), fa.getNBATeamGamelog(homeAbbr) ]),
        Promise.all([ fa.getNBATeamStats(awayAbbr),   fa.getNBATeamStats(homeAbbr)   ]),
        fa.getNBAH2H(awayAbbr, homeAbbr),
        Promise.all([ fa.getNBARestDays(awayAbbr),    fa.getNBARestDays(homeAbbr)    ]),
      ]);

      awayLast5 = awayLog; homeLast5 = homeLog;
      awayTeamStats = awayStats; homeTeamStats = homeStats;
      h2hSeries = h2h;
      awayRestDays = awayRest; homeRestDays = homeRest;

      if (awayTeamStats?.wins != null) awayRecord = `${awayTeamStats.wins}-${awayTeamStats.losses}`;
      if (homeTeamStats?.wins != null) homeRecord = `${homeTeamStats.wins}-${homeTeamStats.losses}`;

      awayInjuries = await fetchESPNInjuries('NBA', awayAbbr);
      homeInjuries = await fetchESPNInjuries('NBA', homeAbbr);
    }

    else if (L === 'NHL') {
      const [
        [awayLog, homeLog],
        [awayStats, homeStats],
        goalies,
        h2h,
      ] = await Promise.all([
        Promise.all([ fa.getNHLTeamLast5(awayAbbr), fa.getNHLTeamLast5(homeAbbr) ]),
        Promise.all([ fa.getNHLTeamStats(awayAbbr),  fa.getNHLTeamStats(homeAbbr)  ]),
        fa.getNHLGameGoalies(awayAbbr, homeAbbr),
        fa.getNHLH2H(awayAbbr, homeAbbr),
      ]);

      awayLast5 = awayLog; homeLast5 = homeLog;
      awayTeamStats = awayStats; homeTeamStats = homeStats;
      goalieMatchup = goalies;
      h2hSeries = h2h;

      if (awayTeamStats?.wins != null) awayRecord = `${awayTeamStats.wins}-${awayTeamStats.losses}-${awayTeamStats.otLosses}`;
      if (homeTeamStats?.wins != null) homeRecord = `${homeTeamStats.wins}-${homeTeamStats.losses}-${homeTeamStats.otLosses}`;

      if (awayTeamStats) {
        awayHomeRecord = `${awayTeamStats.homeWins}-${awayTeamStats.homeLosses}-${awayTeamStats.homeOtLosses}`;
        awayRoadRecord = `${awayTeamStats.roadWins}-${awayTeamStats.roadLosses}-${awayTeamStats.roadOtLosses}`;
      }
      if (homeTeamStats) {
        homeHomeRecord = `${homeTeamStats.homeWins}-${homeTeamStats.homeLosses}-${homeTeamStats.homeOtLosses}`;
        homeRoadRecord = `${homeTeamStats.roadWins}-${homeTeamStats.roadLosses}-${homeTeamStats.roadOtLosses}`;
      }

      awayInjuries = await fetchESPNInjuries('NHL', awayAbbr);
      homeInjuries = await fetchESPNInjuries('NHL', homeAbbr);
    }

    else if (L === 'MLB') {
      const awayTeamId = fa.MLB_TEAM_IDS[awayAbbr.toUpperCase()];
      const homeTeamId = fa.MLB_TEAM_IDS[homeAbbr.toUpperCase()];

      const [
        [awayLog, homeLog],
        [awayStats, homeStats],
        [awayP, homeP],
        h2h,
        weather,
      ] = await Promise.all([
        Promise.all([ fa.getMLBTeamLast5(awayAbbr), fa.getMLBTeamLast5(homeAbbr) ]),
        Promise.all([ fa.getMLBTeamStats(awayAbbr),  fa.getMLBTeamStats(homeAbbr)  ]),
        awayTeamId && homeTeamId
          ? Promise.all([ fa.getMLBProbablePitcher(awayTeamId), fa.getMLBProbablePitcher(homeTeamId) ])
          : Promise.resolve([null, null]),
        awayTeamId && homeTeamId ? fa.getMLBH2H(awayTeamId, homeTeamId) : Promise.resolve(null),
        fa.getMLBVenueWeather(homeAbbr),
      ]);

      awayLast5 = awayLog; homeLast5 = homeLog;
      awayTeamStats = awayStats; homeTeamStats = homeStats;
      awayPitcher = awayP; homePitcher = homeP;
      h2hSeries = h2h;
      venueWeather = weather;

      if (awayTeamStats?.wins != null) awayRecord = `${awayTeamStats.wins}-${awayTeamStats.losses}`;
      if (homeTeamStats?.wins != null) homeRecord = `${homeTeamStats.wins}-${homeTeamStats.losses}`;

      awayInjuries = await fetchESPNInjuries('MLB', awayAbbr);
      homeInjuries = await fetchESPNInjuries('MLB', homeAbbr);
    }

    res.json({
      awayLast5, homeLast5, headToHead,
      awayTeamStats, homeTeamStats,
      keyPlayers, goalieMatchup,
      awayInjuries, homeInjuries,
      awayRecord, homeRecord,
      // Enriched fields
      awayPitcher, homePitcher,
      h2hSeries,
      venueWeather,
      awayRestDays, homeRestDays,
      awayHomeRecord, homeHomeRecord,
      awayRoadRecord, homeRoadRecord,
      // Keep arena/officials empty — only available from paid SD.io
      arena: '', arenaCity: '', officials: [],
    });
  } catch (err) {
    console.error('[games/info]', err.message);
    res.json(empty);
  }
});

// ── GET /api/games/odds ────────────────────────────────────────────────────────
// Returns moneyline / spread / total odds from The Odds API for a specific game
router.get('/odds', async (req, res) => {
  const { league, awayAbbr, homeAbbr, awayName, homeName } = req.query;
  const L        = (league || '').toUpperCase();
  const sportKey = SPORT_KEYS[L];

  if (!sportKey) return res.json({ moneyline: [], spread: [], total: [], noKey: true });

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey)  return res.json({ moneyline: [], spread: [], total: [], noKey: true });

  try {
    const url  = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,bet365`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });

    const remaining = resp.headers.get('x-requests-remaining');
    if (remaining) console.log(`[Odds API] ${remaining} requests remaining`);

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn(`[games/odds] Odds API ${resp.status}: ${txt.slice(0, 120)}`);
      return res.json({ moneyline: [], spread: [], total: [] });
    }

    const games = await resp.json();

    // Match game by team name fragments or abbreviation map
    const game = findGame(games, awayAbbr, homeAbbr, awayName, homeName);
    if (!game) return res.json({ moneyline: [], spread: [], total: [], noGame: true });

    res.json(parseOddsGame(game));
  } catch (err) {
    console.warn('[games/odds]', err.message);
    res.json({ moneyline: [], spread: [], total: [] });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

// ESPN team ID map for injury fetching (abbreviation → ESPN numeric ID)
const ESPN_TEAM_IDS = {
  // NBA
  ATL: '1',  BOS: '2',  BKN: '17', CHA: '30', CHI: '4',  CLE: '5',
  DAL: '6',  DEN: '7',  DET: '8',  GSW: '9',  GS: '9',   HOU: '10',
  IND: '11', LAC: '12', LAL: '13', MEM: '29', MIA: '14', MIL: '15',
  MIN: '16', NOP: '3',  NO: '3',   NYK: '18', NY: '18',  OKC: '25',
  ORL: '19', PHI: '20', PHX: '21', POR: '22', SAC: '23', SAS: '24',
  SA:  '24', TOR: '28', UTA: '26', WAS: '27',
  // NHL
  ANA: '25', ARI: '53', BUF: '3',  CAR: '12', CBJ: '29', CGY: '4',
  CHI: '16', COL: '17', DAL: '25', DET: '6',  EDM: '9',  FLA: '13',
  LAK: '26', MIN: '30', MTL: '8',  NSH: '18', NJD: '1',  NYI: '19',
  NYR: '20', OTT: '9',  PHI: '4',  PIT: '5',  SEA: '55', SJS: '28',
  STL: '23', TBL: '14', TOR: '10', UTA: '59', VAN: '15', VGK: '54',
  WSH: '24', WPG: '52', TB: '14',
  // MLB (ESPN IDs)
  ARI: '29', ATL: '15', BAL: '1',  BOS: '2',  CHC: '16', CWS: '4',
  CIN: '17', CLE: '5',  COL: '27', DET: '6',  HOU: '18', KC: '7',
  LAA: '3',  LAD: '19', MIA: '28', MIL: '21', MIN: '9',  NYM: '21',
  NYY: '10', OAK: '11', PHI: '22', PIT: '23', SD: '25',  SF: '26',
  SEA: '12', STL: '24', TB: '30',  TEX: '13', TOR: '14', WSH: '20',
};

// League-wide injury cache (one fetch covers all teams — much more reliable)
const _leagueInjuriesCache = new Map();

async function _fetchLeagueInjuries(league) {
  const sportPath = ESPN_SPORT[league];
  if (!sportPath) return {};

  const cacheKey = `injuries:${league}`;
  const cached   = _leagueInjuriesCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.data;

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/injuries`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return {};

    const json = await res.json();
    const byId = {};
    for (const team of (json?.injuries || [])) {
      byId[String(team.id)] = team.injuries || [];
    }

    _leagueInjuriesCache.set(cacheKey, { data: byId, exp: Date.now() + 15 * 60 * 1000 });
    return byId;
  } catch (e) {
    return {};
  }
}

async function fetchESPNInjuries(league, teamAbbr) {
  const espnId = ESPN_TEAM_IDS[teamAbbr.toUpperCase()];
  if (!espnId) return [];

  const allInjuries  = await _fetchLeagueInjuries(league);
  const teamInjuries = allInjuries[String(espnId)] || [];

  return teamInjuries.slice(0, 8).map(item => ({
    name:        item.athlete?.displayName || item.athlete?.fullName || '',
    status:      item.status || 'Questionable',
    description: item.shortComment || (item.longComment || '').slice(0, 120),
  })).filter(p => p.name);
}

// Map our abbreviations → team name fragments that appear in The Odds API
const ABBR_TO_ODDS_NAME = {
  ATL: 'Hawks',    BOS: 'Celtics',   BKN: 'Nets',     CHA: 'Hornets',
  CHI: 'Bulls',    CLE: 'Cavaliers', DAL: 'Mavericks',DEN: 'Nuggets',
  DET: 'Pistons',  GS:  'Warriors',  GSW: 'Warriors',  HOU: 'Rockets',
  IND: 'Pacers',   LAC: 'Clippers',  LAL: 'Lakers',   MEM: 'Grizzlies',
  MIA: 'Heat',     MIL: 'Bucks',     MIN: 'Timberwolves', NO: 'Pelicans',
  NOP: 'Pelicans', NY:  'Knicks',    NYK: 'Knicks',   OKC: 'Thunder',
  ORL: 'Magic',    PHI: '76ers',     PHX: 'Suns',     POR: 'Trail Blazers',
  SAC: 'Kings',    SA:  'Spurs',     SAS: 'Spurs',    TOR: 'Raptors',
  UTA: 'Jazz',     WAS: 'Wizards',
  // NHL
  ANA: 'Ducks',    ARI: 'Coyotes',   BUF: 'Sabres',   CAR: 'Hurricanes',
  CBJ: 'Blue Jackets', CGY: 'Flames',CHI: 'Blackhawks',COL: 'Avalanche',
  DAL: 'Stars',    DET: 'Red Wings', EDM: 'Oilers',   FLA: 'Panthers',
  LAK: 'Kings',    MTL: 'Canadiens', NSH: 'Predators',NJD: 'Devils',
  NYI: 'Islanders',NYR: 'Rangers',   OTT: 'Senators', PIT: 'Penguins',
  SEA: 'Kraken',   SJS: 'Sharks',    STL: 'Blues',    TBL: 'Lightning',
  TB:  'Lightning',TOR: 'Maple Leafs',VAN: 'Canucks', VGK: 'Golden Knights',
  WSH: 'Capitals', WPG: 'Jets',
  // MLB
  ARI: 'Diamondbacks', ATL: 'Braves', BAL: 'Orioles', BOS: 'Red Sox',
  CHC: 'Cubs',      CWS: 'White Sox', CIN: 'Reds',    CLE: 'Guardians',
  COL: 'Rockies',   DET: 'Tigers',    HOU: 'Astros',  KC: 'Royals',
  LAA: 'Angels',    LAD: 'Dodgers',   MIA: 'Marlins', MIL: 'Brewers',
  MIN: 'Twins',     NYM: 'Mets',      NYY: 'Yankees', OAK: 'Athletics',
  PHI: 'Phillies',  PIT: 'Pirates',   SD: 'Padres',   SF: 'Giants',
  SEA: 'Mariners',  STL: 'Cardinals', TB: 'Rays',     TEX: 'Rangers',
  TOR: 'Blue Jays', WSH: 'Nationals',
};

function nameMatches(teamName, abbr, displayName) {
  const fragment = ABBR_TO_ODDS_NAME[abbr.toUpperCase()] || '';
  const tn = (teamName || '').toLowerCase();
  // Primary: check if Odds API team name contains our known nickname fragment
  if (fragment && tn.includes(fragment.toLowerCase())) return true;
  // Secondary: check if Odds API team name shares words with our display name
  // (e.g. "Sacramento Kings" vs "Sacramento Kings" → matches on "sacramento" or "kings")
  if (displayName) {
    const dnWords = displayName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (dnWords.some(w => tn.includes(w))) return true;
  }
  return false;
}

function findGame(games, awayAbbr, homeAbbr, awayName, homeName) {
  for (const g of games) {
    const awayMatch = nameMatches(g.away_team, awayAbbr, awayName);
    const homeMatch = nameMatches(g.home_team, homeAbbr, homeName);
    if (awayMatch && homeMatch) return g;
  }
  // Broader fallback: match either team
  for (const g of games) {
    const awayMatch = nameMatches(g.away_team, awayAbbr, awayName) || nameMatches(g.home_team, awayAbbr, awayName);
    const homeMatch = nameMatches(g.home_team, homeAbbr, homeName) || nameMatches(g.away_team, homeAbbr, homeName);
    if (awayMatch && homeMatch) return g;
  }
  return null;
}

function fmtAmerican(n) {
  if (n == null) return null;
  return n > 0 ? `+${n}` : `${n}`;
}

function bestOdds(rows, key) {
  // For positive odds (underdog): highest value = best
  // For negative odds (favorite): least negative = best
  let best = null, bestVal = null;
  for (const r of rows) {
    const raw = r[key];
    if (raw == null) continue;
    if (bestVal === null || raw > bestVal) { bestVal = raw; best = r.book; }
  }
  return best;
}

function parseOddsGame(game) {
  const moneyline = [];
  const spread    = [];
  const total     = [];

  const BOOKS = ['DraftKings', 'FanDuel', 'BetMGM', 'bet365'];
  const BOOK_KEYS = { DraftKings: 'draftkings', FanDuel: 'fanduel', BetMGM: 'betmgm', 'bet365': 'bet365' };

  for (const book of BOOKS) {
    const bm = (game.bookmakers || []).find(b => b.key === BOOK_KEYS[book]);
    if (!bm) continue;

    const h2h     = bm.markets?.find(m => m.key === 'h2h');
    const spreads = bm.markets?.find(m => m.key === 'spreads');
    const totals  = bm.markets?.find(m => m.key === 'totals');

    if (h2h) {
      const away = h2h.outcomes.find(o => o.name === game.away_team);
      const home = h2h.outcomes.find(o => o.name === game.home_team);
      moneyline.push({ book, awayOdds: fmtAmerican(away?.price), homeOdds: fmtAmerican(home?.price), awayRaw: away?.price, homeRaw: home?.price });
    }
    if (spreads) {
      const away = spreads.outcomes.find(o => o.name === game.away_team);
      const home = spreads.outcomes.find(o => o.name === game.home_team);
      spread.push({
        book,
        awayLine: away?.point != null ? (away.point > 0 ? `+${away.point}` : `${away.point}`) : null,
        awayOdds: fmtAmerican(away?.price), awayRaw: away?.price,
        homeLine: home?.point != null ? (home.point > 0 ? `+${home.point}` : `${home.point}`) : null,
        homeOdds: fmtAmerican(home?.price), homeRaw: home?.price,
      });
    }
    if (totals) {
      const over  = totals.outcomes.find(o => o.name === 'Over');
      const under = totals.outcomes.find(o => o.name === 'Under');
      total.push({
        book,
        line:       over?.point ?? under?.point ?? null,
        overOdds:  fmtAmerican(over?.price),  overRaw:  over?.price,
        underOdds: fmtAmerican(under?.price), underRaw: under?.price,
      });
    }
  }

  return {
    awayTeam: game.away_team,
    homeTeam: game.home_team,
    moneyline,
    spread,
    total,
    bestMLAway:  bestOdds(moneyline, 'awayRaw'),
    bestMLHome:  bestOdds(moneyline, 'homeRaw'),
    bestSpAway:  bestOdds(spread,    'awayRaw'),
    bestSpHome:  bestOdds(spread,    'homeRaw'),
    bestOver:    bestOdds(total,     'overRaw'),
    bestUnder:   bestOdds(total,     'underRaw'),
  };
}

// ── GET /api/games/leaders ─────────────────────────────────────────────────────
// Returns top player per key stat for both teams. Cached 6 hours.
router.get('/leaders', async (req, res) => {
  const { league, awayAbbr, homeAbbr } = req.query;
  if (!league || !awayAbbr || !homeAbbr) {
    return res.status(400).json({ error: 'league, awayAbbr, homeAbbr required' });
  }
  try {
    const L = league.toUpperCase();
    let data = null;
    if (L === 'NBA') data = await leaders.getNBATeamLeaders(awayAbbr, homeAbbr);
    if (L === 'NHL') data = await leaders.getNHLTeamLeaders(awayAbbr, homeAbbr);
    if (L === 'MLB') data = await leaders.getMLBTeamLeaders(awayAbbr, homeAbbr);
    res.json(data || { rows: [] });
  } catch (e) {
    console.warn('[games/leaders]', e.message);
    res.json({ rows: [] });
  }
});

// ── GET /api/games/chalky-take ─────────────────────────────────────────────────
// Generates Chalky's one-sentence betting insight via Claude API. Cached 30 min.
// Accepts optional spread, total, awayRecord, homeRecord as query params.
router.get('/chalky-take', async (req, res) => {
  const { league, awayAbbr, homeAbbr, spread, total, awayRecord, homeRecord } = req.query;
  if (!league || !awayAbbr || !homeAbbr) {
    return res.status(400).json({ error: 'league, awayAbbr, homeAbbr required' });
  }

  const cacheKey = `chalky:${league}:${awayAbbr}:${homeAbbr}`;
  const cached   = chalkyGet(cacheKey);
  if (cached) return res.json({ take: cached });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.json({ take: null });

  try {
    const L = league.toUpperCase();

    // Gather context in parallel (all results are cached from the /info call)
    let contextLines = [`Sport: ${L}`, `Matchup: ${awayAbbr} @ ${homeAbbr}`];

    if (spread) contextLines.push(`Spread: ${awayAbbr} ${spread}`);
    if (total)  contextLines.push(`Total: ${total}`);
    if (awayRecord) contextLines.push(`${awayAbbr} record: ${awayRecord}`);
    if (homeRecord) contextLines.push(`${homeAbbr} record: ${homeRecord}`);

    if (L === 'NBA') {
      const [awayLog, homeLog, awayRest, homeRest, awayStats, homeStats] = await Promise.allSettled([
        fa.getNBATeamGamelog(awayAbbr),
        fa.getNBATeamGamelog(homeAbbr),
        fa.getNBARestDays(awayAbbr),
        fa.getNBARestDays(homeAbbr),
        fa.getNBATeamStats(awayAbbr),
        fa.getNBATeamStats(homeAbbr),
      ]);
      const al = awayLog.value  || [], hl = homeLog.value  || [];
      const ar = awayRest.value,        hr = homeRest.value;
      const as = awayStats.value || {},  hs = homeStats.value || {};

      const fmtLast5 = (log) => log.slice(0, 5).map(g => g.result).join('-') || 'N/A';
      contextLines.push(`${awayAbbr} last 5: ${fmtLast5(al)} | PPG: ${as.ppg ?? '--'} | DefRtg: ${as.defRtg ?? '--'}`);
      contextLines.push(`${homeAbbr} last 5: ${fmtLast5(hl)} | PPG: ${hs.ppg ?? '--'} | DefRtg: ${hs.defRtg ?? '--'}`);
      if (ar != null) contextLines.push(`${awayAbbr} rest: ${ar === 1 ? 'back-to-back' : ar + ' days'}`);
      if (hr != null) contextLines.push(`${homeAbbr} rest: ${hr === 1 ? 'back-to-back' : hr + ' days'}`);
    }

    else if (L === 'NHL') {
      const [awayLog, homeLog, awayStats, homeStats, goalies] = await Promise.allSettled([
        fa.getNHLTeamLast5(awayAbbr),
        fa.getNHLTeamLast5(homeAbbr),
        fa.getNHLTeamStats(awayAbbr),
        fa.getNHLTeamStats(homeAbbr),
        fa.getNHLGameGoalies(awayAbbr, homeAbbr),
      ]);
      const al = awayLog.value   || [], hl = homeLog.value   || [];
      const as = awayStats.value || {},  hs = homeStats.value || {};
      const g  = goalies.value   || {};

      const fmtLast5 = (log) => log.slice(0, 5).map(l => l.result).join('-') || 'N/A';
      contextLines.push(`${awayAbbr} last 5: ${fmtLast5(al)} | PP%: ${as.ppPct ?? '--'} | PK%: ${as.pkPct ?? '--'} | Goals/G: ${as.gf ?? '--'}`);
      contextLines.push(`${homeAbbr} last 5: ${fmtLast5(hl)} | PP%: ${hs.ppPct ?? '--'} | PK%: ${hs.pkPct ?? '--'} | Goals/G: ${hs.gf ?? '--'}`);
      if (g.awayGoalie?.name) contextLines.push(`${awayAbbr} goalie: ${g.awayGoalie.name} (SV% ${g.awayGoalie.svPct ?? '--'}, GAA ${g.awayGoalie.gaa ?? '--'})`);
      if (g.homeGoalie?.name) contextLines.push(`${homeAbbr} goalie: ${g.homeGoalie.name} (SV% ${g.homeGoalie.svPct ?? '--'}, GAA ${g.homeGoalie.gaa ?? '--'})`);
    }

    else if (L === 'MLB') {
      const mlbTeamIds = fa.MLB_TEAM_IDS;
      const awayId = mlbTeamIds[awayAbbr.toUpperCase()];
      const homeId = mlbTeamIds[homeAbbr.toUpperCase()];
      const [awayLog, homeLog, awayStats, homeStats, awayP, homeP, weather] = await Promise.allSettled([
        fa.getMLBTeamLast5(awayAbbr),
        fa.getMLBTeamLast5(homeAbbr),
        fa.getMLBTeamStats(awayAbbr),
        fa.getMLBTeamStats(homeAbbr),
        awayId ? fa.getMLBProbablePitcher(awayId) : Promise.resolve(null),
        homeId ? fa.getMLBProbablePitcher(homeId) : Promise.resolve(null),
        fa.getMLBVenueWeather(homeAbbr),
      ]);
      const al = awayLog.value   || [], hl = homeLog.value   || [];
      const as = awayStats.value || {},  hs = homeStats.value || {};
      const ap = awayP.value,            hp = homeP.value;
      const wx = weather.value;

      const fmtLast5 = (log) => log.slice(0, 5).map(l => l.result).join('-') || 'N/A';
      contextLines.push(`${awayAbbr} last 5: ${fmtLast5(al)} | OPS: ${as.ops ?? '--'} | Team ERA: ${as.era ?? '--'}`);
      contextLines.push(`${homeAbbr} last 5: ${fmtLast5(hl)} | OPS: ${hs.ops ?? '--'} | Team ERA: ${hs.era ?? '--'}`);
      if (ap) contextLines.push(`${awayAbbr} SP: ${ap.name} (${ap.hand === 'L' ? 'LHP' : 'RHP'}, ERA ${ap.era}, WHIP ${ap.whip}, K/9 ${ap.k9})`);
      if (hp) contextLines.push(`${homeAbbr} SP: ${hp.name} (${hp.hand === 'L' ? 'LHP' : 'RHP'}, ERA ${hp.era}, WHIP ${hp.whip}, K/9 ${hp.k9})`);
      if (wx && !wx.indoor && wx.tempF) contextLines.push(`Venue: ${wx.venueName} — ${wx.tempF}°F, wind ${wx.windMph}mph ${wx.windDir}, park HR factor ${wx.parkFactor?.toFixed(2)}`);
      if (wx?.indoor) contextLines.push(`Venue: ${wx.venueName} — retractable roof`);
    }

    // Fetch key injuries
    const [awayInj, homeInj] = await Promise.allSettled([
      fetchESPNInjuries(L, awayAbbr),
      fetchESPNInjuries(L, homeAbbr),
    ]);
    const injLines = [
      ...(awayInj.value || []).slice(0, 2).map(i => `${awayAbbr}: ${i.name} (${i.status})`),
      ...(homeInj.value || []).slice(0, 2).map(i => `${homeAbbr}: ${i.name} (${i.status})`),
    ];
    if (injLines.length) contextLines.push(`Key injuries: ${injLines.join(', ')}`);

    const contextText = contextLines.join('\n');

    const client   = new Anthropic();
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 120,
      system:
        `You are Chalky — the AI behind the Chalk sports betting app. ` +
        `Mysterious, elite, data-driven. Short sharp sentences. Insider confidence. ` +
        `Never says "I think" or "it seems". Never generic. Always specific with real stats or situations.`,
      messages: [{
        role:    'user',
        content:
          `Here is the context for tonight's game:\n${contextText}\n\n` +
          `Give ONE punchy sentence of betting insight that identifies the single most important edge in this game. ` +
          `Be specific with numbers. Reference a real stat or situation. ` +
          `Examples of good Chalky takes:\n` +
          `"Kings are 9-2 ATS at home after a road back-to-back — Charlotte is walking into one."\n` +
          `"Wheeler has a 1.84 ERA in his last 6 starts and faces a lineup batting .198 vs LHP."\n` +
          `"Both goalies are top-5 in SV% this month — fade the over, this one stays under all day."\n\n` +
          `Return only the single sentence. Nothing else.`,
      }],
    });

    const take = (response.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    if (take) chalkySet(cacheKey, take);
    res.json({ take: take || null });
  } catch (e) {
    console.warn('[chalky-take]', e.message);
    res.json({ take: null });
  }
});

module.exports = router;
