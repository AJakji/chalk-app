/**
 * Chalk Pick Grader
 * =================
 * Runs every morning at 8:00 AM.
 *
 * Grades yesterday's picks (player props + game picks) against actual results
 * pulled from nba_api via the Python NBA service.
 *
 * Updates:
 *   - player_props_history: actual_result, over_hit, was_correct
 *   - picks table: result = 'win' | 'loss' | 'push'
 *   - model_accuracy: daily accuracy stats for the projection model
 *
 * Why this matters: every graded pick improves future model tuning.
 * After 30 days of data we can see which factors over/under-perform and
 * adjust the multiplier weights in nbaProjectionModel.py.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const db  = require('../../db');
const bdl = require('../ballDontLie');
const mlb = require('../mlbStats');
const nhl = require('../nhlApi');

const MODEL_VERSION = 'v1.0';

// ── Data sources: BallDontLie (NBA), MLB Stats API, NHL API ───────────────────

/**
 * Get completed games for a date across all sports.
 * Returns normalised: [{ gameId, sport, homeTeam, awayTeam, homeScore, awayScore }]
 */
async function getYesterdaysGames(dateStr) {
  const results = [];

  // NBA — BallDontLie
  try {
    const nbaGames = await bdl.getGames(dateStr) || [];
    for (const g of nbaGames) {
      if (g.status !== 'Final') continue;
      results.push({
        gameId:    String(g.id),
        sport:     'NBA',
        homeTeam:  g.home_team?.abbreviation || '',
        awayTeam:  g.visitor_team?.abbreviation || '',
        homeScore: g.home_team_score || 0,
        awayScore: g.visitor_team_score || 0,
      });
    }
  } catch (e) { console.warn('  NBA games fetch failed:', e.message); }

  // MLB — MLB Stats API
  try {
    const mlbGames = await mlb.getSchedule(dateStr) || [];
    for (const g of mlbGames) {
      if (!g.status?.detailedState?.includes('Final')) continue;
      results.push({
        gameId:    String(g.gamePk),
        sport:     'MLB',
        homeTeam:  g.teams?.home?.team?.abbreviation || '',
        awayTeam:  g.teams?.away?.team?.abbreviation || '',
        homeScore: g.teams?.home?.score || 0,
        awayScore: g.teams?.away?.score || 0,
      });
    }
  } catch (e) { console.warn('  MLB games fetch failed:', e.message); }

  // NHL — NHL API
  try {
    const nhlGames = await nhl.getSchedule(dateStr) || [];
    for (const g of nhlGames) {
      if (g.gameState !== 'OFF' && g.gameState !== 'FINAL') continue;
      results.push({
        gameId:    String(g.id),
        sport:     'NHL',
        homeTeam:  g.homeTeam?.abbrev || '',
        awayTeam:  g.awayTeam?.abbrev || '',
        homeScore: g.homeTeam?.score || 0,
        awayScore: g.awayTeam?.score || 0,
      });
    }
  } catch (e) { console.warn('  NHL games fetch failed:', e.message); }

  return results;
}

/**
 * Get player box score rows for a completed game.
 * Returns normalised: [{ playerName, team, points, rebounds, assists, steals, blocks, threesMade }]
 */
async function getGameBoxScore(gameId, sport = 'NBA') {
  try {
    if (sport === 'NBA') {
      // BallDontLie live box scores — get date from gameId lookup isn't straightforward,
      // so we use /stats filtered by game_id instead
      const stats = await bdl.getStatsByGame(gameId) || [];
      return stats.map(r => ({
        playerName: `${r.player?.first_name || ''} ${r.player?.last_name || ''}`.trim(),
        team:       r.team?.abbreviation || '',
        points:     r.pts   || 0,
        rebounds:   r.reb   || 0,
        assists:    r.ast   || 0,
        steals:     r.stl   || 0,
        blocks:     r.blk   || 0,
        threesMade: r.fg3m  || 0,
        turnovers:  r.turnover || 0,
      }));
    }

    if (sport === 'MLB') {
      const box = await mlb.getBoxScore(gameId);
      const players = [];
      for (const side of ['home', 'away']) {
        const team = box?.teams?.[side];
        if (!team) continue;
        const abbr = team.team?.abbreviation || '';
        for (const [pid, p] of Object.entries(team.players || {})) {
          const s = p.stats?.batting || p.stats?.pitching || {};
          players.push({
            playerName: p.person?.fullName || '',
            team:       abbr,
            points:     s.runs     || 0,   // runs = "points" for MLB
            rebounds:   0,
            assists:    0,
            steals:     s.stolenBases || 0,
            blocks:     0,
            threesMade: s.homeRuns || 0,   // HR maps to "threes" for edge detection
            era:        s.era,
            strikeOuts: s.strikeOuts || 0,
          });
        }
      }
      return players;
    }

    if (sport === 'NHL') {
      const box = await nhl.getBoxScore(gameId);
      const players = [];
      for (const side of ['homeTeam', 'awayTeam']) {
        const team = box?.[side];
        if (!team) continue;
        const abbr = team.abbrev || '';
        for (const p of (team.forwards || []).concat(team.defense || []).concat(team.goalies || [])) {
          players.push({
            playerName: `${p.name?.default || ''}`.trim(),
            team:       abbr,
            points:     (p.goals || 0) + (p.assists || 0),
            rebounds:   0,
            assists:    p.assists || 0,
            steals:     p.hits   || 0,
            blocks:     p.blockedShots || 0,
            threesMade: p.goals  || 0,   // goals maps to "threes" for edge detection
          });
        }
      }
      return players;
    }
  } catch (e) {
    console.warn(`  Box score fetch failed (${sport} ${gameId}):`, e.message);
  }
  return [];
}

// ── Grade player props ─────────────────────────────────────────────────────────

const PROP_TYPE_TO_STAT_KEY = {
  points:   'pts',
  rebounds: 'reb',
  assists:  'ast',
  steals:   'stl',
  blocks:   'blk',
  threes:   'fg3m',
  // Combo props — computed from individual stats
  pra:      '_pra',
  pts_ast:  '_pts_ast',
  pts_reb:  '_pts_reb',
  ast_reb:  '_ast_reb',
};

function extractPlayerStat(playerRow, propType) {
  if (!playerRow) return null;

  // Normalised shape from getGameBoxScore stub (new source fills this in)
  const pts  = parseFloat(playerRow.points    || 0);
  const reb  = parseFloat(playerRow.rebounds  || 0);
  const ast  = parseFloat(playerRow.assists   || 0);
  const stl  = parseFloat(playerRow.steals    || 0);
  const blk  = parseFloat(playerRow.blocks    || 0);
  const fg3m = parseFloat(playerRow.threesMade || 0);

  switch (propType) {
    case 'points':   return pts;
    case 'rebounds': return reb;
    case 'assists':  return ast;
    case 'steals':   return stl;
    case 'blocks':   return blk;
    case 'threes':   return fg3m;
    case 'pra':      return pts + reb + ast;
    case 'pts_ast':  return pts + ast;
    case 'pts_reb':  return pts + reb;
    case 'ast_reb':  return ast + reb;
    default:         return null;
  }
}

/**
 * Match a player name (from our DB) to a box score player row.
 * Handles nba_api's name format: { firstName, familyName } or { PLAYER_NAME }.
 */
function findPlayerInBoxScore(playerName, boxScoreRows) {
  if (!playerName || !boxScoreRows?.length) return null;

  const target = playerName.toLowerCase().trim();
  const last   = target.split(' ').pop();

  return boxScoreRows.find(row => {
    const name = (row.playerName || '').toLowerCase();
    return name === target || name.includes(last);
  });
}

// ── Grade game picks (spread/total/moneyline) ─────────────────────────────────

async function gradeGamePicks(yesterday, games) {
  const { rows: gamePicks } = await db.query(
    `SELECT * FROM picks
     WHERE pick_date = $1 AND result IS NULL AND pick_category = 'game'`,
    [yesterday]
  );

  if (gamePicks.length === 0) return { total: 0, correct: 0 };

  let total = 0, correct = 0;

  for (const pick of gamePicks) {
    // Find the matching completed game (normalised shape from getYesterdaysGames)
    const game = games.find(g => {
      const ht = (g.homeTeam || '').toLowerCase();
      const at = (g.awayTeam || '').toLowerCase();
      const pHome = (pick.home_team || '').toLowerCase();
      const pAway = (pick.away_team || '').toLowerCase();
      return pHome.includes(ht) || ht.includes(pHome) ||
             pAway.includes(at) || at.includes(pAway);
    });

    if (!game) continue;

    const homeScore  = parseInt(game.homeScore || 0);
    const awayScore  = parseInt(game.awayScore || 0);
    if (!homeScore && !awayScore) continue;

    const actualTotal  = homeScore + awayScore;
    const actualSpread = homeScore - awayScore;

    let result = null;
    const pickVal = (pick.pick_value || '').toLowerCase();

    if (pick.pick_type === 'Total') {
      const lineMatch = pickVal.match(/(over|under)\s*([\d.]+)/i);
      if (lineMatch) {
        const dir  = lineMatch[1].toLowerCase();
        const line = parseFloat(lineMatch[2]);
        if (actualTotal === line) result = 'push';
        else if (dir === 'over')  result = actualTotal > line  ? 'win' : 'loss';
        else                      result = actualTotal < line  ? 'win' : 'loss';
      }
    } else if (pick.pick_type === 'Spread') {
      // Pick value like "Celtics -4.5"
      const lineMatch = pickVal.match(/([-+][\d.]+)/);
      if (lineMatch) {
        const spread   = parseFloat(lineMatch[1]);
        const homeTeam = (pick.home_team || '').toLowerCase();
        // Is this pick on the home team?
        const isHome = pickVal.includes(homeTeam.split(' ').pop());
        const coverSpread = isHome ? actualSpread + spread : -(actualSpread) + spread;
        if (coverSpread === 0) result = 'push';
        else result = coverSpread > 0 ? 'win' : 'loss';
      }
    } else if (pick.pick_type === 'Moneyline') {
      const homeWon   = homeScore > awayScore;
      const pickHome  = pickVal.includes((pick.home_team || '').split(' ').pop().toLowerCase());
      result = (homeWon === pickHome) ? 'win' : 'loss';
    }

    if (result) {
      await db.query(`UPDATE picks SET result = $1 WHERE id = $2`, [result, pick.id]);
      total++;
      if (result === 'win') correct++;
    }
  }

  return { total, correct };
}

// ── Main grader ────────────────────────────────────────────────────────────────

async function gradeYesterdaysPicks() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  console.log(`\n📊 Pick Grader — grading ${dateStr}`);

  // ── Step 1: Load yesterday's prop picks from DB ──────────────────────────────
  const { rows: propPicks } = await db.query(
    `SELECT * FROM player_props_history
     WHERE game_date = $1 AND actual_result IS NULL AND chalk_projection IS NOT NULL`,
    [dateStr]
  );
  console.log(`  Found ${propPicks.length} ungraded prop picks`);

  // ── Step 2: Get completed games from all three sources ───────────────────────
  const games = await getYesterdaysGames(dateStr);
  console.log(`  Found ${games.length} completed games`);

  let propTotal    = 0;
  let propCorrect  = 0;
  const propsErrors = [];
  const maeValues   = [];

  // ── Step 3: Grade each prop pick ────────────────────────────────────────────
  for (const pick of propPicks) {
    // Find the game for this player's team (normalised shape from getYesterdaysGames)
    const game = games.find(g => {
      const team = (pick.team || '').toLowerCase();
      const ht = (g.homeTeam || '').toLowerCase();
      const at = (g.awayTeam || '').toLowerCase();
      return ht.includes(team) || at.includes(team) || team.includes(ht) || team.includes(at);
    });

    if (!game) continue;

    const gameId = game.gameId;
    if (!gameId) continue;

    // Get box score for this game
    const boxScore = await getGameBoxScore(gameId);
    if (!boxScore.length) continue;

    // Find the player in box score
    const playerRow = findPlayerInBoxScore(pick.player_name, boxScore);
    if (!playerRow) continue;

    const actualResult = extractPlayerStat(playerRow, pick.prop_type);
    if (actualResult === null) continue;

    const line   = parseFloat(pick.prop_line);
    const proj   = parseFloat(pick.chalk_projection);
    const edge   = parseFloat(pick.chalk_edge);

    const overHit   = actualResult > line;
    const pushResult = Math.abs(actualResult - line) < 0.01;
    const wasCorrect = pushResult ? null : (edge > 0 ? overHit : !overHit);

    // Projection error
    const mae = Math.abs(actualResult - proj);
    maeValues.push(mae);

    await db.query(
      `UPDATE player_props_history
       SET actual_result = $1, over_hit = $2, was_correct = $3
       WHERE id = $4`,
      [actualResult, overHit, wasCorrect, pick.id]
    );

    propTotal++;
    if (wasCorrect === true) propCorrect++;
  }

  // ── Step 4: Grade game picks ─────────────────────────────────────────────────
  const { total: gameTotal, correct: gameCorrect } = await gradeGamePicks(dateStr, games);

  // ── Step 5: Calculate and store model accuracy ───────────────────────────────
  const totalPicks   = propTotal + gameTotal;
  const correctPicks = propCorrect + gameCorrect;
  const accuracyPct  = totalPicks > 0 ? correctPicks / totalPicks : null;
  const avgMAE       = maeValues.length > 0 ? maeValues.reduce((a, b) => a + b, 0) / maeValues.length : null;
  const propsAcc     = propTotal > 0 ? propCorrect / propTotal : null;
  const teamAcc      = gameTotal > 0 ? gameCorrect / gameTotal : null;

  if (totalPicks > 0) {
    await db.query(
      `INSERT INTO model_accuracy
         (date, sport, model_version, total_picks, correct_picks,
          accuracy_pct, avg_edge_mae, props_accuracy, team_accuracy)
       VALUES ($1,'NBA',$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (date, sport, model_version) DO UPDATE SET
         total_picks   = EXCLUDED.total_picks,
         correct_picks = EXCLUDED.correct_picks,
         accuracy_pct  = EXCLUDED.accuracy_pct,
         avg_edge_mae  = EXCLUDED.avg_edge_mae,
         props_accuracy = EXCLUDED.props_accuracy,
         team_accuracy  = EXCLUDED.team_accuracy`,
      [dateStr, MODEL_VERSION, totalPicks, correctPicks, accuracyPct, avgMAE, propsAcc, teamAcc]
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n  ── Pick Grader Summary ──────────────`);
  console.log(`  Props:  ${propCorrect}/${propTotal} correct (${propTotal > 0 ? ((propCorrect/propTotal)*100).toFixed(1) : 'N/A'}%)`);
  console.log(`  Games:  ${gameCorrect}/${gameTotal} correct (${gameTotal > 0 ? ((gameCorrect/gameTotal)*100).toFixed(1) : 'N/A'}%)`);
  console.log(`  Total:  ${correctPicks}/${totalPicks} (${accuracyPct ? (accuracyPct*100).toFixed(1) : 'N/A'}%)`);
  if (avgMAE) console.log(`  Avg projection error (MAE): ${avgMAE.toFixed(2)}`);
  console.log(`  ─────────────────────────────────────`);

  return { totalPicks, correctPicks, accuracyPct, avgMAE };
}

// ── Model accuracy endpoint (for Chalky's track record display) ───────────────

async function getModelAccuracy(days = 30) {
  const { rows } = await db.query(
    `SELECT * FROM model_accuracy
     WHERE sport = 'NBA' AND model_version = $1
       AND date >= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY date DESC`,
    [MODEL_VERSION]
  );

  if (!rows.length) return null;

  const totalPicks   = rows.reduce((s, r) => s + (r.total_picks || 0), 0);
  const correctPicks = rows.reduce((s, r) => s + (r.correct_picks || 0), 0);
  const avgMAE       = rows.filter(r => r.avg_edge_mae).reduce((s, r, _, a) => s + r.avg_edge_mae / a.length, 0);

  return {
    days,
    totalPicks,
    correctPicks,
    accuracy: totalPicks > 0 ? parseFloat((correctPicks / totalPicks).toFixed(4)) : null,
    avgProjectionError: avgMAE > 0 ? parseFloat(avgMAE.toFixed(3)) : null,
    dailyBreakdown: rows,
    modelVersion: MODEL_VERSION,
  };
}

module.exports = { gradeYesterdaysPicks, getModelAccuracy };
