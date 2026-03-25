// The Odds API client
// Docs: https://the-odds-api.com/liveapi/guides/v4/

const BASE_URL = 'https://api.the-odds-api.com/v4';

// Maps Chalk league names → The Odds API sport keys
const SPORT_KEYS = {
  NBA:    'basketball_nba',
  MLB:    'baseball_mlb',
  NHL:    'icehockey_nhl',
  Soccer: 'soccer_fifa_world_cup',
};

// Which sportsbooks to pull odds from
const BOOKMAKERS = 'draftkings,fanduel,betmgm,bet365';

async function fetchOdds(league) {
  const sportKey = SPORT_KEYS[league];
  if (!sportKey) throw new Error(`Unknown league: ${league}`);

  const params = new URLSearchParams({
    apiKey: process.env.ODDS_API_KEY,
    regions: 'us',
    markets: 'h2h,spreads,totals',  // moneyline, spread, over/under
    oddsFormat: 'american',
    bookmakers: BOOKMAKERS,
  });

  const url = `${BASE_URL}/sports/${sportKey}/odds?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odds API error ${res.status}: ${text}`);
  }

  const games = await res.json();

  // Log how many API calls we have left (The Odds API has a monthly quota)
  const remaining = res.headers.get('x-requests-remaining');
  if (remaining) console.log(`Odds API requests remaining: ${remaining}`);

  return games.map(formatGame);
}

// Normalize The Odds API response into a clean structure for Claude
function formatGame(game) {
  const odds = {};

  for (const bookmaker of (game.bookmakers || [])) {
    odds[bookmaker.key] = {};
    for (const market of (bookmaker.markets || [])) {
      odds[bookmaker.key][market.key] = market.outcomes.map((o) => ({
        name: o.name,
        price: o.price,
        point: o.point,
      }));
    }
  }

  return {
    gameId:    game.id,
    sportKey:  game.sport_key,
    awayTeam:  game.away_team,
    homeTeam:  game.home_team,
    commenceTime: game.commence_time,
    odds,
  };
}

// Fetch odds for all active leagues at once
async function fetchAllOdds() {
  const activeLeagues = ['NBA', 'MLB', 'NHL', 'Soccer'];
  const results = [];

  for (const league of activeLeagues) {
    try {
      const games = await fetchOdds(league);
      results.push(...games.map((g) => ({ ...g, league })));
    } catch (err) {
      // If a league has no games (off-season) just skip it
      console.warn(`Skipping ${league}:`, err.message);
    }
  }

  return results;
}

module.exports = { fetchOdds, fetchAllOdds, SPORT_KEYS };
