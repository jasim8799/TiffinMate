const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const WeeklyMenu = require('../models/WeeklyMenu');
const User = require('../models/User');
const AppNotification = require('../models/AppNotification');
const Payment = require('../models/Payment');
const moment = require('moment');
const socketService = require('../services/socketService');
const { getUserMutex } = require('../utils/userMutex');

// Helper function to add derived status fields to subscription objects
const addDerivedStatusFields = (subscription) => {
  if (!subscription) return subscription;

  const now = new Date();
  const isExpiredByDate = subscription.endDate && now > subscription.endDate;

  // Calculate effective status for UI/UX clarity
  // This prevents confusion when subscriptions show "active" after expiry date
  let effectiveStatus = subscription.status;

  // If database shows active but date has passed, show as expired for UI
  if (subscription.status === 'active' && isExpiredByDate) {
    effectiveStatus = 'expired';
  }

  // Add derived fields
  subscription.isExpiredByDate = isExpiredByDate;
  subscription.effectiveStatus = effectiveStatus;

  return subscription;
};

// @desc    Get available subscription plans
// @route   GET /api/subscriptions/plans
// @access  Public
exports.getPlans = async (req, res) => {
  try {
    const { durationType, mealType } = req.query;

    const filter = {
      isActive: true,
      durationType: { $in: ['weekly','monthly'] }
    };

    if (durationType && ['weekly','monthly'].includes(durationType)) {
      filter.durationType = durationType;
    }
    
    const plans = await SubscriptionPlan.find(filter).sort({ sortOrder: 1 });
    
    // If mealType filter is provided, filter plans
    let filteredPlans = plans;
    if (mealType) {
      filteredPlans = plans.filter(plan => {
        if (mealType === 'lunch') return plan.mealTypes.lunch;
        if (mealType === 'dinner') return plan.mealTypes.dinner;
        if (mealType === 'both') return plan.mealTypes.lunch && plan.mealTypes.dinner;
        return true;
      });
    }
    
    res.status(200).json({
      success: true,
      count: filteredPlans.length,
      data: filteredPlans
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription plans',
      error: error.message
    });
  }
};

// @desc    Get duration types (daily/weekly/monthly)
// @route   GET /api/subscriptions/duration-types
// @access  Public
exports.getDurationTypes = async (req, res) => {
  try {
    const durationTypes = await SubscriptionPlan.aggregate([
      { $match: { isActive: true, durationType: { $in: ['weekly', 'monthly'] } } },
      {
        $group: {
          _id: '$durationType',
          minPrice: { $min: '$totalPrice' },
          maxPrice: { $max: '$totalPrice' },
          durationDays: { $first: '$durationDays' }
        }
      },
      { $sort: { durationDays: 1 } }
    ]);

    const types = durationTypes.map(dt => ({
      type: dt._id,
      durationDays: dt.durationDays,
      priceRange: {
        min: dt.minPrice,
        max: dt.maxPrice
      }
    }));

    res.status(200).json({
      success: true,
      data: types
    });
  } catch (error) {
    console.error('Get duration types error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching duration types',
      error: error.message
    });
  }
};

// @desc    Get subscription plans with their weekly menus
// @route   GET /api/subscriptions/plans-with-menus
// @access  Public
exports.getPlansWithMenus = async (req, res) => {
  try {
    const { durationType, type } = req.query;

    const filter = {
      isActive: true,
      durationType: { $in: ['weekly','monthly'] }
    };

    if (durationType && ['weekly','monthly'].includes(durationType)) {
      filter.durationType = durationType;
    }

    if (type) {
      filter.type = type; // VEG, NON_VEG, or MIX
    }
    
    const plans = await SubscriptionPlan.find(filter).sort({ sortOrder: 1 });
    
    // For each plan, fetch its weekly menu
    const plansWithMenus = await Promise.all(plans.map(async (plan) => {
      const weeklyMenu = await WeeklyMenu.find({
        planCategory: plan.menuCategory,
        isActive: true
      }).sort({ dayOfWeek: 1, mealType: 1 });
      
      // Organize menu by day
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
          menuByDay[menu.dayOfWeek][menu.mealType] = {
            items: menu.items,
            description: menu.description
          };
        }
      });
      
      return {
        _id: plan._id,
        name: plan.name,
        displayName: plan.displayName,
        description: plan.description,
        durationType: plan.durationType,
        durationDays: plan.durationDays,
        pricePerDay: plan.pricePerDay,
        totalPrice: plan.totalPrice,
        planCategory: plan.planCategory,
        type: plan.type,
        menuCategory: plan.menuCategory,
        mealTypes: plan.mealTypes,
        features: plan.features,
        weeklyMenu: menuByDay
      };
    }));
    
    res.status(200).json({
      success: true,
      count: plansWithMenus.length,
      data: plansWithMenus
    });
  } catch (error) {
    console.error('Get plans with menus error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription plans with menus',
      error: error.message
    });
  }
};

// @desc    User selects/creates subscription
// @route   POST /api/subscriptions/select
// @access  Private (Customer only)
exports.selectPlan = async (req, res) => {
  try {
    const { planId, startDate, dietaryPreference } = req.body;

    if (!planId || !startDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide plan ID and start date'
      });
    }

    if (!dietaryPreference || !['veg', 'non-veg', 'both'].includes(dietaryPreference)) {
      return res.status(400).json({
        success: false,
        message: 'Please select dietary preference (veg, non-veg, or both)'
      });
    }

    // Check if plan exists
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    if (!plan.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This subscription plan is not available'
      });
    }

    // ========== HARD BLOCK: Only weekly and monthly allowed ==========
    if (!['weekly', 'monthly'].includes(plan.durationType)) {
      return res.status(400).json({
        success: false,
        message: 'Only weekly and monthly subscriptions are allowed'
      });
    }

    // ========== ATOMIC SUBSCRIPTION CREATION: PREVENT DUPLICATES ==========
    // Use findOneAndUpdate with upsert to atomically check and create
    // This prevents race conditions where multiple requests could create duplicate subscriptions

    // Calculate dates based on plan's durationType
    const start = moment(startDate);
    let end, totalDays;

    switch (plan.durationType) {
      case 'weekly':
        end = moment(startDate).add(6, 'days');
        totalDays = 7;
        break;
      case 'monthly':
        end = moment(startDate).add(1, 'month').subtract(1, 'day');
        totalDays = end.diff(start, 'days') + 1;
        break;
      default:
        totalDays = plan.durationDays;
        end = moment(startDate).add(totalDays - 1, 'days');
    }

    // Prepare subscription data
    const foodType =
      plan.type === 'VEG' ? 'veg' :
      plan.type === 'NON_VEG' ? 'non-veg' :
      'both';

    const subscriptionData = {
      user: req.user._id,
      plan: plan._id, // Save plan reference
      planType: plan.menuCategory, // Map menuCategory → planType (classic/premium-veg/premium-non-veg)
      planCategory: plan.planCategory, // Copy planCategory (trial/classic/premium)
      startDate: start.toDate(),
      endDate: end.toDate(),
      totalDays,
      remainingDays: totalDays,
      amount: plan.totalPrice, // Use plan's totalPrice instead of hardcoded amounts
      mealPreferences: {
        includesLunch: plan.mealTypes.lunch,
        includesDinner: plan.mealTypes.dinner,
        dietaryPreference: dietaryPreference
      },
      status: 'pending_approval', // All plans require payment
      createdBy: req.user._id,
      planDetails: {
        planId: plan._id,
        planName: plan.name,
        durationType: plan.durationType,
        foodType
      }
    };

    // ATOMIC UPSERT: Create subscription only if no active/pending subscription exists
    // This uses MongoDB's atomic findOneAndUpdate with upsert to prevent duplicates
    let createdSubscription;
    try {
      const subscription = await Subscription.findOneAndUpdate(
        {
          user: req.user._id,
          // Condition: NO existing subscription with active/pending/grace/paused status
          $nor: [{
            status: { $in: ['active', 'pending_approval', 'grace', 'paused'] }
          }]
        },
        {
          $setOnInsert: subscriptionData
        },
        {
          upsert: true,
          new: true, // Return the new document
          runValidators: true,
          setDefaultsOnInsert: true
        }
      ).populate('user', 'name mobile userId');

      // Check if this was an insert (new subscription) or update (existing found)
      // If createdAt equals updatedAt, it was just created
      const wasCreated = subscription.createdAt.getTime() === subscription.updatedAt.getTime();

      if (!wasCreated) {
        // Existing subscription found, abort creation
        return res.status(400).json({
          success: false,
          message: 'You already have an active subscription. Please wait for it to expire or cancel it first.',
          existingSubscription: {
            planType: subscription.planType,
            status: subscription.status,
            endDate: subscription.endDate
          }
        });
      }

      // Subscription was successfully created
      createdSubscription = subscription;
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key error - unique index violation
        return res.status(400).json({
          success: false,
          message: 'You already have an active subscription. Please wait for it to expire or cancel it first.'
        });
      }
      throw error; // Re-throw other errors
    }

    const message = 'Subscription created. Please complete payment to activate.';

    // INTENTIONAL:
    // We create both DB notifications (AppNotification)
    // and socket notifications for real-time UX + history.
    // Create AppNotification for owner
    try {
      const user = await User.findById(req.user._id);
      await AppNotification.createNotification({
        type: 'subscription_requested',
        title: 'New Subscription Request',
        message: `${user.name} requested ${plan.name} plan (${dietaryPreference})`,
        relatedUser: req.user._id,
        relatedModel: 'Subscription',
        relatedId: createdSubscription._id,
        priority: 'high',
        metadata: {
          planType: plan.menuCategory,
          dietaryPreference: dietaryPreference,
          amount: createdSubscription.amount,
          startDate: createdSubscription.startDate
        }
      });
    } catch (notifError) {
      console.error('Failed to create subscription notification:', notifError);
    }

    // Emit dashboard refresh event AFTER database commit
    try {
      if (socketService.io) {
        socketService.emitDashboardRefreshRequired('new_subscription_request');
      }
    } catch (socketError) {
      console.error('Socket emit error in selectPlan:', socketError);
      // Do not throw - socket errors should not break the main flow
    }

    res.status(201).json({
      success: true,
      message,
      data: createdSubscription
    });
  } catch (error) {
    console.error('Select plan error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating subscription',
      error: error.message
    });
  }
};

// @desc    Update subscription status
// @route   PUT /api/subscriptions/:id/status
// @access  Private (Owner only)
exports.updateSubscriptionStatus = async (req, res) => {
  try {
    const { status } = req.body;

    console.log('📝 Update Status Request:', {
      subscriptionId: req.params.id,
      requestedStatus: status,
      userId: req.user._id
    });

    // Define valid status transitions
    const validTransitions = {
      'pending_approval': ['active', 'rejected'],
      'active': ['paused', 'expired', 'disabled'],
      'paused': ['active', 'expired', 'disabled'],
      'expired': ['active'], // Allow reactivation of expired subscriptions
      'disabled': ['active'],
      'rejected': [], // No transitions from rejected
      'grace': ['active', 'expired', 'disabled'],
      'pending': ['active', 'rejected']
    };

    if (!status || !['active', 'paused', 'expired', 'disabled'].includes(status)) {
      console.log('❌ Invalid status:', status);
      return res.status(400).json({
        success: false,
        message: `Invalid status: ${status}. Must be one of: active, paused, expired, disabled`
      });
    }

    // Get subscription to determine target user for mutex
    const targetSubscription = await Subscription.findById(req.params.id);
    if (!targetSubscription) {
      console.log('❌ Subscription not found:', req.params.id);
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    const targetUserId = targetSubscription.user.toString();
    const mutex = getUserMutex(targetUserId);

    // Acquire mutex for the target user
    await mutex.acquire();

    try {
      // Optimistic concurrency control with retries
      let retries = 3;
      let subscription;

      while (retries > 0) {
        // Get current subscription to check current status and version
        const currentSubscription = await Subscription.findById(req.params.id);
        if (!currentSubscription) {
          console.log('❌ Subscription not found:', req.params.id);
          return res.status(404).json({
            success: false,
            message: 'Subscription not found'
          });
        }

        // Check if transition is valid
        const currentStatus = currentSubscription.status;
        if (!validTransitions[currentStatus] || !validTransitions[currentStatus].includes(status)) {
          console.log('❌ Invalid status transition:', `${currentStatus} -> ${status}`);
          return res.status(400).json({
            success: false,
            message: `Invalid status transition from ${currentStatus} to ${status}`
          });
        }

        // Attempt update with version check
        subscription = await Subscription.findOneAndUpdate(
          { _id: req.params.id, __v: currentSubscription.__v },
          { status: status },
          {
            new: true, // Return updated document
            runValidators: false // Skip validation to avoid issues with legacy data
          }
        ).populate('user', 'name mobile userId role');

        if (subscription) {
          break; // Success
        }

        retries--;
        console.log(`⚠️ Version conflict, retrying... (${retries} retries left)`);
      }

      if (!subscription) {
        console.log('❌ Version conflict after retries');
        return res.status(409).json({
          success: false,
          message: 'Version conflict: subscription was modified by another request'
        });
      }

      console.log('✅ Status updated successfully:', {
        id: subscription._id,
        newStatus: subscription.status
      });

      // Payment creation is handled ONLY in approveSubscription
      // This prevents duplicate payment creation

      // Emit dashboard refresh event AFTER database commit
      try {
        if (socketService.io) {
          socketService.emitDashboardRefreshRequired('subscription_status_updated');
        }
      } catch (socketError) {
        console.error('Socket emit error in updateSubscriptionStatus:', socketError);
        // Do not throw - socket errors should not break the main flow
      }

      res.status(200).json({
        success: true,
        message: `Subscription ${status}`,
        data: subscription
      });
    } finally {
      // Always release the mutex
      mutex.release();
    }
  } catch (error) {
    console.error('❌ Update status error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Error updating subscription status',
      error: error.message
    });
  }
};

// @desc    Create subscription
// @route   POST /api/subscriptions
// @access  Private (Owner only)
exports.createSubscription = async (req, res) => {
  try {
    const { userId, planId, startDate } = req.body;

    if (!userId || !planId || !startDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide userId, planId, and startDate'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    // BUSINESS RULE: Only weekly and monthly subscriptions allowed
    if (!['weekly', 'monthly'].includes(plan.durationType)) {
      return res.status(400).json({
        success: false,
        message: 'Only weekly and monthly subscriptions are allowed'
      });
    }

    // BUSINESS RULE: One Active Subscription Only
    const existingActiveSubscription = await Subscription.findOne({
      user: userId,
      status: 'active'
    });

    if (existingActiveSubscription) {
      return res.status(400).json({
        success: false,
        message: 'User already has an active subscription. Only one active subscription is allowed.',
        data: {
          existingSubscription: {
            id: existingActiveSubscription._id,
            planType: existingActiveSubscription.planType,
            startDate: existingActiveSubscription.startDate,
            endDate: existingActiveSubscription.endDate,
            status: existingActiveSubscription.status
          }
        }
      });
    }

    // Calculate dates and days based on plan's durationType
    const start = moment(startDate);
    let end, totalDays;

    switch (plan.durationType) {
      case 'weekly':
        end = moment(startDate).add(6, 'days');
        totalDays = 7;
        break;
      case 'monthly':
        end = moment(startDate).add(1, 'month').subtract(1, 'day');
        totalDays = end.diff(start, 'days') + 1;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid plan duration type'
        });
    }

    const subscription = await Subscription.create({
      user: userId,
      plan: planId,
      planType: plan.menuCategory,
      planCategory: plan.planCategory,
      startDate: start.toDate(),
      endDate: end.toDate(),
      totalDays,
      remainingDays: totalDays,
      amount: plan.totalPrice,
      mealPreferences: {
        includesLunch: plan.mealTypes.lunch,
        includesDinner: plan.mealTypes.dinner
      },
      createdBy: req.user._id
    });

    // Enable user account
    user.isActive = true;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      data: subscription
    });
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating subscription',
      error: error.message
    });
  }
};

// @desc    Get user's subscriptions
// @route   GET /api/subscriptions/user/:userId
// @access  Private
exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ user: req.params.userId })
      .populate('user', 'name mobile userId')
      .populate('plan', 'name displayName price durationDays')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: subscriptions.length,
      data: subscriptions
    });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscriptions',
      error: error.message
    });
  }
};

// @desc    Get active subscription for current user
// @route   GET /api/subscriptions/my-active
// @access  Private
exports.getMyActiveSubscription = async (req, res) => {
  try {
    // Find active, grace, or paused subscription
    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: { $in: ['active', 'grace', 'paused'] }
    })
      .populate('user', 'name mobile userId')
      .populate('plan') // 🔑 Populate plan for Flutter UI
      .sort({ createdAt: -1 }); // Get most recent

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active or pending subscription found'
      });
    }

    // Add derived status fields for UI clarity
    const subscriptionWithDerivedFields = addDerivedStatusFields(subscription.toObject());

    res.status(200).json({
      success: true,
      data: subscriptionWithDerivedFields
    });
  } catch (error) {
    console.error('Get active subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active subscription',
      error: error.message
    });
  }
};

// @desc    Get all subscriptions (admin)
// @route   GET /api/subscriptions
// @access  Private (Owner only)
exports.getAllSubscriptions = async (req, res) => {
  try {
    const { status, planType } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (planType) filter.planType = planType;

    // Get active users only
    const activeUserIds = await User.find({
      role: 'customer',
      isActive: true,
      deletedAt: { $exists: false }
    }).distinct('_id');

    filter.user = { $in: activeUserIds };

    const subscriptions = await Subscription.find(filter)
      .populate('user', 'name mobile userId')
      .populate('plan', 'name displayName price durationDays')
      .sort({ createdAt: -1 });

    // Add derived status fields to each subscription
    const subscriptionsWithDerivedFields = subscriptions.map(sub => addDerivedStatusFields(sub.toObject()));

    res.status(200).json({
      success: true,
      count: subscriptionsWithDerivedFields.length,
      data: subscriptionsWithDerivedFields
    });
  } catch (error) {
    console.error('Get all subscriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscriptions',
      error: error.message
    });
  }
};

// @desc    Renew subscription
// @route   POST /api/subscriptions/:id/renew
// @access  Private (Owner only)
exports.renewSubscription = async (req, res) => {
  try {
    const { planType, planCategory, startDate, amount } = req.body;
    const SubscriptionPlan = require('../models/SubscriptionPlan');

    const oldSubscription = await Subscription.findById(req.params.id).populate('plan');
    if (!oldSubscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    // Validate oldSubscription has required fields
    if (!oldSubscription.endDate) {
      return res.status(400).json({
        success: false,
        message: 'Cannot renew subscription: missing endDate'
      });
    }

    // Log renewal attempt
    console.log(`\n🔄 [SUBSCRIPTION RENEWAL]`);
    console.log(`   Subscription ID: ${req.params.id}`);
    console.log(`   User: ${oldSubscription.user}`);
    console.log(`   Old subscription.planType: ${oldSubscription.planType}`);
    console.log(`   Old subscription.planCategory: ${oldSubscription.planCategory}`);
    console.log(`   Received planType (duration) from frontend: ${planType || 'NOT PROVIDED'}`);
    console.log(`   Received planCategory (food) from frontend: ${planCategory || 'NOT PROVIDED'}`);

    // Resolve the correct duration type
    let finalPlanType = null;

    // Priority 1: If frontend explicitly provides a valid duration type, use it
    if (planType && ['weekly', 'monthly'].includes(planType)) {
      finalPlanType = planType;
      console.log(`   ✅ Using planType from frontend: ${finalPlanType}`);
    }
    // Priority 2: From linked SubscriptionPlan
    else if (oldSubscription.plan && oldSubscription.plan.durationType) {
      finalPlanType = oldSubscription.plan.durationType;
      console.log(`   ✅ Resolved from SubscriptionPlan.durationType: ${finalPlanType}`);
    }
    // Priority 3: From planDetails (if available)
    else if (oldSubscription.planDetails && oldSubscription.planDetails.durationType) {
      finalPlanType = oldSubscription.planDetails.durationType;
      console.log(`   ✅ Resolved from planDetails.durationType: ${finalPlanType}`);
    }
    // Priority 4: Infer from totalDays
    else if (oldSubscription.totalDays) {
      if (oldSubscription.totalDays === 7) {
        finalPlanType = 'weekly';
        console.log(`   ℹ️  Inferred from totalDays (7): weekly`);
      } else if (oldSubscription.totalDays >= 28 && oldSubscription.totalDays <= 31) {
        finalPlanType = 'monthly';
        console.log(`   ℹ️  Inferred from totalDays (${oldSubscription.totalDays}): monthly`);
      }
    }

    
    // Validate we have a valid duration type
    const validPlanTypes = ['weekly', 'monthly'];
    if (!finalPlanType || !validPlanTypes.includes(finalPlanType)) {
      console.log(`   ❌ Could not resolve valid planType. Old planType: "${oldSubscription.planType}"`);
      return res.status(400).json({
        success: false,
        message: `Cannot renew subscription: unable to determine plan duration. Please contact support. (Current value: "${oldSubscription.planType}")`
      });
    }

    console.log(`   ✅ Final planType (duration) to use: ${finalPlanType}`);

    // Resolve the plan category (food type)
    let finalPlanCategory = planCategory || oldSubscription.planCategory || oldSubscription.planType;
    
    // Validate plan category
    const validCategories = ['classic', 'premium-veg', 'premium-non-veg'];
    if (!validCategories.includes(finalPlanCategory)) {
      console.log(`   ⚠️  Invalid planCategory: "${finalPlanCategory}", defaulting to classic`);
      finalPlanCategory = 'classic';
    }
    
    console.log(`   ✅ Final planCategory (food type) to use: ${finalPlanCategory}`);

    // Try to find a matching SubscriptionPlan based on durationType and menuCategory
    let resolvedPlan = null;
    try {
      resolvedPlan = await SubscriptionPlan.findOne({
        durationType: finalPlanType,
        menuCategory: finalPlanCategory,
        isActive: true
      }).lean();
      
      if (resolvedPlan) {
        console.log(`   ✅ Found matching SubscriptionPlan: ${resolvedPlan._id}`);
        console.log(`      Plan name: ${resolvedPlan.name}`);
        console.log(`      Duration: ${resolvedPlan.durationType}`);
        console.log(`      Menu: ${resolvedPlan.menuCategory}`);
      } else {
        console.log(`   ⚠️  No SubscriptionPlan found for ${finalPlanType} + ${finalPlanCategory}`);
        console.log(`      Will create subscription without plan reference`);
      }
    } catch (err) {
      console.log(`   ⚠️  Error finding SubscriptionPlan: ${err.message}`);
    }

    // Calculate new dates
    const start = moment(startDate || new Date());
    
    // Validate start date is valid
    if (!start.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid start date provided'
      });
    }
    
    let end, totalDays;

    switch (finalPlanType) {
      case 'weekly':
        end = moment(start).add(6, 'days');
        totalDays = 7;
        break;
      case 'monthly':
        end = moment(start).add(1, 'month').subtract(1, 'day');
        totalDays = end.diff(start, 'days') + 1;
        break;
    }

    // Validate end date is valid
    if (!end || !end.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'Error calculating end date'
      });
    }

    // Determine which plan properties to use
    const newPlanId = resolvedPlan ? resolvedPlan._id : oldSubscription.plan;
    const newPlanType = resolvedPlan ? resolvedPlan.menuCategory : finalPlanCategory;
    const newPlanCategory = resolvedPlan ? resolvedPlan.planCategory : (oldSubscription.planCategory || 'classic');
    const newAmount = amount || (resolvedPlan ? resolvedPlan.totalPrice : oldSubscription.amount);

    console.log(`   📝 Creating new subscription with:`);
    console.log(`      plan: ${newPlanId}`);
    console.log(`      planType (food): ${newPlanType}`);
    console.log(`      planCategory: ${newPlanCategory}`);
    console.log(`      amount: ${newAmount}`);

    // Create new subscription
    const newSubscription = await Subscription.create({
      user: oldSubscription.user,
      plan: newPlanId,
      planType: newPlanType,
      planCategory: newPlanCategory,
      startDate: start.toDate(),
      endDate: end.toDate(),
      totalDays,
      remainingDays: totalDays,
      amount: newAmount,
      mealPreferences: oldSubscription.mealPreferences,
      planDetails: resolvedPlan ? {
        planType: resolvedPlan.durationType,
        planCategory: resolvedPlan.planCategory,
        menuCategory: resolvedPlan.menuCategory,
        deliveriesPerWeek: resolvedPlan.deliveriesPerWeek,
        mealsPerDelivery: resolvedPlan.mealsPerDelivery
      } : oldSubscription.planDetails,
      createdBy: req.user._id
    });

    // Mark old subscription as expired
    oldSubscription.status = 'expired';
    await oldSubscription.save();

    // Re-enable user account
    const user = await User.findById(oldSubscription.user);
    user.isActive = true;
    await user.save();

    console.log(`   ✅ New subscription created: ${newSubscription._id}`);
    console.log(`   ✅ Start: ${moment(newSubscription.startDate).format('YYYY-MM-DD')}`);
    console.log(`   ✅ End: ${moment(newSubscription.endDate).format('YYYY-MM-DD')}`);

    res.status(201).json({
      success: true,
      message: 'Subscription renewed successfully',
      data: newSubscription
    });
  } catch (error) {
    console.error('Renew subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Error renewing subscription',
      error: error.message
    });
  }
};

// @desc    Pause/unpause subscription
// @route   PATCH /api/subscriptions/:id/toggle-pause
// @access  Private (Owner only)
exports.togglePauseSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id).populate('user', 'name mobile userId role');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    const oldStatus = subscription.status;
    subscription.status = subscription.status === 'paused' ? 'active' : 'paused';
    await subscription.save();

    // Create notification and emit dashboard refresh event
    try {
      if (subscription.status === 'paused') {
        // Subscription paused
        await AppNotification.create({
          relatedUser: subscription.user._id,
          type: 'subscription_paused',
          title: 'Subscription Paused',
          message: 'Your tiffin subscription is paused',
          relatedModel: 'Subscription',
          relatedId: subscription._id
        });

        if (socketService.io) {
          socketService.emitDashboardRefreshRequired('subscription_paused');
        }
      } else if (oldStatus === 'paused' && subscription.status === 'active') {
        // Subscription resumed
        await AppNotification.create({
          relatedUser: subscription.user._id,
          type: 'subscription_resumed',
          title: 'Subscription Resumed',
          message: 'Your tiffin subscription is active again',
          relatedModel: 'Subscription',
          relatedId: subscription._id
        });

        if (socketService.io) {
          socketService.emitDashboardRefreshRequired('subscription_resumed');
        }
      }
    } catch (socketError) {
      console.error('Socket emit error in togglePauseSubscription:', socketError);
      // Do not throw - socket errors should not break the main flow
    }

    res.status(200).json({
      success: true,
      message: `Subscription ${subscription.status}`,
      data: subscription
    });
  } catch (error) {
    console.error('Toggle pause error:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling subscription pause',
      error: error.message
    });
  }
};

// @desc    Get subscription details
// @route   GET /api/subscriptions/:id
// @access  Private
exports.getSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate('user', 'name mobile userId')
      .populate('plan', 'name displayName price durationDays');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    // Add derived status fields for UI clarity
    const subscriptionWithDerivedFields = addDerivedStatusFields(subscription.toObject());

    res.status(200).json({
      success: true,
      data: subscriptionWithDerivedFields
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription',
      error: error.message
    });
  }
};

// @desc    User requests a subscription (pending approval)
// @route   POST /api/subscriptions/request
// @access  Private (Customer)
exports.requestSubscription = async (req, res) => {
  try {
    // Validate JWT user
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User authentication required'
      });
    }

    const { planId, paymentMode, paymentId } = req.body;
    const userId = req.user._id;

    // Validate planId
    if (!planId) {
      return res.status(400).json({
        success: false,
        message: 'Please select a subscription plan'
      });
    }

    // ===============================
    // NEW FLOW: subscription → payment
    // Payment will be created AFTER subscription
    // ===============================
    let payment = null;

    if (paymentId) {
      payment = await Payment.findOne({
        _id: paymentId,
        user: req.user._id,
        paymentFor: 'subscription',
        status: { $in: ['paid', 'verified'] },
        subscription: null
      });

      if (!payment) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment'
        });
      }
    }

    // Check if plan exists
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    if (!plan.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This subscription plan is not available'
      });
    }

    // ========== HARD BLOCK: Only weekly and monthly allowed ==========
    if (!['weekly','monthly'].includes(plan.durationType)) {
      return res.status(400).json({
        success: false,
        message: 'Only weekly and monthly subscriptions are allowed'
      });
    }



    // Check for existing pending or active subscriptions
    const existingSubscription = await Subscription.findOne({
      user: userId,
      status: { $in: ['pending_approval', 'active', 'grace', 'paused'] }
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        message: existingSubscription.status === 'active' 
          ? 'You already have an active subscription' 
          : 'You already have a pending subscription request',
        data: {
          existingSubscription: {
            id: existingSubscription._id,
            planType: existingSubscription.planType,
            status: existingSubscription.status,
            startDate: existingSubscription.startDate,
            endDate: existingSubscription.endDate
          }
        }
      });
    }

    // Create subscription request with pending_approval status
    const startDate = moment().startOf('day');
    let endDate, totalDays;

    switch (plan.durationType) {
      case 'weekly':
        endDate = moment(startDate).add(6, 'days');
        totalDays = 7;
        break;
      case 'monthly':
        endDate = moment(startDate).add(1, 'month').subtract(1, 'day');
        totalDays = endDate.diff(startDate, 'days') + 1;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid plan duration type'
        });
    }

    const foodType =
      plan.type === 'VEG' ? 'veg' :
      plan.type === 'NON_VEG' ? 'non-veg' :
      'both';

    const subscription = await Subscription.create({
      user: userId,
      plan: plan._id, // 🔑 Save plan reference
      planType: plan.menuCategory, // Map menuCategory → planType (classic/premium-veg/premium-non-veg)
      planCategory: plan.planCategory, // Copy planCategory (trial/classic/premium)
      startDate: startDate.toDate(),
      endDate: endDate.toDate(),
      totalDays,
      remainingDays: totalDays,
      amount: plan.totalPrice,
      paymentMode: paymentMode || 'cash',
      status: 'pending_approval',
      mealPreferences: {
        includesLunch: plan.mealTypes.lunch,
        includesDinner: plan.mealTypes.dinner
      },
      planDetails: {
        planId: plan._id,
        planName: plan.name,
        durationType: plan.durationType,
        foodType
      }
    });

    // ===============================
    // LINK PAYMENT → SUBSCRIPTION (optional)
    // ===============================
    if (payment) {
      payment.subscription = subscription._id;
      await payment.save();
    }

    // Find owner to send notification
    const owner = await User.findOne({ role: 'owner' });
    
    if (!owner) {
      console.warn('⚠️ No owner found to send notification');
    } else {
      // Create notification for owner with all required fields
      try {
        await AppNotification.create({
          type: 'subscription_requested', // ✅ Valid enum value
          title: 'New Subscription Request',
          message: `${req.user.name} has requested a ${plan.name} subscription`,
          relatedUser: userId, // ✅ User who made the request
          relatedModel: 'Subscription', // ✅ Required field
          relatedId: subscription._id, // ✅ Required field
          priority: 'high',
          isRead: false,
          metadata: {
            subscriptionId: subscription._id,
            userId: userId,
            userName: req.user.name,
            planName: plan.name,
            planPrice: plan.totalPrice
          }
        });
      } catch (notificationError) {
        console.error('⚠️ Failed to create notification:', notificationError);
        // Don't fail the entire request if notification fails
      }
    }

    // Emit dashboard refresh event AFTER database commit
    try {
      if (socketService.io) {
        socketService.emitDashboardRefreshRequired('subscription_requested');
      }
    } catch (socketError) {
      console.error('Socket emit error in requestSubscription:', socketError);
      // Do not throw - socket errors should not break the main flow
    }

    // Populate plan before returning
    await subscription.populate('plan');

    res.status(201).json({
      success: true,
      message: 'Subscription request sent successfully. Waiting for owner approval.',
      data: subscription
    });
  } catch (error) {
    console.error('❌ Request subscription error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Handle specific MongoDB errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error: ' + error.message
      });
    }
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating subscription request',
      error: error.message
    });
  }
};

// @desc    Owner approves a subscription request
// @route   PATCH /api/subscriptions/:id/approve
// @access  Private (Owner)
exports.approveSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate } = req.body; // Optional: owner can change start date

    console.log('\n🔥🔥🔥 APPROVE SUBSCRIPTION CALLED 🔥🔥🔥');
    console.log(`   Subscription ID: ${id}`);
    console.log(`   User: ${req.user.name} (${req.user._id})`);

    // Atomic approve with race condition guard
    let updateFields = {
      status: 'active',
      approvedBy: req.user._id,
      approvedAt: new Date()
    };

    // Update start and end dates if owner provided new start date
    if (startDate) {
      const start = moment(startDate);
      let end;

      // Get duration from planDetails or linked plan - need to fetch subscription first for this
      const subscription = await Subscription.findById(id);
      if (!subscription) {
        console.error('❌ Subscription not found:', id);
        return res.status(404).json({
          success: false,
          message: 'Subscription not found'
        });
      }

      const durationType = subscription.planDetails?.durationType ||
                          (subscription.plan ? subscription.plan.durationType : null);

      switch (durationType) {
        case 'weekly':
          end = moment(startDate).add(6, 'days');
          break;
        case 'monthly':
          end = moment(startDate).add(1, 'month').subtract(1, 'day');
          break;
        default:
          end = moment(startDate).add(subscription.totalDays - 1, 'days');
      }

      updateFields.startDate = start.toDate();
      updateFields.endDate = end.toDate();
    }

    const subscription = await Subscription.findOneAndUpdate(
      { _id: id, status: 'pending_approval' },
      updateFields,
      { new: true }
    ).populate('user', 'name mobile userId role');

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: 'Subscription already processed or not pending'
      });
    }

    console.log('📋 Subscription Details AFTER atomic approval:');
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Plan Type: ${subscription.planType}`);
    console.log(`   Amount: ₹${subscription.amount}`);
    console.log(`   User: ${subscription.user?.name}`);
    console.log('✅ Subscription saved successfully');
    console.log(`   New Status: ${subscription.status}`);
    console.log(`   Amount after save: ₹${subscription.amount}`);

    // Enable user account
    const user = await User.findById(subscription.user._id);
    if (user) {
      user.isActive = true;
      await user.save();
      console.log(`✅ User ${user.name} activated`);
    }
    
    // ✅ VERIFICATION: Log subscription activation
    console.log(`\n✅ [SUBSCRIPTION ACTIVATED]`);
    console.log(`   User: ${subscription.user.name} (${subscription.user._id})`);
    console.log(`   Subscription ID: ${subscription._id}`);
    console.log(`   Start Date: ${moment(subscription.startDate).format('YYYY-MM-DD')}`);
    console.log(`   End Date: ${moment(subscription.endDate).format('YYYY-MM-DD')}`);
    console.log(`   Plan: ${subscription.planType}`);
    console.log(`   Status: pending_approval → active`);
    console.log(`   ✅ Meal selection now UNLOCKED`);
    console.log(`   ✅ Kitchen access GRANTED`);
    console.log(`   ✅ User can order meals immediately`);

    // 🔥 NEW FLOW: payment already collected before request
    // DO NOT auto-create payment here
    console.log('Payment already verified before subscription request - skipping auto payment creation');

    // Create notification for customer
    await AppNotification.create({
      type: 'subscription_approved',
      title: 'Subscription Approved!',
      message: `Your subscription has been approved and is now active`,
      relatedUser: subscription.user._id,
      relatedModel: 'Subscription',
      relatedId: subscription._id,
      priority: 'high',
      metadata: {
        subscriptionId: subscription._id,
        startDate: subscription.startDate,
        endDate: subscription.endDate
      }
    });

    // Emit dashboard refresh event AFTER database commit
    try {
      if (socketService.io) {
        socketService.emitDashboardRefreshRequired('subscription_approved');
      }
    } catch (socketError) {
      console.error('Socket emit error in approveSubscription:', socketError);
      // Do not throw - socket errors should not break the main flow
    }

    // Populate plan before returning
    await subscription.populate('plan');

    res.status(200).json({
      success: true,
      message: 'Subscription approved successfully',
      data: subscription
    });
  } catch (error) {
    console.error('Approve subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving subscription',
      error: error.message
    });
  }
};

// @desc    Owner rejects a subscription request
// @route   PATCH /api/subscriptions/:id/reject
// @access  Private (Owner)
exports.rejectSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body; // Optional rejection reason

    const subscription = await Subscription.findById(id).populate('user', 'name mobile userId role');
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    if (subscription.status !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject subscription with status: ${subscription.status}`
      });
    }

    subscription.status = 'rejected';
    subscription.rejectedBy = req.user._id;
    subscription.rejectedAt = new Date();
    subscription.rejectionReason = reason || 'No reason provided';
    await subscription.save();

    // Create notification for customer
    await AppNotification.create({
      type: 'subscription_rejected',
      title: 'Subscription Request Rejected',
      message: reason || 'Your subscription request was rejected',
      relatedUser: subscription.user._id,
      relatedModel: 'Subscription',
      relatedId: subscription._id,
      priority: 'medium',
      metadata: {
        subscriptionId: subscription._id,
        reason: reason
      }
    });

    // Emit dashboard refresh event AFTER database commit
    try {
      if (socketService.io) {
        socketService.emitDashboardRefreshRequired('subscription_rejected');
      }
    } catch (socketError) {
      console.error('Socket emit error in rejectSubscription:', socketError);
      // Do not throw - socket errors should not break the main flow
    }

    res.status(200).json({
      success: true,
      message: 'Subscription rejected',
      data: subscription
    });
  } catch (error) {
    console.error('Reject subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting subscription',
      error: error.message
    });
  }
};



// @desc    Owner emergency override subscription
// @route   PATCH /api/subscriptions/:id/override
// @access  Private (Owner only)
exports.emergencyOverrideSubscription = async (req, res) => {
  try {
    const { action, startDate, endDate, remainingDays, reason } = req.body;

    // Require reason field
    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Reason is required for override actions'
      });
    }

    // Validate action
    const validActions = ['force_active', 'force_pause', 'force_grace', 'force_expire', 'force_disable', 'reset_grace', 'fix_dates'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }

    // Load subscription
    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    // Prevent override from racing with approve
    if (subscription.status === 'pending_approval' && action !== 'force_active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot override pending subscription except force_active'
      });
    }

    const beforeStatus = subscription.status;
    const now = new Date();

    // Apply action-specific logic
    switch (action) {
      case 'force_active':
        subscription.status = 'active';
        subscription.graceStartedAt = null;
        if (endDate && new Date(endDate) < now && remainingDays) {
          subscription.endDate = new Date(now.getTime() + remainingDays * 24 * 60 * 60 * 1000);
        }
        break;

      case 'force_pause':
        subscription.status = 'paused';
        break;

      case 'force_grace':
        subscription.status = 'grace';
        subscription.graceStartedAt = now;
        break;

      case 'force_expire':
        subscription.status = 'expired';
        break;

      case 'force_disable':
        subscription.status = 'disabled';
        break;

      case 'reset_grace':
        subscription.status = 'grace';
        subscription.graceStartedAt = now;
        break;

      case 'fix_dates':
        if (startDate) subscription.startDate = new Date(startDate);
        if (endDate) subscription.endDate = new Date(endDate);
        // Recompute remainingDays if needed
        if (subscription.startDate && subscription.endDate && subscription.totalDays) {
          const diffTime = Math.abs(subscription.endDate - subscription.startDate);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          subscription.remainingDays = Math.max(0, diffDays - subscription.usedDays);
        }
        break;
    }

    // Add override metadata
    subscription.overrideLog.push({
      action,
      owner: req.user._id,
      reason: reason.trim(),
      at: now,
      note: `Emergency override by owner: ${action} - ${reason.trim()}`
    });

    // Cap override log size to prevent document bloat
    if (subscription.overrideLog.length > 50) {
      subscription.overrideLog = subscription.overrideLog.slice(-50);
    }

    // Log override action
    console.log(`🚨 EMERGENCY OVERRIDE: ${action} on subscription ${subscription._id} by owner ${req.user._id}`);

    await subscription.save();

    res.json({
      success: true,
      message: "Override applied",
      beforeStatus,
      afterStatus: subscription.status,
      subscription
    });
  } catch (error) {
    console.error('Emergency override error:', error);
    res.status(500).json({
      success: false,
      message: 'Error applying emergency override',
      error: error.message
    });
  }
};

// @desc    Get pending subscription requests (for owner)
// @route   GET /api/subscriptions/pending
// @access  Private (Owner)
exports.getPendingSubscriptions = async (req, res) => {
  try {
    const pendingSubscriptions = await Subscription.find({
      status: 'pending_approval'
    })
      .populate('user', 'name mobile userId')
      .populate('plan', 'name displayName price durationDays')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: pendingSubscriptions.length,
      data: pendingSubscriptions
    });
  } catch (error) {
    console.error('Get pending subscriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending subscriptions',
      error: error.message
    });
  }
};
