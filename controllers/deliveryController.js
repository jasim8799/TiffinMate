const Delivery = require('../models/Delivery');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const MealOrder = require('../models/MealOrder');
const smsService = require('../services/smsService');
const socketService = require('../services/socketService');
const { notifyDeliveryStatus } = require('../services/deliveryNotificationService');
const DeliveryStateMachine = require('../services/deliveryStateMachine');
const { aggregateKitchenData } = require('../services/kitchenAggregatorService');
const moment = require('moment-timezone');
const { getActiveUserIds } = require('../utils/activeUserHelper');
const { getISTDayBounds, getISTNow, isCutoffPassed, normaliseDeliveryDate } = require('../utils/dateService');
const { ensureDefaultMealsForDate } = require('../services/defaultMealService');

// @desc    Create delivery
// @route   POST /api/deliveries
// @access  Private (Owner only)
exports.createDelivery = async (req, res) => {
  try {
    const { userId, subscriptionId, deliveryDate, mealType, meals } = req.body;

    // ✅ NORMALIZE DATE: Always use IST start of day for consistency
    const normalizedDate = moment(deliveryDate).tz('Asia/Kolkata').startOf('day').toDate();

    // ✅ GUARD: Prevent creating delivery for skipped meals
    const skippedMealOrder = await MealOrder.findOne({
      user: userId,
      deliveryDate: normalizedDate,
      'selectedMeal.isSkip': true
    });

    if (skippedMealOrder) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create delivery for skipped meal'
      });
    }

    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription || subscription.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'No active subscription found'
      });
    }

    // Use upsert: update if exists, insert if not
    const delivery = await Delivery.findOneAndUpdate(
      { user: userId, deliveryDate: normalizedDate },
      {
        user: userId,
        subscription: subscriptionId,
        deliveryDate: normalizedDate,
        mealType,
        meals,
        status: 'preparing'
      },
      { upsert: true, new: true }
    );

    res.status(201).json({
      success: true,
      message: 'Delivery created successfully',
      data: delivery
    });
  } catch (error) {
    console.error('Create delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating delivery',
      error: error.message
    });
  }
};

// @desc    Update delivery status (OWNER-CONTROLLED ONLY — no cron auto-update)
// @route   PATCH /api/deliveries/:id/status
// @access  Private (Owner only — NEVER auto, NEVER cron)
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status } = req.body;

    // ── State machine validation ─────────────────────────────────
    if (!DeliveryStateMachine.isValidStatus(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status "${status}". Allowed: ${DeliveryStateMachine.allStatuses().join(', ')}`,
      });
    }

    const delivery = await Delivery.findById(req.params.id)
      .populate('user', 'name mobile role')
      .populate('subscription');

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    // Guard: no-op if already at target status
    if (delivery.status === status) {
      return res.status(200).json({
        success: true,
        message: 'Status already set — no update needed',
        data: delivery,
      });
    }

    // ── Enforce valid state transition ───────────────────────────
    try {
      DeliveryStateMachine.validateTransition(delivery.status, status);
    } catch (transitionError) {
      return res.status(400).json({
        success: false,
        message: transitionError.message,
        allowedNext: DeliveryStateMachine.nextAllowedStatuses(delivery.status),
      });
    }

    // ── Apply status update ──────────────────────────────────────
    await delivery.updateStatus(status);
    await delivery.populate('user');
    await notifyDeliveryStatus(delivery, status);

    if (status === 'on-the-way' && req.body.deliveryBoyId) {
      delivery.deliveryBoy = req.body.deliveryBoyId;
      await delivery.save();
    }

    if (status === 'delivered' && delivery.subscription) {
      try { await delivery.subscription.markDayUsed(); } catch (_) { /* non-fatal */ }
    }

    // ── Emit real-time event (user:id room + owners room) ───────
    socketService.emitDeliveryStatusUpdated({
      deliveryId:   delivery._id,
      userId:       delivery.user._id,
      userName:     delivery.user.name,
      status:       delivery.status,
      mealType:     delivery.mealType,
      deliveryDate: delivery.deliveryDate,
      updatedAt:    new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Delivery status updated successfully',
      data: delivery,
    });
  } catch (error) {
    console.error('Update delivery status error:', error);
    res.status(500).json({ success: false, message: 'Error updating delivery status', error: error.message });
  }
};

// @desc    Get today's deliveries
// @route   GET /api/deliveries/today
// @access  Private (Owner, Delivery)
exports.getTodaysDeliveries = async (req, res) => {
  try {
    const { startUTC: today, nextDayStartUTC: tomorrow } = getISTDayBounds();

    // Get active users only
    const activeUserIds = await User.find({ 
      role: 'customer', 
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    const deliveries = await Delivery.find({
      deliveryDate: { $gte: today, $lt: tomorrow },
      user: { $in: activeUserIds }
    })
      .populate('user', 'name mobile address')
      .populate('deliveryBoy', 'name mobile')
      .sort({ status: 1, createdAt: 1 });

    res.status(200).json({
      success: true,
      count: deliveries.length,
      data: deliveries
    });
  } catch (error) {
    console.error('Get today deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deliveries',
      error: error.message
    });
  }
};

// @desc    Get user's deliveries (calendar)
// @route   GET /api/deliveries/user/:userId
// @access  Private
exports.getUserDeliveries = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = { user: req.params.userId };

    if (startDate && endDate) {
      filter.deliveryDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const deliveries = await Delivery.find(filter)
      .populate('deliveryBoy', 'name mobile')
      .sort({ deliveryDate: -1 });

    res.status(200).json({
      success: true,
      count: deliveries.length,
      data: deliveries
    });
  } catch (error) {
    console.error('Get user deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deliveries',
      error: error.message
    });
  }
};

// @desc    Get my deliveries
// @route   GET /api/deliveries/my
// @access  Private (Customer)
exports.getMyDeliveries = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = { user: req.user._id };

    if (startDate && endDate) {
      filter.deliveryDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const deliveries = await Delivery.find(filter)
      .populate('deliveryBoy', 'name mobile')
      .sort({ deliveryDate: -1 });

    res.status(200).json({
      success: true,
      count: deliveries.length,
      data: deliveries
    });
  } catch (error) {
    console.error('Get my deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deliveries',
      error: error.message
    });
  }
};

// @desc    Get today's delivery for current user
// @route   GET /api/deliveries/my-today
// @access  Private (Customer)
//
// SOURCE OF TRUTH FOR STATUS: Delivery collection (owner sets status).
// MealOrder tells us WHAT was ordered; Delivery tells us WHERE it is.
exports.getMyTodayDelivery = async (req, res) => {
  try {
    const { startUTC: today, nextDayStartUTC: tomorrow } = getISTDayBounds();

    // ── 1. Check meal orders for today ─────────────────────────
    const mealOrders = await MealOrder.find({
      user:         req.user._id,
      deliveryDate: { $gte: today, $lt: tomorrow },
      status:       { $ne: 'cancelled' },
      'selectedMeal.isSkip': { $ne: true },
    }).sort({ mealType: 1 }).lean();

    if (mealOrders.length === 0) {
      return res.status(404).json({ success: false, message: 'No meals scheduled for today' });
    }

    // ── 2. Get delivery status from Delivery collection ─────────
    const deliveries = await Delivery.find({
      user:         req.user._id,
      deliveryDate: { $gte: today, $lt: tomorrow },
    }).lean();

    // Map mealType → delivery status
    const deliveryStatusMap = {};
    for (const d of deliveries) {
      deliveryStatusMap[d.mealType] = d.status;
    }

    // Determine overall status (best single status for display)
    const statusPriority = ['on-the-way', 'preparing', 'delivered', 'paused'];
    let overallStatus = 'preparing'; // default if delivery doc not yet created
    for (const priority of statusPriority) {
      if (deliveries.some(d => d.status === priority)) {
        overallStatus = priority;
        break;
      }
    }

    console.log(`📦 [MY TODAY DELIVERY] User ${req.user._id}: ${mealOrders.length} orders, overall: ${overallStatus}`);

    res.status(200).json({
      success: true,
      data: {
        status:     overallStatus,
        mealOrders: mealOrders.map(order => ({
          mealType:    order.mealType,
          selectedMeal: order.selectedMeal,
          deliveryStatus: deliveryStatusMap[order.mealType] || 'preparing',
          deliveryDate: order.deliveryDate,
        })),
      },
    });
  } catch (error) {
    console.error('Get today delivery error:', error);
    res.status(500).json({ success: false, message: "Error fetching today's delivery", error: error.message });
  }
};

// @desc    Get kitchen summary — accurate meal counts, veg/nonveg, ingredients
// @route   GET /api/deliveries/kitchen-summary?date=YYYY-MM-DD
// @access  Private (Owner)
//
// CRITICAL: Always queries TODAY IST (never flips to tomorrow after cutoff).
// At midnight IST, "today" naturally becomes the new day.
// If ?date param is provided, queries that specific IST date instead.
exports.getKitchenSummary = async (req, res) => {
  try {
    const { date } = req.query;

    // Parse target date — defaults to today IST
    let targetDate;
    if (date) {
      targetDate = moment.tz(date, 'YYYY-MM-DD', 'Asia/Kolkata').startOf('day').toDate();
      if (!moment(targetDate).isValid()) {
        return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
      }
    }

    // Ensure default meals exist for the target date if after cutoff
    const resolvedDate = targetDate || getISTNow().startOf('day').toDate();
    if (isCutoffPassed()) {
      await ensureDefaultMealsForDate(resolvedDate);
    }

    // Run the full aggregation
    const report = await aggregateKitchenData(resolvedDate);

    res.status(200).json({
      success: true,
      date:    report.date,
      data:    report,
    });
  } catch (error) {
    console.error('Get kitchen summary error:', error);
    res.status(500).json({ success: false, message: 'Error fetching kitchen summary', error: error.message });
  }
};

// @desc    Get delivery details
// @route   GET /api/deliveries/:id
// @access  Private
exports.getDelivery = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id)
      .populate('user', 'name mobile address')
      .populate('deliveryBoy', 'name mobile');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    res.status(200).json({
      success: true,
      data: delivery
    });
  } catch (error) {
    console.error('Get delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching delivery',
      error: error.message
    });
  }
};

// @desc    Auto-create deliveries from today's meal orders
// @route   POST /api/deliveries/auto-create-today
// @access  Private (Owner only)
exports.autoCreateTodaysDeliveries = async (req, res) => {
  try {
    const RestaurantStatus = require('../models/RestaurantStatus');

    const status = await RestaurantStatus.findOne();
    if (status && status.isOpen === false) {
      return res.json({
        success: true,
        message: 'Restaurant closed — no deliveries created'
      });
    }

    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const tomorrow = moment().tz('Asia/Kolkata').add(1, 'day').startOf('day').toDate();

    // ✅ CRITICAL: Get ONLY active users (exclude deleted/deactivated)
    const activeUserIds = await getActiveUserIds();

    // Get all confirmed meal orders for today (active users only)
    const mealOrders = await MealOrder.find({
      deliveryDate: { $gte: today, $lt: tomorrow },
      status: 'confirmed',
      user: { $in: activeUserIds },
      'selectedMeal.isSkip': { $ne: true }
    }).populate('user');

    // Group mealOrders by user + deliveryDate
    const groupedOrders = {};
    mealOrders.forEach(order => {
      const key = `${order.user._id}_${order.deliveryDate.toISOString().split('T')[0]}`;
      if (!groupedOrders[key]) {
        groupedOrders[key] = {
          user: order.user,
          deliveryDate: order.deliveryDate,
          orders: []
        };
      }
      groupedOrders[key].orders.push(order);
    });

    let upsertedCount = 0;
    const errors = [];

    for (const key in groupedOrders) {
      const group = groupedOrders[key];
      try {
        // Determine mealType: 'both' if both lunch and dinner, else single
        const mealTypes = new Set(group.orders.map(o => o.mealType));
        let mealType;
        if (mealTypes.has('lunch') && mealTypes.has('dinner')) {
          mealType = 'both';
        } else if (mealTypes.has('lunch')) {
          mealType = 'lunch';
        } else if (mealTypes.has('dinner')) {
          mealType = 'dinner';
        } else {
          mealType = 'both'; // fallback
        }

        // Collect meals
        const meals = {};
        group.orders.forEach(order => {
          if (order.mealType === 'lunch' || order.mealType === 'both') {
            meals.lunch = {
              name: order.selectedMeal?.name || 'Default Meal',
              items: order.selectedMeal?.items || []
            };
          }
          if (order.mealType === 'dinner' || order.mealType === 'both') {
            meals.dinner = {
              name: order.selectedMeal?.name || 'Default Meal',
              items: order.selectedMeal?.items || []
            };
          }
        });

        // Get user's active subscription (take from first order)
        const subscription = await Subscription.findOne({
          user: group.user._id,
          status: 'active',
          startDate: { $lte: group.deliveryDate },
          endDate: { $gte: group.deliveryDate }
        });

        if (!subscription) {
          errors.push(`No active subscription for ${group.user.name}`);
          continue;
        }

        // Combine notes
        const notes = group.orders.map(o => o.notes).filter(n => n).join('; ') || '';

        // Upsert delivery
        await Delivery.findOneAndUpdate(
          { user: group.user._id, deliveryDate: group.deliveryDate },
          {
            user: group.user._id,
            subscription: subscription._id,
            deliveryDate: group.deliveryDate,
            mealType,
            meals,
            status: 'preparing',
            notes
          },
          { upsert: true, new: true }
        );

        upsertedCount++;
      } catch (err) {
        console.error(`Error upserting delivery for user ${group.user._id}:`, err);
        errors.push(`Failed for ${group.user.name}: ${err.message}`);
      }
    }

    res.status(200).json({
      success: true,
      message: `Upserted ${upsertedCount} deliveries`,
      data: {
        upserted: upsertedCount,
        totalGroups: Object.keys(groupedOrders).length,
        errors: errors
      }
    });
  } catch (error) {
    console.error('Auto-create deliveries error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating deliveries',
      error: error.message
    });
  }
};

// @desc    Mark all today's deliveries as out for delivery
// @route   PATCH /api/deliveries/mark-out-for-delivery
// @access  Private (Owner only)
exports.markAllOutForDelivery = async (req, res) => {
  try {
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const tomorrow = moment().tz('Asia/Kolkata').add(1, 'day').startOf('day').toDate();

    // Get active users only
    const activeUserIds = await User.find({ 
      role: 'customer', 
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    // Find all today's deliveries that are preparing
    const deliveries = await Delivery.find({
      deliveryDate: { $gte: today, $lt: tomorrow },
      user: { $in: activeUserIds },
      status: 'preparing'
    }).populate('user', 'name mobile');

    if (deliveries.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No deliveries to mark as out for delivery',
        data: {
          updated: 0
        }
      });
    }

    // Update all deliveries to out-for-delivery
    const updatePromises = deliveries.map(async (delivery) => {
      const previousStatus = delivery.status;

      delivery.status = 'on-the-way';
      delivery.deliveryStatus = 'OUT_FOR_DELIVERY';
      delivery.outForDeliveryTime = new Date();
      await delivery.save();

      await delivery.populate('user');
      // Guard: if delivery was already 'on-the-way', skip notifyDeliveryStatus
      if (previousStatus !== 'on-the-way') {
        await notifyDeliveryStatus(delivery, 'on-the-way');
      }

      return delivery;
    });

    await Promise.all(updatePromises);

    console.log(`✅ Marked ${deliveries.length} deliveries as out for delivery`);

    res.status(200).json({
      success: true,
      message: `Marked ${deliveries.length} deliveries as out for delivery`,
      data: {
        updated: deliveries.length
      }
    });
  } catch (error) {
    console.error('Mark out for delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking deliveries as out for delivery',
      error: error.message
    });
  }
};

// ✅ GET TODAY'S USERS FOR SELECTIVE DELIVERY
exports.getTodayUsers = async (req, res) => {
  try {
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const tomorrow = moment().tz('Asia/Kolkata').add(1, 'day').startOf('day').toDate();

    // Get active users only (non-deleted)
    const activeUserIds = await User.find({ 
      role: 'customer', 
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    // ✅ USE MEALORDER AS SOURCE OF TRUTH
    // Find all today's meal orders that are ready for delivery
    const mealOrders = await MealOrder.find({
      deliveryDate: { $gte: today, $lt: tomorrow },
      user: { $in: activeUserIds },
      status: { $in: ['pending', 'confirmed'] }, // Ready but not yet out for delivery
      'selectedMeal.isSkip': { $ne: true } // Exclude skipped meals
    })
    .select('user mealType')
    .populate('user', 'name mobile address')
    .lean();

    // Group by user and aggregate meals
    const userMap = new Map();

    mealOrders.forEach(order => {
      // ✅ CRITICAL: Ensure user is populated, skip if not
      if (!order.user || !order.user._id) {
        console.warn('⚠️ MealOrder missing user data:', order._id);
        return;
      }

      const userId = order.user._id.toString();
      if (!userMap.has(userId)) {
        // ✅ FLATTEN: All fields at root level, NO NESTED OBJECTS
        userMap.set(userId, {
          userId: String(order.user._id), // Explicit string conversion
          userName: String(order.user.name || 'Unknown'),
          mobile: String(order.user.mobile || 'N/A'),
          address: String(order.user.address || 'N/A'),
          meals: []
        });
      }
      userMap.get(userId).meals.push(order.mealType);
    });

    const userList = Array.from(userMap.values());

    // ✅ DEBUG: Log response structure to verify it's flat
    if (userList.length > 0) {
      console.log('📤 Sample response item:', JSON.stringify(userList[0], null, 2));
    }

    console.log(`📋 [TODAY USERS] Found ${userList.length} users with ${mealOrders.length} meal orders ready for delivery`);

    res.status(200).json({
      success: true,
      data: userList
    });
  } catch (error) {
    console.error('Get today users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching today users',
      error: error.message
    });
  }
};

// ✅ MARK SELECTED USERS AS OUT FOR DELIVERY
exports.markSelectedOutForDelivery = async (req, res) => {
  try {
    const { userIds } = req.body;

    console.log('========================================');
    console.log('[OUT FOR DELIVERY] Request received');
    console.log('Selected User IDs:', userIds);
    console.log('========================================');

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide userIds array'
      });
    }

    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
    const tomorrow = moment().tz('Asia/Kolkata').add(1, 'day').startOf('day').toDate();

    // ✅ USE MEALORDER AS SOURCE OF TRUTH
    // Find today's meal orders for selected users ONLY
    const mealOrders = await MealOrder.find({
      deliveryDate: { $gte: today, $lt: tomorrow },
      user: { $in: userIds },  // ✅ ONLY selected users
      status: { $in: ['pending', 'confirmed'] },
      'selectedMeal.isSkip': { $ne: true } // 🚨 EXCLUDE SKIPPED MEALS
    }).populate('user', 'name mobile');

    console.log(`Found ${mealOrders.length} meal orders for ${userIds.length} selected users`);

    if (mealOrders.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No meal orders found for selected users',
        data: {
          ordersUpdated: 0
        }
      });
    }

    // Update meal orders to out_for_delivery status
    const updatePromises = mealOrders.map(async (order) => {
      console.log(`\n📦 Processing order for user: ${order.user.name} (${order.user._id})`);
      console.log(`   Order ID: ${order._id}`);
      console.log(`   Current Status: ${order.status} → out_for_delivery`);
      
      order.status = 'out_for_delivery';
      await order.save();

      // ✅ EMIT SOCKET EVENT PER USER (Real-time update - TARGETED ONLY)
      console.log(`   📤 Emitting to ONLY user ${order.user._id}: delivery_status_updated`);
      socketService.emitToUser(order.user._id.toString(), 'delivery_status_updated', {
        orderId: order._id,
        userId: order.user._id,
        status: 'out_for_delivery',
        mealType: order.mealType,
        deliveryDate: order.deliveryDate,
        message: '🚚 Your food is on the way!'
      });

      // Send SMS notification
      try {
        await smsService.sendDeliveryOnWay(
          order.user.mobile, 
          order.user.name, 
          order.user._id
        );
      } catch (smsError) {
        console.error('SMS error for user', order.user._id, ':', smsError.message);
      }

      return order;
    });

    await Promise.all(updatePromises);

    // Group by user for reporting
    const uniqueUserIds = [...new Set(mealOrders.map(o => o.user._id.toString()))];

    console.log('\n========================================');
    console.log('✅ OUT FOR DELIVERY COMPLETE');
    console.log(`Updated users: ${uniqueUserIds.join(', ')}`);
    console.log(`Total orders updated: ${mealOrders.length}`);
    console.log('❌ NO BROADCAST - Only selected users notified');
    console.log('========================================\n');

    console.log(`✅ [OUT FOR DELIVERY] Updated ${mealOrders.length} meal orders for ${uniqueUserIds.length} users`);

    res.status(200).json({
      success: true,
      message: `Marked ${mealOrders.length} meal orders as out for delivery for ${uniqueUserIds.length} users`,
      data: {
        deliveriesUpdated: uniqueUserIds.length,
        ordersUpdated: mealOrders.length
      }
    });
  } catch (error) {
    console.error('Mark selected out for delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking selected deliveries',
      error: error.message
    });
  }
};

// ============================================================
// PHASE 16B — QUICK DELIVERY STATUS UPDATE (by user + date + mealType)
// ============================================================

// @desc    Update delivery status by userId + date + mealType (for owner quick panel)
// @route   PATCH /api/deliveries/update-by-user
// @access  Private (Owner only)
exports.updateDeliveryByUser = async (req, res) => {
  try {
    const { userId, date, mealType, status } = req.body;

    if (!userId || !date || !mealType || !status) {
      return res.status(400).json({
        success: false,
        message: 'userId, date, mealType, and status are all required.',
      });
    }

    if (!DeliveryStateMachine.isValidStatus(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status "${status}". Allowed: ${DeliveryStateMachine.allStatuses().join(', ')}`,
      });
    }

    // Normalise to IST start-of-day UTC for DB lookup
    const deliveryDate = normaliseDeliveryDate(date);

    // ── Only affects the matching IST date ─────────────────────
    const delivery = await Delivery.findOne({ user: userId, deliveryDate, mealType })
      .populate('user', 'name mobile role')
      .populate('subscription');

    if (!delivery) {
      // Try to find without mealType restriction (delivery might cover 'both')
      const broadDelivery = await Delivery.findOne({ user: userId, deliveryDate })
        .populate('user', 'name mobile role')
        .populate('subscription');

      if (!broadDelivery) {
        return res.status(404).json({
          success: false,
          message: `No delivery found for user ${userId} on ${date}. Create delivery first.`,
        });
      }
    }

    const targetDelivery = delivery || await Delivery.findOne({ user: userId, deliveryDate })
      .populate('user', 'name mobile role')
      .populate('subscription');

    if (targetDelivery.status === status) {
      return res.status(200).json({ success: true, message: 'Status already set', data: targetDelivery });
    }

    // Validate state transition
    try {
      DeliveryStateMachine.validateTransition(targetDelivery.status, status);
    } catch (transitionError) {
      return res.status(400).json({
        success: false,
        message: transitionError.message,
        allowedNext: DeliveryStateMachine.nextAllowedStatuses(targetDelivery.status),
      });
    }

    await targetDelivery.updateStatus(status);
    await targetDelivery.populate('user');

    // Sync delivery status into MealOrder documents (raw $set bypasses enum — non-fatal)
    try {
      const mealTypeFilter = targetDelivery.mealType && targetDelivery.mealType !== 'both'
        ? { mealType: targetDelivery.mealType }
        : {};
      await MealOrder.collection.updateMany(
        {
          user:         targetDelivery.user._id,
          deliveryDate: targetDelivery.deliveryDate,
          ...mealTypeFilter,
        },
        { $set: { deliveryStatus: status } }
      );
    } catch (_) { /* non-fatal — delivery update already succeeded */ }

    // Notify user + owner via socket
    const payload = {
      deliveryId:   targetDelivery._id,
      userId:       targetDelivery.user._id,
      userName:     targetDelivery.user.name,
      status:       targetDelivery.status,
      mealType:     targetDelivery.mealType,
      deliveryDate: targetDelivery.deliveryDate,
      updatedAt:    new Date(),
    };
    socketService.emitDeliveryStatusUpdated(payload);

    // Send SMS notification
    try { await notifyDeliveryStatus(targetDelivery, status); } catch (_) { /* non-fatal */ }

    res.status(200).json({
      success: true,
      message: `Delivery status updated to "${status}" successfully.`,
      data: targetDelivery,
    });
  } catch (error) {
    console.error('Update delivery by user error:', error);
    res.status(500).json({ success: false, message: 'Error updating delivery status', error: error.message });
  }
};
