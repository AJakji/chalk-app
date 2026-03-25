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

module.exports = { fetchESPNScores, getESPNScoresForDate };
