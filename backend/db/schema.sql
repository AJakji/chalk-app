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
