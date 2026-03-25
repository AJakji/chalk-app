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
// CRON SCHEDULE (all times Eastern):
//   12:00 AM — nbaDataCollector.py      (NBA game logs via BallDontLie)
//   12:15 AM — mlbDataCollector.py      (MLB game logs via MLB Stats API)
//   12:30 AM — nhlDataCollector.py      (NHL game logs via NHL API)
//    8:00 AM — fetchAllVenueWeather()   (MLB venue weather via Open-Meteo)
//              gradeYesterdaysPicks()   (grade yesterday's picks, all sports)
//    9:00 AM — collectPropsLines()      (prop lines for NBA + MLB + NHL)
//              getConfirmationSchedule()  (schedule NHL goalie checks)
//   10:00 AM — nbaProjectionModel.py    (NBA projection algorithm)
//              mlbProjectionModel.py    (MLB projection algorithm)
//   10:30 AM — nhlProjectionModel.py    (NHL projection algorithm)
//              detectEdgesForSport(MLB) (MLB edges)
//   11:00 AM — detectEdges()            (NBA edges)
//              detectEdgesForSport(NHL) (NHL edges)
//   11:30 AM — generateModelPicks()     (Chalky's picks via Claude, all sports)
//   -90 min before each NHL puck drop — runGoalieConfirmation()
//
// Disabled in MOCK_MODE to avoid API credit usage during development.

// Tracks dynamic NHL goalie-check jobs so we can cancel them next day
const _goalieCheckJobs = [];

if (process.env.MOCK_MODE !== 'true') {

  // ── 12:00 AM — Nightly NBA data collection ───────────────────────────────────
  cron.schedule('0 0 * * *', async () => {
    console.log('\n⏰ [12:00 AM] Nightly NBA data collection starting…');
    try {
      await runPythonScript('nbaDataCollector.py');
      console.log('✅ NBA data collection complete');
    } catch (err) {
      console.error('❌ NBA data collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 12:15 AM — Nightly MLB data collection ───────────────────────────────────
  cron.schedule('15 0 * * *', async () => {
    console.log('\n⏰ [12:15 AM] Nightly MLB data collection starting…');
    try {
      await runPythonScript('mlbDataCollector.py');
      console.log('✅ MLB data collection complete');
    } catch (err) {
      console.error('❌ MLB data collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 12:30 AM — Nightly NHL data collection ───────────────────────────────────
  cron.schedule('30 0 * * *', async () => {
    console.log('\n⏰ [12:30 AM] Nightly NHL data collection starting…');
    try {
      await runPythonScript('nhlDataCollector.py');
      console.log('✅ NHL data collection complete');
    } catch (err) {
      console.error('❌ NHL data collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 12:45 AM — Collect pitcher pitch arsenals for upcoming SPs
  cron.schedule('45 0 * * *', async () => {
    console.log('\n⏰ [12:45 AM] MLB Pitcher Arsenal Collector…');
    try {
      await runPythonScript('mlbPitcherArsenalCollector.py');
      console.log('✅ MLB pitcher arsenal collection complete');
    } catch (err) {
      console.error('❌ MLB pitcher arsenal collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 1:00 AM — Collect pitcher vs batter career matchup data
  cron.schedule('0 1 * * *', async () => {
    console.log('\n⏰ [1:00 AM] MLB Matchup Collector…');
    try {
      await runPythonScript('mlbMatchupCollector.py');
      console.log('✅ MLB matchup collection complete');
    } catch (err) {
      console.error('❌ MLB matchup collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 1:15 AM — Collect umpire assignments and compute tendencies
  cron.schedule('15 1 * * *', async () => {
    console.log('\n⏰ [1:15 AM] MLB Umpire Collector…');
    try {
      await runPythonScript('mlbUmpireCollector.py');
      console.log('✅ MLB umpire collection complete');
    } catch (err) {
      console.error('❌ MLB umpire collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 1:30 AM — Collect bullpen usage (pitches/innings last 3 days)
  cron.schedule('30 1 * * *', async () => {
    console.log('\n⏰ [1:30 AM] MLB Bullpen Usage Collector…');
    try {
      await runPythonScript('mlbBullpenCollector.py');
      console.log('✅ MLB bullpen usage collection complete');
    } catch (err) {
      console.error('❌ MLB bullpen usage collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 1:45 AM — Collect batter splits (day/night, count, RISP)
  cron.schedule('45 1 * * *', async () => {
    console.log('\n⏰ [1:45 AM] MLB Splits Collector…');
    try {
      await runPythonScript('mlbSplitsCollector.py');
      console.log('✅ MLB splits collection complete');
    } catch (err) {
      console.error('❌ MLB splits collection failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 8:00 AM — Weather + grading ──────────────────────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    console.log('\n⏰ [8:00 AM] Weather fetch + pick grading…');
    const [weatherResult, gradeResult] = await Promise.allSettled([
      fetchAllVenueWeather(),
      gradeYesterdaysPicks(),
    ]);
    if (weatherResult.status === 'fulfilled') {
      const count = Object.values(weatherResult.value).filter(w => w.weather_available).length;
      console.log(`✅ Weather: ${count}/30 venues fetched`);
    } else {
      console.error('❌ Weather fetch failed:', weatherResult.reason?.message);
    }
    if (gradeResult.status === 'fulfilled') {
      const r = gradeResult.value;
      console.log(`✅ Grading complete: ${r.correctPicks}/${r.totalPicks} correct`);
    } else {
      console.error('❌ Pick grading failed:', gradeResult.reason?.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 9:00 AM — Nightly roster + prop lines + schedule NHL goalie checks ────────
  cron.schedule('0 9 * * *', async () => {
    console.log('\n⏰ [9:00 AM] Building nightly roster + collecting prop lines…');
    // Build nightly_roster FIRST — edge detector gates on this
    try {
      await buildNightlyRoster();
    } catch (err) {
      console.error('❌ Nightly roster build failed:', err.message);
    }
    try {
      await collectPropsLines();
    } catch (err) {
      console.error('❌ Props collection failed:', err.message);
    }

    // Schedule one-off goalie confirmation run 90 min before each puck drop
    try {
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
      console.log(`✅ Scheduled ${_goalieCheckJobs.length} NHL goalie checks`);
    } catch (err) {
      console.error('❌ Goalie scheduling failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 10:00 AM — NBA + MLB projection models ────────────────────────────────────
  cron.schedule('0 10 * * *', async () => {
    console.log('\n⏰ [10:00 AM] Running NBA + MLB projection models…');
    const [nbaResult, mlbResult] = await Promise.allSettled([
      runPythonScript('nbaProjectionModel.py'),
      runPythonScript('mlbProjectionModel.py'),
    ]);
    if (nbaResult.status === 'fulfilled')  console.log('✅ NBA projection model complete');
    else console.error('❌ NBA projection model failed:', nbaResult.reason?.message);
    if (mlbResult.status === 'fulfilled')  console.log('✅ MLB projection model complete');
    else console.error('❌ MLB projection model failed:', mlbResult.reason?.message);
  }, { timezone: 'America/New_York' });

  // ── 10:30 AM — NHL projection model + MLB edge detection ─────────────────────
  cron.schedule('30 10 * * *', async () => {
    console.log('\n⏰ [10:30 AM] NHL projection model + MLB edge detection…');
    // Also refresh matchup data with confirmed lineups at 10:30 AM
    runPythonScript('mlbMatchupCollector.py').catch(e => console.error('MLB matchup refresh failed:', e.message));
    const [nhlResult, mlbEdgesResult] = await Promise.allSettled([
      runPythonScript('nhlProjectionModel.py'),
      detectEdgesForSport('MLB'),
    ]);
    if (nhlResult.status === 'fulfilled')  console.log('✅ NHL projection model complete');
    else console.error('❌ NHL projection model failed:', nhlResult.reason?.message);
    if (mlbEdgesResult.status === 'fulfilled') console.log(`✅ MLB edges: ${mlbEdgesResult.value.length} found`);
    else console.error('❌ MLB edge detection failed:', mlbEdgesResult.reason?.message);
  }, { timezone: 'America/New_York' });

  // ── 11:00 AM — NBA + NHL player prop edges + team bet edges (all sports) ──────
  cron.schedule('0 11 * * *', async () => {
    console.log('\n⏰ [11:00 AM] NBA + NHL prop edges + team bet detection…');
    const [nbaEdges, nhlEdges, nbaBets, mlbBets, nhlBets] = await Promise.allSettled([
      detectEdges(),
      detectEdgesForSport('NHL'),
      detectTeamBetEdges('NBA'),
      detectTeamBetEdges('MLB'),
      detectTeamBetEdges('NHL'),
    ]);
    if (nbaEdges.status  === 'fulfilled')  console.log(`✅ NBA prop edges: ${nbaEdges.value.length} found`);
    else console.error('❌ NBA edge detection failed:', nbaEdges.reason?.message);
    if (nhlEdges.status  === 'fulfilled')  console.log(`✅ NHL prop edges: ${nhlEdges.value.length} found`);
    else console.error('❌ NHL edge detection failed:', nhlEdges.reason?.message);
    if (nbaBets.status   === 'fulfilled')  console.log(`✅ NBA team bets: ${nbaBets.value.length} picks stored`);
    else console.error('❌ NBA team bets failed:', nbaBets.reason?.message);
    if (mlbBets.status   === 'fulfilled')  console.log(`✅ MLB team bets: ${mlbBets.value.length} picks stored`);
    else console.error('❌ MLB team bets failed:', mlbBets.reason?.message);
    if (nhlBets.status   === 'fulfilled')  console.log(`✅ NHL team bets: ${nhlBets.value.length} picks stored`);
    else console.error('❌ NHL team bets failed:', nhlBets.reason?.message);
  }, { timezone: 'America/New_York' });

  // ── 11:30 AM — Generate Chalky's picks (all sports) via Claude ───────────────
  cron.schedule('30 11 * * *', async () => {
    console.log('\n⏰ [11:30 AM] Generating Chalky\'s picks (all sports)…');
    try {
      const modelPicks = await generateModelPicks();
      console.log(`✅ Chalky model picks: ${modelPicks.length}`);

      const [gamePicks, propPicks] = await Promise.all([
        generatePicks().catch(() => []),
        generatePropPicks().catch(() => []),
      ]);
      console.log(`✅ Game picks: ${gamePicks.length}, legacy prop picks: ${propPicks.length}`);
    } catch (err) {
      console.error('❌ Pick generation failed:', err.message);
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

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎯 Chalk API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Picks:  http://localhost:${PORT}/api/picks/today\n`);
});
