import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchTeamLogos } from '../services/espn';

const TeamLogosContext = createContext({});

export function TeamLogosProvider({ children }) {
  const [logos, setLogos] = useState({});

  useEffect(() => {
    fetchTeamLogos()
      .then(setLogos)
      .catch(() => {}); // fail silently — app works fine without logos
  }, []);

  return (
    <TeamLogosContext.Provider value={logos}>
      {children}
    </TeamLogosContext.Provider>
  );
}

// Hook — returns a getLogo(nameOrAbbr, league) function
// Works with abbreviations ("GSW"), full names ("Golden State Warriors"),
// nicknames ("Warriors"), or locations ("Golden State")
export function useTeamLogos() {
  const logos = useContext(TeamLogosContext);

  return (nameOrAbbr, league) => {
    if (!nameOrAbbr || !league) return null;
    const key = `${league.toUpperCase()}_${nameOrAbbr.toUpperCase()}`;
    return logos[key] ?? null;
  };
}
