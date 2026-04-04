// Chalk prop picks engine — powered by Claude + internal Chalk model projections + The Odds API
// Flow: fetch today's edges from DB → fetch prop lines → enrich with last-5 stats → send to Claude → store

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

const client = new Anthropic();

const PROP_SYSTEM_PROMPT = `You are Chalk's AI sports analyst specializing in player props.

Your job: compare player projection data against actual betting lines to find the biggest statistical edges.

Rules:
- Only pick props where your projection differs from the line by at least 10%.
- CRITICAL: Use the EXACT "confidence" value from the model data for each prop. Do NOT change it. Do NOT round up. The model has already calculated confidence — your job is to use it, not override it. If the model says 72, output 72. If the model says 65, output 65.
- Write in Chalky's voice: direct, confident, data-driven. Bloomberg meets sports bar.
- Generate 5–8 props across available players.

Respond with ONLY a JSON object in this EXACT format — no markdown, no text outside the JSON:

{
  "props": [
    {
      "league": "NBA",
      "sportKey": "basketball_nba",
      "playerName": "<full player name>",
      "playerTeam": "<team full name>",
      "playerPosition": "<PG|SG|SF|PF|C|QB|RB|WR|TE|P|C|LW|RW|D|G|F|MF>",
      "awayTeam": "<away team full name>",
      "homeTeam": "<home team full name>",
      "gameTime": "<e.g. 'Tonight 7:30 PM ET'>",
      "gameId": "<game id from odds data>",
      "statLine": "<e.g. 'Over 24.5 Points'>",
      "pick": "<same as statLine>",
      "direction": "over" | "under",
      "line": <number>,
      "chalkProjection": <number — Chalk model projection for this stat>,
      "chalkEdge": <number — difference between projection and line, signed (positive=over, negative=under)>,
      "statCategory": "<Points|Rebounds|Assists|Threes|Steals|Blocks|Goals|Assists|Shots|ERA|Strikeouts|Hits|RBI|HomeRuns>",
      "matchupText": "<e.g. 'vs BOS · Tonight 7:30 PM ET'>",
      "confidence": <integer 65–88>,
      "shortReason": "<one punchy sentence max 12 words, no period>",
      "analysis": {
        "summary": "<2-3 sentence overview in Chalky's voice>",
        "sections": [
          { "title": "Why This Prop", "icon": "🎯", "content": "<2-3 sentences of core reasoning>" },
          { "title": "Line Value",    "icon": "💰", "content": "<why the line represents value>" },
          { "title": "Key Risk",      "icon": "⚠️", "content": "<honest risk factor>" }
        ],
        "keyStats": [
          { "label": "<e.g. 'Last 5 Games Avg'>", "value": "<e.g. '26.4 PTS'>", "pct": <integer 0-100> },
          { "label": "Hit Rate (L10)", "value": "<e.g. '8/10'>", "pct": <integer 0-100> },
          { "label": "Model Confidence", "value": "<confidence>%", "pct": <same as confidence> }
        ],
        "trends": [
          "<short trend bullet>",
          "<short trend bullet>",
          "<short trend bullet>"
        ],
        "last10Games": [
          { "date": "<e.g. 'Mar 20'>", "opp": "<3-letter abbr>", "result": "W"|"L", "stat": <number> }
        ],
        "seasonAvg": <number>,
        "propLine": <number>,
        "homeAvg": <number>,
        "awayAvg": <number>,
        "vsOppHistory": <number>,
        "injuryStatus": "<Active|Questionable (desc)|Out>"
      },
      "odds": {
        "draftkings": "<american odds or 'N/A'>",
        "fanduel":    "<american odds or 'N/A'>",
        "betmgm":     "<american odds or 'N/A'>",
        "bet365":     "<american odds or 'N/A'>"
      },
      "bestBook": "<key of best book for bettor>",
      "bestOdds": "<best odds value>"
    }
  ]
}`;

/**
 * Generate player prop picks using Chalk internal model projections + The Odds API prop lines.
 * Called daily at 10:30am after edgeDetector.detectEdges() populates player_props_history.
 */
async function generatePropPicks() {
  const today = new Date().toISOString().split('T')[0];
  console.log('🎯 Generating prop picks for', today);

  // Fetch prop lines from The Odds API (player_props markets)
  const propLines = await fetchPropLines();
  if (!propLines || propLines.length === 0) {
    console.log('No prop lines available today — skipping prop generation');
    return [];
  }

  // Build a lookup: Odds API game ID → UTC ISO commence_time, for storage later
  const gameTimeMap = {};
  for (const g of propLines) {
    if (g.id && g.commence_time) gameTimeMap[g.id] = g.commence_time;
  }

  // Fetch player projections from our internal Chalk model (player_props_history + chalk_projections)
  const projections = await fetchProjections(today);

  const userContent = buildPromptContent(propLines, projections, today);
  console.log('📊 Sending prop data to Claude...');

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: PROP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    console.error(`[generatePropPicks] Claude API error: ${err.status || ''} ${err.message}`);
    console.error('  Prop picks generation skipped — Claude unavailable.');
    return [];
  }

  const raw = message?.content?.[0]?.text;
  if (!raw) {
    console.error('[generatePropPicks] Claude returned empty content — no prop picks generated');
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try { parsed = JSON.parse(match[1]); } catch {
        console.error('[generatePropPicks] Failed to parse Claude code-fenced JSON');
        console.error('  Raw response (first 500 chars):', raw.slice(0, 500));
        return [];
      }
    } else {
      console.error('[generatePropPicks] Claude returned unparseable prop output');
      console.error('  Raw response (first 500 chars):', raw.slice(0, 500));
      return [];
    }
  }

  const props = parsed.props ?? [];
  console.log(`✅ Claude generated ${props.length} prop picks`);

  await storePropPicks(props, gameTimeMap);
  return props;
}

// Player props require the event-specific endpoint — the /odds/ endpoint doesn't support them
async function fetchPropLines() {
  try {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return [];

    const SPORT_MARKETS = {
      basketball_nba: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_points_rebounds,player_points_assists',
      icehockey_nhl:  'player_goals,player_assists,player_points,player_shots_on_goal',
      baseball_mlb:   'batter_hits,batter_total_bases,batter_home_runs,batter_rbis,pitcher_strikeouts,pitcher_earned_runs',
    };

    const allLines = [];

    for (const [sport, markets] of Object.entries(SPORT_MARKETS)) {
      try {
        // Step 1: get today's events
        const eventsRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${apiKey}`);
        if (!eventsRes.ok) continue;
        const events = await eventsRes.json();
        if (!Array.isArray(events) || events.length === 0) continue;

        // Step 2: fetch event-specific prop odds for each game
        for (const event of events) {
          try {
            const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,bet365`;
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            allLines.push({ ...data, sport, id: event.id });
          } catch { /* continue to next event */ }
        }
      } catch { /* continue to next sport */ }
    }

    console.log(`[fetchPropLines] Fetched prop lines for ${allLines.length} games`);
    return allLines;
  } catch (err) {
    console.warn('Failed to fetch prop lines:', err.message);
    return [];
  }
}

async function fetchProjections(date) {
  try {
    // Read today's scored edges from player_props_history (populated by edgeDetector)
    // joined with chalk_projections for game context and factors
    const { rows } = await db.query(
      `SELECT
         pph.player_id, pph.player_name, pph.team, pph.sport, pph.prop_type,
         pph.chalk_projection, pph.prop_line, pph.chalk_edge, pph.confidence,
         pph.dk_odds, pph.fd_odds, pph.mgm_odds, pph.bet365_odds,
         cp.opponent, cp.home_away, cp.position, cp.factors_json,
         nr.injury_status
       FROM player_props_history pph
       LEFT JOIN chalk_projections cp
         ON cp.player_id = pph.player_id
         AND cp.game_date = pph.game_date
         AND cp.prop_type = pph.prop_type
       LEFT JOIN nightly_roster nr
         ON nr.player_id = pph.player_id
         AND nr.game_date = pph.game_date
         AND nr.sport = pph.sport
       WHERE pph.game_date = $1
         AND pph.chalk_edge IS NOT NULL
         AND pph.confidence >= 62
       ORDER BY pph.confidence DESC, ABS(pph.chalk_edge) DESC
       LIMIT 80`,
      [date]
    );

    if (rows.length === 0) {
      console.log('  No edges in DB yet — edgeDetector may not have run');
      return {};
    }

    // Enrich top players with last-5 game logs from player_game_logs
    const uniqueIds = [...new Set(rows.map(r => r.player_id).filter(Boolean))].slice(0, 30);
    const recentStats = {};
    for (const pid of uniqueIds) {
      try {
        const sport = rows.find(r => r.player_id === pid)?.sport || 'NBA';
        const statCols = sport === 'NHL'
          ? 'game_date, opponent, points AS goals, three_made AS assists, fg_made AS sog, plus_minus, minutes AS toi'
          : sport === 'MLB'
          ? 'game_date, opponent, fg_made AS hits, three_made AS hr, rebounds AS rbi, assists AS pitcher_k, minutes AS ip'
          : 'game_date, opponent, points, rebounds, assists, three_made, steals, blocks, minutes';
        const { rows: statRows } = await db.query(
          `SELECT ${statCols}
           FROM player_game_logs
           WHERE player_id = $1 AND sport = $2 AND minutes >= 5
           ORDER BY game_date DESC LIMIT 5`,
          [pid, sport]
        );
        if (statRows.length) {
          const name = rows.find(r => r.player_id === pid)?.player_name;
          if (name) recentStats[name] = statRows;
        }
      } catch {}
    }

    // Build index: player_name → { team, sport, props: { propType → {...} }, last5, injuryStatus }
    const index = {};
    for (const row of rows) {
      if (!index[row.player_name]) {
        index[row.player_name] = {
          team:         row.team,
          sport:        row.sport,
          opponent:     row.opponent,
          homeAway:     row.home_away,
          position:     row.position,
          injuryStatus: row.injury_status || 'Active',
          props:        {},
          last5:        recentStats[row.player_name] || [],
        };
      }
      index[row.player_name].props[row.prop_type] = {
        projection: parseFloat(row.chalk_projection),
        line:       parseFloat(row.prop_line),
        edge:       parseFloat(row.chalk_edge),
        direction:  row.chalk_edge > 0 ? 'over' : 'under',
        confidence: row.confidence,
        odds: {
          draftkings: row.dk_odds    || 'N/A',
          fanduel:    row.fd_odds    || 'N/A',
          betmgm:     row.mgm_odds   || 'N/A',
          bet365:     row.bet365_odds || 'N/A',
        },
      };
    }

    console.log(`  Loaded ${Object.keys(index).length} players from Chalk model (${rows.length} prop rows)`);
    return index;
  } catch (err) {
    console.warn('Failed to fetch internal projections:', err.message);
    return {};
  }
}

function slimPropLines(propLines) {
  // Reduce raw Odds API response to only what Claude needs.
  // Raw payload is ~500KB+ (38 games × all bookmakers × all markets × outcomes).
  // Slim version is ~20KB — game ID, teams, player, market, line, odds per book.
  const slim = [];
  for (const game of propLines) {
    const gameEntry = {
      id:        game.id,
      sport:     game.sport,
      home_team: game.home_team,
      away_team: game.away_team,
      commence:  game.commence_time,
      players:   [],
    };

    // Flatten bookmaker → market → outcome into per-player rows
    const playerMap = {};
    for (const bm of (game.bookmakers || [])) {
      for (const market of (bm.markets || [])) {
        for (const outcome of (market.outcomes || [])) {
          const key = `${outcome.description}::${market.key}`;
          if (!playerMap[key]) {
            playerMap[key] = {
              player: outcome.description,
              market: market.key,
              line:   outcome.point ?? null,
              odds:   {},
            };
          }
          // Store over odds per book (under is derivable)
          if (outcome.name === 'Over') {
            playerMap[key].odds[bm.key] = outcome.price;
          }
        }
      }
    }

    gameEntry.players = Object.values(playerMap);
    if (gameEntry.players.length > 0) slim.push(gameEntry);
  }
  return slim;
}

function buildPromptContent(propLines, projections, today) {
  const hasProj = Object.keys(projections).length > 0;
  if (!hasProj) {
    return `NOTE: No internal model projections available. Cannot generate prop picks today.`;
  }
  // The edge detector already captured lines + odds in player_props_history.
  // Sending the full Odds API payload to Claude caused connection errors (payload too large).
  // Everything Claude needs — projection, line, edge, confidence, odds, last-5 stats — is
  // already in the projections object built from player_props_history.
  return `Today is ${today}. Below is the Chalk internal model data for today's player props. Each player entry includes our projection, the sportsbook line, the edge, confidence, bookmaker odds, and last-5 game logs. Find the 5–8 biggest statistical edges and generate prop picks in Chalky's voice:\n\n${JSON.stringify(projections, null, 2)}`;
}

async function storePropPicks(props, gameTimeMap = {}) {
  for (const prop of props) {
    try {
      // Fill safe defaults for fields Claude sometimes omits
      const pickValue = prop.statLine || prop.pick || prop.playerName || 'Pick';
      if (!prop.gameId) {
        const playerSlug = (prop.playerName || 'player').replace(/\s+/g, '_').toLowerCase();
        const today = new Date().toISOString().split('T')[0];
        prop.gameId = `prop_${playerSlug}_${today}`;
      }
      if (!prop.shortReason) prop.shortReason = pickValue;
      if (!prop.confidence)  prop.confidence  = 65;
      if (!prop.awayTeam)    prop.awayTeam    = prop.homeTeam || 'TBD';
      if (!prop.homeTeam)    prop.homeTeam    = prop.awayTeam || 'TBD';
      // Prefer UTC ISO from the lookup map; fall back to Claude's formatted string
      if (!prop.gameTime)    prop.gameTime    = 'Tonight';
      const gameTimeValue = gameTimeMap[prop.gameId] || prop.gameTime;
      if (!prop.league)      prop.league      = 'NBA';
      if (!prop.sportKey)    prop.sportKey    = 'basketball_nba';

      // Skip if we still can't produce pick_value — would violate NOT NULL
      if (!pickValue || !prop.playerName) {
        console.error(`[storePropPicks] Skipping prop — missing playerName or statLine`);
        continue;
      }

      // Dedup: skip if this player already has a pick today with the same stat line.
      // Model picks include the player name in pick_value ("Jokic Under 34.5 Points"),
      // prop picks don't ("Under 34.5 Points") — normalize by stripping player name.
      const normalizedPickVal = pickValue.replace(new RegExp(prop.playerName + '\\s*', 'i'), '').trim();
      const { rows: existing } = await db.query(
        `SELECT id FROM picks
         WHERE player_name = $1
           AND (pick_value ILIKE $2 OR pick_value ILIKE $3)
           AND DATE(created_at AT TIME ZONE 'America/New_York') = CURRENT_DATE AT TIME ZONE 'America/New_York'`,
        [prop.playerName, pickValue, `%${normalizedPickVal}`]
      );
      if (existing.length > 0) {
        console.log(`  SKIP (duplicate): ${prop.playerName} ${pickValue}`);
        continue;
      }

      await db.query(
        `INSERT INTO picks
          (league, sport_key, pick_type, pick_category,
           player_name, player_team, player_position,
           away_team, home_team, game_time, game_id, matchup_text,
           pick_value, confidence, short_reason, analysis, odds_data, pick_source,
           proj_value, prop_line, chalk_edge)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (game_id, pick_type, COALESCE(player_name, '')) DO NOTHING`,
        [
          prop.league,
          prop.sportKey,
          'Prop',
          'prop',
          prop.playerName,
          prop.playerTeam,
          prop.playerPosition,
          prop.awayTeam,
          prop.homeTeam,
          gameTimeValue,
          prop.gameId,
          prop.matchupText,
          pickValue,
          prop.confidence,
          prop.shortReason,
          JSON.stringify(prop.analysis || {}),
          JSON.stringify(prop.odds || {}),
          'ai_prop',
          prop.chalkProjection != null ? parseFloat(prop.chalkProjection) : null,
          prop.line            != null ? parseFloat(prop.line)            : null,
          prop.chalkEdge       != null ? parseFloat(prop.chalkEdge)       : null,
        ]
      );
    } catch (err) {
      console.error(`Failed to store prop pick for ${prop.playerName}:`, err.message);
    }
  }
}

async function getTodaysPropPicks() {
  const { rows } = await db.query(
    `SELECT * FROM picks
     WHERE pick_date = CURRENT_DATE AND pick_category = 'prop'
     ORDER BY confidence DESC`
  );
  return rows;
}

module.exports = { generatePropPicks, getTodaysPropPicks };
