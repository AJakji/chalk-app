require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const cron      = require('node-cron');
const { execFile } = require('child_process');
const path      = require('path');
const { clerkAuth }          = require('./middleware/auth');
const { generatePicks, generateModelPicks } = require('./services/aiPicks');
const { generatePropPicks }  = require('./services/propPicks');
const { detectEdges, detectEdgesForSport, detectTeamBetEdges, collectPropsLines, buildNightlyRoster, buildMLBRoster } = require('./services/projections/edgeDetector');
const { gradeYesterdaysPicks, getModelAccuracy } = require('./services/projections/pickGrader');
const { fetchAllVenueWeather, router: weatherRouter } = require('./services/weatherService');
const { runGoalieConfirmation, getConfirmationSchedule, router: goalieRouter } = require('./services/nhlGoalieConfirmation');

// ── Startup env var validation ─────────────────────────────────────────────────
// Fail loud at boot rather than silently at 4:30 AM.
// REQUIRED: server cannot function without these.
// OPTIONAL: missing ones degrade specific features but don't crash the server.
const REQUIRED_ENV = ['DATABASE_URL', 'ANTHROPIC_API_KEY'];
const OPTIONAL_ENV = [
  ['ODDS_API_KEY',         'edge detector + team bets will produce zero picks'],
  ['BALLDONTLIE_API_KEY',  'NBA projections + nightly roster will fail (401)'],
  ['CLERK_SECRET_KEY',     'auth middleware will not verify tokens'],
];

const missingRequired = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingRequired.length > 0) {
  console.error('🚨 FATAL: Missing required environment variables:');
  missingRequired.forEach(k => console.error(`   — ${k}`));
  console.error('Server cannot start. Set these in Railway → Variables.');
  process.exit(1);
}

OPTIONAL_ENV.forEach(([key, impact]) => {
  const val = process.env[key];
  if (!val || !val.trim()) {
    console.warn(`⚠️  Missing optional env var: ${key} — ${impact}`);
  } else {
    console.log(`✅ Env: ${key} present (len=${val.trim().length})`);
  }
});

const app = express();
const PORT = process.env.PORT || 3001;

// Returns true if date is in US Daylight Saving Time (second Sun Mar → first Sun Nov)
function isDST(d) {
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  return d.getTimezoneOffset() < Math.max(jan, jul);
}

// Returns today's date in ET (YYYY-MM-DD), works correctly on UTC servers
function getTodayET() {
  const etOffset = isDST(new Date()) ? 4 : 5;
  const etNow = new Date(Date.now() - etOffset * 60 * 60 * 1000);
  return etNow.toISOString().split('T')[0];
}

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(clerkAuth); // attach Clerk auth info to every request (non-blocking)

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/picks',    require('./routes/picks'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/scores',   require('./routes/scores'));
app.use('/api/sports',   require('./routes/sports'));
app.use('/api/games',    require('./routes/games'));
app.use('/api/posts',    require('./routes/posts'));
app.use('/api/research', require('./routes/research'));
app.use('/api/nba',      require('./routes/nba'));
app.use('/api/players',  require('./routes/players'));
app.use('/api/weather',  weatherRouter);
app.use('/api/nhl/goalies', goalieRouter);
app.use('/api/reports',   require('./routes/reports'));
app.use('/api/ufc',       require('./routes/ufc'));

// Health check — Railway and monitoring tools hit this
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version check — confirms which code is deployed and env vars are loaded
app.get('/api/version', (req, res) => {
  const month = new Date().getMonth();
  const year  = new Date().getFullYear();
  const season = month >= 9 ? year : year - 1;
  res.json({
    version:       '2.1.0',
    season,
    bdlKeyPresent: !!process.env.BALLDONTLIE_API_KEY,
    deployedAt:    new Date().toISOString(),
  });
});

// ── Helper: run a Python projection script ────────────────────────────────────
// The Python data collector and projection model run as child processes.
// They use BallDontLie / MLB Stats API / NHL API — all public or key-based.
// These run fine on Railway with no special networking required.
// On Railway, all crons run correctly in production.

// ── UFC Odds ──────────────────────────────────────────────────────────────────
// Token overlap score 0-1 between two name strings.
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const tokA = a.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const tokB = b.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const matches = tokA.filter(t => tokB.includes(t)).length;
  return matches / Math.max(tokA.length, tokB.length);
}

/**
 * Pull UFC/MMA fight moneylines from The Odds API and write them into
 * ufc_upcoming_fights.fighter_a_moneyline / fighter_b_moneyline.
 * Uses fuzzy name matching (token overlap) to link Odds API fighter names
 * to the ufcstats names already in the DB.
 */
async function fetchAndStoreUFCOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.log('[UFC Odds] ODDS_API_KEY not set — skipping');
    return;
  }

  try {
    const url = new URL('https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds');
    url.searchParams.set('apiKey',      apiKey);
    url.searchParams.set('regions',     'us');
    url.searchParams.set('markets',     'h2h');
    url.searchParams.set('oddsFormat',  'american');
    url.searchParams.set('bookmakers',  'draftkings,fanduel,betmgm,bet365');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    const remaining = res.headers.get('x-requests-remaining');
    if (remaining) console.log(`[UFC Odds] Credits remaining: ${remaining}`);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn(`[UFC Odds] API error ${res.status}:`, body.message || '');
      return;
    }

    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) {
      console.log('[UFC Odds] No MMA events returned from Odds API');
      return;
    }
    console.log(`[UFC Odds] ${events.length} MMA events from Odds API`);

    // Load all upcoming fights once
    const { rows: fights } = await db.query(`
      SELECT id, fighter_a_name, fighter_b_name
      FROM ufc_upcoming_fights
      WHERE fight_date >= CURRENT_DATE
    `);

    if (fights.length === 0) {
      console.log('[UFC Odds] No upcoming fights in DB to match against');
      return;
    }

    let updated = 0;

    for (const event of events) {
      const apiA = event.home_team;
      const apiB = event.away_team;
      if (!apiA || !apiB) continue;

      // Extract moneylines — prefer DraftKings, fall back to first bookmaker
      let mlA = null, mlB = null;
      const bm = event.bookmakers?.find(b => b.key === 'draftkings')
              || event.bookmakers?.find(b => b.key === 'fanduel')
              || event.bookmakers?.[0];
      if (bm) {
        const h2h = bm.markets?.find(m => m.key === 'h2h');
        if (h2h) {
          mlA = h2h.outcomes?.find(o => o.name === apiA)?.price ?? null;
          mlB = h2h.outcomes?.find(o => o.name === apiB)?.price ?? null;
        }
      }
      if (mlA === null || mlB === null) continue;

      // Find the best matching fight row in our DB
      let bestFight = null, bestScore = 0;
      for (const fight of fights) {
        // Try both orientations (apiA↔fighter_a and apiA↔fighter_b)
        const scoreAA = nameSimilarity(apiA, fight.fighter_a_name);
        const scoreBB = nameSimilarity(apiB, fight.fighter_b_name);
        const scoreAB = nameSimilarity(apiA, fight.fighter_b_name);
        const scoreBA = nameSimilarity(apiB, fight.fighter_a_name);
        const scoreNormal  = (scoreAA + scoreBB) / 2;
        const scoreFlipped = (scoreAB + scoreBA) / 2;
        const score = Math.max(scoreNormal, scoreFlipped);
        if (score > bestScore && score >= 0.6) {
          bestScore = score;
          bestFight = { ...fight, flipped: scoreFlipped > scoreNormal };
        }
      }

      if (!bestFight) {
        console.log(`[UFC Odds] No DB match for: ${apiA} vs ${apiB} (best score ${bestScore.toFixed(2)})`);
        continue;
      }

      // If flipped, apiA maps to fighter_b in DB and apiB maps to fighter_a
      const finalMlA = bestFight.flipped ? mlB : mlA;
      const finalMlB = bestFight.flipped ? mlA : mlB;

      await db.query(`
        UPDATE ufc_upcoming_fights
        SET fighter_a_moneyline = $1,
            fighter_b_moneyline = $2
        WHERE id = $3
      `, [finalMlA, finalMlB, bestFight.id]);

      console.log(`[UFC Odds] ✅ ${bestFight.fighter_a_name} (${finalMlA}) vs ${bestFight.fighter_b_name} (${finalMlB})`);
      updated++;
    }

    console.log(`[UFC Odds] Done — ${updated} fights updated with moneylines`);
  } catch (err) {
    console.error('[UFC Odds] Unexpected error:', err.message);
  }
}

function runPythonScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'services/projections', scriptName);
    // Use the venv Python if available, otherwise system python3
    const venvPython = path.join(__dirname, '../nba_service/venv/bin/python');
    const python = require('fs').existsSync(venvPython) ? venvPython : 'python3';

    console.log(`  Running ${scriptName}…`);
    execFile(python, [scriptPath, ...args], { timeout: 3600000 }, (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      if (err) { reject(err); return; }
      resolve(stdout);
    });
  });
}

// ── Projection engine cron pipeline ──────────────────────────────────────────
// CRON SCHEDULE (all times Eastern) — picks live by 7:00 AM every morning:
//
//  MIDNIGHT — DATA COLLECTION:
//  12:00 AM — nbaDataCollector.py + mlbDataCollector.py + nhlDataCollector.py (parallel)
//             mlbPitcherArsenalCollector.py
//  12:30 AM — computeDerivedStats.py  (BABIP, ISO, TS%, usage rate)
//   1:00 AM — computePositionDefense.py
//   1:15 AM — mlbBullpenCollector.py
//   1:30 AM — mlbMatchupCollector.py
//   1:45 AM — mlbSplitsCollector.py
//   1:50 AM — mlbUmpireCollector.py
//  Mon 2AM — statcastCollector.py    (weekly Statcast update)
//
//  EARLY MORNING — ODDS + PROJECTIONS:
//   4:00 AM — fetchAllVenueWeather() + collectPropsLines() + buildNightlyRoster()
//             + schedule NHL goalie checks
//   4:30 AM — nbaProjectionModel.py + mlbProjectionModel.py + nhlProjectionModel.py (parallel)
//   5:30 AM — edgeDetector (all sports: NBA, MLB, NHL prop edges + team bets)
//   6:00 AM — aiPicks.js (generate Chalky pick cards for all sports via Claude)
//   6:55 AM — verification check (confirm picks are in DB before 7 AM)
//
//  MORNING — PLAYER PROPS:
//   8:00 AM — pickGrader.js (grade yesterday's picks using final scores)
//   9:00 AM — writePropLinesToDB (NBA + NHL + MLB — lines now posted by books)
//   9:15 AM — nbaProjectionModel.py --props-only (player props with real lines)
//
//  NHL SPECIAL: goalie confirmation jobs scheduled dynamically at 4:00 AM,
//               running 90 min before each puck drop.
//
//  WEEKLY (every Monday):
//  Mon 2:00 AM — statcastCollector.py (Baseball Savant whiff rates + Statcast)
//  Mon 3:00 AM — computeLeagueAverages.py (keep LEAGUE_AVG constants current)
//
//  NOTE: mlbLineupFetcher.py exists but is NOT scheduled.
//  MLB picks are generated once at 4:30 AM using lineup fallbacks.
//  Lineups post 10 AM–4 PM ET — after picks are already live at 7 AM.
//  A silent noon update (Option B) can be added later if needed.
//
// Disabled in MOCK_MODE to avoid API credit usage during development.

// ── Pipeline helper: wraps each step with timing + error isolation ────────────
// A failure in one step logs clearly and continues — the pipeline never crashes.
const runPipeline = async (name, fn) => {
  try {
    console.log(`🔄 Starting: ${name}`);
    const start = Date.now();
    await fn();
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ Completed: ${name} in ${duration}s`);
  } catch (err) {
    console.error(`🚨 FAILED: ${name}`);
    console.error(err.message);
    // Continue pipeline even if one step fails — do not crash server
  }
};

// Tracks dynamic NHL goalie-check jobs so we can cancel them next day
const _goalieCheckJobs = [];

if (process.env.MOCK_MODE !== 'true') {

  // ── 12:00 AM — Nightly data collection (all sports, parallel) ────────────────
  cron.schedule('0 0 * * *', async () => {
    console.log('\n⏰ [12:00 AM] Nightly data collection (NBA + MLB + NHL + arsenal)…');
    await Promise.allSettled([
      runPipeline('NBA Data Collector',          () => runPythonScript('nbaDataCollector.py')),
      runPipeline('MLB Data Collector',          () => runPythonScript('mlbDataCollector.py')),
      runPipeline('NHL Data Collector',          () => runPythonScript('nhlDataCollector.py')),
      runPipeline('MLB Pitcher Arsenal',         () => runPythonScript('mlbPitcherArsenalCollector.py')),
    ]);
  }, { timezone: 'America/New_York' });

  // ── 12:30 AM — Derived stats (BABIP, ISO, TS%, usage rate) ───────────────────
  // ── 12:15 AM — Build team_game_logs from player_game_logs ────────────────────
  // populateTeamData.py aggregates player logs → team totals (pace, pts scored/allowed).
  // Runs after the 12:00 AM data collector so player_game_logs has tonight's new games.
  // The projection model reads team pace from team_game_logs; without this it defaults to
  // league average pace for every game (picks still generate, but lose the pace factor).
  cron.schedule('15 0 * * *', async () => {
    console.log('\n⏰ [12:15 AM] Building team game logs from player data…');
    await Promise.all([
      runPipeline('NBA Team Data', () => runPythonScript('populateTeamData.py')),
      runPipeline('NHL Team Data', () => runPythonScript('nhlTeamCollector.py')),
    ]);
  }, { timezone: 'America/New_York' });

  cron.schedule('30 0 * * *', async () => {
    console.log('\n⏰ [12:30 AM] Computing derived stats…');
    await runPipeline('Derived Stats', () => runPythonScript('computeDerivedStats.py'));
  }, { timezone: 'America/New_York' });

  // ── 1:00 AM — Position defense ratings ───────────────────────────────────────
  cron.schedule('0 1 * * *', async () => {
    console.log('\n⏰ [1:00 AM] Computing position defense ratings…');
    await runPipeline('Position Defense', () => runPythonScript('computePositionDefense.py'));
  }, { timezone: 'America/New_York' });

  // ── 1:15 AM — MLB bullpen usage ───────────────────────────────────────────────
  cron.schedule('15 1 * * *', async () => {
    console.log('\n⏰ [1:15 AM] MLB Bullpen Usage Collector…');
    await runPipeline('MLB Bullpen Usage', () => runPythonScript('mlbBullpenCollector.py'));
  }, { timezone: 'America/New_York' });

  // ── 1:30 AM — MLB pitcher-batter career matchups ──────────────────────────────
  cron.schedule('30 1 * * *', async () => {
    console.log('\n⏰ [1:30 AM] MLB Matchup Collector…');
    await runPipeline('MLB Matchup Collector', () => runPythonScript('mlbMatchupCollector.py'));
  }, { timezone: 'America/New_York' });

  // ── 1:45 AM — MLB batter splits (day/night, count, RISP) ─────────────────────
  cron.schedule('45 1 * * *', async () => {
    console.log('\n⏰ [1:45 AM] MLB Splits Collector…');
    await runPipeline('MLB Splits Collector', () => runPythonScript('mlbSplitsCollector.py'));
  }, { timezone: 'America/New_York' });

  // ── 1:50 AM — MLB umpire assignments ─────────────────────────────────────────
  cron.schedule('50 1 * * *', async () => {
    console.log('\n⏰ [1:50 AM] MLB Umpire Collector…');
    await runPipeline('MLB Umpire Collector', () => runPythonScript('mlbUmpireCollector.py'));
  }, { timezone: 'America/New_York' });

  // ── Every Monday 2:00 AM — Statcast (weekly Baseball Savant update) ───────────
  cron.schedule('0 2 * * 1', async () => {
    console.log('\n⏰ [Mon 2:00 AM] Statcast Collector (Baseball Savant)…');
    await runPipeline('Statcast Collector', () => runPythonScript('statcastCollector.py'));
  }, { timezone: 'America/New_York' });

  // ── 4:00 AM — Odds lines + roster + NHL goalie scheduling ────────────────────
  // Must complete before 4:30 AM projection models read the odds.
  cron.schedule('0 4 * * *', async () => {
    console.log('\n⏰ [4:00 AM] Odds + roster + NHL goalie scheduling…');

    // Weather and props/roster can run in parallel
    await Promise.allSettled([
      runPipeline('Venue Weather',    () => fetchAllVenueWeather()),
      runPipeline('Nightly Roster',   () => buildNightlyRoster()),
      runPipeline('Odds / Prop Lines', () => collectPropsLines()),
    ]);

    // Schedule goalie confirmation jobs 90 min before each puck drop
    await runPipeline('NHL Goalie Scheduling', async () => {
      _goalieCheckJobs.forEach(j => j.stop());
      _goalieCheckJobs.length = 0;

      const schedule = await getConfirmationSchedule();
      for (const game of schedule) {
        const checkAt = game.checkTime;
        if (checkAt <= new Date()) continue;  // already past
        const min  = checkAt.getMinutes();
        const hour = checkAt.getHours();
        const job  = cron.schedule(
          `${min} ${hour} * * *`,
          async () => {
            console.log(`\n🏒 Goalie check: ${game.awayTeam} @ ${game.homeTeam}`);
            await runGoalieConfirmation().catch(e => console.error('Goalie check failed:', e.message));
          },
          { timezone: 'America/New_York' }
        );
        _goalieCheckJobs.push(job);
      }
      console.log(`  Scheduled ${_goalieCheckJobs.length} NHL goalie checks`);
    });
  }, { timezone: 'America/New_York' });

  // ── 4:30 AM — All three projection models (parallel) ─────────────────────────
  cron.schedule('30 4 * * *', async () => {
    console.log('\n⏰ [4:30 AM] Running NBA + MLB + NHL projection models (parallel)…');
    await Promise.allSettled([
      runPipeline('NBA Projection Model', () => runPythonScript('nbaProjectionModel.py')),
      runPipeline('MLB Projection Model', () => runPythonScript('mlbProjectionModel.py')),
      runPipeline('NHL Projection Model', () => runPythonScript('nhlProjectionModel.py')),
    ]);

    // ── Projection row count check (fail-loud before edge detection wastes time) ──
    // If models wrote 0 rows the edge detector will find no edges and aiPicks will
    // generate zero picks. Catch it here at 4:30 AM instead of 6:55 AM.
    try {
      const db = require('./db');
      const today = getTodayET();
      const { rows } = await db.query(
        `SELECT sport, COUNT(*) AS count
         FROM chalk_projections
         WHERE game_date = $1
         GROUP BY sport
         ORDER BY sport`,
        [today]
      );

      const bySport = Object.fromEntries(rows.map(r => [r.sport, parseInt(r.count)]));
      const total   = rows.reduce((sum, r) => sum + parseInt(r.count), 0);

      if (total === 0) {
        console.error(`\n🚨 [4:30 AM] ALERT: chalk_projections has ZERO rows for ${today}`);
        console.error('  Possible causes:');
        console.error('  — BALLDONTLIE_API_KEY missing/invalid (NBA 401 → 0 players)');
        console.error('  — No games scheduled today');
        console.error('  — Market line gate blocking all writes (pre-9 AM run)');
        console.error('  Edge detection and aiPicks will produce zero picks unless resolved.');
      } else {
        console.log(`✅ [4:30 AM] chalk_projections: ${total} rows for ${today}`);
        rows.forEach(r => console.log(`   ${r.sport}: ${r.count} rows`));

        // Warn if any sport that had games last run is now empty
        const missing = ['NBA', 'MLB', 'NHL'].filter(s => !bySport[s]);
        if (missing.length > 0) {
          console.warn(`⚠️  [4:30 AM] Missing projections for: ${missing.join(', ')} — check those model logs`);
        }
      }
    } catch (err) {
      console.error('[4:30 AM] Projection row count check failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 5:30 AM — Edge detection (all sports) ────────────────────────────────────
  cron.schedule('30 5 * * *', async () => {
    console.log('\n⏰ [5:30 AM] Edge detection — NBA + MLB + NHL…');
    await Promise.allSettled([
      runPipeline('NBA Prop Edges',  () => detectEdges()),
      runPipeline('MLB Prop Edges',  () => detectEdgesForSport('MLB')),
      runPipeline('NHL Prop Edges',  () => detectEdgesForSport('NHL')),
      runPipeline('NBA Team Bets',   () => detectTeamBetEdges('NBA')),
      runPipeline('MLB Team Bets',   () => detectTeamBetEdges('MLB')),
      runPipeline('NHL Team Bets',   () => detectTeamBetEdges('NHL')),
    ]);
  }, { timezone: 'America/New_York' });

  // ── 6:00 AM — Generate Chalky's picks via Claude (all sports) ────────────────
  // Must finish by 7:00 AM. Typically 20–30 min for a full slate.
  cron.schedule('0 6 * * *', async () => {
    const startTime = new Date().toISOString();
    console.log(`\n⏰ [6:00 AM] Generating Chalky's picks (all sports)…`);
    console.log(`🎯 aiPicks.js started: ${startTime}`);

    let totalCount = 0;

    await runPipeline('Chalky Model Picks', async () => {
      const modelPicks = await generateModelPicks();
      totalCount += modelPicks.length;
      console.log(`  Model picks: ${modelPicks.length}`);
    });

    await Promise.allSettled([
      runPipeline('Game Picks',      async () => {
        const picks = await generatePicks();
        totalCount += picks.length;
        console.log(`  Game picks: ${picks.length}`);
      }),
      runPipeline('Prop Picks',      async () => {
        const picks = await generatePropPicks();
        totalCount += picks.length;
        console.log(`  Prop picks: ${picks.length}`);
      }),
    ]);

    const endTime = new Date().toISOString();
    console.log(`🎯 aiPicks.js completed: ${endTime}`);
    console.log(`🎯 Total picks generated: ${totalCount}`);
  }, { timezone: 'America/New_York' });

  // ── 6:55 AM — Pre-delivery verification: confirm picks are in DB ──────────────
  cron.schedule('55 6 * * *', async () => {
    console.log('\n⏰ [6:55 AM] Pre-delivery verification…');
    try {
      const db = require('./db');
      const today = getTodayET();

      const { rows } = await db.query(`
        SELECT league, COUNT(*) AS count
        FROM picks
        WHERE pick_date = $1
        GROUP BY league
        ORDER BY league
      `, [today]);

      const totalPicks = rows.reduce((sum, r) => sum + parseInt(r.count), 0);

      if (totalPicks === 0) {
        console.error(`\n🚨🚨🚨 CRITICAL ALERT 🚨🚨🚨`);
        console.error(`ZERO PICKS GENERATED TODAY`);
        console.error(`Date: ${today}`);
        console.error(`Time: ${new Date().toISOString()}`);
        console.error(`Check Railway logs immediately. Manual intervention required.`);
        console.error(`  — Did 4:30 AM model run complete?`);
        console.error(`  — Did BDL API return games? (check BALLDONTLIE_API_KEY)`);
        console.error(`  — Did 5:30 AM edge detection find edges?`);
        console.error(`  — Did 6:00 AM aiPicks.js run without crash?`);
      } else {
        console.log(`✅ 6:55 AM: ${totalPicks} picks live for ${today}:`);
        rows.forEach(row => console.log(`   ${row.league}: ${row.count} picks`));
      }
    } catch (err) {
      console.error('🚨 6:55 AM verification failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 8:00 AM — Grade yesterday's picks ────────────────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    console.log('\n⏰ [8:00 AM] Grading yesterday\'s picks…');
    await runPipeline('Pick Grader', async () => {
      const r = await gradeYesterdaysPicks();
      console.log(`  Grading complete: ${r.correctPicks}/${r.totalPicks} correct`);
    });
  }, { timezone: 'America/New_York' });

  // ── Every Monday 3:00 AM — Recompute league averages (all three sports) ──────
  // Runs after Statcast (Mon 2 AM). Keeps LEAGUE_AVG constants current all season.
  cron.schedule('0 3 * * 1', async () => {
    console.log('\n⏰ [Mon 3:00 AM] Computing league averages…');
    await runPipeline('League Averages', () => runPythonScript('computeLeagueAverages.py'));
  }, { timezone: 'America/New_York' });

  // ── UFC: Tuesday 3:00 AM ET — Collect upcoming event + fighter data ──────────
  cron.schedule('0 3 * * 2', async () => {
    console.log('\n⏰ [Tue 3:00 AM] UFC data collector…');
    await runPipeline('UFC Data Collector', () => runPythonScript('ufcDataCollector.py'));
  }, { timezone: 'America/New_York' });

  // ── UFC: Tuesday 3:30 AM ET — Pull moneylines from Odds API ──────────────────
  cron.schedule('30 3 * * 2', async () => {
    console.log('\n⏰ [Tue 3:30 AM] UFC odds fetch…');
    await fetchAndStoreUFCOdds();
  }, { timezone: 'America/New_York' });

  // ── UFC: Tuesday 4:00 AM ET — Run projection model ───────────────────────────
  cron.schedule('0 4 * * 2', async () => {
    console.log('\n⏰ [Tue 4:00 AM] UFC projection model…');
    await runPipeline('UFC Projection Model', () => runPythonScript('ufcProjectionModel.py'));
  }, { timezone: 'America/New_York' });

  // ── UFC: Saturday 8:00 AM ET — Refresh odds before fight-day model run ────────
  cron.schedule('0 8 * * 6', async () => {
    console.log('\n⏰ [Sat 8:00 AM] UFC fight-day odds refresh…');
    await fetchAndStoreUFCOdds();
  }, { timezone: 'America/New_York' });

  // ── UFC: Saturday 9:00 AM ET — Refresh model with fight-day odds ─────────────
  cron.schedule('0 9 * * 6', async () => {
    console.log('\n⏰ [Sat 9:00 AM] UFC fight-day model refresh…');
    await runPipeline('UFC Fight Day Model', () => runPythonScript('ufcProjectionModel.py'));
  }, { timezone: 'America/New_York' });

  // ── 9:00 AM ET — Write player prop lines to DB (all sports) ─────────────────
  // Runs after the 8 AM grader. Stores fresh lines for that night's games.
  cron.schedule('0 9 * * *', async () => {
    const today = getTodayET();
    console.log(`\n⏰ [9:00 AM] Writing prop lines to DB for all sports (${today})…`);
    const { writePropLinesToDB } = require('./services/oddsService');
    try {
      await writePropLinesToDB('NBA', today);
      await writePropLinesToDB('NHL', today);
      await writePropLinesToDB('MLB', today);
    } catch (err) {
      console.error('[cron] writePropLinesToDB error:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 9:15 AM ET — All sports player props run ─────────────────────────────────
  // Sportsbooks post player prop lines between 9-10 AM ET.
  // writePropLinesToDB (9 AM) has just filled player_props_history.
  // NBA --props-only: re-runs full player projection with now-available lines.
  // MLB --props-only: re-gates existing 4:30 AM projections against real lines.
  // NHL --props-only: re-gates existing 4:30 AM projections against real lines.
  cron.schedule('15 9 * * *', async () => {
    console.log('\n⏰ [9:15 AM] All sports player props run (lines now posted)…');
    await Promise.allSettled([
      runPipeline('NBA Player Props Run', () => runPythonScript('nbaProjectionModel.py', ['--props-only'])),
      runPipeline('MLB Player Props Run', () => runPythonScript('mlbProjectionModel.py', ['--props-only'])),
      runPipeline('NHL Player Props Run', () => runPythonScript('nhlProjectionModel.py', ['--props-only'])),
    ]);
  }, { timezone: 'America/New_York' });

  // ── 9:30 AM ET — All sports player prop edge detection ───────────────────────
  // The 5:30 AM detectEdges() ran before player projections existed in chalk_projections.
  // Now projections are written (9:15 AM run) — re-run edge detection for all sports
  // to write chalk_edge + confidence to player_props_history before pick generation.
  cron.schedule('30 9 * * *', async () => {
    console.log('\n⏰ [9:30 AM] All sports player prop edge detection…');
    await Promise.allSettled([
      runPipeline('NBA Player Prop Edges', () => detectEdges()),
      runPipeline('MLB Player Prop Edges', () => detectEdgesForSport('MLB')),
      runPipeline('NHL Player Prop Edges', () => detectEdgesForSport('NHL')),
    ]);
  }, { timezone: 'America/New_York' });

  // ── 9:45 AM ET — Generate Chalky's player prop picks ─────────────────────────
  // The 6:00 AM aiPicks run found 0 model edges (player props not ready yet).
  // Now that edges are written at 9:30 AM, generate Chalky's player prop picks.
  // These are added on top of the team prop picks from the 6 AM run, giving the
  // full slate of picks before the 10 AM delivery window.
  cron.schedule('45 9 * * *', async () => {
    console.log('\n⏰ [9:45 AM] Generating Chalky\'s player prop picks…');
    await runPipeline('Chalky Player Prop Picks', async () => {
      const picks = await generateModelPicks();
      console.log(`  Player prop picks generated: ${picks.length}`);
    });
  }, { timezone: 'America/New_York' });

  // ── 10:15 AM ET — Daily failsafe: ensure picks exist before users wake up ─────
  // If the overnight pipeline failed (server restart, API error, etc.) and the
  // 9:45 AM run also produced nothing, this is the last safety net.
  // It re-runs the full picks generator. Idempotent: ON CONFLICT DO NOTHING
  // prevents duplicates, so running it when picks already exist is harmless.
  cron.schedule('15 10 * * *', async () => {
    const today = getTodayET();
    console.log(`\n⏰ [10:15 AM] Daily failsafe check for ${today}…`);
    try {
      const db = require('./db');
      const { rows } = await db.query(
        `SELECT COUNT(*) as count FROM picks WHERE pick_date = $1`, [today]
      );
      const pickCount = parseInt(rows[0].count);

      if (pickCount > 0) {
        console.log(`✅ [10:15 AM] ${pickCount} picks already live for ${today} — no action needed`);
        return;
      }

      console.log(`🚨 [10:15 AM] ZERO picks for ${today} — triggering emergency pick generation…`);

      // Run models fresh (uses yesterday's game log data which is already in DB)
      await Promise.allSettled([
        runPipeline('Failsafe: NBA Model', () => runPythonScript('nbaProjectionModel.py')),
        runPipeline('Failsafe: MLB Model', () => runPythonScript('mlbProjectionModel.py')),
        runPipeline('Failsafe: NHL Model', () => runPythonScript('nhlProjectionModel.py')),
      ]);

      // Edge detection
      await Promise.allSettled([
        runPipeline('Failsafe: NBA Edges', () => detectEdges()),
        runPipeline('Failsafe: MLB Edges', () => detectEdgesForSport('MLB')),
        runPipeline('Failsafe: NHL Edges', () => detectEdgesForSport('NHL')),
        runPipeline('Failsafe: NBA Teams', () => detectTeamBetEdges('NBA')),
        runPipeline('Failsafe: MLB Teams', () => detectTeamBetEdges('MLB')),
        runPipeline('Failsafe: NHL Teams', () => detectTeamBetEdges('NHL')),
      ]);

      // Pick generation
      const modelPicks = await generateModelPicks().catch(() => []);
      const [gamePicks, propPicks] = await Promise.allSettled([generatePicks(), generatePropPicks()]);

      const total = modelPicks.length + (gamePicks.value?.length || 0) + (propPicks.value?.length || 0);
      console.log(`✅ [10:15 AM] Failsafe complete — ${total} picks generated for ${today}`);
    } catch (err) {
      console.error('🚨 [10:15 AM] Failsafe failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

} else {
  console.log('ℹ️  MOCK_MODE=true — all cron jobs disabled, no API credits used');
}

// ── Odds endpoint ─────────────────────────────────────────────────────────────
// GET /api/odds/:league/today → today's game lines (moneyline, spread, total)
// Supports: NBA | MLB | NHL | NFL | Soccer
const { getTodayGames } = require('./services/oddsService');

app.get('/api/odds/:league/today', async (req, res) => {
  try {
    const league = req.params.league.toUpperCase();
    const games = await getTodayGames(league);
    res.json({ league, games, count: games.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: manual pipeline trigger ────────────────────────────────────────────
// POST /api/admin/run-pipeline?secret=ADMIN_SECRET
// Runs the full pipeline for today (for testing before crons kick in).
// Accepts optional ?step=data|props|model|edges|picks to run a single step.
app.post('/api/admin/run-pipeline', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const step = req.query.step || 'all';
  const results = {};

  res.json({ message: 'Pipeline started', step, check: '/api/picks/today for results' });

  // Run async so the HTTP response is immediate
  (async () => {
    try {
      if (step === 'all' || step === 'data') {
        console.log('\n🔧 [Admin] Running data collectors…');
        await Promise.allSettled([
          runPythonScript('nbaDataCollector.py'),
          runPythonScript('mlbDataCollector.py'),
          runPythonScript('nhlDataCollector.py'),
        ]);
        console.log('✅ Data collection complete');
      }
      if (step === 'all' || step === 'roster') {
        console.log('\n🔧 [Admin] Building nightly roster…');
        await buildNightlyRoster();
        console.log('✅ Nightly roster built');
      }
      if (step === 'all' || step === 'props') {
        console.log('\n🔧 [Admin] Collecting prop lines…');
        await collectPropsLines();
        console.log('✅ Prop lines collected');
      }
      if (step === 'all' || step === 'model') {
        console.log('\n🔧 [Admin] Running projection models…');
        await Promise.allSettled([
          runPythonScript('nbaProjectionModel.py'),
          runPythonScript('mlbProjectionModel.py'),
          runPythonScript('nhlProjectionModel.py'),
        ]);
        console.log('✅ Projection models complete');
      }
      if (step === 'all' || step === 'edges') {
        console.log('\n🔧 [Admin] Detecting player prop edges + team bet picks…');
        await Promise.allSettled([
          detectEdges(),
          detectEdgesForSport('MLB'),
          detectEdgesForSport('NHL'),
          detectTeamBetEdges('NBA'),
          detectTeamBetEdges('MLB'),
          detectTeamBetEdges('NHL'),
        ]);
        console.log('✅ Edge detection complete (props + team bets)');
      }
      if (step === 'all' || step === 'picks') {
        console.log('\n🔧 [Admin] Generating Chalky\'s picks…');
        const modelPicks = await generateModelPicks();
        console.log(`✅ Model picks: ${modelPicks.length}`);
        const [gamePicks] = await Promise.allSettled([generatePicks()]);
        console.log(`✅ Game picks: ${gamePicks.value?.length || 0}`);
      }
      console.log('\n✅ [Admin] Pipeline complete');
    } catch (err) {
      console.error('❌ [Admin] Pipeline error:', err.message);
    }
  })();
});

// ── Model accuracy endpoint ────────────────────────────────────────────────────
// Powers Chalky's track record display in the app: GET /api/model/accuracy
app.get('/api/model/accuracy', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const accuracy = await getModelAccuracy(days);
    res.json(accuracy || { message: 'No graded picks yet' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Startup pipeline recovery ─────────────────────────────────────────────────
// If Railway restarts the server after 4:30 AM ET with no picks for today,
// the daily crons have already missed. This runs once on startup and re-runs
// the appropriate pipeline steps based on the current ET time.
async function recoverMissedPipeline() {
  if (process.env.MOCK_MODE === 'true') return;

  const today    = getTodayET();
  const etOffset = isDST(new Date()) ? 4 : 5;
  const etNow    = new Date(Date.now() - etOffset * 60 * 60 * 1000);
  const etHour   = etNow.getUTCHours() + etNow.getUTCMinutes() / 60;

  // Before 4:30 AM ET — crons will fire on schedule, nothing to recover
  if (etHour < 4.5) {
    console.log(`ℹ️  Startup at ${etNow.getUTCHours()}:${String(etNow.getUTCMinutes()).padStart(2,'0')} ET — crons will fire on schedule`);
    return;
  }

  // After 10 PM ET — too late to run picks for today
  if (etHour >= 22) return;

  const db = require('./db');
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) as count FROM picks WHERE pick_date = $1`, [today]
    );
    const pickCount = parseInt(rows[0].count);

    if (pickCount > 0) {
      console.log(`✅ Startup: ${pickCount} picks already exist for ${today}`);
      return;
    }

    console.log(`\n⚠️  STARTUP RECOVERY: No picks for ${today} — server restarted after cron window`);
    console.log(`   ET time: ${etNow.getUTCHours()}:${String(etNow.getUTCMinutes()).padStart(2,'0')}`);
    console.log(`   Re-running pipeline from appropriate step…\n`);

    // Always run roster + prop lines first (fast, idempotent)
    await runPipeline('Recovery: Nightly Roster',  () => buildNightlyRoster());
    const { writePropLinesToDB } = require('./services/oddsService');
    await Promise.allSettled([
      writePropLinesToDB('NBA', today).catch(e => console.error('Recovery props NBA:', e.message)),
      writePropLinesToDB('NHL', today).catch(e => console.error('Recovery props NHL:', e.message)),
      writePropLinesToDB('MLB', today).catch(e => console.error('Recovery props MLB:', e.message)),
    ]);

    // Run projection models (skipped if before 4:30 AM, but we're past that)
    console.log('  Recovery: running projection models…');
    await Promise.allSettled([
      runPipeline('Recovery: NBA Model', () => runPythonScript('nbaProjectionModel.py')),
      runPipeline('Recovery: MLB Model', () => runPythonScript('mlbProjectionModel.py')),
      runPipeline('Recovery: NHL Model', () => runPythonScript('nhlProjectionModel.py')),
    ]);

    // Edge detection
    console.log('  Recovery: running edge detection…');
    await Promise.allSettled([
      runPipeline('Recovery: NBA Edges', () => detectEdges()),
      runPipeline('Recovery: MLB Edges', () => detectEdgesForSport('MLB')),
      runPipeline('Recovery: NHL Edges', () => detectEdgesForSport('NHL')),
      runPipeline('Recovery: NBA Teams', () => detectTeamBetEdges('NBA')),
      runPipeline('Recovery: MLB Teams', () => detectTeamBetEdges('MLB')),
      runPipeline('Recovery: NHL Teams', () => detectTeamBetEdges('NHL')),
    ]);

    // Pick generation
    console.log('  Recovery: generating picks…');
    await runPipeline('Recovery: Model Picks', async () => {
      const picks = await generateModelPicks();
      console.log(`  Recovery model picks: ${picks.length}`);
    });
    await Promise.allSettled([
      runPipeline('Recovery: Game Picks', async () => {
        const picks = await generatePicks();
        console.log(`  Recovery game picks: ${picks.length}`);
      }),
      runPipeline('Recovery: Prop Picks', async () => {
        const picks = await generatePropPicks();
        console.log(`  Recovery prop picks: ${picks.length}`);
      }),
    ]);

    console.log(`✅ Startup recovery complete for ${today}`);
  } catch (err) {
    console.error('Startup recovery failed:', err.message);
  }
}

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎯 Chalk API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Picks:  http://localhost:${PORT}/api/picks/today\n`);
  // Fire-and-forget: recover missed pipeline steps if server restarted after 4:30 AM
  setTimeout(() => recoverMissedPipeline().catch(e => console.error('Recovery error:', e.message)), 5000);
});
