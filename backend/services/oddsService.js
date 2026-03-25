/**
 * Chalk Odds Service
 * ==================
 * Thin wrapper around The Odds API.
 * Provides game lines (h2h / spreads / totals) and player props for NBA, MLB, NHL.
 *
 * The 9 AM "collectPropsLines()" cron in edgeDetector.js calls this internally.
 * This module is also exposed via GET /api/odds/:sport/today for manual testing.
 *
 * Rate-limit note: the free plan is 500 requests/month — every call to fetchEvents()
 * costs 1 credit, every call to fetchEventProps() costs 1 credit per market group.
 * Use the 5-minute in-memory cache below to avoid burning credits on dev refreshes.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const BASE_URL     = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e || Date.now() > e.exp) return null;
  return e.data;
}
function cacheSet(k, data) {
  _cache.set(k, { data, exp: Date.now() + CACHE_TTL_MS });
}

// ── Sport key map ────────────────────────────────────────────────────────────

const SPORT_KEYS = {
  NBA:    'basketball_nba',
  MLB:    'baseball_mlb',
  NHL:    'icehockey_nhl',
  NFL:    'americanfootball_nfl',
  Soccer: 'soccer_fifa_world_cup',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function oddsApiFetch(path, params = {}) {
  if (!ODDS_API_KEY) return null;
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn(`[oddsService] ${path} → ${res.status}`, body.message || '');
      return null;
    }
    // Log credits remaining
    const remaining = res.headers.get('x-requests-remaining');
    const used      = res.headers.get('x-requests-used');
    if (remaining) console.log(`[oddsService] credits remaining: ${remaining} (used today: ${used})`);
    return await res.json();
  } catch (err) {
    console.warn(`[oddsService] fetch error: ${err.message}`);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all events (games) for a sport today.
 * Returns array of Odds API event objects.
 */
async function fetchEvents(league) {
  const key = `events:${league}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const sportKey = SPORT_KEYS[league];
  if (!sportKey) return [];

  const data = await oddsApiFetch(`/sports/${sportKey}/events`);
  const result = data || [];
  cacheSet(key, result);
  return result;
}

/**
 * Fetch game-level odds (h2h, spreads, totals) for a sport.
 * Returns array of Odds API game odds objects.
 */
async function fetchGameOdds(league, bookmakers = 'draftkings,fanduel,betmgm,bet365') {
  const key = `game-odds:${league}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const sportKey = SPORT_KEYS[league];
  if (!sportKey) return [];

  const data = await oddsApiFetch(`/sports/${sportKey}/odds`, {
    regions:    'us',
    markets:    'h2h,spreads,totals',
    oddsFormat: 'american',
    bookmakers,
  });
  const result = data || [];
  cacheSet(key, result);
  return result;
}

/**
 * Fetch player prop odds for a specific event.
 * markets: comma-separated Odds API market keys (e.g. player_points,player_rebounds)
 * Returns the Odds API event props response or null.
 */
async function fetchEventProps(league, eventId, markets) {
  const key = `props:${league}:${eventId}:${markets}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const sportKey = SPORT_KEYS[league];
  if (!sportKey) return null;

  const data = await oddsApiFetch(
    `/sports/${sportKey}/events/${eventId}/odds`,
    { regions: 'us', markets, oddsFormat: 'american', bookmakers: 'draftkings,fanduel,betmgm,bet365' }
  );
  cacheSet(key, data);
  return data;
}

/**
 * Summarise today's games for a league in a clean format.
 * Used by GET /api/odds/:league/today
 */
async function getTodayGames(league) {
  const [events, gameOdds] = await Promise.all([
    fetchEvents(league),
    fetchGameOdds(league),
  ]);

  const oddsById = {};
  for (const g of gameOdds) oddsById[g.id] = g;

  return events.map(ev => {
    const odds = oddsById[ev.id];
    const result = {
      id:        ev.id,
      awayTeam:  ev.away_team,
      homeTeam:  ev.home_team,
      startTime: ev.commence_time,
      moneyline: null,
      spread:    null,
      total:     null,
    };

    if (!odds?.bookmakers) return result;

    // Use DraftKings as primary source, fall back to FanDuel
    const bm = odds.bookmakers.find(b => b.key === 'draftkings')
            || odds.bookmakers[0];
    if (!bm) return result;

    for (const mkt of (bm.markets || [])) {
      if (mkt.key === 'h2h') {
        const away = mkt.outcomes.find(o => o.name === ev.away_team);
        const home = mkt.outcomes.find(o => o.name === ev.home_team);
        result.moneyline = {
          away: away?.price ?? null,
          home: home?.price ?? null,
        };
      }
      if (mkt.key === 'spreads') {
        const home = mkt.outcomes.find(o => o.name === ev.home_team);
        result.spread = home?.point ?? null;
      }
      if (mkt.key === 'totals') {
        const over = mkt.outcomes.find(o => o.name === 'Over');
        result.total = over?.point ?? null;
      }
    }
    return result;
  });
}

module.exports = { fetchEvents, fetchGameOdds, fetchEventProps, getTodayGames, SPORT_KEYS };
