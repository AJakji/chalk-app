// Chalk AI picks engine — powered by Claude
// Fetches today's odds, sends to Claude, returns structured picks

const Anthropic = require('@anthropic-ai/sdk');
const { fetchAllOdds } = require('./odds');
const db = require('../db');

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Chalk's AI sports analyst. Your job is to analyze betting odds data and identify the strongest picks for today.

Your picks must be:
- Data-driven. Base every pick on odds movement, line value, and statistical context you know.
- Selective. Only recommend games where you have genuine edge. Skip games with no clear value.
- Honest about confidence. Use 65–92 as your range. Never inflate.

You will receive a JSON array of today's games with odds from DraftKings, FanDuel, BetMGM, and Bet365.

Respond with a JSON object in this EXACT format — no markdown, no text outside the JSON:

{
  "picks": [
    {
      "league": "NBA",
      "gameId": "<game id from input>",
      "sportKey": "<sport key from input>",
      "awayTeam": "<away team full name>",
      "homeTeam": "<home team full name>",
      "gameTime": "<e.g. 'Tonight 7:30 PM ET' or 'Sunday 1:00 PM ET'>",
      "pickType": "Spread" | "Total" | "Moneyline",
      "pick": "<e.g. 'Celtics -4.5' or 'Over 224.5' or 'Nuggets ML'>",
      "confidence": <integer 65–92>,
      "shortReason": "<one punchy sentence, max 12 words, no period>",
      "analysis": {
        "summary": "<2-3 sentence overview of why this is a strong pick>",
        "sections": [
          { "title": "Why This Pick", "icon": "🎯", "content": "<2-3 sentences of core reasoning>" },
          { "title": "Line Value",    "icon": "💰", "content": "<why the odds represent value>" },
          { "title": "Key Risk",      "icon": "⚠️", "content": "<honest risk factor to watch>" }
        ],
        "keyStats": [
          { "label": "<stat name, e.g. 'Home ATS Record'>", "value": "<e.g. '14-4'>", "pct": <integer 0-100 for bar visualisation> },
          { "label": "<stat name>", "value": "<value>", "pct": <integer 0-100> },
          { "label": "Model Confidence", "value": "<confidence>%", "pct": <same as confidence integer> }
        ],
        "trends": [
          "<short trend bullet e.g. 'BOS 14-3 ATS at home this season'>",
          "<short trend bullet>",
          "<short trend bullet>"
        ]
      },
      "odds": {
        "draftkings": "<american odds or 'N/A' if not available>",
        "fanduel":    "<american odds or 'N/A'>",
        "betmgm":     "<american odds or 'N/A'>",
        "bet365":     "<american odds or 'N/A'>"
      },
      "bestBook": "<key of the book with best odds for bettor, e.g. 'fanduel'>",
      "bestOdds": "<the best odds value, e.g. '-108'>"
    }
  ]
}

Generate between 2 and 5 picks. Quality over quantity.`;

async function generatePicks() {
  console.log('🤖 Fetching odds from The Odds API...');
  const games = await fetchAllOdds();

  if (games.length === 0) {
    console.log('No games found across any league today.');
    return [];
  }

  console.log(`📊 Found ${games.length} games. Sending to Claude...`);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here are today's games and odds. Generate your picks:\n\n${JSON.stringify(games, null, 2)}`,
      },
    ],
  });

  const raw = message.content[0].text;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Claude sometimes wraps JSON in a code block — strip it
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      parsed = JSON.parse(match[1]);
    } else {
      throw new Error('Claude returned unparseable output: ' + raw.slice(0, 200));
    }
  }

  const picks = parsed.picks ?? [];
  console.log(`✅ Claude generated ${picks.length} picks`);

  await storePicks(picks);
  return picks;
}

// Save picks to the database, skipping duplicates (same game + pick type today)
async function storePicks(picks) {
  for (const pick of picks) {
    try {
      await db.query(
        `INSERT INTO picks
          (league, sport_key, pick_type, away_team, home_team, game_time, game_id,
           pick_value, confidence, short_reason, analysis, odds_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (game_id, pick_type) DO NOTHING`,
        [
          pick.league,
          pick.sportKey,
          pick.pickType,
          pick.awayTeam,
          pick.homeTeam,
          pick.gameTime,
          pick.gameId,
          pick.pick,
          pick.confidence,
          pick.shortReason,
          JSON.stringify(pick.analysis),   // full object: { summary, sections, keyStats, trends }
          JSON.stringify(pick.odds),
        ]
      );
    } catch (err) {
      console.error(`Failed to store pick for ${pick.awayTeam} @ ${pick.homeTeam}:`, err.message);
    }
  }
}

// Fetch today's picks from the database (used by the /picks/today route)
async function getTodaysPicks() {
  const { rows } = await db.query(
    `SELECT * FROM picks
     WHERE pick_date = CURRENT_DATE
     ORDER BY confidence DESC`
  );
  return rows;
}

module.exports = { generatePicks, getTodaysPicks };
