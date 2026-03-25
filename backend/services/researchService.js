/**
 * researchService.js — Data context builder for Chalky's Research tab
 *
 * Data sources (all free, no SportsData.io):
 *   NBA    — BallDontLie GOAT API  + nba_api microservice + player_game_logs DB
 *   NHL    — NHL official API (api-web.nhle.com) + player_game_logs DB
 *   MLB    — MLB Stats API (statsapi.mlb.com) + player_game_logs DB + Open-Meteo weather
 *   Odds   — The Odds API (via Chalk backend — not called here, context only)
 */

const db         = require('../db');
const nba        = require('./nba');
const bdl        = require('./ballDontLie');
const nhlApi     = require('./nhlApi');
const mlbStats   = require('./mlbStats');
const weather    = require('./weatherService');

// ── Season year helper ────────────────────────────────────────────────────────

/**
 * Returns the start year of the current NBA/NHL/MLB season.
 * NBA/NHL 2025-26 season → 2025
 * NBA season starts in October; NHL in October; MLB in March.
 */
function getCurrentNBASeason() {
  const now   = new Date();
  const month = now.getMonth(); // 0 = Jan, 9 = Oct
  const year  = now.getFullYear();
  return month >= 9 ? year : year - 1; // on or after October → this year
}

// ── Player alias map ──────────────────────────────────────────────────────────

/**
 * Maps common nicknames/aliases to BDL-searchable terms (NBA only — BDL is NBA).
 * NHL/MLB aliases are stored here for display/intent purposes but stats are
 * fetched from NHL API and MLB Stats API respectively in those sport sections.
 *
 * Format: 'alias' → [bdl_search_term, display_name]
 * IMPORTANT: BDL search requires short fragments — full names return 0 results.
 */
const PLAYER_ALIASES = {
  // ── NBA ──────────────────────────────────────────────────────────────────────
  'jokic':         ['jokic',          'Nikola Jokic'],
  'joker':         ['jokic',          'Nikola Jokic'],
  'nikola':        ['jokic',          'Nikola Jokic'],   // enough context if asked about jokic
  'luka':          ['doncic',         'Luka Doncic'],
  'doncic':        ['doncic',         'Luka Doncic'],
  'giannis':       ['antetokounmpo',  'Giannis Antetokounmpo'],
  'greek freak':   ['antetokounmpo',  'Giannis Antetokounmpo'],
  'lebron':        ['james',          'LeBron James'],
  'bron':          ['james',          'LeBron James'],
  'king james':    ['james',          'LeBron James'],
  'steph curry':   ['stephen',        'Stephen Curry'],
  'stephen curry': ['stephen',        'Stephen Curry'],
  'steph':         ['stephen',        'Stephen Curry'],
  'sga':           ['gilgeous',       'Shai Gilgeous-Alexander'],
  'shai':          ['gilgeous',       'Shai Gilgeous-Alexander'],
  'gilgeous':      ['gilgeous',       'Shai Gilgeous-Alexander'],
  'kd':            ['durant',         'Kevin Durant'],
  'kevin durant':  ['durant',         'Kevin Durant'],
  'durant':        ['durant',         'Kevin Durant'],
  'embiid':        ['embiid',         'Joel Embiid'],
  'jo embiid':     ['embiid',         'Joel Embiid'],
  'tatum':         ['tatum',          'Jayson Tatum'],
  'jt':            ['tatum',          'Jayson Tatum'],
  'wemby':         ['wembanyama',     'Victor Wembanyama'],
  'wembanyama':    ['wembanyama',     'Victor Wembanyama'],
  'ja morant':     ['morant',         'Ja Morant'],
  'morant':        ['morant',         'Ja Morant'],
  'dame':          ['lillard',        'Damian Lillard'],
  'lillard':       ['lillard',        'Damian Lillard'],
  'lamelo':        ['lamelo',         'LaMelo Ball'],
  'booker':        ['booker',         'Devin Booker'],
  'dbook':         ['booker',         'Devin Booker'],
  'bam':           ['adebayo',        'Bam Adebayo'],
  'adebayo':       ['adebayo',        'Bam Adebayo'],
  'kat':           ['towns',          'Karl-Anthony Towns'],
  'towns':         ['towns',          'Karl-Anthony Towns'],
  'fox':           ['fox',            "De'Aaron Fox"],
  'ant':           ['edwards',        'Anthony Edwards'],
  'ant man':       ['edwards',        'Anthony Edwards'],
  'edwards':       ['edwards',        'Anthony Edwards'],
  'brunson':       ['brunson',        'Jalen Brunson'],
  'maxey':         ['maxey',          'Tyrese Maxey'],
  'hali':          ['haliburton',     'Tyrese Haliburton'],
  'haliburton':    ['haliburton',     'Tyrese Haliburton'],
  'randle':        ['randle',         'Julius Randle'],
  'butler':        ['butler',         'Jimmy Butler'],
  'zion':          ['williamson',     'Zion Williamson'],
  'ingram':        ['ingram',         'Brandon Ingram'],
  'mitchell':      ['mitchell',       'Donovan Mitchell'],
  'cade':          ['cunningham',     'Cade Cunningham'],
  'cunningham':    ['cunningham',     'Cade Cunningham'],
  'banchero':      ['banchero',       'Paolo Banchero'],
  'paolo':         ['banchero',       'Paolo Banchero'],

  // ── NHL (display name only — stats fetched from NHL API, not BDL) ─────────
  'mcdavid':       ['mcdavid',        'Connor McDavid'],
  'draisaitl':     ['draisaitl',      'Leon Draisaitl'],
  'leon':          ['draisaitl',      'Leon Draisaitl'],
  'mackinnon':     ['mackinnon',      'Nathan MacKinnon'],
  'nate mac':      ['mackinnon',      'Nathan MacKinnon'],
  'matthews':      ['matthews',       'Auston Matthews'],
  'marner':        ['marner',         'Mitch Marner'],
  'crosby':        ['crosby',         'Sidney Crosby'],
  'sid':           ['crosby',         'Sidney Crosby'],
  'ovechkin':      ['ovechkin',       'Alex Ovechkin'],
  'ovi':           ['ovechkin',       'Alex Ovechkin'],
  'pasta':         ['pastrnak',       'David Pastrnak'],
  'pastrnak':      ['pastrnak',       'David Pastrnak'],
  'makar':         ['makar',          'Cale Makar'],
  'hedman':        ['hedman',         'Victor Hedman'],
  'quinn hughes':  ['quinn hughes',   'Quinn Hughes'],
  'matthew tkachuk': ['tkachuk',      'Matthew Tkachuk'],
  'tkachuk':       ['tkachuk',        'Matthew Tkachuk'],
  'caufield':      ['caufield',       'Cole Caufield'],
  'demko':         ['demko',          'Thatcher Demko'],
  'vasi':          ['vasilevskiy',    'Andrei Vasilevskiy'],
  'vasilevskiy':   ['vasilevskiy',    'Andrei Vasilevskiy'],

  // ── MLB (display name only — stats fetched from MLB Stats API, not BDL) ────
  'judge':         ['judge',          'Aaron Judge'],
  'aaron judge':   ['judge',          'Aaron Judge'],
  'ohtani':        ['ohtani',         'Shohei Ohtani'],
  'sho-time':      ['ohtani',         'Shohei Ohtani'],
  'showtime':      ['ohtani',         'Shohei Ohtani'],
  'tatis':         ['tatis',          'Fernando Tatis Jr.'],
  'acuna':         ['acuna',          'Ronald Acuña Jr.'],
  'acuña':         ['acuna',          'Ronald Acuña Jr.'],
  'trout':         ['trout',          'Mike Trout'],
  'betts':         ['betts',          'Mookie Betts'],
  'mookie':        ['betts',          'Mookie Betts'],
  'vlad':          ['guerrero',       'Vladimir Guerrero Jr.'],
  'guerrero':      ['guerrero',       'Vladimir Guerrero Jr.'],
  'devers':        ['devers',         'Rafael Devers'],
  'yordan':        ['yordan',         'Yordan Alvarez'],
  'alvarez':       ['yordan',         'Yordan Alvarez'],
  'wheeler':       ['wheeler',        'Zack Wheeler'],
  'scherzer':      ['scherzer',       'Max Scherzer'],
  'gerrit cole':   ['cole',           'Gerrit Cole'],
  'degrom':        ['degrom',         'Jacob deGrom'],
  'clase':         ['clase',          'Emmanuel Clase'],
};

/**
 * Returns { searchTerm, displayName } for a player alias found in the question,
 * or null if no alias matches.
 */
function resolvePlayerAlias(question) {
  const lower = question.toLowerCase();
  for (const [alias, [searchTerm, displayName]] of Object.entries(PLAYER_ALIASES)) {
    if (lower.includes(alias)) return { searchTerm, displayName };
  }
  return null;
}

// ── Off-topic detection ───────────────────────────────────────────────────────

// Keywords that signal a sports/betting question — must match at least one
const SPORTS_SIGNALS = [
  // sports names
  'nba', 'nhl', 'mlb', 'nfl', 'soccer', 'football', 'basketball', 'hockey', 'baseball',
  'wnba', 'mls', 'ncaa', 'world cup', 'playoffs', 'season',
  // betting vocab
  'bet', 'odds', 'spread', 'over', 'under', 'moneyline', 'prop', 'parlay', 'line',
  'ats', 'cover', 'juice', 'vig', 'sharp', 'fade', 'tail', 'lock', 'pick',
  'pra', 'dfs', 'fantasy', 'draft kings', 'fanduel', 'betmgm', 'sportsbook',
  // generic sports vocab
  'game', 'match', 'score', 'player', 'team', 'coach', 'draft', 'trade',
  'injury', 'injured', 'starter', 'goalie', 'pitcher', 'batter',
  'points', 'rebounds', 'assists', 'goals', 'assists', 'stats', 'average',
  // team/player fragments (enough to catch most)
  'lakers', 'celtics', 'warriors', 'nets', 'knicks', 'heat', 'bucks', 'bulls',
  'nuggets', 'suns', 'mavs', 'mavericks', 'clippers', 'sixers', 'raptors',
  'bruins', 'leafs', 'rangers', 'penguins', 'capitals', 'lightning', 'avalanche',
  'yankees', 'dodgers', 'red sox', 'cubs', 'astros', 'braves', 'phillies',
  'lebron', 'curry', 'giannis', 'jokic', 'embiid', 'luka', 'tatum',
  'mcdavid', 'matthews', 'mackinnon', 'ovechkin', 'crosby',
  'judge', 'ohtani', 'betts', 'acuna', 'freeman',
  // weather only counts in MLB context
  'wrigley', 'coors', 'fenway', 'yankee stadium', 'camden',
];

/**
 * Returns true if the question has no detectable sports/betting signal.
 * Claude still handles the response — this just skips the data fetch.
 */
function isOffTopic(question) {
  const lower = question.toLowerCase();
  return !SPORTS_SIGNALS.some(s => lower.includes(s));
}

// ── Sport detection ───────────────────────────────────────────────────────────

const NBA_KEYWORDS = [
  'nba', 'basketball',
  'hawks', 'celtics', 'nets', 'hornets', 'bulls', 'cavaliers', 'cavs',
  'mavericks', 'mavs', 'nuggets', 'pistons', 'warriors', 'rockets',
  'pacers', 'clippers', 'lakers', 'grizzlies', 'heat', 'bucks',
  'timberwolves', 'wolves', 'pelicans', 'knicks', 'thunder', 'magic',
  '76ers', 'sixers', 'suns', 'blazers', 'kings', 'spurs', 'raptors',
  'jazz', 'wizards',
  'atlanta', 'boston', 'brooklyn', 'charlotte', 'chicago', 'cleveland',
  'dallas', 'denver', 'detroit', 'golden state', 'houston', 'indiana',
  'memphis', 'miami', 'milwaukee', 'minnesota', 'new orleans', 'new york',
  'oklahoma city', 'orlando', 'philadelphia', 'phoenix', 'portland',
  'sacramento', 'san antonio', 'toronto', 'utah', 'washington',
  'lebron', 'curry', 'durant', 'giannis', 'jokic', 'embiid', 'luka',
  'doncic', 'tatum', 'brown', 'butler', 'mitchell', 'fox', 'booker',
  'lillard', 'dame', 'wembanyama', 'victor', 'ant', 'edwards',
  'brunson', 'sga', 'gilgeous', 'maxey', 'haliburton', 'morant',
  'bam', 'adebayo', 'towns', 'cunningham', 'randle', 'zion', 'ingram',
  'lamelo', 'ball',
];

const NHL_KEYWORDS = [
  'nhl', 'hockey', 'goalie', 'puck', 'power play',
  'maple leafs', 'leafs', 'canadiens', 'habs', 'bruins', 'rangers',
  'penguins', 'pens', 'capitals', 'caps', 'lightning', 'panthers',
  'hurricanes', 'canes', 'devils', 'islanders', 'flyers', 'senators',
  'sabres', 'red wings', 'blackhawks', 'blues', 'predators', 'preds',
  'stars', 'wild', 'avalanche', 'avs', 'jets', 'oilers', 'flames',
  'canucks', 'kraken', 'golden knights', 'knights', 'ducks', 'sharks',
  'utah hockey',
  'mcdavid', 'draisaitl', 'matthews', 'marner', 'mackinnon', 'hedman',
  'vasilevskiy', 'ovechkin', 'crosby', 'malkin', 'point', 'barkov', 'makar',
];

const MLB_KEYWORDS = [
  'mlb', 'baseball', 'pitcher', 'batting', 'era', 'whip', 'innings',
  'strikeout', 'home run', 'bullpen',
  'yankees', 'red sox', 'dodgers', 'cubs', 'cardinals', 'giants', 'mets',
  'braves', 'astros', 'phillies', 'padres', 'mariners', 'rangers',
  'orioles', 'rays', 'blue jays', 'tigers', 'twins', 'white sox',
  'guardians', 'royals', 'angels', 'athletics', 'pirates', 'reds',
  'rockies', 'marlins', 'nationals', 'brewers',
  'judge', 'ohtani', 'shohei', 'betts', 'freeman', 'acuña', 'acuna',
  'soto', 'devers', 'arenado', 'cole', 'kershaw',
  // venues also trigger MLB context
  'wrigley', 'coors field', 'fenway', 'yankee stadium', 'camden yards',
  'oracle park', 'dodger stadium', 'petco', 'great american',
];

const SOCCER_KEYWORDS = [
  'world cup', 'fifa', 'soccer', 'mls', 'premier league',
  'messi', 'ronaldo', 'mbappe', 'haaland', 'de bruyne', 'salah',
];

function detectSport(q) {
  const lower = q.toLowerCase();
  if (NBA_KEYWORDS.some(k => lower.includes(k))) return 'NBA';
  if (NHL_KEYWORDS.some(k => lower.includes(k))) return 'NHL';
  if (MLB_KEYWORDS.some(k => lower.includes(k))) return 'MLB';
  if (lower.includes('nfl') || (lower.includes('football') && !lower.includes('soccer'))) return 'NFL';
  if (SOCCER_KEYWORDS.some(k => lower.includes(k))) return 'Soccer';
  return null;
}

// ── Intent detection ──────────────────────────────────────────────────────────

function detectIntent(q) {
  const lower = q.toLowerCase();
  // Player stats must be checked BEFORE education — "what is X averaging" is player, not education
  if (['averaging', 'averages', 'avg', 'how many points', 'how many goals', 'how many rebounds',
       'per game', 'ppg', 'rpg', 'apg', 'season stats'].some(t => lower.includes(t))) return 'player';
  if (['injur', 'hurt', 'out tonight', 'questionable', 'gtd', 'will he play', 'is he playing',
       'starting in goal', 'who starts', 'who is starting', 'starter'].some(t => lower.includes(t))) return 'injury';
  if (['over', 'under', 'should i bet', 'good bet', 'worth it', 'prop', 'points prop',
       'rebounds prop', 'assists prop', 'pra'].some(t => lower.includes(t))) return 'prop';
  if (['matchup', 'game tonight', "tonight's game", 'who wins', 'both teams', 'head to head',
       'h2h', 'break down', 'tell me about tonight'].some(t => lower.includes(t))) return 'matchup';
  if (['weather', 'conditions', 'wind', 'temperature', 'temp at'].some(t => lower.includes(t))) return 'weather';
  if (['streak', 'trending', 'lately', 'last 10', 'last 5', 'this month', 'hot streak',
       'cold streak', 'slump'].some(t => lower.includes(t))) return 'trend';
  if (['how is', 'how has', 'tell me about', 'stats', 'form', 'playing well',
       'playing lately', 'been playing'].some(t => lower.includes(t))) return 'player';
  // Education last — generic "what is" / "how does" are education only when no player context
  if (["what's a", 'how does', 'explain', 'what does', "what's the difference", 'how do i read',
       'how do i', 'what mean', 'what is a parlay', 'what is a spread', 'what is vig',
       'what is juice', 'what is moneyline'].some(t => lower.includes(t))) return 'education';
  // "What is X averaging?" falls through to here — treat as player
  if (['what is', 'what are'].some(t => lower.startsWith(t))) return 'player';
  return 'general';
}

// ── Entity maps ───────────────────────────────────────────────────────────────

// NHL keyword → team abbreviation for NHL API calls
const NHL_KEYWORD_TO_ABBR = {
  'bruins': 'BOS', 'boston': 'BOS',
  'canadiens': 'MTL', 'habs': 'MTL', 'montreal': 'MTL',
  'maple leafs': 'TOR', 'leafs': 'TOR', 'toronto': 'TOR',
  'rangers': 'NYR', 'new york rangers': 'NYR',
  'penguins': 'PIT', 'pens': 'PIT', 'pittsburgh': 'PIT',
  'capitals': 'WSH', 'caps': 'WSH', 'washington': 'WSH',
  'lightning': 'TBL', 'tampa bay': 'TBL',
  'panthers': 'FLA', 'florida': 'FLA',
  'hurricanes': 'CAR', 'canes': 'CAR', 'carolina': 'CAR',
  'devils': 'NJD', 'new jersey': 'NJD',
  'islanders': 'NYI', 'new york islanders': 'NYI',
  'flyers': 'PHI', 'philadelphia': 'PHI',
  'senators': 'OTT', 'ottawa': 'OTT',
  'sabres': 'BUF', 'buffalo': 'BUF',
  'red wings': 'DET', 'detroit': 'DET',
  'blackhawks': 'CHI', 'chicago': 'CHI',
  'blues': 'STL', 'st. louis': 'STL', 'saint louis': 'STL',
  'predators': 'NSH', 'preds': 'NSH', 'nashville': 'NSH',
  'stars': 'DAL', 'dallas': 'DAL',
  'wild': 'MIN', 'minnesota': 'MIN',
  'avalanche': 'COL', 'avs': 'COL', 'colorado': 'COL',
  'jets': 'WPG', 'winnipeg': 'WPG',
  'oilers': 'EDM', 'edmonton': 'EDM',
  'flames': 'CGY', 'calgary': 'CGY',
  'canucks': 'VAN', 'vancouver': 'VAN',
  'kraken': 'SEA', 'seattle': 'SEA',
  'golden knights': 'VGK', 'knights': 'VGK', 'vegas': 'VGK',
  'ducks': 'ANA', 'anaheim': 'ANA',
  'sharks': 'SJS', 'san jose': 'SJS',
  'utah hockey': 'UTA', 'utah': 'UTA',
};

// MLB team name/keyword → abbreviation (for weather lookup)
const MLB_KEYWORD_TO_ABBR = {
  'yankees': 'NYY', 'new york yankees': 'NYY',
  'red sox': 'BOS', 'boston': 'BOS',
  'dodgers': 'LAD', 'los angeles dodgers': 'LAD',
  'cubs': 'CHC', 'chicago cubs': 'CHC', 'wrigley': 'CHC',
  'cardinals': 'STL', 'st. louis': 'STL',
  'giants': 'SFG', 'san francisco': 'SFG', 'oracle park': 'SFG',
  'mets': 'NYM', 'new york mets': 'NYM',
  'braves': 'ATL', 'atlanta': 'ATL',
  'astros': 'HOU', 'houston': 'HOU',
  'phillies': 'PHI', 'philadelphia': 'PHI',
  'padres': 'SDP', 'san diego': 'SDP', 'petco': 'SDP',
  'mariners': 'SEA', 'seattle': 'SEA',
  'rangers': 'TEX', 'texas': 'TEX',
  'orioles': 'BAL', 'baltimore': 'BAL', 'camden': 'BAL',
  'rays': 'TBR', 'tampa bay': 'TBR',
  'blue jays': 'TOR', 'toronto': 'TOR',
  'tigers': 'DET', 'detroit': 'DET',
  'twins': 'MIN', 'minnesota': 'MIN',
  'white sox': 'CWS', 'guaranteed rate': 'CWS',
  'guardians': 'CLE', 'cleveland': 'CLE',
  'royals': 'KCR', 'kansas city': 'KCR',
  'angels': 'LAA', 'los angeles angels': 'LAA',
  'athletics': 'OAK', 'oakland': 'OAK',
  'pirates': 'PIT', 'pittsburgh': 'PIT', 'pnc park': 'PIT',
  'reds': 'CIN', 'cincinnati': 'CIN', 'great american': 'CIN',
  'rockies': 'COL', 'colorado': 'COL', 'coors': 'COL',
  'marlins': 'MIA', 'miami': 'MIA',
  'nationals': 'WSN', 'washington': 'WSN',
  'brewers': 'MIL', 'milwaukee': 'MIL',
  'diamondbacks': 'ARI', 'dbacks': 'ARI', 'arizona': 'ARI',
};

function detectNHLTeamAbbr(q) {
  const lower = q.toLowerCase();
  for (const [keyword, abbr] of Object.entries(NHL_KEYWORD_TO_ABBR)) {
    if (lower.includes(keyword)) return abbr;
  }
  return null;
}

function detectMLBTeamAbbr(q) {
  const lower = q.toLowerCase();
  for (const [keyword, abbr] of Object.entries(MLB_KEYWORD_TO_ABBR)) {
    if (lower.includes(keyword)) return abbr;
  }
  return null;
}

// NBA entity extraction
const NBA_TEAM_NAMES = Object.keys(nba.TEAM_IDS || {});
function extractNBATeams(q) {
  const lower = q.toLowerCase();
  return NBA_TEAM_NAMES.filter(name => {
    const n = name.toLowerCase();
    return lower.includes(n) || lower.includes(n.split(' ').pop());
  });
}

const PLAYER_FRAGMENTS = [
  'lebron', 'curry', 'durant', 'giannis', 'jokic', 'embiid', 'luka',
  'doncic', 'tatum', 'brown', 'butler', 'mitchell', 'fox', 'booker',
  'lillard', 'dame', 'wembanyama', 'victor', 'ant', 'edwards',
  'brunson', 'sga', 'gilgeous', 'maxey', 'haliburton', 'morant',
  'bam', 'adebayo', 'towns', 'cunningham', 'randle', 'zion', 'ingram',
  'lamelo', 'ball',
];
function extractPlayerFragments(q) {
  const lower = q.toLowerCase();
  return PLAYER_FRAGMENTS.filter(p => lower.includes(p));
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getPlayerGameLog(playerName, sport, limit = 10) {
  try {
    const { rows } = await db.query(
      `SELECT game_date, opponent, home_away, points, rebounds, assists,
              steals, blocks, three_made, fg_pct, plus_minus, minutes
       FROM player_game_logs
       WHERE LOWER(player_name) LIKE LOWER($1) AND sport = $2
       ORDER BY game_date DESC LIMIT $3`,
      [`%${playerName}%`, sport, limit]
    );
    return rows;
  } catch { return []; }
}

async function getTeamGameLog(teamName, sport, limit = 10) {
  try {
    const { rows } = await db.query(
      `SELECT game_date, opponent, home_away, result, points_scored, points_allowed
       FROM team_game_logs
       WHERE LOWER(team_name) LIKE LOWER($1) AND sport = $2
       ORDER BY game_date DESC LIMIT $3`,
      [`%${teamName}%`, sport, limit]
    );
    return rows;
  } catch { return []; }
}

function computeAvg(rows, field) {
  const vals = rows.map(r => Number(r[field])).filter(v => !isNaN(v));
  if (!vals.length) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

// ── Context formatters ────────────────────────────────────────────────────────

function formatGameLog(rows, sport) {
  if (!rows?.length) return null;
  const header = sport === 'NBA'
    ? 'DATE        OPP   HA    PTS  REB  AST  3PM  FG%    +/-'
    : 'DATE        OPP   HA    PTS  REB  AST';
  const lines = rows.map(r => {
    const date = String(r.game_date).slice(0, 10);
    const opp  = String(r.opponent || '').padEnd(5).slice(0, 5);
    const ha   = String(r.home_away || '').padEnd(5).slice(0, 5);
    const pts  = String(r.points   != null ? Number(r.points).toFixed(0)   : '-').padStart(4);
    const reb  = String(r.rebounds != null ? Number(r.rebounds).toFixed(0) : '-').padStart(4);
    const ast  = String(r.assists  != null ? Number(r.assists).toFixed(0)  : '-').padStart(4);
    if (sport === 'NBA') {
      const threes = String(r.three_made != null ? Number(r.three_made).toFixed(0) : '-').padStart(4);
      const fgp    = r.fg_pct != null ? (Number(r.fg_pct) * 100).toFixed(0) + '%' : '-';
      const pm     = r.plus_minus != null ? (Number(r.plus_minus) > 0 ? '+' : '') + Number(r.plus_minus).toFixed(0) : '-';
      return `${date}  ${opp} ${ha} ${pts} ${reb} ${ast} ${threes} ${fgp.padStart(5)} ${pm.padStart(4)}`;
    }
    return `${date}  ${opp} ${ha} ${pts} ${reb} ${ast}`;
  });
  return `${header}\n${lines.join('\n')}`;
}

function formatTeamLog(rows) {
  if (!rows?.length) return null;
  const header = 'DATE        OPPONENT   HA    RESULT  PTS   PA';
  const lines = rows.map(r => {
    const date   = String(r.game_date).slice(0, 10);
    const opp    = String(r.opponent || '').padEnd(9).slice(0, 9);
    const ha     = String(r.home_away || '').padEnd(5).slice(0, 5);
    const result = String(r.result || '-').padEnd(7).slice(0, 7);
    const pts    = String(r.points_scored  != null ? Number(r.points_scored).toFixed(0)  : '-').padStart(4);
    const pa     = String(r.points_allowed != null ? Number(r.points_allowed).toFixed(0) : '-').padStart(4);
    return `${date}  ${opp} ${ha} ${result} ${pts} ${pa}`;
  });
  return `${header}\n${lines.join('\n')}`;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

// YYYY-MM-DD → MM/DD/YYYY (MLB Stats API format)
function toMLBDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

// ── Main context builder ──────────────────────────────────────────────────────

/**
 * Build a data context string for a research question.
 * Returns { context: string|null, sport: string|null, intent: string }
 */
async function buildDataContext(question, conversationHistory = []) {
  const sport  = detectSport(question);
  const intent = detectIntent(question);
  const lower  = question.toLowerCase();
  const parts  = [];

  // Try to infer sport from recent conversation if not in current question
  const effectiveSport = sport || (() => {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const s = detectSport(conversationHistory[i]?.content || '');
      if (s) return s;
    }
    return null;
  })();

  const currentNBASeason = getCurrentNBASeason();

  console.log('=== RESEARCH DATA CONTEXT ===');
  console.log('Question:', question.slice(0, 100));
  console.log('Sport detected:', effectiveSport, '| Intent:', intent);
  console.log('Current NBA season year:', currentNBASeason);
  console.log('BallDontLie API key present:', !!process.env.BALLDONTLIE_API_KEY);

  // ── NBA ─────────────────────────────────────────────────────────────────────
  if (effectiveSport === 'NBA') {
    const teams = extractNBATeams(question);

    // Resolve player: try alias map first, then fragment list, then history
    let players = extractPlayerFragments(question);

    // Follow-up question: no player in current message → look back in history
    if (players.length === 0 && conversationHistory.length > 0) {
      for (let i = conversationHistory.length - 1; i >= 0 && players.length === 0; i--) {
        const histFragments = extractPlayerFragments(conversationHistory[i]?.content || '');
        if (histFragments.length > 0) {
          players = histFragments;
          console.log('Follow-up context: inferred player from history:', players);
        }
      }
    }

    // BDL search: use short fragment ('jokic'), not full name ('Nikola Jokic' returns 0 results)
    // alias gives us { searchTerm, displayName }; fragment list is the fallback
    const resolved      = resolvePlayerAlias(question);
    const bdlSearchTerm = resolved?.searchTerm || players[0] || null;
    const displayName   = resolved?.displayName || (players[0] ? players[0].charAt(0).toUpperCase() + players[0].slice(1) : null);
    console.log('Alias resolved:', resolved, '| BDL search term:', bdlSearchTerm, '| Display name:', displayName);

    // nba_api microservice — rich advanced data (optional, may not be running)
    try {
      const nbaAvail = await nba.isNBAServiceAvailable().catch(() => false);
      console.log('NBA microservice available:', nbaAvail);
      if (nbaAvail) {
        if (teams.length >= 2) {
          const pregame = await nba.getPregameAnalysis(teams[0], teams[1]).catch(() => null);
          if (pregame) parts.push(`NBA MATCHUP DATA — ${teams[0]} vs ${teams[1]}:\n${nba.formatPregameContext(pregame, teams[0], teams[1])}`);
        } else if (teams.length === 1) {
          const teamId = nba.getTeamId(teams[0]);
          if (teamId) {
            const [dash, last10] = await Promise.allSettled([
              nba.getTeamDashboard(teamId),
              nba.getTeamLastN(teamId, 10),
            ]);
            parts.push(`NBA TEAM DATA — ${teams[0]}:\n${nba.formatPregameContext(
              { home: { dashboard: dash.value, last_10_games: last10.value }, away: null, league: null },
              teams[0], 'opponent'
            )}`);
          }
        }
        if (bdlSearchTerm) {
          const results = await nba.searchPlayers(bdlSearchTerm).catch(() => []);
          if (results?.[0]) {
            const deepDive = await nba.getPlayerDeepDive(results[0].id).catch(() => null);
            if (deepDive) parts.push(`NBA PLAYER ADVANCED DATA — ${results[0].full_name}:\n${nba.formatPlayerContext(deepDive, results[0].full_name)}`);
          }
        }
      }
    } catch (err) {
      console.log('NBA microservice error (non-fatal):', err.message);
    }

    // BallDontLie — per-game stats → compute season/L10/L5 averages
    // NOTE: getSeasonAverages endpoint returns HTTP 400 (API limitation).
    // Per-game stats (getPlayerStats) work correctly and give us all the data we need.
    if (bdlSearchTerm) {
      try {
        console.log('BDL: searching for player fragment:', bdlSearchTerm);
        const found = await bdl.searchPlayers(bdlSearchTerm);
        console.log('BDL search result:', found?.length || 0, found?.[0] ? `"${found[0].first_name} ${found[0].last_name}" id=${found[0].id}` : 'NO MATCH');

        if (found?.[0]) {
          const playerId = found[0].id;
          const pName    = `${found[0].first_name} ${found[0].last_name}`;
          const teamAbbr = found[0].team?.abbreviation || '';

          // Per-game stats — all averages computed from raw game data
          console.log(`BDL: fetching per-game stats for "${pName}" (id=${playerId}) season=${currentNBASeason}`);
          const gameStats = await bdl.getPlayerStats([playerId], [currentNBASeason]);
          console.log('BDL per-game stats rows:', gameStats?.length || 0);

          if (gameStats?.length >= 3) {
            // Sort most recent first; exclude DNPs (min = '0', '00', or missing)
            const played = gameStats
              .filter(g => g.min && g.min !== '0' && g.min !== '00' && (g.pts > 0 || g.reb > 0 || g.ast > 0))
              .sort((a, b) => ((b.game?.date || '') > (a.game?.date || '') ? 1 : -1));

            console.log('BDL games with minutes:', played.length);

            if (played.length >= 3) {
              const num = (arr, f) => arr.reduce((s, g) => s + (Number(g[f]) || 0), 0);
              const avg = (arr, f) => (num(arr, f) / arr.length).toFixed(1);

              const last10 = played.slice(0, 10);
              const last5  = played.slice(0, 5);

              const seasonPts = avg(played, 'pts');
              const seasonReb = avg(played, 'reb');
              const seasonAst = avg(played, 'ast');
              const l10pts    = avg(last10, 'pts');
              const l10reb    = avg(last10, 'reb');
              const l10ast    = avg(last10, 'ast');
              const l5pts     = avg(last5,  'pts');
              const l5reb     = avg(last5,  'reb');
              const l5ast     = avg(last5,  'ast');

              // Game log lines for last 10
              const logLines = last10.map(g => {
                const date = (g.game?.date || '').slice(0, 10);
                const fg   = g.fg_pct != null ? `${(g.fg_pct * 100).toFixed(0)}%` : '?';
                return `${date}  ${String(g.pts).padStart(3)} pts  ${String(g.reb).padStart(3)} reb  ${String(g.ast).padStart(3)} ast  FG:${fg}`;
              });

              parts.push(
                `BALLDONTLIE ${currentNBASeason}-${String(currentNBASeason + 1).slice(2)} STATS — ${pName} (${teamAbbr}) — ${played.length} games played:\n` +
                `SEASON AVG: ${seasonPts} PTS / ${seasonReb} REB / ${seasonAst} AST\n` +
                `L10 AVG:    ${l10pts} PTS / ${l10reb} REB / ${l10ast} AST\n` +
                `L5 AVG:     ${l5pts} PTS / ${l5reb} REB / ${l5ast} AST\n` +
                `\nLAST 10 GAMES:\n` +
                `DATE        PTS  REB  AST  FG%\n` +
                logLines.join('\n')
              );

              console.log(`BDL data built: ${pName} — season ${seasonPts}pts, L10 ${l10pts}pts, L5 ${l5pts}pts`);
            }
          } else {
            console.warn('BDL: not enough game data for', pName, '— only', gameStats?.length, 'rows');
          }
        }
      } catch (err) {
        console.error('BDL API error (will try DB fallback):', err.message);
      }
    }

    // DB game logs — supplement or fallback when BDL data is unavailable
    const dbSearchName = resolved?.displayName || players[0];
    if (dbSearchName) {
      const log = await getPlayerGameLog(dbSearchName, 'NBA', 10);
      console.log('DB game log rows for', dbSearchName, ':', log.length);
      if (log.length >= 3) {
        const l5pts  = computeAvg(log.slice(0, 5), 'points');
        const l10pts = computeAvg(log.slice(0, 10), 'points');
        const l5reb  = computeAvg(log.slice(0, 5), 'rebounds');
        const l10reb = computeAvg(log.slice(0, 10), 'rebounds');
        const l5ast  = computeAvg(log.slice(0, 5), 'assists');
        const l10ast = computeAvg(log.slice(0, 10), 'assists');
        parts.push(
          `DB GAME LOG — ${dbSearchName.toUpperCase()} last ${log.length} games:\n` +
          `L5:  ${l5pts} PTS / ${l5reb} REB / ${l5ast} AST\n` +
          `L10: ${l10pts} PTS / ${l10reb} REB / ${l10ast} AST\n` +
          formatGameLog(log, 'NBA')
        );
      } else {
        console.log('DB game log empty for', dbSearchName, '— relying on BDL API data above');
      }
    }

    // DB team log when no player data needed
    if (teams.length > 0 && !bdlSearchTerm) {
      const teamWord = teams[0].split(' ').pop();
      const tlog = await getTeamGameLog(teamWord, 'NBA', 10);
      console.log('DB team log rows for', teamWord, ':', tlog.length);
      if (tlog.length >= 3) {
        const wins   = tlog.filter(r => r.result === 'W').length;
        const avgPts = computeAvg(tlog, 'points_scored');
        const avgPA  = computeAvg(tlog, 'points_allowed');
        parts.push(
          `DB TEAM LOG — ${teams[0]} last ${tlog.length} games:\n` +
          `Record: ${wins}-${tlog.length - wins}  Avg PTS: ${avgPts}  Avg PA: ${avgPA}\n` +
          formatTeamLog(tlog)
        );
      }
    }
  }

  // ── NHL ─────────────────────────────────────────────────────────────────────
  if (effectiveSport === 'NHL') {
    const teamAbbr = detectNHLTeamAbbr(question);

    // Goalie/injury/roster question → get the actual roster
    if (intent === 'injury' || lower.includes('goalie') || lower.includes('starting') || lower.includes('who starts')) {
      if (teamAbbr) {
        try {
          const roster = await nhlApi.getTeamRoster(teamAbbr).catch(() => null);
          if (roster?.goalies?.length) {
            const goalieList = roster.goalies.map(g =>
              `#${g.sweaterNumber || '?'} ${g.firstName?.default || ''} ${g.lastName?.default || ''}`
            ).join(', ');
            parts.push(`NHL ROSTER — ${teamAbbr} goalies on current roster: ${goalieList}\n(Note: Starting goalie for tonight is typically confirmed ~90 min before puck drop)`);
          }
        } catch {}
      }
    }

    // Team game log from DB
    if (teamAbbr) {
      const tlog = await getTeamGameLog(teamAbbr, 'NHL', 10);
      if (tlog.length >= 3) {
        const wins   = tlog.filter(r => r.result === 'W').length;
        const avgG   = computeAvg(tlog, 'points_scored');
        const avgGA  = computeAvg(tlog, 'points_allowed');
        parts.push(
          `DB TEAM LOG — ${teamAbbr} last ${tlog.length} games:\n` +
          `Record: ${wins}-${tlog.length - wins}  Avg Goals: ${avgG}  Avg GA: ${avgGA}\n` +
          formatTeamLog(tlog)
        );
      }
    }

    // NHL standings for context
    if (intent === 'matchup' || intent === 'general' || (parts.length === 0 && teamAbbr)) {
      try {
        const standings = await nhlApi.getStandings().catch(() => []);
        if (standings?.length) {
          const relevant = teamAbbr
            ? standings.filter(t => t.teamAbbrev?.default === teamAbbr || t.teamName?.default?.toLowerCase().includes(teamAbbr.toLowerCase()))
            : standings.slice(0, 5);
          if (relevant.length) {
            const rows = relevant.map(t => {
              const name = t.teamName?.default || t.teamAbbrev?.default || '';
              return `${name}: ${t.wins}W-${t.losses}L-${t.otLosses || 0}OTL  PTS: ${t.points}  GF/GP: ${t.goalFor != null ? (t.goalFor / Math.max(1, t.gamesPlayed)).toFixed(2) : '-'}  GA/GP: ${t.goalAgainst != null ? (t.goalAgainst / Math.max(1, t.gamesPlayed)).toFixed(2) : '-'}`;
            });
            parts.push(`NHL STANDINGS (current season):\n${rows.join('\n')}`);
          }
        }
      } catch {}
    }
  }

  // ── MLB ─────────────────────────────────────────────────────────────────────
  if (effectiveSport === 'MLB') {
    const teamAbbr = detectMLBTeamAbbr(question);
    const today    = new Date().toISOString().split('T')[0];

    // Weather — always fetch for MLB questions when team/venue detected
    if (teamAbbr) {
      try {
        const wx = await weather.getWeatherForTeam(teamAbbr).catch(() => null);
        if (wx?.weather_available) {
          const windEffect = wx.wind_dir_label && wx.wind_mph
            ? `${wx.wind_dir_label} at ${wx.wind_mph} mph`
            : 'unknown';
          const condition = wx.wind_mph > 15
            ? (wx.wind_mph > 20 ? 'significant wind — hitter-friendly if blowing out' : 'notable wind — check direction')
            : 'light wind — neutral conditions';
          parts.push(
            `WEATHER — ${wx.venue_name} (${teamAbbr}):\n` +
            `Temperature: ${wx.temp_f}°F\n` +
            `Wind: ${windEffect} — ${condition}\n` +
            `Altitude: ${wx.altitude_ft} ft${wx.altitude_ft >= 5000 ? ' (Coors — significant carry boost)' : ''}`
          );
        }
      } catch {}
    }

    // Today's MLB schedule for tonight's games context
    try {
      const mlbDate = toMLBDate(today);
      const games = await mlbStats.getSchedule(mlbDate).catch(() => []);
      if (games?.length) {
        const gameLines = games.slice(0, 8).map(g => {
          const away = g.teams?.away?.team?.name || '';
          const home = g.teams?.home?.team?.name || '';
          const status = g.status?.detailedState || '';
          return `${away} @ ${home} — ${status}`;
        });
        parts.push(`MLB SCHEDULE TODAY (${mlbDate}):\n${gameLines.join('\n')}`);
      }
    } catch {}

    // DB team log
    if (teamAbbr) {
      const tlog = await getTeamGameLog(teamAbbr, 'MLB', 10);
      if (tlog.length >= 3) {
        const wins    = tlog.filter(r => r.result === 'W').length;
        const avgRuns = computeAvg(tlog, 'points_scored');
        const avgRA   = computeAvg(tlog, 'points_allowed');
        parts.push(
          `DB TEAM LOG — ${teamAbbr} last ${tlog.length} games:\n` +
          `Record: ${wins}-${tlog.length - wins}  Avg Runs: ${avgRuns}  Avg RA: ${avgRA}\n` +
          formatTeamLog(tlog)
        );
      }
    }
  }

  // ── Logging ──────────────────────────────────────────────────────────────────
  const contextStr = parts.length > 0 ? parts.join('\n\n') : null;
  console.log('Data parts collected:', parts.length);
  console.log('Data context length:', contextStr ? contextStr.length : 0);
  if (contextStr) console.log('Data context preview:\n', contextStr.substring(0, 600));
  console.log('=============================');

  return { context: contextStr, sport: effectiveSport, intent };
}

// ── Suggestions generator ─────────────────────────────────────────────────────

/**
 * Generate 4 dynamic suggestion pills based on tonight's actual slate.
 * Uses free APIs only: BallDontLie (NBA), NHL API, MLB Stats API.
 */
async function generateSuggestions() {
  const today    = new Date().toISOString().split('T')[0];
  const mlbDate  = toMLBDate(today);

  const fallback = [
    'How has Nikola Jokic been playing this month?',
    "Break down tonight's best NBA matchup",
    "Who are the best value plays on tonight's NHL board?",
    'What does line movement tell you before a game?',
  ];

  const suggestions = [];

  // Fetch all three schedules in parallel
  const [nbaResult, nhlResult, mlbResult] = await Promise.allSettled([
    bdl.getGames(today).catch(() => []),
    nhlApi.getScheduleNow().catch(() => []),
    mlbStats.getSchedule(mlbDate).catch(() => []),
  ]);

  // NBA suggestion
  const nbaGames = nbaResult.status === 'fulfilled' ? (nbaResult.value || []) : [];
  if (nbaGames.length > 0) {
    const g = nbaGames[0];
    const home    = g.home_team?.full_name    || g.home_team?.name    || '';
    const visitor = g.visitor_team?.full_name || g.visitor_team?.name || '';
    if (home && visitor) {
      const homeShort    = home.split(' ').pop();
      const visitorShort = visitor.split(' ').pop();
      suggestions.push(`Break down tonight's ${visitorShort} vs ${homeShort} matchup`);
    }
  }

  // NHL suggestion — goalie focus
  const nhlGames = nhlResult.status === 'fulfilled' ? (nhlResult.value || []) : [];
  if (nhlGames.length > 0) {
    const g = nhlGames[0];
    const home    = g.homeTeam?.placeName?.default || g.homeTeam?.abbrev || '';
    const away    = g.awayTeam?.placeName?.default || g.awayTeam?.abbrev || '';
    if (home) {
      suggestions.push(`Who is starting in goal for the ${home} tonight?`);
    } else if (away) {
      suggestions.push(`Break down tonight's ${away} vs ${home || 'opponent'} matchup`);
    }
  }

  // MLB suggestion — weather focus when there are games
  const mlbGames = mlbResult.status === 'fulfilled' ? (mlbResult.value || []) : [];
  if (mlbGames.length > 0) {
    const g = mlbGames[0];
    const away = g.teams?.away?.team?.name || '';
    const home = g.teams?.home?.team?.name || '';
    if (home && away) {
      const homeShort = home.split(' ').pop();
      const awayShort = away.split(' ').pop();
      suggestions.push(`What are the conditions for the ${awayShort} vs ${homeShort} game tonight?`);
    }
  }

  // Round out to 4 with a general education/betting question
  const generals = [
    'What does line movement tell you before a game?',
    'How do I read a puck line vs moneyline for NHL?',
    'What makes a good value bet on player props?',
    'How do park factors affect MLB totals?',
    'What is sharp money and how does it move lines?',
    'How do back-to-back situations affect NBA totals?',
    'What is the difference between spread and moneyline?',
  ];
  while (suggestions.length < 4) {
    const idx = (new Date().getDay() + suggestions.length) % generals.length;
    suggestions.push(generals[idx]);
  }

  console.log('[Research] Suggestions generated:', suggestions);
  return suggestions.slice(0, 4);
}

// ── Response depth classifier ─────────────────────────────────────────────────

/**
 * Classifies how detailed the response should be based on question phrasing.
 * Returns: 'brief' | 'standard' | 'detailed'
 */
function classifyDepth(question) {
  const lower = question.toLowerCase().trim();

  // DETAILED — explicit analysis requests or comparisons
  if ([
    'break down', 'deep dive', 'full analysis', 'full breakdown', 'everything about',
    'in depth', 'in-depth', 'compare', 'walk me through', 'all of his', 'give me all',
    'historically', 'head to head', 'h2h', 'this season', 'over the season',
    'full picture', 'comprehensive', 'run me through',
  ].some(t => lower.includes(t))) return 'detailed';

  // BRIEF — single stat lookup or yes/no questions
  if ([
    'is he playing', 'is lebron', 'is jokic', 'is mcdavid', 'is ohtani',
    'who starts', 'who is starting', 'starting in goal', 'who is the starter',
    'what is the spread', 'what is the line', 'what is the over', "what's the spread",
    "what's the line", "what's the over", 'the o/u', 'what is the o',
    'is the wind', 'weather at', 'temperature at',
    'how many goals', 'how many points', 'how many home runs',
  ].some(t => lower.includes(t))) return 'brief';

  // BRIEF — short question (≤8 words) starting with a lookup phrase
  const wordCount = lower.split(/\s+/).length;
  if (wordCount <= 8 && ['what is', "what's", 'how many', 'who is'].some(t => lower.startsWith(t))) return 'brief';

  return 'standard';
}

// ── Visual type hint ──────────────────────────────────────────────────────────

/**
 * Returns a hint string for the system prompt telling Claude which visualData
 * type to populate based on the detected question intent.
 */
function buildVisualHint(intent, depth) {
  if (depth === 'brief' && (intent === 'injury' || intent === 'education')) {
    return 'Set visualData to null — text only answer, no visual needed.';
  }
  if (intent === 'education') return 'Set visualData to null — educational answers need no visual.';
  if (intent === 'injury')    return 'Set visualData to null — roster/availability answers need no visual.';
  if (intent === 'weather')   return 'Set visualData to null — weather text answer only.';

  if (intent === 'prop') {
    return (
      'Set visualData.type to "last10_grid". ' +
      'Populate: playerName (string), statLabel (e.g. "Points"), propLine (number from data or null), ' +
      'games: array of up to 10 objects each with {date: "MM/DD", opp: "XXX", value: number, overLine: boolean}, ' +
      'average (number), overCount (integer), underCount (integer). ' +
      'Use the game log rows from the data context to fill in the games array. ' +
      'overLine means the value exceeded the propLine. If no propLine, use the L10 average as the line.'
    );
  }

  if (intent === 'trend') {
    return (
      'Set visualData.type to "trend_chart". ' +
      'Populate: playerName (string), statLabel (e.g. "Points"), propLine (number or null), ' +
      'dataPoints: array of up to 20 objects each with {game: integer index starting at 1, value: number, date: "MM/DD", opp: "XXX"}, ' +
      'seasonAvg (number), l10Avg (number), l5Avg (number). ' +
      'Use all game log rows from the data context, oldest to newest.'
    );
  }

  if (intent === 'matchup') {
    return (
      'Set visualData.type to "comparison_bar". ' +
      'Populate: label (e.g. "DEN vs PHX — Tonight"), sport (string), ' +
      'stats: array of 3-6 objects each with {label, awayValue: number, homeValue: number, awayTeam: "XXX", homeTeam: "XXX", higherIsBetter: boolean}. ' +
      'Use team stats from the data context. Only include stats where you have real numbers for both teams.'
    );
  }

  if (intent === 'player' || intent === 'general') {
    return (
      'Set visualData.type to "stat_card". ' +
      'Populate: playerName (string), team (abbreviation string), sport (string), ' +
      'stats: array of 3-4 objects each with {label: e.g. "PPG", value: string, context: e.g. "L10"}, ' +
      'trend: "up" | "down" | "neutral", trendLabel: e.g. "4.2 above season avg". ' +
      'Use the most recent data from the data context.'
    );
  }

  return 'Set visualData to null if no clear visual adds value.';
}

module.exports = { buildDataContext, generateSuggestions, isOffTopic, detectSport, detectIntent, classifyDepth, buildVisualHint };
