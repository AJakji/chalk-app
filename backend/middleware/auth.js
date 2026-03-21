const { clerkMiddleware, getAuth } = require('@clerk/express');

// Attach Clerk auth to every request (does not block unauthenticated requests)
const clerkAuth = clerkMiddleware();

// Use this on any route that requires a signed-in user
function requireAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required' });
  }
  req.clerkUserId = userId;
  next();
}

module.exports = { clerkAuth, requireAuth };
