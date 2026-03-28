/**
 * /api/sports — Unified sports data proxy
 * NBA: BallDontLie API | NHL: NHL Official API | MLB: MLB Official Stats API
 */

const express  = require('express');
const router   = express.Router();
const sd       = require('../services/sportsdata');
const bdl      = require('../services/ballDontLie');
const nhlApi   = require('../services/nhlApi');
const mlbStats = require('../services/mlbStats');

// ── GET /api/sports/boxscore?league=NBA&gameId=123 ────────────────────────────
router.get('/boxscore', async (req, res) => {
  const { league, gameId } = req.query;
  if (!league || !gameId) return res.status(400).json({ error: 'league and gameId required' });

  const L = league.toUpperCase();
  try {
    let mapped = null;

    if (L === 'NBA') {
      const statsRows = await bdl.getStatsByGame(gameId);
      mapped = sd.mapBDLBoxScore(statsRows);
    } else if (L === 'NHL') {
      const boxData = await nhlApi.getBoxScore(gameId);
      mapped = sd.mapNHLApiBoxScore(boxData);
    } else if (L === 'MLB') {
      const [boxData, linescoreData] = await Promise.all([
        mlbStats.getBoxScore(gameId),
        mlbStats.getLiveLinescore(gameId),
      ]);
      mapped = sd.mapMLBStatsBoxScore(boxData, linescoreData);
    }

    res.json({ data: mapped });
  } catch (err) {
    console.error(`[/api/sports/boxscore] ${err.message}`);
    res.json({ data: null });
  }
});

// ── GET /api/sports/playbyplay?league=NBA&gameId=123 ──────────────────────────
router.get('/playbyplay', async (req, res) => {
  const { league, gameId } = req.query;
  if (!league || !gameId) return res.status(400).json({ error: 'league and gameId required' });

  const L = league.toUpperCase();
  try {
    if (L === 'NBA') {
      const plays = await bdl.getPlayByPlay(gameId);
      return res.json({ data: sd.mapBDLPBP(plays) });
    }
    if (L === 'NHL') {
      const data = await nhlApi.getPlayByPlay(gameId);
      return res.json({ data: sd.mapNHLApiPBP(data) });
    }
    if (L === 'MLB') {
      const data = await mlbStats.getPlayByPlay(gameId);
      return res.json({ data: sd.mapMLBStatsPBP(data) });
    }
    res.json({ data: [] });
  } catch (err) {
    console.error(`[/api/sports/playbyplay] ${err.message}`);
    res.json({ data: [] });
  }
});

// ── GET /api/sports/standings?league=NBA&season=2025 ──────────────────────────
router.get('/standings', async (req, res) => {
  const L = (req.query.league || '').toUpperCase();
  try {
    let data = null;
    if (L === 'NBA') {
      data = await bdl.getTeamStats(2024);
    } else if (L === 'NHL') {
      data = await nhlApi.getStandings();
    } else if (L === 'MLB') {
      const year = (req.query.season || new Date().getFullYear()).toString();
      data = await mlbStats.getStandings(year);
    }
    res.json({ data: data || [] });
  } catch (err) {
    res.json({ data: [] });
  }
});

// ── GET /api/sports/news?league=NBA ───────────────────────────────────────────
// Free official APIs do not have news endpoints — return empty.
router.get('/news', async (req, res) => {
  res.json({ data: [] });
});

// ── GET /api/sports/injuries?league=NBA ───────────────────────────────────────
router.get('/injuries', async (req, res) => {
  const L = (req.query.league || '').toUpperCase();
  try {
    let data = null;
    if (L === 'NBA') data = await bdl.getInjuries();
    // NHL and MLB official APIs do not expose injury endpoints
    res.json({ data: data || [] });
  } catch (err) {
    res.json({ data: [] });
  }
});

// ── GET /api/sports/mlblive?gameId=12345 ─────────────────────────────────────
// Live at-bat state for a specific MLB game (balls, strikes, outs, bases, pitcher, batter)
router.get('/mlblive', async (req, res) => {
  const { gameId } = req.query;
  if (!gameId) return res.status(400).json({ error: 'gameId required' });

  try {
    const ls = await mlbStats.getLiveLinescore(gameId);
    if (!ls) return res.json({ liveState: null });

    const liveState = {
      inning:         ls.currentInning || null,
      inningHalf:     ls.inningHalf === 'Bottom' ? 'B' : (ls.inningHalf === 'Top' ? 'T' : null),
      balls:          ls.balls    ?? null,
      strikes:        ls.strikes  ?? null,
      outs:           ls.outs     ?? null,
      firstBase:      !!(ls.offense?.first),
      secondBase:     !!(ls.offense?.second),
      thirdBase:      !!(ls.offense?.third),
      currentPitcher: ls.defense?.pitcher?.fullName || '',
      currentHitter:  ls.offense?.batter?.fullName  || '',
      awayScore:      ls.teams?.away?.runs ?? null,
      homeScore:      ls.teams?.home?.runs ?? null,
    };

    res.json({ liveState });
  } catch (err) {
    console.error(`[/api/sports/mlblive] ${err.message}`);
    res.json({ liveState: null });
  }
});

// ── GET /api/sports/gameinfo?league=NBA&gameId=123&awayAbbr=BOS&homeAbbr=MIA ──
// Pre-game and in-game context: injuries, team stats, goalie matchup (NHL)
router.get('/gameinfo', async (req, res) => {
  const { league, gameId, awayAbbr, homeAbbr } = req.query;
  if (!league || !gameId) return res.status(400).json({ error: 'league and gameId required' });

  const L = (league || '').toUpperCase();
  const empty = {
    arena: '', arenaCity: '', officials: [],
    awayInjuries: [], homeInjuries: [],
    awayLast5: [], homeLast5: [], headToHead: [],
    goalieMatchup: null, awayTeamStats: null, homeTeamStats: null, keyPlayers: null,
  };

  try {
    // ── Injuries ──
    let awayInjuries = [], homeInjuries = [];
    if (L === 'NBA') {
      const allInjuries = await bdl.getInjuries();
      const mapInj = (p) => ({
        name:        `${p.player?.first_name || ''} ${p.player?.last_name || ''}`.trim(),
        status:      p.status      || '',
        description: p.description || '',
      });
      awayInjuries = (allInjuries || []).filter(p => (p.player?.team?.abbreviation || '') === awayAbbr).slice(0, 8).map(mapInj);
      homeInjuries = (allInjuries || []).filter(p => (p.player?.team?.abbreviation || '') === homeAbbr).slice(0, 8).map(mapInj);
    }

    // ── Team season stats ──
    let awayTeamStats = null, homeTeamStats = null;

    if (L === 'NBA') {
      const teamStatsRaw = await bdl.getTeamStats(2024);
      if (Array.isArray(teamStatsRaw)) {
        const find = (abbr) => teamStatsRaw.find(t => (t.team?.abbreviation || '') === abbr);
        const mapStats = (t) => t ? {
          ppg:   t.pts  != null ? Number(t.pts).toFixed(1)  : '--',
          rpg:   t.reb  != null ? Number(t.reb).toFixed(1)  : '--',
          apg:   t.ast  != null ? Number(t.ast).toFixed(1)  : '--',
          fg:    t.fg_pct  != null ? `${(t.fg_pct  * 100).toFixed(1)}%` : '--',
          three: t.fg3_pct != null ? `${(t.fg3_pct * 100).toFixed(1)}%` : '--',
          ft:    t.ft_pct  != null ? `${(t.ft_pct  * 100).toFixed(1)}%` : '--',
          tov:   t.turnover != null ? Number(t.turnover).toFixed(1) : '--',
          blk:   t.blk != null ? Number(t.blk).toFixed(1) : '--',
          stl:   t.stl != null ? Number(t.stl).toFixed(1) : '--',
        } : null;
        awayTeamStats = mapStats(find(awayAbbr));
        homeTeamStats = mapStats(find(homeAbbr));
      }
    }

    if (L === 'NHL') {
      const standings = await nhlApi.getStandings();
      if (Array.isArray(standings)) {
        const find = (abbr) => standings.find(t => (t.teamAbbrev?.default || '') === abbr);
        const mapStats = (t) => t ? {
          gf:    t.goalFor   != null ? Number(t.goalFor   / (t.gamesPlayed || 1)).toFixed(2) : '--',
          ga:    t.goalAgainst != null ? Number(t.goalAgainst / (t.gamesPlayed || 1)).toFixed(2) : '--',
          ppPct: t.powerPlayPct != null ? `${t.powerPlayPct.toFixed(1)}%` : '--',
          pkPct: t.penaltyKillPct != null ? `${t.penaltyKillPct.toFixed(1)}%` : '--',
          wins:  t.wins  || 0,
          losses: t.losses || 0,
          otl:   t.otLosses || 0,
        } : null;
        awayTeamStats = mapStats(find(awayAbbr));
        homeTeamStats = mapStats(find(homeAbbr));
      }
    }

    if (L === 'MLB') {
      const year = new Date().getFullYear().toString();
      const divs = await mlbStats.getStandings(year);
      if (Array.isArray(divs)) {
        const all = divs.flatMap(d => d.teamRecords || []);
        const find = (abbr) => all.find(t => t.team?.abbreviation === abbr);
        const mapStats = (t) => t ? {
          w:    t.wins   || 0,
          l:    t.losses || 0,
          pct:  t.winningPercentage || '--',
          gb:   t.gamesBack || '--',
          rs:   t.runsScored    != null ? Number(t.runsScored    / (t.gamesPlayed || 1)).toFixed(2) : '--',
          ra:   t.runsAllowed   != null ? Number(t.runsAllowed   / (t.gamesPlayed || 1)).toFixed(2) : '--',
        } : null;
        awayTeamStats = mapStats(find(awayAbbr));
        homeTeamStats = mapStats(find(homeAbbr));
      }
    }

    // ── NHL goalie matchup ──
    let goalieMatchup = null;
    if (L === 'NHL') {
      try {
        const boxData = await nhlApi.getBoxScore(gameId);
        if (boxData) {
          const mapGoalie = (g) => g ? {
            name:   g.name?.default || '',
            svPct:  g.savePercentage != null ? g.savePercentage.toFixed(3) : '--',
            gaa:    '--',  // Not available from box score alone
            record: '--',
          } : null;
          const awayGoalies = boxData.playerByGameStats?.awayTeam?.goalies || [];
          const homeGoalies = boxData.playerByGameStats?.homeTeam?.goalies || [];
          if (awayGoalies.length || homeGoalies.length) {
            goalieMatchup = {
              away: mapGoalie(awayGoalies[0]),
              home: mapGoalie(homeGoalies[0]),
            };
          }
        }
      } catch (_) {}
    }

    res.json({ ...empty, awayInjuries, homeInjuries, awayTeamStats, homeTeamStats, goalieMatchup });
  } catch (err) {
    console.error(`[/api/sports/gameinfo] ${err.message}`);
    res.json(empty);
  }
});

module.exports = router;
