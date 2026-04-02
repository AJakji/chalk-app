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

// ── Standings constants ────────────────────────────────────────────────────────

// BDL abbreviation → ESPN CDN abbreviation (only exceptions from lowercase rule)
const NBA_ESPN_MAP = {
  ATL:'atl', BOS:'bos', BKN:'bkn', CHA:'cha', CHI:'chi', CLE:'cle',
  DAL:'dal', DEN:'den', DET:'det', GSW:'gsw', HOU:'hou', IND:'ind',
  LAC:'lac', LAL:'lal', MEM:'mem', MIA:'mia', MIL:'mil', MIN:'min',
  NOP:'nop', NYK:'nyk', OKC:'okc', ORL:'orl', PHI:'phi', PHX:'phx',
  POR:'por', SAC:'sac', SAS:'sas', TOR:'tor', UTA:'uta', WAS:'wsh',
};

const NBA_DIV_ORDER  = { East: ['Atlantic','Central','Southeast'], West: ['Northwest','Pacific','Southwest'] };
const NHL_DIV_TO_CONF = { Atlantic:'Eastern', Metropolitan:'Eastern', Central:'Western', Pacific:'Western' };
const MLB_CONF_DIV = {
  'American League': ['AL East','AL Central','AL West'],
  'National League': ['NL East','NL Central','NL West'],
};

// ── Standings helpers ──────────────────────────────────────────────────────────

async function getNBAStandings() {
  const season = (() => {
    const y = new Date().getFullYear(), m = new Date().getMonth() + 1;
    const s = m < 7 ? y - 1 : y;
    return `${s}-${String(s + 1).slice(2)}`;
  })();

  // Get team structure from BDL (includes conference + division)
  const allTeams = await bdl.getTeams();

  // W-L from team_game_logs
  let wlMap = {};
  try {
    const rows = await db.query(
      `SELECT team_id::text,
              SUM(CASE WHEN result='W' THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN result='L' THEN 1 ELSE 0 END) AS losses
       FROM team_game_logs WHERE sport='NBA' AND season=$1 GROUP BY team_id`,
      [season]
    );
    rows.rows.forEach(r => { wlMap[r.team_id] = { wins: +r.wins, losses: +r.losses }; });
  } catch {}

  let teams = (allTeams || []).map(t => {
    const wl  = wlMap[String(t.id)] || {};
    const w   = wl.wins   ?? 0;
    const l   = wl.losses ?? 0;
    const gp  = w + l;
    return {
      id:           String(t.id),
      name:         t.full_name,
      espnAbbr:     NBA_ESPN_MAP[t.abbreviation] || t.abbreviation?.toLowerCase() || '',
      conference:   t.conference,   // 'East' or 'West'
      division:     t.division,     // 'Atlantic', 'Central', etc.
      wins: w, losses: l,
      pct:  gp > 0 ? (w / gp).toFixed(3).replace('0.', '.') : '—',
      gb:   '—', gp: null, otl: null, pts: null,
      divisionRank: 0, conferenceRank: 0, playoffStatus: 'missed',
    };
  });

  // Division ranks
  const divGroups = {};
  teams.forEach(t => {
    const k = `${t.conference}_${t.division}`;
    (divGroups[k] = divGroups[k] || []).push(t);
  });
  Object.values(divGroups).forEach(g => {
    g.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    g.forEach((t, i) => { t.divisionRank = i + 1; });
  });

  // Conference ranks + playoff status
  ['East', 'West'].forEach(conf => {
    const ct = teams.filter(t => t.conference === conf).sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    ct.forEach((t, i) => {
      t.conferenceRank = i + 1;
      t.playoffStatus  = i < 6 ? 'playoff' : i < 10 ? 'playin' : 'missed';
    });
    // GB vs leader
    const leader = ct[0];
    if (leader) {
      ct.forEach(t => {
        if (t.id === leader.id) { t.gb = '—'; return; }
        const diff = ((leader.wins - leader.losses) - (t.wins - t.losses)) / 2;
        t.gb = diff % 1 === 0 ? String(diff) : String(diff.toFixed(1));
      });
    }
  });

  // Organize by conference → division
  return ['East', 'West'].map(conf => ({
    name: conf === 'East' ? 'Eastern Conference' : 'Western Conference',
    divisions: (NBA_DIV_ORDER[conf] || []).map(div => ({
      name: div,
      teams: teams.filter(t => t.conference === conf && t.division === div)
                  .sort((a, b) => a.divisionRank - b.divisionRank),
    })),
  }));
}

async function getNHLStandings() {
  const raw  = await nhl.getStandings();
  const list = Array.isArray(raw) ? raw : (raw?.standings || []);

  const teams = list.map(t => {
    const abbr = t.teamAbbrev?.default || t.teamAbbrev || '';
    const name = t.teamName?.default   || t.teamName   || '';
    const div  = t.divisionName || '';
    return {
      id: abbr, name, espnAbbr: abbr.toLowerCase(),
      conference:   NHL_DIV_TO_CONF[div] || 'Eastern',
      division:     div,
      wins:  t.wins         ?? 0,
      losses:t.losses       ?? 0,
      gp:    t.gamesPlayed  ?? 0,
      otl:   t.otLosses     ?? 0,
      pts:   t.points       ?? 0,
      pct: null, gb: null, divisionRank: 0, conferenceRank: 0, playoffStatus: 'missed',
    };
  }).filter(t => t.name);

  // Division ranks (by points)
  ['Atlantic','Metropolitan','Central','Pacific'].forEach(div => {
    const dt = teams.filter(t => t.division === div).sort((a, b) => b.pts - a.pts || b.wins - a.wins);
    dt.forEach((t, i) => { t.divisionRank = i + 1; if (i < 3) t.playoffStatus = 'playoff'; });
  });

  // Wildcard: top 2 non-playoff per conference
  ['Eastern','Western'].forEach(conf => {
    const ct = teams.filter(t => t.conference === conf).sort((a, b) => b.pts - a.pts);
    ct.forEach((t, i) => { t.conferenceRank = i + 1; });
    ct.filter(t => t.playoffStatus !== 'playoff').sort((a, b) => b.pts - a.pts)
      .forEach((t, i) => { t.playoffStatus = i < 2 ? 'wildcard' : 'missed'; });
  });

  return ['Eastern','Western'].map(conf => ({
    name: `${conf}ern Conference`,
    divisions: (conf === 'Eastern' ? ['Atlantic','Metropolitan'] : ['Central','Pacific']).map(div => ({
      name: div,
      teams: teams.filter(t => t.division === div).sort((a, b) => a.divisionRank - b.divisionRank),
    })),
  }));
}

async function getMLBStandings() {
  const season = new Date().getFullYear();
  const raw    = await mlb.getStandings(season);
  const divs   = Array.isArray(raw) ? raw : (raw?.records || []);

  const teams = [];
  divs.forEach(div => {
    const divName = div.division?.name || div.division?.nameShort || '';
    const conf = divName.startsWith('A') ? 'American League' : 'National League';
    (div.teamRecords || []).forEach((tr, i) => {
      const abbr = (tr.team?.abbreviation || '').toLowerCase();
      teams.push({
        id:     String(tr.team?.id),
        name:   tr.team?.name || '',
        espnAbbr: abbr,
        conference: conf, division: divName,
        wins:   tr.wins   ?? 0,
        losses: tr.losses ?? 0,
        pct:    tr.winningPercentage ? parseFloat(tr.winningPercentage).toFixed(3).replace('0.','.') : '—',
        gb:     tr.gamesBack === 0 ? '—' : String(tr.gamesBack ?? '—'),
        gp: null, otl: null, pts: null,
        divisionRank: i + 1, conferenceRank: 0, playoffStatus: i === 0 ? 'playoff' : 'missed',
      });
    });
  });

  // Wildcard: top 3 non-division-winner per league
  ['American League','National League'].forEach(conf => {
    const ct = teams.filter(t => t.conference === conf).sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    ct.forEach((t, i) => { t.conferenceRank = i + 1; });
    ct.filter(t => t.playoffStatus !== 'playoff').sort((a, b) => b.wins - a.wins)
      .forEach((t, i) => { t.playoffStatus = i < 3 ? 'wildcard' : 'missed'; });
  });

  return ['American League','National League'].map(conf => ({
    name: conf,
    divisions: (MLB_CONF_DIV[conf] || []).map(div => ({
      name: div,
      teams: teams.filter(t => t.division === div).sort((a, b) => a.divisionRank - b.divisionRank),
    })),
  }));
}

// ── GET /api/stats/standings/:sport ───────────────────────────────────────────

router.get('/standings/:sport', async (req, res) => {
  const { sport } = req.params;
  if (!['NBA','NHL','MLB'].includes(sport)) {
    return res.status(400).json({ error: 'Sport must be NBA, NHL, or MLB' });
  }

  const cacheKey = `standings_${sport}`;
  const cached   = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    let conferences;
    if (sport === 'NBA')      conferences = await getNBAStandings();
    else if (sport === 'NHL') conferences = await getNHLStandings();
    else                      conferences = await getMLBStandings();

    const data = { sport, conferences, updated: new Date().toISOString() };
    cacheSet(cacheKey, data, TTL.TEAMS);
    res.json(data);
  } catch (err) {
    console.error(`[stats] standings/${sport}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
