# Chalk — AI Sports Picks App

## Project overview
You are helping me build Chalk — a free AI-powered sports picks app for iOS and Android. I am Andrew Jakji, a non-technical founder. You are my developer. Build everything I describe and explain what you are doing in plain English.

## Founder context
Andrew Jakji, Ancaster Ontario. Previously built Cuppa Buckets (300K+ Instagram followers, basketball content) and Dapper Gang Clothing ($100K+ revenue). Non-technical — explain decisions simply.

## Brand
- App name: Chalk
- Tagline: "AI picks. No noise."
- Colours: #0A0A0A black, #F5F5F0 off-white, #00E87A green (wins/CTAs), #FF4444 red (losses/live), #888888 grey (secondary text)
- Font: System sans-serif (SF Pro iOS, Roboto Android)
- Tone: Confident, data-driven. Bloomberg meets sports bar.

## Tech stack
- React Native (iOS + Android single codebase)
- Node.js backend
- PostgreSQL database
- Redis for real-time chat
- Socket.io for game room chat
- Anthropic Claude API (claude-sonnet-4-6) for AI picks engine
- The Odds API for live odds
- API-Sports for live scores, box scores, stats
- Firebase Cloud Messaging for push notifications
- Clerk for authentication
- Vercel for frontend hosting, Railway for backend

## App structure — 5 screens with bottom navigation
1. Picks — AI-generated daily picks with confidence scores, tappable for full statistical analysis
2. Scores — Live scores, box scores, player stats, play-by-play across NFL/NBA/Soccer/NHL/MLB
3. Feed — For You (personalised by follow) and Top/Trending tabs, pick posts, tail/fade mechanics
4. Rooms — Real-time game room chat per live game via Socket.io
5. Profile — Streak display, last 10 picks visualiser, followers/following, recent picks

## Key features
- AI pick cards with confidence score bar and "Tap for analysis" hint
- Pick detail view: AI reasoning sections, key stats bars, matchup breakdown, trends, odds comparison, affiliate bet button
- Affiliate bet buttons on every pick linking to DraftKings/FanDuel/BetMGM/bet365
- Best odds highlighted in green automatically
- Live scores with Chalk pick overlay on active games
- Social feed with 5 custom reactions: Lock, Fire, Cap, Fade, Hit
- Tail and fade mechanics — both open affiliate sportsbook links
- Streak badges on every pick post (hot streak green, cold streak red)
- Game rooms are pure real-time chat — no structured post format
- Follow system with push notifications when followed users post picks
- User profiles show streak and last 10 picks — NO all-time win/loss record
- Suggested pickers to follow on first open (solves cold start problem)

## Monetization
- Fully free app — no subscription or paywall
- Revenue: sportsbook affiliate commissions (CPA $25-$75 per signup, RevShare 25-40%)
- Secondary: in-app advertising
- Every bet button is an affiliate link

## Supported leagues
NFL, NBA, World Cup/Soccer, NHL, MLB

## Launch target
June 11 2026 — FIFA World Cup 2026 kickoff
September 2026 — NFL season scale-up

## Build order
1. App shell — bottom nav, brand design system, screen placeholders
2. Picks screen — pick cards, confidence scores, detail view with stats
3. Scores section — live scores, box scores, player stats, play-by-play
4. Social feed — For You, Top tabs, pick posts, tail/fade, reactions
5. Game rooms — real-time Socket.io chat per game
6. Follow system — follow/unfollow, push notifications
7. User profiles — streak, last 10 picks, followers

## Important rules
- Always explain what you are building in plain English before writing code
- Build one section at a time and confirm before moving to the next
- Use the Chalk colour system consistently throughout
- Every bet button must include an affiliate link placeholder
- Never add a paywall or subscription gate anywhere