/**
 * researchTools.js — Tool implementations for Claude tool use in Research tab
 * Each function returns a plain string that Claude reads and cites from.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const bdl         = require('./ballDontLie');
const nhlApi      = require('./nhlApi');
const mlbStats    = require('./mlbStats');
const oddsService = require('./oddsService');
const weather     = require('./weatherService');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCurrentNBASeason() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

function toMLBDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// Always use Eastern Time for schedule lookups — avoids midnight UTC/ET date flip
function getTodayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Build a schedule-confirmation banner from a tool result string
// Prepended before sending to Claude so it cannot hallucinate tonight's opponent
function scheduleConfirmedBanner(playerLabel, result) {
  // Extract tonight's game line from the result
  const line = result.split('\n').find(l =>
    l.startsWith("TONIGHT'S GAME:") || l.startsWith("TONIGHT:") ||
    /^TONIGHT.*:/.test(l)
  );
  if (!line) return '';
  const detail = line.replace(/^TONIGHT'S GAME:|^TONIGHT:/, '').trim();
  return `✅ SCHEDULE CONFIRMED (live API): ${playerLabel} plays tonight — ${detail}\nThis is the ONLY valid game for tonight. Do NOT reference any other matchup.\n`;
}

function noGameBanner(playerLabel, sport) {
  return `⛔ SCHEDULE CHECK: ${playerLabel} has NO GAME tonight per live ${sport} schedule API. Do NOT mention any opponent or game time. Do NOT use training data to fill in a game.\n`;
}

function currentTeamBanner(playerLabel, teamName, apiSource) {
  return `✅ CURRENT TEAM (live ${apiSource}): ${playerLabel} currently plays for the ${teamName}. Do NOT reference any previous team — training data about this player's team may be outdated.\n`;
}

function statsSourceBanner() {
  return `✅ STATS SOURCE: All statistics below are from live database and API queries for the current season. Do NOT cite any statistic from training knowledge — only use numbers explicitly listed below.\n`;
}

// ── Player alias map ──────────────────────────────────────────────────────────
// Format: alias → [bdl_search_term, display_name]
// BDL search requires short fragments — full names return 0 results

const PLAYER_ALIASES = {
  // ── NBA — last names ────────────────────────────────────────────────────────
  'jokic':              ['jokic',         'Nikola Jokic'],
  'joker':              ['jokic',         'Nikola Jokic'],
  'nikola jokic':       ['jokic',         'Nikola Jokic'],
  'nikola':             ['jokic',         'Nikola Jokic'],
  'luka':               ['doncic',        'Luka Doncic'],
  'doncic':             ['doncic',        'Luka Doncic'],
  'giannis':            ['antetokounmpo', 'Giannis Antetokounmpo'],
  'greek freak':        ['antetokounmpo', 'Giannis Antetokounmpo'],
  'lebron':             ['james',         'LeBron James'],
  'bron':               ['james',         'LeBron James'],
  'steph':              ['stephen',       'Stephen Curry'],
  'steph curry':        ['stephen',       'Stephen Curry'],
  'sga':                ['gilgeous',      'Shai Gilgeous-Alexander'],
  'shai':               ['gilgeous',      'Shai Gilgeous-Alexander'],
  'kd':                 ['durant',        'Kevin Durant'],
  'kevin durant':       ['durant',        'Kevin Durant'],
  'embiid':             ['embiid',        'Joel Embiid'],
  'jo embiid':          ['embiid',        'Joel Embiid'],
  'tatum':              ['tatum',         'Jayson Tatum'],
  'jayson':             ['tatum',         'Jayson Tatum'],
  'jt':                 ['tatum',         'Jayson Tatum'],
  'wemby':              ['wembanyama',    'Victor Wembanyama'],
  'wembanyama':         ['wembanyama',    'Victor Wembanyama'],
  'victor':             ['wembanyama',    'Victor Wembanyama'],
  'ja':                 ['morant',        'Ja Morant'],
  'morant':             ['morant',        'Ja Morant'],
  'dame':               ['lillard',       'Damian Lillard'],
  'lillard':            ['lillard',       'Damian Lillard'],
  'lamelo':             ['lamelo',        'LaMelo Ball'],
  'booker':             ['booker',        'Devin Booker'],
  'dbook':              ['booker',        'Devin Booker'],
  'devin':              ['booker',        'Devin Booker'],
  'bam':                ['adebayo',       'Bam Adebayo'],
  'adebayo':            ['adebayo',       'Bam Adebayo'],
  'kat':                ['towns',         'Karl-Anthony Towns'],
  'towns':              ['towns',         'Karl-Anthony Towns'],
  'karl':               ['towns',         'Karl-Anthony Towns'],
  'fox':                ['fox',           "De'Aaron Fox"],
  'ant':                ['edwards',       'Anthony Edwards'],
  'ant man':            ['edwards',       'Anthony Edwards'],
  'edwards':            ['edwards',       'Anthony Edwards'],
  'brunson':            ['brunson',       'Jalen Brunson'],
  'jalen':              ['brunson',       'Jalen Brunson'],
  'maxey':              ['maxey',         'Tyrese Maxey'],
  'hali':               ['haliburton',    'Tyrese Haliburton'],
  'haliburton':         ['haliburton',    'Tyrese Haliburton'],
  'tyrese':             ['haliburton',    'Tyrese Haliburton'],
  // Cade Cunningham — MUST use first name to disambiguate from Dante Cunningham
  'cade':               ['cade cunningham',  'Cade Cunningham'],
  'cade cunningham':    ['cade cunningham',  'Cade Cunningham'],
  'cunningham':         ['cade cunningham',  'Cade Cunningham'],
  'banchero':           ['banchero',      'Paolo Banchero'],
  'paolo':              ['banchero',      'Paolo Banchero'],
  'mitchell':           ['mitchell',      'Donovan Mitchell'],
  'donovan':            ['mitchell',      'Donovan Mitchell'],
  'zion':               ['williamson',    'Zion Williamson'],
  'ingram':             ['ingram',        'Brandon Ingram'],
  'randle':             ['randle',        'Julius Randle'],
  'julius':             ['randle',        'Julius Randle'],
  'butler':             ['butler',        'Jimmy Butler'],
  'franz':              ['wagner',        'Franz Wagner'],
  'wagner':             ['wagner',        'Franz Wagner'],
  'jaylen':             ['jaylen brown',  'Jaylen Brown'],
  'jaylen brown':       ['jaylen brown',  'Jaylen Brown'],
  'pascal':             ['siakam',        'Pascal Siakam'],
  'siakam':             ['siakam',        'Pascal Siakam'],
  'scottie':            ['barnes',        'Scottie Barnes'],
  'barnes':             ['barnes',        'Scottie Barnes'],
  'evan':               ['mobley',        'Evan Mobley'],
  'mobley':             ['mobley',        'Evan Mobley'],
  'darius':             ['garland',       'Darius Garland'],
  'garland':            ['garland',       'Darius Garland'],
  'alperen':            ['sengun',        'Alperen Sengun'],
  'sengun':             ['sengun',        'Alperen Sengun'],
  'mikal':              ['bridges',       'Mikal Bridges'],
  'bridges':            ['bridges',       'Mikal Bridges'],
  'og':                 ['anunoby',       'OG Anunoby'],
  'anunoby':            ['anunoby',       'OG Anunoby'],
  'rj':                 ['barrett',       'RJ Barrett'],
  'barrett':            ['barrett',       'RJ Barrett'],
  'immanuel':           ['quickley',      'Immanuel Quickley'],
  'quickley':           ['quickley',      'Immanuel Quickley'],
  'keldon':             ['johnson',       'Keldon Johnson'],
  'zach':               ['lavine',        'Zach LaVine'],
  'lavine':             ['lavine',        'Zach LaVine'],
  'coby':               ['white',         'Coby White'],
  'rudy':               ['gobert',        'Rudy Gobert'],
  'gobert':             ['gobert',        'Rudy Gobert'],
  'mike conley':        ['conley',        'Mike Conley'],
  // ── NHL — stats fetched from NHL API not BDL ────────────────────────────────
  'mcdavid':            ['mcdavid',       'Connor McDavid'],
  'draisaitl':          ['draisaitl',     'Leon Draisaitl'],
  'leon':               ['draisaitl',     'Leon Draisaitl'],
  'matthews':           ['matthews',      'Auston Matthews'],
  'auston':             ['matthews',      'Auston Matthews'],
  'marner':             ['marner',        'Mitch Marner'],
  'mitch':              ['marner',        'Mitch Marner'],
  'nylander':           ['nylander',      'William Nylander'],
  'william':            ['nylander',      'William Nylander'],
  'crosby':             ['crosby',        'Sidney Crosby'],
  'sid':                ['crosby',        'Sidney Crosby'],
  'ovechkin':           ['ovechkin',      'Alex Ovechkin'],
  'ovi':                ['ovechkin',      'Alex Ovechkin'],
  'pasta':              ['pastrnak',      'David Pastrnak'],
  'pastrnak':           ['pastrnak',      'David Pastrnak'],
  'david':              ['pastrnak',      'David Pastrnak'],
  'makar':              ['makar',         'Cale Makar'],
  'cale':               ['makar',         'Cale Makar'],
  'mackinnon':          ['mackinnon',     'Nathan MacKinnon'],
  'nathan':             ['mackinnon',     'Nathan MacKinnon'],
  'rantanen':           ['rantanen',      'Mikko Rantanen'],
  'mikko':              ['rantanen',      'Mikko Rantanen'],
  'hedman':             ['hedman',        'Victor Hedman'],
  'tkachuk':            ['tkachuk',       'Matthew Tkachuk'],
  'matthew':            ['tkachuk',       'Matthew Tkachuk'],
  'brady tkachuk':      ['brady tkachuk', 'Brady Tkachuk'],
  'brady':              ['brady tkachuk', 'Brady Tkachuk'],
  'vasilevskiy':        ['vasilevskiy',   'Andrei Vasilevskiy'],
  'vasi':               ['vasilevskiy',   'Andrei Vasilevskiy'],
  'demko':              ['demko',         'Thatcher Demko'],
  'caufield':           ['caufield',      'Cole Caufield'],
  'cole':               ['caufield',      'Cole Caufield'],
  'hughes':             ['hughes',        'Quinn Hughes'],
  'quinn':              ['hughes',        'Quinn Hughes'],
  'pettersson':         ['pettersson',    'Elias Pettersson'],
  'elias':              ['pettersson',    'Elias Pettersson'],
  'boeser':             ['boeser',        'Brock Boeser'],
  'brock':              ['boeser',        'Brock Boeser'],
  'marchand':           ['marchand',      'Brad Marchand'],
  'brad':               ['marchand',      'Brad Marchand'],
  'mcavoy':             ['mcavoy',        'Charlie McAvoy'],
  'charlie':            ['mcavoy',        'Charlie McAvoy'],
  'suzuki':             ['suzuki',        'Nick Suzuki'],
  'nick':               ['suzuki',        'Nick Suzuki'],
  'stutzle':            ['stutzle',       'Tim Stutzle'],
  'tim':                ['stutzle',       'Tim Stutzle'],
  'josi':               ['josi',          'Roman Josi'],
  'roman':              ['josi',          'Roman Josi'],
  'scheifele':          ['scheifele',     'Mark Scheifele'],
  'mark':               ['scheifele',     'Mark Scheifele'],
  'kyle connor':        ['kyle connor',   'Kyle Connor'],
  'hellebuyck':         ['hellebuyck',    'Connor Hellebuyck'],
  // ── MLB — stats fetched from MLB Stats API not BDL ──────────────────────────
  'judge':              ['judge',         'Aaron Judge'],
  'aaron judge':        ['judge',         'Aaron Judge'],
  'ohtani':             ['ohtani',        'Shohei Ohtani'],
  'shohei':             ['ohtani',        'Shohei Ohtani'],
  'trout':              ['trout',         'Mike Trout'],
  'betts':              ['betts',         'Mookie Betts'],
  'mookie':             ['betts',         'Mookie Betts'],
  'tatis':              ['tatis',         'Fernando Tatis Jr.'],
  'fernando':           ['tatis',         'Fernando Tatis Jr.'],
  'acuna':              ['acuna',         'Ronald Acuña Jr.'],
  'acuña':              ['acuna',         'Ronald Acuña Jr.'],
  'vlad':               ['guerrero',      'Vladimir Guerrero Jr.'],
  'guerrero':           ['guerrero',      'Vladimir Guerrero Jr.'],
  'vladimir':           ['guerrero',      'Vladimir Guerrero Jr.'],
  'devers':             ['devers',        'Rafael Devers'],
  'rafael':             ['devers',        'Rafael Devers'],
  'yordan':             ['yordan',        'Yordan Alvarez'],
  'alvarez':            ['yordan',        'Yordan Alvarez'],
  'freeman':            ['freeman',       'Freddie Freeman'],
  'freddie':            ['freeman',       'Freddie Freeman'],
  'soto':               ['soto',          'Juan Soto'],
  'juan':               ['soto',          'Juan Soto'],
  'alonso':             ['alonso',        'Pete Alonso'],
  'pete':               ['alonso',        'Pete Alonso'],
  'lindor':             ['lindor',        'Francisco Lindor'],
  'francisco':          ['lindor',        'Francisco Lindor'],
  'bogaerts':           ['bogaerts',      'Xander Bogaerts'],
  'xander':             ['bogaerts',      'Xander Bogaerts'],
  'bichette':           ['bichette',      'Bo Bichette'],
  'bo':                 ['bichette',      'Bo Bichette'],
  'bellinger':          ['bellinger',     'Cody Bellinger'],
  'cody':               ['bellinger',     'Cody Bellinger'],
  'altuve':             ['altuve',        'Jose Altuve'],
  'jose':               ['altuve',        'Jose Altuve'],
  'bregman':            ['bregman',       'Alex Bregman'],
  'alex':               ['bregman',       'Alex Bregman'],
  'wheeler':            ['wheeler',       'Zack Wheeler'],
  'zack':               ['wheeler',       'Zack Wheeler'],
  'degrom':             ['degrom',        'Jacob deGrom'],
  'gerrit cole':        ['cole',          'Gerrit Cole'],
  'gerrit':             ['cole',          'Gerrit Cole'],
  'alcantara':          ['alcantara',     'Sandy Alcantara'],
  'sandy':              ['alcantara',     'Sandy Alcantara'],
  'strider':            ['strider',       'Spencer Strider'],
  'spencer':            ['strider',       'Spencer Strider'],
  'snell':              ['snell',         'Blake Snell'],
  'blake':              ['snell',         'Blake Snell'],
  'harper':             ['harper',        'Bryce Harper'],
};

function resolveAlias(input) {
  const lower = (input || '').toLowerCase().trim();
  // Longest match first to avoid 'sid' matching before 'sidney crosby'
  const sorted = Object.entries(PLAYER_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, [searchTerm, displayName]] of sorted) {
    if (lower === alias || lower.includes(alias)) return { searchTerm, displayName };
  }
  return null;
}

// NHL player → team abbreviation (needed to look up roster)
const NHL_PLAYER_TEAMS = {
  'mcdavid': 'EDM',    'draisaitl': 'EDM',    'leon draisaitl': 'EDM',
  'matthews': 'TOR',   'marner': 'TOR',        'nylander': 'TOR',
  'crosby': 'PIT',     'malkin': 'PIT',        'letang': 'PIT',
  'ovechkin': 'WSH',   'ovi': 'WSH',
  'mackinnon': 'COL',  'makar': 'COL',         'rantanen': 'COL',
  'hedman': 'TBL',     'point': 'TBL',         'vasilevskiy': 'TBL', 'vasi': 'TBL', 'kucherov': 'TBL',
  'tkachuk': 'FLA',    'barkov': 'FLA',        'reinhart': 'FLA',
  'pasta': 'BOS',      'pastrnak': 'BOS',      'marchand': 'BOS',
  'hughes': 'VAN',     'demko': 'VAN',         'pettersson': 'VAN',
  'caufield': 'MTL',   'suzuki': 'MTL',
  'robertson': 'DAL',  'heiskanen': 'DAL',     'oettinger': 'DAL',
  'aho': 'CAR',        'svechnikov': 'CAR',
  'eichel': 'VGK',     'stone': 'VGK',
  'drury': 'NYR',      'panarin': 'NYR',       'shesterkin': 'NYR',
};

// MLB player → team abbreviation
const MLB_PLAYER_TEAMS = {
  'judge': 'NYY',      'aaron judge': 'NYY',   'gerrit cole': 'NYY',   'juan soto': 'NYY',
  'ohtani': 'LAD',     'betts': 'LAD',         'mookie': 'LAD',        'freeman': 'LAD',
  'devers': 'BOS',
  'acuna': 'ATL',      'acuña': 'ATL',         'strider': 'ATL',
  'vlad': 'TOR',       'guerrero': 'TOR',
  'yordan': 'HOU',     'alvarez': 'HOU',        'altuve': 'HOU',
  'tatis': 'SDP',      'machado': 'SDP',
  'trout': 'LAA',
  'wheeler': 'PHI',    'harper': 'PHI',
  'degrom': 'TEX',     'seager': 'TEX',
};

// MLB team keyword → abbreviation (for weather lookup)
const MLB_TEAM_ABBR = {
  'yankees': 'NYY',   'dodgers': 'LAD',   'red sox': 'BOS',   'cubs': 'CHC',
  'braves': 'ATL',    'astros': 'HOU',    'phillies': 'PHI',  'padres': 'SDP',
  'blue jays': 'TOR', 'angels': 'LAA',    'rangers': 'TEX',   'mets': 'NYM',
  'cardinals': 'STL', 'giants': 'SFG',    'mariners': 'SEA',  'orioles': 'BAL',
  'rays': 'TBR',      'tigers': 'DET',    'twins': 'MIN',     'white sox': 'CWS',
  'guardians': 'CLE', 'royals': 'KCR',    'pirates': 'PIT',   'reds': 'CIN',
  'rockies': 'COL',   'marlins': 'MIA',   'nationals': 'WSN', 'brewers': 'MIL',
  'diamondbacks': 'ARI', 'dbacks': 'ARI', 'athletics': 'OAK',
};

// ── Tool 1: NBA player stats (delegates to masterDataFetch) ───────────────────

async function get_nba_player_stats({ player_name }) {
  const { getNBAPlayerComplete } = require('./masterDataFetch');
  const resolved    = resolveAlias(player_name);
  const searchName  = resolved?.searchTerm || player_name;
  const displayHint = resolved?.displayName || player_name;

  // Fetch current team from live BDL API for CURRENT TEAM banner
  const found    = await bdl.searchPlayers(searchName).catch(() => null);
  const teamName = found?.[0]?.team?.full_name || '';
  const teamBnr  = teamName ? currentTeamBanner(displayHint, teamName, 'BallDontLie') : '';
  const statsBnr = statsSourceBanner();

  const result = await getNBAPlayerComplete(searchName, displayHint);
  if (!result) return `No NBA player found matching "${player_name}". Try their full last name.`;

  if (result.includes('NOT PLAYING TONIGHT')) {
    return `⛔ SCHEDULE CHECK: ${displayHint} has NO GAME tonight. Their team is not on the live schedule. Do NOT mention any opponent or game time for tonight.\n${teamBnr}${statsBnr}\n${result}`;
  }
  const schedBnr = scheduleConfirmedBanner(displayHint, result);
  return `${schedBnr}${teamBnr}${statsBnr}\n${result}`;
}

// ── Tool 2: Prop lines ─────────────────────────────────────────────────────────

async function get_prop_lines({ player_name, sport }) {
  const fmt = n => (n > 0 ? `+${n}` : `${n}`);

  if (sport === 'NBA') {
    const resolved = resolveAlias(player_name);
    const bdlTerm  = resolved?.searchTerm || player_name.split(' ').pop().toLowerCase();
    const dName    = resolved?.displayName || player_name;

    const found = await bdl.searchPlayers(bdlTerm);
    if (!found?.[0]) return `No NBA player found matching "${dName}".`;

    const pName    = `${found[0].first_name} ${found[0].last_name}`;
    const teamName = found[0].team?.full_name || '';
    const teamAbbr = found[0].team?.abbreviation || '';
    const teamWord = teamName.split(' ').pop().toLowerCase();

    // Step 1: Check BDL schedule first — this is authoritative for "playing tonight"
    // The Odds API lists games days in advance and is NOT reliable for tonight-only checks
    const today    = getTodayET();
    const bdlGames = await bdl.getGames(today).catch(() => []);
    const bdlGame  = (bdlGames || []).find(g =>
      g.home_team?.abbreviation === teamAbbr || g.visitor_team?.abbreviation === teamAbbr
    );

    if (!bdlGame) {
      // Team has no game tonight per BDL — return immediately, no game time, no opponent
      return `⛔ LINES: ${pName} (${teamAbbr}) — Team has NO GAME tonight per live BDL schedule. Do NOT mention any tip-off time or opponent. No prop lines available.\n${pName} — ${teamName} is not on tonight's NBA schedule. There are no prop lines to show.`;
    }

    // Step 2: Team confirmed playing tonight — now check Odds API for lines
    const bdlIsHome  = bdlGame.home_team?.abbreviation === teamAbbr;
    const bdlOpp     = bdlIsHome
      ? (bdlGame.visitor_team?.full_name || bdlGame.visitor_team?.abbreviation)
      : (bdlGame.home_team?.full_name    || bdlGame.home_team?.abbreviation);
    const bdlRawTime = bdlGame.status || '';
    const gameTimeET = bdlRawTime.includes('T')
      ? new Date(bdlRawTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
      : '';

    const events = await oddsService.fetchEvents('NBA').catch(() => []);
    const event  = events?.find(e =>
      e.home_team?.toLowerCase().includes(teamWord) ||
      e.away_team?.toLowerCase().includes(teamWord)
    );

    // Use BDL-confirmed opponent and time (not Odds API time which can be stale/future)
    const isHome = bdlIsHome;
    const opp    = bdlOpp;

    const MARKETS = [
      'player_points', 'player_rebounds', 'player_assists', 'player_threes',
      'player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists',
    ].join(',');
    const LABELS = {
      player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
      player_threes: 'Threes', player_points_rebounds_assists: 'PRA',
      player_points_rebounds: 'P+R', player_points_assists: 'P+A',
    };

    // event may be null if Odds API hasn't listed the game yet — that's fine, just means no lines
    const propsData = event?.id
      ? await oddsService.fetchEventProps('NBA', event.id, MARKETS).catch(() => null)
      : null;

    // Normalize for accent-insensitive matching (Jokić vs Jokic etc.)
    const normName = s => (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z\s]/g, '').trim();
    const pNorm = normName(pName);

    const lines = [];

    if (propsData?.bookmakers?.length) {
      // Prefer DraftKings, fallback to FanDuel, fallback to first bookmaker
      const dk = propsData.bookmakers.find(b => b.key === 'draftkings');
      const fd = propsData.bookmakers.find(b => b.key === 'fanduel');
      const bm = dk || fd || propsData.bookmakers[0];

      if (bm) {
        for (const mkt of (bm.markets || [])) {
          const label = LABELS[mkt.key];
          if (!label) continue;
          // Odds API: name = "Over"/"Under", description = player name
          const over  = mkt.outcomes?.find(o => o.name === 'Over'  && normName(o.description) === pNorm);
          const under = mkt.outcomes?.find(o => o.name === 'Under' && normName(o.description) === pNorm);
          if (over?.point != null && over?.price != null && under?.price != null) {
            // Include both books when available
            let oddsStr = `Over ${fmt(over.price)} / Under ${fmt(under.price)} [${bm.title}]`;
            if (dk && fd) {
              const otherBm  = bm.key === 'draftkings' ? fd : dk;
              const otherMkt = otherBm.markets?.find(m => m.key === mkt.key);
              const o2 = otherMkt?.outcomes?.find(o => o.name === 'Over'  && normName(o.description) === pNorm);
              const u2 = otherMkt?.outcomes?.find(o => o.name === 'Under' && normName(o.description) === pNorm);
              if (o2?.price != null && u2?.price != null) {
                oddsStr += ` | Over ${fmt(o2.price)} / Under ${fmt(u2.price)} [${otherBm.title}]`;
              }
            }
            lines.push(`  ${label}: O/U ${over.point} — ${oddsStr}`);
          }
        }
      }
    }

    if (lines.length === 0) {
      return `⚠️ LINES: ${pName} is on the schedule tonight but prop lines are NOT yet posted. Do NOT quote any specific line number.\n${pName} — Tonight (${isHome ? 'home' : 'away'}) vs ${opp} at ${gameTimeET}.\nNo prop lines found yet for this player. Lines may not be posted until closer to tip-off.`;
    }

    return [`✅ LINES CONFIRMED (live Odds API): ${pName} vs ${opp} — ${lines.length} markets found. Only cite lines from the list below.\n`, `${pName} PROP LINES — Tonight vs ${opp} at ${gameTimeET}:`, ...lines].join('\n');
  }

  return `Prop lines for ${sport} are not yet available. Ask about NBA props for now.`;
}

// ── Tool 3: Injury / availability status ──────────────────────────────────────

async function get_injury_status({ player_name, sport }) {
  const today = getTodayET();

  if (sport === 'NBA') {
    const resolved = resolveAlias(player_name);
    const bdlTerm  = resolved?.searchTerm || player_name.split(' ').pop().toLowerCase();
    const dName    = resolved?.displayName || player_name;

    const found = await bdl.searchPlayers(bdlTerm);
    if (!found?.[0]) return `No NBA player found matching "${dName}".`;

    const pName    = `${found[0].first_name} ${found[0].last_name}`;
    const abbr     = found[0].team?.abbreviation || '';
    const teamName = found[0].team?.full_name || '';

    const [injuries, games] = await Promise.all([
      bdl.getInjuries().catch(() => []),
      bdl.getGames(today).catch(() => []),
    ]);

    const injury = (injuries || []).find(i => {
      const n = `${i.player?.first_name || ''} ${i.player?.last_name || ''}`.toLowerCase();
      return n.includes((found[0].last_name || '').toLowerCase());
    });

    const game = (games || []).find(g =>
      g.home_team?.abbreviation === abbr || g.visitor_team?.abbreviation === abbr
    );

    const isOut = (injury?.status || '').toLowerCase().includes('out');
    const isGTD = injury && !isOut;

    // Availability banner — prepended so Claude cannot ignore it
    let availBanner;
    if (!game) {
      availBanner = `⛔ SCHEDULE CHECK: ${pName}'s team (${abbr}) is NOT on tonight's NBA schedule. Do NOT say they are playing tonight.\n`;
    } else if (isOut) {
      availBanner = `⛔ AVAILABILITY: ${pName} is listed OUT. Do NOT say they are playing or expected to play tonight.\n`;
    } else if (isGTD) {
      availBanner = `⚠️ AVAILABILITY: ${pName} is a game-time decision (${(injury.status || '').toUpperCase()}). Do NOT say they are definitely playing.\n`;
    } else {
      availBanner = `✅ AVAILABILITY: ${pName} shows no injury designation — expected active per live BDL data.\n`;
    }

    const out = [availBanner, `${pName} (${abbr}):`];
    out.push(injury
      ? `Injury report: ${(injury.status || '').toUpperCase()} — ${injury.description || ''}`
      : `Injury report: No designation — assumed active`
    );

    if (game) {
      const isHome = game.home_team?.abbreviation === abbr;
      const opp    = isHome
        ? (game.visitor_team?.full_name || game.visitor_team?.abbreviation)
        : (game.home_team?.full_name    || game.home_team?.abbreviation);
      const rawSt  = game.status || '';
      const timeET = rawSt.includes('T')
        ? new Date(rawSt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
        : rawSt;
      out.push(`Tonight: ${teamName} (${isHome ? 'home' : 'away'}) vs ${opp} — ${timeET}`);
      out.push(
        isOut ? 'Verdict: Will NOT play tonight.' :
        isGTD ? 'Verdict: Game-time decision — check ~1 hour before tip.' :
        'Verdict: Expected to play.'
      );
    } else {
      out.push(`${teamName} is NOT on tonight's schedule.`);
    }
    return out.join('\n');
  }

  if (sport === 'NHL') {
    const lower    = player_name.toLowerCase();
    const resolved = resolveAlias(lower);
    const pName    = resolved?.displayName || player_name;
    const teamAbbr = NHL_PLAYER_TEAMS[lower] || null;
    const games    = await nhlApi.getSchedule(today).catch(() => []);
    const game     = teamAbbr
      ? games?.find(g => g.homeTeam?.abbrev === teamAbbr || g.awayTeam?.abbrev === teamAbbr)
      : null;

    if (game) {
      const isHome = game.homeTeam?.abbrev === teamAbbr;
      const opp    = isHome
        ? (game.awayTeam?.placeName?.default || game.awayTeam?.abbrev)
        : (game.homeTeam?.placeName?.default || game.homeTeam?.abbrev);
      const timeET = game.startTimeUTC
        ? new Date(game.startTimeUTC).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
        : '';
      return `✅ SCHEDULE CONFIRMED: ${pName} (${teamAbbr}) plays tonight vs ${opp}.\n${pName} (${teamAbbr}) — Tonight (${isHome ? 'home' : 'away'}) vs ${opp} at ${timeET}.\nNo real-time injury API for NHL. Check official team injury report ~2 hours before puck drop.`;
    } else if (teamAbbr) {
      return `⛔ SCHEDULE CHECK: ${pName} (${teamAbbr}) — Team is NOT on tonight's NHL schedule. Do NOT say they are playing tonight.\n${pName} (${teamAbbr}) — Team is not on tonight's NHL schedule.`;
    }
    return `Could not determine NHL team for "${player_name}". Try the player's last name.`;
  }

  if (sport === 'MLB') {
    const lower    = player_name.toLowerCase();
    const resolved = resolveAlias(lower);
    const pName    = resolved?.displayName || player_name;
    const teamAbbr = MLB_PLAYER_TEAMS[lower] || null;
    const mlbDate  = toMLBDate(today);
    const games    = await mlbStats.getSchedule(mlbDate).catch(() => []);
    const game     = teamAbbr
      ? games?.find(g =>
          (g.teams?.home?.team?.abbreviation || '') === teamAbbr ||
          (g.teams?.away?.team?.abbreviation || '') === teamAbbr
        )
      : null;

    if (game) {
      const isHome = (game.teams?.home?.team?.abbreviation || '') === teamAbbr;
      const opp    = isHome ? game.teams?.away?.team?.name : game.teams?.home?.team?.name;
      const timeET = game.gameDate
        ? new Date(game.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
        : '';
      return `✅ SCHEDULE CONFIRMED: ${pName} (${teamAbbr}) plays today vs ${opp}.\n${pName} (${teamAbbr}) — Today (${isHome ? 'home' : 'away'}) vs ${opp} at ${timeET}.\nOn the active roster. Check lineup cards ~1 hour before first pitch for batting order.`;
    } else if (teamAbbr) {
      return `⛔ SCHEDULE CHECK: ${pName} (${teamAbbr}) — Team is NOT on today's MLB schedule. Do NOT say they are playing today.\n${pName} (${teamAbbr}) — Not on today's MLB schedule.`;
    }
    return `Could not determine MLB team for "${player_name}". Try the player's full last name.`;
  }

  return `Injury status not available for ${sport}.`;
}

// ── Tool 4: Tonight's schedule ────────────────────────────────────────────────

async function get_tonight_schedule({ sport }) {
  const today   = getTodayET();
  const mlbDate = toMLBDate(today);
  const parts   = [];
  const sports  = sport === 'ALL' ? ['NBA', 'NHL', 'MLB'] : [sport];

  await Promise.all(sports.map(async s => {
    if (s === 'NBA') {
      const [games, gameOddsArr] = await Promise.all([
        bdl.getGames(today).catch(() => []),
        oddsService.fetchGameOdds('NBA').catch(() => []),
      ]);
      if (games?.length) {
        // Build a spread/total lookup keyed by last word of team name (e.g. "celtics" → spread)
        const oddsMap = {};
        for (const go of gameOddsArr || []) {
          const bm = (go.bookmakers || []).find(b => b.key === 'draftkings') || go.bookmakers?.[0];
          if (!bm) continue;
          const spreads = (bm.markets || []).find(m => m.key === 'spreads');
          const totals  = (bm.markets || []).find(m => m.key === 'totals');
          const total   = totals?.outcomes?.find(o => o.name === 'Over')?.point;
          for (const o of (spreads?.outcomes || [])) {
            const word = (o.name || '').toLowerCase().split(' ').pop();
            oddsMap[word] = { spread: o.point, total };
          }
        }

        const lines = [`NBA TONIGHT (${today}) — ${games.length} games:`];
        for (const g of games) {
          const homeTeam = g.home_team?.full_name || g.home_team?.abbreviation || '';
          const awayTeam = g.visitor_team?.full_name || g.visitor_team?.abbreviation || '';
          const st       = g.status || '';
          const timeET   = st.includes('T')
            ? new Date(st).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
            : (st || 'TBD');

          const homeWord   = homeTeam.toLowerCase().split(' ').pop();
          const awayWord   = awayTeam.toLowerCase().split(' ').pop();
          const homeOdds   = oddsMap[homeWord];
          const awayOdds   = oddsMap[awayWord];
          const homeSpread = homeOdds?.spread != null ? ` (${homeOdds.spread > 0 ? '+' : ''}${homeOdds.spread})` : '';
          const awaySpread = awayOdds?.spread != null ? ` (${awayOdds.spread > 0 ? '+' : ''}${awayOdds.spread})` : '';
          const total      = homeOdds?.total ?? awayOdds?.total;
          const totalStr   = total != null ? ` | O/U ${total}` : '';

          lines.push(`  ${awayTeam}${awaySpread} @ ${homeTeam}${homeSpread} — ${timeET}${totalStr}`);
        }
        parts.push(lines.join('\n'));
      } else {
        parts.push(`NBA: No games tonight.`);
      }
    }
    if (s === 'NHL') {
      const games = await nhlApi.getSchedule(today).catch(() => []);
      if (games?.length) {
        const lines = [`NHL TONIGHT (${today}) — ${games.length} games:`];
        for (const g of games) {
          const timeET = g.startTimeUTC
            ? new Date(g.startTimeUTC).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
            : 'TBD';
          lines.push(`  ${g.awayTeam?.placeName?.default || g.awayTeam?.abbrev} @ ${g.homeTeam?.placeName?.default || g.homeTeam?.abbrev} — ${timeET}`);
        }
        parts.push(lines.join('\n'));
      } else {
        parts.push(`NHL: No games tonight.`);
      }
    }
    if (s === 'MLB') {
      const games = await mlbStats.getSchedule(mlbDate).catch(() => []);
      if (games?.length) {
        const lines = [`MLB TODAY (${mlbDate}) — ${games.length} games:`];
        for (const g of games.slice(0, 15)) {
          const away    = g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name || '';
          const home    = g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name || '';
          const timeET  = g.gameDate
            ? new Date(g.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
            : 'TBD';
          const awaySP  = g.teams?.away?.probablePitcher?.fullName || 'TBD';
          const homeSP  = g.teams?.home?.probablePitcher?.fullName || 'TBD';
          lines.push(`  ${away} @ ${home} — ${timeET}`);
          lines.push(`    SP: ${away} ${awaySP} vs ${home} ${homeSP}`);
        }
        parts.push(lines.join('\n'));
      } else {
        parts.push(`MLB: No games today.`);
      }
    }
  }));

  return parts.length > 0 ? parts.join('\n\n') : `No games found for ${sport} tonight.`;
}

// ── Tool 5: Matchup stats + odds ──────────────────────────────────────────────

const { Pool: PgPool } = require('pg');
const _matchupDb = new PgPool({ connectionString: process.env.DATABASE_URL });

// Maps last word of Odds API team name → 3-letter abbreviation used in position_defense_ratings
const NBA_TEAM_ABBR_MAP = {
  'hawks': 'ATL',  'celtics': 'BOS',  'nets': 'BKN',   'hornets': 'CHA',
  'bulls': 'CHI',  'cavaliers': 'CLE','mavericks': 'DAL','nuggets': 'DEN',
  'pistons': 'DET','warriors': 'GSW', 'rockets': 'HOU', 'pacers': 'IND',
  'clippers': 'LAC','lakers': 'LAL',  'grizzlies': 'MEM','heat': 'MIA',
  'bucks': 'MIL',  'timberwolves': 'MIN','pelicans': 'NOP','knicks': 'NYK',
  'thunder': 'OKC','magic': 'ORL',   '76ers': 'PHI',   'suns': 'PHX',
  'blazers': 'POR','kings': 'SAC',   'spurs': 'SAS',   'raptors': 'TOR',
  'jazz': 'UTA',   'wizards': 'WAS',
};

async function get_matchup_stats({ team1, team2, sport }) {
  const fmt  = n => (n > 0 ? `+${n}` : `${n}`);
  const t1   = (team1 || '').toLowerCase();
  const t2   = (team2 || '').toLowerCase();

  const matchName = (name, kw) => {
    const n = (name || '').toLowerCase();
    return n.includes(kw) || n.split(' ').pop() === kw;
  };

  const [events, gameOddsArr] = await Promise.all([
    oddsService.fetchEvents(sport).catch(() => []),
    oddsService.fetchGameOdds(sport).catch(() => []),
  ]);

  const oddsMap = {};
  for (const g of gameOddsArr || []) oddsMap[g.id] = g;

  const event = (events || []).find(e =>
    (matchName(e.home_team, t1) || matchName(e.away_team, t1)) &&
    (!t2 || matchName(e.home_team, t2) || matchName(e.away_team, t2))
  );

  if (!event) return `No game found tonight for ${team1}${team2 ? ' vs ' + team2 : ''} in ${sport}.`;

  const timeET = event.commence_time
    ? new Date(event.commence_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
    : '';
  const lines = [`MATCHUP: ${event.away_team} @ ${event.home_team} — ${timeET}`];

  const odds = oddsMap[event.id];
  if (odds?.bookmakers?.length) {
    const bm = odds.bookmakers.find(b => b.key === 'draftkings') || odds.bookmakers[0];
    if (bm) {
      for (const mkt of bm.markets || []) {
        if (mkt.key === 'h2h') {
          const away = mkt.outcomes?.find(o => o.name === event.away_team);
          const home = mkt.outcomes?.find(o => o.name === event.home_team);
          if (away && home) lines.push(`Moneyline: ${event.away_team} ${fmt(away.price)} / ${event.home_team} ${fmt(home.price)}`);
        }
        if (mkt.key === 'spreads') {
          const away = mkt.outcomes?.find(o => o.name === event.away_team);
          const home = mkt.outcomes?.find(o => o.name === event.home_team);
          if (away && home) lines.push(`Spread: ${event.away_team} ${fmt(away.point)} (${fmt(away.price)}) / ${event.home_team} ${fmt(home.point)} (${fmt(home.price)})`);
        }
        if (mkt.key === 'totals') {
          const over = mkt.outcomes?.find(o => o.name === 'Over');
          if (over) lines.push(`Total: O/U ${over.point}`);
        }
      }
    }
  }

  // Keyword for DB team name matching
  const awayKw = event.away_team.split(' ').pop();
  const homeKw = event.home_team.split(' ').pop();

  // NBA-specific enrichment
  if (sport === 'NBA') {
    const [awaySplitsRes, homeSplitsRes, awayPaceRes, homePaceRes, awayPosDefRes, homePosDefRes] = await Promise.all([
      _matchupDb.query(`
        SELECT split_type, wins, games, win_pct, pts_scored, pts_allowed
        FROM team_situation_splits
        WHERE sport = 'NBA' AND team_name ILIKE $1
        AND split_type IN ('home', 'away', 'rest_1', 'rest_2')
        ORDER BY split_type
      `, [`%${awayKw}%`]).catch(() => ({ rows: [] })),
      _matchupDb.query(`
        SELECT split_type, wins, games, win_pct, pts_scored, pts_allowed
        FROM team_situation_splits
        WHERE sport = 'NBA' AND team_name ILIKE $1
        AND split_type IN ('home', 'away', 'rest_1', 'rest_2')
        ORDER BY split_type
      `, [`%${homeKw}%`]).catch(() => ({ rows: [] })),
      _matchupDb.query(`
        SELECT AVG(pace) as avg_pace, AVG(points_scored) as avg_pts, AVG(points_allowed) as avg_pa
        FROM team_game_logs
        WHERE sport = 'NBA' AND team_name ILIKE $1
        AND game_date >= CURRENT_DATE - 30
      `, [`%${awayKw}%`]).catch(() => ({ rows: [] })),
      _matchupDb.query(`
        SELECT AVG(pace) as avg_pace, AVG(points_scored) as avg_pts, AVG(points_allowed) as avg_pa
        FROM team_game_logs
        WHERE sport = 'NBA' AND team_name ILIKE $1
        AND game_date >= CURRENT_DATE - 30
      `, [`%${homeKw}%`]).catch(() => ({ rows: [] })),
      // Per-position defense — DB uses 3-letter abbrevs, map from team name last word
      _matchupDb.query(`
        WITH ranked AS (
          SELECT team_name, position, pts_allowed,
            RANK() OVER (PARTITION BY position ORDER BY pts_allowed ASC) as rank_in_league,
            COUNT(*) OVER (PARTITION BY position) as total_teams
          FROM position_defense_ratings
          WHERE sport = 'NBA' AND position != 'ALL'
        )
        SELECT position, pts_allowed, rank_in_league, total_teams
        FROM ranked WHERE team_name = $1
        ORDER BY position
      `, [NBA_TEAM_ABBR_MAP[awayKw.toLowerCase()] || awayKw]).catch(() => ({ rows: [] })),
      _matchupDb.query(`
        WITH ranked AS (
          SELECT team_name, position, pts_allowed,
            RANK() OVER (PARTITION BY position ORDER BY pts_allowed ASC) as rank_in_league,
            COUNT(*) OVER (PARTITION BY position) as total_teams
          FROM position_defense_ratings
          WHERE sport = 'NBA' AND position != 'ALL'
        )
        SELECT position, pts_allowed, rank_in_league, total_teams
        FROM ranked WHERE team_name = $1
        ORDER BY position
      `, [NBA_TEAM_ABBR_MAP[homeKw.toLowerCase()] || homeKw]).catch(() => ({ rows: [] })),
    ]);

    const fmtSplit = (rows, type) => {
      const r = rows.find(x => x.split_type === type);
      return r ? `${r.wins}-${r.games - r.wins} (${(parseFloat(r.win_pct) * 100).toFixed(0)}%) ${parseFloat(r.pts_scored).toFixed(1)} PPG` : 'N/A';
    };

    const formatSplits = (teamName, rows) => {
      if (!rows.length) return null;
      return `${teamName} record:
  Home: ${fmtSplit(rows, 'home')} | Away: ${fmtSplit(rows, 'away')}
  B2B: ${fmtSplit(rows, 'rest_1')} | With rest: ${fmtSplit(rows, 'rest_2')}`;
    };

    const awaySplitsStr = formatSplits(event.away_team, awaySplitsRes.rows);
    const homeSplitsStr = formatSplits(event.home_team, homeSplitsRes.rows);
    if (awaySplitsStr) lines.push('\n' + awaySplitsStr);
    if (homeSplitsStr) lines.push(homeSplitsStr);

    // Pace context
    const ap = awayPaceRes.rows[0];
    const hp = homePaceRes.rows[0];
    if (ap?.avg_pace || hp?.avg_pace) {
      const paceParts = [];
      if (ap?.avg_pace) paceParts.push(`${event.away_team}: Pace ${parseFloat(ap.avg_pace).toFixed(1)} | Off ${parseFloat(ap.avg_pts).toFixed(1)} | Def ${parseFloat(ap.avg_pa).toFixed(1)} PPG (L30d)`);
      if (hp?.avg_pace) paceParts.push(`${event.home_team}: Pace ${parseFloat(hp.avg_pace).toFixed(1)} | Off ${parseFloat(hp.avg_pts).toFixed(1)} | Def ${parseFloat(hp.avg_pa).toFixed(1)} PPG (L30d)`);
      if (ap?.avg_pace && hp?.avg_pace) {
        const combined = ((parseFloat(ap.avg_pace) + parseFloat(hp.avg_pace)) / 2).toFixed(1);
        paceParts.push(`Combined pace: ${combined}`);
      }
      lines.push('\nPACE & SCORING:\n' + paceParts.join('\n'));
    }

    // Per-position defense
    const formatPosDef = (teamName, rows) => {
      if (!rows.length) return null;
      const posLines = rows.map(r => {
        const rank = r.rank_in_league && r.total_teams
          ? ` (${r.rank_in_league}/${r.total_teams})` : '';
        return `  ${r.position}: allows ${parseFloat(r.pts_allowed).toFixed(1)} pts/g${rank}`;
      });
      return `${teamName} POSITION DEFENSE:\n${posLines.join('\n')}`;
    };

    const awayPosDef = formatPosDef(event.away_team, awayPosDefRes.rows);
    const homePosDef = formatPosDef(event.home_team, homePosDefRes.rows);
    if (awayPosDef) lines.push('\n' + awayPosDef);
    if (homePosDef) lines.push(homePosDef);
  }

  // MLB-specific enrichment
  if (sport === 'MLB') {
    // Extract team abbreviations from event name via MLB_TEAM_ABBR
    const awayAbbr = Object.entries(MLB_TEAM_ABBR).find(([kw]) => event.away_team.toLowerCase().includes(kw))?.[1] || awayKw;
    const homeAbbr = Object.entries(MLB_TEAM_ABBR).find(([kw]) => event.home_team.toLowerCase().includes(kw))?.[1] || homeKw;

    const [awayBullpenRes, homeBullpenRes] = await Promise.all([
      _matchupDb.query(`
        SELECT pitcher_name, is_closer, games_last_3, pitches_last_3, innings_last_3, days_since_last_app
        FROM bullpen_usage
        WHERE team_abbr = $1
        AND collected_date >= CURRENT_DATE - 3
        ORDER BY pitches_last_3 DESC NULLS LAST
        LIMIT 5
      `, [awayAbbr]).catch(() => ({ rows: [] })),
      _matchupDb.query(`
        SELECT pitcher_name, is_closer, games_last_3, pitches_last_3, innings_last_3, days_since_last_app
        FROM bullpen_usage
        WHERE team_abbr = $1
        AND collected_date >= CURRENT_DATE - 3
        ORDER BY pitches_last_3 DESC NULLS LAST
        LIMIT 5
      `, [homeAbbr]).catch(() => ({ rows: [] })),
    ]);

    const fmtBullpen = (teamLabel, rows) => {
      if (!rows.length) return null;
      const bullpenLines = rows.map(r => {
        const role   = r.is_closer ? ' [CL]' : '';
        const days   = r.days_since_last_app != null ? ` (${r.days_since_last_app}d rest)` : '';
        const pitches = r.pitches_last_3 ? ` ${r.pitches_last_3}P` : '';
        return `  ${r.pitcher_name}${role}: ${r.games_last_3 || 0}G/${r.innings_last_3 || '0.0'}IP last 3d${pitches}${days}`;
      });
      return `${teamLabel} BULLPEN (last 3 days):\n${bullpenLines.join('\n')}`;
    };

    const awayBullpen = fmtBullpen(event.away_team, awayBullpenRes.rows);
    const homeBullpen = fmtBullpen(event.home_team, homeBullpenRes.rows);
    if (awayBullpen) lines.push('\n' + awayBullpen);
    if (homeBullpen) lines.push(homeBullpen);
  }

  return lines.join('\n');
}

// ── Tool 6: MLB weather ────────────────────────────────────────────────────────

async function get_weather({ venue_name, team_name }) {
  let wx = null;

  if (venue_name) {
    wx = await weather.getWeatherByVenueName(venue_name).catch(() => null);
  }
  if (!wx?.weather_available && team_name) {
    const lower = (team_name || '').toLowerCase();
    for (const [kw, abbr] of Object.entries(MLB_TEAM_ABBR)) {
      if (lower.includes(kw)) {
        wx = await weather.getWeatherForTeam(abbr).catch(() => null);
        if (wx?.weather_available) break;
      }
    }
  }

  if (!wx?.weather_available) {
    return `Weather not available for "${venue_name || team_name}". May be a dome or data is unavailable.`;
  }

  const windEffect = (wx.wind_dir_label && wx.wind_mph != null)
    ? `${wx.wind_dir_label} at ${wx.wind_mph} mph`
    : 'calm';

  let impact = 'neutral — minimal weather effect on totals';
  if (wx.wind_mph > 20) {
    impact = (wx.wind_dir_label || '').toLowerCase().includes('out')
      ? `HITTER FRIENDLY — strong wind blowing out (${wx.wind_mph} mph)`
      : `PITCHER FRIENDLY — strong wind blowing in (${wx.wind_mph} mph)`;
  } else if (wx.wind_mph > 12) {
    impact = `moderate wind — direction matters (${wx.wind_mph} mph)`;
  }
  if (wx.temp_f != null && wx.temp_f < 50) impact += '; cold weather suppresses carry';
  if (wx.altitude_ft >= 5000) impact += '; Coors altitude adds major carry boost';

  return [
    `WEATHER — ${wx.venue_name}:`,
    `Temperature: ${wx.temp_f != null ? wx.temp_f + '°F' : 'N/A'}`,
    `Wind: ${windEffect}`,
    `Altitude: ${wx.altitude_ft} ft`,
    `Betting impact: ${impact}`,
  ].join('\n');
}

// ── Tool 7: NHL player stats (delegates to masterDataFetch) ───────────────────

async function get_nhl_player_stats({ player_name }) {
  const { getNHLPlayerComplete } = require('./masterDataFetch');
  const lower    = player_name.toLowerCase();
  const resolved = resolveAlias(lower);
  const dName    = resolved?.displayName || player_name;
  const teamAbbr = NHL_PLAYER_TEAMS[lower] || null;

  const statsBnr = statsSourceBanner();

  const result = await getNHLPlayerComplete(player_name);
  if (!result) return `No NHL player found matching "${player_name}". Try their full last name.`;

  if (result.includes('NOT PLAYING TONIGHT')) {
    return `⛔ SCHEDULE CHECK: ${dName} has NO GAME tonight. Their team is not on the live schedule. Do NOT mention any opponent or game time for tonight.\n${statsBnr}\n${result}`;
  }
  const schedBnr = scheduleConfirmedBanner(dName, result);
  return `${schedBnr}${statsBnr}\n${result}`;
}

// ── Tool 8: MLB player stats (delegates to masterDataFetch) ───────────────────

async function get_mlb_player_stats({ player_name }) {
  const { getMLBPlayerComplete } = require('./masterDataFetch');
  const lower    = player_name.toLowerCase();
  const resolved = resolveAlias(lower);
  const dName    = resolved?.displayName || player_name;

  const statsBnr = statsSourceBanner();

  const result = await getMLBPlayerComplete(player_name);
  if (!result) return `No active MLB player found matching "${player_name}". Try their full name.`;

  if (result.includes('NOT SCHEDULED TONIGHT')) {
    return `⛔ SCHEDULE CHECK: ${dName} has NO GAME today. Their team is not on the live schedule. Do NOT mention any opponent or game time for today.\n${statsBnr}\n${result}`;
  }
  const schedBnr = scheduleConfirmedBanner(dName, result);
  return `${schedBnr}${statsBnr}\n${result}`;
}

// ── Tool 9: Comparative stats across tonight's slate ─────────────────────────

async function get_comparative_stats({ sport, stat_category, scope }) {
  const { getComparativeStats } = require('./masterDataFetch');
  const result = await getComparativeStats(sport, stat_category, scope || 'last_10');
  return result || `No comparative data available for ${sport} ${stat_category}.`;
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

async function executeTool(name, input) {
  console.log(`[tool] ${name}(${JSON.stringify(input)})`);
  const handlers = {
    get_nba_player_stats,
    get_prop_lines,
    get_injury_status,
    get_tonight_schedule,
    get_matchup_stats,
    get_weather,
    get_nhl_player_stats,
    get_mlb_player_stats,
    get_comparative_stats,
  };
  const fn = handlers[name];
  if (!fn) return `Unknown tool: ${name}`;
  try {
    const result = await fn(input);
    console.log(`[tool] ${name} → ${result.length} chars`);
    return result;
  } catch (err) {
    console.error(`[tool] ${name} error:`, err.message);
    return `Error in ${name}: ${err.message}`;
  }
}

module.exports = { executeTool };
