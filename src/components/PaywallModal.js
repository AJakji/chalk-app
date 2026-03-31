import { useEffect } from 'react';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { useRevenueCat } from '../context/RevenueCatContext';

/**
 * Triggers the RevenueCat Paywall UI whenever `visible` flips to true.
 * The native sheet slides up automatically and dismisses itself.
 * We refresh entitlement state after the user closes the paywall.
 */
export default function PaywallModal({ visible, onClose }) {
  const { refresh } = useRevenueCat();

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    (async () => {
      try {
        await RevenueCatUI.presentPaywallIfNeeded({
          requiredEntitlementIdentifier: "Chalky's Crew",
        });
      } catch {
        // user closed without purchasing — not an error
      } finally {
        if (!cancelled) {
          await refresh();   // re-check entitlement after dismissal
          onClose();
        }
      }
    })();

    return () => { cancelled = true; };
  }, [visible]);

  return null;
}
