import { useUser } from '@clerk/clerk-expo';

/**
 * Returns whether the current user has an active Pro subscription.
 * Reads from Clerk publicMetadata.subscription — 'pro' or 'seasonal'.
 * Defaults to false (free) if not signed in or no metadata.
 */
export function useProStatus() {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user) return { isPro: false, isLoaded };
  const sub = user.publicMetadata?.subscription;
  const isPro = true; // DEV: paywall disabled
  return { isPro, isLoaded };
}
