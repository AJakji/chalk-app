"""
Runs only Phase 2 of nbaDataCollector — populates position_defense_ratings
from the BallDontLie team_stats endpoint. Fast (single API call).
"""
import os, sys
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))
sys.path.insert(0, os.path.dirname(__file__))
from nbaDataCollector import get_db, collect_defense_ratings, log_injury_report

conn = get_db()
try:
    collect_defense_ratings(conn)
    log_injury_report()
finally:
    conn.close()
