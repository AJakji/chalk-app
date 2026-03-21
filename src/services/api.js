import { API_URL, AFFILIATE_LINKS } from '../config';

// ── Picks ─────────────────────────────────────────────────────────────────

export async function fetchTodaysPicks() {
  const res = await fetch(`${API_URL}/api/picks/today`);
  if (!res.ok) throw new Error(`Picks API error: ${res.status}`);
  const { picks } = await res.json();
  return picks.map(normalizePick);
}

export async function fetchPickById(id) {
  const res = await fetch(`${API_URL}/api/picks/${id}`);
  if (!res.ok) throw new Error(`Pick not found: ${res.status}`);
  return normalizePick(await res.json());
}

// ── Users ─────────────────────────────────────────────────────────────────

export async function syncUser({ clerkToken, username, displayName, avatar }) {
  const res = await fetch(`${API_URL}/api/users/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clerkToken}`,
    },
    body: JSON.stringify({ username, displayName, avatar }),
  });
  if (!res.ok) throw new Error(`User sync failed: ${res.status}`);
  return res.json();
}

export async function fetchMe(clerkToken) {
  const res = await fetch(`${API_URL}/api/users/me`, {
    headers: { Authorization: `Bearer ${clerkToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  return res.json();
}

export async function followUser(targetId, clerkToken) {
  const res = await fetch(`${API_URL}/api/users/${targetId}/follow`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${clerkToken}` },
  });
  if (!res.ok) throw new Error(`Follow failed: ${res.status}`);
  return res.json(); // { following: true | false }
}

// ── Normalizer ────────────────────────────────────────────────────────────
// Maps the snake_case DB row → camelCase shape the UI components expect.

function normalizePick(row) {
  const odds = row.odds_data || {};
  const analysis = normalizeAnalysis(row.analysis);
  const bestBook = findBestBook(odds);

  return {
    id:          row.id,
    league:      row.league,
    pickType:    row.pick_type,
    awayTeam:    row.away_team,
    homeTeam:    row.home_team,
    gameTime:    row.game_time,
    pick:        row.pick_value,
    confidence:  row.confidence,
    shortReason: row.short_reason,
    result:      row.result ?? null,
    odds,
    bestOdds:    bestBook,        // the book KEY — e.g. 'fanduel'
    affiliateLinks: AFFILIATE_LINKS,
    analysis,
  };
}

// Handles both the old format (array) and new format (object with summary/sections/etc.)
function normalizeAnalysis(raw) {
  if (!raw) {
    return { summary: '', sections: [], keyStats: [], trends: [] };
  }

  // New format — Claude returns { summary, sections, keyStats, trends }
  if (raw.summary !== undefined) {
    return {
      summary:  raw.summary  || '',
      sections: raw.sections || [],
      keyStats: raw.keyStats || [],
      trends:   raw.trends   || [],
    };
  }

  // Old format — array of { title, body } — graceful fallback
  if (Array.isArray(raw)) {
    return {
      summary:  raw[0]?.body || '',
      sections: raw.map((s, i) => ({
        title:   s.title,
        icon:    ['🎯', '💰', '⚠️', '📊'][i] || '📋',
        content: s.body || s.content || '',
      })),
      keyStats: [],
      trends:   [],
    };
  }

  return { summary: '', sections: [], keyStats: [], trends: [] };
}

// For american odds: higher number = better for bettor (-108 > -115, +120 > -110)
function findBestBook(odds) {
  let bestBook = null;
  let bestVal = -Infinity;
  for (const [book, oddsStr] of Object.entries(odds)) {
    if (!oddsStr || oddsStr === 'N/A') continue;
    const num = parseInt(String(oddsStr).replace(/[^-\d]/g, ''), 10);
    if (!isNaN(num) && num > bestVal) {
      bestVal = num;
      bestBook = book;
    }
  }
  return bestBook;
}
