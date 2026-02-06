const User = require('../models/User');

/**
 * ======================================================================
 * SINGLE SOURCE OF TRUTH - Active User IDs
 * ======================================================================
 * This module provides THE ONLY canonical way to fetch active user IDs.
 * ALL queries that need active users MUST use this function.
 * This ensures consistency across:
 * - Dashboard statistics
 * - Kitchen meal counts
 * - Meal order queries
 * - Subscription counts
 * - Delivery creation
 * ======================================================================
 */

/**
 * Get array of active user IDs
 * 
 * Active users are defined as:
 * - role: 'customer'
 * - isActive: true
 * - deletedAt: not set (does not exist)
 * 
 * @returns {Promise<Array>} Array of MongoDB ObjectIds for active users
 */
async function getActiveUserIds() {
  const activeUserIds = await User.find({
    role: 'customer',
    isActive: true,
    deletedAt: { $exists: false }
  }).distinct('_id');

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n🔐 [activeUserHelper] getActiveUserIds() called`);
    console.log(`   ✅ Found ${activeUserIds.length} active users`);
  }

  return activeUserIds;
}

module.exports = {
  getActiveUserIds
};
