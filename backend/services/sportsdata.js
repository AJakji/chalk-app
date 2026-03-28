/**
 * sportsdata.js — SportsData.io primary data client
 * Priority 1 data source for all leagues.
 *
 * All failures are logged and return null — callers must handle gracefully.
 */

const BASE = 'https://api.sportsdata.io/v3';
const mlbStats = require('./mlbStats');

// ── In-memory cache ───────────────────────────────────────────────────────────
const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data, ttlSeconds) {
  _cache.set(key, { data, expires: Date.now() + ttlSeconds * 1000 });
}

// TTL constants (seconds)
const TTL = {
  LIVE:         30,
  PBP:          30,
  BOX_LIVE:     60,
  BOX_FINAL:    86400,
  PLAYER_GAME:  21600,
  TEAM_SEASON:  43200,
  STANDINGS:    43200,
  INJURIES:     3600,
  NEWS:         1800,
  PROJECTIONS:  10800,
};

// ── HTTP helper ───────────────────────────────────────────────────────────────

function apiKey() {
  return process.env.SPORTSDATAIO_API_KEY || '';
}

async function sdFetch(sport, path, ttl) {
  const key = `sd:${sport}:${path}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${BASE}/${sport}/${path}?key=${apiKey()}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SportsData.io ${sport}/${path} → ${res.status}: ${text.slice(0, 120)}`);
  }

  const data = await res.json();
  cacheSet(key, data, ttl);
  return data;
}

// Safe wrapper — returns null on error, logs for monitoring
async function sdSafe(sport, path, ttl) {
  try {
    return await sdFetch(sport, path, ttl);
  } catch (err) {
    console.warn(`[SportsData.io] FAIL ${sport}/${path}: ${err.message}`);
    return null;
  }
}

// ── Team name lookups (SD.io returns abbreviations in game objects) ─────────
const NBA_TEAMS = {
  ATL: 'Atlanta Hawks',   BOS: 'Boston Celtics',    BKN: 'Brooklyn Nets',
  CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls',   CLE: 'Cleveland Cavaliers',
  DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets',   DET: 'Detroit Pistons',
  GS:  'Golden State Warriors', HOU: 'Houston Rockets', IND: 'Indiana Pacers',
  LAC: 'LA Clippers',    LAL: 'LA Lakers',          MEM: 'Memphis Grizzlies',
  MIA: 'Miami Heat',     MIL: 'Milwaukee Bucks',    MIN: 'Minnesota Timberwolves',
  NO:  'New Orleans Pelicans', NY: 'New York Knicks', OKC: 'Oklahoma City Thunder',
  ORL: 'Orlando Magic',  PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns',
  POR: 'Portland Trail Blazers', SAC: 'Sacramento Kings', SA: 'San Antonio Spurs',
  TOR: 'Toronto Raptors', UTA: 'Utah Jazz',         WAS: 'Washington Wizards',
};

const NFL_TEAMS = {
  ARI: 'Arizona Cardinals',   ATL: 'Atlanta Falcons',    BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',       CAR: 'Carolina Panthers',  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',  CLE: 'Cleveland Browns',   DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',      DET: 'Detroit Lions',      GB:  'Green Bay Packers',
  HOU: 'Houston Texans',      IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
  KC:  'Kansas City Chiefs',  LV:  'Las Vegas Raiders',  LAC: 'LA Chargers',
  LAR: 'LA Rams',             MIA: 'Miami Dolphins',     MIN: 'Minnesota Vikings',
  NE:  'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets',       PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SF:  'San Francisco 49ers', SEA: 'Seattle Seahawks',   TB:  'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',    WAS: 'Washington Commanders',
};

const NHL_TEAMS = {
  ANA: 'Anaheim Ducks',       ARI: 'Arizona Coyotes',    BOS: 'Boston Bruins',
  BUF: 'Buffalo Sabres',      CGY: 'Calgary Flames',     CAR: 'Carolina Hurricanes',
  CHI: 'Chicago Blackhawks',  COL: 'Colorado Avalanche', CBJ: 'Columbus Blue Jackets',
  DAL: 'Dallas Stars',        DET: 'Detroit Red Wings',  EDM: 'Edmonton Oilers',
  FLA: 'Florida Panthers',    LAK: 'LA Kings',           MIN: 'Minnesota Wild',
  MTL: 'Montreal Canadiens',  NSH: 'Nashville Predators', NJD: 'New Jersey Devils',
  NYI: 'New York Islanders',  NYR: 'New York Rangers',   OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers', PIT: 'Pittsburgh Penguins', SEA: 'Seattle Kraken',
  SJS: 'San Jose Sharks',     STL: 'St. Louis Blues',    TBL: 'Tampa Bay Lightning',
  TOR: 'Toronto Maple Leafs', VAN: 'Vancouver Canucks',  VGK: 'Vegas Golden Knights',
  WPG: 'Winnipeg Jets',       WSH: 'Washington Capitals',
};

const MLB_TEAMS = {
  ARI: 'Arizona Diamondbacks', ATL: 'Atlanta Braves',    BAL: 'Baltimore Orioles',
  BOS: 'Boston Red Sox',       CHC: 'Chicago Cubs',      CWS: 'Chicago White Sox',
  CIN: 'Cincinnati Reds',      CLE: 'Cleveland Guardians', COL: 'Colorado Rockies',
  DET: 'Detroit Tigers',       HOU: 'Houston Astros',    KC:  'Kansas City Royals',
  LAA: 'LA Angels',            LAD: 'LA Dodgers',        MIA: 'Miami Marlins',
  MIL: 'Milwaukee Brewers',    MIN: 'Minnesota Twins',   NYM: 'New York Mets',
  NYY: 'New York Yankees',     OAK: 'Oakland Athletics', PHI: 'Philadelphia Phillies',
  PIT: 'Pittsburgh Pirates',   SD:  'San Diego Padres',  SF:  'San Francisco Giants',
  SEA: 'Seattle Mariners',     STL: 'St. Louis Cardinals', TB: 'Tampa Bay Rays',
  TEX: 'Texas Rangers',        TOR: 'Toronto Blue Jays', WAS: 'Washington Nationals',
};

function teamName(league, abbr) {
  if (!abbr) return '';
  const maps = { NBA: NBA_TEAMS, NFL: NFL_TEAMS, NHL: NHL_TEAMS, MLB: MLB_TEAMS };
  return (maps[league] || {})[abbr] || abbr;
}

// ── Status mapper ─────────────────────────────────────────────────────────────
function mapStatus(sdStatus) {
  if (!sdStatus) return 'upcoming';
  const s = sdStatus.toLowerCase();
  if (s === 'inprogress' || s === 'halftime' || s === 'intermission') return 'live';
  if (s === 'final' || s === 'f/ot' || s === 'f/so' || s === 'f/shootout') return 'final';
  return 'upcoming';
}

function formatClock(g, periodLabel = 'Q') {
  const status = (g.Status || '').toLowerCase();
  if (status === 'inprogress') {
    const period = g.Quarter || g.Period || g.Inning || '';
    const min = g.TimeRemainingMinutes;
    const sec = g.TimeRemainingSeconds;
    if (period && min != null) {
      return `${periodLabel}${period} ${min}:${String(sec || 0).padStart(2, '0')}`;
    }
    return period ? `${periodLabel}${period}` : 'Live';
  }
  if (status === 'halftime') return 'Halftime';
  if (status === 'intermission') return 'Intermission';
  if (status === 'final') return 'Final';
  if (status === 'f/ot') return 'F/OT';
  if (status === 'f/so' || status === 'f/shootout') return 'F/SO';
  // Upcoming — format tip-off time
  if (g.DateTime) {
    try {
      const d = new Date(g.DateTime);
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
      }) + ' ET';
    } catch { return ''; }
  }
  return '';
}

// ── Game format mappers ───────────────────────────────────────────────────────

function mapNBAGame(g, chalkPick = null) {
  const status = mapStatus(g.Status);
  return {
    id:        String(g.GameID),
    sdGameId:  g.GameID,
    league:    'NBA',
    status,
    clock:     formatClock(g, 'Q'),
    awayTeam:  { name: teamName('NBA', g.AwayTeam), abbr: g.AwayTeam, score: status !== 'upcoming' ? g.AwayTeamScore : null },
    homeTeam:  { name: teamName('NBA', g.HomeTeam), abbr: g.HomeTeam, score: status !== 'upcoming' ? g.HomeTeamScore : null },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

function mapNFLGame(g, chalkPick = null) {
  const status = mapStatus(g.Status);
  return {
    id:        String(g.ScoreID || g.GameID),
    sdGameId:  g.ScoreID || g.GameID,
    league:    'NFL',
    status,
    clock:     formatClock({ ...g, Quarter: g.Quarter }, 'Q'),
    awayTeam:  { name: teamName('NFL', g.AwayTeam), abbr: g.AwayTeam, score: status !== 'upcoming' ? g.AwayScore : null },
    homeTeam:  { name: teamName('NFL', g.HomeTeam), abbr: g.HomeTeam, score: status !== 'upcoming' ? g.HomeScore : null },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

function mapNHLGame(g, chalkPick = null) {
  const status = mapStatus(g.Status);
  return {
    id:        String(g.GameID),
    sdGameId:  g.GameID,
    league:    'NHL',
    status,
    clock:     formatClock({ ...g, Quarter: g.Period }, 'P'),
    awayTeam:  { name: teamName('NHL', g.AwayTeam), abbr: g.AwayTeam, score: status !== 'upcoming' ? g.AwayTeamScore : null },
    homeTeam:  { name: teamName('NHL', g.HomeTeam), abbr: g.HomeTeam, score: status !== 'upcoming' ? g.HomeTeamScore : null },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

function mapMLBGame(g, chalkPick = null) {
  const status = mapStatus(g.Status);
  return {
    id:        String(g.GameID),
    sdGameId:  g.GameID,
    league:    'MLB',
    status,
    clock:     formatClock({ ...g, Quarter: g.Inning, TimeRemainingMinutes: null }, 'Inn'),
    awayTeam:  { name: teamName('MLB', g.AwayTeam), abbr: g.AwayTeam, score: status !== 'upcoming' ? g.AwayTeamRuns : null },
    homeTeam:  { name: teamName('MLB', g.HomeTeam), abbr: g.HomeTeam, score: status !== 'upcoming' ? g.HomeTeamRuns : null },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

function mapSoccerGame(g, chalkPick = null) {
  const status = mapStatus(g.Status);
  return {
    id:        String(g.GameId || g.GameID),
    sdGameId:  g.GameId || g.GameID,
    league:    'Soccer',
    status,
    clock:     formatClock({ ...g, Quarter: null, DateTime: g.DateTime }, ''),
    awayTeam:  {
      name:  g.AwayTeamName || (g.AwayTeam || ''),
      abbr:  (g.AwayTeam || '').substring(0, 3).toUpperCase(),
      score: status !== 'upcoming' ? g.AwayTeamScore : null,
    },
    homeTeam:  {
      name:  g.HomeTeamName || (g.HomeTeam || ''),
      abbr:  (g.HomeTeam || '').substring(0, 3).toUpperCase(),
      score: status !== 'upcoming' ? g.HomeTeamScore : null,
    },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

// ── NBA endpoints ─────────────────────────────────────────────────────────────
const nbaGamesByDate          = (date)         => sdSafe('nba', `scores/json/GamesByDate/${date}`,                    TTL.LIVE);
const nbaGames                = (season)       => sdSafe('nba', `scores/json/Games/${season}`,                        TTL.TEAM_SEASON);
const nbaLiveGameStatsByDate  = (date)         => sdSafe('nba', `scores/json/LiveGameStatsByDate/${date}`,             TTL.LIVE);
const nbaPlayByPlay           = (gameId)       => sdSafe('nba', `scores/json/PlayByPlay/${gameId}`,                   TTL.PBP);
const nbaBoxScore             = (gameId)       => sdSafe('nba', `scores/json/BoxScore/${gameId}`,                     TTL.BOX_LIVE);
const nbaStandings            = (season)       => sdSafe('nba', `scores/json/Standings/${season}`,                    TTL.STANDINGS);
const nbaTeamSeasonStats      = (season)       => sdSafe('nba', `scores/json/TeamSeasonStats/${season}`,              TTL.TEAM_SEASON);
const nbaNews                 = ()             => sdSafe('nba', 'scores/json/News',                                    TTL.NEWS);
const nbaInjuries             = ()             => sdSafe('nba', 'scores/json/InjuredPlayers',                          TTL.INJURIES);
const nbaPlayerGameStats      = (date)         => sdSafe('nba', `stats/json/PlayerGameStatsByDate/${date}`,            TTL.PLAYER_GAME);
const nbaTeamGameStats        = (date)         => sdSafe('nba', `stats/json/TeamGameStatsByDate/${date}`,              TTL.PLAYER_GAME);
const nbaPlayerSeasonStats    = (season)       => sdSafe('nba', `stats/json/PlayerSeasonStats/${season}`,             TTL.TEAM_SEASON);
const nbaPlayerProjections    = (date)         => sdSafe('nba', `projections/json/PlayerGameProjectionStatsByDate/${date}`, TTL.PROJECTIONS);

// ── NFL endpoints ─────────────────────────────────────────────────────────────
const nflScoresByDate         = (date)         => sdSafe('nfl', `scores/json/ScoresByDate/${date}`,                   TTL.LIVE);
const nflScoresByWeek         = (season, week) => sdSafe('nfl', `scores/json/ScoresByWeek/${season}/${week}`,         TTL.LIVE);
const nflPlayByPlay           = (scoreId)      => sdSafe('nfl', `scores/json/PlayByPlay/${scoreId}`,                  TTL.PBP);
const nflBoxScore             = (scoreId)      => sdSafe('nfl', `scores/json/BoxScore/${scoreId}`,                    TTL.BOX_LIVE);
const nflStandings            = (season)       => sdSafe('nfl', `scores/json/Standings/${season}`,                    TTL.STANDINGS);
const nflNews                 = ()             => sdSafe('nfl', 'scores/json/News',                                    TTL.NEWS);
const nflInjuries             = ()             => sdSafe('nfl', 'scores/json/InjuredPlayers',                          TTL.INJURIES);
const nflPlayerGameStats      = (season, week) => sdSafe('nfl', `stats/json/PlayerGameStatsByWeek/${season}/${week}`, TTL.PLAYER_GAME);
const nflTeamGameStats        = (season, week) => sdSafe('nfl', `stats/json/TeamGameStats/${season}/${week}`,         TTL.PLAYER_GAME);
const nflPlayerSeasonStats    = (season)       => sdSafe('nfl', `stats/json/PlayerSeasonStats/${season}`,             TTL.TEAM_SEASON);
const nflTeamSeasonStats      = (season)       => sdSafe('nfl', `stats/json/TeamSeasonStats/${season}`,               TTL.TEAM_SEASON);
const nflPlayerProjections    = (season, week) => sdSafe('nfl', `projections/json/PlayerGameProjectionStatsByWeek/${season}/${week}`, TTL.PROJECTIONS);

// ── NHL endpoints ─────────────────────────────────────────────────────────────
const nhlGamesByDate          = (date)         => sdSafe('nhl', `scores/json/GamesByDate/${date}`,                    TTL.LIVE);
const nhlGames                = (season)       => sdSafe('nhl', `scores/json/Games/${season}`,                        TTL.TEAM_SEASON);
const nhlLiveGameStatsByDate  = (date)         => sdSafe('nhl', `scores/json/LiveGameStatsByDate/${date}`,             TTL.LIVE);
const nhlPlayByPlay           = (gameId)       => sdSafe('nhl', `scores/json/PlayByPlay/${gameId}`,                   TTL.PBP);
const nhlBoxScore             = (gameId)       => sdSafe('nhl', `scores/json/BoxScore/${gameId}`,                     TTL.BOX_LIVE);
const nhlStandings            = (season)       => sdSafe('nhl', `scores/json/Standings/${season}`,                    TTL.STANDINGS);
const nhlNews                 = ()             => sdSafe('nhl', 'scores/json/News',                                    TTL.NEWS);
const nhlInjuries             = ()             => sdSafe('nhl', 'scores/json/InjuredPlayers',                          TTL.INJURIES);
const nhlPlayerGameStats      = (date)         => sdSafe('nhl', `stats/json/PlayerGameStatsByDate/${date}`,            TTL.PLAYER_GAME);
const nhlTeamGameStats        = (date)         => sdSafe('nhl', `stats/json/TeamGameStatsByDate/${date}`,              TTL.PLAYER_GAME);
const nhlPlayerSeasonStats    = (season)       => sdSafe('nhl', `stats/json/PlayerSeasonStats/${season}`,             TTL.TEAM_SEASON);
const nhlTeamSeasonStats      = (season)       => sdSafe('nhl', `stats/json/TeamSeasonStats/${season}`,               TTL.TEAM_SEASON);
const nhlPlayerProjections    = (date)         => sdSafe('nhl', `projections/json/PlayerGameProjectionStatsByDate/${date}`, TTL.PROJECTIONS);

// ── MLB endpoints ─────────────────────────────────────────────────────────────
const mlbLiveGameStatsByDate  = (date)         => sdSafe('mlb', `scores/json/LiveGameStatsByDate/${date}`,     TTL.LIVE);
const mlbGames                = (season)       => sdSafe('mlb', `scores/json/Games/${season}`,                        TTL.TEAM_SEASON);
const mlbGamesByDate          = (date)         => sdSafe('mlb', `scores/json/GamesByDate/${date}`,                    TTL.LIVE);
const mlbPlayByPlay           = (gameId)       => sdSafe('mlb', `scores/json/PlayByPlay/${gameId}`,                   TTL.PBP);
const mlbBoxScore             = (gameId)       => sdSafe('mlb', `scores/json/BoxScore/${gameId}`,                     TTL.BOX_LIVE);
const mlbStandings            = (season)       => sdSafe('mlb', `scores/json/Standings/${season}`,                    TTL.STANDINGS);
const mlbNews                 = ()             => sdSafe('mlb', 'scores/json/News',                                    TTL.NEWS);
const mlbInjuries             = ()             => sdSafe('mlb', 'scores/json/InjuredPlayers',                          TTL.INJURIES);
const mlbPlayerGameStats      = (date)         => sdSafe('mlb', `stats/json/PlayerGameStatsByDate/${date}`,            TTL.PLAYER_GAME);
const mlbTeamGameStats        = (date)         => sdSafe('mlb', `stats/json/TeamGameStatsByDate/${date}`,              TTL.PLAYER_GAME);
const mlbPlayerSeasonStats    = (season)       => sdSafe('mlb', `stats/json/PlayerSeasonStats/${season}`,             TTL.TEAM_SEASON);
const mlbTeamSeasonStats      = (season)       => sdSafe('mlb', `stats/json/TeamSeasonStats/${season}`,               TTL.TEAM_SEASON);
const mlbPlayerProjections    = (date)         => sdSafe('mlb', `projections/json/PlayerGameProjectionStatsByDate/${date}`, TTL.PROJECTIONS);

// ── Soccer endpoints ──────────────────────────────────────────────────────────
function soccerComp() { return process.env.SOCCER_COMPETITION || 'FIFA-WORLD-CUP'; }
function soccerSeason() { return process.env.SOCCER_SEASON || '2026'; }

const soccerGamesByDate       = (date)         => sdSafe('soccer', `scores/json/GamesByDate/${soccerComp()}/${date}`,                   TTL.LIVE);
const soccerGames             = ()             => sdSafe('soccer', `scores/json/Games/${soccerComp()}/${soccerSeason()}`,                TTL.TEAM_SEASON);
const soccerLiveStats         = (date)         => sdSafe('soccer', `scores/json/LiveGameStatsByDate/${soccerComp()}/${date}`,            TTL.LIVE);
const soccerPlayByPlay        = (gameId)       => sdSafe('soccer', `scores/json/PlayByPlay/${soccerComp()}/${gameId}`,                   TTL.PBP);
const soccerBoxScore          = (gameId)       => sdSafe('soccer', `scores/json/BoxScore/${soccerComp()}/${gameId}`,                     TTL.BOX_LIVE);
const soccerStandings         = ()             => sdSafe('soccer', `scores/json/Standings/${soccerComp()}/${soccerSeason()}`,            TTL.STANDINGS);
const soccerNews              = ()             => sdSafe('soccer', `scores/json/News/${soccerComp()}`,                                   TTL.NEWS);
const soccerPlayerGameStats   = (date)         => sdSafe('soccer', `stats/json/PlayerGameStatsByDate/${soccerComp()}/${date}`,           TTL.PLAYER_GAME);
const soccerTeamGameStats     = (date)         => sdSafe('soccer', `stats/json/TeamGameStatsByDate/${soccerComp()}/${date}`,             TTL.PLAYER_GAME);
const soccerPlayerSeasonStats = ()             => sdSafe('soccer', `stats/json/PlayerSeasonStats/${soccerComp()}/${soccerSeason()}`,     TTL.TEAM_SEASON);
const soccerTeamSeasonStats   = ()             => sdSafe('soccer', `stats/json/TeamSeasonStats/${soccerComp()}/${soccerSeason()}`,       TTL.TEAM_SEASON);

// ── MLB Stats API helpers (free, no subscription required) ───────────────────

function isoToMLBDate(isoDate) {
  const [y, m, d] = (isoDate || '').split('-');
  return `${m}/${d}/${y}`;
}

function mapMLBStatsStatus(detailedState) {
  const s = (detailedState || '').toLowerCase();
  if (s.includes('in progress') || s.includes('warmup') || s.includes('delayed: start') || s.includes('manager challenge')) return 'live';
  if (s.includes('final') || s.includes('game over') || s.includes('completed') || s.includes('postponed')) return 'final';
  return 'upcoming';
}

function mapMLBStatsGame(g, chalkPick = null) {
  const status   = mapMLBStatsStatus(g.status?.detailedState || '');
  const awayAbbr = g.teams?.away?.team?.abbreviation || '';
  const homeAbbr = g.teams?.home?.team?.abbreviation || '';
  const awayName = g.teams?.away?.team?.name || teamName('MLB', awayAbbr);
  const homeName = g.teams?.home?.team?.name || teamName('MLB', homeAbbr);
  const awayScore = status !== 'upcoming' ? (g.teams?.away?.score ?? null) : null;
  const homeScore = status !== 'upcoming' ? (g.teams?.home?.score ?? null) : null;

  const ls       = g.linescore || {};
  const inning   = ls.currentInning || null;
  const half     = ls.inningHalf;
  const clock    = inning ? `${half === 'Bottom' ? '▼' : '▲'} ${inning}` : '';

  return {
    id:         String(g.gamePk),
    sdGameId:   g.gamePk,
    league:     'MLB',
    status,
    clock,
    awayTeam:   { name: awayName, abbr: awayAbbr, score: awayScore },
    homeTeam:   { name: homeName, abbr: homeAbbr, score: homeScore },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

function mapMLBStatsBoxScore(boxData, linescoreData) {
  if (!boxData) return null;

  const awayTeam = boxData.teams?.away;
  const homeTeam = boxData.teams?.home;
  const ls       = linescoreData || {};

  const liveState = {
    inning:         ls.currentInning || null,
    inningHalf:     ls.inningHalf === 'Bottom' ? 'B' : (ls.inningHalf === 'Top' ? 'T' : null),
    balls:          ls.balls    ?? null,
    strikes:        ls.strikes  ?? null,
    outs:           ls.outs     ?? null,
    firstBase:      !!(ls.offense?.first),
    secondBase:     !!(ls.offense?.second),
    thirdBase:      !!(ls.offense?.third),
    currentPitcher: ls.defense?.pitcher?.fullName || '',
    currentHitter:  ls.offense?.batter?.fullName  || '',
    awayScore:      ls.teams?.away?.runs ?? null,
    homeScore:      ls.teams?.home?.runs ?? null,
  };

  const innings = (ls.innings || []).map(inn => ({
    number: inn.num,
    away:   inn.away?.runs ?? null,
    home:   inn.home?.runs ?? null,
  }));

  const awayRHE = { r: ls.teams?.away?.runs ?? null, h: ls.teams?.away?.hits ?? null, e: ls.teams?.away?.errors ?? null };
  const homeRHE = { r: ls.teams?.home?.runs ?? null, h: ls.teams?.home?.hits ?? null, e: ls.teams?.home?.errors ?? null };

  const mapBattersFromTeam = (teamData) => {
    const players      = teamData?.players || {};
    const battingOrder = teamData?.battingOrder || [];
    return battingOrder.map((id, idx) => {
      const p = players[`ID${id}`];
      if (!p) return null;
      const s = p.stats?.batting || {};
      return {
        name:  p.person?.fullName || '',
        pos:   p.allPositions?.map(x => x.abbreviation).join('-') || p.position?.abbreviation || '--',
        order: idx + 1,
        ab:    s.atBats       || 0,
        r:     s.runs         || 0,
        h:     s.hits         || 0,
        rbi:   s.rbi          || 0,
        bb:    s.baseOnBalls  || 0,
        so:    s.strikeOuts   || 0,
        avg:   s.avg          || '--',
        hr:    s.homeRuns     || 0,
        sb:    s.stolenBases  || 0,
      };
    }).filter(Boolean);
  };

  const mapPitchersFromTeam = (teamData) => {
    const players  = teamData?.players || {};
    const pitchers = teamData?.pitchers || [];
    return pitchers.map((id, idx) => {
      const p = players[`ID${id}`];
      if (!p) return null;
      const s = p.stats?.pitching || {};
      return {
        name:      p.person?.fullName || '',
        pos:       idx === 0 ? 'SP' : 'RP',
        isStarter: idx === 0,
        ip:        s.inningsPitched  || '0.0',
        h:         s.hits            || 0,
        r:         s.runs            || 0,
        er:        s.earnedRuns      || 0,
        bb:        s.baseOnBalls     || 0,
        so:        s.strikeOuts      || 0,
        era:       s.era             || '--',
        pitches:   s.numberOfPitches || 0,
        strikes:   s.strikes         || 0,
        decision:  '',
        isCurrent: false,
      };
    }).filter(Boolean);
  };

  const battingTotals = (batters) => {
    const ab  = batters.reduce((s, p) => s + p.ab, 0);
    const h   = batters.reduce((s, p) => s + p.h,  0);
    const r   = batters.reduce((s, p) => s + p.r,  0);
    const rbi = batters.reduce((s, p) => s + p.rbi, 0);
    const bb  = batters.reduce((s, p) => s + p.bb,  0);
    const so  = batters.reduce((s, p) => s + p.so,  0);
    return { ab, h, r, rbi, bb, so, avg: ab > 0 ? (h / ab).toFixed(3) : '.000' };
  };

  const awayBatters  = mapBattersFromTeam(awayTeam);
  const homeBatters  = mapBattersFromTeam(homeTeam);
  const awayPitchers = mapPitchersFromTeam(awayTeam);
  const homePitchers = mapPitchersFromTeam(homeTeam);
  const officials    = (boxData.officials || []).map(o => o.official?.fullName || '').filter(Boolean);

  return {
    league:    'MLB',
    arena:     '',
    arenaCity: '',
    officials,
    weather:   null,
    liveState,
    innings,
    awayRHE,
    homeRHE,
    away: { batters: awayBatters, pitchers: awayPitchers, totals: battingTotals(awayBatters) },
    home: { batters: homeBatters, pitchers: homePitchers, totals: battingTotals(homeBatters) },
    quarters: { away: innings.map(i => i.away), home: innings.map(i => i.home) },
  };
}

function mapMLBStatsPBP(pbpData) {
  if (!pbpData) return [];
  const allPlays = pbpData.allPlays || [];
  const plays = allPlays.map(play => {
    const result  = play.result  || {};
    const about   = play.about   || {};
    const matchup = play.matchup || {};
    const half    = about.halfInning === 'bottom' ? 'B' : 'T';
    const inning  = about.inning || 0;
    return {
      time:       `${half === 'T' ? '▲' : '▼'} ${inning}`,
      event:      result.description || '',
      quarter:    inning,
      inningHalf: half,
      type:       classifyMLBPlay(result.description),
      teamAbbr:   null,
      rbi:        result.rbi  || 0,
      runs:       (result.homeScore || 0) + (result.awayScore || 0),
      outs:       play.count?.outs || 0,
      isScoring:  (result.rbi || 0) > 0,
      awayScore:  result.awayScore ?? null,
      homeScore:  result.homeScore ?? null,
      hitter:     matchup.batter?.fullName  || '',
      pitcher:    matchup.pitcher?.fullName || '',
    };
  });
  return plays.reverse().slice(0, 100);
}

// ── Composite: all games for a date ──────────────────────────────────────────

async function getScoresForDate(date, chalkPickMatcher) {
  const match = chalkPickMatcher || (() => null);

  const [nbaDone, nhlDone, mlbStatsDone, soccerDone] = await Promise.allSettled([
    nbaGamesByDate(date),
    nhlGamesByDate(date),
    mlbStats.getSchedule(isoToMLBDate(date)),
    soccerGamesByDate(date),
  ]);

  const results = [];

  if (nbaDone.status === 'fulfilled' && Array.isArray(nbaDone.value)) {
    for (const g of nbaDone.value) {
      const away = teamName('NBA', g.AwayTeam);
      const home = teamName('NBA', g.HomeTeam);
      results.push(mapNBAGame(g, match(away, home)));
    }
  }
  if (nhlDone.status === 'fulfilled' && Array.isArray(nhlDone.value)) {
    for (const g of nhlDone.value) {
      const away = teamName('NHL', g.AwayTeam);
      const home = teamName('NHL', g.HomeTeam);
      results.push(mapNHLGame(g, match(away, home)));
    }
  }
  if (mlbStatsDone.status === 'fulfilled' && Array.isArray(mlbStatsDone.value)) {
    for (const g of mlbStatsDone.value) {
      const away = g.teams?.away?.team?.name || '';
      const home = g.teams?.home?.team?.name || '';
      results.push(mapMLBStatsGame(g, match(away, home)));
    }
  }
  if (soccerDone.status === 'fulfilled' && Array.isArray(soccerDone.value)) {
    for (const g of soccerDone.value) {
      results.push(mapSoccerGame(g, match(g.AwayTeamName || g.AwayTeam, g.HomeTeamName || g.HomeTeam)));
    }
  }

  return results.sort((a, b) => {
    const order = { live: 0, upcoming: 1, final: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });
}

// ── Context builder for Picks Engine + Research ───────────────────────────────

async function buildPicksContext(league, homeTeamAbbr, awayTeamAbbr, date) {
  const today = date || new Date().toISOString().split('T')[0];
  const season = process.env.CURRENT_SEASON || '2025';
  const parts = [];

  try {
    const L = (league || '').toUpperCase();

    if (L === 'NBA') {
      const [teamStats, injuries, projections] = await Promise.allSettled([
        nbaTeamSeasonStats(season),
        nbaInjuries(),
        nbaPlayerProjections(today),
      ]);
      if (teamStats.status === 'fulfilled' && Array.isArray(teamStats.value)) {
        const rel = teamStats.value.filter(t => t.Team === homeTeamAbbr || t.Team === awayTeamAbbr);
        if (rel.length) parts.push(`NBA TEAM SEASON STATS:\n${JSON.stringify(rel, null, 2)}`);
      }
      if (injuries.status === 'fulfilled' && Array.isArray(injuries.value) && injuries.value.length) {
        const rel = injuries.value.filter(p => p.Team === homeTeamAbbr || p.Team === awayTeamAbbr);
        if (rel.length) parts.push(`NBA INJURIES:\n${JSON.stringify(rel, null, 2)}`);
      }
      if (projections.status === 'fulfilled' && Array.isArray(projections.value)) {
        const rel = projections.value.filter(p => p.Team === homeTeamAbbr || p.Team === awayTeamAbbr);
        if (rel.length) parts.push(`NBA PLAYER PROJECTIONS:\n${JSON.stringify(rel.slice(0, 24), null, 2)}`);
      }
    }

    if (L === 'NFL') {
      const [teamStats, injuries] = await Promise.allSettled([nflTeamSeasonStats(season), nflInjuries()]);
      if (teamStats.status === 'fulfilled' && Array.isArray(teamStats.value)) {
        const rel = teamStats.value.filter(t => t.Team === homeTeamAbbr || t.Team === awayTeamAbbr);
        if (rel.length) parts.push(`NFL TEAM SEASON STATS:\n${JSON.stringify(rel, null, 2)}`);
      }
      if (injuries.status === 'fulfilled' && Array.isArray(injuries.value) && injuries.value.length) {
        const rel = injuries.value.filter(p => p.Team === homeTeamAbbr || p.Team === awayTeamAbbr);
        if (rel.length) parts.push(`NFL INJURIES:\n${JSON.stringify(rel.slice(0, 20), null, 2)}`);
      }
    }

    if (L === 'NHL') {
      const [teamStats, injuries] = await Promise.allSettled([nhlTeamSeasonStats(season), nhlInjuries()]);
      if (teamStats.status === 'fulfilled' && Array.isArray(teamStats.value)) {
        const rel = teamStats.value.filter(t => t.Team === homeTeamAbbr || t.Team === awayTeamAbbr);
        if (rel.length) parts.push(`NHL TEAM SEASON STATS:\n${JSON.stringify(rel, null, 2)}`);
      }
      if (injuries.status === 'fulfilled' && Array.isArray(injuries.value) && injuries.value.length) {
        const rel = injuries.value.filter(p => p.Team === homeTeamAbbr || p.Team === awayTeamAbbr);
        if (rel.length) parts.push(`NHL INJURIES:\n${JSON.stringify(rel.slice(0, 15), null, 2)}`);
      }
    }

    if (L === 'MLB') {
      const [teamStats, injuries] = await Promise.allSettled([mlbTeamSeasonStats(season), mlbInjuries()]);
      if (teamStats.status === 'fulfilled' && Array.isArray(teamStats.value)) {
        const rel = teamStats.value.filter(t => t.Team === homeTeamAbbr || t.Team === awayTeamAbbr);
        if (rel.length) parts.push(`MLB TEAM SEASON STATS:\n${JSON.stringify(rel, null, 2)}`);
      }
      if (injuries.status === 'fulfilled' && Array.isArray(injuries.value) && injuries.value.length) {
        const rel = injuries.value.filter(p => p.Team === homeTeamAbbr || p.Team === awayTeamAbbr);
        if (rel.length) parts.push(`MLB INJURIES:\n${JSON.stringify(rel.slice(0, 15), null, 2)}`);
      }
    }
  } catch (err) {
    console.warn(`[SportsData.io] buildPicksContext error: ${err.message}`);
  }

  return parts.join('\n\n---\n\n');
}

// ── Box score mappers for GameDetailModal ─────────────────────────────────────

function mapNBABoxScore(data) {
  if (!data || !data.PlayerGames) return null;

  const awayAbbr = data.Game?.AwayTeam;
  const homeAbbr = data.Game?.HomeTeam;

  // Quarter line score — include OT periods
  const allQuarters = (data.Quarters || []);
  const regularQ = allQuarters.filter(q => q.QuarterNumber <= 4).slice(0, 4);
  const otQ      = allQuarters.filter(q => q.QuarterNumber > 4);

  // Arena / officials meta
  const game    = data.Game || {};
  const stadium = data.Stadium || game.StadiumDetails || {};
  const arena      = stadium.Name || game.Arena || game.StadiumName || '';
  const arenaCity  = stadium.City
    ? `${stadium.City}${stadium.State ? ', ' + stadium.State : ''}`
    : (game.City || '');
  const officials = (data.Officials || data.Referees || [])
    .map(o => o.Name || [o.FirstName, o.LastName].filter(Boolean).join(' '))
    .filter(Boolean);

  const mapPlayer = (p) => {
    const fgm = p.FieldGoalsMade || 0;
    const fga = p.FieldGoalsAttempted || 0;
    const tpm = p.ThreePointersMade || 0;
    const tpa = p.ThreePointersAttempted || 0;
    return {
      name: p.Name,
      pos:  p.Position || '--',
      min:  p.Minutes  || '0:00',
      pts:  p.Points   || 0,
      reb:  p.Rebounds || 0,
      ast:  p.Assists  || 0,
      stl:  p.Steals   || 0,
      blk:  p.BlockedShots || 0,
      fg:   `${fgm}-${fga}`,
      threeP: `${tpm}-${tpa}`,
      tov:  p.Turnovers || 0,
      pm:   Math.round(p.PlusMinus || 0),
    };
  };

  const awayPlayers = data.PlayerGames.filter(p => p.Team === awayAbbr)
    .sort((a, b) => (b.Points || 0) - (a.Points || 0))
    .map(mapPlayer);
  const homePlayers = data.PlayerGames.filter(p => p.Team === homeAbbr)
    .sort((a, b) => (b.Points || 0) - (a.Points || 0))
    .map(mapPlayer);

  const teamTotals = (players) => {
    const fgm = players.reduce((s, p) => s + parseInt(p.fg.split('-')[0]||0), 0);
    const fga = players.reduce((s, p) => s + parseInt(p.fg.split('-')[1]||0), 0);
    const tpm = players.reduce((s, p) => s + parseInt(p.threeP.split('-')[0]||0), 0);
    const tpa = players.reduce((s, p) => s + parseInt(p.threeP.split('-')[1]||0), 0);
    const reb = players.reduce((s, p) => s + p.reb, 0);
    const ast = players.reduce((s, p) => s + p.ast, 0);
    const tov = players.reduce((s, p) => s + p.tov, 0);
    return {
      fg:      `${fgm}-${fga}`,
      fgPct:   fga > 0 ? Math.round((fgm / fga) * 100) : 0,
      threeP:  `${tpm}-${tpa}`,
      threePct: tpa > 0 ? Math.round((tpm / tpa) * 100) : 0,
      reb, ast, tov,
    };
  };

  const awayStats = teamTotals(awayPlayers);
  const homeStats = teamTotals(homePlayers);

  return {
    arena, arenaCity, officials,
    quarters: {
      away: [...regularQ.map(q => q.AwayScore), ...otQ.map(q => q.AwayScore)],
      home: [...regularQ.map(q => q.HomeScore), ...otQ.map(q => q.HomeScore)],
      hasOT: otQ.length > 0,
    },
    awayStats,
    homeStats,
    away: { players: awayPlayers, totals: awayStats },
    home: { players: homePlayers, totals: homeStats },
  };
}

// Extract arena/officials from any league's raw box score data
function extractGameMeta(data) {
  if (!data) return {};
  const game    = data.Game || {};
  const stadium = data.Stadium || game.StadiumDetails || {};
  const arena     = stadium.Name || game.Arena || game.StadiumName || '';
  const arenaCity = stadium.City
    ? `${stadium.City}${stadium.State ? ', ' + stadium.State : ''}`
    : (game.City || '');
  const officials = (data.Officials || data.Referees || [])
    .map(o => o.Name || [o.FirstName, o.LastName].filter(Boolean).join(' '))
    .filter(Boolean);
  return { arena, arenaCity, officials };
}

function mapNHLBoxScore(data) {
  if (!data || !data.PlayerGames) return null;

  const awayAbbr = data.Game?.AwayTeam;
  const homeAbbr = data.Game?.HomeTeam;
  const game     = data.Game || {};

  // Arena / officials
  const arena     = game.StadiumName || '';
  const arenaCity = game.StadiumCity ? `${game.StadiumCity}${game.StadiumState ? ', ' + game.StadiumState : ''}` : '';
  const officials = (data.Officials || data.Referees || [])
    .map(o => o.Name || [o.FirstName, o.LastName].filter(Boolean).join(' '))
    .filter(Boolean);

  // Period scores — includes OT (period 4) and SO (period 5)
  const allPeriods = (data.Periods || []);
  const periods = allPeriods.map(p => ({
    number: p.PeriodNumber,
    label:  p.PeriodNumber <= 3 ? `P${p.PeriodNumber}` : p.PeriodNumber === 4 ? 'OT' : 'SO',
    away:   p.AwayScore,
    home:   p.HomeScore,
  }));

  // Team-level stats (ShotsOnGoal, PP, PIM, FO%, Hits, Blocked)
  const teamGames   = data.TeamGames || [];
  const awayTG      = teamGames.find(t => t.Team === awayAbbr) || {};
  const homeTG      = teamGames.find(t => t.Team === homeAbbr) || {};

  const fmtPP = (g, o) => `${g || 0}/${o || 0}`;
  const fmtFO = (won, lost) => {
    const total = (won || 0) + (lost || 0);
    return total > 0 ? `${Math.round(((won || 0) / total) * 100)}%` : '--';
  };

  const teamStats = {
    away: {
      sog:     awayTG.ShotsOnGoal           || 0,
      pp:      fmtPP(awayTG.PowerPlayGoals, awayTG.PowerPlayOpportunities),
      pim:     awayTG.PenaltyMinutes        || 0,
      fo:      fmtFO(awayTG.FaceoffsWon,    awayTG.FaceoffsLost),
      hits:    awayTG.Hits                  || 0,
      blocked: awayTG.BlockedShots          || 0,
    },
    home: {
      sog:     homeTG.ShotsOnGoal           || 0,
      pp:      fmtPP(homeTG.PowerPlayGoals, homeTG.PowerPlayOpportunities),
      pim:     homeTG.PenaltyMinutes        || 0,
      fo:      fmtFO(homeTG.FaceoffsWon,    homeTG.FaceoffsLost),
      hits:    homeTG.Hits                  || 0,
      blocked: homeTG.BlockedShots          || 0,
    },
  };

  // Skater rows: sort by PTS desc, then goals
  const mapSkater = (p) => ({
    name:     p.Name,
    pos:      p.Position || '--',
    g:        p.Goals           || 0,
    a:        p.Assists         || 0,
    pts:      (p.Goals || 0) + (p.Assists || 0),
    pm:       p.PlusMinus       || 0,
    pim:      p.PenaltyMinutes  || 0,
    sog:      p.ShotsOnGoal     || p.Shots || 0,
    toi:      p.TimeOnIce       || '--',
    isScorer: (p.Goals || 0) > 0,
  });

  // Goalie rows
  const mapGoalie = (p, idx) => {
    const sv = p.Saves || 0;
    const ga = p.GoalsAgainst || 0;
    const sa = p.ShotsAgainstPerGoalie || p.ShotsAgainst || (sv + ga);
    const svPct = sa > 0 ? (sv / sa).toFixed(3) : (p.SavePercentage != null ? p.SavePercentage.toFixed(3) : '--');
    return {
      name:      p.Name,
      sa,
      sv,
      ga,
      svPct,
      toi:       p.TimeOnIce || '--',
      isStarter: idx === 0,
      decision:  p.GoalieWin ? 'W' : p.GoalieLoss ? 'L' : p.GoalieOvertimeLoss ? 'OTL' : '',
    };
  };

  const awaySkaters = (data.PlayerGames || [])
    .filter(p => p.Team === awayAbbr && p.Position !== 'G')
    .sort((a, b) => ((b.Goals||0)+(b.Assists||0)) - ((a.Goals||0)+(a.Assists||0)))
    .map(mapSkater);

  const homeSkaters = (data.PlayerGames || [])
    .filter(p => p.Team === homeAbbr && p.Position !== 'G')
    .sort((a, b) => ((b.Goals||0)+(b.Assists||0)) - ((a.Goals||0)+(a.Assists||0)))
    .map(mapSkater);

  const awayGoalies = (data.PlayerGames || [])
    .filter(p => p.Team === awayAbbr && p.Position === 'G')
    .map(mapGoalie);

  const homeGoalies = (data.PlayerGames || [])
    .filter(p => p.Team === homeAbbr && p.Position === 'G')
    .map(mapGoalie);

  return {
    league:     'NHL',
    arena,      arenaCity,   officials,
    periods,
    teamStats,
    away: { skaters: awaySkaters, goalies: awayGoalies },
    home: { skaters: homeSkaters, goalies: homeGoalies },
    // backward compat shape for generic LineScore
    quarters: {
      away: periods.map(p => p.away),
      home: periods.map(p => p.home),
    },
  };
}

// Format innings pitched: 6.1 = 6⅓, 6.2 = 6⅔
function formatIP(ip) {
  if (ip == null) return '0.0';
  const whole = Math.floor(ip);
  const frac  = Math.round((ip - whole) * 10); // SD.io uses .1 = 1 out, .2 = 2 outs
  return `${whole}.${frac}`;
}

// Classify a baseball at-bat outcome
function classifyMLBPlay(description) {
  const d = (description || '').toLowerCase();
  if (d.includes('home run') || d.includes('homers') || d.includes('hr ')) return 'hr';
  if (d.includes('triples') || d.includes('triple '))                        return '3b';
  if (d.includes('doubles') || d.includes('double '))                        return '2b';
  if (d.includes('singles') || d.includes('single '))                        return '1b';
  if (d.includes('walks') || d.includes('walk ') || d.includes('base on balls')) return 'bb';
  if (d.includes('strikes out') || d.includes('strikeout') || d.includes(' k ')) return 'k';
  if (d.includes('fly out') || d.includes('flied out') || d.includes('flies out')) return 'flyout';
  if (d.includes('ground') || d.includes('grounds out'))                     return 'groundout';
  if (d.includes('line out') || d.includes('lines out'))                     return 'lineout';
  if (d.includes('sac fly') || d.includes('sacrifice fly'))                  return 'sacfly';
  if (d.includes('sac bunt') || d.includes('sacrifice bunt'))                return 'sac';
  return 'out';
}

function mapMLBBoxScore(data) {
  if (!data || !data.PlayerGames) return null;

  const awayAbbr = data.Game?.AwayTeam;
  const homeAbbr = data.Game?.HomeTeam;
  const game     = data.Game || {};

  // Arena / weather
  const stadium   = data.Stadium || {};
  const arena     = stadium.Name || game.StadiumName || '';
  const arenaCity = stadium.City
    ? `${stadium.City}${stadium.State ? ', ' + stadium.State : ''}`
    : '';
  const umpires  = (data.Umpires || [])
    .map(u => u.Name || [u.FirstName, u.LastName].filter(Boolean).join(' '))
    .filter(Boolean);
  const weather  = (game.TempF != null || game.WindSpeed != null) ? {
    tempF:         game.TempF,
    windSpeed:     game.WindSpeed,
    windDirection: game.WindDirection || '',
    condition:     game.Condition || '',
    humidity:      game.Humidity,
  } : null;

  // Inning line scores (preserve all extras)
  const allInnings = data.Innings || [];
  const innings = allInnings.map(inn => ({
    number: inn.InningNumber,
    away:   inn.AwayScore,
    home:   inn.HomeScore,
  }));

  // R / H / E totals
  const awayRHE = {
    r: game.AwayTeamRuns    ?? null,
    h: game.AwayTeamHits    ?? null,
    e: game.AwayTeamErrors  ?? null,
  };
  const homeRHE = {
    r: game.HomeTeamRuns    ?? null,
    h: game.HomeTeamHits    ?? null,
    e: game.HomeTeamErrors  ?? null,
  };

  // Live at-bat state (populated for in-progress games)
  const liveState = {
    inning:        game.CurrentInning || game.Inning || null,
    inningHalf:    game.InningHalf    || null,
    balls:         game.Balls         ?? null,
    strikes:       game.Strikes       ?? null,
    outs:          game.Outs          ?? null,
    firstBase:     !!(game.ManOnFirst  || game.FirstBase),
    secondBase:    !!(game.ManOnSecond || game.SecondBase),
    thirdBase:     !!(game.ManOnThird  || game.ThirdBase),
    currentPitcher: game.CurrentPitcherName  || game.WinningPitcherName  || '',
    currentHitter:  game.CurrentHitterName   || game.LastPlayDescription  && '' || '',
  };

  // Batting: players with a BattingOrder or AtBats
  const mapBatter = (p) => ({
    name:    p.Name,
    pos:     p.Position || '--',
    order:   p.BattingOrder || 9999,
    ab:      p.AtBats         || 0,
    r:       p.Runs           || 0,
    h:       p.Hits           || 0,
    rbi:     p.RunsBattedIn   || 0,
    bb:      p.BaseOnBalls    || 0,
    so:      p.Strikeouts || p.StrikeOuts || 0,
    avg:     p.BattingAverage != null ? p.BattingAverage.toFixed(3) : '--',
    hr:      p.HomeRuns       || 0,
    sb:      p.StolenBases    || 0,
  });

  const awayBatters = (data.PlayerGames || [])
    .filter(p => p.Team === awayAbbr && (p.BattingOrder != null || (p.AtBats != null && p.InningsPitched == null)))
    .sort((a, b) => (a.BattingOrder || 9999) - (b.BattingOrder || 9999))
    .map(mapBatter);

  const homeBatters = (data.PlayerGames || [])
    .filter(p => p.Team === homeAbbr && (p.BattingOrder != null || (p.AtBats != null && p.InningsPitched == null)))
    .sort((a, b) => (a.BattingOrder || 9999) - (b.BattingOrder || 9999))
    .map(mapBatter);

  // Pitching: players with InningsPitched
  const mapPitcher = (p, idx) => ({
    name:       p.Name,
    pos:        p.Position || (idx === 0 ? 'SP' : 'RP'),
    isStarter:  idx === 0,
    ip:         formatIP(p.InningsPitched),
    h:          p.PitchingHits         || 0,
    r:          p.PitchingRuns   ?? p.Runs ?? 0,
    er:         p.EarnedRuns           || 0,
    bb:         p.PitchingBaseOnBalls  || 0,
    so:         p.PitchingStrikeOuts   || 0,
    era:        p.EarnedRunAverage != null ? p.EarnedRunAverage.toFixed(2) : '--',
    pitches:    p.Pitches              || 0,
    strikes:    p.Strikes              || 0,
    decision:   p.WinLossIndicator     || '',
    isCurrent:  !!(p.WinLossIndicator === '' && p.InningsPitched != null && p.OutsPitched != null),
  });

  // Keep pitchers in appearance order (starters come first from SD.io)
  const awayPitchers = (data.PlayerGames || [])
    .filter(p => p.Team === awayAbbr && p.InningsPitched != null)
    .map(mapPitcher);

  const homePitchers = (data.PlayerGames || [])
    .filter(p => p.Team === homeAbbr && p.InningsPitched != null)
    .map(mapPitcher);

  // Team batting totals
  const battingTotals = (batters) => {
    const ab  = batters.reduce((s, p) => s + p.ab,  0);
    const h   = batters.reduce((s, p) => s + p.h,   0);
    const r   = batters.reduce((s, p) => s + p.r,   0);
    const rbi = batters.reduce((s, p) => s + p.rbi, 0);
    const bb  = batters.reduce((s, p) => s + p.bb,  0);
    const so  = batters.reduce((s, p) => s + p.so,  0);
    return { ab, h, r, rbi, bb, so, avg: ab > 0 ? (h / ab).toFixed(3) : '.000' };
  };

  return {
    league:    'MLB',
    arena,     arenaCity,
    officials: umpires,
    weather,
    liveState,
    innings,
    awayRHE,
    homeRHE,
    away: { batters: awayBatters, pitchers: awayPitchers, totals: battingTotals(awayBatters) },
    home: { batters: homeBatters, pitchers: homePitchers, totals: battingTotals(homeBatters) },
    // keep generic shape for backward compat
    quarters: { away: innings.map(i => i.away), home: innings.map(i => i.home) },
  };
}

function classifyPlay(description, type) {
  const d = (description || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (t.includes('made') || t.includes('makes') || d.includes('makes') || d.includes('free throw') && d.includes('makes')) return 'score';
  if (t.includes('turnover') || d.includes('turnover') || d.includes(' steals ')) return 'turnover';
  if (t.includes('foul') || d.includes(' foul')) return 'foul';
  return 'normal';
}

// Classify NHL play events for colour-coded play-by-play
function classifyNHLPlay(type, description, strength) {
  const t = (type || '').toLowerCase();
  const d = (description || '').toLowerCase();
  const s = (strength || '').toLowerCase();
  if (t === 'goal' || t === 'penaltyshot' || d.includes('scores') || d.includes(' goal')) {
    if (s.includes('power play'))   return 'goal_pp';
    if (s.includes('short hand'))   return 'goal_sh';
    if (s.includes('empty net') || d.includes('empty net') || d.includes('en ')) return 'goal_en';
    return 'goal';
  }
  if (t === 'fighting' || d.includes('fighting') || d.includes('fight '))  return 'fight';
  if (t === 'penalty' || d.includes('penalty') || d.includes('penalized')) return 'penalty';
  if (t === 'goaliechange' || d.includes('pulls goalie') || d.includes('goalie to bench') || d.includes('goalie returns')) return 'goalie_pull';
  if (t === 'shot' || d.includes('shot on goal') || d.includes('on goal')) return 'shot';
  return 'normal';
}

function mapPBP(data, league) {
  if (!data) return [];
  let plays = [];

  if (league === 'NBA') {
    const quarters = data.Quarters || [];
    for (const q of quarters) {
      for (const play of (q.Plays || [])) {
        const mins = String(play.TimeRemainingMinutes || 0);
        const secs = String(play.TimeRemainingSeconds || 0).padStart(2, '0');
        plays.push({
          time:      `Q${q.QuarterNumber} ${mins}:${secs}`,
          event:     play.Description || '',
          quarter:   q.QuarterNumber,
          teamAbbr:  play.Team || null,
          awayScore: play.AwayScore ?? null,
          homeScore: play.HomeScore ?? null,
          type:      classifyPlay(play.Description, play.Type),
        });
      }
    }
  } else if (league === 'NHL') {
    const periods = data.Periods || [];
    for (const p of periods) {
      for (const play of (p.Plays || [])) {
        const mins = String(play.TimeRemainingMinutes || 0);
        const secs = String(play.TimeRemainingSeconds || 0).padStart(2, '0');
        const category = classifyNHLPlay(play.Type, play.Description, play.Strength);
        plays.push({
          time:      `P${p.PeriodNumber} ${mins}:${secs}`,
          event:     play.Description || '',
          quarter:   p.PeriodNumber,
          teamAbbr:  play.Team       || null,
          awayScore: play.AwayScore  ?? null,
          homeScore: play.HomeScore  ?? null,
          strength:  play.Strength   || null,
          category,
        });
      }
    }
  } else if (league === 'NFL') {
    for (const play of (data.Plays || [])) {
      const mins = String(play.TimeRemainingMinutes || 0);
      const secs = String(play.TimeRemainingSeconds || 0).padStart(2, '0');
      plays.push({
        time:     `Q${play.Quarter} ${mins}:${secs}`,
        event:    play.Description || '',
        quarter:  play.Quarter,
        teamAbbr: play.Team || null,
        type:     classifyPlay(play.Description, play.Type),
      });
    }
  } else if (league === 'MLB') {
    const innings = data.Innings || [];
    for (const inn of innings) {
      for (const half of ['T', 'B']) {
        const halfPlays = (inn.Plays || []).filter(p => (p.InningHalf || p.Half || 'T') === half);
        for (const play of halfPlays) {
          const pbType = classifyMLBPlay(play.Description);
          plays.push({
            time:       `${half === 'T' ? '▲' : '▼'} ${inn.InningNumber}`,
            event:      play.Description || '',
            quarter:    inn.InningNumber,
            inningHalf: half,
            type:       pbType,
            teamAbbr:   play.Team || null,
            rbi:        play.RunsBattedIn || 0,
            runs:       play.Runs || 0,
            outs:       play.Outs || 0,
            isScoring:  (play.Runs || 0) > 0 || (play.RunsBattedIn || 0) > 0,
            awayScore:  play.AwayTeamRuns ?? null,
            homeScore:  play.HomeTeamRuns ?? null,
            hitter:     play.HitterName   || '',
            pitcher:    play.PitcherName  || '',
          });
        }
      }
    }
  }

  return plays.reverse().slice(0, 100);
}

module.exports = {
  // NBA
  nbaGamesByDate, nbaGames, nbaLiveGameStatsByDate, nbaPlayByPlay, nbaBoxScore,
  nbaStandings, nbaTeamSeasonStats, nbaNews, nbaInjuries,
  nbaPlayerGameStats, nbaTeamGameStats, nbaPlayerSeasonStats, nbaPlayerProjections,
  // NFL
  nflScoresByDate, nflScoresByWeek, nflPlayByPlay, nflBoxScore, nflStandings,
  nflNews, nflInjuries, nflPlayerGameStats, nflTeamGameStats,
  nflPlayerSeasonStats, nflTeamSeasonStats, nflPlayerProjections,
  // NHL
  nhlGamesByDate, nhlGames, nhlLiveGameStatsByDate, nhlPlayByPlay, nhlBoxScore,
  nhlStandings, nhlNews, nhlInjuries,
  nhlPlayerGameStats, nhlTeamGameStats, nhlPlayerSeasonStats, nhlTeamSeasonStats, nhlPlayerProjections,
  // MLB
  mlbLiveGameStatsByDate, mlbGames, mlbGamesByDate, mlbPlayByPlay, mlbBoxScore, mlbStandings, mlbNews, mlbInjuries,
  mlbPlayerGameStats, mlbTeamGameStats, mlbPlayerSeasonStats, mlbTeamSeasonStats, mlbPlayerProjections,
  // Soccer
  soccerGamesByDate, soccerGames, soccerLiveStats, soccerPlayByPlay,
  soccerBoxScore, soccerStandings, soccerNews, soccerPlayerGameStats,
  soccerTeamGameStats, soccerPlayerSeasonStats, soccerTeamSeasonStats,
  // Composites
  getScoresForDate, buildPicksContext,
  // Box score mappers
  mapNBABoxScore, mapNHLBoxScore, mapMLBBoxScore, mapPBP, extractGameMeta,
  mapMLBStatsBoxScore, mapMLBStatsPBP,
  // NHL helpers
  classifyNHLPlay,
  // MLB helpers
  formatIP, classifyMLBPlay,
  // Mappers
  mapNBAGame, mapNFLGame, mapNHLGame, mapMLBGame, mapSoccerGame,
  // Team lookups
  teamName, NBA_TEAMS, NFL_TEAMS, NHL_TEAMS, MLB_TEAMS,
};
