// Mock rooms data — each live/upcoming game gets one room
// Real-time messages will come via Socket.io once backend is connected

export const mockRooms = [
  {
    id: 'r1',
    gameId: 'g1',
    league: 'NBA',
    title: 'Celtics vs Warriors',
    status: 'live',
    clock: 'Q3 4:22',
    awayTeam: { abbr: 'GSW', score: 78 },
    homeTeam: { abbr: 'BOS', score: 91 },
    chalkPick: 'Celtics -4.5',
    activeUsers: 1247,
    messages: [
      { id: 'm1', userId: 'u_jay', username: 'jay_bets', avatar: '🏀', text: 'Celtics up 13 in Q3 lol this is over', timestamp: '2m ago', isOwn: false },
      { id: 'm2', userId: 'u_gswfan', username: 'dubnation', avatar: '🌉', text: 'Curry woke up. Watch this Q4', timestamp: '1m ago', isOwn: false },
      { id: 'm3', userId: 'u_chalk', username: 'chalkpicks', avatar: '🎯', text: '🎯 Chalky Pick: Celtics -4.5 — currently WINNING', timestamp: '1m ago', isOwn: false, isChalk: true },
      { id: 'm4', userId: 'u_sharp', username: 'sharpangle', avatar: '📊', text: 'BOS 18-4 ATS at home. Called this one yesterday', timestamp: '45s ago', isOwn: false },
      { id: 'm5', userId: 'u_me', username: 'you', avatar: '😎', text: 'Tatum just cooked Wiggins again 🔥', timestamp: '30s ago', isOwn: true },
      { id: 'm6', userId: 'u_fade', username: 'fadeking', avatar: '👻', text: 'I faded this one 😭', timestamp: '20s ago', isOwn: false },
      { id: 'm7', userId: 'u_stat', username: 'nbanerds', avatar: '🤓', text: 'Celtics on pace for 118 tonight. Model was right', timestamp: '10s ago', isOwn: false },
    ],
  },
  {
    id: 'r2',
    gameId: 'g2',
    league: 'NBA',
    title: 'Nuggets vs Lakers',
    status: 'live',
    clock: 'Q2 11:04',
    awayTeam: { abbr: 'DEN', score: 48 },
    homeTeam: { abbr: 'LAL', score: 41 },
    chalkPick: 'Nuggets ML',
    activeUsers: 892,
    messages: [
      { id: 'm1', userId: 'u_jok', username: 'joker_fan', avatar: '👑', text: 'Jokic with 18/11/7 in the first half lmaooo', timestamp: '3m ago', isOwn: false },
      { id: 'm2', userId: 'u_lal', username: 'lakersnation', avatar: '💜', text: 'Without LeBron we have no chance at all', timestamp: '2m ago', isOwn: false },
      { id: 'm3', userId: 'u_chalk', username: 'chalkpicks', avatar: '🎯', text: '🎯 Chalky Pick: Nuggets ML — currently WINNING', timestamp: '2m ago', isOwn: false, isChalk: true },
      { id: 'm4', userId: 'u_val', username: 'betvalue', avatar: '💰', text: 'Got Nuggets -130 on FD. Easy money with Bron out', timestamp: '1m ago', isOwn: false },
      { id: 'm5', userId: 'u_ad', username: 'adszn', avatar: '🏆', text: 'AD with 16 in first half at least. Fighting solo', timestamp: '30s ago', isOwn: false },
    ],
  },
  {
    id: 'r4',
    gameId: 'g5',
    league: 'Soccer',
    title: 'El Clásico 🔥',
    status: 'live',
    clock: '67\'',
    awayTeam: { abbr: 'BAR', score: 1 },
    homeTeam: { abbr: 'RMA', score: 2 },
    chalkPick: 'Real Madrid ML',
    activeUsers: 5821,
    messages: [
      { id: 'm1', userId: 'u_vini', username: 'vinifan', avatar: '⚡', text: 'VINIIII GOAALLLL 🔥🔥🔥 2-1 Madrid!!', timestamp: '3m ago', isOwn: false },
      { id: 'm2', userId: 'u_bar', username: 'blaugrana', avatar: '🔵', text: 'Refs are absolutely terrible this is corruption', timestamp: '2m ago', isOwn: false },
      { id: 'm3', userId: 'u_chalk', username: 'chalkpicks', avatar: '🎯', text: '🎯 Chalky Pick: Real Madrid ML — currently WINNING', timestamp: '2m ago', isOwn: false, isChalk: true },
      { id: 'm4', userId: 'u_belli', username: 'bellibell', avatar: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', text: 'Bellingham class. Madrid hold on please 🙏', timestamp: '1m ago', isOwn: false },
      { id: 'm5', userId: 'u_neutral', username: 'neutralfan', avatar: '⚽', text: 'This is the best game of the year so far', timestamp: '45s ago', isOwn: false },
      { id: 'm6', userId: 'u_madbet', username: 'madridbet', avatar: '💰', text: 'Got ML at +105 before kickoff. Come on boys!!', timestamp: '20s ago', isOwn: false },
    ],
  },
];

// Simulated incoming messages for live rooms — cycle through these
export const simulatedMessages = {
  r1: [
    { userId: 'u_new1', username: 'celts_fan', avatar: '🍀', text: 'Tatum is COLD tonight 🥶' },
    { userId: 'u_new2', username: 'gsw_forever', avatar: '💛', text: 'Warriors making a run, 10-2 to start Q4' },
    { userId: 'u_new3', username: 'bettor99', avatar: '📊', text: 'Cover looking safe right now. BOS +13' },
    { userId: 'u_new4', username: 'liveodds', avatar: '💹', text: 'Line moved to -6.5 live. Celtics covering easy' },
  ],
  r2: [
    { userId: 'u_new5', username: 'murray_szn', avatar: '🏔️', text: 'Murray dropping 30 tonight easy' },
    { userId: 'u_new6', username: 'laker_pain', avatar: '😢', text: 'Miss LeBron so much rn' },
    { userId: 'u_new7', username: 'sharpshooter', avatar: '🎯', text: 'Jokic triple double incoming. 2 more assists' },
  ],
  r4: [
    { userId: 'u_new8', username: 'madrid_mad', avatar: '👑', text: 'HOLD THE LINE MADRID 20 mins left!!' },
    { userId: 'u_new9', username: 'barca_hope', avatar: '🌹', text: 'Lewandowski will equalise, believe' },
    { userId: 'u_new10', username: 'punter_uk', avatar: '🇬🇧', text: 'Cashed out at +80. Too nerve wracking lol' },
  ],
};
