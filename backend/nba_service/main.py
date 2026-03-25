"""
Chalk NBA Data Service
======================
FastAPI microservice wrapping every nba_api endpoint.
Runs on port 8000 alongside the Node.js backend (port 3001).

All endpoints return: { "data": {...}, "cached": bool }

Cache TTLs:
  Player career/profile  : 24h
  Team season dashboards : 6h
  Last-N / opponent      : 2h
  Live scoreboard        : 30s
  Live box score         : 2m
  Completed game data    : 24h
  Standings / leaders    : 6h
  Shot charts            : 24h
  Pregame composite      : 2h
"""

from __future__ import annotations
import asyncio
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from cache import (
    cache_get, cache_set, cache_stats,
    TTL_PLAYER_CAREER, TTL_PLAYER_GAMELOG, TTL_TEAM_SEASON,
    TTL_LAST_N, TTL_LIVE_SCORE, TTL_LIVE_BOXSCORE,
    TTL_FINAL, TTL_STANDINGS, TTL_SHOT_CHART, TTL_PREGAME,
)
from teams import (
    TEAM_ID_MAP, get_team_id, get_all_teams,
    search_players, get_player_id, get_all_active_players,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Chalk NBA Data Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Thread pool for blocking nba_api calls
_executor = ThreadPoolExecutor(max_workers=8)

CURRENT_SEASON = os.getenv("NBA_SEASON", "2024-25")
SEASON_TYPE    = os.getenv("NBA_SEASON_TYPE", "Regular Season")

# NBA.com requires these headers — without them requests get blocked
NBA_HEADERS = {
    'Host': 'stats.nba.com',
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'x-nba-stats-origin': 'stats',
    'x-nba-stats-token': 'true',
    'Referer': 'https://www.nba.com/',
    'Connection': 'keep-alive',
    'Origin': 'https://www.nba.com',
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def to_dict(endpoint) -> dict:
    """Convert any nba_api endpoint response to a clean JSON-serialisable dict."""
    try:
        return endpoint.get_normalized_dict()
    except Exception:
        dfs = endpoint.get_data_frames()
        return {f"set_{i}": df.to_dict("records") for i, df in enumerate(dfs) if not df.empty}


async def _fetch(cache_key: str, ttl: int, fn):
    """
    Generic cached async fetch.
    fn is a zero-argument callable that calls nba_api synchronously.
    """
    cached = cache_get(cache_key)
    if cached is not None:
        return {"data": cached, "cached": True}
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(_executor, fn)
        cache_set(cache_key, data, ttl)
        return {"data": data, "cached": False}
    except Exception as e:
        logger.error(f"NBA API error [{cache_key}]: {e}")
        raise HTTPException(status_code=502, detail=f"NBA data unavailable: {e}")


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "cache": cache_stats(), "season": CURRENT_SEASON}


# ── Static lookup ──────────────────────────────────────────────────────────────

@app.get("/nba/teams")
async def list_teams():
    return {"data": get_all_teams()}


@app.get("/nba/players/search")
async def player_search(name: str = Query(..., min_length=2)):
    return {"data": search_players(name)}


@app.get("/nba/players/active")
async def active_players():
    return {"data": get_all_active_players()}


@app.get("/nba/team/lookup")
async def team_lookup(name: str = Query(...)):
    tid = get_team_id(name)
    if not tid:
        raise HTTPException(status_code=404, detail=f"Team not found: {name}")
    return {"data": {"team_id": tid, "name": name}}


@app.get("/nba/player/lookup")
async def player_lookup(name: str = Query(...)):
    pid = get_player_id(name)
    if not pid:
        raise HTTPException(status_code=404, detail=f"Player not found: {name}")
    return {"data": {"player_id": pid, "name": name}}


# ═══════════════════════════════════════════════════════════════════════════════
# PLAYER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/nba/player/{player_id}/career")
async def player_career(player_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import PlayerCareerStats
    return await _fetch(
        f"player_career_{player_id}_{season}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(PlayerCareerStats(player_id=player_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/player/{player_id}/gamelog")
async def player_gamelog(
    player_id: int,
    season: str = CURRENT_SEASON,
    season_type: str = SEASON_TYPE,
):
    from nba_api.stats.endpoints import PlayerGameLog
    return await _fetch(
        f"player_gamelog_{player_id}_{season}_{season_type}",
        TTL_PLAYER_GAMELOG,
        lambda: to_dict(PlayerGameLog(
            player_id=player_id, season=season,
            season_type_all_star=season_type, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/profile")
async def player_profile(player_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import PlayerProfileV2
    return await _fetch(
        f"player_profile_{player_id}_{season}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(PlayerProfileV2(player_id=player_id, season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/player/{player_id}/info")
async def player_info(player_id: int):
    from nba_api.stats.endpoints import CommonPlayerInfo
    return await _fetch(
        f"player_info_{player_id}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(CommonPlayerInfo(player_id=player_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/player/{player_id}/dashboard")
async def player_dashboard(
    player_id: int,
    season: str = CURRENT_SEASON,
    last_n: int = 0,
):
    from nba_api.stats.endpoints import PlayerDashboardByGeneralSplits
    return await _fetch(
        f"player_dash_{player_id}_{season}_{last_n}",
        TTL_TEAM_SEASON,
        lambda: to_dict(PlayerDashboardByGeneralSplits(
            player_id=player_id, season=season,
            last_n_games=last_n, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/last-n")
async def player_last_n(player_id: int, n: int = 10, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import PlayerDashboardByLastNGames
    return await _fetch(
        f"player_lastn_{player_id}_{n}_{season}",
        TTL_LAST_N,
        lambda: to_dict(PlayerDashboardByLastNGames(
            player_id=player_id, last_n_games=n, season=season, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/opponent-splits")
async def player_opponent_splits(player_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import PlayerDashboardByOpponent
    return await _fetch(
        f"player_opp_{player_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(PlayerDashboardByOpponent(
            player_id=player_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/shooting-splits")
async def player_shooting_splits(player_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import PlayerDashboardByShootingSplits
    return await _fetch(
        f"player_shoot_{player_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(PlayerDashboardByShootingSplits(
            player_id=player_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/year-over-year")
async def player_year_over_year(player_id: int):
    from nba_api.stats.endpoints import PlayerDashboardByYearOverYear
    return await _fetch(
        f"player_yoy_{player_id}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(PlayerDashboardByYearOverYear(player_id=player_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/player/{player_id}/clutch")
async def player_clutch(player_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import PlayerDashboardByClutch
    return await _fetch(
        f"player_clutch_{player_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(PlayerDashboardByClutch(
            player_id=player_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/next-games")
async def player_next_games(player_id: int, number_of_games: int = 5):
    from nba_api.stats.endpoints import PlayerNextNGames
    return await _fetch(
        f"player_next_{player_id}_{number_of_games}",
        TTL_LAST_N,
        lambda: to_dict(PlayerNextNGames(
            player_id=player_id, number_of_games=number_of_games, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/estimated-metrics")
async def player_estimated_metrics(player_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import PlayerEstimatedMetrics
    return await _fetch(
        f"player_est_{player_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(PlayerEstimatedMetrics(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/player/{player_id}/vs/{vs_player_id}")
async def player_vs_player(
    player_id: int, vs_player_id: int,
    season: str = CURRENT_SEASON,
):
    from nba_api.stats.endpoints import PlayerVsPlayer
    return await _fetch(
        f"pvp_{player_id}_{vs_player_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(PlayerVsPlayer(
            player_id=player_id, vs_player_id=vs_player_id,
            season=season, timeout=30,
        )),
    )


@app.get("/nba/player/{player_id}/shot-chart")
async def player_shot_chart(
    player_id: int,
    season: str = CURRENT_SEASON,
    season_type: str = SEASON_TYPE,
):
    from nba_api.stats.endpoints import ShotChartDetail
    return await _fetch(
        f"shotchart_{player_id}_{season}_{season_type}",
        TTL_SHOT_CHART,
        lambda: to_dict(ShotChartDetail(
            player_id=player_id, team_id=0,
            season_nullable=season,
            season_type_all_star=season_type,
            timeout=30,
        )),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# TEAM ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/nba/team/{team_id}/info")
async def team_info(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamInfoCommon
    return await _fetch(
        f"team_info_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamInfoCommon(team_id=team_id, season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/team/{team_id}/roster")
async def team_roster(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import CommonTeamRoster
    return await _fetch(
        f"team_roster_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(CommonTeamRoster(team_id=team_id, season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/team/{team_id}/dashboard")
async def team_dashboard(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamDashboardByGeneralSplits
    return await _fetch(
        f"team_dash_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamDashboardByGeneralSplits(
            team_id=team_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/gamelog")
async def team_gamelog(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamGameLog
    return await _fetch(
        f"team_gamelog_{team_id}_{season}",
        TTL_PLAYER_GAMELOG,
        lambda: to_dict(TeamGameLog(team_id=team_id, season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/team/{team_id}/last-n")
async def team_last_n(team_id: int, n: int = 10, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamDashboardByLastNGames
    return await _fetch(
        f"team_lastn_{team_id}_{n}_{season}",
        TTL_LAST_N,
        lambda: to_dict(TeamDashboardByLastNGames(
            team_id=team_id, last_n_games=n, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/opponent-splits")
async def team_opponent_splits(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamDashboardByOpponent
    return await _fetch(
        f"team_opp_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamDashboardByOpponent(
            team_id=team_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/shooting-splits")
async def team_shooting_splits(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamDashboardByShootingSplits
    return await _fetch(
        f"team_shoot_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamDashboardByShootingSplits(
            team_id=team_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/clutch")
async def team_clutch(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamDashboardByClutch
    return await _fetch(
        f"team_clutch_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamDashboardByClutch(
            team_id=team_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/year-by-year")
async def team_year_by_year(team_id: int):
    from nba_api.stats.endpoints import TeamYearByYearStats
    return await _fetch(
        f"team_yby_{team_id}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(TeamYearByYearStats(team_id=team_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/team/{team_id}/estimated-metrics")
async def team_estimated_metrics(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamEstimatedMetrics
    return await _fetch(
        f"team_est_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamEstimatedMetrics(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/team/{team_id}/player-dashboard")
async def team_player_dashboard(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamPlayerDashboard
    return await _fetch(
        f"team_player_dash_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamPlayerDashboard(
            team_id=team_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/on-off")
async def team_on_off(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamPlayerOnOffSummary
    return await _fetch(
        f"team_onoff_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamPlayerOnOffSummary(
            team_id=team_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/on-off-details")
async def team_on_off_details(team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamPlayerOnOffDetails
    return await _fetch(
        f"team_onoffdet_{team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamPlayerOnOffDetails(
            team_id=team_id, season=season, timeout=30,
        )),
    )


@app.get("/nba/team/{team_id}/vs/{vs_team_id}")
async def team_vs_team(team_id: int, vs_team_id: int, season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import TeamVsPlayer
    return await _fetch(
        f"tvt_{team_id}_{vs_team_id}_{season}",
        TTL_TEAM_SEASON,
        lambda: to_dict(TeamVsPlayer(
            team_id=team_id, vs_team_id=vs_team_id, season=season, timeout=30,
        )),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# BOX SCORE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

def _box_ttl(game_id: str) -> int:
    """Live game IDs use short TTL; completed games cache forever."""
    # The live endpoint is separate; here we assume stats API (completed or recent)
    return TTL_LIVE_BOXSCORE


@app.get("/nba/boxscore/{game_id}/traditional")
async def boxscore_traditional(game_id: str):
    from nba_api.stats.endpoints import BoxScoreTraditionalV3
    return await _fetch(
        f"box_trad_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreTraditionalV3(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/advanced")
async def boxscore_advanced(game_id: str):
    from nba_api.stats.endpoints import BoxScoreAdvancedV3
    return await _fetch(
        f"box_adv_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreAdvancedV3(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/misc")
async def boxscore_misc(game_id: str):
    from nba_api.stats.endpoints import BoxScoreMiscV3
    return await _fetch(
        f"box_misc_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreMiscV3(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/scoring")
async def boxscore_scoring(game_id: str):
    from nba_api.stats.endpoints import BoxScoreScoringV2
    return await _fetch(
        f"box_score_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreScoringV2(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/usage")
async def boxscore_usage(game_id: str):
    from nba_api.stats.endpoints import BoxScoreUsageV2
    return await _fetch(
        f"box_usage_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreUsageV2(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/four-factors")
async def boxscore_four_factors(game_id: str):
    from nba_api.stats.endpoints import BoxScoreFourFactorsV2
    return await _fetch(
        f"box_4f_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreFourFactorsV2(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/defensive")
async def boxscore_defensive(game_id: str):
    from nba_api.stats.endpoints import BoxScoreDefensiveV2
    return await _fetch(
        f"box_def_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreDefensiveV2(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/tracking")
async def boxscore_tracking(game_id: str):
    from nba_api.stats.endpoints import BoxScorePlayerTrackV2
    return await _fetch(
        f"box_track_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScorePlayerTrackV2(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/boxscore/{game_id}/summary")
async def boxscore_summary(game_id: str):
    from nba_api.stats.endpoints import BoxScoreSummaryV2
    return await _fetch(
        f"box_sum_{game_id}",
        _box_ttl(game_id),
        lambda: to_dict(BoxScoreSummaryV2(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


# Live box score (NBA Live API — updates every ~15 seconds)
@app.get("/nba/boxscore/{game_id}/live")
async def boxscore_live(game_id: str):
    from nba_api.live.nba.endpoints import boxscore as live_boxscore
    return await _fetch(
        f"box_live_{game_id}",
        TTL_LIVE_BOXSCORE,
        lambda: live_boxscore.BoxScore(game_id=game_id).get_dict(),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# LEAGUE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/nba/league/scoreboard")
async def league_scoreboard():
    from nba_api.live.nba.endpoints import scoreboard as live_sb
    return await _fetch(
        f"scoreboard_{int(time.time()) // TTL_LIVE_SCORE}",
        TTL_LIVE_SCORE,
        lambda: live_sb.ScoreBoard().get_dict(),
    )


@app.get("/nba/league/scoreboard-v2")
async def league_scoreboard_v2(game_date: Optional[str] = None):
    from nba_api.stats.endpoints import ScoreboardV2
    import datetime
    date_str = game_date or datetime.date.today().strftime("%m/%d/%Y")
    return await _fetch(
        f"scoreboardv2_{date_str}",
        TTL_LIVE_SCORE,
        lambda: to_dict(ScoreboardV2(game_date=date_str, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/standings")
async def league_standings(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueStandingsV3
    return await _fetch(
        f"standings_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueStandingsV3(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/leaders")
async def league_leaders(
    season: str = CURRENT_SEASON,
    stat_category: str = "PTS",
    season_type: str = SEASON_TYPE,
):
    from nba_api.stats.endpoints import LeagueLeaders
    return await _fetch(
        f"leaders_{season}_{stat_category}_{season_type}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueLeaders(
            season=season, stat_category_abbreviation=stat_category,
            season_type_all_star=season_type, timeout=30,
        )),
    )


@app.get("/nba/league/team-stats")
async def league_team_stats(
    season: str = CURRENT_SEASON,
    season_type: str = SEASON_TYPE,
    per_mode: str = "PerGame",
):
    from nba_api.stats.endpoints import LeagueDashTeamStats
    return await _fetch(
        f"team_stats_{season}_{season_type}_{per_mode}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashTeamStats(
            season=season, season_type_all_star=season_type,
            per_mode_simple=per_mode, timeout=30,
        )),
    )


@app.get("/nba/league/player-stats")
async def league_player_stats(
    season: str = CURRENT_SEASON,
    season_type: str = SEASON_TYPE,
    per_mode: str = "PerGame",
):
    from nba_api.stats.endpoints import LeagueDashPlayerStats
    return await _fetch(
        f"player_stats_{season}_{season_type}_{per_mode}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashPlayerStats(
            season=season, season_type_all_star=season_type,
            per_mode_simple=per_mode, timeout=30,
        )),
    )


@app.get("/nba/league/pt-stats")
async def league_pt_stats(season: str = CURRENT_SEASON, per_mode: str = "PerGame"):
    from nba_api.stats.endpoints import LeagueDashPtStats
    return await _fetch(
        f"pt_stats_{season}_{per_mode}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashPtStats(
            season=season, per_mode_simple=per_mode, timeout=30,
        )),
    )


@app.get("/nba/league/team-pt-shot")
async def league_team_pt_shot(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueDashTeamPtShot
    return await _fetch(
        f"team_ptshot_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashTeamPtShot(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/player-pt-shot")
async def league_player_pt_shot(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueDashPlayerPtShot
    return await _fetch(
        f"player_ptshot_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashPlayerPtShot(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/team-shot-locations")
async def league_team_shot_locations(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueDashTeamShotLocations
    return await _fetch(
        f"team_shotloc_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashTeamShotLocations(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/player-shot-locations")
async def league_player_shot_locations(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueDashPlayerShotLocations
    return await _fetch(
        f"player_shotloc_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashPlayerShotLocations(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/hustle-players")
async def league_hustle_players(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueHustleStatsPlayer
    return await _fetch(
        f"hustle_players_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueHustleStatsPlayer(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/hustle-teams")
async def league_hustle_teams(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueHustleStatsTeam
    return await _fetch(
        f"hustle_teams_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueHustleStatsTeam(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/clutch-teams")
async def league_clutch_teams(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueDashTeamClutch
    return await _fetch(
        f"clutch_teams_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashTeamClutch(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/clutch-players")
async def league_clutch_players(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueDashPlayerClutch
    return await _fetch(
        f"clutch_players_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueDashPlayerClutch(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/gamelog")
async def league_gamelog(
    season: str = CURRENT_SEASON,
    season_type: str = SEASON_TYPE,
    player_or_team: str = "T",
):
    from nba_api.stats.endpoints import LeagueGameLog
    return await _fetch(
        f"league_gamelog_{season}_{season_type}_{player_or_team}",
        TTL_PLAYER_GAMELOG,
        lambda: to_dict(LeagueGameLog(
            season=season, season_type_all_star=season_type,
            player_or_team_abbreviation=player_or_team, timeout=30,
        )),
    )


@app.get("/nba/league/matchups")
async def league_matchups(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import MatchupsRollup
    return await _fetch(
        f"matchups_{season}",
        TTL_STANDINGS,
        lambda: to_dict(MatchupsRollup(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/season-matchups")
async def league_season_matchups(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import LeagueSeasonMatchups
    return await _fetch(
        f"season_matchups_{season}",
        TTL_STANDINGS,
        lambda: to_dict(LeagueSeasonMatchups(season=season, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/league/shot-chart-wide")
async def shot_chart_leaguewide(season: str = CURRENT_SEASON):
    from nba_api.stats.endpoints import ShotChartLeagueWide
    return await _fetch(
        f"shotchart_wide_{season}",
        TTL_SHOT_CHART,
        lambda: to_dict(ShotChartLeagueWide(season=season, headers=NBA_HEADERS, timeout=30)),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# GAME ENDPOINTS (Play-by-play, Win Probability)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/nba/game/{game_id}/playbyplay")
async def play_by_play(game_id: str):
    from nba_api.live.nba.endpoints import playbyplay as live_pbp
    return await _fetch(
        f"pbp_live_{game_id}_{int(time.time()) // 30}",
        30,
        lambda: live_pbp.PlayByPlay(game_id=game_id).get_dict(),
    )


@app.get("/nba/game/{game_id}/playbyplay-v2")
async def play_by_play_v2(game_id: str):
    from nba_api.stats.endpoints import PlayByPlayV2
    return await _fetch(
        f"pbp2_{game_id}",
        TTL_LIVE_BOXSCORE,
        lambda: to_dict(PlayByPlayV2(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/game/{game_id}/win-probability")
async def win_probability(game_id: str):
    from nba_api.stats.endpoints import WinProbabilityPbp
    return await _fetch(
        f"winprob_{game_id}",
        TTL_LIVE_BOXSCORE,
        lambda: to_dict(WinProbabilityPbp(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/game/{game_id}/fanduel-player")
async def fanduel_player(game_id: str):
    from nba_api.stats.endpoints import InfographicFanDuelPlayer
    return await _fetch(
        f"fanduel_{game_id}",
        TTL_LIVE_BOXSCORE,
        lambda: to_dict(InfographicFanDuelPlayer(game_id=game_id, headers=NBA_HEADERS, timeout=30)),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# HISTORICAL ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/nba/history/franchise")
async def franchise_history():
    from nba_api.stats.endpoints import FranchiseHistory
    return await _fetch(
        "franchise_history",
        TTL_PLAYER_CAREER,
        lambda: to_dict(FranchiseHistory(headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/history/franchise-leaders/{team_id}")
async def franchise_leaders(team_id: int):
    from nba_api.stats.endpoints import FranchiseLeaders
    return await _fetch(
        f"franchise_leaders_{team_id}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(FranchiseLeaders(team_id=team_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/history/franchise-players/{team_id}")
async def franchise_players(team_id: int):
    from nba_api.stats.endpoints import FranchisePlayers
    return await _fetch(
        f"franchise_players_{team_id}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(FranchisePlayers(team_id=team_id, headers=NBA_HEADERS, timeout=30)),
    )


@app.get("/nba/history/all-time-leaders")
async def all_time_leaders(per_mode: str = "Totals", top_x: int = 10):
    from nba_api.stats.endpoints import AllTimeLeadersGrids
    return await _fetch(
        f"alltime_leaders_{per_mode}_{top_x}",
        TTL_PLAYER_CAREER,
        lambda: to_dict(AllTimeLeadersGrids(
            per_mode_simple=per_mode, topx=top_x, timeout=30,
        )),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# COMPOSITE: PREGAME ANALYSIS
# Built specifically to power Chalky's picks engine.
# Fetches all relevant data for both teams concurrently, returns one clean object.
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/nba/pregame/{home_team_id}/{away_team_id}")
async def pregame_analysis(
    home_team_id: int,
    away_team_id: int,
    season: str = CURRENT_SEASON,
):
    cache_key = f"pregame_{home_team_id}_{away_team_id}_{season}"
    cached = cache_get(cache_key)
    if cached:
        return {"data": cached, "cached": True}

    loop = asyncio.get_event_loop()

    async def fetch(fn):
        try:
            return await loop.run_in_executor(_executor, fn)
        except Exception as e:
            logger.warning(f"Pregame sub-fetch failed: {e}")
            return None

    from nba_api.stats.endpoints import (
        TeamDashboardByGeneralSplits, TeamDashboardByLastNGames,
        TeamDashboardByOpponent, TeamDashboardByClutch,
        TeamDashboardByShootingSplits, LeagueStandingsV3,
        LeagueDashTeamStats, TeamPlayerDashboard,
        TeamDashboardByClutch as TDClutch,
    )

    # Fire all requests concurrently
    (
        home_dash, away_dash,
        home_last10, away_last10,
        home_opp, away_opp,
        home_clutch, away_clutch,
        home_shoot, away_shoot,
        home_roster, away_roster,
        standings, league_team_stats,
    ) = await asyncio.gather(
        fetch(lambda: to_dict(TeamDashboardByGeneralSplits(team_id=home_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamDashboardByGeneralSplits(team_id=away_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamDashboardByLastNGames(team_id=home_team_id, last_n_games=10, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamDashboardByLastNGames(team_id=away_team_id, last_n_games=10, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamDashboardByOpponent(team_id=home_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamDashboardByOpponent(team_id=away_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TDClutch(team_id=home_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TDClutch(team_id=away_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamDashboardByShootingSplits(team_id=home_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamDashboardByShootingSplits(team_id=away_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamPlayerDashboard(team_id=home_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(TeamPlayerDashboard(team_id=away_team_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(LeagueStandingsV3(season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(LeagueDashTeamStats(season=season, headers=NBA_HEADERS, timeout=30))),
        return_exceptions=False,
    )

    data = {
        "season": season,
        "home_team_id": home_team_id,
        "away_team_id": away_team_id,
        "home": {
            "dashboard":       home_dash,
            "last_10_games":   home_last10,
            "opponent_splits": home_opp,
            "clutch":          home_clutch,
            "shooting_splits": home_shoot,
            "players":         home_roster,
        },
        "away": {
            "dashboard":       away_dash,
            "last_10_games":   away_last10,
            "opponent_splits": away_opp,
            "clutch":          away_clutch,
            "shooting_splits": away_shoot,
            "players":         away_roster,
        },
        "league": {
            "standings":   standings,
            "team_stats":  league_team_stats,
        },
    }

    cache_set(cache_key, data, TTL_PREGAME)
    return {"data": data, "cached": False}


# ═══════════════════════════════════════════════════════════════════════════════
# COMPOSITE: PLAYER DEEP DIVE
# All player data in one call — for Research screen player questions.
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/nba/player/{player_id}/deep-dive")
async def player_deep_dive(player_id: int, season: str = CURRENT_SEASON):
    cache_key = f"player_deep_{player_id}_{season}"
    cached = cache_get(cache_key)
    if cached:
        return {"data": cached, "cached": True}

    loop = asyncio.get_event_loop()

    async def fetch(fn):
        try:
            return await loop.run_in_executor(_executor, fn)
        except Exception as e:
            logger.warning(f"Player deep-dive sub-fetch failed: {e}")
            return None

    from nba_api.stats.endpoints import (
        PlayerCareerStats, PlayerGameLog, CommonPlayerInfo,
        PlayerDashboardByGeneralSplits, PlayerDashboardByLastNGames,
        PlayerDashboardByOpponent, PlayerDashboardByShootingSplits,
        PlayerDashboardByClutch, ShotChartDetail,
    )

    (
        career, gamelog, info, dashboard,
        last10, opp, shooting, clutch, shots,
    ) = await asyncio.gather(
        fetch(lambda: to_dict(PlayerCareerStats(player_id=player_id, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(PlayerGameLog(player_id=player_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(CommonPlayerInfo(player_id=player_id, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(PlayerDashboardByGeneralSplits(player_id=player_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(PlayerDashboardByLastNGames(player_id=player_id, last_n_games=10, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(PlayerDashboardByOpponent(player_id=player_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(PlayerDashboardByShootingSplits(player_id=player_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(PlayerDashboardByClutch(player_id=player_id, season=season, headers=NBA_HEADERS, timeout=30))),
        fetch(lambda: to_dict(ShotChartDetail(player_id=player_id, team_id=0, season_nullable=season, headers=NBA_HEADERS, timeout=30))),
        return_exceptions=False,
    )

    data = {
        "player_id": player_id,
        "season": season,
        "career":          career,
        "gamelog":         gamelog,
        "info":            info,
        "dashboard":       dashboard,
        "last_10_games":   last10,
        "opponent_splits": opp,
        "shooting_splits": shooting,
        "clutch":          clutch,
        "shot_chart":      shots,
    }

    cache_set(cache_key, data, TTL_TEAM_SEASON)
    return {"data": data, "cached": False}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("NBA_SERVICE_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
