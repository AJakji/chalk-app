import { useState, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import {
  fetchFeed,
  fetchTopPosts,
  reactToPost,
  tailPost,
  fadePost,
} from '../services/api';
import { mockPosts, mockUsers, chalkyUser } from '../data/mockFeed';

// Build mock data in the shape the hook returns (with embedded user)
function getMockPosts() {
  const userMap = Object.fromEntries(mockUsers.map((u) => [u.id, u]));
  return mockPosts.map((p) => ({
    ...p,
    user: userMap[p.userId] || chalkyUser,
  }));
}

export default function useFeed() {
  const { getToken } = useAuth();
  const [forYouPosts, setForYouPosts] = useState([]);
  const [topPosts, setTopPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load both tabs in parallel
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [feedData, topData] = await Promise.all([fetchFeed(), fetchTopPosts()]);
      setForYouPosts(feedData);
      setTopPosts(topData);
    } catch (err) {
      console.warn('Feed API unavailable, using mock data:', err.message);
      const mock = getMockPosts();
      setForYouPosts(mock);
      setTopPosts([...mock].sort((a, b) => b.tails - a.tails));
    } finally {
      setLoading(false);
    }
  }, []);

  // Optimistic reaction toggle — updates both lists at once
  const react = useCallback(async (postId, type) => {
    const applyReaction = (posts) =>
      posts.map((p) => {
        if (p.id !== postId) return p;
        const isToggleOff = p.userReaction === type;
        const reactions = { ...p.reactions };
        if (p.userReaction && !isToggleOff) {
          reactions[p.userReaction] = Math.max(0, (reactions[p.userReaction] ?? 0) - 1);
        }
        reactions[type] = Math.max(0, (reactions[type] ?? 0) + (isToggleOff ? -1 : 1));
        return { ...p, reactions, userReaction: isToggleOff ? null : type };
      });

    setForYouPosts((prev) => applyReaction(prev));
    setTopPosts((prev) => applyReaction(prev));

    try {
      const token = await getToken();
      if (token) await reactToPost(postId, type, token);
    } catch (err) {
      console.warn('React API failed (optimistic state kept):', err.message);
    }
  }, [getToken]);

  // Optimistic tail increment
  const tail = useCallback(async (postId) => {
    const inc = (posts) =>
      posts.map((p) => (p.id === postId ? { ...p, tails: p.tails + 1 } : p));
    setForYouPosts((prev) => inc(prev));
    setTopPosts((prev) => inc(prev));

    try {
      await tailPost(postId);
    } catch (err) {
      console.warn('Tail API failed:', err.message);
    }
  }, []);

  // Optimistic fade increment
  const fade = useCallback(async (postId) => {
    const inc = (posts) =>
      posts.map((p) => (p.id === postId ? { ...p, fades: p.fades + 1 } : p));
    setForYouPosts((prev) => inc(prev));
    setTopPosts((prev) => inc(prev));

    try {
      await fadePost(postId);
    } catch (err) {
      console.warn('Fade API failed:', err.message);
    }
  }, []);

  return { forYouPosts, topPosts, loading, load, react, tail, fade };
}
