/**
 * Date utilities for ET-aware date calculations.
 * Railway servers run on UTC — these helpers ensure pick queries
 * always use the correct Eastern Time date regardless of server TZ.
 */

// Returns true if the given UTC Date is in US Daylight Saving Time (EDT).
function isDST(d) {
  try {
    const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
    return etStr.includes('EDT');
  } catch {
    // Fallback: DST runs second Sunday of March → first Sunday of November
    const year = d.getUTCFullYear();
    const marchFirst = new Date(Date.UTC(year, 2, 1));
    const marchFirstDay = marchFirst.getUTCDay();
    const dstStart = new Date(Date.UTC(year, 2, (14 - marchFirstDay) % 7 + 1, 7));
    const novFirst = new Date(Date.UTC(year, 10, 1));
    const novFirstDay = novFirst.getUTCDay();
    const dstEnd = new Date(Date.UTC(year, 10, (7 - novFirstDay) % 7 + 1, 6));
    return d >= dstStart && d < dstEnd;
  }
}

// Returns today's date in ET as "YYYY-MM-DD".
// Correct on UTC servers: CURRENT_DATE in Postgres and new Date() in JS both
// use UTC, which flips at 8 PM ET (EDT) or 7 PM ET (EST) — too early.
function getTodayET() {
  const etOffset = isDST(new Date()) ? 4 : 5;
  const etNow = new Date(Date.now() - etOffset * 60 * 60 * 1000);
  return etNow.toISOString().split('T')[0];
}

module.exports = { isDST, getTodayET };
