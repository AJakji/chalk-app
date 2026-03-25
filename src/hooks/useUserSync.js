/**
 * useUserSync — runs once after the user signs in.
 * Calls /api/users/sync to create or update their record in the database.
 */
import { useEffect, useRef } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { API_URL } from '../config';

export default function useUserSync() {
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const synced = useRef(false);

  useEffect(() => {
    if (!isSignedIn || !user || synced.current) return;

    async function sync() {
      try {
        const token = await getToken();
        await fetch(`${API_URL}/api/users/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            username: user.username || user.id,
            displayName: user.fullName || user.username || 'Chalky User',
          }),
        });
        synced.current = true;
      } catch (e) {
        console.warn('User sync failed (non-fatal):', e.message);
      }
    }

    sync();
  }, [isSignedIn, user]);
}
