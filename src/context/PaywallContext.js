import React, { createContext, useContext, useState } from 'react';

const PaywallContext = createContext(null);

export function PaywallProvider({ children }) {
  const [visible, setVisible] = useState(false);

  return (
    <PaywallContext.Provider value={{ visible, openPaywall: () => setVisible(true), closePaywall: () => setVisible(false) }}>
      {children}
    </PaywallContext.Provider>
  );
}

export function usePaywall() {
  return useContext(PaywallContext);
}
