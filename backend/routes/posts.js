const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getAuth } = require('@clerk/express');
const db = require('../db');

// ── Helpers ──────────────────────────────────────────────────────────────────

// Resolve Clerk JWT → our DB user id (returns null if not signed in or not found)
async function viewerDbId(req) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const { rows } = await db.query('SELECT id FROM users WHERE clerk_id = $1', [userId]);
  return rows[0]?.id || null;
}

// Shared query — posts with author info + reaction counts + viewer's own reaction
async function fetchPosts(orderBy, viewerId) {
  const { rows } = await db.query(`
    SELECT
      p.id,
      p.user_id,
      p.league,
      p.pick_type,
      p.pick,
      p.game,
      p.game_time,
      p.odds,
      p.confidence,
      p.reasoning AS caption,
      p.tails,
      p.fades,
      p.result,
      p.created_at,
      u.username,
      u.display_name,
      u.avatar,
      u.streak,
      u.streak_type,
      u.followers,
      COALESCE(
        (SELECT json_object_agg(type, cnt)
         FROM (SELECT type, COUNT(*)::int AS cnt FROM reactions WHERE post_id = p.id GROUP BY type) t),
        '{}'::json
      ) AS reactions,
      (SELECT type FROM reactions WHERE post_id = p.id AND user_id = $1 LIMIT 1) AS my_reaction
    FROM posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY ${orderBy}
    LIMIT 50
  `, [viewerId]);
  return rows;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/posts/feed — latest 50 posts, newest first
router.get('/feed', async (req, res) => {
  try {
    const vid = await viewerDbId(req);
    const posts = await fetchPosts('p.created_at DESC', vid);
    res.json({ posts });
  } catch (err) {
    console.error('Feed error:', err.message);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

// GET /api/posts/top — top 50 posts by tails
router.get('/top', async (req, res) => {
  try {
    const vid = await viewerDbId(req);
    const posts = await fetchPosts('p.tails DESC', vid);
    res.json({ posts });
  } catch (err) {
    console.error('Top posts error:', err.message);
    res.status(500).json({ error: 'Failed to load top posts' });
  }
});

// POST /api/posts — create a pick post
router.post('/', requireAuth, async (req, res) => {
  const { league, pickType, pick, game, gameTime, odds, confidence, caption } = req.body;
  if (!league || !pick || !game) {
    return res.status(400).json({ error: 'league, pick, and game are required' });
  }

  try {
    const { rows: me } = await db.query(
      'SELECT id FROM users WHERE clerk_id = $1',
      [req.clerkUserId]
    );
    if (me.length === 0) return res.status(404).json({ error: 'User not found — call /sync first' });

    const { rows } = await db.query(
      `INSERT INTO posts (user_id, league, pick_type, pick, game, game_time, odds, confidence, reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [me[0].id, league, pickType || null, pick, game, gameTime || null, odds || null, confidence || null, caption || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create post error:', err.message);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// POST /api/posts/:id/react/:type — toggle a reaction (one reaction per user per post)
router.post('/:id/react/:type', requireAuth, async (req, res) => {
  const VALID = ['lock', 'fire', 'cap', 'fade', 'hit'];
  const { id, type } = req.params;
  if (!VALID.includes(type)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  try {
    const { rows: me } = await db.query(
      'SELECT id FROM users WHERE clerk_id = $1',
      [req.clerkUserId]
    );
    if (me.length === 0) return res.status(404).json({ error: 'User not found' });
    const userId = me[0].id;

    const { rows: existing } = await db.query(
      'SELECT id, type FROM reactions WHERE post_id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.length > 0 && existing[0].type === type) {
      // Same reaction — remove it (toggle off)
      await db.query('DELETE FROM reactions WHERE post_id = $1 AND user_id = $2', [id, userId]);
      return res.json({ reacted: false, type: null });
    } else {
      // Different reaction or no reaction — replace with new one
      await db.query('DELETE FROM reactions WHERE post_id = $1 AND user_id = $2', [id, userId]);
      await db.query(
        'INSERT INTO reactions (post_id, user_id, type) VALUES ($1, $2, $3)',
        [id, userId, type]
      );
      return res.json({ reacted: true, type });
    }
  } catch (err) {
    console.error('React error:', err.message);
    res.status(500).json({ error: 'Failed to react' });
  }
});

// POST /api/posts/:id/tail — increment tails counter
router.post('/:id/tail', async (req, res) => {
  try {
    await db.query('UPDATE posts SET tails = tails + 1 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to tail' });
  }
});

// POST /api/posts/:id/fade — increment fades counter
router.post('/:id/fade', async (req, res) => {
  try {
    await db.query('UPDATE posts SET fades = fades + 1 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fade' });
  }
});

module.exports = router;
