/**
 * /api/research — Chalky AI research assistant (tool use architecture)
 *
 * Claude decides which data tools to call based on the question.
 * No keyword matching. No silent failures. Real data or honest admission.
 *
 * POST /api/research/chat        — send a question, get a data-backed answer
 * GET  /api/research/suggestions — 4 dynamic question pills for tonight's slate
 */

const express   = require('express');
const router    = express.Router();
const Anthropic  = require('@anthropic-ai/sdk');
const { executeTool } = require('../services/researchTools');

const client = new Anthropic();

// ── Tool definitions (sent to Claude) ────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_nba_player_stats',
    description: 'Get NBA player season averages and recent game log from BallDontLie. Use for any question about an NBA player\'s stats, form, scoring, rebounds, assists, or recent performance.',
    input_schema: {
      type: 'object',
      properties: {
        player_name: {
          type: 'string',
          description: 'Player name or common nickname (e.g. "Jokic", "SGA", "LeBron")',
        },
      },
      required: ['player_name'],
    },
  },
  {
    name: 'get_prop_lines',
    description: 'Get live player prop betting lines from The Odds API. Use when asked about prop lines, over/unders, betting lines for a specific player, or what a player\'s props are tonight.',
    input_schema: {
      type: 'object',
      properties: {
        player_name: {
          type: 'string',
          description: 'Player name (e.g. "Jokic", "Connor McDavid")',
        },
        sport: {
          type: 'string',
          enum: ['NBA', 'NHL', 'MLB', 'NFL'],
          description: 'Sport league',
        },
      },
      required: ['player_name', 'sport'],
    },
  },
  {
    name: 'get_injury_status',
    description: 'Get injury report and playing status for a player. Use when asked if a player is playing tonight, their injury status, whether they are active, or availability for upcoming games.',
    input_schema: {
      type: 'object',
      properties: {
        player_name: {
          type: 'string',
          description: 'Player name (e.g. "Jokic", "McDavid")',
        },
        sport: {
          type: 'string',
          enum: ['NBA', 'NHL', 'MLB'],
          description: 'Sport league',
        },
      },
      required: ['player_name', 'sport'],
    },
  },
  {
    name: 'get_tonight_schedule',
    description: 'Get tonight\'s game schedule for a sport. Use when asked what games are on tonight, who is playing tonight, or the schedule for any league.',
    input_schema: {
      type: 'object',
      properties: {
        sport: {
          type: 'string',
          enum: ['NBA', 'NHL', 'MLB'],
          description: 'Sport league',
        },
      },
      required: ['sport'],
    },
  },
  {
    name: 'get_matchup_stats',
    description: 'Get odds and betting lines for a specific matchup between two teams. Use when asked about a specific game, spread, moneyline, total, or head-to-head matchup.',
    input_schema: {
      type: 'object',
      properties: {
        team1: {
          type: 'string',
          description: 'First team name or city (e.g. "Lakers", "Boston", "Nuggets")',
        },
        team2: {
          type: 'string',
          description: 'Second team name or city (e.g. "Celtics", "Denver")',
        },
        sport: {
          type: 'string',
          enum: ['NBA', 'NHL', 'MLB', 'NFL'],
          description: 'Sport league',
        },
      },
      required: ['team1', 'sport'],
    },
  },
  {
    name: 'get_weather',
    description: 'Get current weather at an MLB ballpark. Use when asked about weather impact on an MLB game, wind, temperature at a stadium, or outdoor conditions for baseball.',
    input_schema: {
      type: 'object',
      properties: {
        venue_name: {
          type: 'string',
          description: 'Stadium name (e.g. "Wrigley Field", "Fenway Park")',
        },
        team_name: {
          type: 'string',
          description: 'Team name if venue unknown (e.g. "Cubs", "Red Sox")',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_nhl_player_stats',
    description: 'Get NHL player stats and recent game log from the NHL API. Use for any question about an NHL player\'s goals, assists, points, or recent performance.',
    input_schema: {
      type: 'object',
      properties: {
        player_name: {
          type: 'string',
          description: 'Player name or nickname (e.g. "McDavid", "Pasta", "Ovechkin")',
        },
      },
      required: ['player_name'],
    },
  },
  {
    name: 'get_mlb_player_stats',
    description: 'Get MLB player season stats and recent performance from the MLB Stats API. Use for any question about a baseball player\'s batting average, ERA, home runs, strikeouts, or recent form.',
    input_schema: {
      type: 'object',
      properties: {
        player_name: {
          type: 'string',
          description: 'Player name or nickname (e.g. "Judge", "Ohtani", "Gerrit Cole")',
        },
      },
      required: ['player_name'],
    },
  },
  {
    name: 'get_comparative_stats',
    description: 'Get a ranked comparison of all players on tonight\'s slate for a specific stat. Use for questions like "who\'s the best scorer tonight", "which goalie has the best save percentage", "best value plays on the NBA slate", "who\'s running hot right now", or any question asking to compare multiple players.',
    input_schema: {
      type: 'object',
      properties: {
        sport: {
          type: 'string',
          enum: ['NBA', 'NHL', 'MLB'],
          description: 'Sport league',
        },
        stat_category: {
          type: 'string',
          description: 'Stat to compare. NBA: points, rebounds, assists, steals, blocks, 3pm, fg_pct. NHL skaters: goals, nhl_assists, sog. NHL goalies: sv_pct, gaa, saves. MLB: hits, era, strikeouts.',
        },
        scope: {
          type: 'string',
          enum: ['last_5', 'last_10', 'last_20'],
          description: 'Time window for the comparison',
        },
      },
      required: ['sport', 'stat_category'],
    },
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Chalky — Chalk app's sports data analyst. Answer exactly what was asked, nothing more.

RESPONSE LENGTH — match your answer to the question type:
1. Single stat / injury status / line lookup: 1-2 sentences maximum. No padding.
2. Recent form or trend question: 2-3 sentences with key numbers only.
3. Matchup or game context: 1 paragraph maximum.
4. Deep analysis — ONLY when user explicitly says "break down", "full analysis", "deep dive", or "walk me through": up to 3 paragraphs maximum. Never exceed this.
5. Never volunteer information the user did not ask for. If they asked about points, do not add rebounding context.

CRITICAL RULES:
1. ONLY discuss sports and sports betting. Off-topic: "I only cover sports and betting. Ask me about players, teams, stats, matchups, or lines and I am all yours."
2. NEVER make up numbers. Only cite figures from tool results.
3. NEVER say: "Based on the data provided", "Great question", "As an AI", "I don't have access to", "my knowledge cutoff", "Based on my training". You ARE the source.
4. NEVER send users to other websites.
5. You give information and analysis only. You do NOT generate picks or tell users what to bet.
6. NEVER mention internal system issues, wrong player matches, data fetch failures, API errors, or any technical problems. If data is unavailable: "That information isn't available right now."
7. If the user is asking for a pick recommendation, best bet, or what to wager on — respond with EXACTLY this, then offer a relevant research question: "My best plays are generated by our Proprietary Model and posted fresh every morning in the Picks tab. Head there for today's top picks with full confidence scores and analysis. Here in Research I can pull any stats, trends, or prop lines you want to dig into before placing a bet."
8. TONIGHT'S SCHEDULE — NON-NEGOTIABLE: If the tool result contains "⛔ SCHEDULE CHECK" or "NOT PLAYING TONIGHT" or "NOT SCHEDULED TONIGHT", you MUST say the player is not playing tonight. Do NOT mention any opponent. Do NOT say they play against any team. The game log shows PAST games only — do NOT confuse past opponents with tonight's game. Your own training data about this player's schedule is WRONG if it contradicts the tool result. The tool result is always correct.

YOUR VOICE:
- Lead with the number, not the setup. "**29.4 points** over his L10" not "He has been playing well, averaging..."
- Always specify timeframes: "L10", "L20", "last 5 starts"
- Bold key numbers and phrases with **double asterisks**
- No filler phrases: never use "that said", "it's worth noting", "interestingly", "it's important to mention", "additionally"
- When chalk model projections are available — cite the projected value vs the market line (e.g. "model projects **28.2**, line is **26.5**")
- End your response when the question is fully answered. Do not add follow-up offers or suggestions.

RESPONSE FORMAT — return valid JSON only, nothing else:
{
  "response": "Your answer as a string.",
  "hasPick": false,
  "components": [],
  "visualData": <see VISUAL DATA RULES below>
}

═══════════════════════════════════════
VISUAL DATA RULES — READ CAREFULLY
═══════════════════════════════════════

You MUST populate visualData every time you call a player stats tool or matchup tool.
Do NOT set it to null when you have player or game data. The app renders a visual card below your text.

────────────────────────────────────────
WHEN get_nba_player_stats / get_nhl_player_stats / get_mlb_player_stats was called:
────────────────────────────────────────

CASE A — question mentions "prop", "over", "under", "line", "bet", "hit", "last 10":
Use type "last10_grid". Extract each game from the LAST 10 GAMES section of the tool result.
Each line looks like: "2025-03-22 away DAL: 29pts 7reb 14ast FG 54% 35min +12"
Extract: date (MM/DD), opp (last word before colon), value (the stat they asked about).
Set overLine: true if value > propLine, false if value <= propLine.
If no propLine available use the L10 average as the reference.

{"type":"last10_grid","data":{
  "playerName":"Nikola Jokic","statLabel":"Points","propLine":26.5,
  "games":[
    {"date":"03/24","opp":"PHX","value":23,"overLine":false},
    {"date":"03/22","opp":"DAL","value":34,"overLine":true}
  ],
  "average":29.4,"overCount":7,"underCount":3
}}

CASE B — question mentions "trend", "streak", "run", "hot", "cold", "last X games", "lately":
Use type "trend_chart". Same game log extraction, but put oldest game first (reverse the list).

{"type":"trend_chart","data":{
  "playerName":"Nikola Jokic","statLabel":"Points","propLine":null,
  "dataPoints":[
    {"game":1,"value":24,"date":"03/05","opp":"LAL"},
    {"game":2,"value":31,"date":"03/07","opp":"GSW"}
  ],
  "seasonAvg":25.2,"l10Avg":29.4,"l5Avg":31.2
}}

CASE C — general player stats question (default):
Use type "stat_card".
For NBA: stats = PPG, RPG, APG, FG% all from L10.
For NHL skater: stats = G/g, A/g, PTS/g, SOG/g all from L10.
For NHL goalie: stats = SV%, GAA, Saves/g, Record all from L10.
For MLB hitter: stats = AVG, HR, RBI, OPS from season.
For MLB pitcher: stats = ERA, K, WHIP, W-L from season.
trend = "up" if L5 > L20 avg, "down" if L5 < L20 avg, else "neutral".

{"type":"stat_card","data":{
  "playerName":"Nikola Jokic","team":"DEN","sport":"NBA",
  "stats":[
    {"label":"PPG","value":"29.4","context":"L10"},
    {"label":"RPG","value":"13.1","context":"L10"},
    {"label":"APG","value":"9.2","context":"L10"},
    {"label":"FG%","value":"58.3%","context":"L10"}
  ],
  "trend":"up","trendLabel":"4.2 above L20 avg"
}}

────────────────────────────────────────
WHEN get_matchup_stats was called:
────────────────────────────────────────

If question is about game context / what to expect / is this a good game:
Use type "game_card". Extract spread, total, moneyline from the tool result.
keyStats = 3 bullet facts pulled from pace context and situation splits in the data.

{"type":"game_card","data":{
  "sport":"NBA","awayTeam":"DAL Mavericks","homeTeam":"DEN Nuggets",
  "gameTime":"10:00 PM ET","spread":"DEN -11.5","total":"O/U 244.5",
  "moneyline":"DEN -650 / DAL +470",
  "keyStats":["DEN 120.7 PPG last 30 days","DAL allows 123.0 PPG","DEN 3-0 in last 3 vs DAL"]
}}

If question compares teams or asks which team is better:
Use type "comparison_bar". Each stat needs awayTeam, homeTeam, awayValue (number), homeValue (number).

{"type":"comparison_bar","data":{
  "label":"DAL @ DEN — Tonight",
  "stats":[
    {"label":"Pts/Game","awayTeam":"DAL","homeTeam":"DEN","awayValue":111.2,"homeValue":120.7,"higherIsBetter":true},
    {"label":"Pts Allowed","awayTeam":"DAL","homeTeam":"DEN","awayValue":123.0,"homeValue":116.9,"higherIsBetter":false}
  ]
}}

────────────────────────────────────────
WHEN get_prop_lines was called (and no player stats tool was called):
────────────────────────────────────────

Use type "odds_table". Parse the DraftKings / FanDuel odds lines from the tool result.
best = the book with the better odds for each side (higher number = better).

{"type":"odds_table","data":{
  "title":"Jokic Points O/U 26.5",
  "rows":[
    {"label":"Over 26.5","dk":"-115","fd":"-112","best":"FanDuel"},
    {"label":"Under 26.5","dk":"-105","fd":"-108","best":"DraftKings"}
  ]
}}

────────────────────────────────────────
WHEN no relevant visual applies:
────────────────────────────────────────
Set visualData to null.

═══════════════════════════════════════

hasPick must ALWAYS be false. Return ONLY valid JSON. No markdown. No code blocks. No text outside the JSON object.`;

// ── Tool use loop ─────────────────────────────────────────────────────────────

async function runWithTools(messages) {
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 3500,
      system:     SYSTEM_PROMPT,
      tools:      TOOLS,
      messages,
    });

    console.log(`[Research] Iteration ${i + 1} stop_reason: ${response.stop_reason}`);

    if (response.stop_reason === 'end_turn') {
      // Extract text blocks and return final answer
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return text;
    }

    if (response.stop_reason === 'tool_use') {
      // Find all tool_use blocks and execute them in parallel
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      console.log(`[Research] Tools requested: ${toolUseBlocks.map(b => b.name).join(', ')}`);

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          try {
            const result = await executeTool(block.name, block.input);
            console.log(`[Research] Tool ${block.name} returned ${result?.length || 0} chars`);
            return {
              type:        'tool_result',
              tool_use_id: block.id,
              content:     result || 'No data returned.',
            };
          } catch (err) {
            console.error(`[Research] Tool ${block.name} error:`, err.message);
            return {
              type:        'tool_result',
              tool_use_id: block.id,
              content:     `Tool error: ${err.message}`,
            };
          }
        })
      );

      // Add assistant turn (with tool_use blocks) + tool results as user turn
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResults },
      ];
      continue;
    }

    // Unexpected stop reason — bail out
    console.warn(`[Research] Unexpected stop_reason: ${response.stop_reason}`);
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    return text || null;
  }

  // Exceeded max iterations
  console.warn('[Research] Max tool iterations reached');
  return null;
}

// ── Pick-question detection ───────────────────────────────────────────────────

const PICK_PHRASES = [
  'what should i bet', 'what is a good bet', 'what are your best plays',
  'what are the best plays', 'what do you like tonight', 'who should i bet on',
  'give me a pick', 'what are your picks', 'best value tonight',
  'what is worth betting', "chalky's pick", 'what would you bet',
  'best play tonight', 'best plays tonight', 'good bet tonight',
  'who should i take', 'what should i take', 'who do you like',
];

function isPickQuestion(msg) {
  const lower = msg.toLowerCase();
  return PICK_PHRASES.some(phrase => lower.includes(phrase));
}

// ── POST /api/research/chat ───────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }

  const msg = message.trim();

  // Keep last 10 exchanges (20 messages) from conversation history
  const trimmedHistory = history
    .slice(-20)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content);

  // If this looks like a pick question, append a redirect instruction to the user message
  const userContent = isPickQuestion(msg)
    ? `${msg}\n\n[SYSTEM NOTE: This is a pick recommendation request. Follow Critical Rule 7 exactly — redirect to the Picks tab, then offer a relevant research question based on what they were asking about.]`
    : msg;

  const messages = [
    ...trimmedHistory,
    { role: 'user', content: userContent },
  ];

  try {
    const raw = await runWithTools(messages);

    if (!raw) {
      return res.status(500).json({ error: "Chalky is studying the numbers. Try again in a moment." });
    }

    let parsed;
    try {
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // JSON parse failed — try to regex-extract the response field so raw JSON never leaks to UI
      const match = raw.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      const extracted = match
        ? match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t')
        : raw;
      parsed = {
        response:   extracted,
        hasPick:    false,
        components: [],
        visualData: null,
      };
    }

    const responseText = typeof parsed.response === 'string' && parsed.response.trim()
      ? parsed.response
      : raw;
    const components   = Array.isArray(parsed.components) ? parsed.components : [];
    const visualData   = parsed.visualData && parsed.visualData.type ? parsed.visualData : null;

    // Store conversation without tool calls in history (clean for next turn)
    const updatedHistory = [
      ...trimmedHistory,
      { role: 'user',      content: msg },
      { role: 'assistant', content: responseText },
    ];

    res.json({
      response:   responseText,
      hasPick:    false,
      components,
      visualData,
      history:    updatedHistory,
    });

  } catch (err) {
    console.error('[Research] Error:', err.message);
    res.status(500).json({ error: "Chalky is studying the numbers. Try again in a moment." });
  }
});


module.exports = router;
