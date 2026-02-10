const MealOrder = require('../models/MealOrder');
const MealSkip = require('../models/MealSkip');
const DefaultMeal = require('../models/DefaultMeal');
const WeeklyMenu = require('../models/WeeklyMenu');
const Subscription = require('../models/Subscription');
const AppNotification = require('../models/AppNotification');
const PremiumMenuItem = require('../models/PremiumMenuItem');
const Payment = require('../models/Payment');
const socketService = require('../services/socketService');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const { createNotification } = require('./notificationController');
const User = require('../models/User');
const { getActiveUserIds } = require('../utils/activeUserHelper');
const { getDeliveryDateByOffset, getNextOrderableDeliveryMoment, getCutoffTimeForDate, getISTDayRange } = require('../utils/deliveryDateHelper');
const { ensureDefaultMealsForDate } = require('../services/defaultMealService');

// =========================================================
// TIMEZONE HELPER - ALWAYS USE IST (Asia/Kolkata)
// =========================================================

// DRY FIX: Shared non-veg keywords constant
const NON_VEG_KEYWORDS = [
  'CHICKEN', 'EGG', 'MUTTON', 'FISH', 'KEEMA',
  'TANDOORI', 'BIRYANI', 'KORMA',
  'BUTTER CHICKEN', 'HYDRABADI', 'MURADABADI'
];

// LOGGING CLEANUP: Debug helper function
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

// Helper function to check if an item is non-veg
const isNonVegItem = (item) => {
  if (!item || typeof item !== 'string') return false;
  return NON_VEG_KEYWORDS.some(keyword => item.toUpperCase().includes(keyword));
};

// FIX 1: Helper function to validate veg/non-veg within a single meal
const validateVegNonVegSingleMeal = (meal) => {
  if (!meal || !meal.items || meal.items.length === 0) return;

  const hasVeg = meal.items.some(item => !isNonVegItem(item));
  const hasNonVeg = meal.items.some(item => isNonVegItem(item));

  if (hasVeg && hasNonVeg) {
    throw new Error('Veg and Non-Veg items cannot be selected together');
  }
};

// Shared validation functions (defined once at top level)
const validateBiryaniRule = (meal) => {
  if (!meal || !meal.items) return;
  const items = meal.items;
  const hasBiryani = items.some(item => item.toLowerCase().includes('biryani'));

  if (hasBiryani) {
    // Check for other food items (not add-ons)
    const allowedAddons = ['raita', 'salad', 'sweets'];
    const disallowedItems = items.filter(item =>
      !item.toLowerCase().includes('biryani') &&
      !allowedAddons.some(addon => item.toLowerCase().includes(addon))
    );

    if (disallowedItems.length > 0) { // Any disallowed items with biryani
      throw new Error('Biryani cannot be combined with other meals');
    }
  }
};

const validateAddons = (meal) => {
  if (!meal || !meal.items) return;
  const items = meal.items;
  const hasBiryani = items.some(item => item.toLowerCase().includes('biryani'));

  if (!hasBiryani) {
    // Check for add-on items without biryani
    const addons = ['raita', 'salad', 'sweets'];
    const hasAddons = items.some(item =>
      addons.some(addon => item.toLowerCase().includes(addon))
    );

    if (hasAddons) {
      throw new Error('Invalid add-on selection');
    }
  }
};

// Shared helper function for consistent validation across all endpoints
function validateAndProcessMeal({ meal, subscription }) {
  const dietaryPreference = subscription.mealPreferences?.dietaryPreference || 'both';

  const processed = processPremiumMealSelection(meal, dietaryPreference);

  validateVegNonVegSingleMeal(processed);
  validateBiryaniRule(processed);
  validateAddons(processed);

  return processed;
}

/**
 * Returns current time in IST timezone
 * @returns {moment.Moment} Current time in Asia/Kolkata timezone
 */
const nowIST = () => {
  return moment.tz('Asia/Kolkata');
};

/**
 * Convert any date/moment to IST timezone
 * @param {Date|string|moment.Moment} date - Date to convert
 * @returns {moment.Moment} Date in Asia/Kolkata timezone
 */
const toIST = (date) => {
  return moment.tz(date, 'Asia/Kolkata');
};







// =========================================================
// PREMIUM MEAL CATEGORY-BASED SELECTION SYSTEM
// =========================================================

// Available items by category for premium users
const PREMIUM_MEAL_CATEGORIES = {
  dal: {
    veg: ['DAL FRY', 'DAL MAKHANI', 'DAL TADKA', 'RAJMA DAL', 'CHANA DAL'],
    nonVeg: [] // No non-veg dal
  },
  rice: {
    veg: ['PLAIN RICE', 'JEERA RICE', 'FRIED RICE', 'SOYA RICE'],
    nonVeg: ['CHICKEN BIRYANI', 'EGG BIRYANI', 'HYDRABADI BIRYANI', 'MURADABADI BIRYANI']
  },
  bread: {
    veg: ['ROTI', 'PARATHA', 'LACHHA PARATHA', 'PLAIN PARATHA', 'SATTU PARATHA', 'PURI', 'NAAN'],
    nonVeg: [] // No non-veg bread
  },
  vegetable: {
    veg: [
      'MIX-VEG', 'SEASONAL VEG', 'AALOO SOYABEEN', 'AALOO BHUJIYA', 'AALOO GOBI',
      'KADAI PANEER', 'PANEER MASALA', 'PANEER TIKKA', 'PALAK PANEER',
      'MUTAR MUSHROOM', 'BESAN GATTA', 'AALOO DUM', 'CHHOLE MASALA', 'RAJMA'
    ],
    nonVeg: [
      'CHICKEN CURRY', 'CHICKEN MASALA', 'BUTTER CHICKEN', 'CHICKEN KORMA',
      'TANDOORI CHICKEN', 'EGG CURRY', 'EGG BHURJI', 'EGG AALOO DUM', 'KEEMA'
    ]
  },
  special: {
    veg: ['VEG BIRYANI', 'KHICHDI', 'AALOO CHOKHA'],
    nonVeg: [] // Non-veg biryani is in rice category
  },
  side: {
    veg: ['SALAD', 'RAITA', 'PICKLE', 'CHUTNEY', 'SWEETS', 'HALWA', 'KHEER'],
    nonVeg: [] // No non-veg sides
  }
};

// Auto-add compulsory items based on selection
const AUTO_ADD_RULES = {
  biryani: ['CHUTNEY'],
  khichdi: ['PICKLE', 'CHUTNEY'],
  paratha: ['PICKLE', 'CHUTNEY']
};

// Get available items for premium user based on dietary preference
const getPremiumCategoryItems = (dietaryPreference) => {
  const categories = {};
  
  for (const [category, items] of Object.entries(PREMIUM_MEAL_CATEGORIES)) {
    if (dietaryPreference === 'veg') {
      // Veg users: ONLY veg items
      categories[category] = items.veg || [];
    } else if (dietaryPreference === 'non-veg' || dietaryPreference === 'both') {
      // Non-veg users: veg + non-veg items
      categories[category] = [...(items.veg || []), ...(items.nonVeg || [])];
    }
  }
  
  return categories;
};

// Validate that selected items are allowed for user's dietary preference
const validatePremiumSelection = (selectedItems, dietaryPreference) => {
  const allowedItems = getPremiumCategoryItems(dietaryPreference);
  const allAllowedItems = Object.values(allowedItems).flat();
  
  for (const item of selectedItems) {
    if (!allAllowedItems.includes(item)) {
      return {
        valid: false,
        message: `Item "${item}" is not allowed for your dietary preference (${dietaryPreference})`
      };
    }
  }
  
  return { valid: true };
};

// Auto-add compulsory items based on selection
const autoAddCompulsoryItems = (selectedItems) => {
  const finalItems = [...selectedItems];
  const itemsLower = selectedItems.map(i => i.toLowerCase());
  
  // Check biryani
  if (itemsLower.some(i => i.includes('biryani'))) {
    if (!itemsLower.includes('chutney')) {
      finalItems.push('CHUTNEY');
    }
  }
  
  // Check khichdi
  if (itemsLower.some(i => i.includes('khichdi'))) {
    if (!itemsLower.includes('pickle')) {
      finalItems.push('PICKLE');
    }
    if (!itemsLower.includes('chutney')) {
      finalItems.push('CHUTNEY');
    }
  }
  
  // Check paratha
  if (itemsLower.some(i => i.includes('paratha'))) {
    if (!itemsLower.includes('pickle') && !itemsLower.includes('chutney')) {
      finalItems.push('CHUTNEY');
    }
  }
  
  return finalItems;
};

// Process premium meal selection
const processPremiumMealSelection = (meal, dietaryPreference) => {
  // Check if it's category-based selection (has items array)
  if (meal && Array.isArray(meal.items) && meal.items.length > 0) {
    // Validate items
    const validation = validatePremiumSelection(meal.items, dietaryPreference);
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    
    // Auto-add compulsory items
    const finalItems = autoAddCompulsoryItems(meal.items);
    
    // Create meal name from items
    const mealName = finalItems.join(', ');
    
    return {
      name: mealName,
      items: finalItems,
      isDefault: false
    };
  } else if (meal && meal.name) {
    // Traditional selection with name only
    return {
      name: meal.name,
      items: meal.items || [],
      isDefault: false
    };
  }
  
  return null;
};

// =========================================================
// HELPER: Ensure default meals exist (IDEMPOTENT)
// Uses findOneAndUpdate with upsert - safe to call multiple times
// NO DUPLICATES - guaranteed by unique index + upsert pattern
// =========================================================
const ensureDefaultMealsExist = async (deliveryDate, mealType = null) => {
  try {
    if (process.env.NODE_ENV !== 'production') {
      debugLog('🔧 [KITCHEN READINESS] Ensuring default meals exist (IDEMPOTENT)...');
      debugLog('   Delivery Date:', moment(deliveryDate).format('YYYY-MM-DD'));
      debugLog('   Meal Type:', mealType || 'BOTH (lunch + dinner)');
    }

    // ✅ CRITICAL FIX: Get all ACTIVE USERS with ACTIVE SUBSCRIPTIONS
    // Step 1: Get active user IDs (exclude deleted users)
    const activeUserIds = await getActiveUserIds();

    if (process.env.NODE_ENV !== 'production') {
      debugLog('   🔍 Active customer users:', activeUserIds.length);
    }

    // Step 2: Get subscriptions for active users only
    const activeSubscriptions = await Subscription.find({
      user: { $in: activeUserIds },
      status: 'active',
      startDate: { $lte: deliveryDate },
      endDate: { $gte: deliveryDate }
    }).populate('user');

    if (process.env.NODE_ENV !== 'production') {
      console.log('   📋 Active subscriptions:', activeSubscriptions.length);
    }

    // Determine which meal types to check
    const mealTypes = mealType ? [mealType] : ['lunch', 'dinner'];
    
    let createdCount = 0;
    let skippedCount = 0;

    // ========================================
    // IDEMPOTENT UPSERT PATTERN
    // ========================================
    // Uses findOneAndUpdate with upsert: true
    // If document exists: does nothing ($setOnInsert won't run)
    // If not exists: creates it
    // Thread-safe, no duplicates (protected by unique index)
    if (process.env.NODE_ENV !== 'production') {
      debugLog(`\n🔄 Processing ${activeSubscriptions.length} subscriptions × ${mealTypes.length} meal types...`);
    }

    for (const subscription of activeSubscriptions) {
      for (const type of mealTypes) {
        // ========================================
        // SKIP AUTO-ASSIGN DEFAULT MEALS (CRON)
        // ========================================
        // BUG 3 FIX: Include 'both' for backward compatibility with old data
        const { start: skipStart, end: skipEnd } = getISTDayRange(deliveryDate);
        const skipExists = await MealSkip.findOne({
          user: subscription.user._id,
          deliveryDate: { $gte: skipStart, $lte: skipEnd },
          mealType: { $in: [type, 'both'] }
        });

        if (skipExists) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`⏭️ Skipped default assignment for ${subscription.user.name} - ${type}`);
          }
          continue;
        }

        const defaultMeal = getDefaultMealForSubscription(subscription, deliveryDate, type);

        // ========================================
        // UNIFIED CUTOFF TIME (BOTH MEALS)
        // ========================================
        // ✅ Use helper function for consistency
        const cutoffTime = getCutoffTimeForDate(deliveryDate);

        // ========================================
        // CRITICAL: UPSERT (not create/insertMany)
        // ========================================
        // This ONLY inserts if document doesn't exist
        // Multiple calls = safe, no duplicates
        try {
          const result = await MealOrder.findOneAndUpdate(
            {
              user: subscription.user._id,
              deliveryDate: deliveryDate,
              mealType: type
            },
            {
              $setOnInsert: {
                subscription: subscription._id,
                orderSource: 'subscription', // ✅ FIX 1: Add orderSource for kitchen filtering
                orderDate: nowIST().toDate(),
                selectedMeal: {
                  name: defaultMeal,
                  items: [],
                  isDefault: true
                },
                cutoffTime: cutoffTime.toDate(),
                isAfterCutoff: false,
                status: 'confirmed',
                createdBy: 'system-kitchen'
              }
            },
            {
              upsert: true,
              new: false, // Return old doc to detect if created
              setDefaultsOnInsert: true
            }
          );
          
          // If result is null, document was created
          // If result exists, document already existed
          if (!result) {
            createdCount++;
            console.log(`   ✅ Created: ${subscription.user.name} - ${type} - ${defaultMeal}`);
          } else {
            skippedCount++;
            console.log(`   ℹ️  Exists: ${subscription.user.name} - ${type} (OK)`);
          }
        } catch (error) {
          // Duplicate key error from unique index - should never happen with upsert
          if (error.code === 11000) {
            skippedCount++;
            console.log(`   ⚠️  Duplicate prevented: ${subscription.user.name} - ${type}`);
          } else {
            console.error(`   ❌ Error: ${subscription.user.name} - ${type}:`, error.message);
            throw error;
          }
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      debugLog(`\n📊 Summary:`);
      debugLog(`   ✅ Created: ${createdCount} new meals`);
      debugLog(`   ℹ️  Skipped: ${skippedCount} existing meals`);
      debugLog(`   📈 Total: ${createdCount + skippedCount} meals ensured`);
      debugLog('   ✅ Kitchen readiness check complete (idempotent)');
    }
    
    // ========================================
    // VALIDATION: Ensure no duplicates
    // ========================================
    const totalMeals = await MealOrder.countDocuments({
      deliveryDate: deliveryDate,
      mealType: mealType ? { $in: [mealType] } : { $in: ['lunch', 'dinner'] }
    });
    const expectedMax = activeSubscriptions.length * mealTypes.length;
    
    console.log(`\n🔍 Duplicate Check:`);
    console.log(`   - Meals in DB: ${totalMeals}`);
    console.log(`   - Max Expected: ${expectedMax} (${activeSubscriptions.length} users × ${mealTypes.length} types)`);
    
    if (totalMeals > expectedMax) {
      console.error(`   ❌ CRITICAL: Duplicate meals detected! (${totalMeals} > ${expectedMax})`);
    } else {
      console.log(`   ✅ No duplicates detected`);
    }
    
    return createdCount;
  } catch (error) {
    console.error('❌ Error ensuring default meals:', error);
    throw error;
  }
};

// Helper function to get default meal based on subscription plan and day
const getDefaultMealForSubscription = (subscription, deliveryDate, mealType) => {
  const dayOfWeek = moment(deliveryDate).day();
  const planType = subscription.planType || 'classic';
  
  // ✅ VERIFICATION: Day-wise meal assignment
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  console.log(`📅 [MEAL ASSIGNMENT] Date: ${moment(deliveryDate).format('YYYY-MM-DD')}, Day: ${dayNames[dayOfWeek]}, Type: ${mealType}, Plan: ${planType}`);

  const mealsByDay = {
    'premium-veg': {
      lunch: [
        'MIX-VEG, DAL, JEERA RICE, ROTI & SALAD', // Sunday
        'AALOO SOYABEEN, DAL, FRIED RICE, ROTI & KHEER', // Monday
        'RAJMA, AALOO BHUJIYA, JEERA RICE, ROTI & RAITA', // Tuesday
        'MUTAR MUSHROOM, DAL, SOYA RICE, ROTI & SALAD', // Wednesday
        'VEGITABLE, DAL, RICE, ROTI & SALAD', // Thursday
        'PANEER MASALA, PLAIN PARATHA & HALWA', // Friday
        'KHICHDI, AALOO CHOKHA / PICKLE' // Saturday
      ],
      dinner: [
        'VEG BIRYANI, SALAD & RAITA', // Sunday
        'SEASONAL VEG, DAL, RICE, ROTI & SALAD', // Monday
        'KADAI PANEER, LACHHA PARATHA & SALAD', // Tuesday
        'DAL FRY, ROTI & KHEER', // Wednesday
        'MIX-VEG, DAL, FRIED RICE, ROTI & SALAD', // Thursday
        'BESAN GATTA, JEERA RICE, ROTI & SALAD', // Friday
        'CHHOLE MASALA, PURI & SWEETS' // Saturday
      ]
    },
    'premium-non-veg': {
      lunch: [
        'CHICKEN CURRY (BIHARI STYLE), JEERA RICE, ROTI & SALAD', // Sunday
        'EGG CURRY, FRIED RICE, ROTI & KHEER', // Monday
        'N/A', // Tuesday
        'CHICKEN MASALA, DAL, SOYA RICE, ROTI & SALAD', // Wednesday
        'EGG AALOO DUM, RICE, ROTI & SALAD', // Thursday
        'HYDRABADI BIRYANI, RAITA & HALWA', // Friday
        'KEEMA, DAL, RICE, ROTI & SALAD' // Saturday
      ],
      dinner: [
        'CHICKEN BIRYANI, RAITA & SALAD', // Sunday
        'TANDOORI CHICKEN, PARATHA (PLAIN) & HALWA', // Monday
        'N/A', // Tuesday
        'MURADABADI BIRYANI, CHUTNEY & KHEER', // Wednesday
        'CHICKEN KORMA, LACHHA PARATHA & SALAD', // Thursday
        'EGG BHURJI, DAL, JEERA RICE, ROTI & SALAD', // Friday
        'BUTTER CHICKEN, SATTU PARATHA, SWEETS' // Saturday
      ]
    },
    'classic': {
      lunch: [
        'MIX-VEG, DAL, RICE & SALAD', // Sunday
        'AALOO SOYABEEN, RICE & SALAD', // Monday
        'RAJMA, RICE & RAITA', // Tuesday
        'CHICKEN CURRY, RICE & SALAD', // Wednesday
        'VEGITABLE, RICE & SALAD', // Thursday
        'CHHOLE MASALA, RICE & SALAD', // Friday
        'KHICHDI, AALOO CHOKHA / PICKLE' // Saturday
      ],
      dinner: [
        'CHICKEN BIRYANI, SALAD & RAITA', // Sunday
        'SEASONAL VEG, ROTI & SALAD', // Monday
        'KADAI PANEER, ROTI & HALWA', // Tuesday
        'DAL FRY, ROTI & SALAD', // Wednesday
        'MIX-VEG, ROTI & SALAD', // Thursday
        'EGG CURRY, ROTI & SALAD', // Friday
        'CHHOLE MASALA, PURI & SWEETS' // Saturday
      ]
    }
  };

  // Default to classic if plan type not found
  const plan = mealsByDay[planType] || mealsByDay['classic'];
  const meals = plan[mealType] || plan['lunch'];
  const selectedMeal = meals[dayOfWeek] || 'Dal Rice';
  
  console.log(`✅ [MEAL SELECTED] ${selectedMeal}`);
  
  return selectedMeal;
};

// @desc    Select meal for specific date
// @route   POST /api/meals/select
// @access  Private (Customer)
exports.selectMeal = async (req, res) => {
  try {
    // ========== USE SUBSCRIPTION FROM MIDDLEWARE ==========
    const subscription = req.subscription; // Already validated by requireActiveSubscription middleware

    // Check grace period validity (additional check beyond middleware)
    if (subscription.status === 'grace' && subscription.graceUntil) {
      const today = nowIST().startOf('day');
      const graceUntil = toIST(subscription.graceUntil).startOf('day');
      if (today.isAfter(graceUntil)) {
        return res.status(403).json({
          success: false,
          message: 'Subscription expired'
        });
      }
    }

    const { lunch, dinner, instructions } = req.body;

    // Reduced verbose logging for production
    debugLog(`📥 Meal selection for user ${req.user._id} (kitchen-centric)`);

    // ========================================
    // KITCHEN-CENTRIC DELIVERY DATE LOGIC
    // ========================================
    // Backend is single source of truth - always use getNextOrderableDeliveryMoment()
    // Do NOT trust frontend date - backend decides the only open slot
    const deliveryMoment = getNextOrderableDeliveryMoment();
    const deliveryDate = deliveryMoment.toDate();

    if (process.env.NODE_ENV !== 'production') {
      console.log(`🍽️ MEAL_SELECT: Using kitchen-centric delivery date: ${deliveryMoment.format('YYYY-MM-DD')}`);
      console.log(`   - Backend determined open slot (no frontend override)`);
    }

    // Validate that at least one meal is selected
    if (!lunch && !dinner) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('⚠️ No meals selected - both lunch and dinner are null/undefined');
    }
      return res.status(400).json({
        success: false,
        message: 'Please select at least one meal (lunch or dinner)'
      });
    }

    // ========================================
    // STRUCTURED LOGGING: Meal Selection
    // ========================================
    const mealTypes = [];
    if (lunch) mealTypes.push('lunch');
    if (dinner) mealTypes.push('dinner');

    if (process.env.NODE_ENV !== 'production') {
      console.log(`🍽️ MEAL_SELECT: userId=${req.user._id}, deliveryDate=${deliveryMoment.format('YYYY-MM-DD')}, mealType=${mealTypes.join(',')}`);
    }

    // ========================================
    // STEP 6.1: NORMALIZE INPUTS (CONTROLLER GUARD)
    // ========================================

    // Validate lunch items (max 4)
    if (lunch && lunch.items) {
      if (!Array.isArray(lunch.items) || lunch.items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please select meal items for lunch'
        });
      }

      if (lunch.items.length > 4) {
        return res.status(400).json({
          success: false,
          code: 'MAX_ITEMS_EXCEEDED',
          message: 'You can select a maximum of 4 items per meal'
        });
      }
    }

    // Validate dinner items (max 4)
    if (dinner && dinner.items) {
      if (!Array.isArray(dinner.items) || dinner.items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please select meal items for dinner'
        });
      }

      if (dinner.items.length > 4) {
        return res.status(400).json({
          success: false,
          code: 'MAX_ITEMS_EXCEEDED',
          message: 'You can select a maximum of 4 items per meal'
        });
      }
    }

    // ========================================
    // STEP 6.2: DIET ENFORCEMENT (CRITICAL)
    // ========================================
    const userDiet = req.subscription?.mealPreferences?.dietaryPreference || 'both';

    if (userDiet !== 'both') {
      // Validate lunch items against diet
      if (lunch && lunch.items) {
        const invalidLunchItem = lunch.items.find(item => {
          const isNonVeg = NON_VEG_KEYWORDS.some(keyword => item.toUpperCase().includes(keyword));
          return userDiet === 'veg' ? isNonVeg : !isNonVeg;
        });

        if (invalidLunchItem) {
          return res.status(400).json({
            success: false,
            code: 'DIET_VIOLATION',
            message: `Your subscription allows only ${userDiet} items. "${invalidLunchItem}" is not allowed.`
          });
        }
      }

      // Validate dinner items against diet
      if (dinner && dinner.items) {
        const invalidDinnerItem = dinner.items.find(item => {
          const isNonVeg = NON_VEG_KEYWORDS.some(keyword => item.toUpperCase().includes(keyword));
          return userDiet === 'veg' ? isNonVeg : !isNonVeg;
        });

        if (invalidDinnerItem) {
          return res.status(400).json({
            success: false,
            code: 'DIET_VIOLATION',
            message: `Your subscription allows only ${userDiet} items. "${invalidDinnerItem}" is not allowed.`
          });
        }
      }
    }

    // ========================================
    // 1️⃣ DELIVERY DATE VALIDATION (BEFORE CUTOFF LOGIC)
    // ========================================
    const todayIST = nowIST().startOf('day');
    const maxFutureDate = todayIST.clone().add(7, 'days');

    if (deliveryMoment.isBefore(todayIST) || deliveryMoment.isAfter(maxFutureDate)) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`❌ [MEAL SELECTION BLOCKED - INVALID DATE]`);
      console.log(`   Requested: ${deliveryMoment.format('YYYY-MM-DD')}`);
      console.log(`   Today: ${todayIST.format('YYYY-MM-DD')}`);
      console.log(`   Max Future: ${maxFutureDate.format('YYYY-MM-DD')}`);
    }
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery date'
      });
    }

    // ========================================
    // 2️⃣ USE SUBSCRIPTION FROM MIDDLEWARE (NO DUPLICATE QUERY)
    // ========================================
    const middlewareSubscription = req.subscription; // Already validated by requireActiveSubscription middleware

    const dietaryPreference = middlewareSubscription?.mealPreferences?.dietaryPreference || 'both';
    const planType = middlewareSubscription?.planType || 'classic';
    const planCategory = middlewareSubscription?.planCategory || 'classic';
    const isPremium = planCategory === 'premium';

    // ISSUE 1 FIX: Declare variables once at the top
    let processedLunch = null;
    let processedDinner = null;



    // ========================================
    // 4️⃣ CHECK FOR EXISTING MEAL ORDERS - REJECT IF EXISTS
    // ========================================
    // Check for existing lunch order - reject if exists (unless skipped)
    const { start, end } = getISTDayRange(deliveryDate);
    if (lunch) {
      const existingLunch = await MealOrder.findOne({
        user: req.user._id,
        deliveryDate: { $gte: start, $lte: end },
        mealType: 'lunch'
      });
      if (existingLunch && existingLunch.status !== 'skipped') {
        return res.status(409).json({
          success: false,
          message: 'Lunch meal already selected for this date'
        });
      }
    }

    // Check for existing dinner order - reject if exists (unless skipped)
    if (dinner) {
      const existingDinner = await MealOrder.findOne({
        user: req.user._id,
        deliveryDate: { $gte: start, $lte: end },
        mealType: 'dinner'
      });
      if (existingDinner && existingDinner.status !== 'skipped') {
        return res.status(409).json({
          success: false,
          message: 'Dinner meal already selected for this date'
        });
      }
    }

    // ========================================
    // 4️⃣ VEG / NON-VEG MUTUAL EXCLUSION & VALIDATION (PREMIUM ONLY)
    // ========================================
    if (isPremium) {
      processedLunch = lunch
        ? validateAndProcessMeal({ meal: lunch, subscription: middlewareSubscription })
        : null;

      processedDinner = dinner
        ? validateAndProcessMeal({ meal: dinner, subscription: middlewareSubscription })
        : null;
    }

    // ========================================
    // 7️⃣ INSTRUCTION BOX
    // ========================================
    if (instructions && instructions.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Instruction too long'
      });
    }

    // ========== CLASSIC USER MEAL SELECTION ==========
    // Premium users already processed above, now handle classic users
    if (!isPremium) {
      // Classic users: traditional meal selection
      processedLunch = lunch ? {
        name: typeof lunch === 'string' ? lunch : lunch.name,
        items: lunch.items || [],
        isDefault: false
      } : null;

      processedDinner = dinner ? {
        name: typeof dinner === 'string' ? dinner : dinner.name,
        items: dinner.items || [],
        isDefault: false
      } : null;
    }

    // Helper function to check if meal contains non-veg items (for classic users)
    const isNonVeg = (meal) => {
      if (!meal) return false;
      // Handle both string and object formats
      const mealName = typeof meal === 'string' ? meal : (meal.name || '');
      const upperMeal = mealName.toUpperCase();
      return NON_VEG_KEYWORDS.some(keyword => upperMeal.includes(keyword));
    };

    // Validate dietary preference for classic users only
    // Premium users are already validated in processPremiumMealSelection
    if (!isPremium) {
      // Validate lunch selection based on dietary preference
      if (lunch) {
        const lunchIsNonVeg = isNonVeg(lunch);
        
        if (dietaryPreference === 'veg' && lunchIsNonVeg) {
          return res.status(400).json({
            success: false,
            message: 'You have a VEG-only subscription. Cannot select non-veg meals.'
          });
        }
        
        if (dietaryPreference === 'non-veg' && !lunchIsNonVeg) {
          return res.status(400).json({
            success: false,
            message: 'You have a NON-VEG only subscription. Cannot select veg meals.'
          });
        }
      }

      // Validate dinner selection based on dietary preference
      if (dinner) {
        const dinnerIsNonVeg = isNonVeg(dinner);
        
        if (dietaryPreference === 'veg' && dinnerIsNonVeg) {
          return res.status(400).json({
            success: false,
            message: 'You have a VEG-only subscription. Cannot select non-veg meals.'
          });
        }
        
        if (dietaryPreference === 'non-veg' && !dinnerIsNonVeg) {
          return res.status(400).json({
            success: false,
            message: 'You have a NON-VEG only subscription. Cannot select veg meals.'
          });
        }
      }


    }

    // ✅ LOGGING HYGIENE: Use debugLog helper for debug output
    debugLog('📅 Date handling (IST):');
    debugLog('   Parsed moment (IST):', deliveryMoment.toISOString());
    debugLog('   Formatted:', deliveryMoment.format('YYYY-MM-DD'));
    debugLog('   As Date object:', deliveryMoment.toDate());
    debugLog('   Timezone:', deliveryMoment.tz());

    // ========================================
    // UNIFIED CUTOFF TIME (MANDATORY FOR SCHEMA)
    // ========================================
    const cutoffTime = getCutoffTimeForDate(deliveryMoment.toDate());

    // ========================================
    // MONGO DB TRANSACTION: Atomic meal selection
    // ========================================
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Handle lunch selection
      if (processedLunch) {
        await MealOrder.findOneAndUpdate(
          {
            user: req.user._id,
            deliveryDate: deliveryMoment.toDate(),
            mealType: 'lunch'
          },
          {
            subscription: subscription._id,
            orderSource: 'subscription', // ✅ FIX 1: Add orderSource for kitchen filtering
            orderDate: nowIST().toDate(),
            selectedMeal: processedLunch,
            cutoffTime: cutoffTime.toDate(), // ✅ Unified cutoff
            isAfterCutoff: false,
            status: 'confirmed'
          },
          { upsert: true, new: true, session }
        );
        console.log('✅ Lunch order upserted');
      }

      // Handle dinner selection
      if (processedDinner) {
        await MealOrder.findOneAndUpdate(
          {
            user: req.user._id,
            deliveryDate: deliveryMoment.toDate(),
            mealType: 'dinner'
          },
          {
            subscription: subscription._id,
            orderSource: 'subscription', // ✅ FIX 1: Add orderSource for kitchen filtering
            orderDate: nowIST().toDate(),
            selectedMeal: processedDinner,
            cutoffTime: cutoffTime.toDate(), // ✅ Unified cutoff
            isAfterCutoff: false,
            status: 'confirmed'
          },
          { upsert: true, new: true, session }
        );
        console.log('✅ Dinner order upserted');
      }

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      // ✅ Clear skip record if user re-selected
      if (processedLunch) {
        await MealSkip.deleteMany({
          user: req.user._id,
          deliveryDate: { $gte: start, $lte: end },
          mealType: 'lunch'
        });
      }
      if (processedDinner) {
        await MealSkip.deleteMany({
          user: req.user._id,
          deliveryDate: { $gte: start, $lte: end },
          mealType: 'dinner'
        });
      }
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }

    // Create notification for owner
    const userDoc = await User.findById(req.user._id);
    const mealNames = [];
    if (processedLunch) mealNames.push(`Lunch: ${processedLunch.name}`);
    if (processedDinner) mealNames.push(`Dinner: ${processedDinner.name}`);
    
    await createNotification(
      'MEAL_ORDERED',
      `${userDoc?.name || 'Customer'} ordered meals for ${deliveryMoment.format('DD MMM')} - ${mealNames.join(', ')}`,
      null,
      null,
      {
        customerName: userDoc?.name,
        customerId: userDoc?.userId,
        deliveryDate: deliveryMoment.format('YYYY-MM-DD'),
        meals: mealNames
      }
    );

    // Create AppNotification for owner
    try {
      const mealDesc = [];
      if (processedLunch) mealDesc.push(`L: ${processedLunch.name}`);
      if (processedDinner) mealDesc.push(`D: ${processedDinner.name}`);
      
      await AppNotification.createNotification({
        type: 'meal_selected',
        title: 'New Meal Order',
        message: `${userDoc?.name} selected meals for ${deliveryMoment.format('MMM DD')} - ${mealDesc.join(', ')}`,
        relatedUser: req.user._id,
        relatedModel: 'Meal',
        priority: 'medium',
        metadata: {
          deliveryDate: deliveryMoment.format('YYYY-MM-DD'),
          hasLunch: !!processedLunch,
          hasDinner: !!processedDinner,
          lunchName: processedLunch?.name,
          dinnerName: processedDinner?.name
        }
      });

      // Emit notification event
      socketService.emitNotification({
        type: 'meal_selected',
        title: 'New Meal Order',
        message: `${userDoc?.name} ordered for ${deliveryMoment.format('MMM DD')}`,
        priority: 'medium'
      });
    } catch (notifError) {
      console.error('Failed to create meal notification:', notifError);
    }

    // Emit real-time meal selection event to owner (subscription meals only)
    socketService.emitMealSelected({
      user: req.user._id,
      deliveryDate: deliveryMoment.toDate(),
      lunch: processedLunch,
      dinner: processedDinner,
      customerName: userDoc?.name,
      customerId: userDoc?.userId,
      source: 'subscription'
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`✅ Meal saved for user ${req.user._id} on ${deliveryMoment.format('YYYY-MM-DD')}:`);
      console.log(`   Lunch: ${processedLunch?.name || 'Not selected'} (saved to DB)`);
      console.log(`   Dinner: ${processedDinner?.name || 'Not selected'} (saved to DB)`);
    }

    // Verify meals were saved by querying DB
    // ✅ HARDENING FIX 1: Use getISTDayRange for date range consistency (reuse start/end from line 733)
    const verifyMeals = await MealOrder.find({
      user: req.user._id,
      deliveryDate: { $gte: start, $lte: end }
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log(`   DB Verification: Found ${verifyMeals.length} meal orders in DB for this date`);
      verifyMeals.forEach(m => {
        console.log(`   - ${m.mealType}: ${m.selectedMeal?.name}, status: ${m.status}, subscription: ${m.subscription}`);
      });
    }

    res.status(200).json({
      success: true,
      message: 'Meal selection saved successfully'
    });
  } catch (error) {
    console.error('❌ Select meal error:', error);
    console.error('   Error name:', error.name);
    console.error('   Error message:', error.message);
    console.error('   Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      message: error.message || 'Error selecting meal',
      errorDetails: error.name
    });
  }
};
// @route   POST /api/meals/select
// @desc    Select meal for specific date



// @desc    Select daily meal (non-subscription users)
// @route   POST /api/meals/daily/select
// @access  Private (Customer)
exports.selectDailyMeal = async (req, res) => {
  try {
    const { mealType, lunch, dinner } = req.body;
    const user = req.user;

    // ISSUE 5 FIX: Reject mealType 'both' for daily meals
    if (mealType === 'both') {
      return res.status(400).json({
        success: false,
        message: 'Invalid mealType for daily meals'
      });
    }

    // 1️⃣ Delivery date (daily pay-per-day logic) - unified with subscription offset system
    const deliveryMoment = getDeliveryDateByOffset(0);
    const deliveryDate = deliveryMoment.toDate();

    // 2.5️⃣ ENFORCE CUTOFF AT POST LEVEL (MANDATORY SECURITY)
    const cutoffTime = getCutoffTimeForDate(deliveryDate);
    if (nowIST().isAfter(cutoffTime)) {
      return res.status(403).json({
        success: false,
        message: 'Meal selection closed (cutoff passed)'
      });
    }

    // 3️⃣ Validate meal selections (reuse existing validation)
    const mockSubscription = { mealPreferences: { dietaryPreference: 'both' } };

    // Validate lunch and dinner separately
    const processedLunch = lunch ? validateAndProcessMeal({
      meal: lunch,
      subscription: mockSubscription
    }) : null;

    const processedDinner = dinner ? validateAndProcessMeal({
      meal: dinner,
      subscription: mockSubscription
    }) : null;

    // ISSUE 3 FIX: Ensure at least lunch or dinner is selected
    if (!processedLunch && !processedDinner) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least lunch or dinner'
      });
    }

    // 4️⃣ Check for existing pending payment (prevent duplicates)
    const { start, end } = getISTDayRange(deliveryDate);
    const existingPendingPayment = await Payment.findOne({
      user: user._id,
      paymentFor: 'daily_meal',
      status: 'pending',
      deliveryDate: { $gte: start, $lte: end }
    });

    if (existingPendingPayment) {
      return res.status(409).json({
        success: false,
        message: 'You already have a pending daily meal payment for this date'
      });
    }

    // 4.1️⃣ Check for existing paid/verified payment (prevent reselection)
    const existingCompletedPayment = await Payment.findOne({
      user: user._id,
      paymentFor: 'daily_meal',
      status: { $in: ['paid', 'verified'] },
      deliveryDate: { $gte: start, $lte: end }
    });

    if (existingCompletedPayment) {
      return res.status(409).json({
        success: false,
        message: 'Payment already completed for this date. Meals are confirmed.'
      });
    }

    // 4.2️⃣ Check for existing confirmed meal order (edge case protection)
    const alreadyPaidOrder = await MealOrder.findOne({
      user: user._id,
      orderSource: 'daily',
      deliveryDate: { $gte: start, $lte: end }
    });

    if (alreadyPaidOrder) {
      return res.status(409).json({
        success: false,
        message: 'Daily meal already confirmed for this date'
      });
    }

    // 5️⃣ Price calculation - derive from presence of meals (from SystemSetting)
    const SystemSetting = require('../models/SystemSetting');
    const bothPrice = await SystemSetting.getValue('daily_price_both', 150);
    const singlePrice = await SystemSetting.getValue('daily_price_single', 80);

    let totalPrice = 0;
    if (processedLunch && processedDinner) totalPrice = bothPrice;
    else totalPrice = singlePrice;

    const perMealPrice = processedLunch && processedDinner ? bothPrice / 2 : singlePrice;

    // 6️⃣ Create Payment FIRST (with metadata) - IDEMPOTENT
    const paymentMoment = moment(deliveryDate).tz('Asia/Kolkata');

    let payment;
    if (existingPendingPayment) {
      console.log('✅ Using existing pending payment:', existingPendingPayment._id);
      payment = existingPendingPayment;
    } else {
      payment = await Payment.create({
        user: user._id,
        amount: totalPrice,
        paymentFor: 'daily_meal',
        deliveryDate: deliveryDate,
        status: 'pending',
        metadata: {
          lunch: processedLunch,
          dinner: processedDinner,
          pricePerMeal: perMealPrice
        },
        // ✅ REQUIRED FOR SCHEMA
        year: paymentMoment.year(),
        month: paymentMoment.month() + 1 // month() is 0-based
      });
      console.log('✅ Created new payment with metadata:', payment._id);
    }

    return res.status(201).json({
      success: true,
      message: 'Meal selection saved. Proceed to payment.',
      data: {
        payment
      }
    });

  } catch (error) {
    console.error('Select daily meal error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Unable to process daily meal'
    });
  }
};

// @desc    Get daily meal selection (NO subscription required)
// @route   GET /api/meals/daily/my-selection?offset=0|-1
// @access  Private (Customer)
// @deprecated Use /api/meals/my-selection instead - this endpoint is redundant
exports.getMyDailyMealSelection = (req, res) => {
  // DEPRECATED: Delegate to unified endpoint to prevent logic drift
  return exports.getMyMealSelection(req, res);
};



// @desc    Skip meal for specific date
// @route   POST /api/meals/skip
// @access  Private (Customer)
exports.skipMeal = async (req, res) => {
  try {
    const { deliveryDate, mealType, reason } = req.body;
    const userId = req.user._id;

    // ==============================
    // 1. VALIDATION
    // ==============================
    if (!deliveryDate || typeof deliveryDate !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'deliveryDate is required (YYYY-MM-DD)',
      });
    }

    if (!['lunch', 'dinner', 'both'].includes(mealType)) {
      return res.status(400).json({
        success: false,
        message: 'mealType must be lunch, dinner, or both',
      });
    }

    const parsedDate = toIST(deliveryDate).startOf('day');

    if (!parsedDate.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deliveryDate format',
      });
    }

    // ❗ Block past dates (important)
    const today = nowIST().startOf('day');
    if (parsedDate.isBefore(today)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot skip past meals',
      });
    }

    // ==============================
    // 2. ACTIVE SUBSCRIPTION
    // ==============================
    const subscription = await Subscription.findOne({
      user: userId,
      status: 'active',
    });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'Active subscription required to skip meals',
      });
    }

    // ==============================
    // 3. IDEMPOTENT CHECK (IST RANGE SAFE)
    // ==============================
    const { start, end } = getISTDayRange(parsedDate.toDate());

    const existingSkip = await MealSkip.findOne({
      user: userId,
      deliveryDate: { $gte: start, $lte: end },
      mealType: { $in: [mealType, 'both'] },
    });

    if (existingSkip) {
      return res.json({
        success: true,
        message: 'Meal already skipped',
        data: existingSkip,
      });
    }

    // ==============================
    // 4. CREATE SKIP RECORD
    // ==============================
    const skipRecord = await MealSkip.create({
      user: userId,
      subscription: subscription._id,
      deliveryDate: parsedDate.toDate(),
      mealType,
      reason: reason || 'User skipped meal',
    });

    // ==============================
    // ✅ SYNC MealOrder WITH SKIP STATE
    // ==============================
    const mealTypes = mealType === 'both' ? ['lunch', 'dinner'] : [mealType];

    // Delete any existing MealOrder so default won't exist
    await MealOrder.deleteMany({
      user: userId,
      deliveryDate: { $gte: start, $lte: end },
      mealType: { $in: mealTypes }
    });

    // ==============================
    // 5. EXTEND SUBSCRIPTION
    // ==============================
    subscription.endDate = moment(subscription.endDate)
      .add(1, 'day')
      .toDate();

    subscription.totalDays += 1;
    subscription.remainingDays += 1;

    await subscription.save();

    // ==============================
    // 6. SUCCESS
    // ==============================
    return res.json({
      success: true,
      message: 'Meal skipped successfully',
      data: skipRecord,
    });
  } catch (error) {
    console.error('Skip meal error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to skip meal',
    });
  }
};

// ================================================================
// HELPER FUNCTION: validateMealSelection (used by planMeals)
// ================================================================
// Helper function to validate meal selection (extracted for reuse)
const validateMealSelection = async (req) => {
  const { deliveryDate, lunch, dinner, instructions } = req.body;

  // ✅ CRITICAL FIX: Add max item count validation
  if (lunch?.items?.length > 4 || dinner?.items?.length > 4) {
    throw new Error('You can select a maximum of 4 items per meal');
  }

  // 1. Active subscription check - prefer middleware subscription to avoid re-querying
  const subscription =
    req.subscription ||
    await Subscription.findOne({
      user: req.user._id,
      status: 'active',
      isPaused: { $ne: true },
      startDate: { $lte: deliveryDate },
      endDate: { $gte: deliveryDate }
    });

  if (!subscription) {
    throw new Error('Subscription is not active');
  }

  // 2. Check if meal is already skipped (future-proofing)
  const { start: skipStart, end: skipEnd } = getISTDayRange(toIST(deliveryDate).toDate());
  const skipExists = await MealSkip.findOne({
    user: req.user._id,
    deliveryDate: { $gte: skipStart, $lte: skipEnd },
    mealType: lunch ? 'lunch' : 'dinner'
  });

  if (skipExists) {
    throw new Error('Meal is skipped for this date');
  }

  // 2. KITCHEN-CENTRIC: Delivery date must be the next orderable delivery date
  const deliveryMoment = toIST(deliveryDate).startOf('day');
  const allowedMoment = getNextOrderableDeliveryMoment();

  if (!deliveryMoment.isSame(allowedMoment, 'day')) {
    throw new Error('You can only plan meals for the next delivery day');
  }

  // 3. Single meal per time slot
  const existingMeals = await MealOrder.find({
    user: req.user._id,
    deliveryDate: deliveryMoment.toDate()
  });

  const existingLunch = existingMeals.find(m => m.mealType === 'lunch');
  if (lunch && existingLunch && !existingLunch.selectedMeal.isDefault) {
    throw new Error('Meal already selected for this time slot');
  }

  const existingDinner = existingMeals.find(m => m.mealType === 'dinner');
  if (dinner && existingDinner && !existingDinner.selectedMeal.isDefault) {
    throw new Error('Meal already selected for this time slot');
  }

  const isPremium = subscription.planCategory === 'premium';

  // NOTE: Classic dietary preference is enforced only in /select.
  // Bulk planning relies on frontend consistency by design.

  // FIX 4: Use shared validateAndProcessMeal function for consistency
  if (isPremium) {
    if (lunch) {
      const processedLunch = validateAndProcessMeal({ meal: lunch, subscription });
      // Note: validateAndProcessMeal throws errors if validation fails
    }
    if (dinner) {
      const processedDinner = validateAndProcessMeal({ meal: dinner, subscription });
      // Note: validateAndProcessMeal throws errors if validation fails
    }
  }

  // 7. Instructions validation
  if (instructions && instructions.length > 200) {
    throw new Error('Instruction too long');
  }
};

// @desc    Plan meals for multiple dates (bulk planning)
// @route   POST /api/meals/plan
// @access  Private (Customer)
exports.planMeals = async (req, res) => {
  const { startDate, endDate, mealType, selection, instructions } = req.body;

    console.log('📥 Received bulk meal planning request:');
    console.log('   User:', req.user._id);
    console.log('   Start Date:', startDate);
    console.log('   End Date:', endDate);
    console.log('   Meal Type:', mealType);
    console.log('   Selection:', JSON.stringify(selection));
    console.log('   Instructions:', instructions);

    if (!startDate || !endDate || !mealType || !selection) {
      return res.status(400).json({
        success: false,
        message: 'Please provide startDate, endDate, mealType, and selection'
      });
    }

    // Validate meal type
    if (!['lunch', 'dinner'].includes(mealType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid meal type. Must be lunch or dinner'
      });
    }

    // Validate instructions length
    if (instructions && instructions.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Instruction too long'
      });
    }

    // KITCHEN-CENTRIC: Users can ONLY plan for the next orderable delivery date
    const allowedMoment = getNextOrderableDeliveryMoment();
    const startMoment = toIST(startDate).startOf('day');
    const endMoment = toIST(endDate).startOf('day');

    // Check if the planning range is EXACTLY the next orderable delivery date
    if (
      !startMoment.isSame(allowedMoment, 'day') ||
      !endMoment.isSame(allowedMoment, 'day')
    ) {
      return res.status(400).json({
        success: false,
        message: 'You can only plan meals for the next delivery day'
      });
    }

    if (endMoment.isBefore(startMoment)) {
      return res.status(400).json({
        success: false,
        message: 'End date must be after start date'
      });
    }

    // ========================================
    // VALIDATE ALL DATES FIRST (ATOMIC BEHAVIOR)
    // ========================================
    const validationErrors = [];
    const validDates = [];

    let currentDate = startMoment.clone();
    while (currentDate.isSameOrBefore(endMoment)) {
      const dateStr = currentDate.format('YYYY-MM-DD');

      try {
        // ✅ CRITICAL FIX: Check cutoff per date in bulk planning
        const cutoffTime = getCutoffTimeForDate(currentDate.toDate());
        if (nowIST().isAfter(cutoffTime)) {
          throw new Error(`Cutoff passed for ${dateStr}. Cannot plan meals after 11:00 PM on the previous day.`);
        }

        // BUG 2 FIX: Check if meal is already skipped for this date (include 'both' for backward compatibility)
        const { start: skipStart, end: skipEnd } = getISTDayRange(currentDate.toDate());
        const skipExists = await MealSkip.findOne({
          user: req.user._id,
          deliveryDate: { $gte: skipStart, $lte: skipEnd },
          mealType: { $in: [mealType, 'both'] }
        });

        if (skipExists) {
          throw new Error(`Meal is skipped for ${dateStr}`);
        }

        // Create mock request for validation
        const mockReq = {
          user: req.user,
          body: {
            deliveryDate: dateStr,
            [mealType]: selection,
            instructions: instructions
          }
        };

        // Validate single meal selection rules
        await validateMealSelection(mockReq);
        validDates.push(currentDate.clone());
      } catch (error) {
        validationErrors.push({
          date: dateStr,
          error: error.message
        });
      }

      currentDate.add(1, 'day');
    }

    // If any date fails validation, rollback (no partial inserts)
    if (validationErrors.length > 0) {
      console.log('❌ Bulk planning failed - validation errors:', validationErrors);
      return res.status(400).json({
        success: false,
        message: 'Bulk planning failed due to validation errors',
        errors: validationErrors
      });
    }

    // ========================================
    // PROCESS VALID DATES (ALL OR NOTHING) - ATOMIC WITH TRANSACTIONS
    // ========================================
    const mongoose = require('mongoose');
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const createdOrders = [];
      const subscription = await Subscription.findOne({
        user: req.user._id,
        status: 'active',
        isPaused: { $ne: true }
      }).session(session);

      if (!subscription) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Subscription is not active'
        });
      }

      for (const dateMoment of validDates) {
        const cutoffTime = getCutoffTimeForDate(dateMoment.toDate());

        const processedMeal = subscription.planCategory === 'premium'
          ? validateAndProcessMeal({ meal: selection, subscription })
          : {
              name: typeof selection === 'string' ? selection : selection.name,
              items: selection.items || [],
              isDefault: false
            };

        const order = await MealOrder.create([{
          user: req.user._id,
          subscription: subscription._id,
          orderDate: nowIST().toDate(),
          deliveryDate: dateMoment.toDate(),
          mealType: mealType,
          selectedMeal: processedMeal,
          instructions: instructions || undefined,
          cutoffTime: cutoffTime.toDate(),
          isAfterCutoff: false,
          status: 'confirmed'
        }], { session });

        createdOrders.push(order[0]);
      }

      // If all orders created successfully, commit the transaction
      await session.commitTransaction();
      session.endSession();

      console.log(`✅ Bulk planning completed: ${createdOrders.length} orders created atomically`);

      res.status(200).json({
        success: true,
        message: `Successfully planned ${createdOrders.length} meals`,
        data: {
          ordersCreated: createdOrders.length,
          dates: validDates.map(d => d.format('YYYY-MM-DD')),
          mealType: mealType
        }
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('❌ Plan meals error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error planning meals',
        errorDetails: error.name
      });
    }
};

// Helper function to validate meal selection (extracted for reuse)


// @desc    Get meal selection for delivery date (with offset support for time-based tabs)
// @route   GET /api/meals/my-selection?offset=0
// @access  Private (Customer)
exports.getMyMealSelection = async (req, res) => {
  try {
    const user = req.user;

    // Support offset parameter for time-based tab rollover
    // offset=0 (default): next orderable delivery date (Tomorrow tab - editable)
    // offset=-1: actual current date (Today tab - read-only, previous delivery date)
    const offset = parseInt(req.query.offset) || 0;

    // Check if user has active subscription
    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: 'active'
    }).sort({ createdAt: -1 });

    const hasActiveSubscription = !!subscription;

    if (!hasActiveSubscription) {
      // Daily user: handle TODAY and TOMORROW tabs differently
      // ✅ USE SINGLE SOURCE OF TRUTH FOR OFFSET MAPPING
      let deliveryMoment = getDeliveryDateByOffset(offset);
      let lunchMeal = null;
      let dinnerMeal = null;

      if (offset === -1 || offset === 0) {
        // TODAY tab (-1) → fetch strictly past meals (< tomorrow)
        // TOMORROW tab (0) → fetch meals for deliveryDate after owner confirms
        const { start, end } = getISTDayRange(deliveryMoment.toDate());
        
        let mealsForDate = await MealOrder.find({
          user: req.user._id,
          orderSource: 'daily',
          status: 'confirmed',
          deliveryDate: { $gte: start, $lte: end }
        });

        // For TODAY tab: extra safety filter to ensure NO future meals
        if (offset === -1) {
          mealsForDate = mealsForDate.filter(m =>
            moment(m.deliveryDate).isBefore(getDeliveryDateByOffset(0))
          );
        }

        // Extract lunch and dinner from the fetched meals
        mealsForDate.forEach(meal => {
          if (meal.mealType === 'lunch') {
            lunchMeal = meal.selectedMeal;
          } else if (meal.mealType === 'dinner') {
            dinnerMeal = meal.selectedMeal;
          }
        });
      }

      const deliveryDate = deliveryMoment.toDate();
      const cutoffTime = getCutoffTimeForDate(deliveryDate);
      const now = nowIST();
      // TODAY tab is always read-only and locked; TOMORROW tab respects cutoff
      const isLocked = offset === -1 ? true : (offset === 0 && now.isAfter(cutoffTime));

      // ✅ POLISH FIX 1: GET never blocks - check payment state but don't throw 409
      const { start: paymentStart, end: paymentEnd } = getISTDayRange(deliveryDate);
      
      // Check for pending payment (embed in response, don't block)
      const pendingPayment = await Payment.findOne({
        user: user._id,
        paymentFor: 'daily_meal',
        status: 'pending',
        deliveryDate: { $gte: paymentStart, $lte: paymentEnd }
      });

      // Check for paid/verified payment (embed in response, don't block)
      const completedPayment = await Payment.findOne({
        user: user._id,
        paymentFor: 'daily_meal',
        status: { $in: ['paid', 'verified'] },
        deliveryDate: { $gte: paymentStart, $lte: paymentEnd }
      });

      const hasPendingPayment = !!pendingPayment;
      const hasCompletedPayment = !!completedPayment;

      return res.status(200).json({
        success: true,
        data: {
          orderSource: 'daily',
          subscriptionStatus: null,
          nextDeliveryDate: deliveryDate.toISOString().split('T')[0],
          cutoffTime: cutoffTime.format('HH:mm'),
          isAfterCutoff: isLocked,
          lunchLocked: isLocked,
          dinnerLocked: isLocked,
          hasPendingPayment,  // ✅ Embedded in response instead of blocking
          hasCompletedPayment,  // ✅ Tells frontend if meals are confirmed
          lunch: lunchMeal,
          dinner: dinnerMeal,
          isReadOnly: offset === -1,
          serverTime: now.toISOString(),
          serverTimeFormatted: now.format('YYYY-MM-DD HH:mm:ss') + ' IST'
        }
      });
    }

    let deliveryMoment;
    // ✅ USE SINGLE SOURCE OF TRUTH FOR OFFSET MAPPING
    // offset = -1 → today
    // offset = 0  → tomorrow
    deliveryMoment = getDeliveryDateByOffset(offset);

    const deliveryDate = deliveryMoment.toDate();

    // ✅ ENSURE DEFAULT MEALS EXIST (auto-create if after cutoff) - ONLY FOR NEXT DELIVERY (offset=0)
    let cutoffTime = getCutoffTimeForDate(deliveryMoment.toDate());
    let now = nowIST();
    let autoDefaultsCreated = false;
    if (offset === 0 && now.isAfter(cutoffTime)) {
      // NOTE:
      // Default meals are auto-created during GET after cutoff.
      // This is intentional for kitchen readiness.
      // ⚠️ This endpoint must remain private.
      // Future improvement: move default creation to cron.
      if (process.env.NODE_ENV !== 'production') {
        console.log('🔧 [AUTO-DEFAULT] Cutoff passed, ensuring default meals exist...');
      }
      const createdCount = await ensureDefaultMealsForDate(deliveryMoment.toDate());
      autoDefaultsCreated = createdCount > 0;
    }

    // Find meal orders for this date
    // ✅ USE DATE RANGE QUERY instead of equality to handle timezone edge cases
    // This fixes the bug where meals saved yesterday don't appear after midnight IST
    const { start, end } = getISTDayRange(deliveryDate);

    let mealOrders = await MealOrder.find({
      user: req.user._id,
      deliveryDate: {
        $gte: start,
        $lte: end
      }
    });

    // ========================================
    // FETCH SKIPPED MEALS (CRITICAL FIX)
    // ========================================
    const skipRecords = await MealSkip.find({
      user: req.user._id,
      deliveryDate: { $gte: start, $lte: end }
    });

    let lunchSkipped = false;
    let dinnerSkipped = false;

    skipRecords.forEach(skip => {
      if (skip.mealType === 'lunch') lunchSkipped = true;
      if (skip.mealType === 'dinner') dinnerSkipped = true;
      if (skip.mealType === 'both') {
        lunchSkipped = true;
        dinnerSkipped = true;
      }
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('🔍 Fetching meals (IST):');
      console.log('   Kitchen-determined deliveryDate:', deliveryDate);
      console.log('   Parsed moment (IST):', deliveryMoment.toISOString());
      console.log('   Timezone:', deliveryMoment.tz());
      console.log('   Query Date object:', deliveryMoment.toDate());

      // Also check all meal orders for this user (for debugging)
      const allUserMeals = await MealOrder.find({ user: req.user._id }).sort({ deliveryDate: -1 }).limit(10);
      console.log(`   Total meal orders for user: ${allUserMeals.length} (showing last 10)`);
      allUserMeals.forEach((order, i) => {
        console.log(`   [ALL ${i}] ${order.mealType} on ${order.deliveryDate} - ${order.selectedMeal?.name}`);
      });

      console.log(`   Found ${mealOrders.length} meal orders for ${deliveryDate}`);
      mealOrders.forEach((order, i) => {
        console.log(`   [${i}] Type: ${order.mealType}, Meal: ${order.selectedMeal?.name}, Date: ${order.deliveryDate}`);
      });
    }

    // ========================================
    // UNIFIED CUTOFF TIME (BOTH MEALS)
    // ========================================
    // Both lunch AND dinner lock at 11:00 PM of PREVIOUS DAY
    // Re-calculate for logging purposes
    cutoffTime = getCutoffTimeForDate(deliveryDate);
    now = nowIST();

    // ========================================
    // 📋 UNIFIED CUTOFF LOGGING
    // ========================================
    // ✅ HARDENING FIX 3: Guard verbose logs with NODE_ENV check
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n========================================');
      console.log('🔍 UNIFIED CUTOFF & LOCK VERIFICATION');
      console.log('========================================');
      console.log('📅 Delivery Date:', deliveryMoment.format('YYYY-MM-DD (dddd)'));
      console.log('🕐 Server Time (IST):', now.format('YYYY-MM-DD HH:mm:ss z'));
      console.log('');
      console.log('⏰ UNIFIED CUTOFF TIME (BOTH MEALS):');
      console.log('   Cutoff:  ', cutoffTime.format('YYYY-MM-DD HH:mm:ss z'));
      console.log('            (11:00 PM previous day)');
      console.log('');
      console.log('🔒 LOCK CALCULATION:');
      console.log('   now.isAfter(cutoffTime): ', now.isAfter(cutoffTime));
      console.log('   Applies to: BOTH lunch AND dinner');
      console.log('');
      console.log('📊 COMPARISON:');
      console.log('   Current:      ', now.format('YYYY-MM-DD HH:mm:ss'));
      console.log('   Cutoff:       ', cutoffTime.format('YYYY-MM-DD HH:mm:ss'));
      console.log('');
      console.log('🕒 TIMEZONE VERIFICATION:');
      console.log('   nowIST() timezone:        ', now.tz());
      console.log('   cutoffTime timezone:      ', cutoffTime.tz());
      console.log('   All should be: Asia/Kolkata');
      console.log('========================================\n');
    }

    // Get selected meals and check if default
    let lunchMeal = null;
    let dinnerMeal = null;
    let lunchIsDefault = false;
    let dinnerIsDefault = false;

    mealOrders.forEach(order => {
      if (order.mealType === 'lunch') {
        lunchMeal = order.selectedMeal;
        lunchIsDefault = order.selectedMeal?.isDefault || false;
      } else if (order.mealType === 'dinner') {
        dinnerMeal = order.selectedMeal;
        dinnerIsDefault = order.selectedMeal?.isDefault || false;
      }
    });

    // ========================================
    // GUARANTEE DEFAULT MEAL CONSISTENCY (BACKEND SAFETY FIX)
    // ========================================
    // Default flags must only apply to real meals
    // Prevent misleading UI by ensuring default flags are false when no meal exists
    if (!lunchMeal) lunchIsDefault = false;
    if (!dinnerMeal) dinnerIsDefault = false;

    // ========================================
    // UNIFIED LOCK STATUS (SAME FOR BOTH)
    // ========================================
    const isLocked = now.isAfter(cutoffTime);
    const lunchLocked = isLocked || lunchSkipped;
    const dinnerLocked = isLocked || dinnerSkipped;

    // ========================================
    // SELECTION COMPLETED FLAG
    // ========================================
    const hasLunchOrder = !!lunchMeal || lunchSkipped;
    const hasDinnerOrder = !!dinnerMeal || dinnerSkipped;
    const selectionCompleted = hasLunchOrder && hasDinnerOrder;

    if (process.env.NODE_ENV !== 'production') {
      console.log('🔒 FINAL LOCK STATUS:');
      console.log(`   Unified Lock: ${isLocked}`);
      console.log(`   lunchLocked = ${lunchLocked}`);
      console.log(`   dinnerLocked = ${dinnerLocked}`);
      console.log(`   selectionCompleted = ${selectionCompleted}`);
    }

    // Get default meals
    const defaultMeals = await DefaultMeal.find({ isActive: true });

    // Get user's dietary preference
    // ✅ IMPROVEMENT 1: Reuse first subscription query (remove duplicate DB call)
    const activeSubscription = subscription;

    const dietaryPreference = activeSubscription?.mealPreferences?.dietaryPreference || 'both';
    const subscriptionPlanType = activeSubscription?.planType || 'classic';

    if (process.env.NODE_ENV !== 'production') {
      console.log(`📊 Fetching meal for user ${req.user._id} on ${deliveryMoment.format('YYYY-MM-DD')}:`);
      console.log(`   Lunch: ${lunchMeal?.name || 'Not selected'}`);
      console.log(`   Dinner: ${dinnerMeal?.name || 'Not selected'}`);
      console.log(`   Subscription Plan: ${subscriptionPlanType}`);
    }

    // If no meals exist, return subscription shell (never return data: null)
    if (!lunchMeal && !dinnerMeal) {
      return res.status(200).json({
        success: true,
        data: {
          orderSource: 'subscription',
          subscriptionStatus: activeSubscription.status,
          nextDeliveryDate: deliveryDate.toISOString().split('T')[0],
          cutoffTime: cutoffTime.format('HH:mm'),
          isAfterCutoff: isLocked,
          lunchLocked: isLocked || lunchSkipped,
          dinnerLocked: isLocked || dinnerSkipped,
          lunch: null,
          dinner: null,
          lunchIsDefault: false,
          dinnerIsDefault: false,
          lunchSkipped: lunchSkipped,
          dinnerSkipped: dinnerSkipped
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        orderSource: 'subscription',
        subscriptionStatus: activeSubscription.status,
        nextDeliveryDate: deliveryDate.toISOString().split('T')[0],

        lunch: lunchMeal,
        dinner: dinnerMeal,

        lunchLocked,
        dinnerLocked,

        lunchIsDefault,
        dinnerIsDefault,

        lunchSkipped,
        dinnerSkipped,

        selectionCompleted,

        cutoffTime: cutoffTime.toISOString(),
        serverTime: now.toISOString(),
        serverTimeFormatted: now.format('YYYY-MM-DD HH:mm:ss') + ' IST',

        autoDefaultsCreated,
        defaultMeals,
        dietaryPreference,
        subscriptionPlanType
      }
    });
  } catch (error) {
    console.error('Get meal selection error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching meal selection',
      error: error.message
    });
  }
};

// @desc    Get default meals
// @route   GET /api/meals/defaults
// @access  Private
exports.getDefaultMeals = async (req, res) => {
  try {
    const defaultMeals = await DefaultMeal.find({ isActive: true });

    res.status(200).json({
      success: true,
      data: defaultMeals
    });
  } catch (error) {
    console.error('Get default meals error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching default meals',
      error: error.message
    });
  }
};

// @desc    Set/update default meal
// @route   POST /api/meals/defaults
// @access  Private (Owner only)
exports.setDefaultMeal = async (req, res) => {
  try {
    const { mealType, name, items } = req.body;

    if (!mealType || !name || !items) {
      return res.status(400).json({
        success: false,
        message: 'Please provide meal type, name, and items'
      });
    }

    let defaultMeal = await DefaultMeal.findOne({ mealType });

    if (defaultMeal) {
      // Update existing
      defaultMeal.name = name;
      defaultMeal.items = items;
      defaultMeal.updatedBy = req.user._id;
      await defaultMeal.save();
    } else {
      // Create new
      defaultMeal = await DefaultMeal.create({
        mealType,
        name,
        items,
        updatedBy: req.user._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Default meal set successfully',
      data: defaultMeal
    });
  } catch (error) {
    console.error('Set default meal error:', error);
    res.status(500).json({
      success: false,
      message: 'Error setting default meal',
      error: error.message
    });
  }
};

// @desc    Get all meal orders (admin)
// @route   GET /api/meals/orders
// @access  Private (Owner only)
exports.getAllMealOrders = async (req, res) => {
  try {
    const { date, deliveryDate } = req.query;
    
    // Default to today if no date provided
    const targetDate = date || deliveryDate;
    const targetMoment = targetDate 
      ? toIST(targetDate).startOf('day')
      : nowIST().startOf('day');
    
    // ✅ CONSISTENCY FIX: Use getISTDayRange for date range
    const { start, end } = getISTDayRange(targetMoment.toDate());
    
    // Get active users only
    const activeUserIds = await User.find({ 
      role: 'customer', 
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    const filter = {
      deliveryDate: { $gte: start, $lte: end },
      user: { $in: activeUserIds }
    };

    const mealOrders = await MealOrder.find(filter)
      .populate('user', 'name mobile userId')
      .sort({ mealType: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: mealOrders.length,
      data: mealOrders
    });
  } catch (error) {
    console.error('Get all meal orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching meal orders',
      error: error.message
    });
  }
};

// @desc    Get weekly menu based on user's subscription plan
// @route   GET /api/meals/weekly-menu
// @access  Private
exports.getWeeklyMenu = async (req, res) => {
  try {
    // Get user's active subscription to determine plan category
    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: 'active'
    }).sort({ createdAt: -1 });

    let allowedCategories = ['classic']; // Default to classic
    let dietaryPreference = 'both'; // Default to both

    if (subscription) {
      if (subscription.planCategory === 'trial') {
        allowedCategories = ['classic']; // Trial users get classic menu
      } else if (subscription.planCategory === 'premium') {
        // Premium users can see their specific menu
        allowedCategories = [subscription.planType]; // 'premium-veg' or 'premium-non-veg'
      } else if (subscription.planCategory === 'classic') {
        allowedCategories = ['classic'];
      }
      
      // Get dietary preference
      dietaryPreference = subscription.mealPreferences?.dietaryPreference || 'both';
    }

    // Fetch menu for allowed categories
    const weeklyMenu = await WeeklyMenu.find({
      planCategory: { $in: allowedCategories },
      isActive: true
    }).sort({ dayOfWeek: 1, mealType: 1 });

    // Filter menu items based on dietary preference
    const filterMenuItems = (items) => {
      if (!items || items.length === 0) return items;

      if (dietaryPreference === 'veg') {
        // Remove items with non-veg keywords
        return items.filter(item => {
          const upperItem = item.toUpperCase();
          return !NON_VEG_KEYWORDS.some(keyword => upperItem.includes(keyword));
        });
      } else if (dietaryPreference === 'non-veg') {
        // Keep only items with non-veg keywords
        return items.filter(item => {
          const upperItem = item.toUpperCase();
          return NON_VEG_KEYWORDS.some(keyword => upperItem.includes(keyword));
        });
      }
      // 'both' - return all items
      return items;
    };

    // Organize by day of week
    const menuByDay = {
      sunday: { lunch: null, dinner: null },
      monday: { lunch: null, dinner: null },
      tuesday: { lunch: null, dinner: null },
      wednesday: { lunch: null, dinner: null },
      thursday: { lunch: null, dinner: null },
      friday: { lunch: null, dinner: null },
      saturday: { lunch: null, dinner: null }
    };

    weeklyMenu.forEach(menu => {
      if (menuByDay[menu.dayOfWeek]) {
        const filteredItems = filterMenuItems(menu.items);
        
        // Only include meal if there are items after filtering
        if (filteredItems && filteredItems.length > 0) {
          menuByDay[menu.dayOfWeek][menu.mealType] = {
            items: filteredItems,
            description: menu.description,
            planCategory: menu.planCategory
          };
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        menu: menuByDay,
        userPlan: subscription ? {
          planType: subscription.planType,
          planCategory: subscription.planCategory,
          dietaryPreference: dietaryPreference
        } : null,
        allowedCategories,
        dietaryPreference
      }
    });
  } catch (error) {
    console.error('Get weekly menu error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching weekly menu',
      error: error.message
    });
  }
};

// @desc    Get premium category items for custom selection
// @route   GET /api/meals/premium-categories
// @access  Private (Premium users only)
exports.getPremiumCategories = async (req, res) => {
  try {
    // Get user's active subscription
    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: 'active'
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    const planType = subscription.planType;
    const isPremium = planType === 'premium-veg' || planType === 'premium-non-veg';

    if (!isPremium) {
      return res.status(403).json({
        success: false,
        message: 'Premium category selection is only available for premium users'
      });
    }

    const dietaryPreference = subscription.mealPreferences?.dietaryPreference || 'both';
    
    // Get available items based on dietary preference
    const categories = getPremiumCategoryItems(dietaryPreference);

    res.status(200).json({
      success: true,
      data: {
        categories,
        dietaryPreference,
        planType,
        autoAddRules: AUTO_ADD_RULES,
        instructions: {
          message: 'Select items from each category to build your custom meal',
          rules: [
            'Veg premium users can only select veg items',
            'Non-veg premium users can select both veg and non-veg items',
            'Compulsory items (chutney, pickle) will be auto-added based on your selection',
            'Items are categorized by: Dal, Rice, Bread, Vegetable, Special, Side'
          ]
        }
      }
    });
  } catch (error) {
    console.error('Get premium categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching premium categories',
      error: error.message
    });
  }
};

// @desc    Get aggregated meal orders for owner (Kitchen view)
// @route   GET /api/meals/owner/aggregated
// @access  Private (Owner only)
exports.getAggregatedMealOrders = async (req, res) => {
  try {
    const { date } = req.query;

    // ======================================================================
    // ✅ KITCHEN-CENTRIC: DEFAULT TO NEXT ORDERABLE, ALLOW OWNER OVERRIDE
    // ======================================================================
    // Default = kitchen-centric (next orderable delivery moment)
    // Override = owner-centric (specific date if provided)
    let targetDate = date
      ? toIST(date).startOf('day')
      : getNextOrderableDeliveryMoment();

    if (process.env.NODE_ENV !== 'production') {
      console.log('🍽️ [KITCHEN] Using delivery date:', targetDate.format('YYYY-MM-DD'), date ? '(owner override)' : '(kitchen default)');
    }

    // ✅ ENSURE DEFAULT MEALS EXIST (auto-create if after cutoff)
    const cutoff = getCutoffTimeForDate(targetDate);
    if (nowIST().isAfter(cutoff)) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('🔧 [KITCHEN AUTO-DEFAULT] Ensuring default meals exist for:', targetDate.format('YYYY-MM-DD'));
      }
      await ensureDefaultMealsForDate(targetDate.toDate());
    }
    
    const { start: deliveryDateStart, end: deliveryDateEnd } = getISTDayRange(targetDate.toDate());

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n==============================================');
      console.log('🔍 [VERIFICATION] KITCHEN QUERY');
      console.log('==============================================');
      console.log('📊 Query Name: getAggregatedMealOrders');
      console.log('📅 Selected Date:', targetDate.format('YYYY-MM-DD (dddd)'));
      console.log('📅 Date Boundaries:');
      console.log('   - Start:', toIST(deliveryDateStart).format('YYYY-MM-DD HH:mm:ss z'));
      console.log('   - End:', toIST(deliveryDateEnd).format('YYYY-MM-DD HH:mm:ss z'));
      console.log('   - Server Time NOW:', nowIST().format('YYYY-MM-DD HH:mm:ss z'));
      console.log('   - Server Timezone:', nowIST().format('Z'));
      console.log('🔍 Field Used in Query: deliveryDate');
      console.log('📝 What Kitchen Shows:');
      console.log('   - Meals with deliveryDate = Selected Date');
      console.log('   - Can view ANY date (not just today)');
      console.log('==============================================');
    }

    // =========================================================
    // KITCHEN VIEW: READ-ONLY - No meal creation during fetch
    // =========================================================
    // We only show existing meals, no auto-creation in kitchen view
    console.log('   ℹ️  Kitchen view may auto-create DEFAULT meals after cutoff (subscription only)');
    console.log('');

    // ✅ CRITICAL: Get ONLY active users (exclude deleted/deactivated)
    // This ensures deleted users are NEVER counted in kitchen view
    const activeUserIds = await getActiveUserIds();

    console.log('👥 [ACTIVE USERS FILTER]');
    console.log(`   - Total Active Users: ${activeUserIds.length}`);
    console.log('   - Criteria: role=customer, isActive=true, deletedAt does not exist');
    console.log('   - ✅ Deleted users will be EXCLUDED from counts');
    console.log('');

    // ======================================================================
    // ✅ FETCH MEALS FOR SELECTED DATE ONLY
    // ======================================================================
    console.log('🍽️ [KITCHEN] Getting meals for selected date...');

    // Fetch paid daily meals safely using payment join
    const mealOrders = await MealOrder.find({
      deliveryDate: {
        $gte: deliveryDateStart,
        $lte: deliveryDateEnd
      },
      user: { $in: activeUserIds },
      $or: [
        { orderSource: 'subscription' },
        { orderSource: 'daily' }
      ]
    })
    .populate({
      path: 'paymentId',
      match: { status: 'paid' }
    })
    .populate('user', 'userId name mobile address')
    .lean();

    // Filter out daily meals that don't have paid payments and skipped meals
    const filteredOrders = mealOrders.filter(order =>
      (order.orderSource === 'subscription' || order.paymentId) &&
      order.status !== 'skipped'
    );

    // If no meal orders found, return success with empty data
    if (filteredOrders.length === 0) {
      console.log('\n⚠️ NO MEALS FOUND FOR SELECTED DATE');
      console.log('   Returning success with empty counts and arrays');

      return res.status(200).json({
        success: true,
        data: {
          date: deliveryDateStart,
          totalOrders: 0,
          lunchSummary: [],
          dinnerSummary: [],
          totalLunch: 0,
          totalDinner: 0,
          customerDetails: [],
          orderSummary: {
            Lunch: 0,
            Dinner: 0,
            Total: 0
          },
          ingredientSummary: {},
          userMealDetails: []
        }
      });
    }

    // Count lunch and dinner
    let lunchCount = 0;
    let dinnerCount = 0;

    filteredOrders.forEach(order => {
      if (order.mealType === 'lunch') lunchCount++;
      if (order.mealType === 'dinner') dinnerCount++;
    });

    const totalUsers = filteredOrders.length;

    console.log('\n📊 Kitchen Query Results:');
    console.log(`   - Total Orders: ${totalUsers}`);
    console.log(`   - Lunch: ${lunchCount}`);
    console.log(`   - Dinner: ${dinnerCount}`);

    // ✅ VERIFICATION: Compare counts
    console.log('\n🔍 [VERIFICATION CHECKPOINT]');
    console.log('==============================================');
    console.log(`   Active Users (DB count):        ${activeUserIds.length}`);
    console.log(`   Meal Orders Found (DB count):   ${totalUsers}`);
    console.log(`   Expected: Meal Orders ≤ Active Users × 2 (lunch + dinner)`);
    console.log(`   Max Possible: ${activeUserIds.length * 2} meals (if all users have both)`);

    if (totalUsers > activeUserIds.length * 2) {
      console.error('   ❌ ERROR: More meals than possible!');
      console.error('   ❌ Check for duplicates or inactive user meals');
    } else {
      console.log('   ✅ Count validation PASSED');
    }
    console.log('==============================================');

    // ========================================
    // UNIFIED CUTOFF TIME STATUS (11:00 PM)
    // ========================================
    const now = nowIST();
    const unifiedCutoff = getCutoffTimeForDate(targetDate.toDate());

    console.log('\n⏰ Unified Cutoff Time Status:');
    console.log(`   - Current Time: ${now.format('HH:mm:ss')}`);
    console.log(`   - Unified Cutoff (11:00 PM previous day): ${now.isAfter(unifiedCutoff) ? 'PASSED ❌' : 'Not Passed ✅'}`);
    console.log('\n💡 Cutoff Impact:');
    console.log('   - If cutoff PASSED → new orders go to TOMORROW');
    console.log('   - If cutoff NOT PASSED → new orders go to TODAY');
    console.log('   - Kitchen shows meals for SELECTED date only');

    if (filteredOrders.length > 0) {
      console.log('\n📝 Sample Meal Orders (first 3):');
      filteredOrders.slice(0, 3).forEach((order, idx) => {
        console.log(`   ${idx + 1}. User: ${order.user.name}`);
        console.log(`      - Created: ${moment(order.createdAt).format('YYYY-MM-DD HH:mm:ss')}`);
        console.log(`      - Delivery: ${moment(order.deliveryDate).format('YYYY-MM-DD HH:mm:ss')}`);
        console.log(`      - Type: ${order.mealType}`);
      });
    }
    console.log(`      - Total: ${totalUsers}`);

    const total = totalUsers;

    // Debug: Show first few meal orders
    if (filteredOrders.length > 0) {
      console.log('   ✅ Sample meal orders:');
      filteredOrders.slice(0, 5).forEach((order, i) => {
        const isDefaultFlag = order.selectedMeal?.isDefault ? '🔵 DEFAULT' : '🟢 USER-SELECTED';
        console.log(`   [${i}] ${isDefaultFlag} | ${order.user?.name} - ${order.mealType}: ${order.selectedMeal?.name}`);
      });
    }

    // Aggregate meal counts for Kitchen display
    const lunchCounts = {};
    const dinnerCounts = {};
    const customerDetails = [];
    const ingredientCounts = {};
    const userMealDetails = []; // ✅ NEW: User-wise meal details for kitchen table

    filteredOrders.forEach(order => {
      const mealName = order.selectedMeal?.name || 'Not Selected';
      const mealType = order.mealType;
      const isDefaultMeal = order.selectedMeal?.isDefault || false;
      
      // Add to customer details (existing)
      customerDetails.push({
        customerId: order.user.userId,
        customerName: order.user.name,
        mobile: order.user.mobile,
        address: order.user.address,
        mealType: mealType,
        meal: mealName,
        isDefault: isDefaultMeal,
        orderId: order._id
      });

      // ✅ NEW: Extract ingredients from menu items
      let ingredients = [];
      if (mealName && mealName !== 'Not Selected') {
        // Split menu by comma and extract ingredients
        const items = mealName.split(',').map(item => item.trim()).filter(item => item);
        ingredients = items;
      }

      // ✅ NEW: Add user-wise meal detail for kitchen table
      userMealDetails.push({
        userName: order.user.name || 'Unknown User',
        userId: order.user.userId,
        mealType: mealType.charAt(0).toUpperCase() + mealType.slice(1), // Capitalize
        menu: mealName,
        ingredients: ingredients,
        source: isDefaultMeal ? 'DEFAULT' : 'USER',
        orderId: order._id
      });

      // Aggregate counts by meal name
      if (mealType === 'lunch') {
        lunchCounts[mealName] = (lunchCounts[mealName] || 0) + 1;
      } else if (mealType === 'dinner') {
        dinnerCounts[mealName] = (dinnerCounts[mealName] || 0) + 1;
      }

      // Aggregate ingredients
      ingredients.forEach(ingredient => {
        if (ingredient) {
          ingredientCounts[ingredient] = (ingredientCounts[ingredient] || 0) + 1;
        }
      });
    });

    // Convert to arrays for easier display
    const lunchSummary = Object.entries(lunchCounts).map(([meal, count]) => ({
      meal,
      count
    })).sort((a, b) => b.count - a.count);

    const dinnerSummary = Object.entries(dinnerCounts).map(([meal, count]) => ({
      meal,
      count
    })).sort((a, b) => b.count - a.count);

    // Create Order Summary using canonical counts
    const orderSummary = {
      Lunch: lunchCount,
      Dinner: dinnerCount,
      Total: total
    };

    // Create Ingredient Summary (sorted by count descending)
    const ingredientSummary = Object.entries(ingredientCounts)
      .sort((a, b) => b[1] - a[1])
      .reduce((obj, [ingredient, count]) => {
        obj[ingredient] = count;
        return obj;
      }, {});

    console.log('   📊 Order Summary:', orderSummary);
    console.log('   🥘 Ingredient Summary:', ingredientSummary);
    console.log('   👥 User Meal Details count:', userMealDetails.length);

    res.status(200).json({
      success: true,
      data: {
        date: deliveryDateStart,
        totalOrders: total,
        lunchSummary,
        dinnerSummary,
        totalLunch: lunchCount,
        totalDinner: dinnerCount,
        customerDetails,
        orderSummary,
        ingredientSummary,
        userMealDetails // ✅ NEW: User-wise meal details for kitchen table
      }
    });
  } catch (error) {
    console.error('Get aggregated meal orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching aggregated meal orders',
      error: error.message
    });
  }
};

// @desc    Get meals dashboard (kitchen-centric: next orderable delivery date)
// @route   GET /api/meals/dashboard
// @access  Private (Customer with active subscription)
exports.getMyMealsDashboard = async (req, res) => {
  try {
    // KITCHEN-CENTRIC: Show meals for the next orderable delivery date only
    const deliveryMoment = getNextOrderableDeliveryMoment();
    const deliveryDate = deliveryMoment.toDate();

    // ✅ MANDATORY FIX: Use getISTDayRange for date consistency
    const { start, end } = getISTDayRange(deliveryDate);
    const meals = await MealOrder.find({
      user: req.user._id,
      deliveryDate: { $gte: start, $lte: end }
    }).sort({ mealType: 1 });

    // ✅ FIX: Return REAL lock state based on cutoff time
    const cutoffTime = getCutoffTimeForDate(deliveryDate);
    const isLocked = nowIST().isAfter(cutoffTime);

    // Return meals for the next orderable delivery date
    const grouped = {
      nextDeliveryDate: deliveryDate,
      meals: meals,
      isLocked: isLocked // ✅ Real lock state based on cutoff
    };

    res.json({
      success: true,
      data: grouped
    });

  } catch (error) {
    console.error('Meals dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load meals dashboard'
    });
  }
};

// =========================================================
// GET PREMIUM MENU ITEMS
// =========================================================
// @route   GET /api/meals/premium-items
// @desc    Get selectable premium menu items filtered by dietary preference
// @access  Private (Customer - Premium users only)
exports.getPremiumItems = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get user's subscription to check plan type and dietary preference
    const subscription = await Subscription.findOne({
      user: userId,
      status: 'active'
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    const isPremium = subscription.planType === 'premium-veg' || subscription.planType === 'premium-non-veg';
    
    if (!isPremium) {
      return res.status(403).json({
        success: false,
        message: 'Premium menu items are only available for premium plan users'
      });
    }

    const dietaryPreference = subscription.mealPreferences?.dietaryPreference || 'both';

    // Build query filter
    const query = { isActive: true };
    
    // If user is veg, return ONLY veg items
    if (dietaryPreference === 'veg') {
      query.isVegOnly = true;
    }
    // If user is non-veg, return all items (both veg and non-veg)
    // No additional filter needed

    // Fetch items from database
    const items = await PremiumMenuItem.find(query)
      .select('category name isVegOnly compulsoryAddon')
      .sort({ category: 1, name: 1 })
      .lean();

    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔍 Total items from DB for ${dietaryPreference} user:`, items.length);
    }

    // 🔒 CRITICAL SAFETY FILTER: Double-check filtering BEFORE grouping
    // This ensures veg users NEVER see non-veg items, including in biryani category
    const filteredItems = dietaryPreference === 'veg'
      ? items.filter(item => item.isVegOnly === true)
      : items;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`✅ After safety filter: ${filteredItems.length} items`);
      if (dietaryPreference === 'veg') {
        const nonVegItems = items.filter(item => !item.isVegOnly);
        if (nonVegItems.length > 0) {
          console.warn('⚠️ WARNING: Found non-veg items for veg user (filtered out):',
            nonVegItems.map(i => `${i.name} (${i.category})`));
        }
      }
    }

    // Group items by category for easier frontend consumption
    const categorizedItems = {
      dal: [],
      rice: [],
      bread: [],
      veg: [],
      'non-veg': [],
      biryani: [],
      raita_sweets_salad: []
    };

    filteredItems.forEach(item => {
      categorizedItems[item.category].push({
        name: item.name,
        isVegOnly: item.isVegOnly,
        compulsoryAddon: item.compulsoryAddon
      });
    });

    // 🔍 Debug: Show what's in biryani category for veg users
    if (dietaryPreference === 'veg' && process.env.NODE_ENV !== 'production') {
      console.log('🍛 Biryani items for veg user:',
        categorizedItems.biryani.map(i => `${i.name} (isVegOnly: ${i.isVegOnly})`));
      console.log('🚫 Non-veg category for veg user:',
        categorizedItems['non-veg'].map(i => `${i.name} (isVegOnly: ${i.isVegOnly})`));
    }

    res.status(200).json({
      success: true,
      data: {
        items: categorizedItems,
        dietaryPreference,
        planType: subscription.planType,
        message: 'Select items from each category to customize your meal'
      }
    });

  } catch (error) {
    console.error('Get premium items error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching premium menu items',
      error: error.message
    });
  }
};
