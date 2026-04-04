// Chalk AI picks engine — powered by Claude + Chalk's proprietary projection model
// Flow (primary): model edges → Claude (Chalky's voice) → store picks
// Flow (fallback): fetch odds → enrich with real stats → send to Claude → store picks

const Anthropic = require('@anthropic-ai/sdk');
const oddsService = require('./oddsService');
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
CRITICAL — NEVER USE TRAINING KNOWLEDGE FOR ROSTERS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are ONLY provided aggregate opponent defensive stats (avgAllowed, leagueAvg, pctVsLeague).
NEVER name a specific player on the opposing team in any field. Player rosters change constantly.
Only reference the opposing TEAM name and the aggregate defensive numbers you were given.

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
  // NBA
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
  // NHL
  'Anaheim Ducks': 'ANA', 'Arizona Coyotes': 'ARI', 'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF', 'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN',
  'Montreal Canadiens': 'MTL', 'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI', 'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR', 'Utah Hockey Club': 'UTA', 'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG',
  // MLB
  'Oakland Athletics': 'OAK', 'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD',
  'Seattle Mariners': 'SEA', 'San Francisco Giants': 'SF', 'St. Louis Cardinals': 'STL',
  'Tampa Bay Rays': 'TB', 'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR',
  'Minnesota Twins': 'MIN', 'Philadelphia Phillies': 'PHI', 'Atlanta Braves': 'ATL',
  'Chicago White Sox': 'CWS', 'Miami Marlins': 'MIA', 'New York Yankees': 'NYY',
  'Milwaukee Brewers': 'MIL', 'Los Angeles Angels': 'LAA', 'Arizona Diamondbacks': 'ARI',
  'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Dodgers': 'LAD', 'Washington Nationals': 'WSH', 'New York Mets': 'NYM',
};

async function enrichEdgesWithStats(edges, gameDate) {
  // Per-sport column expression maps.
  // player_game_logs uses shared columns with different meanings per sport.
  // NHL: fg_made=shots_on_goal, points=goals, three_made=assists, steals=saves
  // MLB: fg_made=hits, points=runs, three_made=homeRuns, rebounds=RBI, turnovers=batter_K, assists=pitcher_K
  const EXPR_MAPS = {
    NBA: {
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
    },
    NHL: {
      shots_on_goal: 'fg_made',
      goals:         'points',
      assists:       'three_made',
      saves:         'steals',
    },
    MLB: {
      hits:          'fg_made',
      runs_scored:   'points',
      home_runs:     'three_made',
      rbis:          'rebounds',
      stolen_bases:  'steals',
      strikeouts:    'assists',   // pitcher Ks — stored in assists column
    },
  };

  // Pre-compute league averages once per (sport, prop_type) pair.
  // Keyed as `${sport}::${prop_type}` to avoid cross-sport collisions
  // (e.g. 'assists' means different columns for NBA vs NHL).
  const sportPropPairs = [...new Set(edges.map(e => `${e.sport || 'NBA'}::${e.prop_type}`))];
  const leagueAvgs = {};
  await Promise.all(sportPropPairs.map(async (key) => {
    const [sport, pt] = key.split('::');
    const expr = EXPR_MAPS[sport]?.[pt];
    if (!expr) return;
    try {
      const { rows } = await db.query(`
        SELECT ROUND(AVG(${expr})::numeric, 2) AS league_avg
        FROM player_game_logs
        WHERE sport = $1 AND game_date > $2::date - INTERVAL '45 days' AND minutes > 15
      `, [sport, gameDate]);
      const v = parseFloat(rows[0]?.league_avg || 0);
      if (v > 0) leagueAvgs[key] = v;
    } catch {}
  }));

  return Promise.all(edges.map(async (edge) => {
    const sport   = edge.sport || 'NBA';
    const expr    = EXPR_MAPS[sport]?.[edge.prop_type];
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
        const leagueAvg = leagueAvgs[`${sport}::${edge.prop_type}`];
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
      // Validate required NOT NULL fields before attempting INSERT
      const missing = [];
      if (!pick.league)      missing.push('league');
      if (!pick.pick)        missing.push('pick');
      if (!pick.confidence)  missing.push('confidence');
      if (!pick.playerName)  missing.push('playerName');
      if (pick.awayTeam === undefined && pick.homeTeam === undefined) missing.push('awayTeam/homeTeam');
      if (missing.length > 0) {
        console.error(`[storeModelPicks] Skipping pick — missing required fields: ${missing.join(', ')}`, JSON.stringify(pick).slice(0, 200));
        continue;
      }

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

      // Look up UTC ISO game time from game picks stored by edgeDetector (runs before aiPicks).
      // Falls back to Claude's formatted string for cases where no game pick exists.
      let utcGameTime = pick.gameTime || 'Tonight';
      try {
        const gtRes = await db.query(
          `SELECT game_time FROM picks
           WHERE away_team ILIKE $1 AND home_team ILIKE $2
             AND pick_date = CURRENT_DATE AND pick_category = 'game'
           LIMIT 1`,
          [pick.awayTeam || '', pick.homeTeam || pick.playerTeam || '']
        );
        if (gtRes.rows[0]?.game_time) utcGameTime = gtRes.rows[0].game_time;
      } catch { /* non-fatal, use Claude's time */ }

      // Dedup: skip if this player already has a pick today with the same stat line.
      // Normalize pick_value by stripping player name prefix so "Jokic Under 34.5 Points"
      // and "Under 34.5 Points" are treated as the same pick.
      const pickVal = pick.pick;
      if (pick.playerName && pickVal) {
        const normalized = pickVal.replace(new RegExp(pick.playerName + '\\s*', 'i'), '').trim();
        const { rows: dupRows } = await db.query(
          `SELECT id FROM picks
           WHERE player_name = $1
             AND (pick_value ILIKE $2 OR pick_value ILIKE $3)
             AND DATE(created_at AT TIME ZONE 'America/New_York') = CURRENT_DATE AT TIME ZONE 'America/New_York'`,
          [pick.playerName, pickVal, `%${normalized}`]
        );
        if (dupRows.length > 0) {
          console.log(`  SKIP (duplicate): ${pick.playerName} ${pickVal}`);
          continue;
        }
      }

      await db.query(
        `INSERT INTO picks
          (league, sport_key, pick_type, pick_category,
           away_team, home_team, game_time, game_id,
           pick_value, confidence, short_reason, analysis, odds_data,
           player_name, player_team, matchup_text, headshot_url, pick_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (game_id, pick_type, COALESCE(player_name, '')) DO NOTHING`,
        [
          pick.league || 'NBA',
          pick.sportKey || 'basketball_nba',
          'Prop',
          'prop',
          pick.awayTeam || '',
          pick.homeTeam || pick.playerTeam || '',
          utcGameTime,
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
          'chalk_model',
        ]
      );
    } catch (err) {
      console.error(`Failed to store model pick for ${pick.playerName}:`, err.message);
    }
  }
}

// ── FALLBACK: Standard game picks from raw odds ───────────────────────────────

// Fetch game-level odds for all active leagues using oddsService (has retry/caching).
// Returns the same flat format the enrichment + Claude prompt pipeline expects.
async function fetchAllGamesForPicks() {
  const leagues = ['NBA', 'MLB', 'NHL'];
  const results = [];
  // Only include games that start within the next 36 hours — avoids confusing Claude
  // with games from days ago or far-future games that have no real pick value today.
  const now = Date.now();
  const cutoffMs = 36 * 60 * 60 * 1000; // 36 hours in ms

  for (const league of leagues) {
    try {
      const games = await oddsService.fetchGameOdds(league);
      for (const g of (games || [])) {
        // Filter: only games commencing within the next 36 hours
        if (g.commence_time) {
          const commenceMs = new Date(g.commence_time).getTime();
          // Skip games that have already started more than 3 hours ago OR start > 36h from now
          if (commenceMs < now - 3 * 60 * 60 * 1000) continue;  // already well underway
          if (commenceMs > now + cutoffMs) continue;              // too far in the future
        }
        const odds = {};
        for (const bm of (g.bookmakers || [])) {
          odds[bm.key] = {};
          for (const mkt of (bm.markets || [])) {
            odds[bm.key][mkt.key] = mkt.outcomes.map(o => ({ name: o.name, price: o.price, point: o.point }));
          }
        }
        results.push({ gameId: g.id, sportKey: g.sport_key, awayTeam: g.away_team, homeTeam: g.home_team, commenceTime: g.commence_time, odds, league });
      }
    } catch (err) {
      console.warn(`[generatePicks] Skipping ${league}: ${err.message}`);
    }
  }
  console.log(`[fetchAllGamesForPicks] ${results.length} games within next 36h across NBA/MLB/NHL`);
  return results;
}

async function generatePicks() {
  const _start = Date.now();
  console.log('🤖 Fetching odds from The Odds API...');
  const games = await fetchAllGamesForPicks();

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
      // Fill safe defaults for fields Claude sometimes omits
      if (!pick.sportKey && pick.league) {
        const leagueKeyMap = { NBA: 'basketball_nba', MLB: 'baseball_mlb', NHL: 'icehockey_nhl', NFL: 'americanfootball_nfl' };
        pick.sportKey = leagueKeyMap[pick.league] || 'basketball_nba';
      }
      // Always derive league from sportKey — sportKey is authoritative (comes from The Odds API).
      // This prevents Claude hallucinating the wrong league (e.g. NHL game tagged as MLB).
      const SPORT_KEY_TO_LEAGUE = {
        'basketball_nba':          'NBA',
        'icehockey_nhl':           'NHL',
        'baseball_mlb':            'MLB',
        'americanfootball_nfl':    'NFL',
        'mma_mixed_martial_arts':  'UFC',
      };
      if (pick.sportKey && SPORT_KEY_TO_LEAGUE[pick.sportKey]) {
        pick.league = SPORT_KEY_TO_LEAGUE[pick.sportKey];
      }
      if (!pick.pickType)    pick.pickType  = 'Moneyline';
      if (!pick.gameTime)    pick.gameTime  = 'Tonight';
      if (!pick.awayTeam)    pick.awayTeam  = pick.homeTeam  || 'TBD';
      if (!pick.homeTeam)    pick.homeTeam  = pick.awayTeam  || 'TBD';
      if (!pick.shortReason) pick.shortReason = pick.pick || 'Model pick';
      // Ensure a stable gameId so the dedup constraint works
      if (!pick.gameId) {
        const slug = `${(pick.awayTeam || '').replace(/\s+/g, '_')}_${(pick.homeTeam || '').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`;
        pick.gameId = `game_${slug.toLowerCase()}`;
      }

      // Validate required NOT NULL fields before attempting INSERT
      const missing = [];
      if (!pick.league)      missing.push('league');
      if (!pick.sportKey)    missing.push('sportKey');
      if (!pick.pickType)    missing.push('pickType');
      if (!pick.awayTeam)    missing.push('awayTeam');
      if (!pick.homeTeam)    missing.push('homeTeam');
      if (!pick.gameTime)    missing.push('gameTime');
      if (!pick.pick)        missing.push('pick');
      if (!pick.confidence)  missing.push('confidence');
      if (!pick.shortReason) missing.push('shortReason');
      if (missing.length > 0) {
        console.error(`[storePicks] Skipping pick — missing required fields: ${missing.join(', ')}`, JSON.stringify(pick).slice(0, 200));
        continue;
      }

      await db.query(
        `INSERT INTO picks
          (league, sport_key, pick_type, pick_category, away_team, home_team, game_time, game_id,
           pick_value, confidence, short_reason, analysis, odds_data, pick_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (game_id, pick_type, COALESCE(player_name, '')) DO NOTHING`,
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
          'ai_game',
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
       AND pick_type NOT IN ('Moneyline')
     ORDER BY confidence DESC`
  );
  return rows;
}

/**
 * Remove duplicate picks for the same player on the same day.
 * Keeps the higher-confidence pick when two picks share the same player
 * and the same stat line (accounts for "Jokic Under 34.5 Points" vs "Under 34.5 Points").
 */
async function deduplicatePicks(date) {
  const { rowCount } = await db.query(
    `DELETE FROM picks
     WHERE id IN (
       SELECT a.id
       FROM picks a
       JOIN picks b
         ON a.player_name = b.player_name
        AND a.id <> b.id
        AND DATE(a.created_at AT TIME ZONE 'America/New_York') = $1
        AND DATE(b.created_at AT TIME ZONE 'America/New_York') = $1
        AND (
          a.pick_value ILIKE b.pick_value
          OR b.pick_value ILIKE '%' || a.pick_value
          OR a.pick_value ILIKE '%' || b.pick_value
        )
       WHERE DATE(a.created_at AT TIME ZONE 'America/New_York') = $1
         AND a.player_name IS NOT NULL
         AND (a.confidence < b.confidence OR (a.confidence = b.confidence AND a.id > b.id))
     )`,
    [date]
  );
  if (rowCount > 0) console.log(`  Dedup: removed ${rowCount} duplicate picks`);
}

module.exports = { generateModelPicks, generatePicks, getTodaysPicks, deduplicatePicks };
