const express      = require('express');
const router       = express.Router();
const { clerkClient } = require('@clerk/express');
const db           = require('../db');

// RevenueCat webhook — receives purchase/cancellation events
// Must return 200 even on errors so RC doesn't retry endlessly
router.post('/revenuecat',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    res.status(200).json({ received: true }); // respond immediately

    try {
      const body  = JSON.parse(req.body.toString());
      const event = body.event || {};
      const { type, app_user_id, expiration_at_ms, product_id } = event;

      console.log(`[RC Webhook] ${type} — user: ${app_user_id}`);

      if (!app_user_id) return;

      // Find Clerk user by their RC app_user_id (which we set to their Clerk userId)
      let user;
      try {
        user = await clerkClient.users.getUser(app_user_id);
      } catch {
        console.log(`[RC Webhook] Clerk user not found: ${app_user_id}`);
        return;
      }

      const isSeasonal = product_id?.includes('seasonal') || product_id?.includes('six') || product_id?.includes('yearly');
      const plan       = isSeasonal ? 'seasonal' : 'monthly';
      const expiry     = expiration_at_ms ? new Date(expiration_at_ms).toISOString() : null;

      switch (type) {
        case 'INITIAL_PURCHASE':
        case 'RENEWAL':
        case 'PRODUCT_CHANGE':
        case 'NON_RENEWING_PURCHASE':
          await clerkClient.users.updateUser(user.id, {
            publicMetadata: {
              ...user.publicMetadata,
              subscription: 'crew',
              plan,
              expiry,
            },
          });

          await db.query(
            `INSERT INTO subscriptions
               (user_id, plan, status, purchase_date, expiry_date, revenue_cat_id)
             VALUES ($1, $2, 'active', NOW(), $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
               status = 'active', plan = $2,
               expiry_date = $3, updated_at = NOW()`,
            [user.id, plan, expiry, app_user_id]
          );

          console.log(`[RC Webhook] ✅ Crew access granted: ${user.id}`);
          break;

        case 'CANCELLATION':
        case 'EXPIRATION':
        case 'BILLING_ISSUE':
          await clerkClient.users.updateUser(user.id, {
            publicMetadata: {
              ...user.publicMetadata,
              subscription: null,
              plan: null,
              expiry: null,
            },
          });

          await db.query(
            `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW()
             WHERE user_id = $1`,
            [user.id]
          );

          console.log(`[RC Webhook] ❌ Crew access revoked: ${user.id}`);
          break;

        default:
          console.log(`[RC Webhook] Unhandled event type: ${type}`);
      }
    } catch (err) {
      console.error('[RC Webhook] Error:', err.message);
    }
  }
);

module.exports = router;
