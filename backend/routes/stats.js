// Chalk Stats API — Teams list, team detail, leaders
// Data sources:
//   NBA  — BallDontLie (team list), team_game_logs (records), BDL injuries
//   NHL  — NHL Official API (standings, roster, schedule)
//   MLB  — MLB Stats API (standings, roster, schedule)

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bdl     = require('../services/ballDontLie');
const nhl     = require('../services/nhlApi');
const mlb     = require('../services/mlbStats');

// ── Cache ──────────────────────────────────────────────────────────────────────

const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data, ttlSec) {
  _cache.set(key, { data, expires: Date.now() + ttlSec * 1000 });
}

const TTL = {
  TEAMS:       3600,   // 1 hour
  TEAM_DETAIL: 1800,   // 30 min
};

// ── Season helpers ─────────────────────────────────────────────────────────────

function currentNHLSeason() {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  return m < 7 ? `${y - 1}${y}` : `${y}${y + 1}`;
}

function currentNBASeason() {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  return m < 7 ? y - 1 : y; // BDL uses starting year: 2025 for 2025-26
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ── GET /api/stats/teams/:sport ────────────────────────────────────────────────

router.get('/teams/:sport', async (req, res) => {
  const { sport } = req.params;
  if (!['NBA', 'NHL', 'MLB'].includes(sport)) {
    return res.status(400).json({ error: 'Sport must be NBA, NHL, or MLB' });
  }

  const cacheKey = `teams_${sport}`;
  const cached   = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    let teams = [];

    if (sport === 'NBA') {
      // Team list from BDL
      const allTeams = await bdl.getTeams();

      // W-L from team_game_logs (built by nightly pipeline)
      let wlMap  = {};
      let last5Map = {};
      try {
        const nbaSeason = `${currentNBASeason()}-${String(currentNBASeason() + 1).slice(2)}`;
        const [wlRows, last5Rows] = await Promise.all([
          db.query(
            `SELECT team_id::text,
                    SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END) AS losses
             FROM team_game_logs
             WHERE sport = 'NBA' AND season = $1
             GROUP BY team_id`,
            [nbaSeason]
          ),
          db.query(
            `SELECT team_id::text, result
             FROM (
               SELECT team_id, result,
                      ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY game_date DESC) AS rn
               FROM team_game_logs WHERE sport = 'NBA'
             ) t
             WHERE rn <= 5
             ORDER BY team_id, rn`
          ),
        ]);
        wlRows.rows.forEach(r => {
          wlMap[r.team_id] = { wins: parseInt(r.wins) || 0, losses: parseInt(r.losses) || 0 };
        });
        last5Rows.rows.forEach(r => {
          if (!last5Map[r.team_id]) last5Map[r.team_id] = [];
          last5Map[r.team_id].push(r.result);
        });
      } catch { /* DB may not have data yet — proceed without records */ }

      teams = (allTeams || []).map(t => ({
        id:           String(t.id),
        name:         t.full_name,
        abbreviation: t.abbreviation,
        city:         t.city,
        wins:         wlMap[String(t.id)]?.wins  ?? null,
        losses:       wlMap[String(t.id)]?.losses ?? null,
        last5:        last5Map[String(t.id)] || [],
      })).sort((a, b) => {
        if (a.wins === null && b.wins === null) return (a.name || '').localeCompare(b.name || '');
        if (a.wins === null) return 1;
        if (b.wins === null) return -1;
        return b.wins - a.wins;
      });
    }

    else if (sport === 'NHL') {
      const raw      = await nhl.getStandings();
      const list     = Array.isArray(raw) ? raw : (raw?.standings || raw?.teams || []);

      // Also pull last 5 from DB if available
      let last5Map = {};
      try {
        const rows = await db.query(
          `SELECT team_name, result
           FROM (
             SELECT team_name, result,
                    ROW_NUMBER() OVER (PARTITION BY team_name ORDER BY game_date DESC) AS rn
             FROM team_game_logs WHERE sport = 'NHL'
           ) t
           WHERE rn <= 5 ORDER BY team_name, rn`
        );
        rows.rows.forEach(r => {
          if (!last5Map[r.team_name]) last5Map[r.team_name] = [];
          last5Map[r.team_name].push(r.result);
        });
      } catch {}

      teams = list.map(t => {
        const abbrev = t.teamAbbrev?.default || t.teamAbbrev || t.abbrev || '';
        const name   = t.teamName?.default   || t.teamName   || t.name  || '';
        return {
          id:           abbrev,                // use abbrev as ID for NHL
          name,
          abbreviation: abbrev,
          division:     t.divisionName || '',
          wins:         t.wins   ?? null,
          losses:       t.losses ?? null,
          otLosses:     t.otLosses ?? null,
          points:       t.points ?? null,
          last5:        last5Map[name] || [],
        };
      }).filter(t => t.name);
    }

    else if (sport === 'MLB') {
      const season   = new Date().getFullYear();
      const raw      = await mlb.getStandings(season);
      const divisions = Array.isArray(raw) ? raw : (raw?.records || []);

      // Last 5 from DB
      let last5Map = {};
      try {
        const rows = await db.query(
          `SELECT team_name, result
           FROM (
             SELECT team_name, result,
                    ROW_NUMBER() OVER (PARTITION BY team_name ORDER BY game_date DESC) AS rn
             FROM team_game_logs WHERE sport = 'MLB'
           ) t
           WHERE rn <= 5 ORDER BY team_name, rn`
        );
        rows.rows.forEach(r => {
          if (!last5Map[r.team_name]) last5Map[r.team_name] = [];
          last5Map[r.team_name].push(r.result);
        });
      } catch {}

      const records = [];
      divisions.forEach(div => {
        (div.teamRecords || []).forEach(tr => {
          const name  = tr.team?.name || '';
          const abbr  = tr.team?.abbreviation || name.substring(0, 3).toUpperCase();
          records.push({
            id:           String(tr.team?.id),
            name,
            abbreviation: abbr,
            division:     div.division?.name || '',
            wins:         tr.wins   ?? null,
            losses:       tr.losses ?? null,
            pct:          tr.winningPercentage ?? null,
            last5:        last5Map[name] || [],
          });
        });
      });

      teams = records
        .filter(t => t.name)
        .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));
    }

    const data = { sport, teams, count: teams.length };
    cacheSet(cacheKey, data, TTL.TEAMS);
    res.json(data);
  } catch (err) {
    console.error(`[stats] teams/${sport} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/stats/teams/:sport/:teamId?name=X ────────────────────────────────

router.get('/teams/:sport/:teamId', async (req, res) => {
  const { sport, teamId } = req.params;
  const { name = '' }     = req.query;

  const cacheKey = `team_detail_${sport}_${teamId}`;
  const cached   = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const result = {
    recent_games:  [],
    upcoming_games:[],
    roster:        [],
    injuries:      [],
  };

  // ── Recent games from team_game_logs ─────────────────────────────────────────
  try {
    const nameClause = name ? `AND team_name ILIKE $3` : '';
    const params     = name ? [sport, todayStr(), `%${name.split(' ').slice(-1)[0]}%`] : [sport, todayStr()];
    const sql = `
      SELECT game_date, opponent, home_away, result,
             points_scored, points_allowed
      FROM team_game_logs
      WHERE sport = $1 AND game_date < $2
        AND (team_id::text = '${teamId}' ${name ? `OR team_name ILIKE $3` : ''})
      ORDER BY game_date DESC LIMIT 10
    `;
    // Safer: use parameterised query without inline interpolation
    let queryText, queryParams;
    if (name) {
      queryText  = `SELECT game_date, opponent, home_away, result, points_scored, points_allowed
                    FROM team_game_logs
                    WHERE sport = $1 AND game_date < $2 AND (team_id::text = $4 OR team_name ILIKE $3)
                    ORDER BY game_date DESC LIMIT 10`;
      queryParams = [sport, todayStr(), `%${name.split(' ').slice(-1)[0]}%`, teamId];
    } else {
      queryText  = `SELECT game_date, opponent, home_away, result, points_scored, points_allowed
                    FROM team_game_logs
                    WHERE sport = $1 AND game_date < $2 AND team_id::text = $3
                    ORDER BY game_date DESC LIMIT 10`;
      queryParams = [sport, todayStr(), teamId];
    }
    const rows = await db.query(queryText, queryParams);
    result.recent_games = rows.rows.map(r => ({
      date:       r.game_date?.toISOString?.()?.split('T')[0] || String(r.game_date),
      opponent:   r.opponent,
      home_away:  r.home_away,
      result:     r.result,
      pts_for:    r.points_scored,
      pts_against:r.points_allowed,
    }));
  } catch (e) {
    console.warn('[stats] team_game_logs query failed:', e.message);
  }

  // ── Sport-specific: roster, upcoming, injuries ────────────────────────────────

  const [rosterR, upcomingR, injuriesR] = await Promise.allSettled([
    fetchRoster(sport, teamId),
    fetchUpcoming(sport, teamId, currentNBASeason(), currentNHLSeason()),
    fetchInjuries(sport, teamId, name),
  ]);

  result.roster         = rosterR.status   === 'fulfilled' ? rosterR.value   : [];
  result.upcoming_games = upcomingR.status === 'fulfilled' ? upcomingR.value : [];
  result.injuries       = injuriesR.status === 'fulfilled' ? injuriesR.value : [];

  cacheSet(cacheKey, result, TTL.TEAM_DETAIL);
  res.json(result);
});

// ── Helpers for team detail ────────────────────────────────────────────────────

async function fetchRoster(sport, teamId) {
  if (sport === 'NBA') {
    const bdlId   = parseInt(teamId);
    if (isNaN(bdlId)) return [];
    const players = await bdl.getPlayers();
    return (players || [])
      .filter(p => p.team?.id === bdlId)
      .map(p => ({
        id:       p.id,
        name:     `${p.first_name} ${p.last_name}`.trim(),
        position: p.position || '—',
        number:   p.jersey_number || '—',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (sport === 'NHL') {
    const data = await nhl.getTeamRoster(teamId); // teamId = abbrev e.g. "BOS"
    const groups = [
      ...(data?.forwards   || []),
      ...(data?.defensemen || []),
      ...(data?.goalies    || []),
    ];
    return groups.map(p => ({
      id:       p.id,
      name:     `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim(),
      position: p.positionCode || '—',
      number:   String(p.sweaterNumber || '—'),
    }));
  }

  if (sport === 'MLB') {
    const mlbId = parseInt(teamId);
    if (isNaN(mlbId)) return [];
    const data = await mlb.getTeamRoster(mlbId);
    return (data?.roster || []).map(p => ({
      id:       p.person?.id,
      name:     p.person?.fullName || '—',
      position: p.position?.abbreviation || '—',
      number:   String(p.jerseyNumber || '—'),
    }));
  }

  return [];
}

async function fetchUpcoming(sport, teamId, nbaSeason, nhlSeason) {
  const today = todayStr();

  if (sport === 'NBA') {
    const bdlId = parseInt(teamId);
    if (isNaN(bdlId)) return [];
    const games = await bdl.getTeamGames(bdlId, nbaSeason);
    return (games || [])
      .filter(g => g.date >= today && g.status !== 'Final')
      .slice(0, 10)
      .map(g => ({
        date:     g.date,
        opponent: g.home_team?.id === bdlId
          ? g.visitor_team?.full_name
          : g.home_team?.full_name,
        home_away:g.home_team?.id === bdlId ? 'H' : 'A',
      }));
  }

  if (sport === 'NHL') {
    const raw   = await nhl.getTeamSeasonSchedule(teamId, nhlSeason);
    const games = Array.isArray(raw) ? raw : (raw?.games || []);
    return games
      .filter(g => {
        const d = g.gameDate || g.startTimeUTC?.split('T')[0];
        return d >= today;
      })
      .slice(0, 10)
      .map(g => {
        const isHome = g.homeTeam?.abbrev === teamId;
        const opp    = isHome
          ? (g.awayTeam?.commonName?.default || g.awayTeam?.abbrev)
          : (g.homeTeam?.commonName?.default || g.homeTeam?.abbrev);
        return {
          date:     g.gameDate || g.startTimeUTC?.split('T')[0],
          opponent: opp,
          home_away:isHome ? 'H' : 'A',
          time_utc: g.startTimeUTC,
        };
      });
  }

  if (sport === 'MLB') {
    const mlbId = parseInt(teamId);
    if (isNaN(mlbId)) return [];
    const season  = new Date().getFullYear();
    const sched   = await mlb.getTeamSchedule(mlbId, season);
    const upcoming = [];
    for (const d of (sched?.dates || [])) {
      for (const g of (d.games || [])) {
        const gDate = g.gameDate?.split('T')[0];
        if (gDate >= today) {
          const isHome = g.teams?.home?.team?.id === mlbId;
          upcoming.push({
            date:     gDate,
            opponent: isHome ? g.teams?.away?.team?.name : g.teams?.home?.team?.name,
            home_away:isHome ? 'H' : 'A',
            time_utc: g.gameDate,
          });
          if (upcoming.length >= 10) break;
        }
      }
      if (upcoming.length >= 10) break;
    }
    return upcoming;
  }

  return [];
}

async function fetchInjuries(sport, teamId, teamName) {
  if (sport === 'NBA') {
    const injuries = await bdl.getInjuries();
    const namePart = (teamName || '').split(' ').filter(w => w.length > 3).pop() || '';
    return (injuries || [])
      .filter(inj => {
        if (!namePart) return true;
        const t = (inj.team?.full_name || inj.team?.abbreviation || '').toLowerCase();
        return t.includes(namePart.toLowerCase());
      })
      .map(inj => ({
        player: `${inj.player?.first_name || ''} ${inj.player?.last_name || ''}`.trim(),
        injury: inj.description || inj.status || '—',
        status: inj.status || 'Out',
      }));
  }

  // NHL and MLB don't have public injury APIs we can easily use — return empty
  return [];
}

module.exports = router;
