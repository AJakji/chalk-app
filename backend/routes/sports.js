/**
 * /api/sports — Unified SportsData.io proxy
 * Box scores and play-by-play for all leagues.
 */

const express = require('express');
const router = express.Router();
const sd = require('../services/sportsdata');
const mlbStats = require('../services/mlbStats');

// GET /api/sports/boxscore?league=NBA&gameId=123
router.get('/boxscore', async (req, res) => {
  const { league, gameId } = req.query;
  if (!league || !gameId) return res.status(400).json({ error: 'league and gameId required' });

  try {
    let raw = null;
    let mapped = null;
    const L = league.toUpperCase();

    if (L === 'NBA') {
      raw = await sd.nbaBoxScore(gameId);
      mapped = sd.mapNBABoxScore(raw);
    } else if (L === 'NHL') {
      raw = await sd.nhlBoxScore(gameId);
      mapped = sd.mapNHLBoxScore(raw);
    } else if (L === 'MLB') {
      const [boxData, linescoreData] = await Promise.all([
        mlbStats.getBoxScore(gameId),
        mlbStats.getLiveLinescore(gameId),
      ]);
      mapped = sd.mapMLBStatsBoxScore(boxData, linescoreData);
    } else if (L === 'NFL') {
      raw = await sd.nflBoxScore(gameId);
      mapped = sd.mapNBABoxScore(raw); // NFL box score uses similar PlayerGames structure
    } else {
      return res.json({ data: null });
    }

    res.json({ data: mapped });
  } catch (err) {
    console.error(`[/api/sports/boxscore] ${err.message}`);
    res.json({ data: null });
  }
});

// GET /api/sports/playbyplay?league=NBA&gameId=123
router.get('/playbyplay', async (req, res) => {
  const { league, gameId } = req.query;
  if (!league || !gameId) return res.status(400).json({ error: 'league and gameId required' });

  try {
    let raw = null;
    const L = league.toUpperCase();

    if (L === 'MLB') {
      const pbpData = await mlbStats.getPlayByPlay(gameId);
      return res.json({ data: sd.mapMLBStatsPBP(pbpData) });
    }

    if (L === 'NBA')      raw = await sd.nbaPlayByPlay(gameId);
    else if (L === 'NHL') raw = await sd.nhlPlayByPlay(gameId);
    else if (L === 'NFL') raw = await sd.nflPlayByPlay(gameId);
    else return res.json({ data: [] });

    const plays = sd.mapPBP(raw, L);
    res.json({ data: plays });
  } catch (err) {
    console.error(`[/api/sports/playbyplay] ${err.message}`);
    res.json({ data: [] });
  }
});

// GET /api/sports/standings?league=NBA&season=2025
router.get('/standings', async (req, res) => {
  const { league, season } = req.query;
  const s = season || process.env.CURRENT_SEASON || '2025';
  try {
    let data = null;
    const L = (league || '').toUpperCase();
    if (L === 'NBA')      data = await sd.nbaStandings(s);
    else if (L === 'NHL') data = await sd.nhlStandings(s);
    else if (L === 'MLB') data = await sd.mlbStandings(s);
    else if (L === 'NFL') data = await sd.nflStandings(s);
    res.json({ data });
  } catch (err) {
    res.json({ data: null });
  }
});

// GET /api/sports/news?league=NBA
router.get('/news', async (req, res) => {
  const L = (req.query.league || '').toUpperCase();
  try {
    let data = null;
    if (L === 'NBA')      data = await sd.nbaNews();
    else if (L === 'NHL') data = await sd.nhlNews();
    else if (L === 'MLB') data = await sd.mlbNews();
    else if (L === 'NFL') data = await sd.nflNews();
    else if (L === 'SOCCER') data = await sd.soccerNews();
    res.json({ data: data || [] });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/sports/injuries?league=NBA
router.get('/injuries', async (req, res) => {
  const L = (req.query.league || '').toUpperCase();
  try {
    let data = null;
    if (L === 'NBA')      data = await sd.nbaInjuries();
    else if (L === 'NHL') data = await sd.nhlInjuries();
    else if (L === 'MLB') data = await sd.mlbInjuries();
    else if (L === 'NFL') data = await sd.nflInjuries();
    res.json({ data: data || [] });
  } catch (err) {
    res.json({ data: [] });
  }
});

// GET /api/sports/mlblive?date=YYYY-MM-DD&gameId=123
// Returns live at-bat state for a specific MLB game (balls, strikes, outs, bases, pitcher, batter)
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

// GET /api/sports/gameinfo?league=NBA&gameId=123&awayAbbr=GS&homeAbbr=BOS
// Returns arena, officials, injuries, team last 5, head-to-head for Game Info tab
router.get('/gameinfo', async (req, res) => {
  const { league, gameId, awayAbbr, homeAbbr } = req.query;
  if (!league || !gameId) return res.status(400).json({ error: 'league and gameId required' });

  const L      = (league || '').toUpperCase();
  const season = process.env.CURRENT_SEASON || '2025';

  const empty = { arena: '', arenaCity: '', officials: [], awayInjuries: [], homeInjuries: [], awayLast5: [], homeLast5: [], headToHead: [] };

  try {
    // ── 1. Box score meta (arena / officials) ──
    let raw = null;
    if (L === 'NBA')      raw = await sd.nbaBoxScore(gameId);
    else if (L === 'NHL') raw = await sd.nhlBoxScore(gameId);
    else if (L === 'MLB') raw = await sd.mlbBoxScore(gameId);

    const meta = sd.extractGameMeta(raw || {});

    // ── 2. Injuries ──
    let injuriesRaw = null;
    if (L === 'NBA')      injuriesRaw = await sd.nbaInjuries();
    else if (L === 'NHL') injuriesRaw = await sd.nhlInjuries();
    else if (L === 'MLB') injuriesRaw = await sd.mlbInjuries();
    else if (L === 'NFL') injuriesRaw = await sd.nflInjuries();

    const mapInj = (p) => ({
      name:        p.Name || '',
      status:      p.Status || '',
      description: p.InjuryDescription || p.Practice || '',
    });
    const awayInjuries = (injuriesRaw || []).filter(p => p.Team === awayAbbr).slice(0, 8).map(mapInj);
    const homeInjuries = (injuriesRaw || []).filter(p => p.Team === homeAbbr).slice(0, 8).map(mapInj);

    // ── 3. Season games → last 5 + head-to-head ──
    let awayLast5 = [], homeLast5 = [], headToHead = [];
    let seasonGames = null;
    if (L === 'NBA') seasonGames = await sd.nbaGames(season);
    if (L === 'NHL') seasonGames = await sd.nhlGames(season);
    if (L === 'MLB') seasonGames = await sd.mlbGames(season);

    if (Array.isArray(seasonGames) && awayAbbr && homeAbbr) {
      const completed = seasonGames.filter(g => {
        const s = (g.Status || '').toLowerCase();
        return s === 'final' || s === 'f/ot' || s === 'f/so';
      });

      const formatTeamGame = (g, abbr) => {
        const isHome   = g.HomeTeam === abbr;
        const oppAbbr  = isHome ? g.AwayTeam : g.HomeTeam;
        const myScore  = isHome ? g.HomeTeamScore : g.AwayTeamScore;
        const oppScore = isHome ? g.AwayTeamScore : g.HomeTeamScore;
        const dateStr  = g.DateTime || g.Day || '';
        const date     = dateStr ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        return {
          date,
          opponent: sd.teamName(L, oppAbbr) || oppAbbr,
          isHome,
          result:   myScore > oppScore ? 'W' : 'L',
          teamScore: myScore,
          oppScore,
        };
      };

      const byDate = (a, b) => new Date(b.DateTime || b.Day || 0) - new Date(a.DateTime || a.Day || 0);

      awayLast5 = completed
        .filter(g => g.AwayTeam === awayAbbr || g.HomeTeam === awayAbbr)
        .sort(byDate).slice(0, 5)
        .map(g => formatTeamGame(g, awayAbbr));

      homeLast5 = completed
        .filter(g => g.AwayTeam === homeAbbr || g.HomeTeam === homeAbbr)
        .sort(byDate).slice(0, 5)
        .map(g => formatTeamGame(g, homeAbbr));

      headToHead = completed
        .filter(g =>
          (g.AwayTeam === awayAbbr && g.HomeTeam === homeAbbr) ||
          (g.AwayTeam === homeAbbr && g.HomeTeam === awayAbbr)
        )
        .sort(byDate).slice(0, 5)
        .map(g => ({
          date:      g.DateTime ? new Date(g.DateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          awayAbbr:  g.AwayTeam,
          homeAbbr:  g.HomeTeam,
          awayScore: g.AwayTeamScore,
          homeScore: g.HomeTeamScore,
          awayWon:   g.AwayTeamScore > g.HomeTeamScore,
        }));
    }

    // ── 4. NHL goalie matchup (season stats for starting goalies) ──
    let goalieMatchup = null;
    if (L === 'NHL') {
      try {
        const [boxRaw, seasonStats] = await Promise.all([
          sd.nhlBoxScore(gameId),
          sd.nhlPlayerSeasonStats(season),
        ]);

        // Identify starting goalies from box score (first goalie per team)
        const playerGames = boxRaw?.PlayerGames || [];
        const awayStarterRaw = playerGames.find(p => p.Team === awayAbbr && p.Position === 'G');
        const homeStarterRaw = playerGames.find(p => p.Team === homeAbbr && p.Position === 'G');
        const allStats = Array.isArray(seasonStats) ? seasonStats : [];

        const buildGoalieSeason = (starterRaw) => {
          if (!starterRaw) return null;
          const ss = allStats.find(p => p.PlayerID === starterRaw.PlayerID) || {};
          const wins   = ss.Wins   || 0;
          const losses = ss.Losses || 0;
          const otl    = ss.OvertimeLosses || 0;
          return {
            name:  starterRaw.Name,
            svPct: ss.SavePercentage != null ? ss.SavePercentage.toFixed(3) : '--',
            gaa:   ss.GoalsAgainstAverage != null ? ss.GoalsAgainstAverage.toFixed(2) : '--',
            record: `${wins}-${losses}-${otl}`,
          };
        };

        goalieMatchup = {
          away: buildGoalieSeason(awayStarterRaw),
          home: buildGoalieSeason(homeStarterRaw),
        };
      } catch (_) { goalieMatchup = null; }
    }

    // ── 5. Team season stats (for pre-match matchup bars) ──
    let awayTeamStats = null, homeTeamStats = null;
    try {
      let teamStatsRaw = null;
      if (L === 'NBA')      teamStatsRaw = await sd.nbaTeamSeasonStats(season);
      else if (L === 'NHL') teamStatsRaw = await sd.nhlTeamSeasonStats(season);
      else if (L === 'MLB') teamStatsRaw = await sd.mlbTeamSeasonStats(season);

      if (Array.isArray(teamStatsRaw)) {
        const awayRaw = teamStatsRaw.find(t => t.Team === awayAbbr);
        const homeRaw = teamStatsRaw.find(t => t.Team === homeAbbr);
        const pct = (v) => v != null ? (v > 1 ? v.toFixed(1) : (v * 100).toFixed(1)) : '--';
        const fix1 = (v) => v != null ? Number(v).toFixed(1) : '--';
        const fix2 = (v) => v != null ? Number(v).toFixed(2) : '--';
        const fix3 = (v) => v != null ? Number(v).toFixed(3) : '--';

        if (L === 'NBA') {
          const map = (t) => t ? {
            ppg:   fix1(t.PointsPerGame),
            rpg:   fix1(t.ReboundsPerGame),
            apg:   fix1(t.AssistsPerGame),
            fg:    pct(t.FieldGoalsPercentage),
            three: pct(t.ThreePointersPercentage),
            ft:    pct(t.FreeThrowsPercentage),
            tov:   fix1(t.TurnoversPerGame),
            blk:   fix1(t.BlocksPerGame),
            stl:   fix1(t.StealsPerGame),
            ortg:  t.OffensiveRating != null ? Number(t.OffensiveRating).toFixed(1) : '--',
            drtg:  t.DefensiveRating != null ? Number(t.DefensiveRating).toFixed(1) : '--',
          } : null;
          awayTeamStats = map(awayRaw);
          homeTeamStats = map(homeRaw);
        } else if (L === 'NHL') {
          const map = (t) => t ? {
            sog:   fix1(t.ShotsOnGoalPerGame),
            gf:    fix2(t.GoalsPerGame),
            ga:    fix2(t.GoalsAgainstPerGame),
            ppPct: pct(t.PowerPlayPercentage),
            pkPct: pct(t.PenaltyKillPercentage),
          } : null;
          awayTeamStats = map(awayRaw);
          homeTeamStats = map(homeRaw);
        } else if (L === 'MLB') {
          const map = (t) => t ? {
            era: fix2(t.EarnedRunAverage),
            avg: fix3(t.BattingAverage),
            rpg: fix2(t.RunsPerGame),
            hr:  fix2(t.HomeRunsPerGame),
            so:  fix1(t.PitchingStrikeoutsPerGame || t.StrikeoutsPerGame),
          } : null;
          awayTeamStats = map(awayRaw);
          homeTeamStats = map(homeRaw);
        }
      }
    } catch (_) {}

    // ── 6. NBA key players (top 3 scorers per team for matchup section) ──
    let keyPlayers = null;
    if (L === 'NBA') {
      try {
        const playerStats = await sd.nbaPlayerSeasonStats(season);
        if (Array.isArray(playerStats)) {
          const mapP = (p) => ({
            name: p.Name || '',
            pos:  p.Position || '--',
            pts:  p.PointsPerGame != null    ? Number(p.PointsPerGame).toFixed(1)    : '--',
            reb:  p.ReboundsPerGame != null  ? Number(p.ReboundsPerGame).toFixed(1)  : '--',
            ast:  p.AssistsPerGame != null   ? Number(p.AssistsPerGame).toFixed(1)   : '--',
            fg:   p.FieldGoalsPercentage != null
                    ? `${(p.FieldGoalsPercentage > 1 ? p.FieldGoalsPercentage : p.FieldGoalsPercentage * 100).toFixed(1)}%`
                    : '--',
          });
          const qualify = (p) => (p.Games || 0) >= 5;
          const byPPG   = (a, b) => (b.PointsPerGame || 0) - (a.PointsPerGame || 0);
          keyPlayers = {
            away: playerStats.filter(p => p.Team === awayAbbr && qualify(p)).sort(byPPG).slice(0, 3).map(mapP),
            home: playerStats.filter(p => p.Team === homeAbbr && qualify(p)).sort(byPPG).slice(0, 3).map(mapP),
          };
        }
      } catch (_) {}
    }

    res.json({ ...meta, awayInjuries, homeInjuries, awayLast5, homeLast5, headToHead, goalieMatchup, awayTeamStats, homeTeamStats, keyPlayers });
  } catch (err) {
    console.error(`[/api/sports/gameinfo] ${err.message}`);
    res.json(empty);
  }
});

module.exports = router;
