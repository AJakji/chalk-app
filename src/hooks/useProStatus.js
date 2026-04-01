import { useState, useEffect } from 'react';
import Purchases from 'react-native-purchases';
import { useUser } from '@clerk/clerk-expo';

export function useProStatus() {
  const { user } = useUser();
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const customerInfo = await Purchases.getCustomerInfo();
        const hasCrew = !!customerInfo.entitlements.active['crew'];

        if (!cancelled) setIsPro(hasCrew);

        // Sync to Clerk unsafeMetadata so backend can read subscription status
        if (user && hasCrew) {
          await user.update({
            unsafeMetadata: {
              subscription: 'crew',
              revenueCatId: customerInfo.originalAppUserId,
            },
          });
        }
      } catch {
        // Fall back to Clerk publicMetadata if RC is unavailable
        if (!cancelled) {
          const sub = user?.publicMetadata?.subscription;
          setIsPro(sub === 'crew' || sub === 'pro' || sub === 'seasonal');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  return { isPro, isLoading };
}
