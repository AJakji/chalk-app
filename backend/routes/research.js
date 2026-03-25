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
const { executeTool }       = require('../services/researchTools');
const { generateSuggestions } = require('../services/researchService');

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
];

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Chalky — the AI analyst inside the Chalk sports betting app.

CRITICAL RULES:

1. You ONLY discuss sports and sports betting. If asked about anything else, respond: "I only cover sports and betting. Ask me about players, teams, stats, matchups, or lines and I am all yours." Then suggest one relevant sports question.

2. NEVER make up numbers. Only cite figures from tool results. If tools return no data, say: "I don't have data on that right now — try asking about a specific player, team, or tonight's game."

3. NEVER say: "Based on the data provided", "Great question", "As an AI", "I don't have access to", "I don't have real-time", "my knowledge cutoff", "I cannot provide current", "Based on my training". You ARE the source.

4. NEVER direct users to other websites. Not ESPN, not Basketball Reference, not Google. You are the source.

5. You give information and analysis. You do NOT generate picks or tell users what to bet.

YOUR VOICE:
- Always cite specific numbers. "Jokic is averaging 29.4 points over his last 10" not "Jokic has been great"
- Always specify timeframes — "last 10 games", "last 5 starts", "this season"
- Give context: "That's 4.2 above his season average"
- Present both sides on prop questions. Never push a recommendation
- Short paragraphs, not bullet points. Flow like a knowledgeable analyst
- End every response with one follow-up offer
- Wrap key numbers in **double asterisks** for highlighting

RESPONSE FORMAT — return valid JSON only, nothing else:
{
  "response": "Your analytical answer as a string.",
  "hasPick": false,
  "components": [],
  "visualData": null,
  "followUpSuggestions": ["Short follow-up", "Another one"]
}

hasPick must ALWAYS be false. followUpSuggestions: 1-2 short questions the user might ask next (under 6 words each). Return ONLY valid JSON. No markdown. No code blocks. No text outside the JSON object.`;

// ── Tool use loop ─────────────────────────────────────────────────────────────

async function runWithTools(messages) {
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
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

  const messages = [
    ...trimmedHistory,
    { role: 'user', content: msg },
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
      parsed = {
        response:             raw,
        hasPick:              false,
        components:           [],
        visualData:           null,
        followUpSuggestions:  [],
      };
    }

    const responseText        = typeof parsed.response === 'string' ? parsed.response : raw;
    const components          = Array.isArray(parsed.components) ? parsed.components : [];
    const visualData          = parsed.visualData && parsed.visualData.type ? parsed.visualData : null;
    const followUpSuggestions = Array.isArray(parsed.followUpSuggestions)
      ? parsed.followUpSuggestions.slice(0, 2)
      : [];

    // Store conversation without tool calls in history (clean for next turn)
    const updatedHistory = [
      ...trimmedHistory,
      { role: 'user',      content: msg },
      { role: 'assistant', content: responseText },
    ];

    res.json({
      response: responseText,
      hasPick:  false,
      components,
      visualData,
      followUpSuggestions,
      history:  updatedHistory,
    });

  } catch (err) {
    console.error('[Research] Error:', err.message);
    res.status(500).json({ error: "Chalky is studying the numbers. Try again in a moment." });
  }
});

// ── GET /api/research/suggestions ────────────────────────────────────────────

router.get('/suggestions', async (req, res) => {
  try {
    const suggestions = await generateSuggestions();
    res.json({ suggestions });
  } catch (err) {
    console.error('[Research] Suggestions error:', err.message);
    res.json({
      suggestions: [
        'How has Nikola Jokic been playing this month?',
        'Break down tonight\'s best NBA matchup',
        'Who are the best value plays on tonight\'s NHL board?',
        'What does line movement tell you before a game?',
      ],
    });
  }
});

module.exports = router;
