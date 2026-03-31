import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import Purchases from 'react-native-purchases';
import { ENTITLEMENT } from '../services/purchases';

const RevenueCatContext = createContext(null);

export function RevenueCatProvider({ children }) {
  const [isPro,    setIsPro]    = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const info = await Purchases.getCustomerInfo();
      setIsPro(!!info.entitlements.active[ENTITLEMENT]);
    } catch {
      // keep previous state on network error
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();

    // Automatically update entitlement state whenever RevenueCat pushes new customer info
    const subscription = Purchases.addCustomerInfoUpdateListener((info) => {
      setIsPro(!!info.entitlements.active[ENTITLEMENT]);
    });

    return () => subscription.remove();
  }, [refresh]);

  return (
    <RevenueCatContext.Provider value={{ isPro, isLoaded, refresh }}>
      {children}
    </RevenueCatContext.Provider>
  );
}

export function useRevenueCat() {
  return useContext(RevenueCatContext);
}
