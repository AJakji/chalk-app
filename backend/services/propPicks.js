// Chalk prop picks engine — powered by Claude + SportsData.io projections + The Odds API
// Flow: fetch today's games → fetch player projections → fetch prop lines → send to Claude → store

const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

const client = new Anthropic();

const PROP_SYSTEM_PROMPT = `You are Chalk's AI sports analyst specializing in player props.

Your job: compare player projection data against actual betting lines to find the biggest statistical edges.

Rules:
- Only pick props where your projection differs from the line by at least 10%.
- Confidence range: 65–88. Never inflate.
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
 * Generate player prop picks using SportsData.io projections + The Odds API prop lines.
 * Called daily at 10am alongside game picks generation.
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

  // Fetch player projections from SportsData.io
  const projections = await fetchProjections(today);

  const userContent = buildPromptContent(propLines, projections, today);
  console.log('📊 Sending prop data to Claude...');

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
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

  await storePropPicks(props);
  return props;
}

async function fetchPropLines() {
  try {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return [];

    // Fetch player props for NBA (extend to other leagues as needed)
    const sports = ['basketball_nba', 'icehockey_nhl', 'baseball_mlb'];
    const markets = ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_goals', 'player_shots_on_goal'];

    const allLines = [];
    for (const sport of sports) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=${markets.join(',')}&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,bet365`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const games = await res.json();
        allLines.push(...games.map(g => ({ ...g, sport })));
      } catch { /* continue */ }
    }
    return allLines;
  } catch (err) {
    console.warn('Failed to fetch prop lines:', err.message);
    return [];
  }
}

async function fetchProjections(date) {
  try {
    const apiKey = process.env.SPORTSDATA_NBA_KEY || process.env.SPORTSDATA_KEY;
    if (!apiKey) return {};

    const sdDate = date.replace(/-/g, '/');
    const res = await fetch(
      `https://api.sportsdata.io/v3/nba/projections/json/PlayerGameProjectionStatsByDate/${sdDate}?key=${apiKey}`
    );
    if (!res.ok) return {};
    const data = await res.json();

    // Index by player name for easy lookup
    const index = {};
    for (const p of data) {
      const name = `${p.FirstName} ${p.LastName}`;
      index[name] = {
        points: p.Points,
        rebounds: p.Rebounds,
        assists: p.Assists,
        threes: p.ThreePointersMade,
        steals: p.Steals,
        blocks: p.BlockedShots,
        minutes: p.Minutes,
        team: p.Team,
        position: p.Position,
      };
    }
    return index;
  } catch (err) {
    console.warn('Failed to fetch projections:', err.message);
    return {};
  }
}

function buildPromptContent(propLines, projections, today) {
  const projSummary = Object.keys(projections).length > 0
    ? `PLAYER PROJECTIONS FROM SPORTSDATA.IO (use exact numbers):\n${JSON.stringify(projections, null, 2)}\n\n---\n\n`
    : '';

  return `${projSummary}Today is ${today}. Here are today's player prop betting lines. Find the biggest edges where projections significantly differ from the actual lines. Generate 5-8 prop picks in Chalky's voice:\n\n${JSON.stringify(propLines, null, 2)}`;
}

async function storePropPicks(props) {
  for (const prop of props) {
    try {
      await db.query(
        `INSERT INTO picks
          (league, sport_key, pick_type, pick_category,
           player_name, player_team, player_position,
           away_team, home_team, game_time, game_id, matchup_text,
           pick_value, confidence, short_reason, analysis, odds_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (game_id, pick_type) DO NOTHING`,
        [
          prop.league,
          prop.sportKey,
          'Player Prop',
          'prop',
          prop.playerName,
          prop.playerTeam,
          prop.playerPosition,
          prop.awayTeam,
          prop.homeTeam,
          prop.gameTime,
          prop.gameId,
          prop.matchupText,
          prop.statLine,
          prop.confidence,
          prop.shortReason,
          JSON.stringify(prop.analysis),
          JSON.stringify(prop.odds),
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
