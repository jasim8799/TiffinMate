const MealOrder = require('../models/MealOrder');
const RestaurantStatus = require('../models/RestaurantStatus');
const Subscription = require('../models/Subscription');
const { getActiveUserIds } = require('../utils/activeUserHelper');
const socketService = require('./socketService');
const moment = require('moment-timezone');
const logger = require('../utils/logger');

/**
 * ✅ CRITICAL: Auto-assign default meals ON-DEMAND
 * 
 * This function ensures default meals exist for users who haven't selected.
 * Called EVERY time an API queries meals after cutoff.
 * 
 * IDEMPOTENT: Safe to call multiple times, won't create duplicates.
 * 
 * @param {Date} deliveryDate - The delivery date to ensure defaults for
 */
async function ensureDefaultMealsForDate(deliveryDate) {
  try {
    const deliveryMoment = moment.tz(deliveryDate, 'Asia/Kolkata');
    logger.info(`\n🔧 [DEFAULT MEAL SERVICE] Ensuring defaults for ${deliveryMoment.format('YYYY-MM-DD')}`);

    // BEFORE assigning default meals: check restaurant status
    const status = await RestaurantStatus.findOne();
    if (!status?.isOpen) {
      logger.info('   🔥 Restaurant is closed - skipping auto-assign');
      return { createdCount: 0, skippedCount: 0 };
    }

    // Get active users with active subscriptions
    const activeUserIds = await getActiveUserIds();
    
    const activeSubscriptions = await Subscription.find({
      user: { $in: activeUserIds },
      status: 'active',
      startDate: { $lte: deliveryDate },
      endDate: { $gte: deliveryDate }
    }).populate('user');

    logger.info(`   Active subscriptions: ${activeSubscriptions.length}`);

    let createdCount = 0;
    let skippedCount = 0;

    for (const subscription of activeSubscriptions) {
      // Check for lunch
      const hasLunch = await MealOrder.exists({
        user: subscription.user._id,
        deliveryDate: deliveryDate,
        mealType: 'lunch'
      });

      if (!hasLunch) {
        const dayOfWeek = deliveryMoment.day();
        const planType = subscription.planType || 'classic';
        const defaultLunchName = getDefaultMealForDay(dayOfWeek, planType, 'lunch');

        await MealOrder.create({
          user: subscription.user._id,
          subscription: subscription._id,
          orderDate: moment.tz('Asia/Kolkata').toDate(),
          deliveryDate: deliveryDate,
          mealType: 'lunch',
          selectedMeal: {
            name: defaultLunchName,
            items: [],
            isDefault: true
          },
          cutoffTime: deliveryMoment.clone().subtract(1, 'day').hour(17).minute(30).toDate(),
          isAfterCutoff: true,
          status: 'confirmed',
          createdBy: 'auto-default'
        });

        createdCount++;
        logger.info(`   ✅ Created default lunch: ${subscription.user.name}`);

        // Emit socket event
        socketService.emitMealUpdated({
          user: subscription.user._id,
          deliveryDate: deliveryDate,
          mealType: 'lunch',
          selectedMeal: { name: defaultLunchName, isDefault: true },
          customerName: subscription.user.name,
          source: 'auto-default'
        });
      } else {
        skippedCount++;
      }

      // Check for dinner
      const hasDinner = await MealOrder.exists({
        user: subscription.user._id,
        deliveryDate: deliveryDate,
        mealType: 'dinner'
      });

      if (!hasDinner) {
        const dayOfWeek = deliveryMoment.day();
        const planType = subscription.planType || 'classic';
        const defaultDinnerName = getDefaultMealForDay(dayOfWeek, planType, 'dinner');

        await MealOrder.create({
          user: subscription.user._id,
          subscription: subscription._id,
          orderDate: moment.tz('Asia/Kolkata').toDate(),
          deliveryDate: deliveryDate,
          mealType: 'dinner',
          selectedMeal: {
            name: defaultDinnerName,
            items: [],
            isDefault: true
          },
          cutoffTime: deliveryMoment.clone().subtract(1, 'day').hour(17).minute(30).toDate(),
          isAfterCutoff: true,
          status: 'confirmed',
          createdBy: 'auto-default'
        });

        createdCount++;
        logger.info(`   ✅ Created default dinner: ${subscription.user.name}`);

        // Emit socket event
        socketService.emitMealUpdated({
          user: subscription.user._id,
          deliveryDate: deliveryDate,
          mealType: 'dinner',
          selectedMeal: { name: defaultDinnerName, isDefault: true },
          customerName: subscription.user.name,
          source: 'auto-default'
        });
      } else {
        skippedCount++;
      }
    }

    logger.info(`   📊 Summary: Created ${createdCount}, Skipped ${skippedCount}`);
    
    return { createdCount, skippedCount };
  } catch (error) {
    logger.error('❌ Error in ensureDefaultMealsForDate:', error);
    throw error;
  }
}

/**
 * Get default meal based on day of week and plan type
 */
function getDefaultMealForDay(dayOfWeek, planType, mealType) {
  const mealsByDay = {
    'classic': {
      lunch: [
        'SEASONAL VEG, DAL, RICE, ROTI & SALAD', // Sunday
        'PANEER MASALA, DAL, RICE, ROTI & SALAD', // Monday
        'MIX-VEG, DAL, RICE, ROTI & SALAD', // Tuesday
        'CHANA MASALA, DAL, RICE, ROTI & SALAD', // Wednesday
        'AALOO GOBI, DAL, RICE, ROTI & SALAD', // Thursday
        'PANEER BUTTER MASALA, DAL, RICE, ROTI & SALAD', // Friday
        'SPECIAL THALI, DAL, RICE, ROTI & SWEET' // Saturday
      ],
      dinner: [
        'SEASONAL VEG, DAL, ROTI & SALAD', // Sunday
        'PANEER MASALA, DAL, ROTI & SALAD', // Monday
        'MIX-VEG, DAL, ROTI & SALAD', // Tuesday
        'CHANA MASALA, DAL, ROTI & SALAD', // Wednesday
        'AALOO GOBI, DAL, ROTI & SALAD', // Thursday
        'PANEER BUTTER MASALA, DAL, ROTI & SALAD', // Friday
        'SPECIAL THALI, DAL, ROTI & SWEET' // Saturday
      ]
    },
    'premium-veg': {
      lunch: [
        'MIX-VEG, DAL, JEERA RICE, ROTI & SALAD', // Sunday
        'AALOO SOYABEEN, DAL, FRIED RICE, ROTI & KHEER', // Monday
        'PANEER MASALA, DAL, VEG PULAO, ROTI & RAITA', // Tuesday
        'KADAI PANEER, DAL, JEERA RICE, ROTI & PICKLE', // Wednesday
        'MIX-VEG, DAL, FRIED RICE, ROTI & PAPAD', // Thursday
        'PANEER BUTTER MASALA, DAL, VEG BIRYANI, ROTI & RAITA', // Friday
        'SPECIAL VEG THALI, DAL, RICE, ROTI & SWEET' // Saturday
      ],
      dinner: [
        'MIX-VEG, DAL, ROTI & SALAD', // Sunday
        'AALOO SOYABEEN, DAL, ROTI & RAITA', // Monday
        'PANEER MASALA, DAL, ROTI & PICKLE', // Tuesday
        'KADAI PANEER, DAL, ROTI & PAPAD', // Wednesday
        'MIX-VEG, DAL, ROTI & RAITA', // Thursday
        'PANEER BUTTER MASALA, DAL, ROTI & SALAD', // Friday
        'SPECIAL VEG THALI, DAL, ROTI & SWEET' // Saturday
      ]
    },
    'premium-non-veg': {
      lunch: [
        'CHICKEN CURRY, DAL, JEERA RICE, ROTI & SALAD', // Sunday
        'EGG CURRY, DAL, FRIED RICE, ROTI & RAITA', // Monday
        'CHICKEN MASALA, DAL, VEG PULAO, ROTI & PICKLE', // Tuesday
        'MUTTON CURRY, DAL, JEERA RICE, ROTI & RAITA', // Wednesday
        'CHICKEN BIRYANI, RAITA & SALAD', // Thursday
        'BUTTER CHICKEN, DAL, RICE, ROTI & PAPAD', // Friday
        'SPECIAL NON-VEG THALI, RICE, ROTI & SWEET' // Saturday
      ],
      dinner: [
        'CHICKEN CURRY, DAL, ROTI & SALAD', // Sunday
        'EGG CURRY, DAL, ROTI & RAITA', // Monday
        'CHICKEN MASALA, DAL, ROTI & PICKLE', // Tuesday
        'MUTTON CURRY, DAL, ROTI & RAITA', // Wednesday
        'CHICKEN CURRY, DAL, ROTI & SALAD', // Thursday
        'BUTTER CHICKEN, DAL, ROTI & PAPAD', // Friday
        'SPECIAL NON-VEG THALI, ROTI & SWEET' // Saturday
      ]
    }
  };

  const plan = mealsByDay[planType] || mealsByDay['classic'];
  const meals = plan[mealType] || plan['lunch'];
  return meals[dayOfWeek] || 'Dal Rice';
}

module.exports = {
  ensureDefaultMealsForDate
};
