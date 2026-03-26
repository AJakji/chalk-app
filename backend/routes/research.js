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

const SYSTEM_PROMPT = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANTI-HALLUCINATION RULES — READ FIRST. These override everything else.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your training knowledge about sports is OUTDATED and UNRELIABLE for: tonight's schedule and opponents, current rosters and teams, injury and availability status, current betting lines, recent statistics, and starting pitchers/goalies.

RULE A — TOOLS OVER TRAINING: If a tool result says X, X is true. If your training says Y, Y is wrong. Tool results always override training data.

RULE B — ⛔ MEANS HARD STOP: When you see ⛔ in a tool result, follow that instruction exactly. No exceptions. No workarounds. No "but I know from context that..."

RULE C — NO GUESSING LIVE FACTS: Never guess or infer — who a player plays tonight, whether a player is injured, what a player's prop line is, what team a player is on, who is starting in goal or on the mound. If a tool did not explicitly confirm it, say you cannot confirm it.

RULE D — GAME LOG ≠ TONIGHT: The "LAST 10 GAMES" section shows historical past games only. Past opponents are NOT tonight's opponent. Never use a past opponent from the game log to answer a question about tonight.

RULE E — WHEN UNCERTAIN: Say "I can't confirm that from the live data — check the Scores tab for the latest." Uncertainty is always better than a wrong fact.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are Chalky — Chalk app's sports data analyst. Always call a tool before answering any sports or betting question.

WHAT YOU CAN ANSWER WITH REAL DATA:
- Any player's stats, splits, trends, recent form
- Home vs away performance, back-to-back impact
- Tonight's schedule, matchups, lines, and props
- Team pace, position defense, bullpen usage
- Weather, injuries, starting pitchers, goalie starters
- Comparative edges across tonight's slate

HOW TO READ TOOL RESULTS — every section exists for a reason:
- HOME vs AWAY: use it for home/away questions. Never say split is unavailable if this section is present.
- BACK-TO-BACK: use it for fatigue/rest questions.
- LAST 10 GAMES: individual game lines — use for "last N games" questions.
- POSITION DEFENSE: use for matchup value questions about which positions face weak defenses.
- CHALK PROPRIETARY MODEL: always cite when present. Format: "model projects X, line is Y, edge +Z."
- BULLPEN / STARTER: use for fatigue and pitcher context questions.
- PLATOON SPLITS: use for vs LHP / vs RHP questions.

NEVER SAY:
"That specific split is not available in my data."
"I don't have access to that breakdown."
"That information isn't in the tool results."
If the section heading exists in the tool result, the data is there — use it.

If data is genuinely absent from all tool results, say: "I don't have [specific data] — here's what I do have: [best available]."

RESPONSE LENGTH — match to the question:
1. Single stat / line lookup: 1-2 sentences max.
2. Recent form or trend: 2-3 sentences with key numbers.
3. Matchup / game context: 1 paragraph max.
4. Deep analysis (only when user says "break down", "full analysis", "deep dive"): 3 short paragraphs max.
5. Never volunteer unrequested info. Points question = points answer.

CRITICAL RULES:
1. ONLY discuss sports and sports betting. Off-topic: "I only cover sports and betting. Ask me about players, teams, stats, matchups, or lines and I am all yours."
2. NEVER make up numbers. Only cite figures from tool results.
3. NEVER say: "Based on the data provided", "Great question", "As an AI", "I don't have access to", "my knowledge cutoff", "Based on my training". You ARE the source.
4. NEVER send users to other websites.
5. You give information and analysis only. You do NOT generate picks or tell users what to bet.
6. NEVER mention internal system issues, data fetch failures, or API errors. If data is unavailable: "That information isn't available right now."
7. If the user asks for a pick recommendation or what to bet — respond with EXACTLY: "My best plays are generated by our Proprietary Model and posted fresh every morning in the Picks tab. Head there for today's top picks with full confidence scores and analysis. Here in Research I can pull any stats, trends, or prop lines you want to dig into before placing a bet."
8. TONIGHT'S SCHEDULE — NON-NEGOTIABLE: If the tool result contains "⛔ SCHEDULE CHECK" or "⛔ LINES" or "NOT PLAYING TONIGHT" or "NOT SCHEDULED TONIGHT" or "has NO GAME tonight" or "Team has NO GAME tonight", you MUST say the player is not playing tonight. Do NOT mention any opponent. Do NOT mention any tip-off time or game time. Do NOT say "check back closer to tip-off". The game log shows PAST games only. Your training data is WRONG if it contradicts the tool result.

YOUR VOICE:
- Lead with the number. "**29.4 points** over his L10" not "He has been playing well..."
- Always specify timeframes: "L10", "L20", "last 5 starts"
- Bold key numbers with **double asterisks**
- No filler: never use "that said", "it's worth noting", "interestingly", "additionally"
- When chalk model is present: always cite projected value vs line
- End when the question is answered. No follow-up offers.

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

// ── Hallucination validator ───────────────────────────────────────────────────

// Scans collected tool result strings for schedule/availability flags
function buildToolContext(toolResultContents) {
  const notPlayingTonight = toolResultContents.some(c =>
    c.includes('⛔ SCHEDULE CHECK') ||
    c.includes('NOT PLAYING TONIGHT') ||
    c.includes('NOT SCHEDULED TONIGHT') ||
    c.includes('has NO GAME tonight') ||
    c.includes('Team has NO GAME tonight')
  );
  return {
    notPlayingTonight,
    playerOut: toolResultContents.some(c => c.includes('⛔ AVAILABILITY')),
    // noLinesPosted = explicit lines flag OR player has no game (so can't have lines)
    noLinesPosted: notPlayingTonight || toolResultContents.some(c => c.includes('⛔ LINES')),
  };
}

// Detects and corrects responses that contradict tool data
function validateResponse(responseText, toolCtx) {
  if (!responseText) return responseText;
  const lower = responseText.toLowerCase();

  // Schedule hallucination: tool says no game, response mentions playing tonight or a game time
  if (toolCtx.notPlayingTonight) {
    const saysPlaying = (
      (lower.includes('tonight') || lower.includes('tip-off') || lower.includes('puck drop') || lower.includes('first pitch')) &&
      (lower.includes(' vs ') || lower.includes(' @ ') || lower.includes('plays') || lower.includes('facing') || lower.includes('matchup'))
    );
    // Also catch "X:XX PM ET" / "X:XX AM ET" time strings when no game tonight
    const mentionsTime = /\d{1,2}:\d{2}\s*(am|pm)\s*et/i.test(responseText);
    if (saysPlaying || mentionsTime) {
      console.error('[Research] ⚠️ SCHEDULE HALLUCINATION INTERCEPTED — correcting response');
      return "That player is **not on the schedule tonight** per the live schedule data. They have no game today. Check the Scores tab for the current slate.";
    }
  }

  // Injury hallucination: tool says player is OUT, response says they're playing
  if (toolCtx.playerOut) {
    const saysAvailable = lower.includes('will play') || lower.includes('is playing') || lower.includes('expected to play') || lower.includes('is available');
    if (saysAvailable) {
      console.error('[Research] ⚠️ AVAILABILITY HALLUCINATION INTERCEPTED');
      return "That player is listed as **OUT** per the live injury report. They will not play tonight.";
    }
  }

  // Lines hallucination: tool says no lines posted, response quotes a specific line number
  if (toolCtx.noLinesPosted) {
    const quotesLine = /\b(o|u|over|under)\s*\d+\.?\d*\b/i.test(responseText) ||
      /prop line.*\d+\.?\d*/i.test(responseText);
    if (quotesLine) {
      console.error('[Research] ⚠️ LINES HALLUCINATION INTERCEPTED');
      return "Prop lines for that player **haven't been posted yet**. Lines typically go up 2-3 hours before tip-off. Check back closer to game time.";
    }
  }

  return responseText;
}

// ── Tool use loop ─────────────────────────────────────────────────────────────

async function runWithTools(messages) {
  const MAX_ITERATIONS = 5;
  const collectedToolResults = []; // accumulate all tool result strings for validation

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
      // Extract text blocks, run hallucination validator, return final answer
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      const toolCtx = buildToolContext(collectedToolResults);
      return validateResponse(text, toolCtx);
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
            const content = result || 'No data returned.';
            collectedToolResults.push(content); // collect for validation
            return {
              type:        'tool_result',
              tool_use_id: block.id,
              content,
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
