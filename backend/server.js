require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const cron      = require('node-cron');
const { execFile } = require('child_process');
const path      = require('path');
const { clerkAuth }          = require('./middleware/auth');
const { generatePicks, generateModelPicks } = require('./services/aiPicks');
const { generatePropPicks }  = require('./services/propPicks');
const { detectEdges, detectEdgesForSport, detectTeamBetEdges, collectPropsLines, buildNightlyRoster } = require('./services/projections/edgeDetector');
const { gradeYesterdaysPicks, getModelAccuracy } = require('./services/projections/pickGrader');
const { fetchAllVenueWeather, router: weatherRouter } = require('./services/weatherService');
const { runGoalieConfirmation, getConfirmationSchedule, router: goalieRouter } = require('./services/nhlGoalieConfirmation');

const app = express();
const PORT = process.env.PORT || 3001;

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
      const today = new Date().toISOString().split('T')[0];
      const { rows } = await db.query(`
        SELECT sport, COUNT(*) AS count
        FROM picks
        WHERE pick_date = $1
        GROUP BY sport
        ORDER BY sport
      `, [today]);

      if (rows.length === 0) {
        console.error('🚨 6:55 AM ALERT: No picks in DB for today! aiPicks.js may have failed.');
      } else {
        console.log('✅ 6:55 AM: Picks ready for delivery at 7:00 AM:');
        rows.forEach(row => console.log(`   ${row.sport}: ${row.count} picks`));
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

  // ── 9:00 AM ET — Write player prop lines to DB (all sports) ─────────────────
  // Runs after the 8 AM grader. Stores fresh lines for that night's games.
  cron.schedule('0 9 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
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

  // ── 9:15 AM ET — NBA player props run ────────────────────────────────────────
  // The 4:30 AM model run skips player props because sportsbooks haven't posted lines yet.
  // This second run fires 15 min after writePropLinesToDB fills player_props_history.
  // --props-only skips team props (already written at 4:30 AM) and only generates
  // player prop picks: points, rebounds, assists, threes, PRA, P+R, P+A, A+R.
  cron.schedule('15 9 * * *', async () => {
    console.log('\n⏰ [9:15 AM] NBA player props run (lines now posted)…');
    await runPipeline('NBA Player Props Run',
      () => runPythonScript('nbaProjectionModel.py', ['--props-only'])
    );
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

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎯 Chalk API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Picks:  http://localhost:${PORT}/api/picks/today\n`);
});
