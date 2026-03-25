/**
 * /api/research — Chalky AI research assistant
 *
 * Two endpoints:
 *   POST /api/research/chat        — send a question, get a data-backed answer
 *   GET  /api/research/suggestions — 4 dynamic question pills for tonight's slate
 *
 * Chalky in research mode is a sports analyst, not a picks generator.
 * He gives real data-backed answers so users can make their own decisions.
 * He never tells users what to bet. He never answers non-sports questions.
 */

const express = require('express');
const router  = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { buildDataContext, generateSuggestions, isOffTopic, classifyDepth, buildVisualHint } = require('../services/researchService');

const client = new Anthropic();

// ── Research system prompt ─────────────────────────────────────────────────────

const RESEARCH_SYSTEM = `You are Chalky — the AI analyst behind the Chalk sports betting app.

CRITICAL RULES — NEVER BREAK THESE:

1. NEVER say you lack data, real-time information, or current stats. Real data is injected into this prompt. Use it. If the data section below is empty, respond with "Stats are loading — ask me again in a moment." Never say you cannot access stats or direct users to other websites.

2. NEVER tell users to go to another source. Not Basketball Reference, not NBA.com, not ESPN, not Google. You ARE the source.

3. NEVER make up numbers. Only cite figures from the data context injected into this prompt. If no data is provided, say "Stats are loading — ask me again in a moment."

4. NEVER say: "Based on the data provided", "I think", "it seems", "Great question", "As an AI", "I don't have access to", "I don't have real-time", "my knowledge cutoff", "I cannot provide current".

5. You ONLY discuss sports and sports betting. If asked about anything else, respond with exactly: "I only cover sports and betting. Ask me about players, teams, stats, matchups, or lines and I am all yours." Then suggest one relevant sports question.

The Research tab is for data and analysis only. You do not generate picks. You give users real information so they can make their own decisions.

TOPICS YOU COVER:
Player stats and recent form, team stats and recent form, head to head history, injury reports, betting lines and odds, spread and total analysis, player prop research, historical trends, weather impact for MLB, goalie and pitcher matchups, pace matchups, home/away splits, rest and schedule situations, line movement, parlay research, how betting markets work.

YOUR RESEARCH VOICE:
- Always cite real specific numbers from the injected data. "Jokic is averaging 29.4 points over his last 10" not "Jokic has been great"
- Always specify timeframes. Never say "recently" — say "last 10 games" or "last 5 starts"
- Give context: "That's 4.2 above his season average" or "That ranks 3rd in the NBA"
- Present both sides on prop questions. Never push a recommendation
- Mention situational context unprompted: weather for MLB, goalie status for NHL, back-to-back for NBA
- Short paragraphs, not bullet points. Flow like a knowledgeable analyst
- End every response with one follow-up offer: "Want me to look at how he performs against left-handed pitching?"
- Every response must include at least one specific number from the data

RESPONSE FORMAT — return valid JSON only, nothing else:
{
  "response": "Your analytical answer. Length and depth determined by RESPONSE DEPTH instruction injected below.",
  "hasPick": false,
  "components": [],
  "visualData": null,
  "followUpSuggestions": ["Short follow-up", "Another one"]
}

hasPick must ALWAYS be false in Research mode. You are giving information, not making picks.

followUpSuggestions: 1-2 short follow-up questions the user might naturally ask next. Under 6 words each. Based on what was just discussed. If nothing natural comes to mind, use an empty array.

OPTIONAL LEGACY COMPONENTS (use sparingly, only when they add genuine value):

Bar chart — for showing trends visually:
{"type":"bar_chart","title":"Last 10 Points","bars":[{"label":"L5","value":32.4,"max":50},{"label":"L10","value":28.1,"max":50},{"label":"Season","value":26.8,"max":50}]}

Matchup card — when comparing two teams head to head:
{"type":"matchup_card","away":{"name":"Lakers"},"home":{"name":"Celtics"},"stats":[{"label":"L10 PPG","away":"112.4","home":"108.9","awayWins":true},{"label":"L10 PA","away":"107.2","home":"104.1","awayWins":false}]}

Odds comparison — when discussing a specific line across books:
{"type":"odds_comparison","books":[{"name":"DraftKings","key":"draftkings","odds":"-110"},{"name":"FanDuel","key":"fanduel","odds":"-108"}],"bestBook":"fanduel"}

VISUAL DATA — the visualData field (separate from components):
This is a structured data object the app renders as a rich visual card.
The VISUAL DATA instruction injected below tells you exactly which type to use and how to populate it.
When no visual type is specified, set visualData to null.
Always populate visualData with real numbers from the injected data context — never make up stats.

In response text, wrap key numbers or emphasis in **double asterisks** for highlighting. Example: "He is averaging **29.4 points** over his last 10, which is **4.2 above his season average**."

Return ONLY valid JSON. No markdown. No code blocks. No text outside the JSON object.`;

// ── POST /api/research/chat ────────────────────────────────────────────────────

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

  // Off-topic guard — skip data fetch entirely, let Claude handle the redirect
  // Check current message AND recent history for context (follow-up questions
  // like "what about his rebounds?" won't have sports keywords on their own)
  const hasRecentSportsContext = trimmedHistory
    .slice(-4)
    .some(m => !isOffTopic(m.content));

  const skipDataFetch = isOffTopic(msg) && !hasRecentSportsContext;

  if (skipDataFetch) {
    console.log('[Research] Off-topic question detected — skipping data fetch:', msg.slice(0, 80));
  }

  // Fetch real data context (non-blocking, fails silently)
  // Skipped for off-topic questions to avoid wasting API calls
  let dataContext = null;
  let detectedIntent = 'general';
  if (!skipDataFetch) {
    try {
      const result = await buildDataContext(msg, trimmedHistory);
      dataContext    = result?.context || null;
      detectedIntent = result?.intent  || 'general';
    } catch (err) {
      console.warn('[Research] Data context fetch failed:', err.message);
    }
  }

  // Classify response depth and build visual hint
  const depth      = classifyDepth(msg);
  const visualHint = buildVisualHint(detectedIntent, depth);
  console.log(`[Research] Depth: ${depth} | Intent: ${detectedIntent} | Visual: ${visualHint.slice(0, 60)}`);

  const depthInstruction = {
    brief:    'RESPONSE DEPTH: BRIEF — Answer in 2-4 sentences maximum. One key stat. One sentence of context. End with a follow-up offer. Nothing more.',
    standard: 'RESPONSE DEPTH: STANDARD — Answer in 1-2 short paragraphs. Cover recent form and relevant matchup/situational context. End with a follow-up offer.',
    detailed: 'RESPONSE DEPTH: DETAILED — Give a full breakdown. Maximum 4 short paragraphs. Cover: recent form, season context, matchup factors, relevant situational factors (weather/rest/back-to-back/goalie). End with follow-up offer.',
  }[depth];

  // Log data context status
  console.log(`[Research] dataContext: ${dataContext ? `${dataContext.length} chars` : 'NULL — no data available'}`);
  if (!dataContext) {
    console.warn('[Research] WARNING: No data context built — Claude will answer without real stats');
  }

  // Build the system prompt — inject data context + depth + visual hint
  const dataSection = dataContext
    ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nREAL DATA FOR THIS QUESTION — use these exact numbers in your response:\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${dataContext}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nNO DATA AVAILABLE FOR THIS QUESTION.\nRespond with: "Stats are loading — ask me again in a moment." Do not attempt to answer with numbers you do not have.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const injections = [
    dataSection,
    depthInstruction,
    `VISUAL DATA INSTRUCTION: ${visualHint}`,
    'Return ONLY valid JSON. No markdown. No code blocks. No text outside the JSON object.',
  ].join('\n\n');

  const systemPrompt = RESEARCH_SYSTEM.replace(
    'Return ONLY valid JSON. No markdown. No code blocks. No text outside the JSON object.',
    injections
  );

  const messages = [
    ...trimmedHistory,
    { role: 'user', content: msg },
  ];

  try {
    const aiResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    });

    const raw = aiResponse.content[0]?.text || '';

    let parsed;
    try {
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, wrap raw text
      parsed = {
        response: raw || "Give me a moment — I'm pulling the numbers.",
        hasPick: false,
        components: [],
      };
    }

    const responseText       = typeof parsed.response === 'string' ? parsed.response : raw;
    const components         = Array.isArray(parsed.components) ? parsed.components : [];
    const visualData         = parsed.visualData && parsed.visualData.type ? parsed.visualData : null;
    const followUpSuggestions = Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions.slice(0, 2) : [];

    if (visualData) {
      console.log(`[Research] Visual data type: ${visualData.type}`);
    }

    // Return history without injected data context (keep conversation clean)
    const updatedHistory = [
      ...trimmedHistory,
      { role: 'user',      content: msg },
      { role: 'assistant', content: responseText },
    ];

    res.json({
      response:    responseText,
      hasPick:     false, // always false in research mode
      components,
      visualData,
      followUpSuggestions,
      hasRealData: !!dataContext,
      history:     updatedHistory,
    });
  } catch (err) {
    console.error('[Research] Claude API error:', err.message);
    res.status(500).json({ error: "Chalky is studying the numbers. Try again in a moment." });
  }
});

// ── GET /api/research/suggestions ─────────────────────────────────────────────

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
