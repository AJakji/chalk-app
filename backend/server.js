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

// Returns true if the given UTC Date is in US Daylight Saving Time.
// Works correctly on UTC servers (Railway) where getTimezoneOffset() always returns 0.
// Uses the IANA 'America/New_York' timezone to determine the correct offset.
function isDST(d) {
  try {
    // Format the date in ET — if the offset part shows -04:00 it's EDT (DST); -05:00 is EST
    const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
    return etStr.includes('EDT');
  } catch {
    // Fallback: DST runs second Sunday of March → first Sunday of November
    const year = d.getUTCFullYear();
    // Second Sunday of March (start of DST)
    const marchFirst = new Date(Date.UTC(year, 2, 1));
    const marchFirstDay = marchFirst.getUTCDay(); // 0=Sun
    const dstStart = new Date(Date.UTC(year, 2, (14 - marchFirstDay) % 7 + 1, 7)); // 2AM ET = 7AM UTC
    // First Sunday of November (end of DST)
    const novFirst = new Date(Date.UTC(year, 10, 1));
    const novFirstDay = novFirst.getUTCDay();
    const dstEnd = new Date(Date.UTC(year, 10, (7 - novFirstDay) % 7 + 1, 6)); // 2AM ET = 6AM UTC
    return d >= dstStart && d < dstEnd;
  }
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
// CRON SCHEDULE (all times Eastern / UTC) — picks live by 7:00 AM every morning:
//
//  MIDNIGHT — DATA COLLECTION:
//  12:00 AM / 04:00 UTC — data collectors + team logs (all sports, parallel)
//  12:30 AM / 04:30 UTC — computeDerivedStats.py (BABIP, ISO, TS%, usage rate)
//   1:00 AM / 05:00 UTC — computePositionDefense.py
//   1:15 AM / 05:15 UTC — MLB sub-collectors in parallel (bullpen/matchup/splits/umpire)
//
//  EARLY MORNING — ODDS + PROJECTIONS:
//   4:00 AM / 08:00 UTC — odds + early prop lines + roster + weather
//   4:30 AM / 08:30 UTC — NBA + MLB + NHL projection models (parallel)
//   5:30 AM / 09:30 UTC — edge detection (all sports: prop edges + team bets)
//   6:00 AM / 10:00 UTC — pick generation (all sports via Claude)
//   6:45 AM / 10:45 UTC — pre-delivery verification (zero picks = critical alert)
//   7:00 AM / 11:00 UTC — picks live + NHL goalie confirmation scheduling
//
//  MORNING — SAFETY NET:
//   9:15 AM / 13:15 UTC — re-fetch prop lines + props-only re-run + edges + prop picks
//  12:00 PM / 16:00 UTC — pick grader (grades yesterday's picks)
//
//  NHL SPECIAL: goalie confirmation jobs scheduled dynamically at 7:00 AM,
//               running 90 min before each puck drop.
//
//  WEEKLY (every Monday 2:00 AM ET / 6:00 UTC):
//  statcastCollector.py + computeLeagueAverages.py (parallel)
//
//  NOTE: mlbLineupFetcher.py exists but is NOT scheduled.
//  MLB picks are generated at 4:30 AM using lineup fallbacks.
//  Lineups post 10 AM–4 PM ET — after picks are already live at 7 AM.

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

if (true) { // crons always run in production — MOCK_MODE removed

  // ── 12:00 AM ET (4:00 UTC) — Nightly data collection (all sports, parallel) ──
  // Team log builders run in the same pass so derived stats have fresh team pace data.
  cron.schedule('0 0 * * *', async () => {
    console.log('\n⏰ [12:00 AM ET] Nightly data collection (NBA + MLB + NHL + arsenal + team logs)…');
    await Promise.allSettled([
      runPipeline('NBA Data Collector',   () => runPythonScript('nbaDataCollector.py')),
      runPipeline('MLB Data Collector',   () => runPythonScript('mlbDataCollector.py')),
      runPipeline('NHL Data Collector',   () => runPythonScript('nhlDataCollector.py')),
      runPipeline('MLB Pitcher Arsenal',  () => runPythonScript('mlbPitcherArsenalCollector.py')),
      runPipeline('NBA Team Data',        () => runPythonScript('populateTeamData.py')),
      runPipeline('NHL Team Data',        () => runPythonScript('nhlTeamCollector.py')),
    ]);
  }, { timezone: 'America/New_York' });

  // ── 12:30 AM ET (4:30 UTC) — Derived stats (BABIP, ISO, TS%, usage rate) ─────
  cron.schedule('30 0 * * *', async () => {
    console.log('\n⏰ [12:30 AM ET] Computing derived stats…');
    await runPipeline('Derived Stats', () => runPythonScript('computeDerivedStats.py'));
  }, { timezone: 'America/New_York' });

  // ── 1:00 AM ET (5:00 UTC) — Position defense ratings ─────────────────────────
  cron.schedule('0 1 * * *', async () => {
    console.log('\n⏰ [1:00 AM ET] Computing position defense ratings…');
    await runPipeline('Position Defense', () => runPythonScript('computePositionDefense.py'));
  }, { timezone: 'America/New_York' });

  // ── 1:15 AM ET (5:15 UTC) — MLB sub-collectors (all in parallel) ─────────────
  cron.schedule('15 1 * * *', async () => {
    console.log('\n⏰ [1:15 AM ET] MLB sub-collectors (bullpen + matchup + splits + umpire)…');
    await Promise.allSettled([
      runPipeline('MLB Bullpen Usage',    () => runPythonScript('mlbBullpenCollector.py')),
      runPipeline('MLB Matchup Collector',() => runPythonScript('mlbMatchupCollector.py')),
      runPipeline('MLB Splits Collector', () => runPythonScript('mlbSplitsCollector.py')),
      runPipeline('MLB Umpire Collector', () => runPythonScript('mlbUmpireCollector.py')),
    ]);
  }, { timezone: 'America/New_York' });

  // ── Every Monday 2:00 AM ET (6:00 UTC) — Weekly collectors ───────────────────
  // Statcast updates Baseball Savant data; league averages keep LEAGUE_AVG current.
  cron.schedule('0 2 * * 1', async () => {
    console.log('\n⏰ [Mon 2:00 AM ET] Weekly collectors (Statcast + league averages)…');
    await Promise.allSettled([
      runPipeline('Statcast Collector', () => runPythonScript('statcastCollector.py')),
      runPipeline('League Averages',    () => runPythonScript('computeLeagueAverages.py')),
    ]);
  }, { timezone: 'America/New_York' });

  // ── UFC: Tuesday 3:00 AM ET — Collect upcoming event + fighter data ───────────
  cron.schedule('0 3 * * 2', async () => {
    console.log('\n⏰ [Tue 3:00 AM ET] UFC data collector…');
    await runPipeline('UFC Data Collector', () => runPythonScript('ufcDataCollector.py'));
  }, { timezone: 'America/New_York' });

  // ── UFC: Tuesday 3:30 AM ET — Pull moneylines from Odds API ───────────────────
  cron.schedule('30 3 * * 2', async () => {
    console.log('\n⏰ [Tue 3:30 AM ET] UFC odds fetch…');
    await fetchAndStoreUFCOdds();
  }, { timezone: 'America/New_York' });

  // ── UFC: Tuesday 4:00 AM ET — Run projection model ────────────────────────────
  cron.schedule('0 4 * * 2', async () => {
    console.log('\n⏰ [Tue 4:00 AM ET] UFC projection model…');
    await runPipeline('UFC Projection Model', () => runPythonScript('ufcProjectionModel.py'));
  }, { timezone: 'America/New_York' });

  // ── UFC: Saturday 8:00 AM ET — Refresh odds before fight-day model run ─────────
  cron.schedule('0 8 * * 6', async () => {
    console.log('\n⏰ [Sat 8:00 AM ET] UFC fight-day odds refresh…');
    await fetchAndStoreUFCOdds();
  }, { timezone: 'America/New_York' });

  // ── UFC: Saturday 9:00 AM ET — Refresh model with fight-day odds ──────────────
  cron.schedule('0 9 * * 6', async () => {
    console.log('\n⏰ [Sat 9:00 AM ET] UFC fight-day model refresh…');
    await runPipeline('UFC Fight Day Model', () => runPythonScript('ufcProjectionModel.py'));
  }, { timezone: 'America/New_York' });

  // ── 4:00 AM ET (8:00 UTC) — Odds + ALL prop lines written to DB ──────────────
  // Game lines, player prop lines, venue weather and roster all collected here.
  // Player prop lines may be sparse at 4 AM; the 9:15 AM safety net re-fetches.
  cron.schedule('0 4 * * *', async () => {
    const today = getTodayET();
    console.log(`\n⏰ [4:00 AM ET] Odds + prop lines + roster + weather (${today})…`);

    await Promise.allSettled([
      runPipeline('Venue Weather',     () => fetchAllVenueWeather()),
      runPipeline('Nightly Roster',    () => buildNightlyRoster()),
      runPipeline('Odds / Game Lines', () => collectPropsLines()),
    ]);

    // Write player prop lines to DB (early attempt — sparse but worth capturing)
    const { writePropLinesToDB } = require('./services/oddsService');
    try {
      await writePropLinesToDB('NBA', today);
      await writePropLinesToDB('NHL', today);
      await writePropLinesToDB('MLB', today);
      console.log(`✅ [4:00 AM ET] Prop lines written for ${today}`);
    } catch (err) {
      console.error('[4:00 AM ET] writePropLinesToDB error:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 4:30 AM ET (8:30 UTC) — All three projection models (parallel) ────────────
  cron.schedule('30 4 * * *', async () => {
    console.log('\n⏰ [4:30 AM ET] Running NBA + MLB + NHL projection models (parallel)…');
    await Promise.allSettled([
      runPipeline('NBA Projection Model', () => runPythonScript('nbaProjectionModel.py')),
      runPipeline('MLB Projection Model', () => runPythonScript('mlbProjectionModel.py')),
      runPipeline('NHL Projection Model', () => runPythonScript('nhlProjectionModel.py')),
    ]);

    // Fail-loud check: if models wrote 0 rows the edge detector will find no edges.
    // Catch it here at 4:30 AM instead of at the 6:45 AM verification alert.
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
        console.error(`\n🚨 [4:30 AM ET] ALERT: chalk_projections has ZERO rows for ${today}`);
        console.error('  Possible causes:');
        console.error('  — BALLDONTLIE_API_KEY missing/invalid (NBA 401 → 0 players)');
        console.error('  — No games scheduled today');
        console.error('  — Market line gate blocking all writes');
        console.error('  Edge detection and aiPicks will produce zero picks unless resolved.');
      } else {
        console.log(`✅ [4:30 AM ET] chalk_projections: ${total} rows for ${today}`);
        rows.forEach(r => console.log(`   ${r.sport}: ${r.count} rows`));
        const missing = ['NBA', 'MLB', 'NHL'].filter(s => !bySport[s]);
        if (missing.length > 0) {
          console.warn(`⚠️  [4:30 AM ET] Missing projections for: ${missing.join(', ')} — check those model logs`);
        }
      }
    } catch (err) {
      console.error('[4:30 AM ET] Projection row count check failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 5:30 AM ET (9:30 UTC) — Edge detection (all sports) ──────────────────────
  cron.schedule('30 5 * * *', async () => {
    console.log('\n⏰ [5:30 AM ET] Edge detection — NBA + MLB + NHL…');
    await Promise.allSettled([
      runPipeline('NBA Prop Edges',  () => detectEdges()),
      runPipeline('MLB Prop Edges',  () => detectEdgesForSport('MLB')),
      runPipeline('NHL Prop Edges',  () => detectEdgesForSport('NHL')),
      runPipeline('NBA Team Bets',   () => detectTeamBetEdges('NBA')),
      runPipeline('MLB Team Bets',   () => detectTeamBetEdges('MLB')),
      runPipeline('NHL Team Bets',   () => detectTeamBetEdges('NHL')),
    ]);
  }, { timezone: 'America/New_York' });

  // ── 6:00 AM ET (10:00 UTC) — Generate Chalky's picks via Claude (all sports) ──
  // Must finish by 6:45 AM. Typically 20–30 min for a full slate.
  cron.schedule('0 6 * * *', async () => {
    const startTime = new Date().toISOString();
    console.log(`\n⏰ [6:00 AM ET] Generating Chalky's picks (all sports)…`);
    console.log(`🎯 aiPicks.js started: ${startTime}`);

    let totalCount = 0;

    await runPipeline('Chalky Model Picks', async () => {
      const modelPicks = await generateModelPicks();
      totalCount += modelPicks.length;
      console.log(`  Model picks: ${modelPicks.length}`);
    });

    await Promise.allSettled([
      runPipeline('Game Picks', async () => {
        const picks = await generatePicks();
        totalCount += picks.length;
        console.log(`  Game picks: ${picks.length}`);
      }),
      runPipeline('Prop Picks', async () => {
        const picks = await generatePropPicks();
        totalCount += picks.length;
        console.log(`  Prop picks: ${picks.length}`);
      }),
    ]);

    const endTime = new Date().toISOString();
    console.log(`🎯 aiPicks.js completed: ${endTime}`);
    console.log(`🎯 Total picks generated: ${totalCount}`);
  }, { timezone: 'America/New_York' });

  // ── 6:45 AM ET (10:45 UTC) — Pre-delivery verification ───────────────────────
  // Zero picks at this point = critical alert before users wake up.
  cron.schedule('45 6 * * *', async () => {
    console.log('\n⏰ [6:45 AM ET] Pre-delivery verification…');
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
        console.error(`  — Did 4:30 AM ET model run complete?`);
        console.error(`  — Did BDL API return games? (check BALLDONTLIE_API_KEY)`);
        console.error(`  — Did 5:30 AM ET edge detection find edges?`);
        console.error(`  — Did 6:00 AM ET aiPicks.js run without crash?`);
      } else {
        console.log(`✅ [6:45 AM ET] ${totalPicks} picks live for ${today}:`);
        rows.forEach(row => console.log(`   ${row.league}: ${row.count} picks`));
      }
    } catch (err) {
      console.error('🚨 [6:45 AM ET] Verification failed:', err.message);
    }
  }, { timezone: 'America/New_York' });

  // ── 7:00 AM ET (11:00 UTC) — Picks go live + NHL goalie confirmation ──────────
  // Picks are now available to users. Schedule per-game goalie confirmation jobs
  // (run 90 min before each puck drop) so starting goalies are confirmed before bets.
  cron.schedule('0 7 * * *', async () => {
    console.log('\n⏰ [7:00 AM ET] Picks live! Scheduling NHL goalie confirmations…');

    await runPipeline('NHL Goalie Scheduling', async () => {
      _goalieCheckJobs.forEach(j => j.stop());
      _goalieCheckJobs.length = 0;

      const schedule = await getConfirmationSchedule();
      for (const game of schedule) {
        const checkAt = game.checkTime;
        if (checkAt <= new Date()) continue; // already past
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

  // ── 9:15 AM ET (13:15 UTC) — Safety net: re-fetch prop lines + props-only re-run
  // Sportsbooks post most player prop lines by 9–10 AM ET. This pass re-fetches all
  // lines, re-runs projections against them, re-runs edge detection, and appends any
  // new player prop picks that weren't available at 6 AM.
  cron.schedule('15 9 * * *', async () => {
    const today = getTodayET();
    console.log(`\n⏰ [9:15 AM ET] Safety net — re-fetch prop lines + props-only re-run (${today})…`);

    // Step 1: refresh prop lines now that books have posted them
    const { writePropLinesToDB } = require('./services/oddsService');
    try {
      await writePropLinesToDB('NBA', today);
      await writePropLinesToDB('NHL', today);
      await writePropLinesToDB('MLB', today);
      console.log(`✅ [9:15 AM ET] Prop lines refreshed`);
    } catch (err) {
      console.error('[9:15 AM ET] writePropLinesToDB error:', err.message);
    }

    // Step 2: re-run projection models (props-only) against fresh lines
    await Promise.allSettled([
      runPipeline('NBA Props-Only Model', () => runPythonScript('nbaProjectionModel.py', ['--props-only'])),
      runPipeline('MLB Props-Only Model', () => runPythonScript('mlbProjectionModel.py', ['--props-only'])),
      runPipeline('NHL Props-Only Model', () => runPythonScript('nhlProjectionModel.py', ['--props-only'])),
    ]);

    // Step 3: re-run edge detection so new projections get confidence scores
    await Promise.allSettled([
      runPipeline('NBA Prop Edges (safety)', () => detectEdges()),
      runPipeline('MLB Prop Edges (safety)', () => detectEdgesForSport('MLB')),
      runPipeline('NHL Prop Edges (safety)', () => detectEdgesForSport('NHL')),
    ]);

    // Step 4: generate player prop picks from the newly-detected edges
    await runPipeline('Player Prop Picks (safety)', async () => {
      const picks = await generateModelPicks();
      console.log(`  Player prop picks added: ${picks.length}`);
    });
  }, { timezone: 'America/New_York' });

  // ── 12:00 PM ET (16:00 UTC) — Grade yesterday's picks ────────────────────────
  cron.schedule('0 12 * * *', async () => {
    console.log('\n⏰ [12:00 PM ET] Grading yesterday\'s picks…');
    await runPipeline('Pick Grader', async () => {
      const r = await gradeYesterdaysPicks();
      console.log(`  Grading complete: ${r.correctPicks}/${r.totalPicks} correct`);
    });
  }, { timezone: 'America/New_York' });

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
  const expectedSecret = process.env.ADMIN_SECRET || '2b75f035b9d815a3c97aa97cc7ac2f6ceb62810f68ec9e39';
  if (req.query.secret !== expectedSecret) {
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
  // recovery always runs in production

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

    // ── STEP 1: Immediate game picks (Odds API → Claude, no Python models needed) ──
    // These use live game-level lines (h2h/spreads/totals) available 24/7.
    // Runs first so users have picks within minutes of a restart, even at 1 AM.
    await runPipeline('Recovery: Game Picks (immediate)', async () => {
      const picks = await generatePicks();
      console.log(`  Recovery game picks: ${picks.length}`);
    });

    // ── STEP 2: Full model pipeline (runs in background, takes 30-60 min) ──────
    // Roster + prop lines → Python models → edge detection → Chalky prop picks
    // Scheduled crons will also fire at their normal times, so this is additive.
    runPipeline('Recovery: Nightly Roster',  () => buildNightlyRoster()).then(async () => {
      const { writePropLinesToDB } = require('./services/oddsService');
      await Promise.allSettled([
        writePropLinesToDB('NBA', today).catch(e => console.error('Recovery props NBA:', e.message)),
        writePropLinesToDB('NHL', today).catch(e => console.error('Recovery props NHL:', e.message)),
        writePropLinesToDB('MLB', today).catch(e => console.error('Recovery props MLB:', e.message)),
      ]);

      console.log('  Recovery: running projection models…');
      await Promise.allSettled([
        runPipeline('Recovery: NBA Model', () => runPythonScript('nbaProjectionModel.py')),
        runPipeline('Recovery: MLB Model', () => runPythonScript('mlbProjectionModel.py')),
        runPipeline('Recovery: NHL Model', () => runPythonScript('nhlProjectionModel.py')),
      ]);

      console.log('  Recovery: running edge detection…');
      await Promise.allSettled([
        runPipeline('Recovery: NBA Edges', () => detectEdges()),
        runPipeline('Recovery: MLB Edges', () => detectEdgesForSport('MLB')),
        runPipeline('Recovery: NHL Edges', () => detectEdgesForSport('NHL')),
        runPipeline('Recovery: NBA Teams', () => detectTeamBetEdges('NBA')),
        runPipeline('Recovery: MLB Teams', () => detectTeamBetEdges('MLB')),
        runPipeline('Recovery: NHL Teams', () => detectTeamBetEdges('NHL')),
      ]);

      console.log('  Recovery: generating model + prop picks…');
      await runPipeline('Recovery: Model Picks', async () => {
        const picks = await generateModelPicks();
        console.log(`  Recovery model picks: ${picks.length}`);
      });
      await runPipeline('Recovery: Prop Picks', async () => {
        const picks = await generatePropPicks();
        console.log(`  Recovery prop picks: ${picks.length}`);
      });

      console.log(`✅ Startup recovery (full pipeline) complete for ${today}`);
    }).catch(err => console.error('Recovery full pipeline error:', err.message));

    console.log(`✅ Startup recovery (game picks) launched for ${today}`);
  } catch (err) {
    console.error('Startup recovery failed:', err.message);
  }
}

// ── Admin: pipeline status ────────────────────────────────────────────────────
// GET /api/admin/status?secret=ADMIN_SECRET
// Shows exactly what data the pipeline has for today: projections, edges, picks by source.
app.get('/api/admin/status', async (req, res) => {
  const expectedSecret = process.env.ADMIN_SECRET || '2b75f035b9d815a3c97aa97cc7ac2f6ceb62810f68ec9e39';
  if (req.query.secret !== expectedSecret) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const today = new Date().toISOString().split('T')[0];

    // chalk_projections: how many rows per sport written by Python models
    const projRows = await db.query(`
      SELECT sport, prop_type, COUNT(*) as cnt
      FROM chalk_projections
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY sport, prop_type
      ORDER BY sport, prop_type
    `);

    // player_props_history edges written by edge detector
    const edgeRows = await db.query(`
      SELECT sport, prop_type, COUNT(*) as cnt,
             ROUND(AVG(chalk_edge)::numeric, 3) as avg_edge,
             ROUND(AVG(confidence)::numeric, 1) as avg_confidence
      FROM player_props_history
      WHERE date = $1
      GROUP BY sport, prop_type
      ORDER BY sport, prop_type
    `, [today]);

    // picks stored today, broken down by source
    const pickRows = await db.query(`
      SELECT pick_source, pick_category, league, COUNT(*) as cnt
      FROM picks
      WHERE pick_date = CURRENT_DATE
      GROUP BY pick_source, pick_category, league
      ORDER BY pick_source, league
    `);

    // all picks today with key fields for inspection
    const allPicks = await db.query(`
      SELECT id, league, pick_type, pick_category, pick_source,
             player_name, pick_value, confidence, proj_value, prop_line, chalk_edge,
             away_team, home_team, created_at
      FROM picks
      WHERE pick_date = CURRENT_DATE
      ORDER BY pick_source, confidence DESC
    `);

    res.json({
      date: today,
      projections: projRows.rows,
      edges: edgeRows.rows,
      pick_counts_by_source: pickRows.rows,
      picks: allPicks.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎯 Chalk API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Picks:  http://localhost:${PORT}/api/picks/today\n`);
  // Fire-and-forget: recover missed pipeline steps if server restarted after 4:30 AM
  setTimeout(() => recoverMissedPipeline().catch(e => console.error('Recovery error:', e.message)), 5000);
});
