/**
 * espn.js — ESPN public API fallback
 * Used only when SportsData.io fails. Scores only, no box scores or PBP.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS = {
  NBA:    'basketball/nba',
  NFL:    'football/nfl',
  NHL:    'hockey/nhl',
  MLB:    'baseball/mlb',
  Soccer: 'soccer/fifa.world-cup',
};

async function fetchESPNScores(league, date) {
  const sportPath = SPORT_PATHS[league];
  if (!sportPath) return [];

  try {
    const params = new URLSearchParams({ limit: 50 });
    if (date) params.set('dates', date.replace(/-/g, '')); // ESPN wants YYYYMMDD

    const res = await fetch(`${BASE}/${sportPath}/scoreboard?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const json = await res.json();
    return (json.events || []).map(event => {
      const comp  = event.competitions?.[0];
      const comps = comp?.competitors || [];
      const away  = comps.find(c => c.homeAway === 'away') || comps[0];
      const home  = comps.find(c => c.homeAway === 'home') || comps[1];
      const statusName = event.status?.type?.name || '';

      let status = 'upcoming';
      if (statusName === 'STATUS_IN_PROGRESS' || statusName === 'STATUS_HALFTIME') status = 'live';
      else if (statusName === 'STATUS_FINAL') status = 'final';

      const period = event.status?.period || '';
      const clock  = event.status?.displayClock || '';

      return {
        id:        `espn-${event.id}`,
        league,
        status,
        clock:     status === 'live' ? `Q${period} ${clock}` : status === 'final' ? 'Final' : '',
        awayTeam:  { name: away?.team?.displayName || '', abbr: away?.team?.abbreviation || '', score: away?.score != null ? parseInt(away.score) : null },
        homeTeam:  { name: home?.team?.displayName || '', abbr: home?.team?.abbreviation || '', score: home?.score != null ? parseInt(home.score) : null },
        chalkPick:  null,
        boxScore:   null,
        playByPlay: [],
        source:     'espn',
      };
    });
  } catch (err) {
    console.warn(`[ESPN fallback] ${league}: ${err.message}`);
    return [];
  }
}

async function getESPNScoresForDate(date) {
  const leagues = ['NBA', 'NHL', 'MLB', 'Soccer'];
  const results = await Promise.allSettled(leagues.map(l => fetchESPNScores(l, date)));
  const games = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  return games.sort((a, b) => {
    const order = { live: 0, upcoming: 1, final: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });
}

// ── ESPN Injury API ───────────────────────────────────────────────────────────
// ESPN exposes injury data via the same unofficial JSON API — no auth required.

const INJURY_PATHS = {
  NBA:  'basketball/nba',
  NHL:  'hockey/nhl',
  MLB:  'baseball/mlb',
};

/**
 * Fetch injuries for a league from ESPN.
 * Returns: [{teamAbbr, playerName, position, status, description}]
 * Cache: 1hr (in-memory)
 */
const _injuryCache = new Map();

async function getInjuries(league) {
  const L = (league || '').toUpperCase();
  const sportPath = INJURY_PATHS[L];
  if (!sportPath) return [];

  const cacheKey = `injuries:${L}`;
  const cached = _injuryCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  try {
    const res = await fetch(`${BASE}/${sportPath}/injuries`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const json = await res.json();
    const teamGroups = json.injuries || [];
    const results = [];

    for (const group of teamGroups) {
      const teamAbbr = group.team?.abbreviation || '';
      for (const inj of (group.injuries || [])) {
        const athlete = inj.athlete || {};
        const injDetail = athlete.injuries?.[0] || {};
        results.push({
          teamAbbr,
          playerName:  athlete.displayName || athlete.shortName || '',
          position:    athlete.position?.abbreviation || '--',
          status:      inj.status || injDetail.status || '',
          description: injDetail.type?.description || inj.type?.description || '',
        });
      }
    }

    _injuryCache.set(cacheKey, { data: results, expires: Date.now() + 60 * 60 * 1000 });
    return results;
  } catch (err) {
    console.warn(`[ESPN injuries] ${L}: ${err.message}`);
    return [];
  }
}

module.exports = { fetchESPNScores, getESPNScoresForDate, getInjuries };
