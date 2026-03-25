/**
 * Chalk Weather Service
 * ====================
 * Fetches current weather for MLB venues using the Open-Meteo free API.
 * No API key required — completely free.
 *
 * Runs at 8:00 AM daily (before MLB projection model at 10:00 AM).
 * Results are cached in-memory for the day so multiple model runs
 * don't re-fetch.
 *
 * Why weather matters for MLB:
 *   - Wind blowing OUT at 15+ mph increases HR probability 15-25%
 *   - Wind blowing IN suppresses HR by 10-15%
 *   - Cold weather (< 50°F) kills ball carry — HR probability drops 12%+
 *   - Hot weather (> 85°F) adds carry — HR probability up ~10%
 *   - Coors Field altitude (5183 ft) compounds all weather effects
 *
 * Open-Meteo docs: https://open-meteo.com/en/docs
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// ---------------------------------------------------------------------------
// MLB venue coordinates  (lat, lon, altitude_ft, park_name)
// ---------------------------------------------------------------------------
const MLB_VENUES = {
  // AL East
  'yankee_stadium':        { lat: 40.829, lon: -73.926, alt: 55,   name: 'Yankee Stadium',        team: 'NYY' },
  'fenway_park':           { lat: 42.346, lon: -71.097, alt: 20,   name: 'Fenway Park',            team: 'BOS' },
  'camden_yards':          { lat: 39.284, lon: -76.622, alt: 32,   name: 'Camden Yards',           team: 'BAL' },
  'tropicana_field':       { lat: 27.768, lon: -82.653, alt: 15,   name: 'Tropicana Field',        team: 'TBR' },
  'rogers_centre':         { lat: 43.641, lon: -79.389, alt: 251,  name: 'Rogers Centre',          team: 'TOR' },
  // AL Central
  'guaranteed_rate_field': { lat: 41.830, lon: -87.634, alt: 595,  name: 'Guaranteed Rate Field',  team: 'CWS' },
  'progressive_field':     { lat: 41.496, lon: -81.685, alt: 580,  name: 'Progressive Field',      team: 'CLE' },
  'comerica_park':         { lat: 42.339, lon: -83.048, alt: 600,  name: 'Comerica Park',          team: 'DET' },
  'kauffman_stadium':      { lat: 39.051, lon: -94.480, alt: 750,  name: 'Kauffman Stadium',       team: 'KCR' },
  'target_field':          { lat: 44.982, lon: -93.278, alt: 830,  name: 'Target Field',           team: 'MIN' },
  // AL West
  'minute_maid_park':      { lat: 29.757, lon: -95.355, alt: 43,   name: 'Minute Maid Park',       team: 'HOU' },
  'angel_stadium':         { lat: 33.800, lon: -117.883, alt: 154, name: 'Angel Stadium',          team: 'LAA' },
  'oakland_coliseum':      { lat: 37.751, lon: -122.201, alt: 20,  name: 'Oakland Coliseum',       team: 'OAK' },
  't_mobile_park':         { lat: 47.591, lon: -122.333, alt: 8,   name: 'T-Mobile Park',          team: 'SEA' },
  'globe_life_field':      { lat: 32.747, lon: -97.083, alt: 551,  name: 'Globe Life Field',       team: 'TEX' },
  // NL East
  'nationals_park':        { lat: 38.873, lon: -77.007, alt: 25,   name: 'Nationals Park',         team: 'WSN' },
  'truist_park':           { lat: 33.891, lon: -84.468, alt: 1050, name: 'Truist Park',            team: 'ATL' },
  'loanDepot_park':        { lat: 25.778, lon: -80.220, alt: 6,    name: 'loanDepot park',         team: 'MIA' },
  'citi_field':            { lat: 40.757, lon: -73.846, alt: 20,   name: 'Citi Field',             team: 'NYM' },
  'citizens_bank_park':    { lat: 39.906, lon: -75.167, alt: 20,   name: 'Citizens Bank Park',     team: 'PHI' },
  // NL Central
  'wrigley_field':         { lat: 41.948, lon: -87.656, alt: 595,  name: 'Wrigley Field',          team: 'CHC' },
  'great_american_ballpark': { lat: 39.097, lon: -84.507, alt: 489, name: 'Great American Ball Park', team: 'CIN' },
  'american_family_field': { lat: 43.028, lon: -87.971, alt: 635,  name: 'American Family Field',  team: 'MIL' },
  'pnc_park':              { lat: 40.447, lon: -80.006, alt: 705,  name: 'PNC Park',               team: 'PIT' },
  'busch_stadium':         { lat: 38.623, lon: -90.193, alt: 455,  name: 'Busch Stadium',          team: 'STL' },
  // NL West
  'chase_field':           { lat: 33.445, lon: -112.067, alt: 1082, name: 'Chase Field',           team: 'ARI' },
  'coors_field':           { lat: 39.756, lon: -104.994, alt: 5183, name: 'Coors Field',           team: 'COL' },
  'dodger_stadium':        { lat: 34.074, lon: -118.240, alt: 340,  name: 'Dodger Stadium',        team: 'LAD' },
  'petco_park':            { lat: 32.707, lon: -117.157, alt: 17,   name: 'Petco Park',            team: 'SDP' },
  'oracle_park':           { lat: 37.778, lon: -122.389, alt: 0,    name: 'Oracle Park',           team: 'SFG' },
};

// ---------------------------------------------------------------------------
// In-memory cache — weather is stable for the day
// ---------------------------------------------------------------------------
const _cache = new Map();   // key: venue_key, value: { data, expires }
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;  // 3 hours

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch weather for a single venue from Open-Meteo.
 * Returns:
 *   { temp_f, wind_mph, wind_dir_deg, wind_dir_label, condition, weather_available: true }
 * On failure:
 *   { weather_available: false }
 */
async function fetchVenueWeather(venueKey) {
  const venue = MLB_VENUES[venueKey];
  if (!venue) return { weather_available: false };

  const cached = _cache.get(venueKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${venue.lat}&longitude=${venue.lon}`
    + `&current_weather=true`
    + `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,weathercode`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
    + `&forecast_days=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { weather_available: false };

    const json = await res.json();
    const cw   = json.current_weather;
    if (!cw) return { weather_available: false };

    // hourly arrays give us the first hour's temp if current_weather.temperature is missing
    const hourly     = json.hourly || {};
    const temp_f     = cw.temperature ?? (hourly.temperature_2m?.[0] ?? null);
    const wind_mph   = cw.windspeed   ?? (hourly.wind_speed_10m?.[0] ?? null);
    const wind_deg   = cw.winddirection ?? (hourly.wind_direction_10m?.[0] ?? null);

    const data = {
      venue_key:       venueKey,
      venue_name:      venue.name,
      team:            venue.team,
      altitude_ft:     venue.alt,
      temp_f:          temp_f != null ? Math.round(temp_f * 10) / 10 : null,
      wind_mph:        wind_mph != null ? Math.round(wind_mph * 10) / 10 : null,
      wind_dir_deg:    wind_deg != null ? Math.round(wind_deg) : null,
      wind_dir_label:  wind_deg != null ? degreesToCompass(wind_deg) : null,
      weather_available: true,
      fetched_at:      new Date().toISOString(),
    };

    _cache.set(venueKey, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.error(`[weatherService] Failed to fetch weather for ${venueKey}:`, err.message);
    return { weather_available: false };
  }
}

/**
 * Fetch weather for all 30 MLB venues at once.
 * Returns a map: venueKey → weather object.
 * Runs the fetches in parallel (Open-Meteo supports concurrent requests).
 */
async function fetchAllVenueWeather() {
  const venueKeys = Object.keys(MLB_VENUES);
  console.log(`[weatherService] Fetching weather for ${venueKeys.length} MLB venues…`);

  const results = await Promise.allSettled(
    venueKeys.map(key => fetchVenueWeather(key))
  );

  const weatherMap = {};
  let successCount = 0;
  venueKeys.forEach((key, i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value.weather_available) {
      weatherMap[key] = r.value;
      successCount++;
    } else {
      weatherMap[key] = { weather_available: false };
    }
  });

  console.log(`[weatherService] ✅ Weather fetched for ${successCount}/${venueKeys.length} venues`);
  return weatherMap;
}

/**
 * Get weather for a specific team's home park (by team abbreviation).
 * Returns cached result if available, fetches otherwise.
 */
async function getWeatherForTeam(teamAbbr) {
  const key = Object.keys(MLB_VENUES).find(k => MLB_VENUES[k].team === teamAbbr?.toUpperCase());
  if (!key) return { weather_available: false };
  return fetchVenueWeather(key);
}

/**
 * Get weather for a venue by matching part of the name (case-insensitive).
 * Used when we have a venue name from the MLB Stats API.
 */
async function getWeatherByVenueName(venueName) {
  if (!venueName) return { weather_available: false };
  const lower = venueName.toLowerCase().replace(/[^a-z0-9 ]/g, '');

  // Try direct key match
  const key = Object.keys(MLB_VENUES).find(k => {
    const venueNameClean = MLB_VENUES[k].name.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    return venueNameClean.includes(lower) || lower.includes(venueNameClean.split(' ')[0]);
  });

  if (key) return fetchVenueWeather(key);
  return { weather_available: false };
}

// ---------------------------------------------------------------------------
// Wind direction helpers
// ---------------------------------------------------------------------------

/**
 * Convert meteorological wind direction degrees to compass label.
 * Note: meteorological convention — 0° = wind FROM the north (blowing south).
 */
function degreesToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx   = Math.round(((deg % 360) / 45)) % 8;
  return dirs[idx];
}

/**
 * Given wind direction (degrees, meteorological) and a venue key,
 * determine if wind is blowing IN (toward home plate) or OUT (toward outfield).
 *
 * This is a simplified model — in production you'd use each park's exact
 * orientation from the park's GPS bearing. For now we use cardinal approximations.
 *
 * Returns: 'blowing_out' | 'blowing_in' | 'crosswind' | 'unknown'
 */
function getWindEffect(windDirDeg, venueKey) {
  if (windDirDeg == null) return 'unknown';

  // Each park has an approximate "blowing out" direction
  // (wind that carries balls toward the outfield)
  const OUT_DIRECTIONS = {
    'wrigley_field':           { out: 225, tolerance: 60 },  // SW toward Waveland Ave
    'yankee_stadium':          { out: 270, tolerance: 45 },  // W toward RF short porch
    'fenway_park':             { out: 200, tolerance: 45 },  // SSW toward Green Monster
    'coors_field':             { out: 180, tolerance: 90 },  // Any south wind
    'citizens_bank_park':      { out: 225, tolerance: 45 },  // SW
    'great_american_ballpark': { out: 200, tolerance: 45 },  // S
    'oracle_park':             { out: 270, tolerance: 45 },  // W (fights SF marine layer)
  };

  const parkConfig = OUT_DIRECTIONS[venueKey];
  if (!parkConfig) return 'crosswind';

  const diff = Math.abs(((windDirDeg - parkConfig.out) % 360 + 360) % 360);
  const normalizedDiff = diff > 180 ? 360 - diff : diff;

  if (normalizedDiff <= parkConfig.tolerance / 2) return 'blowing_out';
  if (normalizedDiff >= 180 - parkConfig.tolerance / 2) return 'blowing_in';
  return 'crosswind';
}

// ---------------------------------------------------------------------------
// Factor calculation helpers (used by mlbProjectionModel.py via Node API)
// ---------------------------------------------------------------------------

/**
 * Calculate HR factor multiplier from weather.
 * Called by the Python projection model after fetching weather from this service
 * via the /api/weather/venue endpoint.
 */
function calcHrFactor(weather, venueKey) {
  if (!weather?.weather_available) return 1.0;

  let factor = 1.0;
  const wind = weather.wind_mph || 0;
  const temp = weather.temp_f;
  const alt  = weather.altitude_ft || 0;

  // Wind effect
  if (wind > 15) {
    const effect = getWindEffect(weather.wind_dir_deg, venueKey);
    if (effect === 'blowing_out') {
      factor *= wind > 20 ? 1.25 : 1.15;
    } else if (effect === 'blowing_in') {
      factor *= 0.85;
    }
  }

  // Temperature effect (stronger for HR than hits)
  if (temp != null) {
    if      (temp < 50)  factor *= 0.88;
    else if (temp < 60)  factor *= 0.94;
    else if (temp < 65)  factor *= 0.97;
    else if (temp > 85)  factor *= 1.10;
    else if (temp > 75)  factor *= 1.05;
  }

  // Altitude bonus (stacked on top of park factor)
  if (alt >= 5000) factor *= 1.08;  // Coors Field
  else if (alt >= 1000) factor *= 1.02;

  return Math.round(factor * 1000) / 1000;
}

/**
 * Calculate hits factor multiplier from weather.
 */
function calcHitsFactor(weather, venueKey) {
  if (!weather?.weather_available) return 1.0;

  let factor = 1.0;
  const wind = weather.wind_mph || 0;
  const temp = weather.temp_f;

  if (wind > 15) {
    const effect = getWindEffect(weather.wind_dir_deg, venueKey);
    if (effect === 'blowing_out') factor *= 1.03;
    if (effect === 'blowing_in')  factor *= 0.95;
  }

  if (temp != null) {
    if      (temp < 50)  factor *= 0.97;
    else if (temp > 75)  factor *= 1.02;
  }

  return Math.round(factor * 1000) / 1000;
}

/**
 * Calculate total bases factor from weather (stronger than hits factor).
 */
function calcTbFactor(weather, venueKey) {
  if (!weather?.weather_available) return 1.0;

  let factor = 1.0;
  const wind = weather.wind_mph || 0;
  const temp = weather.temp_f;
  const alt  = weather.altitude_ft || 0;

  if (wind > 15) {
    const effect = getWindEffect(weather.wind_dir_deg, venueKey);
    if (effect === 'blowing_out') factor *= 1.12;
    if (effect === 'blowing_in')  factor *= 0.90;
  }

  if (temp != null) {
    if      (temp < 50)  factor *= 0.93;
    else if (temp < 65)  factor *= 0.97;
    else if (temp > 80)  factor *= 1.05;
  }

  if (alt >= 5000) factor *= 1.05;

  return Math.round(factor * 1000) / 1000;
}

/**
 * Calculate walks factor from weather (cold = more walks due to grip issues).
 */
function calcWalksFactor(weather) {
  if (!weather?.weather_available) return 1.0;
  const temp = weather.temp_f;
  if (temp == null) return 1.0;
  if (temp < 45) return 1.06;
  if (temp < 50) return 1.03;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Express routes — called by Python model via HTTP
// ---------------------------------------------------------------------------

const router = require('express').Router();

/**
 * GET /api/weather/venue/:venueKey
 * Used by mlbProjectionModel.py to fetch weather for a specific park.
 */
router.get('/venue/:venueKey', async (req, res) => {
  const weather = await fetchVenueWeather(req.params.venueKey);
  res.json(weather);
});

/**
 * GET /api/weather/all
 * Fetch all 30 venues at once. Called by the 8 AM cron.
 */
router.get('/all', async (req, res) => {
  const weatherMap = await fetchAllVenueWeather();
  res.json(weatherMap);
});

/**
 * GET /api/weather/team/:teamAbbr
 * Get weather for a team's home park.
 */
router.get('/team/:teamAbbr', async (req, res) => {
  const weather = await fetchVenueWeather(req.params.teamAbbr);
  res.json(weather);
});

/**
 * GET /api/weather/factors/:venueKey
 * Returns pre-calculated factor multipliers for the projection model.
 */
router.get('/factors/:venueKey', async (req, res) => {
  const venueKey = req.params.venueKey;
  const weather  = await fetchVenueWeather(venueKey);
  res.json({
    weather,
    factors: {
      hr:    calcHrFactor(weather, venueKey),
      hits:  calcHitsFactor(weather, venueKey),
      tb:    calcTbFactor(weather, venueKey),
      walks: calcWalksFactor(weather),
    },
  });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  router,
  fetchVenueWeather,
  fetchAllVenueWeather,
  getWeatherForTeam,
  getWeatherByVenueName,
  calcHrFactor,
  calcHitsFactor,
  calcTbFactor,
  calcWalksFactor,
  degreesToCompass,
  getWindEffect,
  MLB_VENUES,
};
