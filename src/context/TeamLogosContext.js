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

// Maps abbreviations our APIs use → abbreviations ESPN's CDN uses.
// SportsData.io and The Odds API use different abbrs than ESPN in some cases.
const ABBR_ALIASES = {
  // NBA
  'NBA_GSW':  'NBA_GS',
  'NBA_NOP':  'NBA_NO',
  'NBA_NYK':  'NBA_NY',
  'NBA_SAS':  'NBA_SA',
  'NBA_UTA':  'NBA_UTAH',
  'NBA_WAS':  'NBA_WSH',
  // NHL
  'NHL_LAK':  'NHL_LA',
  'NHL_NJD':  'NHL_NJ',
  'NHL_SJS':  'NHL_SJ',
  'NHL_TBL':  'NHL_TB',
  // MLB
  'MLB_OAK':  'MLB_ATH',
  'MLB_CWS':  'MLB_CHW',
  'MLB_KCR':  'MLB_KC',
  'MLB_SDP':  'MLB_SD',
  'MLB_SFG':  'MLB_SF',
  'MLB_TBR':  'MLB_TB',
  'MLB_WSN':  'MLB_WSH',
};

// Hook — returns a getLogo(nameOrAbbr, league) function
// Works with abbreviations ("GSW"), full names ("Golden State Warriors"),
// nicknames ("Warriors"), or locations ("Golden State")
export function useTeamLogos() {
  const logos = useContext(TeamLogosContext);

  return (nameOrAbbr, league) => {
    if (!nameOrAbbr || !league) return null;
    const key = `${league.toUpperCase()}_${nameOrAbbr.toUpperCase()}`;
    return logos[key] ?? logos[ABBR_ALIASES[key]] ?? null;
  };
}
