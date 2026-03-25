// API base URL — auto-detects local IP in dev so you never need to update this manually
import Constants from 'expo-constants';

const PROD_API_URL = 'https://chalk-app-production-7ce5.up.railway.app';

function getDevApiUrl() {
  // Expo injects the Metro bundler host — strip the port and use 3001
  const host = Constants.expoConfig?.hostUri?.split(':')[0] || '192.168.2.200';
  return `http://${host}:3001`;
}

export const API_URL = PROD_API_URL;

export const AFFILIATE_LINKS = {
  draftkings: 'https://draftkings.com',  // replace with your real affiliate URLs
  fanduel:    'https://fanduel.com',
  betmgm:     'https://betmgm.com',
  bet365:     'https://bet365.com',
};
