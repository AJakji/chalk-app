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

// ── Player alias map ──────────────────────────────────────────────────────────
// Format: alias → [bdl_search_term, display_name]
// BDL search requires short fragments — full names return 0 results

const PLAYER_ALIASES = {
  // NBA
  'jokic':         ['jokic',         'Nikola Jokic'],
  'joker':         ['jokic',         'Nikola Jokic'],
  'nikola jokic':  ['jokic',         'Nikola Jokic'],
  'luka':          ['doncic',        'Luka Doncic'],
  'doncic':        ['doncic',        'Luka Doncic'],
  'giannis':       ['antetokounmpo', 'Giannis Antetokounmpo'],
  'greek freak':   ['antetokounmpo', 'Giannis Antetokounmpo'],
  'lebron':        ['james',         'LeBron James'],
  'bron':          ['james',         'LeBron James'],
  'steph':         ['stephen',       'Stephen Curry'],
  'steph curry':   ['stephen',       'Stephen Curry'],
  'sga':           ['gilgeous',      'Shai Gilgeous-Alexander'],
  'shai':          ['gilgeous',      'Shai Gilgeous-Alexander'],
  'kd':            ['durant',        'Kevin Durant'],
  'kevin durant':  ['durant',        'Kevin Durant'],
  'embiid':        ['embiid',        'Joel Embiid'],
  'jo embiid':     ['embiid',        'Joel Embiid'],
  'tatum':         ['tatum',         'Jayson Tatum'],
  'jt':            ['tatum',         'Jayson Tatum'],
  'wemby':         ['wembanyama',    'Victor Wembanyama'],
  'wembanyama':    ['wembanyama',    'Victor Wembanyama'],
  'ja':            ['morant',        'Ja Morant'],
  'morant':        ['morant',        'Ja Morant'],
  'dame':          ['lillard',       'Damian Lillard'],
  'lillard':       ['lillard',       'Damian Lillard'],
  'lamelo':        ['lamelo',        'LaMelo Ball'],
  'booker':        ['booker',        'Devin Booker'],
  'dbook':         ['booker',        'Devin Booker'],
  'bam':           ['adebayo',       'Bam Adebayo'],
  'adebayo':       ['adebayo',       'Bam Adebayo'],
  'kat':           ['towns',         'Karl-Anthony Towns'],
  'towns':         ['towns',         'Karl-Anthony Towns'],
  'fox':           ['fox',           "De'Aaron Fox"],
  'ant':           ['edwards',       'Anthony Edwards'],
  'ant man':       ['edwards',       'Anthony Edwards'],
  'edwards':       ['edwards',       'Anthony Edwards'],
  'brunson':       ['brunson',       'Jalen Brunson'],
  'maxey':         ['maxey',         'Tyrese Maxey'],
  'hali':          ['haliburton',    'Tyrese Haliburton'],
  'haliburton':    ['haliburton',    'Tyrese Haliburton'],
  'cade':          ['cunningham',    'Cade Cunningham'],
  'cunningham':    ['cunningham',    'Cade Cunningham'],
  'banchero':      ['banchero',      'Paolo Banchero'],
  'paolo':         ['banchero',      'Paolo Banchero'],
  'mitchell':      ['mitchell',      'Donovan Mitchell'],
  'zion':          ['williamson',    'Zion Williamson'],
  'ingram':        ['ingram',        'Brandon Ingram'],
  'randle':        ['randle',        'Julius Randle'],
  'butler':        ['butler',        'Jimmy Butler'],
  // NHL (display name; stats fetched from NHL API not BDL)
  'mcdavid':       ['mcdavid',       'Connor McDavid'],
  'draisaitl':     ['draisaitl',     'Leon Draisaitl'],
  'matthews':      ['matthews',      'Auston Matthews'],
  'marner':        ['marner',        'Mitch Marner'],
  'crosby':        ['crosby',        'Sidney Crosby'],
  'sid':           ['crosby',        'Sidney Crosby'],
  'ovechkin':      ['ovechkin',      'Alex Ovechkin'],
  'ovi':           ['ovechkin',      'Alex Ovechkin'],
  'pasta':         ['pastrnak',      'David Pastrnak'],
  'pastrnak':      ['pastrnak',      'David Pastrnak'],
  'makar':         ['makar',         'Cale Makar'],
  'mackinnon':     ['mackinnon',     'Nathan MacKinnon'],
  'hedman':        ['hedman',        'Victor Hedman'],
  'tkachuk':       ['tkachuk',       'Matthew Tkachuk'],
  'vasilevskiy':   ['vasilevskiy',   'Andrei Vasilevskiy'],
  'vasi':          ['vasilevskiy',   'Andrei Vasilevskiy'],
  'demko':         ['demko',         'Thatcher Demko'],
  'caufield':      ['caufield',      'Cole Caufield'],
  'hughes':        ['hughes',        'Quinn Hughes'],
  // MLB (display name; stats fetched from MLB Stats API not BDL)
  'judge':         ['judge',         'Aaron Judge'],
  'aaron judge':   ['judge',         'Aaron Judge'],
  'ohtani':        ['ohtani',        'Shohei Ohtani'],
  'trout':         ['trout',         'Mike Trout'],
  'betts':         ['betts',         'Mookie Betts'],
  'mookie':        ['betts',         'Mookie Betts'],
  'tatis':         ['tatis',         'Fernando Tatis Jr.'],
  'acuna':         ['acuna',         'Ronald Acuña Jr.'],
  'acuña':         ['acuna',         'Ronald Acuña Jr.'],
  'vlad':          ['guerrero',      'Vladimir Guerrero Jr.'],
  'guerrero':      ['guerrero',      'Vladimir Guerrero Jr.'],
  'devers':        ['devers',        'Rafael Devers'],
  'yordan':        ['yordan',        'Yordan Alvarez'],
  'alvarez':       ['yordan',        'Yordan Alvarez'],
  'freeman':       ['freeman',       'Freddie Freeman'],
  'wheeler':       ['wheeler',       'Zack Wheeler'],
  'degrom':        ['degrom',        'Jacob deGrom'],
  'gerrit cole':   ['cole',          'Gerrit Cole'],
  'harper':        ['harper',        'Bryce Harper'],
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

// ── Tool 1: NBA player stats ───────────────────────────────────────────────────

async function get_nba_player_stats({ player_name }) {
  const season   = getCurrentNBASeason();
  const resolved = resolveAlias(player_name);
  const bdlTerm  = resolved?.searchTerm || player_name.split(' ').pop().toLowerCase();
  const dName    = resolved?.displayName || player_name;

  console.log(`[tool:nba_stats] BDL search: "${bdlTerm}"`);
  let found = await bdl.searchPlayers(bdlTerm);
  // fallback: try raw last name if alias didn't work
  if (!found?.[0]) {
    const lastName = player_name.trim().split(' ').pop().toLowerCase();
    if (lastName !== bdlTerm) found = await bdl.searchPlayers(lastName);
  }
  if (!found?.[0]) return `No NBA player found matching "${dName}". Try their full last name.`;

  const player = found[0];
  const pName  = `${player.first_name} ${player.last_name}`;
  const abbr   = player.team?.abbreviation || '';

  const gameStats = await bdl.getPlayerStats([player.id], [season]);
  const played = (gameStats || [])
    .filter(g => g.min && g.min !== '0' && g.min !== '00' && (g.pts > 0 || g.reb > 0 || g.ast > 0))
    .sort((a, b) => (b.game?.date || '') > (a.game?.date || '') ? 1 : -1);

  if (played.length < 3) return `${pName} (${abbr}) — only ${played.length} games with data this season.`;

  const avg  = (arr, f) => (arr.reduce((s, g) => s + (Number(g[f]) || 0), 0) / arr.length).toFixed(1);
  const l10  = played.slice(0, 10);
  const l5   = played.slice(0, 5);

  const logLines = l10.map(g => {
    const date = (g.game?.date || '').slice(0, 10);
    const fg   = g.fg_pct != null ? `${(g.fg_pct * 100).toFixed(0)}%` : '?%';
    return `  ${date}: ${g.pts}pts ${g.reb}reb ${g.ast}ast FG:${fg}`;
  });

  return [
    `${pName} (${abbr}) — ${season}-${String(season + 1).slice(2)} Season (${played.length} GP):`,
    `Season: ${avg(played,'pts')} PTS / ${avg(played,'reb')} REB / ${avg(played,'ast')} AST`,
    `L10:    ${avg(l10,'pts')} PTS / ${avg(l10,'reb')} REB / ${avg(l10,'ast')} AST`,
    `L5:     ${avg(l5,'pts')} PTS / ${avg(l5,'reb')} REB / ${avg(l5,'ast')} AST`,
    '',
    'Last 10 games:',
    ...logLines,
  ].join('\n');
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

    const events = await oddsService.fetchEvents('NBA').catch(() => []);
    const event  = events?.find(e =>
      e.home_team?.toLowerCase().includes(teamWord) ||
      e.away_team?.toLowerCase().includes(teamWord)
    );

    if (!event) {
      return `${pName} (${teamAbbr}) — ${teamName} is not on tonight's NBA schedule. No prop lines available.`;
    }

    const isHome    = event.home_team?.toLowerCase().includes(teamWord);
    const opp       = isHome ? event.away_team : event.home_team;
    const gameTimeET = event.commence_time
      ? new Date(event.commence_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
      : '';

    const MARKETS = [
      'player_points', 'player_rebounds', 'player_assists', 'player_threes',
      'player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists',
    ].join(',');
    const LABELS = {
      player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
      player_threes: 'Threes', player_points_rebounds_assists: 'PRA',
      player_points_rebounds: 'P+R', player_points_assists: 'P+A',
    };

    const propsData = await oddsService.fetchEventProps('NBA', event.id, MARKETS).catch(() => null);
    const pLower    = pName.toLowerCase();
    const lines     = [];

    if (propsData?.bookmakers?.length) {
      const bm = propsData.bookmakers.find(b => b.key === 'draftkings')
              || propsData.bookmakers.find(b => b.key === 'fanduel')
              || propsData.bookmakers[0];
      if (bm) {
        for (const mkt of (bm.markets || [])) {
          const label = LABELS[mkt.key];
          if (!label) continue;
          const over  = mkt.outcomes?.find(o => o.description === 'Over'  && o.name?.toLowerCase() === pLower);
          const under = mkt.outcomes?.find(o => o.description === 'Under' && o.name?.toLowerCase() === pLower);
          if (over?.point != null && under?.price != null) {
            lines.push(`  ${label}: O/U ${over.point} — Over ${fmt(over.price)} / Under ${fmt(under.price)} [${bm.title}]`);
          }
        }
      }
    }

    if (lines.length === 0) {
      return `${pName} — Tonight (${isHome ? 'home' : 'away'}) vs ${opp} at ${gameTimeET}.\nProp lines not posted yet. Lines typically appear 2-4 hours before tip-off.`;
    }

    return [`${pName} PROP LINES — Tonight vs ${opp} at ${gameTimeET}:`, ...lines].join('\n');
  }

  return `Prop lines for ${sport} are not yet available. Ask about NBA props for now.`;
}

// ── Tool 3: Injury / availability status ──────────────────────────────────────

async function get_injury_status({ player_name, sport }) {
  const today = new Date().toISOString().split('T')[0];

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

    const out = [`${pName} (${abbr}):`];
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
        (injury?.status || '').toLowerCase().includes('out') ? 'Verdict: Will NOT play tonight.' :
        injury ? 'Verdict: Game-time decision — check ~1 hour before tip.' :
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
      return `${pName} (${teamAbbr}) — Tonight (${isHome ? 'home' : 'away'}) vs ${opp} at ${timeET}.\nNo real-time injury API for NHL. Check official team injury report ~2 hours before puck drop.`;
    } else if (teamAbbr) {
      return `${pName} (${teamAbbr}) — Team is not on tonight's NHL schedule.`;
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
      return `${pName} (${teamAbbr}) — Today (${isHome ? 'home' : 'away'}) vs ${opp} at ${timeET}.\nOn the active roster. Check lineup cards ~1 hour before first pitch for batting order.`;
    } else if (teamAbbr) {
      return `${pName} (${teamAbbr}) — Not on today's MLB schedule.`;
    }
    return `Could not determine MLB team for "${player_name}". Try the player's full last name.`;
  }

  return `Injury status not available for ${sport}.`;
}

// ── Tool 4: Tonight's schedule ────────────────────────────────────────────────

async function get_tonight_schedule({ sport }) {
  const today   = new Date().toISOString().split('T')[0];
  const mlbDate = toMLBDate(today);
  const parts   = [];
  const sports  = sport === 'ALL' ? ['NBA', 'NHL', 'MLB'] : [sport];

  await Promise.all(sports.map(async s => {
    if (s === 'NBA') {
      const games = await bdl.getGames(today).catch(() => []);
      if (games?.length) {
        const lines = [`NBA TONIGHT (${today}) — ${games.length} games:`];
        for (const g of games) {
          const st     = g.status || '';
          const timeET = st.includes('T')
            ? new Date(st).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
            : (st || 'TBD');
          lines.push(`  ${g.visitor_team?.full_name || g.visitor_team?.abbreviation} @ ${g.home_team?.full_name || g.home_team?.abbreviation} — ${timeET}`);
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
        for (const g of games.slice(0, 12)) {
          const away   = g.teams?.away?.team?.name || '';
          const home   = g.teams?.home?.team?.name || '';
          const timeET = g.gameDate
            ? new Date(g.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
            : '';
          lines.push(`  ${away} @ ${home} — ${timeET}`);
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

// ── Tool 7: NHL player stats ───────────────────────────────────────────────────

async function get_nhl_player_stats({ player_name }) {
  const lower    = (player_name || '').toLowerCase();
  const resolved = resolveAlias(lower);
  const pName    = resolved?.displayName || player_name;
  const teamAbbr = NHL_PLAYER_TEAMS[lower] || null;

  if (!teamAbbr) {
    return `${pName} — Could not determine NHL team. Try asking about the team directly (e.g. "How are the Oilers playing?").`;
  }

  const roster = await nhlApi.getTeamRoster(teamAbbr).catch(() => null);
  if (!roster) return `Could not fetch ${teamAbbr} roster.`;

  const allPlayers = [
    ...(roster.forwards   || []),
    ...(roster.defensemen || []),
    ...(roster.goalies    || []),
  ];

  const pParts = pName.toLowerCase().split(' ');
  const found  = allPlayers.find(p => {
    const fn = (p.firstName?.default || '').toLowerCase();
    const ln = (p.lastName?.default  || '').toLowerCase();
    return pParts.some(part => part.length > 3 && (fn.includes(part) || ln.includes(part)));
  });

  if (!found) return `${pName} not found on ${teamAbbr} active roster.`;

  const fullName = `${found.firstName?.default || ''} ${found.lastName?.default || ''}`.trim();
  const now      = new Date();
  const yr       = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const seasonStr = `${yr}${yr + 1}`;

  const logData = await nhlApi.getPlayerGameLog(found.id, seasonStr).catch(() => null);
  const gameLog = logData?.gameLog || [];

  if (gameLog.length < 3) {
    return `${fullName} (${teamAbbr}) — limited game log data this season (${gameLog.length} games).`;
  }

  const recent   = gameLog.slice(0, 10);
  const avgG     = (recent.reduce((s, g) => s + (Number(g.goals)   || 0), 0) / recent.length).toFixed(2);
  const avgA     = (recent.reduce((s, g) => s + (Number(g.assists) || 0), 0) / recent.length).toFixed(2);
  const avgPts   = (recent.reduce((s, g) => s + (Number(g.points)  || 0), 0) / recent.length).toFixed(2);

  const logLines = recent.map(g => {
    const date = (g.gameDate || '').slice(0, 10);
    const ha   = g.homeRoadFlag === 'H' ? 'vs' : '@';
    const toi  = g.timeOnIce ? ` TOI:${g.timeOnIce}` : '';
    return `  ${date}: ${ha} ${g.opponentAbbrev || '?'} — ${g.goals}G ${g.assists}A ${g.points}pts ${g.shots || 0}SOG${toi}`;
  });

  return [
    `${fullName} (${teamAbbr}) — NHL ${yr}-${String(yr + 1).slice(2)} Season:`,
    `L10 avg: ${avgG}G / ${avgA}A / ${avgPts} PTS per game`,
    '',
    `Last ${recent.length} games:`,
    ...logLines,
  ].join('\n');
}

// ── Tool 8: MLB player stats ───────────────────────────────────────────────────

async function get_mlb_player_stats({ player_name }) {
  const lower    = (player_name || '').toLowerCase();
  const resolved = resolveAlias(lower);
  const pName    = resolved?.displayName || player_name;
  const season   = new Date().getFullYear();

  console.log(`[tool:mlb_stats] searching for "${pName}"`);

  const allPlayers = await mlbStats.getActivePlayers(season).catch(() => []);
  const pParts     = pName.toLowerCase().split(' ');

  const found = allPlayers.find(p => {
    const nameLower = (p.fullName || '').toLowerCase();
    return pParts.every(part => nameLower.includes(part)) ||
      pParts.some(part => part.length > 4 && nameLower.includes(part));
  });

  if (!found) return `No active MLB player found matching "${pName}". Try their full name.`;

  const teamAbbr = found.currentTeam?.abbreviation || '';
  const pos      = found.primaryPosition?.abbreviation || '';
  const isPitch  = found.primaryPosition?.type?.description === 'Pitcher';
  const group    = isPitch ? 'pitching' : 'hitting';

  const [seasonStats, gameLog] = await Promise.all([
    mlbStats.getPlayerSeasonStats(found.id, season, group).catch(() => []),
    mlbStats.getPlayerGameLog(found.id, season, group).catch(() => []),
  ]);

  const stats  = seasonStats?.[0]?.stat || {};
  const recent = gameLog.slice(0, 10);
  let result   = `${found.fullName} (${teamAbbr}, ${pos}) — ${season} Season:\n`;

  if (isPitch) {
    result += `ERA: ${stats.era || '?'} | WHIP: ${stats.whip || '?'} | K: ${stats.strikeOuts || 0} | IP: ${stats.inningsPitched || '?'} | W-L: ${stats.wins || 0}-${stats.losses || 0}\n`;
    if (recent.length) {
      result += '\nRecent starts:\n' + recent.map(g => {
        const s = g.stat || {};
        return `  ${(g.date || '').slice(0, 10)} vs ${g.opponent?.name || '?'}: ${s.inningsPitched || '?'}IP ${s.earnedRuns ?? '?'}ER ${s.strikeOuts || 0}K`;
      }).join('\n');
    }
  } else {
    result += `AVG: ${stats.avg || '?'} | OPS: ${stats.ops || '?'} | HR: ${stats.homeRuns || 0} | RBI: ${stats.rbi || 0} | SB: ${stats.stolenBases || 0}\n`;
    if (recent.length) {
      result += '\nRecent games:\n' + recent.map(g => {
        const s = g.stat || {};
        return `  ${(g.date || '').slice(0, 10)} vs ${g.opponent?.name || '?'}: ${s.atBats || 0}AB ${s.hits || 0}H ${s.homeRuns || 0}HR ${s.rbi || 0}RBI`;
      }).join('\n');
    }
  }

  return result;
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
