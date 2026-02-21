/**
 * ============================================================
 * DASHBOARD AGGREGATOR SERVICE
 * ============================================================
 *
 * All dashboard statistics use IST day boundaries for date filtering.
 * NEVER use moment().startOf('day') (UTC midnight).
 * ALWAYS use getISTDayBounds() from dateService.
 *
 * Paused subscriptions are EXCLUDED from active counts.
 * ============================================================
 */

'use strict';

const Subscription = require('../models/Subscription');
const Payment      = require('../models/Payment');
const MealOrder    = require('../models/MealOrder');
const Delivery     = require('../models/Delivery');
const AccessRequest = require('../models/AccessRequest');
const User         = require('../models/User');
const { getISTDayBounds, getISTNow } = require('../utils/dateService');
const moment = require('moment-timezone');

/**
 * Fetch all dashboard statistics for the owner panel.
 * Everything is scoped to IST "today".
 *
 * @returns {Promise<DashboardData>}
 */
async function getDashboardData() {
  const now = getISTNow();
  const { startUTC, nextDayStartUTC } = getISTDayBounds();                // today IST
  const monthStart = now.clone().startOf('month').toDate();
  const monthEnd   = now.clone().endOf('month').toDate();

  // ── Active users ────────────────────────────────────────────────
  const activeUserIds = await User.find({
    role:      'customer',
    isActive:  true,
    deletedAt: { $exists: false },
  }).distinct('_id');

  const totalCustomers = activeUserIds.length;

  // ── Active subscriptions (exclude paused/expired) ───────────────
  const activeSubscriptions = await Subscription.countDocuments({
    user:   { $in: activeUserIds },
    status: 'active',
  });

  // ── Paused subscriptions ────────────────────────────────────────
  const pausedSubscriptions = await Subscription.countDocuments({
    user:   { $in: activeUserIds },
    status: 'paused',
  });

  // ── Pending access requests ─────────────────────────────────────
  const pendingRequests = await AccessRequest.countDocuments({ status: 'pending' });

  // ── Today meal counts (IST day, exclude cancelled, exclude paused subs) ─
  const todayMealOrders = await MealOrder.find({
    deliveryDate: { $gte: startUTC, $lt: nextDayStartUTC },
    user:         { $in: activeUserIds },
    status:       { $ne: 'cancelled' },
    'selectedMeal.isSkip': { $ne: true },
  }).lean();

  let lunchCount  = 0;
  let dinnerCount = 0;

  // Get paused subscription user IDs to exclude
  const pausedUserIds = await Subscription.find({
    user:   { $in: activeUserIds },
    status: 'paused',
  }).distinct('user');
  const pausedSet = new Set(pausedUserIds.map(id => id.toString()));

  for (const o of todayMealOrders) {
    if (pausedSet.has(o.user?.toString())) continue;
    if (o.mealType === 'lunch')  lunchCount++;
    if (o.mealType === 'dinner') dinnerCount++;
  }

  const todayOrders = lunchCount + dinnerCount;

  // ── Today's delivery count ──────────────────────────────────────
  const todayDeliveries = await Delivery.countDocuments({
    deliveryDate: { $gte: startUTC, $lt: nextDayStartUTC },
    user:         { $in: activeUserIds },
    status:       { $nin: ['disabled', 'paused'] },
  });

  // ── Payments ────────────────────────────────────────────────────
  // Monthly collection (verified payments in current IST month)
  const monthlyPayments = await Payment.aggregate([
    {
      $match: {
        user:          { $in: activeUserIds },
        paymentStatus: 'verified',
        // Use paymentDate or createdAt, filtered by IST month boundaries
        $or: [
          { paymentDate: { $gte: monthStart, $lte: monthEnd } },
          { createdAt:   { $gte: monthStart, $lte: monthEnd } },
        ],
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const monthlyRevenue = monthlyPayments[0]?.total || 0;

  // Today's collection (IST day bounds)
  const todayPayments = await Payment.aggregate([
    {
      $match: {
        user:          { $in: activeUserIds },
        paymentStatus: 'verified',
        $or: [
          { paymentDate: { $gte: startUTC, $lt: nextDayStartUTC } },
          { createdAt:   { $gte: startUTC, $lt: nextDayStartUTC } },
        ],
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const todayCollection = todayPayments[0]?.total || 0;

  // Pending payments
  const pendingPayments = await Payment.countDocuments({
    user:          { $in: activeUserIds },
    paymentStatus: { $in: ['pending', 'partial'] },
  });

  // ── Expiring subscriptions (within 2 days) ───────────────────────
  const twoDaysLater = now.clone().add(2, 'days').endOf('day').toDate();
  const expiringCount = await Subscription.countDocuments({
    user:           { $in: activeUserIds },
    status:         'active',
    endDate:        { $gte: now.toDate(), $lte: twoDaysLater },
    reminderSent:   false,
  });

  return {
    totalCustomers,
    activeCustomers:      totalCustomers,
    activeSubscriptions,
    pausedSubscriptions,
    pendingRequests,
    lunchCount,
    dinnerCount,
    todayOrders,
    todayDeliveries,
    monthlyRevenue,
    todayCollection,
    pendingPayments,
    expiringSubscriptions: expiringCount,
    generatedAt:           now.format('YYYY-MM-DD HH:mm:ss [IST]'),
  };
}

module.exports = { getDashboardData };
