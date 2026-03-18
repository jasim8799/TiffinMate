const MealOrder = require('../models/MealOrder');
const Subscription = require('../models/Subscription');
const { getActiveUserIds } = require('../utils/activeUserHelper');
const { getISTDayRange, getCutoffForDeliveryDate, isCutoffPassed, normaliseDeliveryDate } = require('../utils/dateService');
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
    // ── Cutoff guard ─────────────────────────────────────────────────────────
    // Default meals must NEVER be auto-assigned before the 8:30 PM IST cutoff.
    // The cron job (running at 8:35 PM) is the authoritative caller after
    // cutoff; this guard makes on-demand calls (triggered when a user opens
    // the app) a no-op while ordering is still open.
    const now = moment.tz('Asia/Kolkata');
    const cutoff = getCutoffForDeliveryDate(deliveryDate);
    if (now.isBefore(cutoff)) {
      logger.info('⏳ Before cutoff — skipping default meal assignment');
      return { createdCount: 0, skippedCount: 0 };
    }
    // ─────────────────────────────────────────────────────────────────────────

    const RestaurantStatus = require('../models/RestaurantStatus');

    const status = await RestaurantStatus.findOne();
    if (status && status.isOpen === false) {
      logger.info('⛔ Restaurant closed — skipping default meals');
      return;
    }

    const deliveryMoment = moment.tz(deliveryDate, 'Asia/Kolkata');
    const { start, end } = getISTDayRange(deliveryDate);
    logger.info(`\n🔧 [DEFAULT MEAL SERVICE] Ensuring defaults for ${deliveryMoment.format('YYYY-MM-DD')}`);

    // Get active users with active subscriptions
    const activeUserIds = await getActiveUserIds();

    const activeSubscriptions = await Subscription.find({
      user: { $in: activeUserIds },
      status: 'active',
      startDate: { $lte: deliveryDate },
      endDate: { $gte: deliveryDate },
      createdAt: { $lte: cutoff.toDate() }
    }).populate('user');

    logger.info(`   Active subscriptions: ${activeSubscriptions.length}`);

    let createdCount = 0;
    let skippedCount = 0;

    for (const subscription of activeSubscriptions) {
      // Check for lunch
      const { start, end } = getISTDayRange(deliveryDate);
      const hasLunch = await MealOrder.exists({
        user: subscription.user._id,
        mealType: 'lunch',
        deliveryDate: { $gte: start, $lte: end }
      });

      if (!hasLunch) {
        const dayOfWeek = deliveryMoment.day();
        const planType = subscription.planType || 'classic';
        const defaultLunchName = getDefaultMealForDay(dayOfWeek, planType, 'lunch');

        await MealOrder.findOneAndUpdate(
          {
            user: subscription.user._id,
            deliveryDate: normaliseDeliveryDate(deliveryDate),
            mealType: 'lunch'
          },
          {
            $setOnInsert: {
              subscription: subscription._id,
              orderDate: moment.tz('Asia/Kolkata').toDate(),
              selectedMeal: {
                name: defaultLunchName,
                items: [],
                isDefault: true
              },
              cutoffTime: getCutoffForDeliveryDate(deliveryDate),
              isAfterCutoff: true,
              status: 'confirmed',
              createdBy: 'auto-default'
            }
          },
          { upsert: true, new: false }
        );

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
        mealType: 'dinner',
        deliveryDate: { $gte: start, $lte: end }
      });

      if (!hasDinner) {
        const dayOfWeek = deliveryMoment.day();
        const planType = subscription.planType || 'classic';
        const defaultDinnerName = getDefaultMealForDay(dayOfWeek, planType, 'dinner');

        await MealOrder.findOneAndUpdate(
          {
            user: subscription.user._id,
            deliveryDate: normaliseDeliveryDate(deliveryDate),
            mealType: 'dinner'
          },
          {
            $setOnInsert: {
              subscription: subscription._id,
              orderDate: moment.tz('Asia/Kolkata').toDate(),
              selectedMeal: {
                name: defaultDinnerName,
                items: [],
                isDefault: true
              },
              cutoffTime: getCutoffForDeliveryDate(deliveryDate),
              isAfterCutoff: true,
              status: 'confirmed',
              createdBy: 'auto-default'
            }
          },
          { upsert: true, new: false }
        );

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
  ensureDefaultMealsForDate,
  getDefaultMealForDay,
};
