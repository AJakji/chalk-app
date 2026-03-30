import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = '@espn_team_logos_v2';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// All leagues we want logos for
const ENDPOINTS = [
  { league: 'NBA', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=100' },
  { league: 'NHL', url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams?limit=100' },
  { league: 'MLB', url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=100' },
];

// Returns a flat logo map:
// {
//   'NBA_GSW': 'https://a.espncdn.com/...',
//   'NBA_GOLDEN STATE WARRIORS': 'https://a.espncdn.com/...',
//   'NBA_WARRIORS': 'https://a.espncdn.com/...',
//   ...
// }
export async function fetchTeamLogos() {
  // Return from cache if still fresh
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return data;
      }
    }
  } catch {}

  const logos = {};

  await Promise.all(
    ENDPOINTS.map(async ({ league, url }) => {
      try {
        const res = await fetch(url);
        const json = await res.json();

        // ESPN nests teams under sports[0].leagues[0].teams[].team
        const teams =
          json.sports?.[0]?.leagues?.[0]?.teams ??
          json.leagues?.[0]?.teams ??
          json.teams ??
          [];

        for (const entry of teams) {
          const team = entry.team ?? entry;
          const logo = team.logos?.[0]?.href;
          if (!logo) continue;

          // Index by abbreviation, full name, nickname, and location+name
          const keys = [
            team.abbreviation,
            team.displayName,
            team.shortDisplayName,
            team.name,
            team.location,
          ];

          for (const key of keys) {
            if (key) logos[`${league}_${key.toUpperCase()}`] = logo;
          }
        }
      } catch (err) {
        console.warn(`ESPN ${league} logos failed:`, err.message);
      }
    })
  );

  // Persist to cache
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: logos, timestamp: Date.now() })
    );
  } catch {}

  return logos;
}
