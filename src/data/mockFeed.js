// Mock feed data — will be replaced with real user-generated content from the backend

// Chalky — the official AI account. Verified. Always first.
export const chalkyUser = {
  id: 'u_chalky',
  username: 'chalky',
  displayName: 'Chalky',
  avatar: null,        // renders ChalkyAvatar component, not emoji
  isChalky: true,
  verified: true,
  streak: 5,
  streakType: 'hot',
  record: { last10: [1,1,0,1,1,1,1,0,1,1] }, // 8-2
  followers: 48200,
};

export const mockUsers = [
  chalkyUser,
  {
    id: 'u1',
    username: 'sharpangle',
    displayName: 'Sharp Angle',
    avatar: '🎯',
    streak: 7,
    streakType: 'hot',
    record: { last10: [1,1,1,0,1,1,1,0,1,1] }, // 1=win 0=loss
    followers: 4821,
  },
  {
    id: 'u2',
    username: 'lockoftheday',
    displayName: 'Lock of the Day',
    avatar: '🔒',
    streak: 3,
    streakType: 'hot',
    record: { last10: [0,1,0,1,1,1,0,1,1,1] },
    followers: 11203,
  },
  {
    id: 'u3',
    username: 'fadetheworld',
    displayName: 'Fade The World',
    avatar: '🌊',
    streak: 2,
    streakType: 'cold',
    record: { last10: [1,0,1,1,0,0,1,0,0,0] },
    followers: 893,
  },
  {
    id: 'u4',
    username: 'analyticsedge',
    displayName: 'Analytics Edge',
    avatar: '📈',
    streak: 5,
    streakType: 'hot',
    record: { last10: [0,1,1,1,0,1,1,1,1,1] },
    followers: 2347,
  },
  {
    id: 'u5',
    username: 'nbainsider',
    displayName: 'NBA Insider',
    avatar: '🏀',
    streak: 1,
    streakType: 'cold',
    record: { last10: [1,1,0,0,1,0,1,0,1,0] },
    followers: 6612,
  },
];

export const mockPosts = [
  // Chalky's official posts — pinned to top
  {
    id: 'c1',
    userId: 'u_chalky',
    createdAt: 'Just now',
    league: 'NBA',
    pick: 'Celtics -4.5',
    pickType: 'Spread',
    game: 'GSW @ BOS',
    gameTime: 'Tonight 7:30 PM ET',
    odds: '-108',
    confidence: 84,
    caption: "Warriors on a back-to-back. Curry questionable. Boston at home is a problem for everyone right now. I studied this line until 3am. Celtics cover.",
    reactions: { lock: 1842, fire: 934, cap: 44, fade: 28, hit: 0 },
    userReaction: null,
    tails: 3812,
    fades: 201,
    affiliateLinks: {
      draftkings: 'https://draftkings.com',
      fanduel: 'https://fanduel.com',
    },
  },
  {
    id: 'p1',
    userId: 'u1',
    createdAt: '2m ago',
    league: 'NBA',
    pick: 'Celtics -4.5',
    pickType: 'Spread',
    game: 'GSW @ BOS',
    gameTime: 'Tonight 7:30 PM ET',
    odds: '-110',
    confidence: 84,
    caption: 'Warriors on a back-to-back, Curry questionable. Boston at home is a problem for everyone right now. Easy money.',
    reactions: { lock: 142, fire: 89, cap: 12, fade: 8, hit: 0 },
    userReaction: null,
    tails: 234,
    fades: 31,
    affiliateLinks: {
      draftkings: 'https://draftkings.com',
      fanduel: 'https://fanduel.com',
    },
  },
  {
    id: 'p3',
    userId: 'u4',
    createdAt: '28m ago',
    league: 'NBA',
    pick: 'Nuggets ML',
    pickType: 'Moneyline',
    game: 'DEN @ LAL',
    gameTime: 'Tonight 10:00 PM ET',
    odds: '-130',
    confidence: 71,
    caption: 'LeBron is OUT. Jokic is averaging a triple-double in his last 5 and literally owns the Lakers. Model has Denver at 71% win probability at -130 (implied 56.5%). Value.',
    reactions: { lock: 88, fire: 55, cap: 22, fade: 14, hit: 0 },
    userReaction: null,
    tails: 178,
    fades: 44,
    affiliateLinks: {
      draftkings: 'https://draftkings.com',
      fanduel: 'https://fanduel.com',
    },
  },
  {
    id: 'p4',
    userId: 'u2',
    createdAt: '1h ago',
    league: 'Soccer',
    pick: 'Real Madrid ML',
    pickType: 'Moneyline',
    game: 'BAR @ RMA',
    gameTime: 'Today 3:00 PM ET',
    odds: '+105',
    confidence: 62,
    caption: 'El Clásico at the Bernabéu. Bellingham back from injury. Madrid at home in this fixture is 12-3 in the last 5 years. Plus odds on the best team? Yes please.',
    reactions: { lock: 201, fire: 178, cap: 31, fade: 22, hit: 0 },
    userReaction: null,
    tails: 412,
    fades: 89,
    affiliateLinks: {
      draftkings: 'https://draftkings.com',
      fanduel: 'https://fanduel.com',
    },
  },
  {
    id: 'p5',
    userId: 'u5',
    createdAt: '2h ago',
    league: 'NBA',
    pick: 'Heat ML',
    pickType: 'Moneyline',
    game: 'PHX @ MIA',
    gameTime: 'Yesterday — Final',
    odds: '-115',
    confidence: 68,
    caption: 'Miami Heat in playoff mode. Butler goes crazy in these spots. Called it.',
    reactions: { lock: 67, fire: 122, cap: 4, fade: 3, hit: 89 },
    userReaction: null,
    result: 'win',
    finalScore: 'MIA 114 – PHX 108',
    tails: 156,
    fades: 28,
    affiliateLinks: {
      draftkings: 'https://draftkings.com',
      fanduel: 'https://fanduel.com',
    },
  },
];

export const suggestedPickers = [
  chalkyUser,      // Chalky always first
  mockUsers[1],    // sharpangle
  mockUsers[2],    // lockoftheday
  mockUsers[4],    // analyticsedge
];
