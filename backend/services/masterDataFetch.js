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
 *               three_att=NOT_USEFUL(≈0), plus_minus=+/-, minutes=TOI
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

function avg(rows, col) {
  const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v) && v !== null);
  if (!vals.length) return 'N/A';
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

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

function getB2BGames(rows) {
  const sorted = [...rows].sort((a, b) => new Date(b.game_date) - new Date(a.game_date));
  return sorted.filter((g, i) => {
    if (i >= sorted.length - 1) return false;
    const curr = new Date(g.game_date);
    const prev = new Date(sorted[i + 1].game_date);
    return Math.abs((curr - prev) / (1000 * 60 * 60 * 24)) <= 1;
  });
}

// Use Eastern Time for all schedule lookups — NBA/NHL/MLB games are scheduled in ET
// Using UTC can flip the date at midnight ET (e.g. 11pm ET = next day UTC)
function getTodayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function normName(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();
}

function lastName(name) {
  return (name || '').trim().split(' ').pop();
}

// NHL team abbreviation → keyword used to match Odds API team names
const NHL_TEAM_WORDS = {
  'EDM': 'edmonton', 'TOR': 'toronto', 'BOS': 'boston',   'NYR': 'rangers',
  'FLA': 'florida',  'TBL': 'lightning','COL': 'colorado', 'DAL': 'dallas',
  'VAN': 'vancouver','WPG': 'jets',     'CAR': 'carolina', 'VGK': 'golden knights',
  'WSH': 'washington','PIT': 'pittsburgh','NJD': 'devils', 'NSH': 'nashville',
  'STL': 'blues',    'MIN': 'minnesota', 'CGY': 'calgary', 'OTT': 'ottawa',
  'UTA': 'utah',     'SJS': 'sharks',   'DET': 'detroit',  'BUF': 'buffalo',
  'MTL': 'montreal', 'PHI': 'flyers',   'CBJ': 'columbus', 'SEA': 'seattle',
  'LAK': 'kings',    'ANA': 'anaheim',  'NYI': 'islanders','CHI': 'blackhawks',
};

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

async function getNBAPlayerComplete(playerName, displayNameHint) {
  // 1. BDL player lookup — prefer active players, match first name to disambiguate (e.g. Cade vs Dante Cunningham)
  const bdlTerm = playerName.split(' ').pop().toLowerCase();
  let found = await bdl.searchPlayers(bdlTerm).catch(() => []);
  if (!found?.[0]) found = await bdl.searchPlayers(playerName.toLowerCase()).catch(() => []);
  if (!found?.[0]) return null;

  // Prefer players with an active team
  const active = (found || []).filter(p => p.team !== null);
  const pool   = active.length > 0 ? active : found;

  // If a display name hint is provided, prefer the player whose first name matches
  let player = null;
  if (displayNameHint) {
    const firstHint = displayNameHint.split(' ')[0].toLowerCase();
    player = pool.find(p => (p.first_name || '').toLowerCase().startsWith(firstHint));
  }
  if (!player) player = pool[0];
  const pName  = `${player.first_name} ${player.last_name}`;
  const abbr   = player.team?.abbreviation || '';
  const season = getCurrentNBASeason();

  // 2. DB queries — all parallel (game logs, vs history, injury, projections, full season)
  const [logsResult, vsOppResult, injuryResult, projResult, seasonLogsResult] = await Promise.all([
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
    db.query(`
      SELECT game_date, opponent, home_away,
             points, rebounds, assists, fg_pct, minutes, plus_minus
      FROM player_game_logs
      WHERE sport = 'NBA' AND player_name ILIKE $1
      AND game_date >= CURRENT_DATE - 1095
      ORDER BY game_date DESC
      LIMIT 15
    `, [`%${lastName(pName)}%`]),
    db.query(`
      SELECT is_confirmed_playing, injury_status
      FROM nightly_roster
      WHERE player_name ILIKE $1 AND game_date = CURRENT_DATE AND sport = 'NBA'
      LIMIT 1
    `, [`%${lastName(pName)}%`]),
    db.query(`
      SELECT prop_type, proj_value, confidence_score,
             factors_json->>'archetype' as archetype,
             (factors_json->>'market_line')::numeric as market_line,
             (factors_json->>'edge')::numeric as edge
      FROM chalk_projections
      WHERE player_name ILIKE $1 AND game_date = CURRENT_DATE AND sport = 'NBA'
      AND prop_type IS NOT NULL AND proj_value IS NOT NULL
      ORDER BY confidence_score DESC NULLS LAST
    `, [`%${lastName(pName)}%`]),
    db.query(`
      SELECT game_date, opponent, home_away, points, rebounds, assists,
             fg_pct, steals, blocks, turnovers, minutes, plus_minus
      FROM player_game_logs
      WHERE sport = 'NBA' AND player_name ILIKE $1
      AND game_date >= '2025-10-01'
      ORDER BY game_date ASC
    `, [`%${pName}%`]),
  ]);

  const logs = logsResult.rows;
  if (logs.length < 3) return `${pName} (${abbr}) — only ${logs.length} games in database. Season may not have started.`;

  const l5  = logs.slice(0, 5);
  const l10 = logs.slice(0, 10);
  const l20 = logs;

  // 3. Splits — full 2025-26 season for home/away and B2B (much larger sample)
  const seasonLogs   = seasonLogsResult.rows;
  const seasonHome   = seasonLogs.filter(g => g.home_away === 'home');
  const seasonAway   = seasonLogs.filter(g => g.home_away === 'away');
  const seasonB2B    = getB2BGames(seasonLogs);
  const seasonNormal = seasonLogs.filter(g => !seasonB2B.includes(g));

  // Fallback: if season query returned nothing, use l20 for splits
  const homeGames   = seasonHome.length  > 0 ? seasonHome  : l20.filter(g => g.home_away === 'home');
  const awayGames   = seasonAway.length  > 0 ? seasonAway  : l20.filter(g => g.home_away === 'away');
  const b2bGames    = seasonB2B.length   > 0 ? seasonB2B   : getB2BGames(l20);
  const normalGames = seasonNormal.length > 0 ? seasonNormal : l20.filter(g => !getB2BGames(l20).includes(g));
  const splitLabel  = seasonLogs.length  > 0 ? `full 2025-26 season (${seasonLogs.length}g)` : 'last 20 games';

  // 4. Injury header
  const injuryRow = injuryResult.rows[0];
  let injuryHeader = '';
  if (injuryRow) {
    if (injuryRow.is_confirmed_playing === false) {
      injuryHeader = `⚠ STATUS: OUT — ${injuryRow.injury_status || 'injured'}\nThis player is NOT playing tonight.\n\n`;
    } else if (injuryRow.is_confirmed_playing === null) {
      injuryHeader = `⚠ STATUS: QUESTIONABLE — ${injuryRow.injury_status || 'listed questionable'}\nMay or may not play tonight. Check closer to game time.\n\n`;
    }
  }

  // 5. Chalk projections block
  const projRows = projResult.rows;
  let projBlock = '';
  if (projRows.length > 0) {
    const PROJ_LABELS = {
      points: 'Points', rebounds: 'Rebounds', assists: 'Assists',
      threes: '3PM', pra: 'PRA', pts_ast: 'P+A', pts_reb: 'P+R',
    };
    const archetype = projRows.find(r => r.archetype)?.archetype || null;
    const archetypeLine = archetype ? `  Player archetype: ${archetype}` : '';
    const lines = projRows.map(r => {
      const label = PROJ_LABELS[r.prop_type] || r.prop_type;
      const proj  = parseFloat(r.proj_value).toFixed(1);
      const ml    = r.market_line != null ? ` | Line: ${parseFloat(r.market_line).toFixed(1)}` : '';
      const edge  = r.edge != null ? ` | Edge: ${r.edge > 0 ? '+' : ''}${parseFloat(r.edge).toFixed(2)}` : '';
      const conf  = r.confidence_score ? ` | Conf: ${r.confidence_score}%` : '';
      return `  ${label}: proj ${proj}${ml}${edge}${conf}`;
    });
    const header = archetypeLine ? `${archetypeLine}\n` : '';
    projBlock = `CHALK PROPRIETARY MODEL — Tonight's Projections:\n${header}${lines.join('\n')}`;
  }

  // 6. Tonight's game via BDL — use ET date, verify game.date matches exactly
  const today    = getTodayET();
  const bdlGames = await bdl.getGames(today).catch(() => []);
  const tonightGame = bdlGames?.find(g =>
    g.date === today &&
    (g.home_team?.abbreviation === abbr || g.visitor_team?.abbreviation === abbr)
  );

  let oddsContext = '';
  let oddsEventId = null;
  let tonightBlock = 'NOT PLAYING TONIGHT';

  if (tonightGame) {
    const isHome     = tonightGame.home_team?.abbreviation === abbr;
    const oppAbbr    = isHome ? tonightGame.visitor_team?.abbreviation : tonightGame.home_team?.abbreviation;
    const oppFull    = isHome ? (tonightGame.visitor_team?.full_name || oppAbbr) : (tonightGame.home_team?.full_name || oppAbbr);
    const playerFull = isHome ? (tonightGame.home_team?.full_name || abbr) : (tonightGame.visitor_team?.full_name || abbr);
    const teamWord   = oppFull.split(' ').pop().toLowerCase();

    const rawStatus = tonightGame.status || '';
    const gameTimeET = rawStatus.includes('T')
      ? new Date(rawStatus).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
      : (rawStatus || 'TBD');

    // VS opponent history — use abbreviation for exact match
    const vsRows = vsOppResult.rows.filter(g =>
      g.opponent === oppAbbr ||
      (g.opponent || '').toLowerCase().includes(teamWord)
    );

    // Odds + extra context queries (all parallel)
    const events = await oddsService.fetchEvents('NBA').catch(() => []);
    const event  = events?.find(e =>
      e.home_team?.toLowerCase().includes(teamWord) ||
      e.away_team?.toLowerCase().includes(teamWord)
    );
    oddsEventId = event?.id || null;

    const [gameOddsArr, pdrResult, playerPaceResult, oppPaceResult] = await Promise.all([
      oddsService.fetchGameOdds('NBA').catch(() => []),
      db.query(`
        WITH ranked AS (
          SELECT team_name, pts_allowed, reb_allowed, ast_allowed, three_allowed, fg_pct_allowed,
            RANK() OVER (ORDER BY pts_allowed ASC) as pts_def_rank,
            COUNT(*) OVER () as total_teams
          FROM position_defense_ratings
          WHERE sport = 'NBA'
        )
        SELECT * FROM ranked WHERE team_name = $1 LIMIT 1
      `, [oppAbbr]),
      db.query(`
        SELECT AVG(points_scored) as avg_pts, AVG(points_allowed) as avg_pa, AVG(pace) as avg_pace
        FROM team_game_logs
        WHERE sport = 'NBA' AND team_name = $1 AND game_date >= CURRENT_DATE - 30
      `, [playerFull]),
      db.query(`
        SELECT AVG(points_scored) as avg_pts, AVG(points_allowed) as avg_pa, AVG(pace) as avg_pace
        FROM team_game_logs
        WHERE sport = 'NBA' AND team_name = $1 AND game_date >= CURRENT_DATE - 30
      `, [oppFull]),
    ]);

    // Parse game odds
    if (event) {
      const gameOddsMap = {};
      for (const g of gameOddsArr || []) gameOddsMap[g.id] = g;
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
    }

    // Position defense block
    const pdr = pdrResult.rows[0];
    let defenseBlock = '';
    if (pdr) {
      const rankStr = pdr.pts_def_rank && pdr.total_teams
        ? ` (ranked ${pdr.pts_def_rank}/${pdr.total_teams} toughest on PTS)`
        : '';
      defenseBlock = `Opponent defense (${oppAbbr}): Allows ${parseFloat(pdr.pts_allowed).toFixed(1)} PTS/g${rankStr} | ${parseFloat(pdr.reb_allowed).toFixed(1)} REB/g | ${parseFloat(pdr.ast_allowed).toFixed(1)} AST/g | ${(parseFloat(pdr.fg_pct_allowed) * 100).toFixed(1)}% FG allowed`;
    }

    // Team pace block
    const pp = playerPaceResult.rows[0];
    const op = oppPaceResult.rows[0];
    let paceBlock = '';
    if (pp?.avg_pts || op?.avg_pts) {
      const combinedPace = ((parseFloat(pp?.avg_pace || 100) + parseFloat(op?.avg_pace || 100)) / 2).toFixed(1);
      const lines = [];
      if (pp?.avg_pts) lines.push(`${abbr} last 30d: ${parseFloat(pp.avg_pts).toFixed(1)} PPG off | ${parseFloat(pp.avg_pa).toFixed(1)} PPG def | Pace: ${parseFloat(pp.avg_pace).toFixed(1)}`);
      if (op?.avg_pts) lines.push(`${oppAbbr} last 30d: ${parseFloat(op.avg_pts).toFixed(1)} PPG off | ${parseFloat(op.avg_pa).toFixed(1)} PPG def | Pace: ${parseFloat(op.avg_pace).toFixed(1)}`);
      lines.push(`Combined pace: ${combinedPace}`);
      paceBlock = lines.join('\n');
    }

    // VS opponent history
    let vsBlock = '';
    if (vsRows.length > 0) {
      vsBlock = `VS ${oppFull.toUpperCase()} HISTORY (${vsRows.length} games):
  Avg: ${avg(vsRows, 'points')} PTS / ${avg(vsRows, 'rebounds')} REB / ${avg(vsRows, 'assists')} AST
  Individual: ${vsRows.slice(0, 6).map(g => `${fmtDate(g.game_date)} ${g.points}/${g.rebounds}/${g.assists}`).join(', ')}`;
    } else {
      vsBlock = `VS ${oppFull.toUpperCase()}: No head-to-head history in database.`;
    }

    tonightBlock = [
      `TONIGHT'S GAME: ${isHome ? 'vs' : '@'} ${oppFull} at ${gameTimeET}`,
      oddsContext.trim() || 'Odds not yet posted.',
      defenseBlock,
      paceBlock,
      vsBlock,
    ].filter(Boolean).join('\n');

    // 7. Prop lines
    const propLines = await fetchLivePropLines('NBA', pName, oddsEventId);
    return buildNBAOutput(pName, abbr, season, logs, l5, l10, l20, homeGames, awayGames, b2bGames, normalGames, tonightBlock, propLines, injuryHeader, projBlock, splitLabel);
  }

  return buildNBAOutput(pName, abbr, season, logs, l5, l10, l20, homeGames, awayGames, b2bGames, normalGames, 'NOT PLAYING TONIGHT', '', injuryHeader, projBlock, splitLabel);
}

function buildNBAOutput(pName, abbr, season, logs, l5, l10, l20, homeGames, awayGames, b2bGames, normalGames, tonightBlock, propLines, injuryHeader = '', projBlock = '', splitLabel = 'last 20 games') {
  const l20FG  = avgPct(l20.filter(g => g.fg_pct != null), 'fg_pct', 3);
  const l20_3P = avgPct(l20.filter(g => g.three_pct != null), 'three_pct', 3);
  const l20FT  = avgPct(l20.filter(g => g.ft_pct != null), 'ft_pct', 3);
  const l20TS  = avgPct(l20.filter(g => g.true_shooting_pct != null), 'true_shooting_pct', 3);
  const l20USG = avgPct(l20.filter(g => g.usage_rate != null), 'usage_rate', 1);

  const l10log = l20.slice(0, 10).map(g => {
    const fg  = g.fg_pct != null ? `FG ${(parseFloat(g.fg_pct) * 100).toFixed(0)}%` : '';
    const min = g.minutes != null ? `${Math.round(parseFloat(g.minutes))}min` : '';
    const pm  = g.plus_minus != null ? `${g.plus_minus > 0 ? '+' : ''}${g.plus_minus}` : '';
    return `  ${fmtDate(g.game_date)} ${g.home_away === 'home' ? 'vs' : '@'} ${g.opponent}: ${g.points}pts ${g.rebounds}reb ${g.assists}ast ${fg} ${min} ${pm}`.trim();
  });

  const trendArrow = parseFloat(avg(l5, 'points')) > parseFloat(avg(l20, 'points')) ? '↑ above' : '↓ below';
  const trendDiff  = Math.abs(parseFloat(avg(l5, 'points')) - parseFloat(avg(l20, 'points'))).toFixed(1);

  return `${injuryHeader}NBA PLAYER DATA: ${pName} (${abbr}) — ${season}-${String(season + 1).slice(2)} Season
Games in database: ${l20.length}

SEASON AVERAGES (${splitLabel}):
PTS: ${avg(l20, 'points')} | REB: ${avg(l20, 'rebounds')} | AST: ${avg(l20, 'assists')} | STL: ${avg(l20, 'steals')} | BLK: ${avg(l20, 'blocks')} | TO: ${avg(l20, 'turnovers')}
FG%: ${l20FG} | 3P%: ${l20_3P} | FT%: ${l20FT}${l20TS !== 'N/A' ? ` | TS%: ${l20TS}` : ''}${l20USG !== 'N/A' ? ` | USG%: ${l20USG}` : ''}
MPG: ${avg(l20, 'minutes')} | +/-: ${avg(l20, 'plus_minus')}

RECENT FORM:
L5:  ${avg(l5, 'points')} PTS / ${avg(l5, 'rebounds')} REB / ${avg(l5, 'assists')} AST
L10: ${avg(l10, 'points')} PTS / ${avg(l10, 'rebounds')} REB / ${avg(l10, 'assists')} AST
L20: ${avg(l20, 'points')} PTS / ${avg(l20, 'rebounds')} REB / ${avg(l20, 'assists')} AST
Trend: L5 scoring is ${trendDiff} pts ${trendArrow} the L20 average

LAST 10 GAMES (most recent first):
${l10log.join('\n')}

HOME vs AWAY (${splitLabel}):
Home (${homeGames.length}g): ${avg(homeGames, 'points')} PTS / ${avg(homeGames, 'rebounds')} REB / ${avg(homeGames, 'assists')} AST / ${avg(homeGames, 'turnovers')} TO | FG%: ${avgPct(homeGames.filter(g => g.fg_pct), 'fg_pct', 3)}
Away (${awayGames.length}g): ${avg(awayGames, 'points')} PTS / ${avg(awayGames, 'rebounds')} REB / ${avg(awayGames, 'assists')} AST / ${avg(awayGames, 'turnovers')} TO | FG%: ${avgPct(awayGames.filter(g => g.fg_pct), 'fg_pct', 3)}

BACK-TO-BACK (${splitLabel}):
${b2bGames.length >= 1
  ? `B2B (${b2bGames.length}g): ${avg(b2bGames, 'points')} PTS / ${avg(b2bGames, 'rebounds')} REB / ${avg(b2bGames, 'assists')} AST
Normal rest (${normalGames.length}g): ${avg(normalGames, 'points')} PTS / ${avg(normalGames, 'rebounds')} REB / ${avg(normalGames, 'assists')} AST
B2B impact: ${(parseFloat(avg(b2bGames, 'points')) - parseFloat(avg(normalGames, 'points'))).toFixed(1)} PTS vs normal rest`
  : `Small sample (${b2bGames.length} B2B games found in ${splitLabel}). No meaningful B2B split available.`}

${tonightBlock}

${propLines ? `TONIGHT'S PROP LINES:\n${propLines}` : 'No prop lines available yet.'}

${projBlock}`.trim();
}

// ── NHL ───────────────────────────────────────────────────────────────────────

async function getNHLPlayerComplete(playerName) {
  const lower = playerName.toLowerCase();

  // 1. Determine team from alias map
  const NHL_PLAYER_TEAMS = {
    'mcdavid': 'EDM', 'draisaitl': 'EDM', 'hyman': 'EDM',
    'matthews': 'TOR', 'marner': 'TOR', 'nylander': 'TOR', 'stolarz': 'TOR',
    'crosby': 'PIT', 'malkin': 'PIT', 'letang': 'PIT',
    'ovechkin': 'WSH', 'ovi': 'WSH',
    'mackinnon': 'COL', 'makar': 'COL', 'rantanen': 'COL',
    'hedman': 'TBL', 'point': 'TBL', 'vasilevskiy': 'TBL', 'kucherov': 'TBL',
    'tkachuk': 'FLA', 'barkov': 'FLA', 'reinhart': 'FLA',
    'pasta': 'BOS', 'pastrnak': 'BOS', 'marchand': 'BOS',
    'hughes': 'VAN', 'demko': 'VAN', 'pettersson': 'VAN',
    'caufield': 'MTL', 'suzuki': 'MTL',
    'robertson': 'DAL', 'heiskanen': 'DAL', 'oettinger': 'DAL',
    'aho': 'CAR', 'svechnikov': 'CAR',
    'eichel': 'VGK', 'stone': 'VGK',
    'panarin': 'NYR', 'shesterkin': 'NYR', 'trocheck': 'NYR',
    'laine': 'CBJ',
    'kaprizov': 'MIN', 'fleury': 'MIN',
    'stamkos': 'NSH', 'duchene': 'NSH',
    'ullmark': 'OTT', 'stutzle': 'OTT',
    'larkin': 'DET',
    'hellebuyck': 'WPG', 'scheifele': 'WPG',
    'daccord': 'SEA', 'eberle': 'SEA',
  };

  let teamAbbr = null;
  for (const [kw, abbr] of Object.entries(NHL_PLAYER_TEAMS)) {
    if (lower.includes(kw)) { teamAbbr = abbr; break; }
  }

  // 2. NHL API roster lookup for player ID + position
  let nhlPlayerId = null;
  let fullName    = playerName;
  let position    = null;

  // 2a. If not in hardcoded dict, try NHL player search API to find team + position
  if (!teamAbbr) {
    try {
      const searchUrl = `https://api-web.nhle.com/v1/player/search?q=${encodeURIComponent(playerName)}&culture=en-us&limit=5`;
      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const players = Array.isArray(searchData) ? searchData : (searchData?.players || []);
        if (players.length > 0) {
          const p = players[0];
          teamAbbr  = p.teamAbbrev || p.currentTeamAbbrev || null;
          if (p.playerId)      nhlPlayerId = p.playerId;
          if (p.positionCode)  position    = p.positionCode;
          const fn = p.firstName?.default || p.firstName || '';
          const ln = p.lastName?.default  || p.lastName  || '';
          if (fn || ln) fullName = `${fn} ${ln}`.trim();
        }
      }
    } catch { /* continue without team — will still get DB logs by name */ }
  }

  if (teamAbbr) {
    const roster = await nhlApi.getTeamRoster(teamAbbr).catch(() => null);
    if (roster) {
      const all    = [...(roster.forwards || []), ...(roster.defensemen || []), ...(roster.goalies || [])];
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

  let isGoalie = position === 'G'
    || lower.includes('ullmark') || lower.includes('hellebuyck')
    || lower.includes('vasilevskiy') || lower.includes('demko') || lower.includes('shesterkin')
    || lower.includes('stolarz') || lower.includes('oettinger')
    || lower.includes('fleury') || lower.includes('daccord')
    || lower.includes('dobes') || lower.includes('gibson') || lower.includes('sorokin')
    || lower.includes('montembeault') || lower.includes('luukkonen') || lower.includes('fedotov')
    || lower.includes('markstrom') || lower.includes('binnington') || lower.includes('samsonov')
    || lower.includes('pavelski');

  // 3. DB game logs + projections + full season (parallel)
  const [dbLogs, projResult, nhlSeasonLogsResult] = await Promise.all([
    db.query(`
      SELECT game_date, opponent, home_away,
        points, assists, fg_made, turnovers, three_made, three_att,
        steals, blocks, fg_att, fg_pct, off_reb,
        plus_minus, minutes
      FROM player_game_logs
      WHERE sport = 'NHL' AND player_name ILIKE $1
      AND game_date >= CURRENT_DATE - 120
      ORDER BY game_date DESC
      LIMIT 20
    `, [`%${lastName(fullName)}%`]),
    db.query(`
      SELECT prop_type, proj_value, confidence_score,
             (factors_json->>'market_line')::numeric as market_line,
             (factors_json->>'edge')::numeric as edge
      FROM chalk_projections
      WHERE player_name ILIKE $1 AND game_date = CURRENT_DATE AND sport = 'NHL'
      AND prop_type IS NOT NULL AND proj_value IS NOT NULL
      ORDER BY prop_type
    `, [`%${lastName(fullName)}%`]),
    db.query(`
      SELECT game_date, opponent, home_away,
        points, assists, fg_made, turnovers, three_made,
        steals, blocks, fg_att, fg_pct, off_reb, plus_minus, minutes
      FROM player_game_logs
      WHERE sport = 'NHL' AND player_name ILIKE $1
      AND game_date >= '2025-10-01'
      ORDER BY game_date DESC
    `, [`%${lastName(fullName)}%`]),
  ]);

  const nhlSeasonLogs = nhlSeasonLogsResult.rows;
  const nhlSeasonHome = nhlSeasonLogs.filter(g => g.home_away === 'home');
  const nhlSeasonAway = nhlSeasonLogs.filter(g => g.home_away === 'away');
  const nhlSplitLabel = nhlSeasonLogs.length > 0 ? `full 2025-26 season (${nhlSeasonLogs.length}g)` : 'last 20 games';

  const logs = dbLogs.rows;

  // TOI-based goalie fallback: avg TOI > 40 min and avg saves > 10 means this is a goalie
  if (!isGoalie && logs.length >= 3) {
    const toiVals   = logs.map(g => parseFloat(g.minutes)).filter(v => !isNaN(v));
    const savesVals = logs.map(g => parseFloat(g.steals)).filter(v => !isNaN(v));
    const meanTOI   = toiVals.length   ? toiVals.reduce((a, b) => a + b, 0)   / toiVals.length   : 0;
    const meanSaves = savesVals.length ? savesVals.reduce((a, b) => a + b, 0) / savesVals.length : 0;
    if (meanTOI > 40 && meanSaves > 10) isGoalie = true;
  }

  // 4. NHL API game log as supplement
  let apiLog = [];
  if (nhlPlayerId) {
    const yr      = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const logData = await nhlApi.getPlayerGameLog(nhlPlayerId, `${yr}${yr + 1}`).catch(() => null);
    apiLog        = logData?.gameLog || [];
  }

  const hasDB = logs.length >= 5;

  // 5. Tonight's game + odds — use ET date
  const today    = getTodayET();
  const nhlGames = await nhlApi.getSchedule(today).catch(() => []);
  const tonightGame = teamAbbr
    ? nhlGames?.find(g => g.homeTeam?.abbrev === teamAbbr || g.awayTeam?.abbrev === teamAbbr)
    : null;

  let oddsEventId  = null;
  let tonightBlock = 'NOT PLAYING TONIGHT';

  if (tonightGame) {
    const isHome  = tonightGame.homeTeam?.abbrev === teamAbbr;
    const opp     = isHome ? (tonightGame.awayTeam?.placeName?.default || tonightGame.awayTeam?.abbrev)
                           : (tonightGame.homeTeam?.placeName?.default || tonightGame.homeTeam?.abbrev);
    const oppAbbr = isHome ? tonightGame.awayTeam?.abbrev : tonightGame.homeTeam?.abbrev;
    const timeET  = tonightGame.startTimeUTC
      ? new Date(tonightGame.startTimeUTC).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
      : 'TBD';

    // Find Odds API event using team word mapping (much more reliable than raw abbr)
    const teamWord = NHL_TEAM_WORDS[teamAbbr] || teamAbbr.toLowerCase();
    const oppWord  = NHL_TEAM_WORDS[oppAbbr]  || oppAbbr.toLowerCase();
    const events   = await oddsService.fetchEvents('NHL').catch(() => []);
    const event    = events?.find(e => {
      const ht = (e.home_team || '').toLowerCase();
      const at = (e.away_team || '').toLowerCase();
      return ht.includes(teamWord) || at.includes(teamWord) || ht.includes(oppWord) || at.includes(oppWord);
    });
    oddsEventId = event?.id || null;

    // Backup goalie + opponent shots (parallel with odds fetch)
    const [oppGoalieResult, oppShotsResult] = await Promise.all([
      db.query(`
        SELECT player_name, injury_status
        FROM nightly_roster
        WHERE sport = 'NHL' AND game_date = CURRENT_DATE
        AND team ILIKE $1
        ORDER BY is_confirmed_playing DESC NULLS LAST
        LIMIT 3
      `, [`%${opp}%`]),
      db.query(`
        SELECT AVG(blocks::numeric) as avg_shots_against
        FROM team_game_logs
        WHERE sport = 'NHL' AND team_name = $1
        AND game_date >= CURRENT_DATE - 60
      `, [oppAbbr]),
    ]);

    const goalieRows = oppGoalieResult.rows;
    let goalieBlock = '';
    if (goalieRows.length > 0) {
      goalieBlock = `Opp goalies (${oppAbbr}): ${goalieRows.map(g => g.player_name + (g.injury_status ? ` [${g.injury_status}]` : '')).join(', ')}`;
    }

    const oppShotsAvg = oppShotsResult.rows[0]?.avg_shots_against;
    const oppShotsBlock = oppShotsAvg
      ? `${oppAbbr} shots allowed/g (L60d): ${parseFloat(oppShotsAvg).toFixed(1)}`
      : '';

    // Game odds
    let oddsBlock = '';
    if (event) {
      const gameOddsArr = await oddsService.fetchGameOdds('NHL').catch(() => []);
      const gameOddsMap = {};
      for (const g of gameOddsArr || []) gameOddsMap[g.id] = g;
      const go = gameOddsMap[event.id];
      if (go?.bookmakers?.[0]) {
        const bm = go.bookmakers.find(b => b.key === 'draftkings') || go.bookmakers[0];
        const parts = [];
        for (const mkt of bm.markets || []) {
          if (mkt.key === 'h2h') {
            const awayOut = mkt.outcomes?.find(o => o.name === event.away_team);
            const homeOut = mkt.outcomes?.find(o => o.name === event.home_team);
            if (awayOut && homeOut) parts.push(`Moneyline: ${event.away_team} ${fmtOdds(awayOut.price)} / ${event.home_team} ${fmtOdds(homeOut.price)}`);
          }
          if (mkt.key === 'spreads') {
            const fav = mkt.outcomes?.find(o => o.point < 0);
            if (fav) parts.push(`Puck Line: ${fav.name} ${fav.point} (${fmtOdds(fav.price)})`);
          }
          if (mkt.key === 'totals') {
            const over = mkt.outcomes?.find(o => o.name === 'Over');
            if (over) parts.push(`Total: O/U ${over.point}`);
          }
        }
        if (parts.length) oddsBlock = parts.join('\n');
      }
    }

    // VS opponent history
    const vsLogs = logs.filter(g => g.opponent === oppAbbr || (g.opponent || '').toLowerCase().includes((oppAbbr || '').slice(0, 3).toLowerCase()));
    let vsBlock = '';
    if (vsLogs.length > 0) {
      vsBlock = isGoalie
        ? `VS ${opp.toUpperCase()} HISTORY (${vsLogs.length}g): SV% ${avgPct(vsLogs.filter(g => g.fg_pct), 'fg_pct', 3)} | GA/g ${avg(vsLogs, 'blocks')}`
        : `VS ${opp.toUpperCase()} HISTORY (${vsLogs.length}g): ${avg(vsLogs, 'points')}G / ${avg(vsLogs, 'assists')}A | SOG ${avg(vsLogs, 'fg_made')}`;
    }

    tonightBlock = [
      `TONIGHT: ${isHome ? 'vs' : '@'} ${opp} at ${timeET}`,
      oddsBlock || 'Odds not yet posted.',
      goalieBlock,
      oppShotsBlock,
      vsBlock,
    ].filter(Boolean).join('\n');
  }

  // 6. Chalk projections block for NHL
  const projRows = projResult.rows;
  let projBlock = '';
  if (projRows.length > 0) {
    const NHL_PROJ_LABELS = {
      goals: 'Goals', assists: 'Assists', points: 'Points',
      shots_on_goal: 'SOG', toi: 'TOI (min)', plus_minus: '+/-',
      saves: 'Saves', goals_against: 'Goals Against',
    };
    const lines = projRows
      .filter(r => ['goals', 'assists', 'points', 'shots_on_goal', 'saves', 'toi'].includes(r.prop_type))
      .map(r => {
        const label = NHL_PROJ_LABELS[r.prop_type] || r.prop_type;
        const proj  = parseFloat(r.proj_value).toFixed(r.prop_type === 'toi' ? 1 : 2);
        const ml    = r.market_line != null ? ` | Line: ${parseFloat(r.market_line).toFixed(1)}` : '';
        const edge  = r.edge != null ? ` | Edge: ${r.edge > 0 ? '+' : ''}${parseFloat(r.edge).toFixed(2)}` : '';
        const conf  = r.confidence_score ? ` | Conf: ${r.confidence_score}%` : '';
        return `  ${label}: proj ${proj}${ml}${edge}${conf}`;
      });
    if (lines.length) {
      projBlock = `CHALK PROPRIETARY MODEL — Tonight's Projections:\n${lines.join('\n')}`;
    }
  }

  // 7. Prop lines
  const propLines = await fetchLivePropLines('NHL', fullName, oddsEventId);

  if (isGoalie) {
    return buildNHLGoalieOutput(fullName, teamAbbr || '', logs, apiLog, hasDB, tonightBlock, propLines, projBlock, nhlSeasonHome, nhlSeasonAway, nhlSplitLabel);
  }
  return buildNHLSkaterOutput(fullName, teamAbbr || '', position, logs, apiLog, hasDB, tonightBlock, propLines, projBlock, nhlSeasonHome, nhlSeasonAway, nhlSplitLabel);
}

function buildNHLSkaterOutput(fullName, abbr, position, logs, apiLog, hasDB, tonightBlock, propLines, projBlock = '', seasonHome = [], seasonAway = [], splitLabel = 'last 20 games') {
  const l5  = logs.slice(0, 5);
  const l10 = logs.slice(0, 10);
  const l20 = logs;
  const homeGames = seasonHome.length > 0 ? seasonHome : l20.filter(g => g.home_away === 'home');
  const awayGames = seasonAway.length > 0 ? seasonAway : l20.filter(g => g.home_away === 'away');

  // DB: points=G, assists=A, fg_made=SOG, three_made=PPG, turnovers=PIM, plus_minus=+/-, minutes=TOI
  const totalPts  = (rows) => rows.map(g => (parseFloat(g.points) || 0) + (parseFloat(g.assists) || 0));
  const avgPtsG   = (rows) => rows.length ? (totalPts(rows).reduce((a, b) => a + b, 0) / rows.length).toFixed(2) : 'N/A';

  const logLines = (hasDB ? l10 : apiLog.slice(0, 10)).map(g => {
    if (hasDB) {
      const toi = g.minutes ? `${parseFloat(g.minutes).toFixed(1)}min` : '';
      const ppg = parseFloat(g.three_made) > 0 ? ` (${g.three_made}PPG)` : '';
      return `  ${fmtDate(g.game_date)} ${g.home_away === 'home' ? 'vs' : '@'} ${g.opponent}: ${g.points}G ${g.assists}A ${(parseFloat(g.points) || 0) + (parseFloat(g.assists) || 0)}PTS ${g.fg_made}SOG ${toi}${ppg} ${g.plus_minus > 0 ? '+' : ''}${g.plus_minus}`;
    } else {
      return `  ${(g.gameDate || '').slice(0, 10)} ${g.homeRoadFlag === 'H' ? 'vs' : '@'} ${g.opponentAbbrev || '?'}: ${g.goals}G ${g.assists}A ${g.points}PTS ${g.shots || 0}SOG${g.timeOnIce ? ' TOI:' + g.timeOnIce : ''}`;
    }
  });

  // Full season logs (combined home + away) for situational splits
  const allSeasonLogs = [...seasonHome, ...seasonAway].sort((a, b) => new Date(a.game_date) - new Date(b.game_date));
  const ppSource  = allSeasonLogs.length > 0 ? allSeasonLogs : l10;
  const ppLabel   = allSeasonLogs.length > 0 ? `full 2025-26 season (${allSeasonLogs.length}g)` : 'last 10 games';

  // PP vs EV split — three_made = PPG, points = total G
  const ppgAvg    = hasDB ? avg(ppSource, 'three_made') : 'N/A';
  const totalGAvg = hasDB ? avg(ppSource, 'points') : 'N/A';
  const evGAvg    = hasDB && ppSource.length > 0
    ? (ppSource.reduce((sum, g) => sum + Math.max(0, (parseFloat(g.points) || 0) - (parseFloat(g.three_made) || 0)), 0) / ppSource.length).toFixed(2)
    : 'N/A';

  return `NHL SKATER DATA: ${fullName} (${abbr})${position ? ` — ${position}` : ''}
Games in database: ${l20.length}${!hasDB && apiLog.length > 0 ? ` (API: ${apiLog.length})` : ''}

RECENT FORM (per game):
L5:  ${avg(l5, 'points')}G / ${avg(l5, 'assists')}A / ${avgPtsG(l5)} PTS | ${avg(l5, 'fg_made')} SOG
L10: ${avg(l10, 'points')}G / ${avg(l10, 'assists')}A / ${avgPtsG(l10)} PTS | ${avg(l10, 'fg_made')} SOG
L20: ${avg(l20, 'points')}G / ${avg(l20, 'assists')}A / ${avgPtsG(l20)} PTS | ${avg(l20, 'fg_made')} SOG
+/-: L10 ${avg(l10, 'plus_minus')} | L20 ${avg(l20, 'plus_minus')}
TOI: ${avg(l10, 'minutes')} min/g | PIM: ${avg(l10, 'turnovers')}/g

POWER PLAY vs EVEN STRENGTH (${ppLabel}):
Total G/g: ${totalGAvg} | PP G/g: ${ppgAvg} | EV G/g: ${evGAvg}
${parseFloat(ppgAvg) > 0 ? `PP production present — ${ppgAvg} PP goals/g of ${totalGAvg} total` : 'Scoring is primarily at even strength.'}

HOME vs AWAY (${splitLabel}):
Home (${homeGames.length}g): ${avg(homeGames, 'points')}G / ${avg(homeGames, 'assists')}A / ${avgPtsG(homeGames)} PTS
Away (${awayGames.length}g): ${avg(awayGames, 'points')}G / ${avg(awayGames, 'assists')}A / ${avgPtsG(awayGames)} PTS

LAST 10 GAMES:
${logLines.join('\n')}

${tonightBlock}

${propLines ? `TONIGHT'S PROP LINES:\n${propLines}` : 'No prop lines available for tonight.'}

${projBlock}`.trim();
}

function buildNHLGoalieOutput(fullName, abbr, logs, apiLog, hasDB, tonightBlock, propLines, projBlock = '', seasonHome = [], seasonAway = [], splitLabel = 'last 20 starts') {
  // DB: steals=saves, blocks=GA, fg_att=shots_faced, fg_pct=SV%, off_reb=GSAA, plus_minus=1(W)/-1(L)
  const l5  = logs.slice(0, 5);
  const l10 = logs.slice(0, 10);
  const l20 = logs;

  // Filter to actual starts (minutes > 30 eliminates relief appearances)
  const starterFilter = (rows) => rows.filter(g => parseFloat(g.minutes ?? 0) > 30);
  const homeBase  = seasonHome.length > 0 ? seasonHome : l20.filter(g => g.home_away === 'home');
  const awayBase  = seasonAway.length > 0 ? seasonAway : l20.filter(g => g.home_away === 'away');
  const homeGames = starterFilter(homeBase);
  const awayGames = starterFilter(awayBase);

  const wins   = (rows) => rows.filter(g => parseFloat(g.plus_minus) === 1).length;
  const losses = (rows) => rows.filter(g => parseFloat(g.plus_minus) < 0).length;

  const logLines = l10.map(g => {
    // Safe column reads — DB may store nulls if save% wasn't collected for this player
    const svPct      = g.fg_pct    != null ? parseFloat(g.fg_pct).toFixed(3)    : 'N/A';
    const savesVal   = g.steals    ?? g.saves          ?? '?';
    const gaVal      = g.blocks    ?? g.goals_against  ?? '?';
    const result     = parseFloat(g.plus_minus) === 1 ? 'W' : parseFloat(g.plus_minus) < 0 ? 'L' : 'OT';
    return `  ${fmtDate(g.game_date)} ${g.home_away === 'home' ? 'vs' : '@'} ${g.opponent}: ${savesVal}sv ${gaVal}GA SV% ${svPct} ${result}`;
  });

  const svPctTrend = parseFloat(avgPct(l5.filter(g => g.fg_pct != null), 'fg_pct', 3)) > parseFloat(avgPct(l10.filter(g => g.fg_pct != null), 'fg_pct', 3))
    ? '↑ getting hotter' : '↓ trending down';

  // Rich home/away split with TOI and saves per game
  const homeSvPct  = avgPct(homeGames.filter(g => g.fg_pct != null), 'fg_pct', 3);
  const awaySvPct  = avgPct(awayGames.filter(g => g.fg_pct != null), 'fg_pct', 3);
  const homeLabel  = homeGames.length > 0 ? `${homeGames.length} starts` : `${homeBase.length} games (no filter)`;
  const awayLabel  = awayGames.length > 0 ? `${awayGames.length} starts` : `${awayBase.length} games (no filter)`;

  return `NHL GOALIE DATA: ${fullName} (${abbr})
Games in database: ${l20.length}

SEASON STATS (${splitLabel}):
SV%:      L5 ${avgPct(l5.filter(g => g.fg_pct != null), 'fg_pct', 3)} | L10 ${avgPct(l10.filter(g => g.fg_pct != null), 'fg_pct', 3)} | L20 ${avgPct(l20.filter(g => g.fg_pct != null), 'fg_pct', 3)}
Trend:    ${svPctTrend}
GAA:      L5 ${avg(l5, 'blocks')} | L10 ${avg(l10, 'blocks')} | L20 ${avg(l20, 'blocks')}
GSAA:     L10 ${avg(l10.filter(g => g.off_reb != null), 'off_reb')}
Saves/g:  L10 ${avg(l10, 'steals')}
Record:   L10: ${wins(l10)}W-${losses(l10)}L-${l10.length - wins(l10) - losses(l10)}OT | L20: ${wins(l20)}W-${losses(l20)}L-${l20.length - wins(l20) - losses(l20)}OT

HOME vs AWAY — ${splitLabel} (starts only, TOI > 30 min):
Home (${homeLabel}):
  SV%: ${homeSvPct} | Saves: ${avg(homeGames, 'steals')}/game
  GAA: ${avg(homeGames, 'blocks')} | TOI: ${avg(homeGames, 'minutes')} min
  Record: ${wins(homeGames)}W-${losses(homeGames)}L-${homeGames.length - wins(homeGames) - losses(homeGames)}OT
Away (${awayLabel}):
  SV%: ${awaySvPct} | Saves: ${avg(awayGames, 'steals')}/game
  GAA: ${avg(awayGames, 'blocks')} | TOI: ${avg(awayGames, 'minutes')} min
  Record: ${wins(awayGames)}W-${losses(awayGames)}L-${awayGames.length - wins(awayGames) - losses(awayGames)}OT

LAST 10 STARTS:
${logLines.join('\n')}

${tonightBlock}

${propLines ? `TONIGHT'S PROP LINES:\n${propLines}` : ''}

${projBlock}`.trim();
}

// ── MLB helpers ───────────────────────────────────────────────────────────────

async function getSPStats(pitcher) {
  // pitcher = probablePitcher object from schedule: { id, fullName }
  if (!pitcher?.id) return null;
  const season = new Date().getFullYear();
  const statSeason = season > 2025 ? 2025 : season;

  const [personRes, statsRes] = await Promise.all([
    fetch(`https://statsapi.mlb.com/api/v1/people/${pitcher.id}`, { signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`https://statsapi.mlb.com/api/v1/people/${pitcher.id}/stats?stats=season&season=${statSeason}&group=pitching`, { signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  const hand  = personRes?.people?.[0]?.pitchHand?.code || '?';
  const stats = statsRes?.stats?.[0]?.splits?.[0]?.stat || {};

  // Last 5 starts from DB
  const dbStarts = await db.query(`
    SELECT game_date, opponent,
           minutes       AS ip,
           blocks        AS er,
           ft_att        AS k,
           ft_made       AS bb,
           points        AS h
    FROM player_game_logs
    WHERE sport = 'MLB' AND player_name ILIKE $1
    ORDER BY game_date DESC
    LIMIT 5
  `, [`%${lastName(pitcher.fullName || '')}%`]).catch(() => ({ rows: [] }));

  const recentLines = dbStarts.rows.map(g =>
    `${fmtDate(g.game_date)} vs ${g.opponent || '?'}: ${parseFloat(g.ip||0).toFixed(1)}IP ${g.er||0}ER ${g.k||0}K`
  );

  return {
    name:   pitcher.fullName,
    hand,
    era:    stats.era    || 'N/A',
    whip:   stats.whip   || 'N/A',
    k9:     stats.strikeoutsPer9Inn || 'N/A',
    bb9:    stats.walksPer9Inn      || 'N/A',
    wins:   stats.wins   || 0,
    losses: stats.losses || 0,
    ip:     stats.inningsPitched || 'N/A',
    recent: recentLines,
  };
}

function formatSPBlock(sp, label) {
  if (!sp) return `${label}: TBD`;
  const record = `${sp.wins}-${sp.losses}`;
  const recent = sp.recent.length
    ? sp.recent.join(' | ')
    : 'No recent starts in DB';
  return `${label}: ${sp.name} (${sp.hand}HP) — ${record} | ERA ${sp.era} | WHIP ${sp.whip} | K/9 ${sp.k9} | BB/9 ${sp.bb9}
  Last 5: ${recent}`;
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
  const playerId = found.id;

  // 2. MLB Stats API season stats + game log + platoon splits + DB logs + projections (parallel)
  const [seasonStats, gameLog, splitsData, dbLogs, projResult] = await Promise.all([
    mlbStats.getPlayerSeasonStats(playerId, season, group).catch(() => []),
    mlbStats.getPlayerGameLog(playerId, season, group).catch(() => []),
    // Platoon splits: vs LHP and vs RHP
    fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=statSplits&season=${season > 2025 ? 2025 : season}&group=${group}&splits=vl,vr`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null),
    db.query(`
      SELECT game_date, opponent, home_away,
             points as hits, fg_att as ab, fg_pct as avg,
             off_reb as hr, turnovers as rbi, steals as sb,
             three_made as doubles, rebounds as runs,
             ft_att as strikeouts, ft_made as walks
      FROM player_game_logs
      WHERE sport = 'MLB' AND player_name ILIKE $1
      AND game_date >= '2026-03-01'
      ORDER BY game_date DESC
    `, [`%${lastName(pName)}%`]),
    db.query(`
      SELECT prop_type, proj_value, confidence_score,
             (factors_json->>'market_line')::numeric as market_line,
             (factors_json->>'edge')::numeric as edge
      FROM chalk_projections
      WHERE player_name ILIKE $1 AND game_date = CURRENT_DATE AND sport = 'MLB'
      AND prop_type IS NOT NULL AND proj_value IS NOT NULL
      ORDER BY confidence_score DESC NULLS LAST
    `, [`%${lastName(pName)}%`]),
  ]);

  const stats  = seasonStats?.[0]?.stat || {};
  const recent = gameLog.slice(0, 10);
  let   dbRows = dbLogs.rows;
  let   dbSeasonLabel = `${season} season`;

  // Fall back to 2025 DB logs when 2026 season hasn't accumulated data yet
  if (dbRows.length === 0) {
    const prevYear = season - 1;
    const fallback = await db.query(`
      SELECT game_date, opponent, home_away,
             points as hits, fg_att as ab, fg_pct as avg,
             off_reb as hr, turnovers as rbi, steals as sb,
             three_made as doubles, rebounds as runs,
             ft_att as strikeouts, ft_made as walks
      FROM player_game_logs
      WHERE sport = 'MLB' AND player_name ILIKE $1
      AND game_date >= '${prevYear}-03-01' AND game_date <= '${prevYear}-09-30'
      ORDER BY game_date DESC
    `, [`%${lastName(pName)}%`]).catch(() => ({ rows: [] }));
    dbRows = fallback.rows;
    if (dbRows.length > 0) dbSeasonLabel = `${prevYear} season (last season)`;
  }

  // Home/away splits from DB logs
  const dbHomeRows = dbRows.filter(g => g.home_away === 'home');
  const dbAwayRows = dbRows.filter(g => g.home_away === 'away');

  // Parse platoon splits
  let platoonBlock = '';
  if (!isPitch && splitsData?.stats?.[0]?.splits?.length) {
    const splits = splitsData.stats[0].splits;
    const vsL = splits.find(s => s.split?.code === 'vl')?.stat;
    const vsR = splits.find(s => s.split?.code === 'vr')?.stat;
    if (vsL || vsR) {
      platoonBlock = `PLATOON SPLITS (${season > 2025 ? '2025' : season} season):
vs LHP: AVG ${vsL?.avg || 'N/A'} | OBP ${vsL?.obp || 'N/A'} | SLG ${vsL?.slg || 'N/A'} | HR ${vsL?.homeRuns || 0}
vs RHP: AVG ${vsR?.avg || 'N/A'} | OBP ${vsR?.obp || 'N/A'} | SLG ${vsR?.slg || 'N/A'} | HR ${vsR?.homeRuns || 0}`;
    }
  }

  // 3. Tonight's MLB schedule + weather — use ET date
  const today    = getTodayET();
  const mlbDate  = toMLBDate(today);
  const schedule = await mlbStats.getSchedule(mlbDate).catch(() => []);
  const tonightGame = schedule?.find(g =>
    g.teams?.home?.team?.abbreviation === teamAbbr ||
    g.teams?.away?.team?.abbreviation === teamAbbr
  );

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

  // Umpire + bullpen queries (parallel)
  const homeAbbr2 = tonightGame?.teams?.home?.team?.abbreviation || null;
  const awayAbbr2 = tonightGame?.teams?.away?.team?.abbreviation || null;
  const bullpenTeam = teamAbbr || null;
  const homeTmId = tonightGame?.teams?.home?.team?.id || null;
  const awayTmId = tonightGame?.teams?.away?.team?.id || null;
  const gamePk   = tonightGame?.gamePk || null;

  const [umpireResult, bullpenResult] = await Promise.all([
    // Query game_umpires joined with umpire_tendencies for tonight's HP umpire
    (gamePk || homeTmId)
      ? db.query(`
          SELECT ut.umpire_name, ut.avg_k_per_game, ut.avg_bb_per_game,
                 ut.avg_runs_per_game, ut.over_pct, ut.zone_rating, ut.games_sampled
          FROM game_umpires gu
          JOIN umpire_tendencies ut ON gu.hp_umpire_id = ut.umpire_id
          WHERE gu.game_date = $1
          AND (${gamePk ? 'gu.game_pk = $2' : '(gu.home_team_id = $2 OR gu.away_team_id = $3)'})
          LIMIT 1
        `, gamePk
            ? [today, gamePk]
            : [today, homeTmId, awayTmId]
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    bullpenTeam
      ? db.query(`
          SELECT pitcher_name, is_closer, games_last_3, pitches_last_3, innings_last_3, days_since_last_app
          FROM bullpen_usage
          WHERE team_abbr = $1
          AND collected_date >= CURRENT_DATE - 3
          ORDER BY pitches_last_3 DESC NULLS LAST
          LIMIT 6
        `, [bullpenTeam]).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
  ]);

  let umpireBlock = '';
  if (umpireResult.rows[0]) {
    const u = umpireResult.rows[0];
    const parts = [`HP Umpire: ${u.umpire_name}`];
    if (u.games_sampled > 0) {
      if (u.avg_k_per_game != null)    parts.push(`K/g: ${parseFloat(u.avg_k_per_game).toFixed(1)}`);
      if (u.avg_bb_per_game != null)   parts.push(`BB/g: ${parseFloat(u.avg_bb_per_game).toFixed(1)}`);
      if (u.avg_runs_per_game != null) parts.push(`Runs/g: ${parseFloat(u.avg_runs_per_game).toFixed(1)}`);
      if (u.over_pct != null)          parts.push(`Over%: ${parseFloat(u.over_pct).toFixed(1)}%`);
      if (u.zone_rating != null)       parts.push(`Zone: ${u.zone_rating}`);
    } else {
      parts.push('historical stats not yet available for 2026 season');
    }
    umpireBlock = parts.join(' | ');
  }

  let bullpenBlock = '';
  if (bullpenResult.rows.length > 0) {
    const lines = bullpenResult.rows.map(r => {
      const role = r.is_closer ? ' [CL]' : '';
      const days = r.days_since_last_app != null ? ` (${r.days_since_last_app}d rest)` : '';
      const pitches = r.pitches_last_3 ? ` ${r.pitches_last_3}P` : '';
      return `  ${r.pitcher_name}${role}: ${r.games_last_3 || 0}G/${r.innings_last_3 || '0.0'}IP last 3d${pitches}${days}`;
    });
    bullpenBlock = `${teamAbbr} BULLPEN (last 3 days):\n${lines.join('\n')}`;
  }

  // 4. Odds + prop lines
  let oddsEventId = null;
  if (tonightGame) {
    const events  = await oddsService.fetchEvents('MLB').catch(() => []);
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

  // 5. Tonight's starting pitchers (both sides — fetched in parallel)
  const isHomeTeam = tonightGame?.teams?.home?.team?.abbreviation === teamAbbr;
  const rawHomeSP  = tonightGame?.teams?.home?.probablePitcher || null;
  const rawAwaySP  = tonightGame?.teams?.away?.probablePitcher || null;

  const [homeSPStats, awaySPStats] = tonightGame
    ? await Promise.all([getSPStats(rawHomeSP), getSPStats(rawAwaySP)])
    : [null, null];

  const opposingSP = isHomeTeam ? awaySPStats : homeSPStats;
  const teamSP     = isHomeTeam ? homeSPStats : awaySPStats;

  // Pitch arsenal from DB (for pitchers)
  let arsenalBlock = '';
  if (isPitch) {
    const arsenalRows = await db.query(`
      SELECT pitch_type, pitch_name, avg_velocity, usage_pct, whiff_rate, ba_against
      FROM pitcher_arsenal
      WHERE pitcher_id = $1
      AND season = (SELECT MAX(season) FROM pitcher_arsenal WHERE pitcher_id = $1)
      ORDER BY usage_pct DESC NULLS LAST
    `, [playerId]).catch(() => ({ rows: [] }));

    if (arsenalRows.rows.length > 0) {
      const lines = arsenalRows.rows.map(r => {
        const vel   = r.avg_velocity ? `${parseFloat(r.avg_velocity).toFixed(1)}mph` : '?mph';
        const usage = r.usage_pct    ? `${parseFloat(r.usage_pct).toFixed(1)}%`      : '?%';
        const whiff = r.whiff_rate   ? `${(parseFloat(r.whiff_rate) * 100).toFixed(1)}% whiff` : '';
        const ba    = r.ba_against   ? `.${String(Math.round(parseFloat(r.ba_against) * 1000)).padStart(3, '0')} BA against` : '';
        return `  ${r.pitch_name || r.pitch_type}: ${vel} | ${usage} usage${whiff ? ' | ' + whiff : ''}${ba ? ' | ' + ba : ''}`;
      });
      arsenalBlock = `PITCH ARSENAL:\n${lines.join('\n')}`;
    }
  }

  // Career vs tonight's SP (for batters only)
  let careerVsSpBlock = '';
  if (tonightGame && !isPitch) {
    const spPitcher = isHomeTeam
      ? tonightGame.teams?.away?.probablePitcher
      : tonightGame.teams?.home?.probablePitcher;

    if (spPitcher?.id) {
      const careerRow = await db.query(`
        SELECT ab, hits, hr, bb, k, avg, ops
        FROM pitcher_batter_matchups
        WHERE pitcher_id = $1 AND batter_id = $2
        LIMIT 1
      `, [spPitcher.id, playerId]).catch(() => ({ rows: [] }));

      if (careerRow.rows[0]?.ab > 0) {
        const m = careerRow.rows[0];
        const avgStr = `.${String(Math.round(parseFloat(m.avg || 0) * 1000)).padStart(3, '0')}`;
        const sampleNote = m.ab < 10 ? ' (small sample)' : m.ab >= 20 ? ' (strong sample)' : '';
        careerVsSpBlock = `CAREER vs ${spPitcher.fullName}: ${m.hits}-${m.ab} (${avgStr}), ${m.hr} HR, ${m.bb} BB, ${m.k} K, OPS ${parseFloat(m.ops || 0).toFixed(3)}${sampleNote}`;
      } else if (spPitcher.fullName) {
        careerVsSpBlock = `CAREER vs ${spPitcher.fullName}: No career matchup data (first meeting or insufficient AB)`;
      }
    }
  }

  let spBlock = '';
  if (tonightGame) {
    const homeAbbr = tonightGame.teams?.home?.team?.abbreviation || 'HOME';
    const awayAbbr = tonightGame.teams?.away?.team?.abbreviation || 'AWAY';
    spBlock = `STARTING PITCHERS TONIGHT:
${formatSPBlock(homeSPStats, homeAbbr)}
${formatSPBlock(awaySPStats, awayAbbr)}`;

    // Platoon matchup note for batters
    if (!isPitch && opposingSP && opposingSP.hand !== '?') {
      const matchupSide = bats === opposingSP.hand ? '⚠ SAME-SIDE MATCHUP' : '✓ OPPOSITE-SIDE MATCHUP';
      const splitRef    = bats === 'L' ? 'vs LHP' : 'vs RHP';
      spBlock += `\n\nMATCHUP: ${pName} (Bats ${bats}) vs ${opposingSP.name} (${opposingSP.hand}HP) — ${matchupSide}`;
      if (platoonBlock) spBlock += ` — see ${splitRef} split above`;
    }
  }

  // Chalk projections block (MLB)
  const mlbProjRows = projResult.rows;
  let mlbProjBlock = '';
  if (mlbProjRows.length > 0) {
    const MLB_PROJ_LABELS = {
      hits: 'Hits', home_runs: 'Home Runs', rbis: 'RBIs',
      strikeouts: 'Strikeouts', total_bases: 'Total Bases', runs_scored: 'Runs',
      earned_runs: 'Earned Runs', hits_allowed: 'Hits Allowed',
    };
    const lines = mlbProjRows.map(r => {
      const label = MLB_PROJ_LABELS[r.prop_type] || r.prop_type;
      const proj  = parseFloat(r.proj_value).toFixed(2);
      const ml    = r.market_line != null ? ` | Line: ${parseFloat(r.market_line).toFixed(1)}` : '';
      const edge  = r.edge != null ? ` | Edge: ${r.edge > 0 ? '+' : ''}${parseFloat(r.edge).toFixed(2)}` : '';
      const conf  = r.confidence_score ? ` | Conf: ${r.confidence_score}%` : '';
      return `  ${label}: proj ${proj}${ml}${edge}${conf}`;
    });
    mlbProjBlock = `CHALK PROPRIETARY MODEL — Tonight's Projections:\n${lines.join('\n')}`;
  }

  // Build output
  if (isPitch) {
    const recentLog = recent.map(g => {
      const s = g.stat || {};
      return `  ${(g.date || '').slice(0, 10)} vs ${g.opponent?.name || '?'}: ${s.inningsPitched || '?'}IP ${s.earnedRuns ?? '?'}ER ${s.strikeOuts || 0}K ${s.baseOnBalls || 0}BB`;
    }).join('\n');

    const gameTimeET = tonightGame
      ? new Date(tonightGame.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
      : '';

    const tonightBlock = tonightGame
      ? [`TONIGHT: ${tonightGame.teams?.away?.team?.name} @ ${tonightGame.teams?.home?.team?.name} — ${gameTimeET}`, weatherBlock, umpireBlock, spBlock].filter(Boolean).join('\n')
      : 'NOT SCHEDULED TONIGHT';

    // Pitcher home/away ERA-proxy from DB (blocks = ER, minutes = IP)
    let pitcherHomeAwayBlock = '';
    if (dbRows.length >= 3) {
      const pHomeRows = dbHomeRows;
      const pAwayRows = dbAwayRows;
      const avgER = (rows) => rows.length ? (rows.reduce((s, r) => s + (parseFloat(r.hr) || 0), 0) / rows.length).toFixed(2) : 'N/A';
      const avgK  = (rows) => rows.length ? (rows.reduce((s, r) => s + (parseFloat(r.strikeouts) || 0), 0) / rows.length).toFixed(1) : 'N/A';
      if (pHomeRows.length > 0 || pAwayRows.length > 0) {
        pitcherHomeAwayBlock = `HOME vs AWAY (${dbSeasonLabel}):
Home (${pHomeRows.length}g): avg ${avgER(pHomeRows)} ER/start | ${avgK(pHomeRows)} K/start
Away (${pAwayRows.length}g): avg ${avgER(pAwayRows)} ER/start | ${avgK(pAwayRows)} K/start`;
      }
    }

    return `MLB PITCHER DATA: ${pName} (${teamAbbr}, ${pos}) — Throws: ${throws}
${season} Season Stats:
ERA: ${stats.era || 'N/A'} | WHIP: ${stats.whip || 'N/A'} | W-L: ${stats.wins || 0}-${stats.losses || 0}
K: ${stats.strikeOuts || 0} | BB: ${stats.baseOnBalls || 0} | K/9: ${stats.strikeoutsPer9Inn || 'N/A'} | BB/9: ${stats.walksPer9Inn || 'N/A'}
IP: ${stats.inningsPitched || 'N/A'} | HR/9: ${stats.homeRunsPer9 || 'N/A'}

RECENT STARTS:
${recentLog || 'No recent starts on record.'}

${pitcherHomeAwayBlock}

${arsenalBlock}

${bullpenBlock}

${tonightBlock}

${mlbProjBlock}

${propLines ? `PROP LINES TONIGHT:\n${propLines}` : ''}`.trim();
  }

  // Hitter output
  const recentLog = recent.map(g => {
    const s = g.stat || {};
    return `  ${(g.date || '').slice(0, 10)} vs ${g.opponent?.name || '?'}: ${s.atBats || 0}AB ${s.hits || 0}H ${s.homeRuns || 0}HR ${s.rbi || 0}RBI ${s.baseOnBalls || 0}BB ${s.strikeOuts || 0}K`;
  }).join('\n');

  const dbL10    = dbRows.slice(0, 10);
  const dbL5     = dbRows.slice(0, 5);

  // Home/Away splits for hitters from DB logs
  let hitterHomeAwayBlock = '';
  if (dbRows.length >= 5) {
    const hAvg = (rows, col) => rows.length ? (rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0) / rows.length).toFixed(2) : 'N/A';
    hitterHomeAwayBlock = `HOME vs AWAY (${dbSeasonLabel}):
Home (${dbHomeRows.length}g): ${hAvg(dbHomeRows, 'hits')}H/g | ${hAvg(dbHomeRows, 'hr')}HR/g | ${hAvg(dbHomeRows, 'rbi')}RBI/g
Away (${dbAwayRows.length}g): ${hAvg(dbAwayRows, 'hits')}H/g | ${hAvg(dbAwayRows, 'hr')}HR/g | ${hAvg(dbAwayRows, 'rbi')}RBI/g`;
  }

  const dbBlock  = dbRows.length > 0 ? `
GAME LOG HISTORY (${dbRows.length} games, ${dbSeasonLabel}):
L5 avg: ${avg(dbL5, 'hits')}H / ${avg(dbL5, 'hr')}HR / ${avg(dbL5, 'rbi')}RBI per game
L10 avg: ${avg(dbL10, 'hits')}H / ${avg(dbL10, 'hr')}HR / ${avg(dbL10, 'rbi')}RBI per game
Last 5: ${dbL5.map(g => `${fmtDate(g.game_date)}: ${g.hits}H ${g.hr}HR`).join(', ')}` : '';

  const gameTimeET = tonightGame
    ? new Date(tonightGame.gameDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
    : '';

  const tonightBlock = tonightGame
    ? [`TONIGHT: ${tonightGame.teams?.away?.team?.name} @ ${tonightGame.teams?.home?.team?.name} — ${gameTimeET}`, weatherBlock, umpireBlock, spBlock].filter(Boolean).join('\n')
    : 'NOT SCHEDULED TONIGHT';

  return `MLB BATTER DATA: ${pName} (${teamAbbr}, ${pos}) — Bats: ${bats}
${season} Season Stats:
AVG: ${stats.avg || 'N/A'} | OBP: ${stats.obp || 'N/A'} | SLG: ${stats.slg || 'N/A'} | OPS: ${stats.ops || 'N/A'}
HR: ${stats.homeRuns || 0} | RBI: ${stats.rbi || 0} | H: ${stats.hits || 0} | R: ${stats.runs || 0} | SB: ${stats.stolenBases || 0}
K: ${stats.strikeOuts || 0} | BB: ${stats.baseOnBalls || 0} | GP: ${stats.gamesPlayed || 0}

RECENT GAMES (${season} season):
${recentLog || 'No recent games on record yet.'}
${dbBlock}

${hitterHomeAwayBlock}

${platoonBlock}

${careerVsSpBlock}

${tonightBlock}

${mlbProjBlock}

${propLines ? `PROP LINES TONIGHT:\n${propLines}` : ''}`.trim();
}

// ── Comparative ───────────────────────────────────────────────────────────────

async function getComparativeStats(sport, statCategory, scope) {
  const n     = scope === 'last_5' ? 5 : scope === 'last_10' ? 10 : 20;
  const today = getTodayET();

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

  const STAT_MAP = {
    'points':     { col: 'points',   label: 'PTS',    sport: 'NBA' },
    'rebounds':   { col: 'rebounds', label: 'REB',    sport: 'NBA' },
    'assists':    { col: 'assists',  label: 'AST',    sport: 'NBA' },
    'steals':     { col: 'steals',   label: 'STL',    sport: 'NBA' },
    'blocks':     { col: 'blocks',   label: 'BLK',    sport: 'NBA' },
    '3pm':        { col: 'three_made',label: '3PM',   sport: 'NBA' },
    'fg_pct':     { col: 'fg_pct',   label: 'FG%',   sport: 'NBA' },
    'goals':      { col: 'points',   label: 'G',      sport: 'NHL' },
    'nhl_assists':{ col: 'assists',  label: 'A',      sport: 'NHL' },
    'sog':        { col: 'fg_made',  label: 'SOG',    sport: 'NHL' },
    'sv_pct':     { col: 'fg_pct',   label: 'SV%',   sport: 'NHL', posFilter: 'G' },
    'gaa':        { col: 'blocks',   label: 'GAA',    sport: 'NHL', posFilter: 'G' },
    'saves':      { col: 'steals',   label: 'Saves',  sport: 'NHL', posFilter: 'G' },
    'hits':       { col: 'points',   label: 'H',      sport: 'MLB' },
    'era':        { col: 'fg_pct',   label: 'ERA',    sport: 'MLB' },
    'strikeouts': { col: 'ft_att',   label: 'K',      sport: 'MLB' },
  };

  const statInfo      = STAT_MAP[statCategory] || { col: statCategory, label: statCategory, sport };
  const isLowerBetter = ['era', 'gaa'].includes(statCategory);
  const posFilter     = statInfo.posFilter ? `AND position = '${statInfo.posFilter}'` : '';

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
    ORDER BY ${isLowerBetter ? `AVG(${statInfo.col}::numeric) ASC` : `AVG(${statInfo.col}::numeric) DESC`}
    LIMIT 15
  `, [sport, tonightTeams]);

  const rows = result.rows;
  if (!rows.length) return `No comparative data found for ${sport} ${statCategory} tonight.`;

  // Map stat_category → chalk_projections prop_type for filtering
  const STAT_TO_PROP = {
    'points': 'points', 'rebounds': 'rebounds', 'assists': 'assists',
    '3pm': 'threes', 'goals': 'goals', 'nhl_assists': 'assists',
    'sog': 'shots_on_goal', 'saves': 'saves', 'hits': 'hits',
    'strikeouts': 'strikeouts',
  };
  const propTypeFilter = STAT_TO_PROP[statCategory] || statCategory;

  // Fetch chalk projections filtered by the matching prop_type so edge/line are relevant
  const playerNames = rows.map(r => r.player_name);
  let projMap = {};
  if (playerNames.length > 0) {
    const projRows = await db.query(`
      SELECT DISTINCT ON (player_name) player_name, prop_type, proj_value,
             (factors_json->>'market_line')::numeric as market_line,
             (factors_json->>'edge')::numeric as edge,
             confidence_score
      FROM chalk_projections
      WHERE sport = $1 AND game_date = CURRENT_DATE
      AND prop_type = $2 AND proj_value IS NOT NULL
      ORDER BY player_name, confidence_score DESC NULLS LAST
    `, [sport, propTypeFilter]).catch(() => ({ rows: [] }));

    for (const r of projRows.rows) {
      projMap[r.player_name.toLowerCase()] = r;
    }
  }

  const formatRow = (r, i) => {
    const recentStr = (r.recent_vals || []).slice(0, 5)
      .map(v => v != null ? parseFloat(v).toFixed(1) : '?')
      .join(', ');
    const proj = projMap[r.player_name.toLowerCase()];
    let projStr = '';
    if (proj?.proj_value != null) {
      const ml   = proj.market_line != null ? ` / Line ${parseFloat(proj.market_line).toFixed(1)}` : '';
      const edge = proj.edge != null ? ` / Edge ${proj.edge > 0 ? '+' : ''}${parseFloat(proj.edge).toFixed(2)}` : '';
      projStr = ` [Model: ${parseFloat(proj.proj_value).toFixed(1)}${ml}${edge}]`;
    }
    return `${i + 1}. ${r.player_name} (${r.team}): ${parseFloat(r.avg_val).toFixed(2)} ${statInfo.label}/g [${r.games}g] — L5: ${recentStr}${projStr}`;
  };

  return `COMPARATIVE: ${statInfo.label} — Tonight's ${sport} Slate (last ${n} games used)
Teams playing: ${tonightTeams.join(', ')}

${rows.map(formatRow).join('\n')}`.trim();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getNBAPlayerComplete,
  getNHLPlayerComplete,
  getMLBPlayerComplete,
  getComparativeStats,
};
