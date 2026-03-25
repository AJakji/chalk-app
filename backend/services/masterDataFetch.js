/**
 * masterDataFetch.js — Single source of truth for all Research tab data fetching.
 *
 * Every player stats tool calls a function from here.
 * These functions return EVERYTHING we have so Claude can reason on its own.
 *
 * DB column mappings (confirmed from actual data):
 *   NBA:        points=PTS, rebounds=REB, assists=AST, steals=STL, blocks=BLK,
 *               turnovers=TO, fg_pct=FG%, three_pct=3P%, ft_pct=FT%, minutes=MIN,
 *               plus_minus=+/-, off_reb=OREB, def_reb=DREB, usage_rate, true_shooting_pct
 *   NHL skater: points=G, assists=A, fg_made=SOG, turnovers=PIM, three_made=PPG,
 *               three_att=PP_TOI(min), plus_minus=+/-, minutes=TOI
 *   NHL goalie: steals=saves, blocks=GA, fg_att=shots_faced, fg_pct=SV%,
 *               off_reb=GSAA, plus_minus=1(W)/-1(L)/0(OT)
 *   MLB:        points=H, fg_att=AB, fg_pct=AVG, off_reb=HR, turnovers=RBI,
 *               steals=SB, three_made=2B, rebounds=R
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool }    = require('pg');
const bdl         = require('./ballDontLie');
const nhlApi      = require('./nhlApi');
const mlbStats    = require('./mlbStats');
const oddsService = require('./oddsService');
const weather     = require('./weatherService');

const db = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Shared helpers ────────────────────────────────────────────────────────────

function getCurrentNBASeason() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

function toMLBDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// Compute average of a numeric column from DB rows, returns string like "26.3"
function avg(rows, col) {
  const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v) && v !== null);
  if (!vals.length) return 'N/A';
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

// Like avg but more decimal places (for FG%, SV% etc.)
function avgPct(rows, col, decimals = 3) {
  const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v) && v !== null);
  if (!vals.length) return 'N/A';
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(decimals);
}

function fmtOdds(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtDate(isoStr) {
  return (isoStr || '').toString().slice(0, 10);
}

// Detect back-to-back games: returns games where prev game was ≤1 day earlier
function getB2BGames(rows) {
  const sorted = [...rows].sort((a, b) => new Date(b.game_date) - new Date(a.game_date));
  return sorted.filter((g, i) => {
    if (i >= sorted.length - 1) return false;
    const curr = new Date(g.game_date);
    const prev = new Date(sorted[i + 1].game_date);
    return Math.abs((curr - prev) / (1000 * 60 * 60 * 24)) <= 1;
  });
}

// Normalize name for matching (strip accents, punctuation)
function normName(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();
}

// Extract last name for DB ILIKE searches
function lastName(name) {
  return (name || '').trim().split(' ').pop();
}

// Prop line fetch from live Odds API (called by all sports)
async function fetchLivePropLines(sport, playerDisplayName, oddsEventId) {
  if (!oddsEventId) return '';
  const MARKETS = [
    'player_points', 'player_rebounds', 'player_assists', 'player_threes',
    'player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists',
  ].join(',');
  const LABELS = {
    player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
    player_threes: 'Threes', player_points_rebounds_assists: 'PRA',
    player_points_rebounds: 'P+R', player_points_assists: 'P+A',
  };
  const NHL_MARKETS = 'player_goals,player_points,player_shots_on_goal,player_assists';
  const NHL_LABELS  = {
    player_goals: 'Goals', player_points: 'Points', player_shots_on_goal: 'SOG', player_assists: 'Assists',
  };
  const MLB_MARKETS  = 'batter_hits,batter_home_runs,batter_rbis,pitcher_strikeouts,pitcher_hits_allowed';
  const MLB_LABELS   = {
    batter_hits: 'Hits', batter_home_runs: 'Home Runs', batter_rbis: 'RBIs',
    pitcher_strikeouts: 'Strikeouts', pitcher_hits_allowed: 'Hits Allowed',
  };

  const markets = sport === 'NHL' ? NHL_MARKETS : sport === 'MLB' ? MLB_MARKETS : MARKETS;
  const labels  = sport === 'NHL' ? NHL_LABELS  : sport === 'MLB' ? MLB_LABELS  : LABELS;

  try {
    const propsData = await oddsService.fetchEventProps(sport, oddsEventId, markets).catch(() => null);
    if (!propsData?.bookmakers?.length) return '';

    const dk    = propsData.bookmakers.find(b => b.key === 'draftkings');
    const fd    = propsData.bookmakers.find(b => b.key === 'fanduel');
    const bm    = dk || fd || propsData.bookmakers[0];
    const other = bm === dk ? fd : dk;
    const pNorm = normName(playerDisplayName);
    const lines = [];

    for (const mkt of (bm.markets || [])) {
      const label = labels[mkt.key];
      if (!label) continue;
      const over  = mkt.outcomes?.find(o => o.name === 'Over'  && normName(o.description) === pNorm);
      const under = mkt.outcomes?.find(o => o.name === 'Under' && normName(o.description) === pNorm);
      if (over?.point != null && over?.price != null && under?.price != null) {
        let line = `  ${label}: O/U ${over.point} — Over ${fmtOdds(over.price)} / Under ${fmtOdds(under.price)} [${bm.title}]`;
        if (other) {
          const otherMkt = other.markets?.find(m => m.key === mkt.key);
          const o2 = otherMkt?.outcomes?.find(o => o.name === 'Over'  && normName(o.description) === pNorm);
          const u2 = otherMkt?.outcomes?.find(o => o.name === 'Under' && normName(o.description) === pNorm);
          if (o2?.price != null && u2?.price != null) {
            line += ` | Over ${fmtOdds(o2.price)} / Under ${fmtOdds(u2.price)} [${other.title}]`;
          }
        }
        lines.push(line);
      }
    }

    return lines.length ? lines.join('\n') : '';
  } catch {
    return '';
  }
}

// ── NBA ───────────────────────────────────────────────────────────────────────

async function getNBAPlayerComplete(playerName) {
  // 1. BDL player lookup
  const bdlTerm = playerName.split(' ').pop().toLowerCase();
  let found = await bdl.searchPlayers(bdlTerm).catch(() => []);
  if (!found?.[0]) found = await bdl.searchPlayers(playerName.toLowerCase()).catch(() => []);
  if (!found?.[0]) return null;

  const player = found[0];
  const pName  = `${player.first_name} ${player.last_name}`;
  const abbr   = player.team?.abbreviation || '';
  const season = getCurrentNBASeason();

  // 2. DB game logs — last 20 games
  const [logsResult, vsOppResult] = await Promise.all([
    db.query(`
      SELECT game_date, opponent, home_away, minutes,
             points, rebounds, assists, steals, blocks, turnovers,
             fg_made, fg_att, fg_pct, three_made, three_att, three_pct,
             ft_made, ft_att, ft_pct, off_reb, def_reb,
             plus_minus, usage_rate, true_shooting_pct
      FROM player_game_logs
      WHERE sport = 'NBA' AND player_name ILIKE $1
      AND game_date >= CURRENT_DATE - 120
      ORDER BY game_date DESC
      LIMIT 20
    `, [`%${lastName(pName)}%`]),
    // vs tonight's opponent — fetch all time
    db.query(`
      SELECT opp.game_date, opp.opponent, opp.home_away,
             opp.points, opp.rebounds, opp.assists, opp.fg_pct, opp.minutes, opp.plus_minus
      FROM player_game_logs opp
      WHERE opp.sport = 'NBA' AND opp.player_name ILIKE $1
      ORDER BY opp.game_date DESC
      LIMIT 30
    `, [`%${lastName(pName)}%`]),
  ]);

  const logs = logsResult.rows;
  if (logs.length < 3) return `${pName} (${abbr}) — only ${logs.length} games in database. Season may not have started.`;

  const l5  = logs.slice(0, 5);
  const l10 = logs.slice(0, 10);
  const l20 = logs;

  // 3. Splits
  const homeGames  = l20.filter(g => g.home_away === 'home');
  const awayGames  = l20.filter(g => g.home_away === 'away');
  const b2bGames   = getB2BGames(l20);
  const normalGames = l20.filter(g => !b2bGames.includes(g));

  // 4. Tonight's game via BDL
  const today    = new Date().toISOString().split('T')[0];
  const bdlGames = await bdl.getGames(today).catch(() => []);
  const tonightGame = bdlGames?.find(g =>
    g.home_team?.abbreviation === abbr || g.visitor_team?.abbreviation === abbr
  );

  // 5. Odds for tonight's game
  let oddsContext  = '';
  let oddsEventId  = null;
  let tonightOpp   = '';

  if (tonightGame) {
    const isHome = tonightGame.home_team?.abbreviation === abbr;
    const teamWord = (isHome ? tonightGame.visitor_team?.full_name : tonightGame.home_team?.full_name)
      ?.split(' ').pop().toLowerCase() || '';
    tonightOpp = isHome ? (tonightGame.visitor_team?.full_name || '') : (tonightGame.home_team?.full_name || '');

    const rawStatus = tonightGame.status || '';
    const gameTimeET = rawStatus.includes('T')
      ? new Date(rawStatus).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
      : (rawStatus || 'TBD');

    const events = await oddsService.fetchEvents('NBA').catch(() => []);
    const event  = events?.find(e =>
      e.home_team?.toLowerCase().includes(teamWord) ||
      e.away_team?.toLowerCase().includes(teamWord)
    );
    oddsEventId = event?.id || null;

    if (event) {
      const [gameOdds] = await Promise.all([
        oddsService.fetchGameOdds('NBA').catch(() => []),
      ]);
      const gameOddsMap = {};
      for (const g of gameOdds || []) gameOddsMap[g.id] = g;
      const go = gameOddsMap[event.id];
      if (go?.bookmakers?.[0]) {
        const bm = go.bookmakers.find(b => b.key === 'draftkings') || go.bookmakers[0];
        for (const mkt of bm.markets || []) {
          if (mkt.key === 'h2h') {
            const awayOut = mkt.outcomes?.find(o => o.name === event.away_team);
            const homeOut = mkt.outcomes?.find(o => o.name === event.home_team);
            if (awayOut && homeOut) oddsContext += `Moneyline: ${event.away_team} ${fmtOdds(awayOut.price)} / ${event.home_team} ${fmtOdds(homeOut.price)}\n`;
          }
          if (mkt.key === 'spreads') {
            const fav = mkt.outcomes?.find(o => o.point < 0);
            if (fav) oddsContext += `Spread: ${fav.name} ${fav.point} (${fmtOdds(fav.price)})\n`;
          }
          if (mkt.key === 'totals') {
            const over = mkt.outcomes?.find(o => o.name === 'Over');
            if (over) oddsContext += `Total: O/U ${over.point}\n`;
          }
        }
      }
      oddsContext = oddsContext || 'Odds not yet posted.';
    }

    // vs tonight's opponent specifically
    const vsRows = vsOppResult.rows.filter(g =>
      (g.opponent || '').toLowerCase().includes(teamWord.slice(0, 3))
    );

    const tonightBlock = `
TONIGHT'S GAME: ${isHome ? 'vs' : '@'} ${tonightOpp} at ${gameTimeET}
${oddsContext.trim()}
${vsRows.length > 0 ? `VS ${tonightOpp.toUpperCase()} HISTORY (${vsRows.length} games):
  Avg: ${avg(vsRows, 'points')} PTS / ${avg(vsRows, 'rebounds')} REB / ${avg(vsRows, 'assists')} AST
  Individual: ${vsRows.slice(0, 6).map(g => `${fmtDate(g.game_date)} ${g.points}/${g.rebounds}/${g.assists}`).join(', ')}` : `VS ${tonightOpp.toUpperCase()}: No head-to-head history in database.`}`;

    // 6. Prop lines
    const propLines = await fetchLivePropLines('NBA', pName, oddsEventId);

    return buildNBAOutput(pName, abbr, season, logs, l5, l10, l20, homeGames, awayGames, b2bGames, normalGames, tonightBlock, propLines);
  }

  return buildNBAOutput(pName, abbr, season, logs, l5, l10, l20, homeGames, awayGames, b2bGames, normalGames, 'NOT PLAYING TONIGHT', '');
}

function buildNBAOutput(pName, abbr, season, logs, l5, l10, l20, homeGames, awayGames, b2bGames, normalGames, tonightBlock, propLines) {
  const l20FG  = avgPct(l20.filter(g => g.fg_pct != null), 'fg_pct', 3);
  const l20_3P = avgPct(l20.filter(g => g.three_pct != null), 'three_pct', 3);
  const l20FT  = avgPct(l20.filter(g => g.ft_pct != null), 'ft_pct', 3);
  const l20TS  = avgPct(l20.filter(g => g.true_shooting_pct != null), 'true_shooting_pct', 3);
  const l20USG = avgPct(l20.filter(g => g.usage_rate != null), 'usage_rate', 1);

  const l10log = l20.slice(0, 10).map(g => {
    const fg    = g.fg_pct != null ? `FG ${(parseFloat(g.fg_pct)*100).toFixed(0)}%` : '';
    const min   = g.minutes != null ? `${Math.round(parseFloat(g.minutes))}min` : '';
    const pm    = g.plus_minus != null ? `${g.plus_minus > 0 ? '+' : ''}${g.plus_minus}` : '';
    return `  ${fmtDate(g.game_date)} ${g.home_away === 'home' ? 'vs' : '@'} ${g.opponent}: ${g.points}pts ${g.rebounds}reb ${g.assists}ast ${fg} ${min} ${pm}`.trim();
  });

  const trendArrow = parseFloat(avg(l5, 'points')) > parseFloat(avg(l20, 'points')) ? '↑ above' : '↓ below';
  const trendDiff  = Math.abs(parseFloat(avg(l5, 'points')) - parseFloat(avg(l20, 'points'))).toFixed(1);

  return `
NBA PLAYER DATA: ${pName} (${abbr}) — ${season}-${String(season+1).slice(2)} Season
Games in database: ${l20.length}

SEASON AVERAGES (last 20 games):
PTS: ${avg(l20,'points')} | REB: ${avg(l20,'rebounds')} | AST: ${avg(l20,'assists')} | STL: ${avg(l20,'steals')} | BLK: ${avg(l20,'blocks')} | TO: ${avg(l20,'turnovers')}
FG%: ${l20FG} | 3P%: ${l20_3P} | FT%: ${l20FT} | TS%: ${l20TS !== 'N/A' ? l20TS : 'N/A'} | USG%: ${l20USG !== 'N/A' ? l20USG : 'N/A'}
MPG: ${avg(l20,'minutes')} | +/-: ${avg(l20,'plus_minus')}

RECENT FORM:
L5:  ${avg(l5, 'points')} PTS / ${avg(l5, 'rebounds')} REB / ${avg(l5, 'assists')} AST
L10: ${avg(l10,'points')} PTS / ${avg(l10,'rebounds')} REB / ${avg(l10,'assists')} AST
L20: ${avg(l20,'points')} PTS / ${avg(l20,'rebounds')} REB / ${avg(l20,'assists')} AST
Trend: L5 scoring is ${trendDiff} pts ${trendArrow} the L20 average

LAST 10 GAMES (most recent first):
${l10log.join('\n')}

HOME vs AWAY (last 20):
Home (${homeGames.length}g): ${avg(homeGames,'points')} PTS / ${avg(homeGames,'rebounds')} REB / ${avg(homeGames,'assists')} AST | FG%: ${avgPct(homeGames.filter(g=>g.fg_pct),'fg_pct',3)}
Away (${awayGames.length}g): ${avg(awayGames,'points')} PTS / ${avg(awayGames,'rebounds')} REB / ${avg(awayGames,'assists')} AST | FG%: ${avgPct(awayGames.filter(g=>g.fg_pct),'fg_pct',3)}

BACK-TO-BACK (${b2bGames.length} b2b games in last 20):
${b2bGames.length >= 2
  ? `B2B avg:    ${avg(b2bGames,'points')} PTS / ${avg(b2bGames,'rebounds')} REB / ${avg(b2bGames,'assists')} AST
Normal avg: ${avg(normalGames,'points')} PTS / ${avg(normalGames,'rebounds')} REB / ${avg(normalGames,'assists')} AST
Impact:     ${(parseFloat(avg(b2bGames,'points')) - parseFloat(avg(normalGames,'points'))).toFixed(1)} pts on b2b`
  : 'Not enough b2b games in sample to compute meaningful split.'}

${tonightBlock}

${propLines ? `TONIGHT'S PROP LINES:\n${propLines}` : 'No prop lines available yet.'}
`.trim();
}

// ── NHL ───────────────────────────────────────────────────────────────────────

async function getNHLPlayerComplete(playerName) {
  const lower = playerName.toLowerCase();

  // 1. Determine team from alias map or DB
  const NHL_PLAYER_TEAMS = {
    'mcdavid':'EDM','draisaitl':'EDM','hyman':'EDM',
    'matthews':'TOR','marner':'TOR','nylander':'TOR',
    'crosby':'PIT','malkin':'PIT','letang':'PIT',
    'ovechkin':'WSH','ovi':'WSH',
    'mackinnon':'COL','makar':'COL','rantanen':'COL',
    'hedman':'TBL','point':'TBL','vasilevskiy':'TBL','kucherov':'TBL',
    'tkachuk':'FLA','barkov':'FLA','reinhart':'FLA',
    'pasta':'BOS','pastrnak':'BOS','marchand':'BOS',
    'hughes':'VAN','demko':'VAN','pettersson':'VAN',
    'caufield':'MTL','suzuki':'MTL',
    'robertson':'DAL','heiskanen':'DAL','oettinger':'DAL',
    'aho':'CAR','svechnikov':'CAR',
    'eichel':'VGK','stone':'VGK',
    'panarin':'NYR','shesterkin':'NYR','trocheck':'NYR',
    'laine':'CBJ','zach werenski':'CBJ',
    'kaprizov':'MIN','fleury':'MIN',
    'stamkos':'NSH','duchene':'NSH',
    'ullmark':'OTT','stutzle':'OTT',
    'gibson':'DET','larkin':'DET',
    'hellebuyck':'WPG','scheifele':'WPG',
    'daccord':'SEA','eberle':'SEA',
    'stolarz':'TOR',
  };

  let teamAbbr = null;
  for (const [kw, abbr] of Object.entries(NHL_PLAYER_TEAMS)) {
    if (lower.includes(kw)) { teamAbbr = abbr; break; }
  }

  // 2. NHL API roster lookup to find player ID
  let nhlPlayerId = null;
  let fullName    = playerName;
  let position    = null;

  if (teamAbbr) {
    const roster = await nhlApi.getTeamRoster(teamAbbr).catch(() => null);
    if (roster) {
      const all = [...(roster.forwards||[]), ...(roster.defensemen||[]), ...(roster.goalies||[])];
      const lParts = lower.split(' ');
      const found  = all.find(p => {
        const fn = (p.firstName?.default || '').toLowerCase();
        const ln = (p.lastName?.default  || '').toLowerCase();
        return lParts.some(part => part.length > 3 && (fn.includes(part) || ln.includes(part)));
      });
      if (found) {
        nhlPlayerId = found.id;
        fullName    = `${found.firstName?.default || ''} ${found.lastName?.default || ''}`.trim();
        position    = found.positionCode || null;
      }
    }
  }

  const isGoalie = position === 'G' || lower.includes('ullmark') || lower.includes('hellebuyck')
    || lower.includes('vasilevskiy') || lower.includes('demko') || lower.includes('shesterkin')
    || lower.includes('gibson') || lower.includes('stolarz') || lower.includes('oettinger')
    || lower.includes('fleury') || lower.includes('daccord');

  // 3. DB game logs
  const dbLogs = await db.query(`
    SELECT game_date, opponent, home_away,
      points, assists, fg_made, turnovers, three_made, three_att,
      steals, blocks, fg_att, fg_pct, off_reb,
      plus_minus, minutes
    FROM player_game_logs
    WHERE sport = 'NHL' AND player_name ILIKE $1
    AND game_date >= CURRENT_DATE - 120
    ORDER BY game_date DESC
    LIMIT 20
  `, [`%${lastName(fullName)}%`]);
  const logs = dbLogs.rows;

  // 4. NHL API game log as supplement
  let apiLog = [];
  if (nhlPlayerId) {
    const yr       = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const logData  = await nhlApi.getPlayerGameLog(nhlPlayerId, `${yr}${yr+1}`).catch(() => null);
    apiLog         = logData?.gameLog || [];
  }

  // Use DB logs when available (richer format), API logs as fallback
  const hasDB = logs.length >= 5;

  // 5. Tonight's game
  const today = new Date().toISOString().split('T')[0];
  const nhlGames = await nhlApi.getSchedule(today).catch(() => []);
  const tonightGame = teamAbbr
    ? nhlGames?.find(g => g.homeTeam?.abbrev === teamAbbr || g.awayTeam?.abbrev === teamAbbr)
    : null;

  let oddsEventId  = null;
  let tonightBlock = 'NOT PLAYING TONIGHT';

  if (tonightGame) {
    const isHome = tonightGame.homeTeam?.abbrev === teamAbbr;
    const opp    = isHome ? (tonightGame.awayTeam?.placeName?.default || tonightGame.awayTeam?.abbrev)
                          : (tonightGame.homeTeam?.placeName?.default || tonightGame.homeTeam?.abbrev);
    const oppAbbr = isHome ? tonightGame.awayTeam?.abbrev : tonightGame.homeTeam?.abbrev;
    const timeET  = tonightGame.startTimeUTC
      ? new Date(tonightGame.startTimeUTC).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
      : 'TBD';

    const events = await oddsService.fetchEvents('NHL').catch(() => []);
    const event  = events?.find(e =>
      e.home_team?.toLowerCase().includes(oppAbbr?.toLowerCase() || '') ||
      e.away_team?.toLowerCase().includes(oppAbbr?.toLowerCase() || '')
    );
    oddsEventId = event?.id || null;

    // vs opponent history from DB
    const vsLogs = logs.filter(g => (g.opponent || '').toLowerCase().includes((oppAbbr || '').toLowerCase().slice(0,3)));

    let vsBlock = '';
    if (vsLogs.length > 0) {
      if (isGoalie) {
        vsBlock = `VS ${opp.toUpperCase()} HISTORY (${vsLogs.length}g): SV% ${avgPct(vsLogs.filter(g=>g.fg_pct),'fg_pct',3)} | GA/g ${avg(vsLogs,'blocks')}`;
      } else {
        vsBlock = `VS ${opp.toUpperCase()} HISTORY (${vsLogs.length}g): ${avg(vsLogs,'points')}G / ${avg(vsLogs,'assists')}A | SOG ${avg(vsLogs,'fg_made')}`;
      }
    }

    tonightBlock = `TONIGHT: ${isHome ? 'vs' : '@'} ${opp} at ${timeET}\n${vsBlock}`;
  }

  // 6. Prop lines
  const propLines = await fetchLivePropLines('NHL', fullName, oddsEventId);

  if (isGoalie) {
    return buildNHLGoalieOutput(fullName, teamAbbr || '', logs, apiLog, hasDB, tonightBlock, propLines);
  }
  return buildNHLSkaterOutput(fullName, teamAbbr || '', position, logs, apiLog, hasDB, tonightBlock, propLines);
}

function buildNHLSkaterOutput(fullName, abbr, position, logs, apiLog, hasDB, tonightBlock, propLines) {
  const l5  = logs.slice(0, 5);
  const l10 = logs.slice(0, 10);
  const l20 = logs;
  const homeGames = l20.filter(g => g.home_away === 'home');
  const awayGames = l20.filter(g => g.home_away === 'away');

  // DB: points=G, assists=A, fg_made=SOG, three_made=PPG, turnovers=PIM, plus_minus=+/-, minutes=TOI
  const totalPts   = (rows) => rows.map(g => (parseFloat(g.points)||0) + (parseFloat(g.assists)||0));
  const avgPtsG    = (rows) => rows.length ? (totalPts(rows).reduce((a,b)=>a+b,0)/rows.length).toFixed(2) : 'N/A';

  // Game log lines
  const logLines = (hasDB ? l10 : apiLog.slice(0,10)).map(g => {
    if (hasDB) {
      const toi = g.minutes ? `${parseFloat(g.minutes).toFixed(1)}min` : '';
      const ppg  = parseFloat(g.three_made) > 0 ? ` (${g.three_made}PPG)` : '';
      return `  ${fmtDate(g.game_date)} ${g.home_away === 'home' ? 'vs' : '@'} ${g.opponent}: ${g.points}G ${g.assists}A ${(parseFloat(g.points)||0)+(parseFloat(g.assists)||0)}PTS ${g.fg_made}SOG ${toi}${ppg} ${g.plus_minus > 0 ? '+':''}${g.plus_minus}`;
    } else {
      return `  ${(g.gameDate||'').slice(0,10)} ${g.homeRoadFlag==='H'?'vs':'@'} ${g.opponentAbbrev||'?'}: ${g.goals}G ${g.assists}A ${g.points}PTS ${g.shots||0}SOG${g.timeOnIce?' TOI:'+g.timeOnIce:''}`;
    }
  });

  const ppgAvg = hasDB ? avg(l10, 'three_made') : 'N/A';
  const ppTOI  = hasDB ? avg(l10, 'three_att')  : 'N/A';

  return `
NHL SKATER DATA: ${fullName} (${abbr})${position ? ` — ${position}` : ''}
Games in database: ${l20.length}${!hasDB && apiLog.length > 0 ? ` (API: ${apiLog.length})` : ''}

RECENT FORM (per game):
L5:  ${avg(l5,'points')}G / ${avg(l5,'assists')}A / ${avgPtsG(l5)} PTS | ${avg(l5,'fg_made')} SOG
L10: ${avg(l10,'points')}G / ${avg(l10,'assists')}A / ${avgPtsG(l10)} PTS | ${avg(l10,'fg_made')} SOG
L20: ${avg(l20,'points')}G / ${avg(l20,'assists')}A / ${avgPtsG(l20)} PTS | ${avg(l20,'fg_made')} SOG
+/-: L10 ${avg(l10,'plus_minus')} | L20 ${avg(l20,'plus_minus')}
TOI: ${avg(l10,'minutes')} min/g | PIM: ${avg(l10,'turnovers')}/g

POWER PLAY (last 10):
PP Goals/g: ${ppgAvg} | PP TOI/g: ${ppTOI} min
${parseFloat(ppgAvg) > 0 ? `${fullName.split(' ')[0]} is producing on the power play — ${ppgAvg} PP goals per game on ${ppTOI} min PP ice` : 'No significant PP production in last 10 games'}

HOME vs AWAY (last 20):
Home (${homeGames.length}g): ${avg(homeGames,'points')}G / ${avg(homeGames,'assists')}A / ${avgPtsG(homeGames)} PTS
Away (${awayGames.length}g): ${avg(awayGames,'points')}G / ${avg(awayGames,'assists')}A / ${avgPtsG(awayGames)} PTS

LAST 10 GAMES:
${logLines.join('\n')}

${tonightBlock}

${propLines ? `TONIGHT'S PROP LINES:\n${propLines}` : 'No prop lines available for tonight.'}
`.trim();
}

function buildNHLGoalieOutput(fullName, abbr, logs, apiLog, hasDB, tonightBlock, propLines) {
  // DB: steals=saves, blocks=GA, fg_att=shots_faced, fg_pct=SV%, off_reb=GSAA, plus_minus=1(W)/-1(L)
  const l5  = logs.slice(0, 5);
  const l10 = logs.slice(0, 10);
  const l20 = logs;

  const wins   = (rows) => rows.filter(g => parseFloat(g.plus_minus) === 1).length;
  const losses = (rows) => rows.filter(g => parseFloat(g.plus_minus) < 0).length;

  const logLines = l10.map(g => {
    const svPct = g.fg_pct ? parseFloat(g.fg_pct).toFixed(3) : '?.???';
    const result = parseFloat(g.plus_minus) === 1 ? 'W' : parseFloat(g.plus_minus) < 0 ? 'L' : 'OT';
    return `  ${fmtDate(g.game_date)} ${g.home_away==='home'?'vs':'@'} ${g.opponent}: ${g.steals}sv ${g.blocks}GA ${svPct} SV% ${result}`;
  });

  const svPctTrend = parseFloat(avgPct(l5.filter(g=>g.fg_pct),'fg_pct',3)) > parseFloat(avgPct(l10.filter(g=>g.fg_pct),'fg_pct',3))
    ? '↑ getting hotter' : '↓ trending down';

  return `
NHL GOALIE DATA: ${fullName} (${abbr})
Games in database: ${l20.length}

SEASON STATS (last 20 starts):
SV%:      L5 ${avgPct(l5.filter(g=>g.fg_pct),'fg_pct',3)} | L10 ${avgPct(l10.filter(g=>g.fg_pct),'fg_pct',3)} | L20 ${avgPct(l20.filter(g=>g.fg_pct),'fg_pct',3)}
Trend:    ${svPctTrend}
GAA:      L5 ${avg(l5,'blocks')} | L10 ${avg(l10,'blocks')} | L20 ${avg(l20,'blocks')}
GSAA:     L10 ${avg(l10.filter(g=>g.off_reb),'off_reb')}
Saves/g:  L10 ${avg(l10,'steals')}
Record:   L10: ${wins(l10)}W-${losses(l10)}L-${l10.length-wins(l10)-losses(l10)}OT | L20: ${wins(l20)}W-${losses(l20)}L-${l20.length-wins(l20)-losses(l20)}OT

LAST 10 STARTS:
${logLines.join('\n')}

${tonightBlock}

${propLines ? `TONIGHT'S PROP LINES:\n${propLines}` : ''}
`.trim();
}

// ── MLB ───────────────────────────────────────────────────────────────────────

async function getMLBPlayerComplete(playerName) {
  const season = new Date().getFullYear();

  // 1. MLB Stats API player lookup
  const allPlayers = await mlbStats.getActivePlayers(season).catch(() => []);
  const pParts     = playerName.toLowerCase().split(' ');
  const found      = allPlayers.find(p => {
    const n = (p.fullName || '').toLowerCase();
    return pParts.every(part => n.includes(part)) || pParts.some(part => part.length > 4 && n.includes(part));
  });

  if (!found) return `No active MLB player found matching "${playerName}". Try their full name.`;

  const pName    = found.fullName;
  const teamAbbr = found.currentTeam?.abbreviation || '';
  const pos      = found.primaryPosition?.abbreviation || '';
  const isPitch  = found.primaryPosition?.type?.description === 'Pitcher';
  const group    = isPitch ? 'pitching' : 'hitting';
  const bats     = found.batSide?.code || '';
  const throws   = found.pitchHand?.code || '';

  // 2. MLB Stats API: season stats + game log
  const [seasonStats, gameLog] = await Promise.all([
    mlbStats.getPlayerSeasonStats(found.id, season, group).catch(() => []),
    mlbStats.getPlayerGameLog(found.id, season, group).catch(() => []),
  ]);
  const stats  = seasonStats?.[0]?.stat || {};
  const recent = gameLog.slice(0, 10);

  // 3. DB game logs (2025 season data, use for history)
  const dbLogs = await db.query(`
    SELECT game_date, opponent, home_away,
           points as hits, fg_att as ab, fg_pct as avg,
           off_reb as hr, turnovers as rbi, steals as sb,
           three_made as doubles, rebounds as runs,
           ft_att as strikeouts, ft_made as walks
    FROM player_game_logs
    WHERE sport = 'MLB' AND player_name ILIKE $1
    ORDER BY game_date DESC
    LIMIT 20
  `, [`%${lastName(pName)}%`]);
  const dbRows = dbLogs.rows;

  // 4. Tonight's MLB schedule
  const today    = new Date().toISOString().split('T')[0];
  const mlbDate  = toMLBDate(today);
  const schedule = await mlbStats.getSchedule(mlbDate).catch(() => []);
  const tonightGame = schedule?.find(g =>
    g.teams?.home?.team?.abbreviation === teamAbbr ||
    g.teams?.away?.team?.abbreviation === teamAbbr
  );

  // 5. Weather
  let weatherBlock = '';
  if (tonightGame?.venue?.name) {
    const wx = await weather.getWeatherByVenueName(tonightGame.venue.name).catch(() => null);
    if (wx?.weather_available) {
      const windEffect = (wx.wind_mph > 20)
        ? (wx.wind_dir_label?.toLowerCase().includes('out') ? 'HITTER FRIENDLY — blowing out' : 'PITCHER FRIENDLY — blowing in')
        : 'neutral';
      weatherBlock = `Weather: ${wx.temp_f}°F | Wind: ${wx.wind_mph}mph ${wx.wind_dir_label} (${windEffect})`;
      if (wx.altitude_ft >= 5000) weatherBlock += ' | Coors altitude — major carry boost';
    }
  }

  // 6. Odds + prop lines
  let oddsEventId = null;
  if (tonightGame) {
    const events = await oddsService.fetchEvents('MLB').catch(() => []);
    const oppName = tonightGame.teams?.home?.team?.abbreviation === teamAbbr
      ? (tonightGame.teams?.away?.team?.name || '').toLowerCase()
      : (tonightGame.teams?.home?.team?.name || '').toLowerCase();
    const event = events?.find(e =>
      e.home_team?.toLowerCase().includes(oppName.split(' ').pop()) ||
      e.away_team?.toLowerCase().includes(oppName.split(' ').pop())
    );
    oddsEventId = event?.id || null;
  }
  const propLines = await fetchLivePropLines('MLB', pName, oddsEventId);

  // Build output
  if (isPitch) {
    const recentLog = recent.map(g => {
      const s = g.stat || {};
      return `  ${(g.date||'').slice(0,10)} vs ${g.opponent?.name||'?'}: ${s.inningsPitched||'?'}IP ${s.earnedRuns??'?'}ER ${s.strikeOuts||0}K ${s.baseOnBalls||0}BB`;
    }).join('\n');

    const tonightBlock = tonightGame
      ? `TONIGHT: ${tonightGame.teams?.away?.team?.name} @ ${tonightGame.teams?.home?.team?.name}
Opposing probable: ${tonightGame.teams?.home?.probablePitcher?.fullName || tonightGame.teams?.away?.probablePitcher?.fullName || 'TBD'}
${weatherBlock}`
      : 'NOT SCHEDULED TONIGHT';

    return `
MLB PITCHER DATA: ${pName} (${teamAbbr}, ${pos}) — Throws: ${throws}
${season} Season Stats:
ERA: ${stats.era||'N/A'} | WHIP: ${stats.whip||'N/A'} | W-L: ${stats.wins||0}-${stats.losses||0}
K: ${stats.strikeOuts||0} | BB: ${stats.baseOnBalls||0} | K/9: ${stats.strikeoutsPer9Inn||'N/A'} | BB/9: ${stats.walksPer9Inn||'N/A'}
IP: ${stats.inningsPitched||'N/A'} | HR/9: ${stats.homeRunsPer9||'N/A'}

RECENT STARTS:
${recentLog || 'No recent starts on record.'}

${tonightBlock}

${propLines ? `PROP LINES TONIGHT:\n${propLines}` : ''}
`.trim();
  }

  // Hitter output
  const recentLog = recent.map(g => {
    const s = g.stat || {};
    return `  ${(g.date||'').slice(0,10)} vs ${g.opponent?.name||'?'}: ${s.atBats||0}AB ${s.hits||0}H ${s.homeRuns||0}HR ${s.rbi||0}RBI ${s.baseOnBalls||0}BB ${s.strikeOuts||0}K`;
  }).join('\n');

  // DB history (L20 from 2025)
  const dbL10  = dbRows.slice(0, 10);
  const dbL5   = dbRows.slice(0, 5);
  const dbBlock = dbRows.length > 0 ? `
GAME LOG HISTORY (${dbRows.length} games, 2025 season):
L5 avg: ${avg(dbL5,'hits')}H / ${avg(dbL5,'hr')}HR / ${avg(dbL5,'rbi')}RBI per game
L10 avg: ${avg(dbL10,'hits')}H / ${avg(dbL10,'hr')}HR / ${avg(dbL10,'rbi')}RBI per game
Last 5: ${dbL5.map(g => `${fmtDate(g.game_date)}: ${g.hits}H ${g.hr}HR`).join(', ')}` : '';

  const tonightBlock = tonightGame ? `
TONIGHT: ${tonightGame.teams?.away?.team?.name} @ ${tonightGame.teams?.home?.team?.name}
${new Date(tonightGame.gameDate).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})} ET
Opposing SP: ${
  tonightGame.teams?.home?.team?.abbreviation === teamAbbr
    ? (tonightGame.teams?.away?.probablePitcher?.fullName || 'TBD')
    : (tonightGame.teams?.home?.probablePitcher?.fullName || 'TBD')
}
${weatherBlock}` : 'NOT SCHEDULED TONIGHT';

  return `
MLB BATTER DATA: ${pName} (${teamAbbr}, ${pos}) — Bats: ${bats}
${season} Season Stats:
AVG: ${stats.avg||'N/A'} | OBP: ${stats.obp||'N/A'} | SLG: ${stats.slg||'N/A'} | OPS: ${stats.ops||'N/A'}
HR: ${stats.homeRuns||0} | RBI: ${stats.rbi||0} | H: ${stats.hits||0} | R: ${stats.runs||0} | SB: ${stats.stolenBases||0}
K: ${stats.strikeOuts||0} | BB: ${stats.baseOnBalls||0} | GP: ${stats.gamesPlayed||0}

RECENT GAMES (${season} season):
${recentLog || 'No recent games on record yet.'}
${dbBlock}

${tonightBlock}

${propLines ? `PROP LINES TONIGHT:\n${propLines}` : ''}
`.trim();
}

// ── Comparative ───────────────────────────────────────────────────────────────

async function getComparativeStats(sport, statCategory, scope) {
  const n = scope === 'last_5' ? 5 : scope === 'last_10' ? 10 : 20;
  const today = new Date().toISOString().split('T')[0];

  // Get tonight's teams
  let tonightTeams = [];
  if (sport === 'NBA') {
    const games = await bdl.getGames(today).catch(() => []);
    for (const g of games || []) {
      if (g.home_team?.abbreviation)    tonightTeams.push(g.home_team.abbreviation);
      if (g.visitor_team?.abbreviation) tonightTeams.push(g.visitor_team.abbreviation);
    }
  } else if (sport === 'NHL') {
    const games = await nhlApi.getSchedule(today).catch(() => []);
    for (const g of games || []) {
      if (g.homeTeam?.abbrev) tonightTeams.push(g.homeTeam.abbrev);
      if (g.awayTeam?.abbrev) tonightTeams.push(g.awayTeam.abbrev);
    }
  } else if (sport === 'MLB') {
    const mlbDate = toMLBDate(today);
    const games   = await mlbStats.getSchedule(mlbDate).catch(() => []);
    for (const g of games || []) {
      if (g.teams?.home?.team?.abbreviation) tonightTeams.push(g.teams.home.team.abbreviation);
      if (g.teams?.away?.team?.abbreviation) tonightTeams.push(g.teams.away.team.abbreviation);
    }
  }

  if (!tonightTeams.length) return `No ${sport} games found tonight.`;

  // Map statCategory to DB column + sport-specific label
  const STAT_MAP = {
    // NBA
    'points': { col: 'points', label: 'PTS', sport: 'NBA' },
    'rebounds': { col: 'rebounds', label: 'REB', sport: 'NBA' },
    'assists': { col: 'assists', label: 'AST', sport: 'NBA' },
    'steals': { col: 'steals', label: 'STL', sport: 'NBA' },
    'blocks': { col: 'blocks', label: 'BLK', sport: 'NBA' },
    '3pm': { col: 'three_made', label: '3PM', sport: 'NBA' },
    'fg_pct': { col: 'fg_pct', label: 'FG%', sport: 'NBA' },
    // NHL skater
    'goals': { col: 'points', label: 'G', sport: 'NHL' },
    'nhl_assists': { col: 'assists', label: 'A', sport: 'NHL' },
    'sog': { col: 'fg_made', label: 'SOG', sport: 'NHL' },
    // NHL goalie
    'sv_pct': { col: 'fg_pct', label: 'SV%', sport: 'NHL', posFilter: 'G' },
    'gaa': { col: 'blocks', label: 'GAA', sport: 'NHL', posFilter: 'G' },
    'saves': { col: 'steals', label: 'Saves', sport: 'NHL', posFilter: 'G' },
    // MLB
    'hits': { col: 'points', label: 'H', sport: 'MLB' },
    'era': { col: 'fg_pct', label: 'ERA', sport: 'MLB' },
    'strikeouts': { col: 'ft_att', label: 'K', sport: 'MLB' },
  };

  const statInfo = STAT_MAP[statCategory] || { col: statCategory, label: statCategory, sport };
  const isLowerBetter = ['era', 'gaa', 'fg_pct'].includes(statCategory) && sport !== 'NBA';

  const posFilter = statInfo.posFilter ? `AND position = '${statInfo.posFilter}'` : '';

  // Query all players from tonight's teams
  const teamList = tonightTeams.map((_, i) => `$${i + 2}`).join(',');
  const result = await db.query(`
    SELECT player_name, team,
           AVG(${statInfo.col}::numeric) as avg_val,
           COUNT(*) as games,
           ARRAY_AGG(${statInfo.col}::numeric ORDER BY game_date DESC) as recent_vals
    FROM player_game_logs
    WHERE sport = $1 AND team = ANY($2::text[])
    AND game_date >= CURRENT_DATE - ${n * 7}
    AND ${statInfo.col} IS NOT NULL
    ${posFilter}
    GROUP BY player_name, team
    HAVING COUNT(*) >= 3
    ORDER BY ${isLowerBetter ? 'AVG(' + statInfo.col + '::numeric) ASC' : 'AVG(' + statInfo.col + '::numeric) DESC'}
    LIMIT 15
  `, [sport, tonightTeams]);

  const rows = result.rows;
  if (!rows.length) return `No comparative data found for ${sport} ${statCategory} tonight.`;

  const formatRow = (r, i) => {
    const recentStr = (r.recent_vals || []).slice(0, 5)
      .map(v => v != null ? parseFloat(v).toFixed(1) : '?')
      .join(', ');
    return `${i+1}. ${r.player_name} (${r.team}): ${parseFloat(r.avg_val).toFixed(2)} ${statInfo.label}/g [${r.games}g] — L5: ${recentStr}`;
  };

  return `
COMPARATIVE: ${statInfo.label} — Tonight's ${sport} Slate (last ${n} games used)
Teams playing: ${tonightTeams.join(', ')}

${rows.map(formatRow).join('\n')}
`.trim();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getNBAPlayerComplete,
  getNHLPlayerComplete,
  getMLBPlayerComplete,
  getComparativeStats,
};
