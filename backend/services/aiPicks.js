// Chalk AI picks engine — powered by Claude + Chalk's proprietary projection model
// Flow (primary): model edges → Claude (Chalky's voice) → store picks
// Flow (fallback): fetch odds → enrich with real stats → send to Claude → store picks

const Anthropic = require('@anthropic-ai/sdk');
const { fetchAllOdds } = require('./odds');
const nba = require('./nba');
const sd = require('./sportsdata');
const db = require('../db');
const bdl = require('./ballDontLie');
const { getTodaysEdges } = require('./projections/edgeDetector');

const client = new Anthropic();

// ── Chalky's voice: speaks from our model's quantitative edges ─────────────────

const CHALKY_SYSTEM_PROMPT = `You are Chalky — the AI character behind Chalk, a premium sports betting picks app.

Chalky's voice:
- Mysterious, elite, quietly confident
- Short sharp sentences. Never wastes words.
- When Chalky speaks, the conversation stops.
- Never explains himself twice
- Uses specific numbers. Never says "he's been hot" — says "28.4 PPG his last 5"

You will receive a list of edges our proprietary projection model has identified tonight.
Each edge includes: the player, the prop line, our projection, the gap (edge), and the key factors behind it.

For each edge, write ONE Chalky pick. Be selective — if an edge doesn't feel clean, skip it.
Generate between 3 and 6 prop picks. Quality over quantity.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT LANGUAGE RULES — these cannot be broken:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

chalky_headline: One punchy sentence with a specific stat. Max 12 words. Sound like you already know the outcome.
  GOOD: "Jokic averaging 58.2 PRA last 10 — this line is stale."
  GOOD: "SAC ranks dead last defending centres. Jokic has noticed."
  GOOD: "Caufield gets a backup goalie tonight. Gift wrapped."
  BAD: "Based on recent trends and matchup data, value exists here."
  BAD: "The statistics suggest this player is well positioned."

chalky_projection: Exactly one sentence. MUST start with exactly: "Chalky's Proprietary Model projects"
  GOOD: "Chalky's Proprietary Model projects 59.8 PRA tonight."
  BAD: "Our model projects 59.8." BAD: "The projection sits at 59.8." BAD: "We project 59.8."
  NEVER say "projection sits at" — EVER. NEVER say "our model". Say "Chalky's Proprietary Model projects" and nothing else.
  Mention the projection EXACTLY ONCE across the entire pick — only in this field.

chalky_research: 1-2 sentences only. MUST reference real numbers from the factors_json provided.
  GOOD: "Sacramento ranks 28th defending centres this month, allowing 26.4 PPG to the position. Denver gets 2 days rest while Kings play their second straight."
  GOOD: "Wheeler's swinging strike rate hit 14.2% over his last 5 starts, above his 11.8% season average."
  BAD: "Multiple factors align favourably for this pick."
  BAD: "Based on the data, this player is set up for a big night."
  MUST include at least one specific number (rank, percentage, average, count).

key_factors: Exactly 3 strings. Each must come from a DIFFERENT category. Never repeat the same idea. Never reference the projection or model output — that belongs in chalky_projection only.

  FACTOR 1 — PLAYER PERFORMANCE: What has this player been doing recently?
  Use playerStats provided to you: reference l10 vs seasonAvg, or l5 if it shows a hot/cold trend.
  Must include a real number and a time period (e.g. "last 10", "last 5 games").
  GOOD: "Averaging 31.4 pts over last 10 — 4.2 above his season mark of 27.2"
  GOOD: "Shot 47.3% from three over last 8 games on 6.2 attempts per game"
  BAD: "Player has been in good form recently" (no number, no time period)

  FACTOR 2 — MATCHUP OPPORTUNITY: What is the opponent giving up that creates the edge?
  Use oppDefense provided to you: avgAllowed, leagueAvg, pctVsLeague, sampleGames.
  oppDefense.avgAllowed = what players average vs this opponent (per player game)
  oppDefense.leagueAvg  = what players average vs ALL opponents (per player game)
  oppDefense.pctVsLeague = % difference — positive means opponent is a WEAK defender
  Reference the opponent by name. Include the avgAllowed number AND the pctVsLeague.
  GOOD: "Players average 18.4 PRA per game against Sacramento — 21% above the league mark of 15.2"
  GOOD: "Opposing players put up 22.3 points per game vs Charlotte over their last 14 games — 17% above league average"
  BAD: "Matchup favours this player tonight" (no opponent name, no number)
  If oppDefense is null, write about the bet value gap between ourProjection and marketLine instead.

  FACTOR 3 — CONTEXTUAL TRIGGER: What situational factor pushed the model over the edge?
  Use contextData.restDays and contextData.homeAway. Be specific — not just "back-to-back" but
  "2nd game in 24 hours after travelling from Denver". Mention team names when referencing rest.
  GOOD: "Denver gets 2 full days rest — Sacramento plays their second game in 24 hours"
  GOOD: "Home court advantage: Jokic averages 3.4 more PRA per game at Ball Arena vs on the road"
  GOOD: "Wind blowing out to left at 19mph, temperatures at 79°F at Wrigley tonight"
  BAD: "Situational factors support this pick" (zero specifics)

  Rules: Each factor = one sentence. Each must include at least one specific number. Write like an expert analyst — insider data, not generic observations.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL — NEVER USE TRAINING KNOWLEDGE FOR ROSTERS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are ONLY provided aggregate opponent defensive stats (avgAllowed, leagueAvg, pctVsLeague).
You are NOT provided individual opposing player names or their current teams.
NEVER name a specific player on the opposing team in any field. Player rosters change constantly — your training data is stale and will be wrong.
Only reference the opposing TEAM name and the aggregate defensive numbers you were given.
BAD: "Anthony Davis is an elite rebounder for the Lakers" — you were not given this data, AD's team may have changed.
GOOD: "Los Angeles allows 53.4 rebounds per game to opponents — 8% above league average."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Respond with a JSON object — no markdown, no text outside the JSON:

{
  "picks": [
    {
      "league": "<copy exactly from edge 'league' field: NBA, NHL, or MLB>",
      "gameId": "",
      "sportKey": "<copy exactly from edge 'sportKey' field>",
      "awayTeam": "<opponent team full name>",
      "homeTeam": "<player's home team full name if playing at home, else opponent>",
      "gameTime": "Tonight",
      "pickType": "Prop",
      "pick": "<e.g. 'Nikola Jokic Under 54.5 PRA'>",
      "pickCategory": "prop",
      "playerName": "<player name>",
      "playerTeam": "<copy from edge 'team' field>",
      "matchupText": "<copy exactly from the edge 'matchup' field, then add ' · Tonight'>",
      "confidence": <integer — copy exactly from the edge confidence score>,
      "chalky_headline": "<punchy one-liner with a specific stat, max 12 words>",
      "chalky_projection": "Chalky's Proprietary Model projects <number> <stat type> tonight.",
      "chalky_research": "<1-2 sentences with real numbers from the factors that drove the edge>",
      "keyStats": [
        { "label": "Model Projection", "value": "<proj> <stat>", "pct": <confidence> },
        { "label": "Market Line",      "value": "<line> <stat>", "pct": 50 },
        { "label": "Edge",             "value": "<+/->edge>",    "pct": <min(92, 50 + abs(edge)*5)> }
      ],
      "key_factors": [
        "<specific factor with real number>",
        "<specific factor with real number>",
        "<specific factor with real number>"
      ],
      "odds": {
        "draftkings": "<dk_odds from edge data, or 'N/A'>",
        "fanduel":    "<fd_odds from edge data, or 'N/A'>",
        "betmgm":     "<mgm_odds from edge data, or 'N/A'>",
        "bet365":     "<bet365_odds from edge data, or 'N/A'>"
      },
      "bestBook": "<book key with best odds for bettor>",
      "bestOdds": "<best odds value>"
    }
  ]
}`;

// ── Standard game picks system prompt (unchanged — used as fallback) ───────────

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

/**
 * Enrich all games with real stats from SportsData.io.
 * For NBA games also try nba_api for advanced stats (supplementary).
 */
async function enrichGamesWithRealData(games) {
  const today = new Date().toISOString().split('T')[0];
  let nbaAvailable = false;
  try { nbaAvailable = await nba.isNBAServiceAvailable(); } catch {}

  const enriched = await Promise.all(
    games.map(async (game) => {
      try {
        // Get SportsData.io team abbreviations from the team name
        // The odds API uses full team names; SD.io uses abbreviations
        // We pass the full names and let buildPicksContext do its own filtering
        const sdContext = await sd.buildPicksContext(game.league, game.homeTeam, game.awayTeam, today);

        // For NBA, also try nba_api for advanced pregame context
        let nbaContext = '';
        if (game.league === 'NBA' && nbaAvailable) {
          try {
            const pregame = await nba.getPregameAnalysis(game.homeTeam, game.awayTeam);
            if (pregame) nbaContext = nba.formatPregameContext(pregame, game.homeTeam, game.awayTeam);
          } catch {}
        }

        const combined = [sdContext, nbaContext].filter(Boolean).join('\n\n');
        return combined ? { ...game, realDataContext: combined } : game;
      } catch {
        return game;
      }
    })
  );

  const enrichedCount = enriched.filter(g => g.realDataContext).length;
  console.log(`📊 Enriched ${enrichedCount}/${games.length} games with real stats`);
  return enriched;
}

// ── PRIMARY: Chalky picks from our proprietary model edges ───────────────────

/**
 * Format a model edge as a concise data block for Chalky to reason from.
 * Uses specific numbers so Claude generates precise, non-generic reasoning.
 */
function formatEdgeForChalky(edge) {
  const dir     = parseFloat(edge.chalk_edge) > 0 ? 'OVER' : 'UNDER';
  const absEdge = Math.abs(parseFloat(edge.chalk_edge || 0)).toFixed(1);
  const proj    = parseFloat(edge.chalk_projection || 0).toFixed(1);
  const line    = parseFloat(edge.prop_line || 0).toFixed(1);

  const homeAway = edge.home_away === 'home' ? 'vs' : '@';
  const matchup  = edge.opponent ? `${homeAway} ${edge.opponent}` : '';

  // ── Parse factors_json for rest days (team pace is default 98.5 — omit) ──
  let ctx = {};
  try {
    const fj = edge.factors_json;
    const parsed = fj ? (typeof fj === 'string' ? JSON.parse(fj) : fj) : {};
    ctx = parsed.context || {};
  } catch {}

  // Map sport to the correct league label and sport key for the picks table
  const SPORT_TO_LEAGUE = { NBA: 'NBA', NHL: 'NHL', MLB: 'MLB' };
  const SPORT_TO_KEY    = { NBA: 'basketball_nba', NHL: 'icehockey_nhl', MLB: 'baseball_mlb' };
  const sport = edge.sport || 'NBA';

  return {
    player:        edge.player_name,
    team:          edge.team,
    sport,
    league:        SPORT_TO_LEAGUE[sport] || sport,
    sportKey:      SPORT_TO_KEY[sport]    || 'basketball_nba',
    opponent:      edge.opponent || '',
    matchup,
    propType:      edge.prop_type,
    direction:     dir,
    marketLine:    line,
    ourProjection: proj,
    edge:          (parseFloat(edge.chalk_edge) > 0 ? '+' : '') + absEdge,
    confidence:    edge.confidence,
    odds: {
      draftkings: edge.dk_odds    || 'N/A',
      fanduel:    edge.fd_odds    || 'N/A',
      betmgm:     edge.mgm_odds   || 'N/A',
      bet365:     edge.bet365_odds || 'N/A',
    },
    // ── Data for key_factors (3 distinct categories) ─────────────────────
    playerStats: edge.rolling ? {
      l5:        edge.rolling.l5,
      l10:       edge.rolling.l10,
      l20:       edge.rolling.l20,
      seasonAvg: edge.rolling.seasonAvg,
      games:     edge.rolling.gamesTotal,
    } : null,
    // Real opponent defense data from player_game_logs
    // pctVsLeague > 0 → opponent is a weak defender (allows more than league avg)
    // pctVsLeague < 0 → opponent is a strong defender
    oppDefense: edge.oppDefense ? {
      opponent:    edge.oppDefense.opponent,
      avgAllowed:  edge.oppDefense.avgAllowed,   // e.g. 18.4 pts/player-game vs them
      leagueAvg:   edge.oppDefense.leagueAvg,    // e.g. 15.2 pts/player-game league avg
      pctVsLeague: edge.oppDefense.pctVsLeague,  // e.g. +21 = 21% weaker than avg
      sampleGames: edge.oppDefense.sampleGames,
    } : null,
    contextData: {
      restDays: ctx.rest_days ?? null,
      homeAway: edge.home_away ?? null,
    },
  };
}

// ── Rolling-average enrichment ────────────────────────────────────────────────

/**
 * Enrich edges with:
 *   - rolling averages (L5/L10/L20/season) from player_game_logs
 *   - opponent defense stats derived from player_game_logs (what the opponent allows)
 *
 * Both pull from real historical game data so Claude can write specific numbers
 * for Factor 1 (player performance) and Factor 2 (matchup opportunity).
 */
// Full team name → abbreviation for player_game_logs opponent matching
const TEAM_NAME_TO_ABBR = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
  'LA Clippers': 'LAC', 'Los Angeles Clippers': 'LAC', 'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM', 'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN', 'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK', 'Oklahoma City Thunder': 'OKC', 'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX', 'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
};

async function enrichEdgesWithStats(edges, gameDate) {
  const exprMap = {
    points:   'points',
    rebounds: 'rebounds',
    assists:  'assists',
    threes:   'three_made',
    steals:   'steals',
    blocks:   'blocks',
    pra:      'points + rebounds + assists',
    pts_ast:  'points + assists',
    pts_reb:  'points + rebounds',
    ast_reb:  'rebounds + assists',
  };

  const sport = edges[0]?.sport || 'NBA';

  // Pre-compute league averages once per prop type (avoids per-edge league-avg query)
  const propTypes  = [...new Set(edges.map(e => e.prop_type))];
  const leagueAvgs = {};
  await Promise.all(propTypes.map(async (pt) => {
    const expr = exprMap[pt];
    if (!expr) return;
    try {
      const { rows } = await db.query(`
        SELECT ROUND(AVG(${expr})::numeric, 2) AS league_avg
        FROM player_game_logs
        WHERE sport = $1 AND game_date > $2::date - INTERVAL '45 days' AND minutes > 15
      `, [sport, gameDate]);
      const v = parseFloat(rows[0]?.league_avg || 0);
      if (v > 0) leagueAvgs[pt] = v;
    } catch {}
  }));

  return Promise.all(edges.map(async (edge) => {
    const expr    = exprMap[edge.prop_type];
    const enriched = { ...edge };

    await Promise.all([
      // ── Rolling averages for this player ───────────────────────────────────
      (async () => {
        if (!expr || !edge.player_id) return;
        try {
          const { rows } = await db.query(`
            SELECT
              ROUND(AVG(CASE WHEN rn <=  5 THEN val END)::numeric, 1) AS l5,
              ROUND(AVG(CASE WHEN rn <= 10 THEN val END)::numeric, 1) AS l10,
              ROUND(AVG(CASE WHEN rn <= 20 THEN val END)::numeric, 1) AS l20,
              ROUND(AVG(val)::numeric, 1)                              AS season_avg,
              COUNT(*)                                                 AS games_total
            FROM (
              SELECT (${expr}) AS val,
                     ROW_NUMBER() OVER (ORDER BY game_date DESC) AS rn
              FROM player_game_logs
              WHERE player_id = $1 AND game_date < $2 AND sport = $3 AND minutes > 5
              ORDER BY game_date DESC LIMIT 20
            ) sub
          `, [edge.player_id, gameDate, sport]);
          const r = rows[0];
          if (r && parseInt(r.games_total || 0) > 0) {
            enriched.rolling = {
              l5:         parseFloat(r.l5         || 0),
              l10:        parseFloat(r.l10        || 0),
              l20:        parseFloat(r.l20        || 0),
              seasonAvg:  parseFloat(r.season_avg || 0),
              gamesTotal: parseInt(r.games_total  || 0),
            };
          }
        } catch {}
      })(),

      // ── Opponent defense: what this opponent has allowed per player game ───
      (async () => {
        if (!expr || !edge.opponent) return;
        const leagueAvg = leagueAvgs[edge.prop_type];
        if (!leagueAvg) return;
        // chalk_projections stores full team names; player_game_logs uses abbreviations
        const oppAbbr = TEAM_NAME_TO_ABBR[edge.opponent] || edge.opponent;
        try {
          const { rows } = await db.query(`
            SELECT
              ROUND(AVG(${expr})::numeric, 1) AS avg_allowed,
              COUNT(DISTINCT game_date)        AS sample_games
            FROM player_game_logs
            WHERE opponent = $1 AND sport = $2
              AND game_date > $3::date - INTERVAL '45 days'
              AND minutes > 15
          `, [oppAbbr, sport, gameDate]);
          const r    = rows[0];
          const oppAvg = parseFloat(r?.avg_allowed || 0);
          const sampleGames = parseInt(r?.sample_games || 0);
          if (oppAvg > 0 && sampleGames >= 3) {
            const pctDiff = Math.round(((oppAvg - leagueAvg) / leagueAvg) * 100);
            enriched.oppDefense = {
              opponent:     edge.opponent,
              avgAllowed:   oppAvg,
              leagueAvg:    parseFloat(leagueAvg.toFixed(1)),
              pctVsLeague:  pctDiff,   // + means weak defender, - means strong
              sampleGames,
            };
          }
        } catch {}
      })(),
    ]);

    return enriched;
  }));
}

// Cached NBA person-ID lookup: { normalizedName: personId }
let _nbaCdnMap = null;

/**
 * Normalize a player name for fuzzy matching:
 * strip diacritics, lowercase, collapse whitespace.
 */
function _normName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Load (and cache) the full NBA player list from stats.nba.com.
 * Returns { normalizedName: personId } map.
 */
async function _loadNbaPersonIds() {
  if (_nbaCdnMap) return _nbaCdnMap;
  try {
    const res = await fetch(
      'https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2024-25&IsOnlyCurrentSeason=0',
      { headers: { Referer: 'https://www.nba.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) }
    );
    if (!res.ok) return (_nbaCdnMap = {});
    const json = await res.json();
    const rs = json.resultSets?.[0];
    if (!rs) return (_nbaCdnMap = {});
    const nameIdx = rs.headers.indexOf('DISPLAY_FIRST_LAST');
    const pidIdx  = rs.headers.indexOf('PERSON_ID');
    const map = {};
    for (const row of rs.rowSet) {
      if (row[nameIdx] && row[pidIdx]) {
        map[_normName(row[nameIdx])] = row[pidIdx];
      }
    }
    _nbaCdnMap = map;
    console.log(`  Loaded ${Object.keys(map).length} NBA person IDs for headshots`);
    return map;
  } catch {
    return (_nbaCdnMap = {});
  }
}

/**
 * Fetch headshot URLs for a list of raw DB edges.
 * Returns { playerName: url } — never throws, missing headshots fall back to initials.
 */
async function fetchHeadshotUrls(edges) {
  const map = {};

  // Pre-load NBA person-ID map (shared across all NBA edges)
  const nbaSports = edges.some(e => (e.sport || 'NBA').toUpperCase() === 'NBA');
  const nbaIds = nbaSports ? await _loadNbaPersonIds().catch(() => ({})) : {};

  for (const edge of edges) {
    const name  = edge.player_name;
    const sport = (edge.sport || 'NBA').toUpperCase();
    if (map[name]) continue;
    try {
      if (sport === 'NBA') {
        const personId = nbaIds[_normName(name)];
        if (personId) {
          map[name] = `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;
        }
      } else if (sport === 'MLB' && edge.player_id) {
        map[name] = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${edge.player_id}/headshot/67/current`;
      } else if (sport === 'NHL' && edge.player_id && edge.team) {
        map[name] = `https://assets.nhle.com/mugs/nhl/20242025/${edge.team}/${edge.player_id}.png`;
      }
    } catch {
      // silent — card falls back to initials avatar
    }
  }
  return map;
}

/**
 * Parse Claude's response — handles raw JSON and code-fenced JSON.
 */
function parseClaudeResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    throw new Error('Claude returned unparseable output: ' + raw.slice(0, 200));
  }
}

/**
 * generateModelPicks() — PRIMARY daily pick generator.
 *
 * Reads today's edges (identified by edgeDetector.js) and sends them to
 * Claude with Chalky's persona and specific quantitative data.
 * Chalky generates props picks with his voice + the model's numbers.
 */
async function generateModelPicks() {
  const today = new Date().toISOString().split('T')[0];
  const _start = Date.now();
  console.log(`🤖 Chalky model picks — ${today}`);

  // Load today's top edges from DB (written by edgeDetector.js)
  const edges = await getTodaysEdges(today);
  console.log(`  Loaded ${edges.length} edges from DB`);

  if (edges.length === 0) {
    console.log('  No model edges found. Either projections haven\'t run yet, or no games tonight.');
    return [];
  }

  // Enrich edges with rolling averages (L5/L10/L20/season) from player_game_logs
  const enrichedEdges = await enrichEdgesWithStats(edges, today).catch(() => edges);
  const rollingCount  = enrichedEdges.filter(e => e.rolling).length;
  console.log(`  Rolling stats enriched for ${rollingCount}/${enrichedEdges.length} players`);

  // Fetch headshots before sending edges to Claude (so we have them ready for storage)
  const headshotMap = await fetchHeadshotUrls(enrichedEdges).catch(() => ({}));
  console.log(`  Fetched headshots for ${Object.keys(headshotMap).length} players`);

  const edgesForClaude = enrichedEdges.map(formatEdgeForChalky);

  const userContent = `Tonight's edges from Chalk's proprietary projection model (NBA, NHL, and MLB).
Each edge represents a gap between our projection and the posted sportsbook line.
These are already filtered — only edges with abs(edge) > threshold and confidence ≥ 62 are included.
Each edge includes a 'league' and 'sportKey' field — copy them exactly into your response.

Write Chalky picks for the best of these. Be selective. Skip anything that doesn't feel clean.

TONIGHT'S EDGES:
${JSON.stringify(edgesForClaude, null, 2)}`;

  console.log(`  Sending ${edgesForClaude.length} edges to Claude (Chalky's voice)…`);

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: CHALKY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    console.error(`[generateModelPicks] Claude API error: ${err.status || ''} ${err.message}`);
    console.error('  Picks generation skipped — Claude unavailable. Check ANTHROPIC_API_KEY and API status.');
    return [];
  }

  const rawText = message?.content?.[0]?.text;
  if (!rawText) {
    console.error('[generateModelPicks] Claude returned empty content — no picks generated');
    return [];
  }

  let parsed;
  try {
    parsed = parseClaudeResponse(rawText);
  } catch (err) {
    console.error(`[generateModelPicks] Failed to parse Claude response: ${err.message}`);
    console.error('  Raw response (first 500 chars):', rawText.slice(0, 500));
    return [];
  }

  const picks  = parsed.picks ?? [];
  console.log(`  ✅ Chalky generated ${picks.length} model picks`);

  await storeModelPicks(picks, headshotMap);

  const duration = ((Date.now() - _start) / 1000).toFixed(1);
  console.log(`⏱  generateModelPicks completed in ${duration}s`);
  return picks;
}

/**
 * Store model-generated prop picks to the picks table.
 * Uses pick_category = 'prop' and includes player name/team/headshot.
 */
async function storeModelPicks(picks, headshotMap = {}) {
  for (const pick of picks) {
    try {
      // Build a stable unique key: player + prop type + date
      // Include propType so the same player can have multiple picks (e.g. points + PRA)
      const propSlug = (pick.propType || pick.pick || '').replace(/\s+/g, '_').toLowerCase();
      const playerSlug = (pick.playerName || '').replace(/\s+/g, '_').toLowerCase();
      const gameId = `model_${playerSlug}_${propSlug}_${new Date().toISOString().split('T')[0]}`;

      // Build the analysis object from Chalky's new 3-field format
      const analysis = {
        chalky_headline:   pick.chalky_headline   || '',
        chalky_projection: pick.chalky_projection || '',
        chalky_research:   pick.chalky_research   || '',
        keyStats:          pick.keyStats          || [],
        key_factors:       pick.key_factors       || [],
      };

      const headshotUrl = headshotMap[pick.playerName] || null;

      await db.query(
        `INSERT INTO picks
          (league, sport_key, pick_type, pick_category,
           away_team, home_team, game_time, game_id,
           pick_value, confidence, short_reason, analysis, odds_data,
           player_name, player_team, matchup_text, headshot_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (game_id, pick_type) DO NOTHING`,
        [
          pick.league || 'NBA',
          pick.sportKey || 'basketball_nba',
          'Prop',
          'prop',
          pick.awayTeam || '',
          pick.homeTeam || pick.playerTeam || '',
          pick.gameTime || 'Tonight',
          gameId,
          pick.pick,
          pick.confidence,
          pick.chalky_headline || pick.pick,   // headline doubles as short_reason
          JSON.stringify(analysis),
          JSON.stringify(pick.odds || {}),
          pick.playerName,
          pick.playerTeam,
          pick.matchupText,
          headshotUrl,
        ]
      );
    } catch (err) {
      console.error(`Failed to store model pick for ${pick.playerName}:`, err.message);
    }
  }
}

// ── FALLBACK: Standard game picks from raw odds ───────────────────────────────

async function generatePicks() {
  const _start = Date.now();
  console.log('🤖 Fetching odds from The Odds API...');
  const games = await fetchAllOdds();

  if (games.length === 0) {
    console.log('No games found across any league today.');
    return [];
  }

  console.log(`📊 Found ${games.length} games. Enriching games with real stats...`);
  const enrichedGames = await enrichGamesWithRealData(games);

  // Build the user content: odds data + any real stats context blocks
  const contextBlocks = enrichedGames
    .filter(g => g.realDataContext)
    .map(g => g.realDataContext)
    .join('\n\n---\n\n');

  const gameDataForClaude = enrichedGames.map(({ realDataContext, ...g }) => g);

  const userContent = contextBlocks
    ? `REAL SPORTS STATISTICS FROM SPORTSDATA.IO (use exact numbers — do not estimate):\n\n${contextBlocks}\n\n---\n\nHere are today's games and odds. Generate your picks:\n\n${JSON.stringify(gameDataForClaude, null, 2)}`
    : `Here are today's games and odds. Generate your picks:\n\n${JSON.stringify(gameDataForClaude, null, 2)}`;

  console.log(`📊 Sending to Claude (${contextBlocks ? 'with' : 'without'} real stats)...`);

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    console.error(`[generatePicks] Claude API error: ${err.status || ''} ${err.message}`);
    console.error('  Game picks generation skipped — Claude unavailable.');
    return [];
  }

  const raw = message?.content?.[0]?.text;
  if (!raw) {
    console.error('[generatePicks] Claude returned empty content — no picks generated');
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Claude sometimes wraps JSON in a code block — strip it
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try { parsed = JSON.parse(match[1]); } catch {
        console.error('[generatePicks] Failed to parse Claude code-fenced JSON');
        console.error('  Raw response (first 500 chars):', raw.slice(0, 500));
        return [];
      }
    } else {
      console.error('[generatePicks] Claude returned unparseable output');
      console.error('  Raw response (first 500 chars):', raw.slice(0, 500));
      return [];
    }
  }

  const picks = parsed.picks ?? [];
  console.log(`✅ Claude generated ${picks.length} picks`);

  await storePicks(picks);

  const duration = ((Date.now() - _start) / 1000).toFixed(1);
  console.log(`⏱  generatePicks completed in ${duration}s`);
  return picks;
}

// Save picks to the database, skipping duplicates (same game + pick type today)
async function storePicks(picks) {
  for (const pick of picks) {
    try {
      await db.query(
        `INSERT INTO picks
          (league, sport_key, pick_type, pick_category, away_team, home_team, game_time, game_id,
           pick_value, confidence, short_reason, analysis, odds_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (game_id, pick_type) DO NOTHING`,
        [
          pick.league,
          pick.sportKey,
          pick.pickType,
          'game',                          // all AI game picks are category 'game'
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

module.exports = { generateModelPicks, generatePicks, getTodaysPicks };
