const mongoose = require('mongoose');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Delivery = require('../models/Delivery');
const Payment = require('../models/Payment');
const AccessRequest = require('../models/AccessRequest');
const ExtraTiffin = require('../models/ExtraTiffin');
const Pause = require('../models/Pause');
const MealOrder = require('../models/MealOrder');
const Lead = require('../models/Lead');
const AppNotification = require('../models/AppNotification');
const OwnerAuditLog = require('../models/OwnerAuditLog');
const SubscriptionLock = require('../models/SubscriptionLock');
const RestaurantStatus = require('../models/RestaurantStatus');
const socketService = require('../services/socketService');
const moment = require('moment-timezone');
const { getISTDayBounds, getISTNow } = require('../utils/dateService');
const { getTodayMeals } = require('../utils/mealCounter');
const { getActiveUserIds } = require('../utils/activeUserHelper');
const { ensureDefaultMealsForDate } = require('../services/defaultMealService');

// @desc    Get dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private (Owner only)
//test
exports.getDashboardStats = async (req, res) => {
  // Initialize all metrics with default values
  let activeUserIds = [];
  let totalCustomers = 0;
  let activeCustomers = 0;
  let activeSubscriptions = 0;
  let pendingRequests = 0;
  let todayDeliveries = 0;
  let lunchCount = 0;
  let dinnerCount = 0;
  let totalTodayMeals = 0;
  let pendingPayments = 0;
  let overduePayments = 0;
  let expiringSubscriptions = 0;
  let monthlyRevenue = 0;
  let totalPendingAmount = 0;
  let expiringSoonCount = 0;
  let expiredCount = 0;
  let pausedCount = 0;
  let totalAlerts = 0;
  let monthlyCollection = { thisMonth: 0, paid: 0, pending: 0 };
  let todayCollection = { total: 0, paid: 0, pending: 0 };
  let totalLeads = 0;
  let newLeads = 0;
  let userCollection = [];

  try {
    // ✅ STEP 1: Get active users FIRST (single source of truth)
    try {
      activeUserIds = await getActiveUserIds();
      totalCustomers = activeUserIds.length;
      activeCustomers = activeUserIds.length;
    } catch (error) {
      console.error('Error getting active users:', error);
      activeUserIds = [];
      totalCustomers = 0;
      activeCustomers = 0;
    }

    // ✅ STEP 2: Count active subscriptions ONLY for active users
    try {
      activeSubscriptions = await Subscription.countDocuments({
        user: { $in: activeUserIds },
        status: 'active'
      });
    } catch (error) {
      console.error('Error counting active subscriptions:', error);
      activeSubscriptions = 0;
    }

    // ✅ STEP 3: Count pending requests
    try {
      pendingRequests = await AccessRequest.countDocuments({ status: 'pending' });
    } catch (error) {
      console.error('Error counting pending requests:', error);
      pendingRequests = 0;
    }

    // NOTE: Dashboard APIs must be read-only. No data mutations allowed.
    // Default meal creation should happen in meal selection APIs, not dashboard fetch.

    console.log('\n📊 [DASHBOARD COUNTS VERIFICATION]');
    console.log('==============================================');
    console.log(`   Active Users:          ${activeCustomers}`);
    console.log(`   Active Subscriptions:  ${activeSubscriptions}`);
    console.log(`   Match Status: ${activeSubscriptions <= activeCustomers ? '✅ VALID' : '❌ ERROR'}`);
    if (activeSubscriptions > activeCustomers) {
      console.error('   ❌ ERROR: More subscriptions than users!');
      console.error('   ❌ Check for subscriptions of deleted users');
    }
    console.log('==============================================\n');

    // ✅ IST-CORRECT date boundaries — NEVER use moment().startOf('day') (UTC midnight).
    // Always derive boundaries from IST so queries align with the Indian calendar day.
    const { startUTC: today, nextDayStartUTC: tomorrow } = getISTDayBounds();
    const dayAfter = getISTNow().startOf('day').add(2, 'days').toDate();
    
    // activeUserIds already fetched at the beginning
    console.log('\n👥 [DASHBOARD ACTIVE USERS FILTER]');
    console.log(`   - Total Active Users: ${activeUserIds.length}`);
    console.log('   - Criteria: role=customer, isActive=true, deletedAt does not exist');
    console.log('   - ✅ Deleted users will be EXCLUDED from all counts');
    console.log('');
    
    // ✅ DELIVERIES FOR TODAY (for delivery status tracking only)
    // This count is for delivery status, NOT meal preparation
    // Meal counts should use todayOrders.lunch/dinner from MealOrder collection
    try {
      todayDeliveries = await Delivery.countDocuments({
        deliveryDate: { $gte: today, $lt: tomorrow },
        user: { $in: activeUserIds }
      });
    } catch (error) {
      console.error('Error counting today deliveries:', error);
      todayDeliveries = 0;
    }

    // ======================================================================
    // ✅ TODAY MEALS TO COOK - STRICT TODAY ONLY
    // ======================================================================
    console.log('\n==============================================');
    console.log('🔍 [VERIFICATION] OWNER DASHBOARD ORDER QUERY');
    console.log('==============================================');
    console.log('📊 Query Name: getDashboardStats - Today Orders');
    console.log('📅 Date Logic:');
    console.log('   - Using: TODAY date only');
    console.log('   - Date Range: startOf(today) → endOf(today)');
    console.log('   - Current Server Time:', moment().format('YYYY-MM-DD HH:mm:ss'));
    console.log('   - Server Timezone:', moment().format('Z'));
    console.log('🔍 Field Used in Query: deliveryDate');
    console.log('📝 What Dashboard Counts:');
    console.log('   - Meals with deliveryDate = TODAY');
    console.log('   - NOT counting createdAt');
    console.log('   - NOT counting tomorrow\'s meals');
    console.log('==============================================\n');
    
    try {
      const todayMealsData = await getTodayMeals(activeUserIds, MealOrder);
      const { lunchCount: lunch, dinnerCount: dinner, totalUsers: total } = todayMealsData;
      lunchCount = lunch;
      dinnerCount = dinner;
      totalTodayMeals = total;
    } catch (error) {
      console.error('Error getting today meals data:', error);
      lunchCount = 0;
      dinnerCount = 0;
      totalTodayMeals = 0;
    }

    console.log('📊 [DASHBOARD] Meals to Cook TODAY:');
    console.log(`      - Lunch: ${lunchCount}`);
    console.log(`      - Dinner: ${dinnerCount}`);
    console.log(`      - Total: ${totalTodayMeals}`);
    console.log('   ✅ Dashboard: TODAY ONLY (no tomorrow)');
    console.log('   ✅ Source: MealOrder collection (matches Kitchen)');
    console.log('   ✅ Active Users Included:', activeUserIds.length);
    
    if (duplicates.length > 0) {
      console.error(`   ❌ WARNING: ${duplicates.length} duplicate meal orders detected!`);
    }
    
    // ✅ VERIFICATION: Compare counts
    console.log('\n🔍 [VERIFICATION CHECKPOINT]');
    console.log('==============================================');
    console.log(`   Active Users (DB count):        ${activeUserIds.length}`);
    console.log(`   Meal Orders Found (DB count):   ${totalTodayMeals}`);
    console.log(`   Expected: Meal Orders ≤ Active Users × 2 (lunch + dinner)`);
    console.log(`   Max Possible: ${activeUserIds.length * 2} meals (if all users have both)`);
    
    if (totalTodayMeals > activeUserIds.length * 2) {
      console.error('   ❌ ERROR: More meals than possible!');
      console.error('   ❌ Check for duplicates or inactive user meals');
    } else {
      console.log('   ✅ Count validation PASSED');
    }
    console.log('==============================================\n');
    
    // Debug: Check if ANY meal orders exist at all
    if (totalTodayMeals === 0) {
      const totalMealOrders = await MealOrder.countDocuments({});
      console.log('   ⚠️ Total meal orders in DB:', totalMealOrders);
      
      // Check recent orders
      const recentOrders = await MealOrder.find({}).sort({ createdAt: -1 }).limit(5).select('createdAt mealType deliveryDate user');
      console.log('   ⚠️ Recent meal orders in DB:');
      recentOrders.forEach(order => {
        console.log(`      - Created: ${moment(order.createdAt).format('YYYY-MM-DD HH:mm')}, Type: ${order.mealType}, Delivery: ${moment(order.deliveryDate).format('YYYY-MM-DD')}`);
      });
    }

    // Pending payments - exclude deleted users
    try {
      pendingPayments = await Payment.countDocuments({
        paymentStatus: { $in: ['pending', 'partial'] },
        user: { $in: activeUserIds }
      });
    } catch (error) {
      console.error('Error counting pending payments:', error);
      pendingPayments = 0;
    }

    try {
      overduePayments = await Payment.countDocuments({
        paymentStatus: 'overdue',
        user: { $in: activeUserIds }
      });
    } catch (error) {
      console.error('Error counting overdue payments:', error);
      overduePayments = 0;
    }

    // Expiring subscriptions (next 7 days) - exclude deleted users
    try {
      const sevenDaysFromNow = getISTNow().add(7, 'days').endOf('day').toDate();
      expiringSubscriptions = await Subscription.countDocuments({
        status: 'active',
        user: { $in: activeUserIds },
        endDate: { $gte: tomorrow, $lte: sevenDaysFromNow }
      });
    } catch (error) {
      console.error('Error counting expiring subscriptions:', error);
      expiringSubscriptions = 0;
    }

    // Revenue calculations (this month)
    try {
      const monthStart = getISTNow().startOf('month').toDate();
      const monthEnd   = getISTNow().endOf('month').toDate();

      const monthPayments = await Payment.aggregate([
        {
          $match: {
            paymentDate: { $gte: monthStart, $lte: monthEnd },
            paymentStatus: 'paid',
            user: { $in: activeUserIds }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$paidAmount' }
          }
        }
      ]);

      monthlyRevenue = monthPayments.length > 0 ? monthPayments[0].totalRevenue : 0;
    } catch (error) {
      console.error('Error calculating monthly revenue:', error);
      monthlyRevenue = 0;
    }

    // Pending amount (sum of all pending payments)
    try {
      const pendingAmount = await Payment.aggregate([
        {
          $match: {
            paymentStatus: { $in: ['pending', 'partial'] },
            user: { $in: activeUserIds }
          }
        },
        {
          $group: {
            _id: null,
            totalPending: { $sum: '$amount' }
          }
        }
      ]);

      totalPendingAmount = pendingAmount.length > 0 ? pendingAmount[0].totalPending : 0;
    } catch (error) {
      console.error('Error calculating pending amount:', error);
      totalPendingAmount = 0;
    }

    // ======================================================================
    // ✅ SUBSCRIPTION ALERTS (REAL DATA)
    // ======================================================================
    try {
      console.log('🚨 [DASHBOARD] Calculating subscription alerts...');

      const todayDate   = getISTNow().startOf('day').toDate();
      const warningDate = getISTNow().add(3, 'days').endOf('day').toDate();

      // 1️⃣ EXPIRING SOON (within 3 days)
      expiringSoonCount = await Subscription.countDocuments({
        status: 'active',
        user: { $in: activeUserIds },
        endDate: { $gte: todayDate, $lte: warningDate }
      });

      // 2️⃣ EXPIRED (endDate < today)
      expiredCount = await Subscription.countDocuments({
        user: { $in: activeUserIds },
        endDate: { $lt: todayDate }
      });

      // 3️⃣ PAUSED
      pausedCount = await Subscription.countDocuments({
        status: 'paused',
        user: { $in: activeUserIds }
      });

      totalAlerts = expiringSoonCount + expiredCount + pausedCount;
    } catch (error) {
      console.error('Error calculating subscription alerts:', error);
      expiringSoonCount = 0;
      expiredCount = 0;
      pausedCount = 0;
      totalAlerts = 0;
    }
    
    console.log('🚨 [DASHBOARD] Subscription Alerts:');
    console.log(`      - Expiring Soon (≤3 days): ${expiringSoonCount}`);
    console.log(`      - Expired: ${expiredCount}`);
    console.log(`      - Paused: ${pausedCount}`);
    console.log(`      - Total Alerts: ${totalAlerts}`);
    console.log('');

    // ✅ MONTHLY COLLECTION (TASK 2 & 3)
    // Calculate total subscription amounts for current month (paid + pending)
    try {
      const currentMonth = moment().month() + 1; // 1-12
      const currentYear = moment().year();

      console.log('💰 Calculating Monthly Collection:');
      console.log('   Current Month/Year:', `${currentMonth}/${currentYear}`);
      console.log('   Active Users:', activeUserIds.length);

      // Debug: Check all payments in DB
      const allPaymentsCount = await Payment.countDocuments({});
      console.log('   Total Payments in DB:', allPaymentsCount);

      // Use month/year fields for reliable filtering
      const thisMonthPaymentsCount = await Payment.countDocuments({
        month: currentMonth,
        year: currentYear
      });
      console.log('   Payments This Month (month/year filter):', thisMonthPaymentsCount);

      // Debug: Show sample payments from this month
      if (thisMonthPaymentsCount > 0) {
        const samplePayments = await Payment.find({
          month: currentMonth,
          year: currentYear
        }).limit(3).select('amount status month year createdAt user subscription');
        console.log('   Sample Payments This Month:');
        samplePayments.forEach(p => {
          console.log(`      - ID: ${p._id}, Amount: ₹${p.amount}, Status: ${p.status}, Month/Year: ${p.month}/${p.year}`);
        });
      }

      const monthlyPayments = await Payment.aggregate([
        {
          $match: {
            month: currentMonth,
            year: currentYear,
            status: { $in: ['paid', 'verified', 'pending'] },
            user: { $in: activeUserIds }
          }
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
            paidAmount: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['paid', 'verified']] },
                  '$amount',
                  0
                ]
              }
            },
            pendingAmount: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'pending'] },
                  '$amount',
                  0
                ]
              }
            }
          }
        }
      ]);

      monthlyCollection = monthlyPayments.length > 0 ? {
        thisMonth: monthlyPayments[0].totalAmount,
        paid: monthlyPayments[0].paidAmount,
        pending: monthlyPayments[0].pendingAmount
      } : {
        thisMonth: 0,
        paid: 0,
        pending: 0
      };

      console.log('   Monthly Collection Result:');
      console.log('   - Payments Found:', monthlyPayments.length > 0 ? monthlyPayments[0].count : 0);
      console.log('   - Total This Month: ₹' + monthlyCollection.thisMonth);
      console.log('   - Paid: ₹' + monthlyCollection.paid);
      console.log('   - Pending: ₹' + monthlyCollection.pending);
    } catch (error) {
      console.error('Error calculating monthly collection:', error);
      monthlyCollection = { thisMonth: 0, paid: 0, pending: 0 };
    }

    // ✅ TODAY COLLECTION (NEW - Separate from Monthly Collection)
    // Calculate total payments for TODAY only (paid + pending)
    try {
      const startToday = getISTNow().startOf('day').toDate();
      const endToday   = getISTNow().endOf('day').toDate();

      console.log('💰 Calculating Today Collection:');
      console.log('   Today Start:', startToday);
      console.log('   Today End:', endToday);

      const todayPayments = await Payment.aggregate([
        {
          $match: {
            createdAt: { $gte: startToday, $lte: endToday },
            status: { $in: ['paid', 'verified', 'pending'] },
            user: { $in: activeUserIds }
          }
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
            paidAmount: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['paid', 'verified']] },
                  '$amount',
                  0
                ]
              }
            },
            pendingAmount: {
              $sum: {
                $cond: [
                  { $eq: ['$status', 'pending'] },
                  '$amount',
                  0
                ]
              }
            }
          }
        }
      ]);

      todayCollection = todayPayments.length > 0 ? {
        total: todayPayments[0].totalAmount,
        paid: todayPayments[0].paidAmount,
        pending: todayPayments[0].pendingAmount
      } : {
        total: 0,
        paid: 0,
        pending: 0
      };

      console.log('   Today Collection Result:');
      console.log('   - Payments Found:', todayPayments.length > 0 ? todayPayments[0].count : 0);
      console.log('   - Total Today: ₹' + todayCollection.total);
      console.log('   - Paid: ₹' + todayCollection.paid);
      console.log('   - Pending: ₹' + todayCollection.pending);
    } catch (error) {
      console.error('Error calculating today collection:', error);
      todayCollection = { total: 0, paid: 0, pending: 0 };
    }

    // ======================================================================
    // ✅ SERVICE LEADS (REAL DATA)
    // ======================================================================
    try {
      console.log('📞 [DASHBOARD] Calculating service leads...');

      totalLeads = await Lead.countDocuments({});
      newLeads = await Lead.countDocuments({ status: 'new' });

      console.log('📞 [DASHBOARD] Service Leads:');
      console.log(`      - Total Leads: ${totalLeads}`);
      console.log(`      - New Leads: ${newLeads}`);
      console.log('');
    } catch (error) {
      console.error('Error counting service leads:', error);
      totalLeads = 0;
      newLeads = 0;
    }

    // ======================================================================
    // ✅ USER COLLECTION (Dashboard Overview - All Active Customers)
    // ======================================================================
    try {
      console.log('👥 [DASHBOARD] Fetching user collection overview...');

      const allCustomers = await User.find({
        role: 'customer',
        isActive: true,
        deletedAt: { $exists: false }
      })
        .select('name mobile address isActive')
        .lean();

      userCollection = await Promise.all(allCustomers.map(async (user) => {
        let subscriptionData = {
          planName: 'No Subscription',
          planType: 'N/A',
          status: 'NONE',
          startDate: null,
          endDate: null,
          totalPrice: 0
        };

        // Get latest subscription for this user (active, paused, requested, or expired)
        const subscription = await Subscription.findOne({ user: user._id })
          .sort({ createdAt: -1 })
          .populate('plan', 'name category totalPrice')
          .select('status startDate endDate plan')
          .lean();

        if (subscription && subscription.plan) {
          subscriptionData = {
            planName: subscription.plan.name || 'Unknown Plan',
            planType: subscription.plan.category || 'N/A',
            status: subscription.status?.toUpperCase() || 'UNKNOWN',
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            totalPrice: subscription.plan.totalPrice || 0
          };
        }

        // Format address (handle both string and object formats)
        let formattedAddress = 'N/A';
        if (user.address) {
          if (typeof user.address === 'string') {
            formattedAddress = user.address;
          } else if (typeof user.address === 'object') {
            const parts = [];
            if (user.address.street) parts.push(user.address.street);
            if (user.address.landmark) parts.push(user.address.landmark);
            if (user.address.city) parts.push(user.address.city);
            if (user.address.area) parts.push(user.address.area);
            formattedAddress = parts.length > 0 ? parts.join(', ') : 'N/A';
          }
        }

        // ✅ CRITICAL BUSINESS RULE:
        // Show amount ONLY if subscription is ACTIVE (cash already collected)
        const amountCollected = subscriptionData.status === 'ACTIVE'
          ? subscriptionData.totalPrice
          : 0;

        return {
          userId: user._id,
          name: user.name || 'Unknown',
          mobile: user.mobile || 'N/A',
          address: formattedAddress,
          subscriptionStatus: subscriptionData.status,
          planName: subscriptionData.planName,
          planType: subscriptionData.planType,
          amountCollected: amountCollected,
          startDate: subscriptionData.startDate,
          endDate: subscriptionData.endDate

        };
      }));

      console.log('👥 [DASHBOARD] User Collection:');
      console.log(`      - Users fetched: ${userCollection.length}`);
      console.log('');
    } catch (error) {
      console.error('Error fetching user collection:', error);
      userCollection = [];
    }

    // ✅ FINAL RESPONSE SUMMARY
    console.log('📤 [DASHBOARD RESPONSE SUMMARY]');
    console.log('==============================================');
    console.log('📊 Key Metrics Being Sent:');
    console.log(`   - customers.total:           ${totalCustomers}`);
    console.log(`   - customers.active:          ${activeCustomers}`);
    console.log(`   - subscriptions.active:      ${activeSubscriptions}`);
    console.log(`   - todayOrders.lunch:         ${lunchCount}`);
    console.log(`   - todayOrders.dinner:        ${dinnerCount}`);
    console.log(`   - todayOrders.total:         ${totalTodayMeals}`);
    console.log(`   - mealOrders.today:          ${totalTodayMeals}`);
    console.log('\n✅ All counts filtered by ACTIVE USERS ONLY');
    console.log('✅ Subscriptions counted ONLY for active users');
    console.log('✅ Deleted/inactive users are EXCLUDED');
    console.log('✅ Logic matches Kitchen aggregation');
    console.log('==============================================\n');

    res.status(200).json({
      success: true,
      data: {
        customers: {
          total: totalCustomers,
          active: activeCustomers
        },
        subscriptions: {
          active: activeSubscriptions,
          expiring: expiringSubscriptions
        },
        // ⚠️ IMPORTANT: Use 'todayOrders' for meal counts, NOT 'deliveries'
        // 'deliveries.today' is for delivery status tracking only
        deliveries: {
          today: todayDeliveries  // Delivery status count only
        },
        // ✅ USE THIS: Single source of truth for meal counts (from MealOrder collection)
        mealOrders: {
          today: totalTodayMeals // Meals to cook today (matches Kitchen)
        },
        // ✅ USE THIS: Primary meal counts (from MealOrder collection)
        todayOrders: {
          lunch: lunchCount,      // MealOrder count for lunch
          dinner: dinnerCount,    // MealOrder count for dinner
          total: totalTodayMeals  // Total MealOrder count (lunch + dinner)
        },
        payments: {
          pending: pendingPayments,
          overdue: overduePayments,
          thisMonth: monthlyCollection.thisMonth,
          paidThisMonth: monthlyCollection.paid,
          pendingThisMonth: monthlyCollection.pending
        },
        todayCollection: {
          total: todayCollection.total,
          paid: todayCollection.paid,
          pending: todayCollection.pending
        },
        subscriptionAlerts: {
          expiringSoon: expiringSoonCount,
          expired: expiredCount,
          paused: pausedCount,
          total: totalAlerts
        },
        serviceLeads: {
          total: totalLeads,
          new: newLeads
        },
        accessRequests: {
          pending: pendingRequests
        },
        revenue: {
          thisMonth: monthlyRevenue
        },
        collection: {
          today: todayCollection,
          pending: totalPendingAmount
        },
        userCollection: userCollection
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(200).json({
      success: true,
      data: {
        customers: {
          total: totalCustomers,
          active: activeCustomers
        },
        subscriptions: {
          active: activeSubscriptions,
          expiring: expiringSubscriptions
        },
        deliveries: {
          today: todayDeliveries
        },
        mealOrders: {
          today: totalTodayMeals
        },
        todayOrders: {
          lunch: lunchCount,
          dinner: dinnerCount,
          total: totalTodayMeals
        },
        payments: {
          pending: pendingPayments,
          overdue: overduePayments,
          thisMonth: monthlyCollection.thisMonth,
          paidThisMonth: monthlyCollection.paid,
          pendingThisMonth: monthlyCollection.pending
        },
        todayCollection: {
          total: todayCollection.total,
          paid: todayCollection.paid,
          pending: todayCollection.pending
        },
        subscriptionAlerts: {
          expiringSoon: expiringSoonCount,
          expired: expiredCount,
          paused: pausedCount,
          total: totalAlerts
        },
        serviceLeads: {
          total: totalLeads,
          new: newLeads
        },
        accessRequests: {
          pending: pendingRequests
        },
        revenue: {
          thisMonth: monthlyRevenue
        },
        collection: {
          today: todayCollection,
          pending: totalPendingAmount
        },
        userCollection: userCollection
      }
    });
  }
};

// @desc    Get expiring subscriptions
// @route   GET /api/admin/expiring-subscriptions
// @access  Private (Owner only)
exports.getExpiringSubscriptions = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    
    const today      = getISTNow().startOf('day').toDate();
    const futureDate = getISTNow().add(parseInt(days), 'days').endOf('day').toDate();

    // Get active users (non-deleted) - same logic as dashboard
    const activeUserIds = await User.find({ 
      role: 'customer', 
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    const subscriptions = await Subscription.find({
      status: 'active',
      user: { $in: activeUserIds },
      endDate: { $gte: today, $lte: futureDate }
    })
      .populate('user', 'name mobile userId')
      .select('user planType endDate status')
      .sort({ endDate: 1 });

    console.log(`📋 [EXPIRING SUBS] Found ${subscriptions.length} expiring subscriptions (within ${days} days)`);

    res.status(200).json({
      success: true,
      count: subscriptions.length,
      data: subscriptions
    });
  } catch (error) {
    console.error('Get expiring subscriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching expiring subscriptions',
      error: error.message
    });
  }
};

// @desc    Create customer with subscription
// @route   POST /api/admin/create-customer
// @access  Private (Owner only)
exports.createCustomerWithSubscription = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      mobile,
      address,
      planType,
      startDate,
      amount,
      mealPreferences
    } = req.body;

    // Validate required fields
    if (!name || !mobile || !address || !planType || !startDate || !amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Name, mobile, address, planType, startDate, and amount are required'
      });
    }

    // Validate startDate format
    const startDateObj = new Date(startDate);
    if (isNaN(startDateObj.getTime())) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid startDate format'
      });
    }

    // Normalize mobile format
    const normalizedMobile = mobile.toString().trim().replace(/\D/g, '');
    if (normalizedMobile.length !== 10) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Mobile number must be 10 digits'
      });
    }

    // Check if mobile already exists
    const existingUser = await User.findOne({
      mobile: normalizedMobile,
      deletedAt: { $exists: false }
    }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'User with this mobile already exists'
      });
    }

    // Generate user ID and password
    const userCount = await User.countDocuments({ role: 'customer' }).session(session);
    const userId = `CUST${String(userCount + 1).padStart(4, '0')}`;
    const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();

    // Create user
    const user = await User.create([{
      userId,
      password: tempPassword,
      name,
      mobile: normalizedMobile,
      address,
      role: 'customer',
      isActive: true,
      isPasswordChanged: false,
      createdBy: req.user._id
    }], { session });

    // Create subscription (mandatory)
    const start = moment(startDate);
    let end, totalDays;

    switch (planType) {
      case 'daily':
        end = moment(startDate);
        totalDays = 1;
        break;
      case 'weekly':
        end = moment(startDate).add(6, 'days');
        totalDays = 7;
        break;
      case 'monthly':
        end = moment(startDate).add(1, 'month').subtract(1, 'day');
        totalDays = end.diff(start, 'days') + 1;
        break;
      default:
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Invalid plan type. Must be daily, weekly, or monthly'
        });
    }

    const subscription = await Subscription.create([{
      user: user[0]._id,
      planType,
      startDate: start.toDate(),
      endDate: end.toDate(),
      totalDays,
      remainingDays: totalDays,
      amount,
      mealPreferences: mealPreferences || { includesLunch: true, includesDinner: true },
      createdBy: req.user._id
    }], { session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    // Log the action
    await OwnerAuditLog.logAction(
      req.user._id,
      'create_customer',
      user[0]._id
    );

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: {
        user: user[0],
        subscription: subscription ? subscription[0] : null,
        credentials: {
          userId,
          tempPassword
        }
      }
    });
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();

    console.error('Create customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating customer',
      error: error.message
    });
  }
};

// @desc    Get extra tiffin requests
// @route   GET /api/admin/extra-tiffins
// @access  Private (Owner only)
exports.getExtraTiffinRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status) filter.status = status;

    const requests = await ExtraTiffin.find(filter)
      .populate('user', 'name mobile userId')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('Get extra tiffin requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching extra tiffin requests',
      error: error.message
    });
  }
};

// @desc    Approve extra tiffin request
// @route   POST /api/admin/extra-tiffins/:id/approve
// @access  Private (Owner only)
exports.approveExtraTiffin = async (req, res) => {
  try {
    const extraTiffin = await ExtraTiffin.findById(req.params.id);

    if (!extraTiffin) {
      return res.status(404).json({
        success: false,
        message: 'Extra tiffin request not found'
      });
    }

    // Check if already approved
    if (extraTiffin.status === 'approved') {
      return res.status(200).json({
        success: true,
        message: 'Already approved'
      });
    }

    extraTiffin.status = 'approved';
    extraTiffin.approvedBy = req.user._id;
    extraTiffin.approvedAt = new Date();
    await extraTiffin.save();

    // Log the action
    await OwnerAuditLog.logAction(
      req.user._id,
      'approve_extra',
      extraTiffin.user
    );

    res.status(200).json({
      success: true,
      message: 'Extra tiffin request approved',
      data: extraTiffin
    });
  } catch (error) {
    console.error('Approve extra tiffin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving extra tiffin request',
      error: error.message
    });
  }
};

// @desc    Get pause requests
// @route   GET /api/admin/pause-requests
// @access  Private (Owner only)
exports.getPauseRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status) filter.status = status;

    const requests = await Pause.find(filter)
      .populate('user', 'name mobile userId')
      .populate('subscription', 'planType')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('Get pause requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pause requests',
      error: error.message
    });
  }
};

// @desc    Approve pause request
// @route   POST /api/admin/pause-requests/:id/approve
// @access  Private (Owner only)
exports.approvePauseRequest = async (req, res) => {
  try {
    const pauseRequest = await Pause.findById(req.params.id).populate('subscription');

    if (!pauseRequest) {
      return res.status(404).json({
        success: false,
        message: 'Pause request not found'
      });
    }

    // Check if already approved
    if (pauseRequest.status === 'approved') {
      return res.status(200).json({
        success: true,
        message: 'Already approved'
      });
    }

    // Attempt to acquire subscription lock
    const lockResult = await SubscriptionLock.acquireLock(pauseRequest.subscription._id, 'pause_approval', req.user._id.toString());
    if (!lockResult.success) {
      return res.status(409).json({
        success: false,
        message: 'Subscription is currently being processed by another operation. Please try again in a few moments.',
        reason: lockResult.reason
      });
    }

    try {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Re-fetch with session
        const pauseRequestDoc = await Pause.findById(req.params.id).populate('subscription').session(session);
        const subscription = await Subscription.findById(pauseRequest.subscription._id).session(session);

        if (!pauseRequestDoc || !subscription) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            success: false,
            message: 'Pause request or subscription not found'
          });
        }

        // Recalculate subscription endDate: endDate += pauseDays
        const originalEndDate = moment(subscription.endDate);
        const newEndDate = originalEndDate.add(pauseRequest.totalPausedDays, 'days');

        console.log(`⏸️ [PAUSE APPROVAL] Extending subscription ${subscription._id} endDate:`);
        console.log(`   Original: ${originalEndDate.format('YYYY-MM-DD')}`);
        console.log(`   Pause Days: ${pauseRequest.totalPausedDays}`);
        console.log(`   New: ${newEndDate.format('YYYY-MM-DD')}`);

        // Update pause request
        pauseRequestDoc.status = 'approved';
        pauseRequestDoc.approvedBy = req.user._id;
        pauseRequestDoc.approvedAt = new Date();
        await pauseRequestDoc.save({ session });

        // Update subscription endDate and status
        subscription.endDate = newEndDate.toDate();
        if (pauseRequest.isActive()) {
          subscription.status = 'paused';
        }
        await subscription.save({ session });

        // Commit transaction
        await session.commitTransaction();
        session.endSession();

        // Log the action
        await OwnerAuditLog.logAction(
          req.user._id,
          'approve_pause',
          pauseRequest.user
        );

        res.status(200).json({
          success: true,
          message: 'Pause request approved and subscription extended',
          data: {
            pauseRequest: pauseRequestDoc,
            subscription: {
              _id: subscription._id,
              originalEndDate: originalEndDate.toDate(),
              newEndDate: subscription.endDate,
              pauseDays: pauseRequest.totalPausedDays
            }
          }
        });
      } catch (transactionErr) {
        await session.abortTransaction();
        session.endSession();
        throw transactionErr;
      }
    } finally {
      // Always release the subscription lock
      await SubscriptionLock.releaseLock(pauseRequest.subscription._id);
    }
  } catch (error) {
    console.error('Approve pause request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving pause request',
      error: error.message
    });
  }
};

// @desc    Reset user password (Admin only)
// @route   POST /api/admin/reset-user-password/:userId
// @access  Private (Owner only)
exports.resetUserPassword = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'customer') {
      return res.status(400).json({
        success: false,
        message: 'Password reset is only available for customer accounts'
      });
    }

    // Check if user is deleted or inactive
    if (user.deletedAt || !user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reset password for deleted or inactive users'
      });
    }

    // Log owner performing the reset
    console.log(`🔑 [PASSWORD RESET] Owner ${req.user._id} resetting password for customer ${user._id} (${user.userId})`);

    // Generate 8-character random temporary password
    const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();

    // Hash and save password (pre-save hook handles hashing)
    user.password = tempPassword;
    user.forcePasswordChange = true;
    await user.save();

    // Log the action
    await OwnerAuditLog.logAction(
      req.user._id,
      'reset_password',
      user._id
    );

    // Send SMS to customer with temp password
    const smsService = require('../services/smsService');
    await smsService.sendCredentials(user.mobile, user.userId, tempPassword);

    // Create AppNotification
    const AppNotification = require('../models/AppNotification');
    await AppNotification.create({
      relatedUser: user._id,
      type: 'password_reset_admin',
      title: 'Password Reset by Admin',
      message: 'Your password was reset by kitchen admin',
      relatedModel: 'User',
      relatedId: user._id
    });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
      data: {
        tempPassword: tempPassword // Return for owner panel display
      }
    });
  } catch (error) {
    console.error('Reset user password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting user password',
      error: error.message
    });
  }
};

// ============================================================
// PHASE 16A — RESTAURANT OPEN / CLOSE TOGGLE
// ============================================================

// @desc    Get current restaurant open/close status
// @route   GET /api/admin/restaurant/status
// @access  Private (Owner)
exports.getRestaurantStatus = async (req, res) => {
  try {
    let status = await RestaurantStatus.findOne();
    if (!status) {
      // Create default (open) if document doesn't exist
      status = await RestaurantStatus.create({ isOpen: true });
    }
    res.status(200).json({
      success: true,
      data: {
        isOpen:         status.isOpen,
        closedDate:     status.closedDate || null,
        message:        status.message || null,
        lastUpdatedBy:  status.lastUpdatedBy || null,
        updatedAt:      status.updatedAt,
      },
    });
  } catch (error) {
    console.error('Get restaurant status error:', error);
    res.status(500).json({ success: false, message: 'Error fetching restaurant status', error: error.message });
  }
};

// @desc    Toggle restaurant open/close
// @route   PATCH /api/admin/restaurant/toggle
// @access  Private (Owner)
exports.toggleRestaurantStatus = async (req, res) => {
  try {
    const { isOpen, message, closeTomorrow } = req.body;

    // ✅ BUG 2 FIX: Support date-scoped close (closeTomorrow) without flipping global isOpen.
    // closeTomorrow=true  → sets closedDate = IST midnight of tomorrow, keeps isOpen=true
    // closeTomorrow=false → clears closedDate only
    // isOpen=false        → global close (existing behaviour), clears closedDate
    // isOpen=true         → global open, also clears closedDate
    if (closeTomorrow !== undefined && typeof closeTomorrow !== 'boolean') {
      return res.status(400).json({ success: false, message: '"closeTomorrow" must be a boolean.' });
    }
    if (isOpen !== undefined && typeof isOpen !== 'boolean') {
      return res.status(400).json({ success: false, message: '"isOpen" must be a boolean.' });
    }
    if (isOpen === undefined && closeTomorrow === undefined) {
      return res.status(400).json({ success: false, message: 'Provide "isOpen" or "closeTomorrow".' });
    }

    const moment = require('moment-timezone');
    const update = { lastUpdatedBy: req.user._id, updatedAt: new Date() };
    if (message !== undefined) update.message = message;

    if (closeTomorrow === true) {
      // Date-scoped: close only tomorrow, keep restaurant open today
      update.isOpen = true;
      update.closedDate = moment.tz('Asia/Kolkata').startOf('day').add(1, 'day').toDate();
    } else if (closeTomorrow === false) {
      // Clear date-scoped close only (do not touch isOpen)
      update.closedDate = null;
    } else {
      // Global toggle (existing behaviour)
      update.isOpen = isOpen;
      update.closedDate = null; // clear any date-scoped close
    }

    const status = await RestaurantStatus.findOneAndUpdate(
      {},
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    let stateLabel;
    if (closeTomorrow === true) stateLabel = 'CLOSED TOMORROW';
    else if (closeTomorrow === false) stateLabel = 'TOMORROW CLOSE CLEARED';
    else stateLabel = isOpen ? 'OPEN' : 'CLOSED';

    console.log(`🏪 [RESTAURANT] Status changed to ${stateLabel} by ${req.user.name}`);

    // Log the action — fire-and-forget, must not block response
    OwnerAuditLog.logAction(req.user._id, 'restaurant_toggle', null, { isOpen: status.isOpen, closeTomorrow, message }).catch(() => {});

    // Broadcast to ALL connected clients (customers + owner panel)
    socketService.emitRestaurantStatusUpdated({
      isOpen:     status.isOpen,
      closedDate: status.closedDate || null,
      message:    status.message || null,
      updatedBy:  req.user.name,
      updatedAt:  status.updatedAt,
    });

    res.status(200).json({
      success: true,
      message: `Restaurant is now ${stateLabel}.`,
      data: {
        isOpen:     status.isOpen,
        closedDate: status.closedDate || null,
        message:    status.message || null,
        updatedAt:  status.updatedAt,
      },
    });
  } catch (error) {
    console.error('Toggle restaurant status error:', error);
    res.status(500).json({ success: false, message: 'Error updating restaurant status', error: error.message });
  }
};
