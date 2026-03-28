/**
 * sportsdata.js — Unified sports data layer
 *
 * Sources (all free, no subscription required):
 *   NBA → BallDontLie API     (balldontlie.io)
 *   NHL → NHL Official API    (api-web.nhle.com)
 *   MLB → MLB Official Stats  (statsapi.mlb.com)
 *
 * No SportsData.io dependency.
 */

const bdl      = require('./ballDontLie');
const nhlApi   = require('./nhlApi');
const mlbStats = require('./mlbStats');

// ── Team name lookups ─────────────────────────────────────────────────────────
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

// ── Play classification helpers ───────────────────────────────────────────────

function classifyPlay(description, type) {
  const d = (description || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (t.includes('made') || t.includes('makes') || d.includes('makes') || (d.includes('free throw') && d.includes('makes'))) return 'score';
  if (t.includes('turnover') || d.includes('turnover') || d.includes(' steals ')) return 'turnover';
  if (t.includes('foul') || d.includes(' foul')) return 'foul';
  return 'normal';
}

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

// Format innings pitched decimal (e.g. 6.1 → "6.1" = 6 and 1 out)
function formatIP(ip) {
  if (ip == null) return '0.0';
  const whole = Math.floor(ip);
  const frac  = Math.round((ip - whole) * 10);
  return `${whole}.${frac}`;
}

// ── BDL (NBA) mappers ─────────────────────────────────────────────────────────

function mapBDLGame(g, chalkPick = null) {
  const s = (g.status || '').toLowerCase();
  let status = 'upcoming';
  if (s === 'final' || s === 'complete') status = 'final';
  else if (s === 'in progress' || (typeof g.period === 'number' && g.period > 0 && s !== 'final')) status = 'live';

  const period = g.period || '';
  const time   = (g.time || '').trim();
  const clock  = status === 'live'  ? `Q${period}${time ? ' ' + time : ''}`.trim()
               : status === 'final' ? 'Final'
               : '';

  const awayScore = status !== 'upcoming' ? (g.visitor_team_score ?? null) : null;
  const homeScore = status !== 'upcoming' ? (g.home_team_score ?? null) : null;

  return {
    id:         String(g.id),
    sdGameId:   g.id,
    league:     'NBA',
    status,
    clock,
    awayTeam:   { name: g.visitor_team?.full_name || '', abbr: g.visitor_team?.abbreviation || '', score: awayScore },
    homeTeam:   { name: g.home_team?.full_name    || '', abbr: g.home_team?.abbreviation    || '', score: homeScore },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

function mapBDLBoxScore(statsRows) {
  if (!Array.isArray(statsRows) || statsRows.length === 0) return null;

  const gameInfo = statsRows[0]?.game || {};
  const homeId   = gameInfo.home_team_id;
  const awayId   = gameInfo.visitor_team_id;

  const mapPlayer = (row) => {
    const fgm = row.fgm || 0;
    const fga = row.fga || 0;
    const tpm = row.fg3m || 0;
    const tpa = row.fg3a || 0;
    return {
      name:   `${row.player?.first_name || ''} ${row.player?.last_name || ''}`.trim(),
      pos:    row.player?.position || '--',
      min:    row.min   || '0:00',
      pts:    row.pts   || 0,
      reb:    row.reb   || 0,
      ast:    row.ast   || 0,
      stl:    row.stl   || 0,
      blk:    row.blk   || 0,
      fg:     `${fgm}-${fga}`,
      threeP: `${tpm}-${tpa}`,
      tov:    row.turnover || 0,
      pm:     0,  // BDL does not provide +/-
    };
  };

  const teamTotals = (players) => {
    const fgm = players.reduce((s, p) => s + parseInt(p.fg.split('-')[0]    || 0), 0);
    const fga = players.reduce((s, p) => s + parseInt(p.fg.split('-')[1]    || 0), 0);
    const tpm = players.reduce((s, p) => s + parseInt(p.threeP.split('-')[0] || 0), 0);
    const tpa = players.reduce((s, p) => s + parseInt(p.threeP.split('-')[1] || 0), 0);
    const reb = players.reduce((s, p) => s + p.reb, 0);
    const ast = players.reduce((s, p) => s + p.ast, 0);
    const tov = players.reduce((s, p) => s + p.tov, 0);
    return {
      fg:       `${fgm}-${fga}`,
      fgPct:    fga > 0 ? Math.round((fgm / fga) * 100) : 0,
      threeP:   `${tpm}-${tpa}`,
      threePct: tpa > 0 ? Math.round((tpm / tpa) * 100) : 0,
      reb, ast, tov,
    };
  };

  const awayPlayers = statsRows.filter(r => r.team?.id === awayId).sort((a, b) => (b.pts || 0) - (a.pts || 0)).map(mapPlayer);
  const homePlayers = statsRows.filter(r => r.team?.id === homeId).sort((a, b) => (b.pts || 0) - (a.pts || 0)).map(mapPlayer);
  const awayStats   = teamTotals(awayPlayers);
  const homeStats   = teamTotals(homePlayers);

  return {
    arena: '', arenaCity: '', officials: [],
    quarters: null,  // BDL does not provide per-quarter scores
    awayStats, homeStats,
    away: { players: awayPlayers, totals: awayStats },
    home: { players: homePlayers, totals: homeStats },
  };
}

function mapBDLPBP(plays) {
  if (!Array.isArray(plays) || plays.length === 0) return [];
  return plays.slice().reverse().slice(0, 100).map(play => ({
    time:      `Q${play.period || ''} ${play.clock || ''}`.trim(),
    event:     play.description || '',
    quarter:   play.period  || 0,
    teamAbbr:  play.team?.abbreviation || null,
    awayScore: play.visitor_team_score ?? null,
    homeScore: play.home_team_score    ?? null,
    type:      classifyPlay(play.description, ''),
  }));
}

// ── NHL Official API mappers ──────────────────────────────────────────────────

function mapNHLApiGame(g, chalkPick = null) {
  const gs = (g.gameState || '').toUpperCase();
  let status = 'upcoming';
  if (gs === 'LIVE' || gs === 'CRIT') status = 'live';
  else if (gs === 'OFF' || gs === 'FINAL') status = 'final';

  const period  = g.periodDescriptor?.number || null;
  const timeRem = g.clock?.timeRemaining || '';
  const periodLabel = period ? (period <= 3 ? `P${period}` : period === 4 ? 'OT' : 'SO') : '';
  const clock = status === 'live'  ? (`${periodLabel} ${timeRem}`).trim() || 'Live'
              : status === 'final' ? 'Final'
              : '';

  const awayAbbr = g.awayTeam?.abbrev || '';
  const homeAbbr = g.homeTeam?.abbrev || '';

  return {
    id:         String(g.id),
    sdGameId:   g.id,
    league:     'NHL',
    status,
    clock,
    awayTeam:   { name: teamName('NHL', awayAbbr), abbr: awayAbbr, score: status !== 'upcoming' ? (g.awayTeam?.score ?? null) : null },
    homeTeam:   { name: teamName('NHL', homeAbbr), abbr: homeAbbr, score: status !== 'upcoming' ? (g.homeTeam?.score ?? null) : null },
    chalkPick,
    boxScore:   null,
    playByPlay: [],
  };
}

function mapNHLApiBoxScore(data) {
  if (!data) return null;

  const awayAbbr = data.awayTeam?.abbrev || '';
  const homeAbbr = data.homeTeam?.abbrev || '';

  // Period scores from linescore
  const periods = (data.linescore?.byPeriod || []).map(p => ({
    number: p.period,
    label:  p.period <= 3 ? `P${p.period}` : p.period === 4 ? 'OT' : 'SO',
    away:   p.away,
    home:   p.home,
  }));

  // Team-level stats
  const fmtFO = (pct) => pct != null ? `${Math.round(pct * 100)}%` : '--';
  const teamStats = {
    away: {
      sog:     data.awayTeam?.sog       || 0,
      pp:      data.awayTeam?.powerPlayConversion || '0/0',
      pim:     data.awayTeam?.pimTotal  || 0,
      fo:      fmtFO(data.awayTeam?.faceoffWinningPctg),
      hits:    data.awayTeam?.hitTotal   || 0,
      blocked: data.awayTeam?.blockTotal || 0,
    },
    home: {
      sog:     data.homeTeam?.sog       || 0,
      pp:      data.homeTeam?.powerPlayConversion || '0/0',
      pim:     data.homeTeam?.pimTotal  || 0,
      fo:      fmtFO(data.homeTeam?.faceoffWinningPctg),
      hits:    data.homeTeam?.hitTotal   || 0,
      blocked: data.homeTeam?.blockTotal || 0,
    },
  };

  const mapSkater = (p) => ({
    name:     p.name?.default || '',
    pos:      p.position      || '--',
    g:        p.goals         || 0,
    a:        p.assists       || 0,
    pts:      (p.goals || 0) + (p.assists || 0),
    pm:       p.plusMinus     || 0,
    pim:      p.pim           || 0,
    sog:      p.shots         || 0,
    toi:      p.toi           || '--',
    isScorer: (p.goals || 0) > 0,
  });

  const mapGoalie = (p, idx) => {
    const parts = (p.saveShotsAgainst || '0/0').split('/').map(Number);
    const sv = parts[0] || 0;
    const sa = parts[1] || 0;
    const svPct = sa > 0 ? (sv / sa).toFixed(3) : (p.savePercentage != null ? p.savePercentage.toFixed(3) : '--');
    return {
      name:      p.name?.default || '',
      sa,
      sv,
      ga:        p.goalsAgainst || 0,
      svPct,
      toi:       p.toi || '--',
      decision:  p.decision || '',
      isStarter: idx === 0,
    };
  };

  const mapTeam = (teamData) => {
    if (!teamData) return { skaters: [], goalies: [] };
    const fwds = (teamData.forwards   || []).map(mapSkater);
    const defs = (teamData.defensemen || []).map(mapSkater);
    const gols = (teamData.goalies    || []).map(mapGoalie);
    const skaters = [...fwds, ...defs].sort((a, b) => b.pts - a.pts || b.sog - a.sog);
    return { skaters, goalies: gols };
  };

  const awayPlayers = mapTeam(data.playerByGameStats?.awayTeam);
  const homePlayers = mapTeam(data.playerByGameStats?.homeTeam);
  const officials   = (data.officials || []).map(o => o.name?.default || '').filter(Boolean);

  return {
    league: 'NHL',
    arena: data.venue?.default || '', arenaCity: '',
    officials,
    periods,
    teamStats,
    awayAbbr, homeAbbr,
    away: { skaters: awayPlayers.skaters, goalies: awayPlayers.goalies },
    home: { skaters: homePlayers.skaters, goalies: homePlayers.goalies },
    quarters: { away: periods.map(p => p.away), home: periods.map(p => p.home) },
  };
}

function mapNHLApiPBP(data) {
  if (!data?.plays) return [];

  // Player lookup from roster spots
  const playerMap = {};
  for (const p of (data.rosterSpots || [])) {
    playerMap[p.playerId] = `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim();
  }

  const awayTeamId = data.awayTeam?.id;
  const homeTeamId = data.homeTeam?.id;
  const awayAbbr   = data.awayTeam?.abbrev || '';
  const homeAbbr   = data.homeTeam?.abbrev || '';

  let awayScore = 0;
  let homeScore = 0;
  const plays   = [];

  for (const play of data.plays) {
    const period  = play.period || 0;
    const timeRem = play.timeRemaining || '';
    const typeKey = play.typeDescKey   || '';
    const details = play.details       || {};

    if (typeKey === 'goal') {
      awayScore = details.awayScore ?? awayScore;
      homeScore = details.homeScore ?? homeScore;
    }

    // Build human-readable description
    let event = typeKey.replace(/-/g, ' ');
    if (typeKey === 'goal') {
      const scorer = playerMap[details.scoringPlayerId] || '';
      const a1 = playerMap[details.assist1PlayerId] ? `, ${playerMap[details.assist1PlayerId]}` : '';
      const a2 = playerMap[details.assist2PlayerId] ? `, ${playerMap[details.assist2PlayerId]}` : '';
      event = `GOAL: ${scorer}${a1}${a2}`;
    } else if (typeKey === 'penalty') {
      const who = playerMap[details.committedByPlayerId] || '';
      event = `PENALTY: ${who} (${details.descKey || ''} ${details.duration ? details.duration + 'min' : ''})`.trim();
    } else if (typeKey === 'shot-on-goal') {
      const shooter = playerMap[details.shootingPlayerId] || '';
      event = shooter ? `Shot: ${shooter}` : 'Shot on goal';
    }

    const ownerTeamId = details.eventOwnerTeamId;
    const teamAbbr = ownerTeamId === awayTeamId ? awayAbbr : ownerTeamId === homeTeamId ? homeAbbr : null;
    const periodLabel = period <= 3 ? `P${period}` : period === 4 ? 'OT' : 'SO';
    const category = classifyNHLPlay(typeKey, event, '');

    plays.push({
      time:      `${periodLabel} ${timeRem}`,
      event,
      quarter:   period,
      teamAbbr,
      awayScore,
      homeScore,
      strength:  null,
      category,
    });
  }

  return plays.reverse().slice(0, 100);
}

// ── MLB Stats API helpers ─────────────────────────────────────────────────────

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

  const ls     = g.linescore || {};
  const inning = ls.currentInning || null;
  const half   = ls.inningHalf;
  const clock  = inning ? `${half === 'Bottom' ? '▼' : '▲'} ${inning}` : (status === 'final' ? 'Final' : '');

  return {
    id:         String(g.gamePk),
    sdGameId:   g.gamePk,
    league:     'MLB',
    status,
    clock,
    awayTeam:   { name: awayName, abbr: awayAbbr, score: status !== 'upcoming' ? (g.teams?.away?.score ?? null) : null },
    homeTeam:   { name: homeName, abbr: homeAbbr, score: status !== 'upcoming' ? (g.teams?.home?.score ?? null) : null },
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
    arena:     '', arenaCity: '',
    officials,
    weather:   null,
    liveState,
    innings,
    awayRHE,  homeRHE,
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
      rbi:        result.rbi || 0,
      runs:       0,
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

  const [nbaDone, nhlDone, mlbDone] = await Promise.allSettled([
    bdl.getGames(date),
    nhlApi.getSchedule(date),
    mlbStats.getSchedule(isoToMLBDate(date)),
  ]);

  const results = [];

  if (nbaDone.status === 'fulfilled' && Array.isArray(nbaDone.value)) {
    for (const g of nbaDone.value) {
      const away = g.visitor_team?.full_name || '';
      const home = g.home_team?.full_name    || '';
      results.push(mapBDLGame(g, match(away, home)));
    }
  }

  if (nhlDone.status === 'fulfilled' && Array.isArray(nhlDone.value)) {
    for (const g of nhlDone.value) {
      const awayAbbr = g.awayTeam?.abbrev || '';
      const homeAbbr = g.homeTeam?.abbrev || '';
      results.push(mapNHLApiGame(g, match(teamName('NHL', awayAbbr), teamName('NHL', homeAbbr))));
    }
  }

  if (mlbDone.status === 'fulfilled' && Array.isArray(mlbDone.value)) {
    for (const g of mlbDone.value) {
      const away = g.teams?.away?.team?.name || '';
      const home = g.teams?.home?.team?.name || '';
      results.push(mapMLBStatsGame(g, match(away, home)));
    }
  }

  return results.sort((a, b) => {
    const order = { live: 0, upcoming: 1, final: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });
}

// ── Context builder for Picks Engine ─────────────────────────────────────────
// homeTeam / awayTeam are full team names (from Odds API)

async function buildPicksContext(league, homeTeam, awayTeam, date) {
  const parts = [];

  try {
    const L    = (league || '').toUpperCase();
    // Match by last word of team name (e.g. "Celtics", "Warriors")
    const ht   = (homeTeam || '').split(' ').pop().toLowerCase();
    const at   = (awayTeam || '').split(' ').pop().toLowerCase();
    const matches = (name) => (name || '').toLowerCase().includes(ht) || (name || '').toLowerCase().includes(at);

    if (L === 'NBA') {
      const [teamStatsDone, injuriesDone] = await Promise.allSettled([
        bdl.getTeamStats(2024),
        bdl.getInjuries(),
      ]);
      if (teamStatsDone.status === 'fulfilled' && Array.isArray(teamStatsDone.value)) {
        const rel = teamStatsDone.value.filter(t => matches(t.team?.full_name));
        if (rel.length) parts.push(`NBA TEAM SEASON STATS (BallDontLie):\n${JSON.stringify(rel, null, 2)}`);
      }
      if (injuriesDone.status === 'fulfilled' && Array.isArray(injuriesDone.value)) {
        const rel = injuriesDone.value.filter(p => matches(p.player?.team?.full_name));
        if (rel.length) parts.push(`NBA INJURIES:\n${JSON.stringify(rel.slice(0, 20), null, 2)}`);
      }
    }

    if (L === 'NHL') {
      const standings = await nhlApi.getStandings();
      if (Array.isArray(standings)) {
        const rel = standings.filter(t => {
          const name = (t.teamName?.default || t.teamCommonName?.default || '');
          return matches(name);
        });
        if (rel.length) parts.push(`NHL TEAM STANDINGS:\n${JSON.stringify(rel, null, 2)}`);
      }
    }

    if (L === 'MLB') {
      const year     = (date || new Date().toISOString().split('T')[0]).substring(0, 4);
      const divs     = await mlbStats.getStandings(year);
      if (Array.isArray(divs)) {
        const allRecords = divs.flatMap(d => d.teamRecords || []);
        const rel = allRecords.filter(t => matches(t.team?.name));
        if (rel.length) parts.push(`MLB TEAM STANDINGS:\n${JSON.stringify(rel, null, 2)}`);
      }
    }
  } catch (err) {
    console.warn(`[buildPicksContext] error: ${err.message}`);
  }

  return parts.join('\n\n---\n\n');
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  // Composites
  getScoresForDate, buildPicksContext,
  // NBA (BDL) mappers
  mapBDLBoxScore, mapBDLPBP,
  // NHL (NHL Official API) mappers
  mapNHLApiBoxScore, mapNHLApiPBP,
  // MLB (MLB Official Stats API) mappers
  mapMLBStatsBoxScore, mapMLBStatsPBP,
  // Helpers used by routes
  teamName, NBA_TEAMS, NFL_TEAMS, NHL_TEAMS, MLB_TEAMS,
  classifyPlay, classifyNHLPlay, classifyMLBPlay, formatIP,
};
