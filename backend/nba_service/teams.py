"""
Static NBA team and player lookup helpers.
Used throughout the service to resolve names ↔ IDs quickly without an API call.
"""

from __future__ import annotations
from nba_api.stats.static import teams as nba_teams_static
from nba_api.stats.static import players as nba_players_static

# ── Team ID map (full name → id) ─────────────────────────────────────────────
TEAM_ID_MAP: dict[str, int] = {
    "Atlanta Hawks":          1610612737,
    "Boston Celtics":         1610612738,
    "Brooklyn Nets":          1610612751,
    "Charlotte Hornets":      1610612766,
    "Chicago Bulls":          1610612741,
    "Cleveland Cavaliers":    1610612739,
    "Dallas Mavericks":       1610612742,
    "Denver Nuggets":         1610612743,
    "Detroit Pistons":        1610612765,
    "Golden State Warriors":  1610612744,
    "Houston Rockets":        1610612745,
    "Indiana Pacers":         1610612754,
    "LA Clippers":            1610612746,
    "Los Angeles Clippers":   1610612746,
    "LA Lakers":              1610612747,
    "Los Angeles Lakers":     1610612747,
    "Memphis Grizzlies":      1610612763,
    "Miami Heat":             1610612748,
    "Milwaukee Bucks":        1610612749,
    "Minnesota Timberwolves": 1610612750,
    "New Orleans Pelicans":   1610612740,
    "New York Knicks":        1610612752,
    "Oklahoma City Thunder":  1610612760,
    "Orlando Magic":          1610612753,
    "Philadelphia 76ers":     1610612755,
    "Phoenix Suns":           1610612756,
    "Portland Trail Blazers": 1610612757,
    "Sacramento Kings":       1610612758,
    "San Antonio Spurs":      1610612759,
    "Toronto Raptors":        1610612761,
    "Utah Jazz":              1610612762,
    "Washington Wizards":     1610612764,
}

# Abbreviation → team ID
ABBR_TO_ID: dict[str, int] = {
    "ATL": 1610612737, "BOS": 1610612738, "BKN": 1610612751,
    "CHA": 1610612766, "CHI": 1610612741, "CLE": 1610612739,
    "DAL": 1610612742, "DEN": 1610612743, "DET": 1610612765,
    "GSW": 1610612744, "HOU": 1610612745, "IND": 1610612754,
    "LAC": 1610612746, "LAL": 1610612747, "MEM": 1610612763,
    "MIA": 1610612748, "MIL": 1610612749, "MIN": 1610612750,
    "NOP": 1610612740, "NYK": 1610612752, "OKC": 1610612760,
    "ORL": 1610612753, "PHI": 1610612755, "PHX": 1610612756,
    "POR": 1610612757, "SAC": 1610612758, "SAS": 1610612759,
    "TOR": 1610612761, "UTA": 1610612762, "WAS": 1610612764,
}

# ID → abbreviation (reverse of above)
ID_TO_ABBR: dict[int, str] = {v: k for k, v in ABBR_TO_ID.items()}


def get_team_id(name: str) -> int | None:
    """Resolve team name (full or partial) to NBA.com team ID."""
    if name in TEAM_ID_MAP:
        return TEAM_ID_MAP[name]
    name_lower = name.lower()
    for full_name, tid in TEAM_ID_MAP.items():
        if name_lower in full_name.lower():
            return tid
    # Try abbreviation
    abbr = name.upper()
    return ABBR_TO_ID.get(abbr)


def get_all_teams() -> list[dict]:
    """Return list of all teams with id, full_name, abbreviation."""
    return nba_teams_static.get_teams()


def search_players(name: str) -> list[dict]:
    """Fuzzy search players by full or partial name. Returns active first."""
    name_lower = name.lower()
    all_players = nba_players_static.get_players()
    matches = [p for p in all_players if name_lower in p["full_name"].lower()]
    # Active players first
    matches.sort(key=lambda p: (0 if p["is_active"] else 1, p["full_name"]))
    return matches[:20]


def get_player_id(name: str) -> int | None:
    """Return the player ID for the best name match (active preferred)."""
    results = search_players(name)
    return results[0]["id"] if results else None


def get_all_active_players() -> list[dict]:
    return [p for p in nba_players_static.get_players() if p["is_active"]]
