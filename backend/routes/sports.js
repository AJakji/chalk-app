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
const espn     = require('../services/espn');

// ── Season helpers ────────────────────────────────────────────────────────────
// BDL uses the year the season started (e.g. 2025 for 2025-26)
function getBDLSeason() {
  const now = new Date();
  return now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}
// NHL uses concatenated start+end years (e.g. "20252026")
function getNHLSeason() {
  const start = getBDLSeason();
  return `${start}${start + 1}`;
}
// MLB uses the calendar year
function getMLBSeason() {
  return new Date().getFullYear().toString();
}

// ── Date formatter ────────────────────────────────────────────────────────────
function fmtDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch { return ''; }
}

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
// Pre-game and in-game context: injuries, team stats, goalie matchup, last 5, head-to-head
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
    // ── Injuries ─────────────────────────────────────────────────────────────
    let awayInjuries = [], homeInjuries = [];

    if (L === 'NBA') {
      const all = await bdl.getInjuries();
      const mapInj = (p) => ({
        name:        `${p.player?.first_name || ''} ${p.player?.last_name || ''}`.trim(),
        status:      p.status      || '',
        description: p.description || '',
      });
      awayInjuries = (all || []).filter(p => p.player?.team?.abbreviation === awayAbbr).slice(0, 8).map(mapInj);
      homeInjuries = (all || []).filter(p => p.player?.team?.abbreviation === homeAbbr).slice(0, 8).map(mapInj);
    }

    if (L === 'NHL' || L === 'MLB') {
      const all = await espn.getInjuries(L);
      const mapInj = (p) => ({ name: p.playerName, status: p.status, description: p.description });
      awayInjuries = (all || []).filter(p => p.teamAbbr === awayAbbr).slice(0, 8).map(mapInj);
      homeInjuries = (all || []).filter(p => p.teamAbbr === homeAbbr).slice(0, 8).map(mapInj);
    }

    // ── Team season stats ─────────────────────────────────────────────────────
    let awayTeamStats = null, homeTeamStats = null;

    if (L === 'NBA') {
      const raw = await bdl.getTeamStats(getBDLSeason());
      if (Array.isArray(raw)) {
        const find = (abbr) => raw.find(t => t.team?.abbreviation === abbr);
        const map = (t) => t ? {
          ppg:   t.pts      != null ? Number(t.pts).toFixed(1)           : '--',
          rpg:   t.reb      != null ? Number(t.reb).toFixed(1)           : '--',
          apg:   t.ast      != null ? Number(t.ast).toFixed(1)           : '--',
          fg:    t.fg_pct   != null ? `${(t.fg_pct  * 100).toFixed(1)}%` : '--',
          three: t.fg3_pct  != null ? `${(t.fg3_pct * 100).toFixed(1)}%` : '--',
          ft:    t.ft_pct   != null ? `${(t.ft_pct  * 100).toFixed(1)}%` : '--',
          tov:   t.turnover != null ? Number(t.turnover).toFixed(1)      : '--',
          blk:   t.blk      != null ? Number(t.blk).toFixed(1)           : '--',
          stl:   t.stl      != null ? Number(t.stl).toFixed(1)           : '--',
        } : null;
        awayTeamStats = map(find(awayAbbr));
        homeTeamStats = map(find(homeAbbr));
      }
    }

    if (L === 'NHL') {
      const standings = await nhlApi.getStandings();
      if (Array.isArray(standings)) {
        const find = (abbr) => standings.find(t => t.teamAbbrev?.default === abbr);
        const map = (t) => t ? {
          wins:  t.wins     || 0,
          losses: t.losses  || 0,
          otl:   t.otLosses || 0,
          gf:    t.goalFor      != null ? (t.goalFor   / (t.gamesPlayed || 1)).toFixed(2) : '--',
          ga:    t.goalAgainst  != null ? (t.goalAgainst / (t.gamesPlayed || 1)).toFixed(2) : '--',
          ppPct: t.powerPlayPct != null ? `${t.powerPlayPct.toFixed(1)}%`   : '--',
          pkPct: t.penaltyKillPct != null ? `${t.penaltyKillPct.toFixed(1)}%` : '--',
        } : null;
        awayTeamStats = map(find(awayAbbr));
        homeTeamStats = map(find(homeAbbr));
      }
    }

    if (L === 'MLB') {
      const divs = await mlbStats.getStandings(getMLBSeason());
      if (Array.isArray(divs)) {
        const all = divs.flatMap(d => d.teamRecords || []);
        const find = (abbr) => all.find(t => t.team?.abbreviation === abbr);
        const map = (t) => t ? {
          w:   t.wins   || 0,
          l:   t.losses || 0,
          pct: t.winningPercentage || '--',
          gb:  t.gamesBack         || '--',
          rs:  t.runsScored   != null ? (t.runsScored   / (t.gamesPlayed || 1)).toFixed(2) : '--',
          ra:  t.runsAllowed  != null ? (t.runsAllowed  / (t.gamesPlayed || 1)).toFixed(2) : '--',
        } : null;
        awayTeamStats = map(find(awayAbbr));
        homeTeamStats = map(find(homeAbbr));
      }
    }

    // ── NHL goalie matchup ────────────────────────────────────────────────────
    let goalieMatchup = null;
    if (L === 'NHL') {
      try {
        const boxData = await nhlApi.getBoxScore(gameId);
        if (boxData) {
          const map = (g) => g ? {
            name:  g.name?.default || '',
            svPct: g.savePercentage != null ? g.savePercentage.toFixed(3) : '--',
            gaa:   '--',
            record: '--',
          } : null;
          const awayG = boxData.playerByGameStats?.awayTeam?.goalies || [];
          const homeG = boxData.playerByGameStats?.homeTeam?.goalies || [];
          if (awayG.length || homeG.length) {
            goalieMatchup = { away: map(awayG[0]), home: map(homeG[0]) };
          }
        }
      } catch (_) {}
    }

    // ── Last 5 games + Head-to-Head ───────────────────────────────────────────
    let awayLast5 = [], homeLast5 = [], headToHead = [];

    if (L === 'NBA' && awayAbbr && homeAbbr) {
      try {
        const allTeams   = await bdl.getTeams();
        const awayTeamId = allTeams.find(t => t.abbreviation === awayAbbr)?.id;
        const homeTeamId = allTeams.find(t => t.abbreviation === homeAbbr)?.id;

        if (awayTeamId && homeTeamId) {
          const season = getBDLSeason();
          const [awayGames, homeGames] = await Promise.all([
            bdl.getTeamGames(awayTeamId, season),
            bdl.getTeamGames(homeTeamId, season),
          ]);

          const completed = (games) => (games || [])
            .filter(g => (g.status || '').toLowerCase() === 'final')
            .sort((a, b) => new Date(b.date) - new Date(a.date));

          const formatGame = (g, focusId) => {
            const isHome   = g.home_team?.id === focusId;
            const opp      = isHome ? g.visitor_team : g.home_team;
            const myScore  = isHome ? g.home_team_score    : g.visitor_team_score;
            const oppScore = isHome ? g.visitor_team_score : g.home_team_score;
            return {
              date:      fmtDate(g.date),
              opponent:  opp?.full_name || opp?.abbreviation || '',
              isHome,
              result:    myScore > oppScore ? 'W' : 'L',
              teamScore: myScore,
              oppScore,
            };
          };

          const completedAway = completed(awayGames);
          const completedHome = completed(homeGames);

          awayLast5 = completedAway.slice(0, 5).map(g => formatGame(g, awayTeamId));
          homeLast5 = completedHome.slice(0, 5).map(g => formatGame(g, homeTeamId));

          headToHead = completedAway
            .filter(g => g.home_team?.id === homeTeamId || g.visitor_team?.id === homeTeamId)
            .slice(0, 5)
            .map(g => ({
              date:      fmtDate(g.date),
              awayAbbr:  g.visitor_team?.abbreviation,
              homeAbbr:  g.home_team?.abbreviation,
              awayScore: g.visitor_team_score,
              homeScore: g.home_team_score,
              awayWon:   g.visitor_team_score > g.home_team_score,
            }));
        }
      } catch (err) {
        console.warn('[gameinfo NBA last5]', err.message);
      }
    }

    if (L === 'NHL' && awayAbbr && homeAbbr) {
      try {
        const season = getNHLSeason();
        const [awayGames, homeGames] = await Promise.all([
          nhlApi.getTeamSeasonSchedule(awayAbbr, season),
          nhlApi.getTeamSeasonSchedule(homeAbbr, season),
        ]);

        const completed = (games) => (games || [])
          .filter(g => g.gameState === 'OFF')
          .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));

        const formatGame = (g, focusAbbr) => {
          const isHome   = g.homeTeam?.abbrev === focusAbbr;
          const opp      = isHome ? g.awayTeam : g.homeTeam;
          const myScore  = isHome ? g.homeTeam?.score : g.awayTeam?.score;
          const oppScore = isHome ? g.awayTeam?.score : g.homeTeam?.score;
          return {
            date:      fmtDate(g.gameDate),
            opponent:  sd.teamName('NHL', opp?.abbrev),
            isHome,
            result:    (myScore || 0) > (oppScore || 0) ? 'W' : 'L',
            teamScore: myScore,
            oppScore,
          };
        };

        const completedAway = completed(awayGames);
        const completedHome = completed(homeGames);

        awayLast5 = completedAway.slice(0, 5).map(g => formatGame(g, awayAbbr));
        homeLast5 = completedHome.slice(0, 5).map(g => formatGame(g, homeAbbr));

        headToHead = completedAway
          .filter(g => g.awayTeam?.abbrev === homeAbbr || g.homeTeam?.abbrev === homeAbbr)
          .slice(0, 5)
          .map(g => ({
            date:      fmtDate(g.gameDate),
            awayAbbr:  g.awayTeam?.abbrev,
            homeAbbr:  g.homeTeam?.abbrev,
            awayScore: g.awayTeam?.score,
            homeScore: g.homeTeam?.score,
            awayWon:   (g.awayTeam?.score || 0) > (g.homeTeam?.score || 0),
          }));
      } catch (err) {
        console.warn('[gameinfo NHL last5]', err.message);
      }
    }

    if (L === 'MLB' && awayAbbr && homeAbbr) {
      try {
        const season = getMLBSeason();
        const [awayTeamId, homeTeamId] = await Promise.all([
          mlbStats.getTeamIdByAbbr(awayAbbr),
          mlbStats.getTeamIdByAbbr(homeAbbr),
        ]);

        if (awayTeamId && homeTeamId) {
          const [awayGames, homeGames] = await Promise.all([
            mlbStats.getTeamSchedule(awayTeamId, season),
            mlbStats.getTeamSchedule(homeTeamId, season),
          ]);

          const completed = (games) => (games || [])
            .filter(g => (g.status?.detailedState || '').toLowerCase().includes('final'))
            .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));

          const formatGame = (g, focusAbbr) => {
            const isHome   = g.teams?.home?.team?.abbreviation === focusAbbr;
            const myTeam   = isHome ? g.teams?.home : g.teams?.away;
            const oppTeam  = isHome ? g.teams?.away : g.teams?.home;
            const myScore  = myTeam?.score  ?? null;
            const oppScore = oppTeam?.score ?? null;
            return {
              date:      fmtDate(g.gameDate),
              opponent:  oppTeam?.team?.name || oppTeam?.team?.abbreviation || '',
              isHome,
              result:    (myScore ?? 0) > (oppScore ?? 0) ? 'W' : 'L',
              teamScore: myScore,
              oppScore,
            };
          };

          const completedAway = completed(awayGames);
          const completedHome = completed(homeGames);

          awayLast5 = completedAway.slice(0, 5).map(g => formatGame(g, awayAbbr));
          homeLast5 = completedHome.slice(0, 5).map(g => formatGame(g, homeAbbr));

          headToHead = completedAway
            .filter(g =>
              g.teams?.home?.team?.abbreviation === homeAbbr ||
              g.teams?.away?.team?.abbreviation === homeAbbr
            )
            .slice(0, 5)
            .map(g => ({
              date:      fmtDate(g.gameDate),
              awayAbbr:  g.teams?.away?.team?.abbreviation,
              homeAbbr:  g.teams?.home?.team?.abbreviation,
              awayScore: g.teams?.away?.score,
              homeScore: g.teams?.home?.score,
              awayWon:   (g.teams?.away?.score || 0) > (g.teams?.home?.score || 0),
            }));
        }
      } catch (err) {
        console.warn('[gameinfo MLB last5]', err.message);
      }
    }

    res.json({ ...empty, awayInjuries, homeInjuries, awayTeamStats, homeTeamStats, goalieMatchup, awayLast5, homeLast5, headToHead });
  } catch (err) {
    console.error(`[/api/sports/gameinfo] ${err.message}`);
    res.json(empty);
  }
});

module.exports = router;
