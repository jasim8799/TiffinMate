const moment = require('moment-timezone');
const { getISTDayBounds, getISTNow } = require('./dateService');

/**
 * ======================================================================
 * SINGLE SOURCE OF TRUTH - Meal Counting Logic
 * ======================================================================
 * This module defines THE ONLY canonical way to count meals.
 * Both Dashboard and Kitchen MUST use these functions.
 * NO other counting logic is allowed anywhere in the system.
 *
 * KITCHEN RULE: Always query TODAY (IST). Never flip to tomorrow.
 * At midnight IST, "today" becomes the new day automatically.
 * ======================================================================
 */

/**
 * Get meals for TODAY (IST) — used by kitchen and dashboard.
 *
 * @param {Array} activeUserIds - Array of active user IDs to include
 * @param {Object} MealOrder - Mongoose model
 * @returns {Promise<Object>} { mealOrders, lunchCount, dinnerCount, totalUsers }
 */
async function getTodayMeals(activeUserIds, MealOrder) {
  // ✅ ALWAYS use TODAY IST — never flip to tomorrow after cutoff.
  //    Kitchen prepares today's meals until midnight.
  const { startUTC: start, nextDayStartUTC: end } = getISTDayBounds();

  const now = getISTNow();
  const isAfterCutoff = now.hour() >= 23;

  if (process.env.NODE_ENV !== 'production') {
    console.log('\n🔍 [mealCounter.js] getTodayMeals() called');
    console.log('📅 Date Boundaries:');
    console.log('   - Current Time (IST):', now.format('YYYY-MM-DD HH:mm:ss'));
    console.log('   - After Cutoff?:', isAfterCutoff ? 'YES (but still showing TODAY)' : 'NO');
    console.log('   - Query Start (UTC):', start.toISOString());
    console.log('   - Query End   (UTC):', end.toISOString());
    console.log('👥 Active Users in Query:', activeUserIds.length);
  }

  // ✅ Query meals for TODAY IST (always today, never tomorrow)
  const mealsToday = await MealOrder.find({
    deliveryDate: { $gte: start, $lt: end },
    user:         { $in: activeUserIds },
    status:       { $ne: 'cancelled' },
    'selectedMeal.isSkip': { $ne: true },
  }).populate('user', 'name mobile userId address');

  // Count by meal type
  let lunchCount = 0;
  let dinnerCount = 0;

  mealsToday.forEach(order => {
    if (order.mealType === 'lunch') {
      lunchCount++;
    } else if (order.mealType === 'dinner') {
      dinnerCount++;
    }
  });

  const totalUsers = mealsToday.length;

  // Safety log with sample data
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n📊 Results:');
    console.log('   - Total Orders:', totalUsers);
    console.log('   - Lunch:', lunchCount);
    console.log('   - Dinner:', dinnerCount);
    
    if (mealsToday.length > 0) {
      console.log('\n📝 Sample Meal Orders (first 3):');
      mealsToday.slice(0, 3).forEach((order, idx) => {
        console.log(`   ${idx + 1}. User: ${order.user?.name || 'N/A'}`);
        console.log(`      - Created:  ${order.createdAt ? new Date(order.createdAt).toISOString() : 'N/A'}`);
        console.log(`      - Delivery: ${order.deliveryDate ? new Date(order.deliveryDate).toISOString() : 'N/A'}`);
        console.log(`      - Type: ${order.mealType}`);
      });
    } else {
      console.log('\n⚠️ NO MEALS FOUND FOR TODAY');
    }
  }

  // Check for duplicates
  const userMealKeys = new Map();
  const duplicates = [];

  mealsToday.forEach(order => {
    const key = `${order.user._id}_${order.mealType}`;
    if (userMealKeys.has(key)) {
      duplicates.push({
        user: order.user.name,
        mealType: order.mealType,
        ids: [userMealKeys.get(key), order._id]
      });
    } else {
      userMealKeys.set(key, order._id);
    }
  });

  if (duplicates.length > 0) {
    console.error('❌ DUPLICATE MEALS DETECTED:', duplicates.length);
  }

  return {
    mealOrders: mealsToday,
    lunchCount,
    dinnerCount,
    totalUsers,
    duplicates
  };
}

module.exports = {
  getTodayMeals
};
