const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const AppNotification = require('../models/AppNotification');
const moment = require('moment');
const { createNotification } = require('./notificationController');
const socketService = require('../services/socketService');
const { getUserMutex } = require('../utils/userMutex');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { activateOrExtendSubscription } = require('../utils/subscriptionUtils');

/**
 * PAYMENT STATUS DEFINITIONS (IMPORTANT)
 *
 * pending   → Payment created, awaiting owner / gateway action
 * paid      → Money received (cash received OR gateway confirmed)
 * verified  → Owner/admin explicitly verified payment
 * rejected  → Owner rejected payment (NO side effects)
 * failed    → Gateway failure or invalid payment
 *
 * RULES:
 * - Meal orders may be created on: paid OR verified
 * - Subscriptions activate on: paid OR verified
 * - rejected / failed MUST NEVER create side effects
 */





// Helper function to normalize meal to object format
function normalizeDailyMeal(meal) {
  if (!meal) return null;

  // already object
  if (typeof meal === 'object') {
    return {
      name: meal.name || '',
      items: Array.isArray(meal.items) ? meal.items : (meal.name ? [meal.name] : []),
      isSkip: false,
      isDefault: false
    };
  }

  // string → convert to object
  return {
    name: meal,
    items: [meal],
    isSkip: false,
    isDefault: false
  };
}

// Helper function to create daily meal orders from payment metadata (FIXED)
async function createDailyMealOrdersFromPayment(payment) {
  const MealOrder = require('../models/MealOrder');
  const { getISTDayRange, getCutoffTimeForDate } = require('../utils/deliveryDateHelper');

  if (!['paid', 'verified'].includes(payment.status)) return;

  const { lunch, dinner, pricePerMeal } = payment.metadata || {};

  const { start } = getISTDayRange(payment.deliveryDate);

  const normalizedLunch = normalizeDailyMeal(lunch);
  const normalizedDinner = normalizeDailyMeal(dinner);

  if (normalizedLunch) {
    await MealOrder.findOneAndUpdate(
      {
        user: payment.user,
        deliveryDate: start,
        mealType: 'lunch',
        orderSource: 'daily'
      },
      {
        $setOnInsert: {
          selectedMeal: normalizedLunch,   // ✅ FIXED
          price: pricePerMeal,
          paymentId: payment._id,
          status: 'confirmed',
          orderDate: new Date(),
          cutoffTime: getCutoffTimeForDate(start)
        }
      },
      { upsert: true }
    );
  }

  if (normalizedDinner) {
    await MealOrder.findOneAndUpdate(
      {
        user: payment.user,
        deliveryDate: start,
        mealType: 'dinner',
        orderSource: 'daily'
      },
      {
        $setOnInsert: {
          selectedMeal: normalizedDinner,  // ✅ FIXED
          price: pricePerMeal,
          paymentId: payment._id,
          status: 'confirmed',
          orderDate: new Date(),
          cutoffTime: getCutoffTimeForDate(start)
        }
      },
      { upsert: true }
    );
  }
}

// UPI Configuration
const UPI_CONFIG = {
  upiId: process.env.UPI_ID || 'thehomekitchen@upi',
  name: process.env.UPI_NAME || 'The Home Kitchen'
};

// Razorpay Configuration
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ====================================
// RAZORPAY ENDPOINTS
// ====================================

// @desc    Create Razorpay Order
// @route   POST /api/payments/razorpay/create-order
// @access  Private (Customer only)
exports.createRazorpayOrder = async (req, res) => {
  try {
    const { subscriptionId, paymentId } = req.body;

    let payment;
    let amount;
    if (paymentId) {
      payment = await Payment.findById(paymentId);
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found'
        });
      }
      if (payment.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Invalid payment'
        });
      }
      amount = payment.amount;
    } else if (subscriptionId) {
      // Fetch subscription and get plan price from DB
      const subscription = await Subscription.findById(subscriptionId).populate('plan', 'totalPrice');

      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: 'Subscription not found'
        });
      }

      // Verify subscription belongs to authenticated user
      if (subscription.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Invalid subscription'
        });
      }

      if (!subscription.plan || !subscription.plan.totalPrice) {
        return res.status(400).json({
          success: false,
          message: 'Subscription plan price not found'
        });
      }

      // Use plan price from DB, never trust frontend amount
      amount = subscription.plan.totalPrice;

      // Create payment for subscription
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const query = {
        user: req.user._id,
        paymentFor: 'subscription',
        status: 'pending',
        month: currentMonth,
        year: currentYear,
        subscription: subscriptionId
      };

      const existingPayment = await Payment.findOne(query);

      if (existingPayment) {
        return res.status(200).json({
          success: true,
          message: 'Existing payment request found.',
          paymentId: existingPayment._id
        });
      }

      payment = await Payment.create({
        user: req.user._id,
        subscription: subscriptionId,
        paymentFor: 'subscription',
        amount,
        month: currentMonth,
        year: currentYear,
        paymentMethod: 'online',
        paymentGateway: 'RAZORPAY',
        status: 'pending'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either subscriptionId or paymentId is required'
      });
    }

    // Create Razorpay order
    const isRazorpayConfigured = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;

    if (!isRazorpayConfigured) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay not configured'
      });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // paise
      currency: 'INR',
      receipt: paymentId ? `daily_${paymentId}` : `sub_${subscriptionId}`
    });

    // Update payment with razorpayOrderId
    payment.razorpayOrderId = order.id;
    await payment.save();

    res.json({
      success: true,
      order,
      paymentId: payment._id
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Handle Razorpay Webhook
// @route   POST /api/payments/webhook/razorpay
// @access  Public (Webhook endpoint - no auth required)
exports.handleRazorpayWebhook = async (req, res) => {
  try {
    const webhookId = req.headers['x-razorpay-webhook-id'] || req.body.webhookId;
    const event = req.body.event;
    const paymentEntity = req.body.payload?.payment?.entity;

    console.log('🔗 RAZORPAY WEBHOOK RECEIVED:', {
      webhookId,
      event,
      paymentId: paymentEntity?.id,
      orderId: paymentEntity?.order_id,
      status: paymentEntity?.status,
      amount: paymentEntity?.amount
    });

    // WEBHOOK IDEMPOTENCY: Check if this webhook was already processed
    if (webhookId) {
      const existingWebhook = await Payment.findOne({
        webhookId: webhookId,
        webhookProcessedAt: { $exists: true }
      });

      if (existingWebhook) {
        console.log(`⚠️  WEBHOOK ALREADY PROCESSED: ${webhookId} - Ignoring duplicate`);
        return res.status(200).json({ success: true, message: 'Webhook already processed' });
      }
    }

    // Only process payment.captured events
    if (event !== 'payment.captured') {
      console.log(`ℹ️  IGNORING WEBHOOK EVENT: ${event} - Not payment.captured`);
      return res.status(200).json({ success: true, message: 'Event ignored' });
    }

    // Validate webhook data
    if (!paymentEntity || !paymentEntity.order_id) {
      console.log('❌ INVALID WEBHOOK PAYLOAD: Missing payment entity or order_id');
      return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
    }

    // Find payment by Razorpay order ID
    const payment = await Payment.findOne({
      razorpayOrderId: paymentEntity.order_id
    }).populate('user', 'name mobile userId').populate('subscription');

    if (!payment) {
      console.log(`❌ PAYMENT NOT FOUND: No payment with order_id ${paymentEntity.order_id}`);
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // NEVER TRUST FRONTEND STATUS - Only update based on actual gateway confirmation
    if (payment.status === 'paid') {
      console.log(`⚠️  PAYMENT ALREADY PROCESSED: ${payment._id} - Status is already 'paid'`);
      // Still mark webhook as processed to prevent future duplicates
      await Payment.findByIdAndUpdate(payment._id, {
        webhookId,
        webhookProcessedAt: new Date()
      });
      return res.status(200).json({ success: true, message: 'Payment already processed' });
    }

    console.log(`✅ PROCESSING PAYMENT: ${payment._id} for user ${payment.user?.name}`);

    // Update payment with webhook data
    payment.status = 'paid';
    payment.razorpayPaymentId = paymentEntity.id;
    payment.paidAt = new Date(paymentEntity.created_at * 1000); // Convert Unix timestamp
    payment.receivedAt = new Date();
    payment.webhookId = webhookId;
    payment.webhookProcessedAt = new Date();

    // Legacy fields
    payment.paidAmount = payment.amount;

    await payment.save();

    console.log(`✅ PAYMENT UPDATED: ${payment._id} - Status: paid`);

    // AUTO-ACTIVATE SUBSCRIPTION (CRITICAL) - Using shared utility function
    if (payment.subscription) {
      await activateOrExtendSubscription(payment.subscription, payment);
      await payment.subscription.save();

      console.log(`✅ SUBSCRIPTION ACTIVATED: ${payment.subscription._id} - Status: active`);

      // Create subscription activated notification
      try {
        await AppNotification.createNotification({
          type: 'subscription_activated',
          title: 'Subscription Activated',
          message: `${payment.user.name}'s subscription is now active until ${moment(payment.subscription.endDate).format('DD MMM YYYY')}`,
          relatedUser: payment.user._id,
          relatedModel: 'Subscription',
          relatedId: payment.subscription._id,
          priority: 'high',
          metadata: {
            subscriptionId: payment.subscription._id,
            startDate: payment.subscription.startDate,
            endDate: payment.subscription.endDate,
            paymentId: payment._id,
            source: 'webhook'
          }
        });
      } catch (notifError) {
        console.error('Failed to create subscription notification:', notifError);
      }

      // Emit subscription activated event to user
      socketService.emitSubscriptionUpdated({
        _id: payment.subscription._id,
        user: payment.user._id,
        planType: payment.subscription.planType,
        status: 'active',
        startDate: payment.subscription.startDate,
        endDate: payment.subscription.endDate,
        remainingDays: payment.subscription.remainingDays
      });

      // Emit notification to user
      socketService.emitNotification({
        userId: payment.user._id,
        type: 'subscription_activated',
        title: 'Subscription Activated!',
        message: `Your subscription is now active. You can start ordering meals.`,
        priority: 'high'
      });
    }

    // Create payment received notification
    try {
      await AppNotification.createNotification({
        type: 'payment_received',
        title: 'Payment Received',
        message: `ONLINE payment of ₹${payment.amount} received from ${payment.user.name} (via webhook)`,
        relatedUser: payment.user._id,
        relatedModel: 'Payment',
        relatedId: payment._id,
        priority: 'medium',
        metadata: {
          amount: payment.amount,
          paymentMethod: payment.paymentMethod,
          source: 'webhook'
        }
      });
    } catch (notifError) {
      console.error('Failed to create payment notification:', notifError);
    }

    // Emit payment received event
    socketService.emitPaymentReceived({
      _id: payment._id,
      user: payment.user._id,
      amount: payment.amount,
      status: 'paid',
      paymentMethod: payment.paymentMethod,
      receivedAt: payment.receivedAt
    });

    // Emit notification to user about payment received
    socketService.emitNotification({
      userId: payment.user._id,
      type: 'payment_received',
      title: 'Payment Received',
      message: `Your ONLINE payment of ₹${payment.amount} has been received`,
      priority: 'medium'
    });

    socketService.emitPaymentVerified(payment);

    console.log(`✅ WEBHOOK PROCESSED SUCCESSFULLY: ${webhookId}`);
    res.status(200).json({ success: true, message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('❌ RAZORPAY WEBHOOK ERROR:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
};

// @desc    Verify Razorpay Payment
// @route   POST /api/payments/razorpay/verify
// @access  Private (Customer only)
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      paymentId
    } = req.body;

    // Find payment first to check if already processed
    const payment = await Payment.findById(paymentId).populate('user', 'name mobile userId').populate('subscription');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Check if payment is already paid
    if (payment.status === 'paid') {
      return res.json({ success: true, message: 'Payment already verified' });
    }

    // Validate that payment.razorpayOrderId matches razorpay_order_id
    if (payment.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Razorpay order mismatch'
      });
    }

    // Signature verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    // Update payment
    payment.status = 'paid';
    payment.razorpayPaymentId = razorpay_payment_id;
    payment.razorpaySignature = razorpay_signature;
    payment.paidAt = new Date();
    payment.receivedAt = new Date();
    await payment.save();

    // ACTIVATE SUBSCRIPTION (if payment is for subscription)
    if (payment.subscription) {
      await activateOrExtendSubscription(payment.subscription, payment);
      await payment.subscription.save();

      // Create subscription activated notification
      try {
        await AppNotification.createNotification({
          type: 'subscription_activated',
          title: 'Subscription Activated',
          message: `${payment.user.name}'s subscription is now active until ${moment(payment.subscription.endDate).format('DD MMM YYYY')}`,
          relatedUser: payment.user._id,
          relatedModel: 'Subscription',
          relatedId: payment.subscription._id,
          priority: 'high',
          metadata: {
            subscriptionId: payment.subscription._id,
            startDate: payment.subscription.startDate,
            endDate: payment.subscription.endDate,
            paymentId: payment._id
          }
        });
      } catch (notifError) {
        console.error('Failed to create subscription notification:', notifError);
      }

      // Emit subscription activated event to user
      socketService.emitSubscriptionUpdated({
        _id: payment.subscription._id,
        user: payment.user._id,
        planType: payment.subscription.planType,
        status: 'active',
        startDate: payment.subscription.startDate,
        endDate: payment.subscription.endDate,
        remainingDays: payment.subscription.remainingDays
      });

      // Emit notification to user
      socketService.emitNotification({
        userId: payment.user._id,
        type: 'subscription_activated',
        title: 'Subscription Activated!',
        message: `Your subscription is now active. You can start ordering meals.`,
        priority: 'high'
      });
    }

    // Create payment received notification
    try {
      await AppNotification.createNotification({
        type: 'payment_received',
        title: 'Payment Received',
        message: `ONLINE payment of ₹${payment.amount} received from ${payment.user.name}`,
        relatedUser: payment.user._id,
        relatedModel: 'Payment',
        relatedId: payment._id,
        priority: 'medium',
        metadata: {
          amount: payment.amount,
          paymentMethod: payment.paymentMethod
        }
      });
    } catch (notifError) {
      console.error('Failed to create payment notification:', notifError);
    }

    // Emit payment received event
    socketService.emitPaymentReceived({
      _id: payment._id,
      user: payment.user._id,
      amount: payment.amount,
      status: 'paid',
      paymentMethod: payment.paymentMethod,
      receivedAt: payment.receivedAt
    });

    // Emit notification to user about payment received
    socketService.emitNotification({
      userId: payment.user._id,
      type: 'payment_received',
      title: 'Payment Received',
      message: `Your ONLINE payment of ₹${payment.amount} has been received`,
      priority: 'medium'
    });

    socketService.emitPaymentVerified(payment);

    res.json({
      success: true,
      message: 'Payment verified successfully'
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// USER ENDPOINTS (Customer)
// ====================================

// @desc    Create payment (User initiates payment)
// @route   POST /api/payments/create
// @access  Private (Customer only)
exports.createPayment = async (req, res) => {
  try {
    const { subscriptionId, paymentFor = 'subscription', referenceNote, paymentMethod = 'cash' } = req.body;

    // For daily meals, subscriptionId is not required
    if (paymentFor === 'subscription' && !subscriptionId) {
      return res.status(400).json({
        success: false,
        message: 'Subscription ID is required for subscription payments'
      });
    }

    if (paymentFor === 'daily_meal' && subscriptionId) {
      return res.status(400).json({
        success: false,
        message: 'Subscription ID should not be provided for daily meal payments'
      });
    }

    // Validate payment method
    if (!['cash', 'upi', 'online', 'other'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method. Must be: cash, upi, online, or other'
      });
    }

    let amount;

    if (paymentFor === 'subscription') {
      // Validate subscription exists and belongs to user, populate plan to get price
      const subscription = await Subscription.findById(subscriptionId).populate('plan', 'totalPrice');

      if (!subscription) {
        return res.status(404).json({
          success: false,
          message: 'Subscription not found'
        });
      }

      // Verify subscription belongs to authenticated user
      if (subscription.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Invalid subscription'
        });
      }

      if (!subscription.plan || !subscription.plan.totalPrice) {
        return res.status(400).json({
          success: false,
          message: 'Subscription plan price not found'
        });
      }

      // Use plan price from DB, never trust frontend amount
      amount = subscription.plan.totalPrice;
    } else if (paymentFor === 'daily_meal') {
      const { metadata } = req.body;
      if (!metadata || (!metadata.lunch && !metadata.dinner)) {
        return res.status(400).json({
          success: false,
          message: 'Metadata with lunch or dinner is required for daily meal payments'
        });
      }

      const deliveryDate = require('../utils/deliveryDateHelper').getDeliveryDateByOffset(0).toDate();
      const { start, end } = require('../utils/deliveryDateHelper').getISTDayRange(deliveryDate);

      // ✅ GLOBAL RESTAURANT CLOSE GUARD — block daily meal payment when restaurant is closed
      {
        const RestaurantStatus = require('../models/RestaurantStatus');
        const momentTz = require('moment-timezone');
        const { getNextOrderableDeliveryMoment } = require('../utils/deliveryDateHelper');
        const restaurantStatus = await RestaurantStatus.findOne();
        if (restaurantStatus) {
          if (restaurantStatus.isOpen === false) {
            return res.status(403).json({
              success: false,
              message: 'Restaurant is closed for this delivery date'
            });
          }
          if (restaurantStatus.closedDate) {
            const closedDay = momentTz.tz(restaurantStatus.closedDate, 'Asia/Kolkata').startOf('day');
            const effectiveDay = getNextOrderableDeliveryMoment().startOf('day');
            if (closedDay.isSame(effectiveDay, 'day')) {
              return res.status(403).json({
                success: false,
                message: 'Restaurant is closed for this delivery date'
              });
            }
          }
        }
      }

      // 🔒 CRITICAL: Check for ANY existing payment (pending, paid, or verified) using date range
      const existingPayment = await Payment.findOne({
        user: req.user._id,
        paymentFor: 'daily_meal',
        status: { $in: ['pending', 'paid', 'verified'] },
        deliveryDate: { $gte: start, $lte: end }
      });

      if (existingPayment) {
        // Determine appropriate message based on status
        const statusMessage = existingPayment.status === 'pending'
          ? 'Payment already pending for this date'
          : 'Payment already completed for this date';
        
        console.log(`🔒 DUPLICATE PREVENTION: Blocking duplicate payment for user ${req.user._id}. Existing status: ${existingPayment.status}`);

        // Return 409 Conflict - don't create duplicate
        return res.status(409).json({
          success: false,
          message: statusMessage,
          data: {
            existingPaymentId: existingPayment._id,
            status: existingPayment.status,
            reason: 'Only one active payment allowed per delivery date'
          }
        });
      }

      // Calculate amount
      const { lunch, dinner, pricePerMeal = 80 } = metadata;
      let amount = 0;
      if (lunch) amount += pricePerMeal;
      if (dinner) amount += pricePerMeal;

      if (amount === 0) {
        return res.status(400).json({
          success: false,
          message: 'No meals selected'
        });
      }

      // Create payment
      const payment = await Payment.create({
        user: req.user._id,
        amount,
        paymentFor: 'daily_meal',
        deliveryDate,
        status: 'pending',
        paymentMethod: paymentMethod,
        paymentGateway: paymentMethod === 'online' ? 'RAZORPAY' : null,
        metadata,
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1
      });

      // Return
      return res.status(201).json({
        success: true,
        message: 'Payment request created successfully.',
        data: {
          paymentId: payment._id,
          amount,
          paymentMethod,
          status: 'pending'
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid paymentFor. Must be: subscription or daily_meal'
      });
    }

    // ========================================
    // IDEMPOTENCY GUARD: Check for existing pending payment
    // ========================================
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    const query = {
      user: req.user._id,
      paymentFor,
      status: 'pending'
    };

    if (paymentFor === 'subscription') {
      query.month = currentMonth;
      query.year = currentYear;
      query.subscription = subscriptionId;
    } else if (paymentFor === 'daily_meal') {
      query.deliveryDate = require('../utils/deliveryDateHelper').getDeliveryDateByOffset(0).toDate();
    }

    const existingPayment = await Payment.findOne(query);

    if (existingPayment) {
      console.log(`💰 IDEMPOTENCY: Returning existing pending payment ${existingPayment._id} for user ${req.user._id}, subscription ${subscriptionId}`);

      // Return existing payment data
      const responseData = {
        paymentId: existingPayment._id,
        amount: existingPayment.amount,
        paymentMethod: existingPayment.paymentMethod,
        status: existingPayment.status
      };

      let message = 'Existing payment request found.';

      // Add UPI data only for UPI payments
      if (existingPayment.paymentMethod === 'upi') {
        const upiLink = `upi://pay?pa=${UPI_CONFIG.upiId}&pn=${encodeURIComponent(UPI_CONFIG.name)}&am=${existingPayment.amount}&cu=INR&tn=${encodeURIComponent(existingPayment.referenceNote || 'Payment for meal subscription')}`;
        responseData.upiId = UPI_CONFIG.upiId;
        responseData.name = UPI_CONFIG.name;
        responseData.upiLink = upiLink;
        responseData.qrString = upiLink;
        message = 'Existing UPI payment request found. Please complete the UPI payment.';
      } else if (existingPayment.paymentMethod === 'cash') {
        message = 'Existing cash payment request found. Owner will verify once cash is received.';
      }

      return res.status(200).json({
        success: true,
        message,
        data: responseData
      });
    }

    // Create payment record with month/year for tracking
    const payment = await Payment.create({
      user: req.user._id,
      subscription: subscriptionId,
      paymentFor,
      amount,
      month: currentMonth,
      year: currentYear,
      paymentMethod: paymentMethod,
      status: 'pending',
      referenceNote: referenceNote || '',
      paymentDate: now
    });

    // Structured logging for payment creation
    console.log('PAYMENT_CREATE_LOG:', {
      userId: req.user._id,
      subscriptionId: subscriptionId,
      month: currentMonth,
      year: currentYear,
      amount: amount,
      mode: paymentMethod === 'cash' ? 'manual' : 'gateway'
    });

    // Create notification for owner
    const user = await User.findById(req.user._id);
    await createNotification(
      'PAYMENT_RECEIVED',
      `New payment of ₹${amount} received from ${user?.name || 'customer'}`,
      payment._id,
      'Payment',
      {
        amount: amount,
        customerName: user?.name,
        customerId: user?.userId,
        status: 'pending'
      }
    );

    // Create AppNotification for owner
    try {
      const paymentMethodLabel = paymentMethod === 'cash' ? 'CASH' : paymentMethod.toUpperCase();
      await AppNotification.createNotification({
        type: 'payment_created',
        title: `New ${paymentMethodLabel} Payment`,
        message: `${user?.name} paid ₹${amount} via ${paymentMethodLabel}`,
        relatedUser: req.user._id,
        relatedModel: 'Payment',
        relatedId: payment._id,
        priority: 'high',
        metadata: {
          amount: amount,
          subscriptionId: subscriptionId,
          paymentMethod: paymentMethod
        }
      });

      // Emit notification event
      socketService.emitNotification({
        type: 'payment_created',
        title: 'New Payment',
        message: `₹${amount} from ${user?.name}`,
        priority: 'high'
      });
    } catch (notifError) {
      console.error('Failed to create payment notification:', notifError);
    }

    // Emit real-time payment created event to owner
    socketService.emitPaymentCreated({
      _id: payment._id,
      user: req.user._id,
      subscription: subscriptionId,
      amount: amount,
      status: payment.status,
      customerName: user?.name,
      customerId: user?.userId
    });

    // Response based on payment method
    const responseData = {
      paymentId: payment._id,
      amount,
      paymentMethod: payment.paymentMethod,
      status: payment.status
    };

    let message = 'Payment request created successfully.';

    // Add UPI data only for UPI payments
    if (paymentMethod === 'upi') {
      const upiLink = `upi://pay?pa=${UPI_CONFIG.upiId}&pn=${encodeURIComponent(UPI_CONFIG.name)}&am=${amount}&cu=INR&tn=${encodeURIComponent(referenceNote || 'Payment for meal subscription')}`;
      responseData.upiId = UPI_CONFIG.upiId;
      responseData.name = UPI_CONFIG.name;
      responseData.upiLink = upiLink;
      responseData.qrString = upiLink;
      message = 'Payment created successfully. Please complete the UPI payment.';
    } else if (paymentMethod === 'cash') {
      message = 'Cash payment request submitted. Owner will verify once cash is received.';
    }

    res.status(201).json({
      success: true,
      message,
      data: responseData
    });
  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating payment',
      error: error.message
    });
  }
};

// @desc    Get my payments (User's payment history)
// @route   GET /api/payments/my
// @access  Private (Customer only)
exports.getMyPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.user._id })
      .populate('subscription', 'planType startDate endDate totalDays')
      .populate('verifiedBy', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments
    });
  } catch (error) {
    console.error('Get my payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

// ====================================
// OWNER ENDPOINTS
// ====================================

// @desc    Get pending payments (Awaiting verification)
// @route   GET /api/payments/pending
// @access  Private (Owner only)
exports.getPendingPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ status: 'pending' })
      .populate('user', 'name mobile userId')
      .populate('subscription', 'planType startDate endDate')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments
    });
  } catch (error) {
    console.error('Get pending payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending payments',
      error: error.message
    });
  }
};

// @desc    Mark payment as received (for CASH payments)
// @route   PUT /api/payments/:id/receive
// @access  Private (Owner only)
exports.receivePayment = async (req, res) => {
  try {
    // Get payment to determine target user for mutex
    const targetPayment = await Payment.findById(req.params.id);
    if (!targetPayment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    const targetUserId = targetPayment.user.toString();
    const mutex = getUserMutex(targetUserId);

    // Acquire mutex for the target user
    await mutex.acquire();

    try {
      // Optimistic concurrency control with retries
      let retries = 3;
      let payment;

      while (retries > 0) {
        // Get current payment to check current status and version
        const currentPayment = await Payment.findById(req.params.id)
          .populate('user', 'name mobile userId')
          .populate('subscription');

        if (!currentPayment) {
          return res.status(404).json({
            success: false,
            message: 'Payment not found'
          });
        }

        // Check if payment is already paid
        if (currentPayment.status === 'paid') {
          return res.status(400).json({
            success: false,
            message: 'Payment has already been marked as received'
          });
        }

        // Check if payment is pending
        if (currentPayment.status !== 'pending') {
          return res.status(400).json({
            success: false,
            message: 'Only pending payments can be marked as received'
          });
        }

        // Attempt update with version check
        payment = await Payment.findOneAndUpdate(
          { _id: req.params.id, __v: currentPayment.__v },
          {
            status: 'paid',
            receivedAt: new Date(),
            verifiedBy: req.user._id,
            verifiedAt: new Date(),
            paidAmount: currentPayment.amount
          },
          {
            new: true, // Return updated document
            runValidators: false // Skip validation to avoid issues with legacy data
          }
        ).populate('user', 'name mobile userId')
         .populate('subscription');

        if (payment) {
          break; // Success
        }

        retries--;
        console.log(`⚠️ Payment version conflict, retrying... (${retries} retries left)`);
      }

      if (!payment) {
        console.log('❌ Payment version conflict after retries');
        return res.status(409).json({
          success: false,
          message: 'Version conflict: payment was modified by another request'
        });
      }

    // AUTO-ACTIVATE SUBSCRIPTION (CRITICAL) - Using shared utility function
    if (payment.subscription) {
      await activateOrExtendSubscription(payment.subscription, payment);
      await payment.subscription.save();

      // Create subscription activated notification
      try {
        await AppNotification.createNotification({
          type: 'subscription_activated',
          title: 'Subscription Activated',
          message: `${payment.user.name}'s subscription is now active until ${moment(payment.subscription.endDate).format('DD MMM YYYY')}`,
          relatedUser: payment.user._id,
          relatedModel: 'Subscription',
          relatedId: payment.subscription._id,
          priority: 'high',
          metadata: {
            subscriptionId: payment.subscription._id,
            startDate: payment.subscription.startDate,
            endDate: payment.subscription.endDate,
            paymentId: payment._id
          }
        });
      } catch (notifError) {
        console.error('Failed to create subscription notification:', notifError);
      }

      // Emit subscription activated event to user
      socketService.emitSubscriptionUpdated({
        _id: payment.subscription._id,
        user: payment.user._id,
        planType: payment.subscription.planType,
        status: 'active',
        startDate: payment.subscription.startDate,
        endDate: payment.subscription.endDate,
        remainingDays: payment.subscription.remainingDays
      });

      // Emit notification to user
      socketService.emitNotification({
        userId: payment.user._id,
        type: 'subscription_activated',
        title: 'Subscription Activated!',
        message: `Your subscription is now active. You can start ordering meals.`,
        priority: 'high'
      });
    }

    // Create payment received notification
    const paymentMethodLabel = payment.paymentMethod === 'cash' ? 'CASH' : payment.paymentMethod.toUpperCase();
    
    try {
      await AppNotification.createNotification({
        type: 'payment_received',
        title: 'Payment Received',
        message: `${paymentMethodLabel} payment of ₹${payment.amount} received from ${payment.user.name}`,
        relatedUser: payment.user._id,
        relatedModel: 'Payment',
        relatedId: payment._id,
        priority: 'medium',
        metadata: {
          amount: payment.amount,
          paymentMethod: payment.paymentMethod
        }
      });
    } catch (notifError) {
      console.error('Failed to create payment notification:', notifError);
    }

    // If daily meal payment, create meal orders
    if (payment.paymentFor === 'daily_meal') {
      await createDailyMealOrdersFromPayment(payment);
    }

    // Emit payment received event
    socketService.emitPaymentReceived({
      _id: payment._id,
      user: payment.user._id,
      amount: payment.amount,
      status: 'paid',
      paymentMethod: payment.paymentMethod,
      receivedAt: payment.receivedAt
    });

    // Emit payment verified event for real-time updates
    socketService.emitPaymentVerified(payment);

    // Emit notification to user about payment received
    socketService.emitNotification({
      userId: payment.user._id,
      type: 'payment_received',
      title: 'Payment Received',
      message: `Your ${paymentMethodLabel} payment of ₹${payment.amount} has been received`,
      priority: 'medium'
    });

    const populatedPayment = await Payment.findById(payment._id)
      .populate('user', 'name mobile userId')
      .populate('subscription', 'planType startDate endDate status remainingDays')
      .populate('verifiedBy', 'name');

    res.status(200).json({
      success: true,
      message: 'Payment marked as received and subscription activated',
      data: {
        payment: populatedPayment,
        subscription: populatedPayment.subscription
      }
    });
    } finally {
      // Always release the mutex
      mutex.release();
    }
  } catch (error) {
    console.error('Receive payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing payment',
      error: error.message
    });
  }
};

// @desc    Verify or reject payment
// @route   PUT /api/payments/:id/verify
// @access  Private (Owner only)
exports.verifyPayment = async (req, res) => {
  try {
    // Ensure only owners can verify payments
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only owners can verify payments.'
      });
    }

    const { status } = req.body;

    if (!status || !['paid', 'verified', 'failed', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be one of: paid, verified, failed, rejected'
      });
    }

    const payment = await Payment.findById(req.params.id)
      .populate('subscription');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Prevent illegal status transitions
    const currentStatus = payment.status;
    const allowedTransitions = {
      pending: ['paid', 'verified', 'rejected'],
      paid: ['verified', 'failed'],
      verified: [],
      failed: [],
      rejected: []
    };

    if (!allowedTransitions[currentStatus] || !allowedTransitions[currentStatus].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from '${currentStatus}' to '${status}'. Allowed transitions from '${currentStatus}': ${allowedTransitions[currentStatus]?.join(', ') || 'none'}`
      });
    }

    // Update payment status
    payment.status = status;
    payment.verifiedBy = req.user._id;
    payment.verifiedAt = new Date();
    await payment.save();

    // Explicit guard: rejected payments must NEVER trigger side effects
    if (status === 'rejected') {
      // No side effects for rejected payments
    }

    // Create side effects for paid OR verified
    if (['paid', 'verified'].includes(status) && payment.paymentFor === 'daily_meal') {
      await createDailyMealOrdersFromPayment(payment);
    }

    // Activate subscription for paid OR verified
    if (['paid', 'verified'].includes(status) && payment.subscription) {
      await activateOrExtendSubscription(payment.subscription, payment);
      await payment.subscription.save();
    }

    const populatedPayment = await Payment.findById(payment._id)
      .populate('user', 'name mobile userId')
      .populate('subscription', 'planType startDate endDate status')
      .populate('verifiedBy', 'name');

    // Create notification for owner
    if (status === 'verified') {
      const user = populatedPayment.user;
      const paymentMethodLabel = payment.paymentMethod === 'cash' ? 'CASH' : payment.paymentMethod.toUpperCase();
      
      await createNotification(
        'PAYMENT_VERIFIED',
        `${paymentMethodLabel} payment of ₹${payment.amount} verified for ${user?.name || 'customer'}`,
        payment._id,
        'Payment',
        {
          amount: payment.amount,
          customerName: user?.name,
          customerId: user?.userId,
          paymentMethod: payment.paymentMethod
        }
      );
      
      // Create AppNotification
      try {
        await AppNotification.createNotification({
          type: 'payment_verified',
          title: 'Payment Verified',
          message: `${user?.name} - ₹${payment.amount} ${paymentMethodLabel} payment confirmed`,
          relatedUser: user?._id,
          relatedModel: 'Payment',
          relatedId: payment._id,
          priority: 'medium',
          metadata: {
            amount: payment.amount,
            paymentMethod: payment.paymentMethod,
            subscriptionId: populatedPayment.subscription?._id
          }
        });
      } catch (notifError) {
        console.error('Failed to create payment verified notification:', notifError);
      }
      
      // Emit real-time payment verification event
      socketService.emitPaymentVerified({
        _id: payment._id,
        user: user?._id,
        amount: payment.amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        subscription: populatedPayment.subscription
      });
      
      // If subscription was activated, emit subscription event
      if (populatedPayment.subscription && populatedPayment.subscription.status === 'active') {
        socketService.emitSubscriptionUpdated({
          _id: populatedPayment.subscription._id,
          user: user?._id,
          planType: populatedPayment.subscription.planType,
          status: 'active',
          startDate: populatedPayment.subscription.startDate,
          endDate: populatedPayment.subscription.endDate
        });
        
        // Emit notification about subscription activation
        socketService.emitNotification({
          type: 'subscription_activated',
          title: 'Subscription Activated',
          message: `${user?.name}'s subscription is now active`,
          priority: 'high'
        });
      }
    } else {
      // Emit payment status update for rejection
      socketService.emitPaymentStatusUpdated({
        _id: payment._id,
        user: populatedPayment.user?._id,
        amount: payment.amount,
        status: payment.status
      });
    }

    let message = 'Payment updated';

    if (status === 'verified') {
      message = 'Payment verified and subscription updated successfully';
    } else if (status === 'paid') {
      message = 'Payment marked as paid successfully';
    } else if (status === 'rejected') {
      message = 'Payment rejected';
    } else if (status === 'failed') {
      message = 'Payment failed';
    }

    res.status(200).json({
      success: true,
      message,
      data: populatedPayment
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: error.message
    });
  }
};

// @desc    Get all payments (Owner view with filters)
// @route   GET /api/payments/all
// @access  Private (Owner only)
exports.getAllPayments = async (req, res) => {
  try {
    const { status, userId } = req.query;
    const filter = {};

    if (status) {
      filter.status = status;
    }

    // Get active users only
    const activeUserIds = await User.find({ 
      role: 'customer', 
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    if (userId) {
      // Only allow if userId is in active users
      if (activeUserIds.some(id => id.toString() === userId)) {
        filter.user = userId;
      } else {
        // User deleted, return empty
        return res.status(200).json({
          success: true,
          count: 0,
          data: []
        });
      }
    } else {
      // Filter all payments by active users
      filter.user = { $in: activeUserIds };
    }

    const payments = await Payment.find(filter)
      .populate('user', 'name mobile userId')
      .populate('subscription', 'planType startDate endDate')
      .populate('verifiedBy', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments
    });
  } catch (error) {
    console.error('Get all payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

// @desc    Get monthly collection summary for owner
// @route   GET /api/payments/owner/monthly-summary
// @access  Private (Owner only)
exports.getMonthlyCollectionSummary = async (req, res) => {
  try {
    // Get current month and year
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    console.log('📊 Getting Monthly Collection Summary:');
    console.log(`   Month/Year: ${currentMonth}/${currentYear}`);

    // Get active users only
    const activeUserIds = await User.find({ 
      role: 'customer', 
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    console.log(`   Active Users: ${activeUserIds.length}`);

    // Find all payments for current month using month/year fields
    const payments = await Payment.find({
      user: { $in: activeUserIds },
      month: currentMonth,
      year: currentYear
    })
      .populate('user', 'name mobile userId')
      .populate({
        path: 'subscription',
        select: 'planType startDate endDate',
        populate: {
          path: 'plan',
          select: 'name'
        }
      })
      .sort({ createdAt: -1 });

    console.log(`   Payments Found: ${payments.length}`);

    // Calculate summary
    let totalAmount = 0;
    let paidAmount = 0;
    let pendingAmount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;

    const paymentsList = payments.map(payment => {
      const amount = payment.amount || 0;
      totalAmount += amount;

      const effectiveStatus = payment.status; // Do not normalize - let frontend handle display

      if (effectiveStatus === 'paid' || effectiveStatus === 'verified') {
        paidAmount += amount;
      } else if (effectiveStatus === 'pending') {
        pendingAmount += amount;
        pendingCount++;
      } else if (effectiveStatus === 'rejected') {
        rejectedCount++;
      }

      return {
        _id: payment._id,
        userName: payment.user?.name || 'Unknown',
        userMobile: payment.user?.mobile || '',
        userId: payment.user?.userId || '',
        planName: payment.subscription?.plan?.name || payment.subscription?.planType || 'N/A',
        amount: amount,
        status: effectiveStatus, // Return real status
        paymentMethod: payment.paymentMethod,
        paymentFor: payment.paymentFor, // Add paymentFor
        metadata: payment.metadata || null, // Add metadata
        createdAt: payment.createdAt,
        month: payment.month,
        year: payment.year,
        referenceNote: payment.referenceNote || ''
      };
    });

    console.log(`   Total Amount: ₹${totalAmount}`);
    console.log(`   Paid: ₹${paidAmount}`);
    console.log(`   Pending: ₹${pendingAmount}`);

    res.status(200).json({
      success: true,
      data: {
        month: moment(now).format('MMMM YYYY'),
        totalAmount,
        paidAmount,
        pendingAmount,
        pendingCount,
        rejectedCount,
        paidCount: payments.filter(p => ['paid', 'verified'].includes(p.status)).length,
        totalCount: payments.length,
        payments: paymentsList
      }
    });
  } catch (error) {
    console.error('Get monthly collection summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching monthly collection summary',
      error: error.message
    });
  }
};

// ====================================
// LEGACY ENDPOINTS (For backward compatibility)
// ====================================

// @desc    Mark payment as paid (Legacy - Owner creates payment record)
// @route   PATCH /api/payments/:id/mark-paid
// @access  Private (Owner only)
exports.markPaymentPaid = async (req, res) => {
  try {
    const { paidAmount, paymentDate, transactionId } = req.body;

    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    payment.paidAmount = paidAmount || payment.amount;
    payment.paymentDate = paymentDate || new Date();
    payment.transactionId = transactionId;
    payment.markedBy = req.user._id;
    payment.status = 'paid';

    await payment.save();

    res.status(200).json({
      success: true,
      message: 'Payment marked as paid',
      data: payment
    });
  } catch (error) {
    console.error('Mark payment paid error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking payment',
      error: error.message
    });
  }
};

// @desc    Upload UPI screenshot (Legacy)
// @route   POST /api/payments/:id/upload-screenshot
// @access  Private (Customer)
exports.uploadUPIScreenshot = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a screenshot'
      });
    }

    payment.upiScreenshot = req.file.path;
    payment.status = 'pending';
    await payment.save();

    res.status(200).json({
      success: true,
      message: 'Screenshot uploaded successfully',
      data: payment
    });
  } catch (error) {
    console.error('Upload screenshot error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading screenshot',
      error: error.message
    });
  }
};

// @desc    Get user's payments (Legacy - by userId)
// @route   GET /api/payments/user/:userId
// @access  Private
exports.getUserPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.params.userId })
      .populate('subscription', 'planType startDate endDate')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments
    });
  } catch (error) {
    console.error('Get user payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

// @desc    Get payment details
// @route   GET /api/payments/:id
// @access  Private
exports.getPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('user', 'name mobile userId address')
      .populate('subscription', 'planType startDate endDate')
      .populate('verifiedBy', 'name');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment',
      error: error.message
    });
  }
};
