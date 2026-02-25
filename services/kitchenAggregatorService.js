/**
 * ============================================================
 * KITCHEN AGGREGATOR SERVICE — OPTIMIZED VERSION
 * ============================================================
 *
 * Provides accurate meal counts, veg/non-veg split,
 * premium add-on breakdown, and ingredient summary for
 * a given IST delivery date.
 *
 * SOURCE OF TRUTH: MealOrder collection.
 * (NOT the Delivery collection, which tracks delivery logistics only.)
 *
 * PERFORMANCE OPTIMIZATION:
 * - Query MealOrders FIRST by deliveryDate range only (uses index)
 * - Then query User/Subscription ONLY for relevant userIds
 * - No large $in queries on full user collections
 *
 * RULES:
 *  - Filter by deliveryDate range (IST day bounds → UTC)
 *  - Exclude: paused subs, expired subs, cancelled orders, deactivated users
 *  - Include: daily orders + subscription selected + subscription default
 *  - Separate:  Lunch / Dinner / Veg / NonVeg / Premium add-ons
 *  - Ingredient summary: flatten items → group by name → sum quantity
 *  - No double counting (unique user + date + mealType ensured by DB index)
 *  - No race conditions (read-only aggregation, idempotent)
 * ============================================================
 */

'use strict';

const mongoose    = require('mongoose');
const MealOrder   = require('../models/MealOrder');
const Subscription = require('../models/Subscription');
const User        = require('../models/User');
const { getISTDayBounds, getTodayIST } = require('../utils/dateService');
const moment      = require('moment-timezone');

// ─────────────────────────────────────────────
// NON-VEG KEYWORD DETECTION (same as mealController)
// ─────────────────────────────────────────────
const NON_VEG_KEYWORDS = [
  'CHICKEN', 'EGG', 'MUTTON', 'FISH', 'KEEMA',
  'TANDOORI', 'BIRYANI', 'KORMA',
  'BUTTER CHICKEN', 'HYDRABADI', 'MURADABADI',
];

function isNonVeg(itemName) {
  if (!itemName || typeof itemName !== 'string') return false;
  const upper = itemName.toUpperCase();
  return NON_VEG_KEYWORDS.some(kw => upper.includes(kw));
}

function classifyMeal(selectedMeal) {
  if (!selectedMeal) return 'veg';
  const items = selectedMeal.items || [];
  const name  = selectedMeal.name || '';
  const allItems = [name, ...items].filter(Boolean);
  return allItems.some(isNonVeg) ? 'nonVeg' : 'veg';
}

// ─────────────────────────────────────────────
// PREMIUM ITEM DETECTION
// ─────────────────────────────────────────────
const PREMIUM_KEYWORDS = ['KADAI PANEER', 'PANEER TIKKA', 'PALAK PANEER', 'CHICKEN KORMA', 'BUTTER CHICKEN'];
function isPremiumItem(item) {
  const upper = (item || '').toUpperCase();
  return PREMIUM_KEYWORDS.some(kw => upper.includes(kw));
}

// ─────────────────────────────────────────────
// MAIN AGGREGATOR
// ─────────────────────────────────────────────

/**
 * Aggregate kitchen data for the given IST date.
 *
 * @param {Date|string|moment.Moment} [targetDate] - IST date to aggregate (defaults to today IST)
 * @returns {Promise<KitchenReport>}
 */
async function aggregateKitchenData(targetDate) {
  const dateMoment = targetDate
    ? moment.tz(targetDate, 'Asia/Kolkata').startOf('day')
    : getTodayIST();

  const { startUTC, nextDayStartUTC } = getISTDayBounds(dateMoment.toDate());

  // ── 1. FIRST: Query MealOrders by deliveryDate range ONLY ───────
  // This uses the new idx_kitchen_aggregation index - no user filter needed
  const orders = await MealOrder.find({
    deliveryDate: { $gte: startUTC, $lt: nextDayStartUTC },
    status:       { $ne: 'cancelled' },
    'selectedMeal.isSkip': { $ne: true },
  })
    .populate('user',         'name mobile address')
    .populate('subscription', 'status planType planCategory')
    .lean();

  // ── 2. Extract unique userIds from orders ────────────────────────
  const orderUserIds = [...new Set(
    orders
      .map(o => o.user?._id)
      .filter(Boolean)
      .map(id => id.toString())
  )];

  // Early return if no orders
  if (orderUserIds.length === 0) {
    return {
      date:       dateMoment.format('YYYY-MM-DD'),
      dateDisplay: dateMoment.format('dddd, MMMM D YYYY'),
      totalOrders: 0,
      lunch: buildMealBucket(),
      dinner: buildMealBucket(),
      userMealDetails: [],
      ingredientSummary: {},
    };
  }

  // ── 3. Query User collection ONLY for those userIds ─────────────
  const userIdObjs = orderUserIds.map(id => mongoose.Types.ObjectId.createFromHexString(id));
  
  const activeUsers = await User.find({
    _id:       { $in: userIdObjs },
    role:      'customer',
    isActive:  true,
    deletedAt: { $exists: false },
  }).select('_id');

  const activeUserIdSet = new Set(activeUsers.map(u => u._id.toString()));

  // ── 4. Query Subscription ONLY for those userIds ────────────────
  const pausedSubscriptions = await Subscription.find({
    user:   { $in: userIdObjs },
    status: 'paused',
  }).select('user');

  const pausedUserIdSet = new Set(pausedSubscriptions.map(s => s.user.toString()));

  // ── 5. Combined exclusion set ───────────────────────────────────
  const excludedUserIdSet = new Set([
    ...orderUserIds.filter(id => !activeUserIdSet.has(id)), // Not active users
    ...pausedUserIdSet, // Paused subscriptions
  ]);

  // ── 6. Build report ─────────────────────────────────────────────
  const report = {
    date:       dateMoment.format('YYYY-MM-DD'),
    dateDisplay: dateMoment.format('dddd, MMMM D YYYY'),
    totalOrders: 0,
    lunch: buildMealBucket(),
    dinner: buildMealBucket(),
    userMealDetails: [],   // per-user breakdown for the kitchen list
    ingredientSummary: {}, // aggregated across both meals
  };

  for (const order of orders) {
    const userId = order.user?._id?.toString();

    // Skip deactivated / paused users
    if (!userId || excludedUserIdSet.has(userId)) continue;

    // Skip if subscription-linked and subscription is expired/paused
    if (order.subscription) {
      const subStatus = order.subscription.status;
      if (['expired', 'paused', 'disabled', 'rejected'].includes(subStatus)) continue;
    }

    const bucket = order.mealType === 'lunch' ? report.lunch : report.dinner;
    const dietType = classifyMeal(order.selectedMeal);

    bucket.totalCount++;
    bucket[dietType + 'Count']++;
    report.totalOrders++;

    // Premium items
    const items = order.selectedMeal?.items || [];
    for (const item of items) {
      if (isPremiumItem(item)) {
        bucket.premiumItems[item] = (bucket.premiumItems[item] || 0) + 1;
      }
      // Aggregate ingredients
      report.ingredientSummary[item] = (report.ingredientSummary[item] || 0) + 1;
      bucket.ingredientSummary[item] = (bucket.ingredientSummary[item] || 0) + 1;
    }

    // Also count meal name itself as ingredient if no items
    if (items.length === 0 && order.selectedMeal?.name) {
      const nm = order.selectedMeal.name;
      report.ingredientSummary[nm] = (report.ingredientSummary[nm] || 0) + 1;
      bucket.ingredientSummary[nm] = (bucket.ingredientSummary[nm] || 0) + 1;
    }

    // Per-user detail for the kitchen list
    report.userMealDetails.push({
      userId:      userId,
      userName:    order.user?.name || 'Unknown',
      mobile:      order.user?.mobile || '',
      address:     order.user?.address || '',
      mealType:    order.mealType,
      mealName:    order.selectedMeal?.name || '',
      items:       items,
      dietType,
      isDefault:   !!order.selectedMeal?.isDefault,
      orderSource: order.orderSource,
    });
  }

  // ── 7. Sort ingredient summaries descending ─────────────────────
  report.ingredientSummary    = sortDescending(report.ingredientSummary);
  report.lunch.ingredientSummary  = sortDescending(report.lunch.ingredientSummary);
  report.dinner.ingredientSummary = sortDescending(report.dinner.ingredientSummary);

  return report;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function buildMealBucket() {
  return {
    totalCount:        0,
    vegCount:          0,
    nonVegCount:       0,
    premiumItems:      {},
    ingredientSummary: {},
  };
}

function sortDescending(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([, a], [, b]) => b - a)
  );
}

module.exports = { aggregateKitchenData };
