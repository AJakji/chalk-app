-- Chalk database schema
-- Run this once to set up the database: node db/migrate.js

-- Users table — synced from Clerk on first sign-in
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id      TEXT UNIQUE NOT NULL,       -- Clerk's user ID (links auth to our DB)
  username      TEXT UNIQUE,
  display_name  TEXT,
  avatar        TEXT,                        -- emoji or image URL
  bio           TEXT,
  streak        INTEGER NOT NULL DEFAULT 0,
  streak_type   TEXT NOT NULL DEFAULT 'hot', -- 'hot' or 'cold'
  followers     INTEGER NOT NULL DEFAULT 0,
  following     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI-generated picks (created by Chalk's engine daily)
CREATE TABLE IF NOT EXISTS picks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league        TEXT NOT NULL,              -- NBA, NFL, MLB, NHL, Soccer
  sport_key     TEXT NOT NULL,              -- The Odds API sport key
  pick_type     TEXT NOT NULL,              -- Spread, Total, Moneyline
  away_team     TEXT NOT NULL,
  home_team     TEXT NOT NULL,
  game_time     TEXT NOT NULL,
  game_id       TEXT,                       -- The Odds API game ID
  pick_value    TEXT NOT NULL,              -- e.g. "Celtics -4.5"
  confidence    INTEGER NOT NULL,           -- 1–100
  short_reason  TEXT NOT NULL,              -- one-line summary
  analysis      JSONB,                      -- full AI analysis sections
  key_stats     JSONB,                      -- stat bars for detail view
  trends        JSONB,                      -- bullet point trends
  odds_data     JSONB,                      -- odds across all books
  result        TEXT,                       -- null, 'win', 'loss', 'push'
  pick_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- v2: prop pick support — game picks vs player props in one unified table
ALTER TABLE picks ADD COLUMN IF NOT EXISTS pick_category   TEXT NOT NULL DEFAULT 'game'; -- 'game' | 'prop'
ALTER TABLE picks ADD COLUMN IF NOT EXISTS player_name     TEXT;  -- prop picks only
ALTER TABLE picks ADD COLUMN IF NOT EXISTS player_team     TEXT;  -- prop picks only
ALTER TABLE picks ADD COLUMN IF NOT EXISTS player_position TEXT;  -- prop picks only
ALTER TABLE picks ADD COLUMN IF NOT EXISTS matchup_text    TEXT;  -- "vs BOS · Tonight 7:30 PM ET"
ALTER TABLE picks ADD COLUMN IF NOT EXISTS headshot_url    TEXT;  -- player headshot image URL

-- Prevent duplicate picks for the same game + pick type on the same day
CREATE UNIQUE INDEX IF NOT EXISTS idx_picks_dedup ON picks (game_id, pick_type);

-- Index so "today's picks" queries are fast
CREATE INDEX IF NOT EXISTS idx_picks_date ON picks (pick_date DESC);

-- Social pick posts — users sharing their own picks
CREATE TABLE IF NOT EXISTS posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  league        TEXT NOT NULL,
  pick          TEXT NOT NULL,
  game          TEXT NOT NULL,
  odds          TEXT,
  reasoning     TEXT,
  tails         INTEGER NOT NULL DEFAULT 0,
  fades         INTEGER NOT NULL DEFAULT 0,
  result        TEXT,                        -- null, 'win', 'loss'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);

-- v2: add pick detail fields to posts (safe to run multiple times)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pick_type  TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS game_time  TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS confidence INTEGER;

-- Reactions on posts (Lock, Fire, Cap, Fade, Hit)
CREATE TABLE IF NOT EXISTS reactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,              -- 'lock', 'fire', 'cap', 'fade', 'hit'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id, type)           -- one reaction type per user per post
);

-- Follow system
CREATE TABLE IF NOT EXISTS follows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);

-- Last 10 picks visualiser per user
CREATE TABLE IF NOT EXISTS user_pick_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result        INTEGER NOT NULL,           -- 1 = win, 0 = loss
  pick_ref      TEXT,                       -- optional reference to post
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- CHALK PROJECTION ENGINE — proprietary model tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Raw player game-by-game logs (collected nightly from nba_api)
CREATE TABLE IF NOT EXISTS player_game_logs (
  id                  BIGSERIAL PRIMARY KEY,
  player_id           INTEGER NOT NULL,
  player_name         TEXT    NOT NULL,
  team                TEXT    NOT NULL,
  sport               TEXT    NOT NULL DEFAULT 'NBA',
  season              TEXT    NOT NULL,
  game_date           DATE    NOT NULL,
  game_id             TEXT,
  opponent            TEXT,
  home_away           TEXT,               -- 'home' | 'away'
  minutes             NUMERIC(5,2),
  points              NUMERIC(5,2),
  rebounds            NUMERIC(5,2),
  assists             NUMERIC(5,2),
  steals              NUMERIC(5,2),
  blocks              NUMERIC(5,2),
  turnovers           NUMERIC(5,2),
  fouls               NUMERIC(5,2),
  fg_made             NUMERIC(5,2),
  fg_att              NUMERIC(5,2),
  fg_pct              NUMERIC(6,4),
  three_made          NUMERIC(5,2),
  three_att           NUMERIC(5,2),
  three_pct           NUMERIC(6,4),
  ft_made             NUMERIC(5,2),
  ft_att              NUMERIC(5,2),
  ft_pct              NUMERIC(6,4),
  off_reb             NUMERIC(5,2),
  def_reb             NUMERIC(5,2),
  usage_rate          NUMERIC(6,4),
  true_shooting_pct   NUMERIC(6,4),
  offensive_rating    NUMERIC(7,3),
  defensive_rating    NUMERIC(7,3),
  plus_minus          NUMERIC(6,2),
  pace                NUMERIC(7,3),
  position            TEXT,               -- player position (G for goalies, F/D for skaters)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, game_date, sport)
);

-- v2: position column for goalie detection
ALTER TABLE player_game_logs ADD COLUMN IF NOT EXISTS position TEXT;

CREATE INDEX IF NOT EXISTS idx_pgl_player_date ON player_game_logs (player_id, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_pgl_sport_date  ON player_game_logs (sport, game_date DESC);

-- Raw team game-by-game logs (collected nightly)
CREATE TABLE IF NOT EXISTS team_game_logs (
  id                  BIGSERIAL PRIMARY KEY,
  team_id             INTEGER NOT NULL,
  team_name           TEXT    NOT NULL,
  sport               TEXT    NOT NULL DEFAULT 'NBA',
  season              TEXT    NOT NULL,
  game_date           DATE    NOT NULL,
  game_id             TEXT,
  opponent            TEXT,
  home_away           TEXT,
  result              TEXT,               -- 'W' | 'L'
  points_scored       NUMERIC(6,2),
  points_allowed      NUMERIC(6,2),
  offensive_rating    NUMERIC(7,3),
  defensive_rating    NUMERIC(7,3),
  pace                NUMERIC(7,3),
  fg_pct              NUMERIC(6,4),
  three_pct           NUMERIC(6,4),
  ft_pct              NUMERIC(6,4),
  rebounds            NUMERIC(6,2),
  assists             NUMERIC(6,2),
  turnovers           NUMERIC(6,2),
  steals              NUMERIC(6,2),
  blocks              NUMERIC(6,2),
  oreb_pct            NUMERIC(6,4),
  dreb_pct            NUMERIC(6,4),
  fast_break_pts      NUMERIC(6,2),
  points_in_paint     NUMERIC(6,2),
  ats_result          TEXT,               -- 'covered' | 'not_covered' | 'push'
  game_total          NUMERIC(6,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, game_date, sport)
);

CREATE INDEX IF NOT EXISTS idx_tgl_team_date ON team_game_logs (team_id, game_date DESC);

-- How each team defends each position (updated daily)
CREATE TABLE IF NOT EXISTS position_defense_ratings (
  id              BIGSERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL,
  team_name       TEXT    NOT NULL,
  sport           TEXT    NOT NULL DEFAULT 'NBA',
  season          TEXT    NOT NULL,
  position        TEXT    NOT NULL,       -- 'PG'|'SG'|'SF'|'PF'|'C'
  pts_allowed     NUMERIC(6,3),
  reb_allowed     NUMERIC(6,3),
  ast_allowed     NUMERIC(6,3),
  three_allowed   NUMERIC(6,3),
  fg_pct_allowed  NUMERIC(6,4),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, season, position)
);

-- Team performance in specific situations (rest, home/away, opp strength)
CREATE TABLE IF NOT EXISTS team_situation_splits (
  id              BIGSERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL,
  team_name       TEXT    NOT NULL,
  sport           TEXT    NOT NULL DEFAULT 'NBA',
  season          TEXT    NOT NULL,
  split_type      TEXT    NOT NULL,       -- 'rest_0'|'rest_1'|'rest_2'|'rest_3+'|'home'|'away'|'vs_above_500'|'vs_below_500'
  games           INTEGER,
  wins            INTEGER,
  win_pct         NUMERIC(5,4),
  pts_scored      NUMERIC(6,3),
  pts_allowed     NUMERIC(6,3),
  off_rating      NUMERIC(7,3),
  def_rating      NUMERIC(7,3),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, season, split_type)
);

-- Sportsbook prop lines collected daily (before games)
-- and graded after (actual_result, over_hit filled post-game)
CREATE TABLE IF NOT EXISTS player_props_history (
  id                  BIGSERIAL PRIMARY KEY,
  player_id           INTEGER NOT NULL,
  player_name         TEXT    NOT NULL,
  team                TEXT    NOT NULL,
  sport               TEXT    NOT NULL DEFAULT 'NBA',
  game_date           DATE    NOT NULL,
  prop_type           TEXT    NOT NULL,   -- 'points'|'rebounds'|'assists'|'threes'|'pra'|etc.
  prop_line           NUMERIC(6,2),       -- the posted sportsbook line
  dk_odds             TEXT,
  fd_odds             TEXT,
  mgm_odds            TEXT,
  bet365_odds         TEXT,
  chalk_projection    NUMERIC(7,3),       -- what our model projected
  chalk_edge          NUMERIC(7,3),       -- projection minus line (+ = over edge)
  confidence          INTEGER,
  actual_result       NUMERIC(7,3),       -- filled after game
  over_hit            BOOLEAN,            -- filled after game
  was_correct         BOOLEAN,            -- filled after game
  model_version       TEXT NOT NULL DEFAULT 'v1.0',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one row per player per prop type per day
-- Prevents duplicate edges from multiple detectEdges() runs
CREATE UNIQUE INDEX IF NOT EXISTS idx_pph_player_date_proptype
  ON player_props_history (player_id, game_date, prop_type);

CREATE INDEX IF NOT EXISTS idx_pph_player_date ON player_props_history (player_id, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_pph_date        ON player_props_history (game_date DESC);

-- Which players are confirmed playing tonight (populated at 9 AM before edge detection)
-- is_confirmed_playing: true = active, false = out, null = questionable/uncertain
CREATE TABLE IF NOT EXISTS nightly_roster (
  id                    BIGSERIAL PRIMARY KEY,
  player_id             INTEGER NOT NULL,
  player_name           TEXT    NOT NULL,
  team                  TEXT,
  sport                 TEXT    NOT NULL DEFAULT 'NBA',
  game_date             DATE    NOT NULL,
  is_confirmed_playing  BOOLEAN,             -- null = questionable
  injury_status         TEXT,                -- 'out', 'questionable', 'doubtful', null
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, game_date, sport)
);

CREATE INDEX IF NOT EXISTS idx_nr_date_sport ON nightly_roster (game_date, sport);

-- Our model's full player projections for each game
CREATE TABLE IF NOT EXISTS chalk_projections (
  id                  BIGSERIAL PRIMARY KEY,
  player_id           INTEGER NOT NULL,
  player_name         TEXT    NOT NULL,
  team                TEXT    NOT NULL,
  sport               TEXT    NOT NULL DEFAULT 'NBA',
  game_date           DATE    NOT NULL,
  opponent            TEXT,
  home_away           TEXT,
  proj_points         NUMERIC(7,3),
  proj_rebounds       NUMERIC(7,3),
  proj_assists        NUMERIC(7,3),
  proj_steals         NUMERIC(7,3),
  proj_blocks         NUMERIC(7,3),
  proj_turnovers      NUMERIC(7,3),
  proj_threes         NUMERIC(7,3),
  proj_minutes        NUMERIC(6,2),
  proj_pra            NUMERIC(7,3),
  proj_pts_ast        NUMERIC(7,3),
  proj_pts_reb        NUMERIC(7,3),
  proj_ast_reb        NUMERIC(7,3),
  confidence_score    INTEGER,
  edge_pts            NUMERIC(7,3),
  edge_reb            NUMERIC(7,3),
  edge_ast            NUMERIC(7,3),
  edge_threes         NUMERIC(7,3),
  edge_pra            NUMERIC(7,3),
  edge_pts_ast        NUMERIC(7,3),
  edge_pts_reb        NUMERIC(7,3),
  edge_ast_reb        NUMERIC(7,3),
  model_version       TEXT NOT NULL DEFAULT 'v1.0',
  factors_json        JSONB,              -- all factor multipliers used
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, game_date)
);

-- v3: prop_type column so one row per player × prop × date (replaces single-row-per-player design)
ALTER TABLE chalk_projections ADD COLUMN IF NOT EXISTS prop_type  TEXT;
ALTER TABLE chalk_projections ADD COLUMN IF NOT EXISTS proj_value NUMERIC(7,3);
ALTER TABLE chalk_projections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Drop old single-row-per-player unique constraint (replaced by player+date+prop below)
ALTER TABLE chalk_projections DROP CONSTRAINT IF EXISTS chalk_projections_player_id_game_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_player_date_prop
  ON chalk_projections (player_id, game_date, prop_type);

CREATE INDEX IF NOT EXISTS idx_cp_date ON chalk_projections (game_date DESC);

-- Our model's full team game projections
CREATE TABLE IF NOT EXISTS team_projections (
  id                        BIGSERIAL PRIMARY KEY,
  team_id                   INTEGER NOT NULL,
  team_name                 TEXT    NOT NULL,
  sport                     TEXT    NOT NULL DEFAULT 'NBA',
  game_date                 DATE    NOT NULL,
  opponent                  TEXT,
  home_away                 TEXT,
  proj_points               NUMERIC(7,3),
  proj_points_allowed       NUMERIC(7,3),
  proj_total                NUMERIC(7,3),
  moneyline_projection      NUMERIC(8,3),   -- implied ML
  win_probability           NUMERIC(5,4),
  spread_projection         NUMERIC(7,3),   -- positive = home favourite
  spread_cover_probability  NUMERIC(5,4),
  over_probability          NUMERIC(5,4),
  under_probability         NUMERIC(5,4),
  confidence_score          INTEGER,
  factors_json              JSONB,
  model_version             TEXT NOT NULL DEFAULT 'v1.0',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, game_date)
);

-- v3: prop_type + proj_value for multi-prop team projections
ALTER TABLE team_projections ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE team_projections ADD COLUMN IF NOT EXISTS prop_type  TEXT;
ALTER TABLE team_projections ADD COLUMN IF NOT EXISTS proj_value NUMERIC(7,3);
ALTER TABLE team_projections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE team_projections DROP CONSTRAINT IF EXISTS team_projections_team_id_game_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tp_team_date_prop
  ON team_projections (team_name, game_date, prop_type);

CREATE INDEX IF NOT EXISTS idx_tp_date ON team_projections (game_date DESC);

-- Daily model accuracy tracking — the scoreboard for our engine
CREATE TABLE IF NOT EXISTS model_accuracy (
  id                  BIGSERIAL PRIMARY KEY,
  date                DATE    NOT NULL,
  sport               TEXT    NOT NULL DEFAULT 'NBA',
  model_version       TEXT    NOT NULL DEFAULT 'v1.0',
  total_picks         INTEGER NOT NULL DEFAULT 0,
  correct_picks       INTEGER NOT NULL DEFAULT 0,
  accuracy_pct        NUMERIC(5,4),
  avg_edge_mae        NUMERIC(7,4),       -- mean absolute error of projections
  props_accuracy      NUMERIC(5,4),
  team_accuracy       NUMERIC(5,4),
  best_prop_type      TEXT,
  worst_prop_type     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, sport, model_version)
);

-- Platoon splits: batter performance vs left-handed and right-handed pitchers
CREATE TABLE IF NOT EXISTS player_splits (
    player_id   INTEGER,
    sport       TEXT,
    season      TEXT,
    vs_lhp_avg  NUMERIC(5,3),
    vs_lhp_obp  NUMERIC(5,3),
    vs_lhp_slg  NUMERIC(5,3),
    vs_rhp_avg  NUMERIC(5,3),
    vs_rhp_obp  NUMERIC(5,3),
    vs_rhp_slg  NUMERIC(5,3),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (player_id, sport, season)
);

-- ─────────────────────────────────────────────────────────────
-- MLB Enhanced Data Tables
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pitcher_batter_matchups (
  id              SERIAL PRIMARY KEY,
  pitcher_id      INTEGER NOT NULL,
  pitcher_name    TEXT NOT NULL,
  batter_id       INTEGER NOT NULL,
  batter_name     TEXT NOT NULL,
  ab              INTEGER DEFAULT 0,
  hits            INTEGER DEFAULT 0,
  hr              INTEGER DEFAULT 0,
  bb              INTEGER DEFAULT 0,
  k               INTEGER DEFAULT 0,
  avg             NUMERIC(5,3) DEFAULT 0,
  ops             NUMERIC(5,3) DEFAULT 0,
  season          INTEGER NOT NULL DEFAULT 2025,
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(pitcher_id, batter_id, season)
);

CREATE TABLE IF NOT EXISTS pitcher_arsenal (
  id              SERIAL PRIMARY KEY,
  pitcher_id      INTEGER NOT NULL,
  pitcher_name    TEXT NOT NULL,
  pitch_type      TEXT NOT NULL,  -- FF, SL, CH, CU, SI, etc.
  pitch_name      TEXT,
  avg_velocity    NUMERIC(5,1),
  usage_pct       NUMERIC(5,1),
  whiff_rate      NUMERIC(5,3),
  ba_against      NUMERIC(5,3),
  slg_against     NUMERIC(5,3),
  avg_spin_rate   INTEGER,
  season          INTEGER NOT NULL DEFAULT 2025,
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(pitcher_id, pitch_type, season)
);

CREATE TABLE IF NOT EXISTS bullpen_usage (
  id                      SERIAL PRIMARY KEY,
  team_id                 INTEGER NOT NULL,
  team_abbr               TEXT NOT NULL,
  pitcher_id              INTEGER NOT NULL,
  pitcher_name            TEXT NOT NULL,
  is_closer               BOOLEAN DEFAULT FALSE,
  games_last_3            INTEGER DEFAULT 0,
  pitches_last_3          INTEGER DEFAULT 0,
  innings_last_3          NUMERIC(4,1) DEFAULT 0,
  days_since_last_app     INTEGER,
  collected_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(pitcher_id, collected_date)
);

CREATE TABLE IF NOT EXISTS umpire_tendencies (
  id                  SERIAL PRIMARY KEY,
  umpire_id           INTEGER NOT NULL UNIQUE,
  umpire_name         TEXT NOT NULL,
  games_sampled       INTEGER DEFAULT 0,
  avg_k_per_game      NUMERIC(5,2),
  avg_bb_per_game     NUMERIC(5,2),
  avg_runs_per_game   NUMERIC(5,2),
  over_pct            NUMERIC(5,3),
  zone_rating         TEXT,  -- 'tight', 'normal', 'generous'
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_umpires (
  id              SERIAL PRIMARY KEY,
  game_pk         INTEGER NOT NULL,
  game_date       DATE NOT NULL,
  home_team_id    INTEGER,
  away_team_id    INTEGER,
  hp_umpire_id    INTEGER REFERENCES umpire_tendencies(umpire_id),
  hp_umpire_name  TEXT,
  UNIQUE(game_pk)
);

-- Extended splits columns for player_splits table
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS player_name TEXT;
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS day_avg NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS day_ops NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS night_avg NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS night_ops NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS risp_avg NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS risp_ops NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS ahead_count_avg NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS behind_count_avg NUMERIC(5,3);
ALTER TABLE player_splits ADD COLUMN IF NOT EXISTS two_strike_avg NUMERIC(5,3);
