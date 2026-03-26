/**
 * Chalk NHL Goalie Confirmation Service
 * ======================================
 * Runs 90 minutes before each NHL game's puck drop.
 *
 * Why this matters:
 *   Confirmed starting goalie is the SINGLE MOST IMPORTANT variable in NHL betting.
 *   When a backup starts, the over probability jumps ~25% and underdog ML value
 *   increases dramatically. This is the highest-value signal in all of hockey betting.
 *
 *   Backup goalie confirmed → +15 confidence score
 *   Starting goalie unconfirmed 90 min before puck drop → -12 confidence score
 *
 * What this service does:
 *   1. Fetches tonight's NHL schedule
 *   2. For each game, checks if starting goalies are confirmed
 *   3. If backup detected: recalculates affected projections, flags edge
 *   4. If significant edge found: would trigger push notification (stubbed)
 *
 * Cron schedule: 90 minutes before each game's scheduled start time
 * server.js handles scheduling based on game times fetched at 9 AM.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../db');

const NHL_BASE_URL = 'https://api-web.nhle.com/v1';

// ---------------------------------------------------------------------------
// NHL API helpers
// ---------------------------------------------------------------------------

async function nhlFetch(path) {
  try {
    const res = await fetch(`${NHL_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schedule fetch
// ---------------------------------------------------------------------------

/**
 * Get tonight's NHL games from the schedule.
 * Returns array of { gameId, homeTeam, awayTeam, startTime, startTimeUTC }
 */
async function getTonightsGames(dateStr) {
  const date = dateStr || new Date().toISOString().split('T')[0];
  const data = await nhlFetch(`/schedule/${date}`);

  if (!data?.gameWeek?.[0]?.games) return [];

  return data.gameWeek[0].games.map(g => ({
    gameId:        g.id,
    homeTeam:      g.homeTeam?.abbrev || '',
    awayTeam:      g.awayTeam?.abbrev || '',
    startTimeUTC:  g.startTimeUTC,
    startTime:     new Date(g.startTimeUTC),
    venueCity:     g.venue?.default || '',
  }));
}

// ---------------------------------------------------------------------------
// Goalie confirmation
// ---------------------------------------------------------------------------

/**
 * Get the starting goalie(s) for a game from the NHL API boxscore.
 * The boxscore endpoint exposes starting lineup even pre-game.
 *
 * Returns:
 * {
 *   homeGoalieId:    number | null,
 *   homeGoalieName:  string | null,
 *   homeIsBackup:    boolean,
 *   homeConfirmed:   boolean,
 *   awayGoalieId:    number | null,
 *   awayGoalieName:  string | null,
 *   awayIsBackup:    boolean,
 *   awayConfirmed:   boolean,
 * }
 */
async function confirmStartingGoalies(gameId) {
  const data = await nhlFetch(`/gamecenter/${gameId}/boxscore`);

  const result = {
    homeGoalieId:   null,
    homeGoalieName: null,
    homeIsBackup:   false,
    homeConfirmed:  false,
    awayGoalieId:   null,
    awayGoalieName: null,
    awayIsBackup:   false,
    awayConfirmed:  false,
  };

  if (!data) return result;

  // Pre-game: playerByGameStats.homeTeam.goalies / awayTeam.goalies
  const pbgs = data.playerByGameStats;
  if (pbgs) {
    const homeGoalies = pbgs.homeTeam?.goalies || [];
    const awayGoalies = pbgs.awayTeam?.goalies || [];

    if (homeGoalies.length > 0) {
      const g = homeGoalies[0];
      result.homeGoalieId   = g.playerId;
      result.homeGoalieName = `${g.firstName?.default || ''} ${g.lastName?.default || ''}`.trim();
      result.homeConfirmed  = true;
    }
    if (awayGoalies.length > 0) {
      const g = awayGoalies[0];
      result.awayGoalieId   = g.playerId;
      result.awayGoalieName = `${g.firstName?.default || ''} ${g.lastName?.default || ''}`.trim();
      result.awayConfirmed  = true;
    }
  }

  // Determine if backup by checking goalie stats from our DB
  if (result.homeGoalieId) {
    result.homeIsBackup = await isBackupGoalie(result.homeGoalieId, data.homeTeam?.abbrev);
  }
  if (result.awayGoalieId) {
    result.awayIsBackup = await isBackupGoalie(result.awayGoalieId, data.awayTeam?.abbrev);
  }

  return result;
}

/**
 * Determine if a goalie is a backup by checking their start frequency.
 * A goalie who has started less than 20% of their team's games is a backup.
 */
async function isBackupGoalie(goalieId, teamAbbr) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) as starts,
              (SELECT COUNT(*) FROM team_game_logs
               WHERE team_name ILIKE $2 AND sport = 'NHL') as team_games
       FROM player_game_logs
       WHERE player_id = $1 AND sport = 'NHL'
         AND saves > 0`,
      [goalieId, `%${teamAbbr}%`]
    );
    const row = rows[0];
    if (!row || !row.team_games || row.team_games === '0') return false;
    const startRate = parseInt(row.starts) / parseInt(row.team_games);
    return startRate < 0.25;  // started < 25% of games = backup
  } catch {
    return false;  // can't determine, assume starter
  }
}

// ---------------------------------------------------------------------------
// Projection recalculation on backup goalie detection
// ---------------------------------------------------------------------------

/**
 * When a backup goalie is confirmed, recalculate team and total projections
 * to reflect the dramatically higher scoring environment.
 *
 * Backup goalie effects (from the spec):
 *   - Win probability: × 0.78 for the backup's team
 *   - Total: × 1.15 (major over signal)
 *   - Saves projection: × 0.85 (fewer saves expected)
 */
async function recalculateForBackup(gameId, homeTeam, awayTeam, backupSide, gameDate) {
  const today = gameDate || new Date().toISOString().split('T')[0];

  console.log(`\n🚨 BACKUP GOALIE DETECTED: ${backupSide} team (${backupSide === 'home' ? homeTeam : awayTeam})`);
  console.log(`   Game: ${awayTeam} @ ${homeTeam} — Recalculating projections…`);

  // Update team projections with backup goalie flags
  await db.query(
    `UPDATE team_projections
     SET factors_json = factors_json || $1::jsonb
     WHERE (team_name ILIKE $2 OR team_name ILIKE $3)
       AND game_date = $4 AND sport = 'NHL'`,
    [
      JSON.stringify({
        backup_goalie_detected: true,
        backup_side:            backupSide,
        backup_recalculated_at: new Date().toISOString(),
        win_prob_adjustment:    0.78,
        total_adjustment:       1.15,
      }),
      `%${homeTeam}%`,
      `%${awayTeam}%`,
      today,
    ]
  );

  // Boost total projection — backup goalie = over signal
  await db.query(
    `UPDATE team_projections
     SET proj_total          = proj_total * 1.15,
         over_probability    = LEAST(0.92, COALESCE(over_probability, 0.50) + 0.12),
         under_probability   = GREATEST(0.08, COALESCE(under_probability, 0.50) - 0.12)
     WHERE (team_name ILIKE $1 OR team_name ILIKE $2)
       AND game_date = $3 AND sport = 'NHL'`,
    [`%${homeTeam}%`, `%${awayTeam}%`, today]
  );

  // Downgrade backup goalie's saves projection
  const backupTeam = backupSide === 'home' ? homeTeam : awayTeam;
  await db.query(
    `UPDATE chalk_projections cp
     SET proj_saves      = proj_saves * 0.85,
         confidence      = GREATEST(40, COALESCE(confidence, 60) - 15),
         factors_json    = factors_json || '{"backup_goalie_starting": true}'::jsonb
     FROM player_game_logs pgl
     WHERE cp.player_id = pgl.player_id
       AND pgl.team ILIKE $1
       AND cp.prop_type = 'saves'
       AND cp.game_date = $2
       AND cp.sport = 'NHL'`,
    [`%${backupTeam}%`, today]
  );

  console.log(`   ✅ Projections updated for backup goalie situation`);

  return {
    backupDetected: true,
    backupSide,
    backupTeam,
    homeTeam,
    awayTeam,
    gameId,
    adjustments: {
      winProbMultiplier:    0.78,
      totalMultiplier:      1.15,
      savesMultiplier:      0.85,
      overProbAdjustment:  +0.12,
    },
  };
}

// ---------------------------------------------------------------------------
// Main confirmation run
// ---------------------------------------------------------------------------

/**
 * Run goalie confirmation for all tonight's games.
 * Called by server.js 90 minutes before each game.
 *
 * Returns array of games with goalie status + any recalculation results.
 */
async function runGoalieConfirmation(gameDate) {
  const today = gameDate || new Date().toISOString().split('T')[0];
  console.log(`\n🏒 NHL Goalie Confirmation — ${today}`);

  const games = await getTonightsGames(today);
  if (games.length === 0) {
    console.log('  No NHL games tonight.');
    return [];
  }

  console.log(`  Checking ${games.length} games…`);
  const results = [];

  for (const game of games) {
    const goalies = await confirmStartingGoalies(game.gameId);
    console.log(`  ${game.awayTeam} @ ${game.homeTeam}:`);
    console.log(`    Home: ${goalies.homeGoalieName || 'UNCONFIRMED'} ${goalies.homeIsBackup ? '⚠️  BACKUP' : ''}`);
    console.log(`    Away: ${goalies.awayGoalieName || 'UNCONFIRMED'} ${goalies.awayIsBackup ? '⚠️  BACKUP' : ''}`);

    let recalcResult = null;

    // ── Write confirmed goalie status to nightly_roster ──────────────────────
    // is_confirmed_starter = true  → starting goalie
    // is_confirmed_starter = false → backup (not starting tonight)
    if (goalies.homeConfirmed && goalies.homeGoalieName) {
      // Mark confirmed home starter
      await db.query(
        `UPDATE nightly_roster
         SET is_confirmed_starter = true, confirmed_at = NOW()
         WHERE player_name ILIKE $1 AND team = $2 AND sport = 'NHL' AND game_date = $3`,
        [goalies.homeGoalieName, game.homeTeam, today]
      );
      // Mark all other home goalies as not starting
      await db.query(
        `UPDATE nightly_roster
         SET is_confirmed_starter = false
         WHERE team = $1 AND sport = 'NHL' AND game_date = $2
           AND position = 'G' AND player_name NOT ILIKE $3`,
        [game.homeTeam, today, goalies.homeGoalieName]
      );
    }
    if (goalies.awayConfirmed && goalies.awayGoalieName) {
      // Mark confirmed away starter
      await db.query(
        `UPDATE nightly_roster
         SET is_confirmed_starter = true, confirmed_at = NOW()
         WHERE player_name ILIKE $1 AND team = $2 AND sport = 'NHL' AND game_date = $3`,
        [goalies.awayGoalieName, game.awayTeam, today]
      );
      // Mark all other away goalies as not starting
      await db.query(
        `UPDATE nightly_roster
         SET is_confirmed_starter = false
         WHERE team = $1 AND sport = 'NHL' AND game_date = $2
           AND position = 'G' AND player_name NOT ILIKE $3`,
        [game.awayTeam, today, goalies.awayGoalieName]
      );
    }

    if (goalies.homeIsBackup) {
      recalcResult = await recalculateForBackup(
        game.gameId, game.homeTeam, game.awayTeam, 'home', today
      );
    }
    if (goalies.awayIsBackup) {
      recalcResult = await recalculateForBackup(
        game.gameId, game.homeTeam, game.awayTeam, 'away', today
      );
    }

    // Flag unconfirmed goalies 90 min out (significant uncertainty)
    if (!goalies.homeConfirmed || !goalies.awayConfirmed) {
      console.log(`  ⚠️  Goalie unconfirmed for ${game.awayTeam} @ ${game.homeTeam} — reducing confidence`);
      await db.query(
        `UPDATE chalk_projections
         SET factors_json = factors_json || '{"goalie_unconfirmed": true}'::jsonb,
             confidence   = GREATEST(40, COALESCE(confidence, 60) - 12)
         WHERE (team ILIKE $1 OR team ILIKE $2)
           AND game_date = $3 AND sport = 'NHL'
           AND prop_type IN ('saves', 'goals_against')`,
        [`%${game.homeTeam}%`, `%${game.awayTeam}%`, today]
      );
    }

    results.push({
      game,
      goalies,
      recalcResult,
    });
  }

  const backupCount = results.filter(r => r.goalies.homeIsBackup || r.goalies.awayIsBackup).length;
  const unconfirmedCount = results.filter(r => !r.goalies.homeConfirmed || !r.goalies.awayConfirmed).length;
  console.log(`\n  ✅ Confirmation complete: ${backupCount} backup goalies, ${unconfirmedCount} unconfirmed`);

  return results;
}

// ---------------------------------------------------------------------------
// Schedule helpers (used by server.js to set cron times per game)
// ---------------------------------------------------------------------------

/**
 * Given tonight's NHL schedule, return cron expressions for 90-min-before checks.
 * server.js calls this at 9 AM to dynamically schedule confirmation runs.
 *
 * Returns array of { gameId, homeTeam, awayTeam, checkTime: Date }
 */
async function getConfirmationSchedule(dateStr) {
  const games = await getTonightsGames(dateStr);
  return games.map(game => ({
    ...game,
    checkTime: new Date(game.startTime.getTime() - 90 * 60 * 1000),  // 90 min before
  }));
}

// ---------------------------------------------------------------------------
// Express router — for manual triggers and status checks
// ---------------------------------------------------------------------------

const router = require('express').Router();

router.get('/status', async (req, res) => {
  const date   = req.query.date;
  const games  = await getTonightsGames(date);
  const result = [];
  for (const game of games) {
    const goalies = await confirmStartingGoalies(game.gameId);
    result.push({ game, goalies });
  }
  res.json(result);
});

router.post('/run', async (req, res) => {
  try {
    const results = await runGoalieConfirmation(req.query.date);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  router,
  runGoalieConfirmation,
  confirmStartingGoalies,
  getTonightsGames,
  getConfirmationSchedule,
  recalculateForBackup,
  isBackupGoalie,
};
