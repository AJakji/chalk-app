// API base URL — change this when you deploy to Railway
// For local dev: run `npm run dev` in the backend folder first
const DEV_API_URL = 'http://192.168.2.26:3001';
const PROD_API_URL = 'https://chalk-app-production-7ce5.up.railway.app';

export const API_URL = __DEV__ ? DEV_API_URL : PROD_API_URL;

export const AFFILIATE_LINKS = {
  draftkings: 'https://draftkings.com',  // replace with your real affiliate URLs
  fanduel:    'https://fanduel.com',
  betmgm:     'https://betmgm.com',
  bet365:     'https://bet365.com',
};
