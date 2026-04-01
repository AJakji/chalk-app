import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { Platform } from 'react-native';

export const RC_API_KEY   = process.env.EXPO_PUBLIC_REVENUECAT_KEY || 'test_lNqmlblIbtArehvcvGZJSjfGBXY';
export const ENTITLEMENT  = 'crew';

/**
 * Call once at startup (and again when the signed-in user changes).
 * Passing null/undefined lets RevenueCat generate an anonymous ID.
 */
export function configureRevenueCat(clerkUserId) {
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);

  if (Platform.OS === 'ios') {
    Purchases.configure({
      apiKey:    RC_API_KEY,
      appUserID: clerkUserId || null,
    });
  }
}

/** Returns the raw CustomerInfo object from RevenueCat. */
export async function getCustomerInfo() {
  return await Purchases.getCustomerInfo();
}

/** Returns true if the user has an active "crew" entitlement. */
export async function isEntitled() {
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active[ENTITLEMENT];
  } catch {
    return false;
  }
}

/** Restores previous purchases and returns updated CustomerInfo. */
export async function restorePurchases() {
  return await Purchases.restorePurchases();
}
