/**
 * useProfile — fetches the signed-in user's profile from /api/users/me.
 * Falls back to a skeleton built from Clerk's user object if the API is unavailable.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { API_URL } from '../config';

export default function useProfile() {
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setProfile(normalizeProfile(data));
    } catch (e) {
      console.warn('Profile API unavailable:', e.message);
      if (clerkUser) {
        setProfile(clerkFallback(clerkUser));
      } else {
        setProfile(guestProfile());
      }
    } finally {
      setLoading(false);
    }
  }, [clerkUser]);

  useEffect(() => { load(); }, [load]);

  return { profile, loading, refresh: load };
}

// Maps the DB row (snake_case) → shape ProfileHeader expects
function normalizeProfile(row) {
  return {
    id:          row.id,
    username:    row.username,
    displayName: row.display_name || row.displayName || row.username,
    avatar:      row.avatar || '😎',
    bio:         row.bio || null,
    streak:      row.streak ?? 0,
    streakType:  row.streak_type || row.streakType || 'hot',
    followers:   row.followers_count ?? row.followers ?? 0,
    following:   row.following_count ?? row.following ?? 0,
    record: {
      last10: row.last10 || row.record?.last10 || [],
    },
    recentPicks: row.recent_picks || row.recentPicks || [],
  };
}

// No auth at all — show a guest profile so the Profile screen never stays blank
function guestProfile() {
  return {
    id:          'guest',
    username:    null,
    displayName: 'Guest',
    avatar:      '👤',
    bio:         null,
    streak:      0,
    streakType:  'hot',
    followers:   0,
    following:   0,
    record:      { last10: [] },
    recentPicks: [],
  };
}

// Minimal profile built purely from Clerk — shows while DB is being set up
function clerkFallback(clerkUser) {
  return {
    id:          clerkUser.id,
    username:    clerkUser.username || null,
    displayName: clerkUser.fullName || clerkUser.username || null,
    avatar:      '😎',
    bio:         null,
    streak:      0,
    streakType:  'hot',
    followers:   0,
    following:   0,
    record:      { last10: [] },
    recentPicks: [],
  };
}
