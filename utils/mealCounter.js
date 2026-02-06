const moment = require('moment');
const { getNextOrderableDeliveryMoment, getCutoffTimeForDate } = require('./deliveryDateHelper');

/**
 * ======================================================================
 * SINGLE SOURCE OF TRUTH - Meal Counting Logic
 * ======================================================================
 * This module defines THE ONLY canonical way to count meals.
 * Both Dashboard and Kitchen MUST use these functions.
 * NO other counting logic is allowed anywhere in the system.
 * ======================================================================
 */

/**
 * Get meals for the EFFECTIVE DELIVERY DATE
 * ✅ Uses getEffectiveDeliveryDate() to determine correct date
 * ✅ Before cutoff (11:00 PM) → TODAY
 * ✅ After cutoff (11:00 PM) → TOMORROW
 * 
 * @param {Array} activeUserIds - Array of active user IDs to include
 * @param {Object} MealOrder - Mongoose model
 * @returns {Promise<Object>} { mealOrders, lunchCount, dinnerCount, totalUsers }
 */
async function getTodayMeals(activeUserIds, MealOrder) {
  // ✅ USE NEXT ORDERABLE DELIVERY MOMENT (kitchen-centric)
  const effectiveDate = getNextOrderableDeliveryMoment();
  const start = effectiveDate.clone().startOf('day').toDate();
  const end = effectiveDate.clone().endOf('day').toDate();

  const now = moment.tz('Asia/Kolkata');
  const cutoffTime = getCutoffTimeForDate(effectiveDate.toDate());
  const isAfterCutoff = now.isAfter(cutoffTime);

  if (process.env.NODE_ENV !== 'production') {
    console.log('\n🔍 [mealCounter.js] getTodayMeals() called');
    console.log('📅 Date Boundaries:');
    console.log('   - Current Time:', now.format('YYYY-MM-DD HH:mm:ss'));
    console.log('   - After Cutoff?:', isAfterCutoff ? 'YES → Using TOMORROW' : 'NO → Using TODAY');
    console.log('   - Effective Date:', effectiveDate.format('YYYY-MM-DD (dddd)'));
    console.log('   - Start:', moment(start).format('YYYY-MM-DD HH:mm:ss'));
    console.log('   - End:', moment(end).format('YYYY-MM-DD HH:mm:ss'));
    console.log('👥 Active Users in Query:', activeUserIds.length);
  }

  // Query meals for EFFECTIVE delivery date
  const mealsToday = await MealOrder.find({
    deliveryDate: { $gte: start, $lte: end },
    user: { $in: activeUserIds }
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
        console.log(`   ${idx + 1}. User: ${order.user.name}`);
        console.log(`      - Created: ${moment(order.createdAt).format('YYYY-MM-DD HH:mm:ss')}`);
        console.log(`      - Delivery: ${moment(order.deliveryDate).format('YYYY-MM-DD HH:mm:ss')}`);
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
