const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

// POST /api/users/sync
// Called on first sign-in to create or update a user record in our DB from Clerk.
router.post('/sync', requireAuth, async (req, res) => {
  const { username, displayName, avatar } = req.body;

  try {
    const { rows } = await db.query(
      `INSERT INTO users (clerk_id, username, display_name, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clerk_id) DO UPDATE
         SET username     = COALESCE(EXCLUDED.username, users.username),
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             avatar       = COALESCE(EXCLUDED.avatar, users.avatar)
       RETURNING *`,
      [req.clerkUserId, username || null, displayName || null, avatar || null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('User sync error:', err);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// GET /api/users/me
// Returns the signed-in user's profile.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE clerk_id = $1',
      [req.clerkUserId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found — call /sync first' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/users/me
// Update the signed-in user's profile (display name, bio, avatar, etc).
router.patch('/me', requireAuth, async (req, res) => {
  const { username, displayName, bio, avatar } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE users SET
         username     = COALESCE($1, username),
         display_name = COALESCE($2, display_name),
         bio          = COALESCE($3, bio),
         avatar       = COALESCE($4, avatar)
       WHERE clerk_id = $5
       RETURNING *`,
      [username, displayName, bio, avatar, req.clerkUserId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/users/:id
// Public profile — any user can view any other user's profile.
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, display_name, avatar, bio, streak, streak_type, followers, following FROM users WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching public profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /api/users/:id/follow
// Follow or unfollow another user. Toggling — if already following, unfollow.
router.post('/:id/follow', requireAuth, async (req, res) => {
  const targetId = req.params.id;

  try {
    // Get our own DB user id
    const { rows: me } = await db.query(
      'SELECT id FROM users WHERE clerk_id = $1',
      [req.clerkUserId]
    );
    if (me.length === 0) return res.status(404).json({ error: 'Your profile not found — call /sync first' });
    const myId = me[0].id;

    if (myId === targetId) return res.status(400).json({ error: 'Cannot follow yourself' });

    // Check if already following
    const { rows: existing } = await db.query(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [myId, targetId]
    );

    if (existing.length > 0) {
      // Unfollow
      await db.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [myId, targetId]);
      await db.query('UPDATE users SET following = following - 1 WHERE id = $1', [myId]);
      await db.query('UPDATE users SET followers = followers - 1 WHERE id = $1', [targetId]);
      return res.json({ following: false });
    } else {
      // Follow
      await db.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [myId, targetId]);
      await db.query('UPDATE users SET following = following + 1 WHERE id = $1', [myId]);
      await db.query('UPDATE users SET followers = followers + 1 WHERE id = $1', [targetId]);
      return res.json({ following: true });
    }
  } catch (err) {
    console.error('Follow error:', err);
    res.status(500).json({ error: 'Follow action failed' });
  }
});

module.exports = router;
