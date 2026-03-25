"""
Chalk NBA Cache — Redis with in-memory fallback.

TTL constants (seconds):
  PLAYER_CAREER  : 86400  (24h)  – career stats barely change
  TEAM_SEASON    : 21600  (6h)   – season dashboards update after each game
  LAST_N         : 7200   (2h)   – last-N changes after each game
  LIVE_SCORE     : 30            – live scoreboard
  LIVE_BOXSCORE  : 120    (2m)   – live box score
  FINAL          : 86400  (24h)  – completed game data never changes
  STANDINGS      : 21600  (6h)
  SHOT_CHART     : 86400  (24h)
  PREGAME        : 7200   (2h)   – composite pregame analysis
"""

import time
import json
import os
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

TTL_PLAYER_CAREER  = 86400
TTL_TEAM_SEASON    = 21600
TTL_LAST_N         = 7200
TTL_LIVE_SCORE     = 30
TTL_LIVE_BOXSCORE  = 120
TTL_FINAL          = 86400
TTL_STANDINGS      = 21600
TTL_SHOT_CHART     = 86400
TTL_PREGAME        = 7200
TTL_PLAYER_GAMELOG = 21600

# ── In-memory fallback ───────────────────────────────────────────────────────
_mem: dict[str, dict] = {}

def _mem_get(key: str) -> Optional[Any]:
    entry = _mem.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["data"]
    return None

def _mem_set(key: str, data: Any, ttl: int) -> None:
    _mem[key] = {"data": data, "expires": time.time() + ttl}

# ── Redis (optional) ─────────────────────────────────────────────────────────
_redis = None

def _init_redis():
    global _redis
    try:
        import redis
        url = os.getenv("REDIS_URL", "redis://localhost:6379")
        r = redis.from_url(url, decode_responses=True, socket_timeout=2)
        r.ping()
        _redis = r
        logger.info("✅ NBA cache: Redis connected")
    except Exception as e:
        logger.warning(f"⚠️  NBA cache: Redis unavailable ({e}) — using in-memory")
        _redis = None

_init_redis()

# ── Public API ───────────────────────────────────────────────────────────────
def cache_get(key: str) -> Optional[Any]:
    if _redis:
        try:
            raw = _redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    return _mem_get(key)

def cache_set(key: str, data: Any, ttl: int) -> None:
    if _redis:
        try:
            _redis.setex(key, ttl, json.dumps(data, default=str))
            return
        except Exception:
            pass
    _mem_set(key, data, ttl)

def cache_delete(key: str) -> None:
    if _redis:
        try:
            _redis.delete(key)
        except Exception:
            pass
    _mem.pop(key, None)

def cache_stats() -> dict:
    mem_count = sum(1 for e in _mem.values() if time.time() < e["expires"])
    return {
        "backend": "redis" if _redis else "memory",
        "memory_entries": mem_count,
    }
