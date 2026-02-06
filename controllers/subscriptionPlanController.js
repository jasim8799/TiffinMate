const SubscriptionPlan = require('../models/SubscriptionPlan');

// @desc    Get all active subscription plans (for customer-facing Add User screen)
// @route   GET /api/subscription-plans
// @access  Public (used by Owner during customer creation)
exports.getSubscriptionPlans = async (req, res) => {
  try {
    console.log('📡 Fetching subscription plans...');
    
    const { durationType, mealType } = req.query;
    
    const filter = { isActive: true };
    
    if (durationType) {
      filter.durationType = durationType;
    }
    
    const plans = await SubscriptionPlan.find(filter).sort({ sortOrder: 1, durationDays: 1 });
    
    console.log(`✅ Found ${plans.length} active subscription plans`);
    
    // If mealType filter is provided, filter plans
    let filteredPlans = plans;
    if (mealType) {
      filteredPlans = plans.filter(plan => {
        if (mealType === 'lunch') return plan.mealTypes.lunch;
        if (mealType === 'dinner') return plan.mealTypes.dinner;
        if (mealType === 'both') return plan.mealTypes.lunch && plan.mealTypes.dinner;
        return true;
      });
      console.log(`🔍 Filtered to ${filteredPlans.length} plans for mealType: ${mealType}`);
    }
    
    // Return with 'data' key (consistent with other endpoints)
    res.status(200).json({
      success: true,
      count: filteredPlans.length,
      data: filteredPlans
    });
  } catch (error) {
    console.error('❌ Error fetching subscription plans:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription plans',
      error: error.message
    });
  }
};

// @desc    Get ALL plans for owner management (includes inactive)
// @route   GET /api/subscription-plans/all
// @access  Private (Owner only)
exports.getAllPlansForOwner = async (req, res) => {
  try {
    console.log('📡 Fetching ALL subscription plans for owner...');
    
    const plans = await SubscriptionPlan.find()
      .sort({ isActive: -1, sortOrder: 1, createdAt: -1 })
      .populate('createdBy', 'name userId');
    
    console.log(`✅ Found ${plans.length} total plans`);
    
    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans
    });
  } catch (error) {
    console.error('❌ Error fetching all plans:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription plans',
      error: error.message
    });
  }
};

// @desc    Get single subscription plan by ID
// @route   GET /api/subscription-plans/:id
// @access  Private (Owner only)
exports.getPlanById = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: plan
    });
  } catch (error) {
    console.error('❌ Error fetching plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching subscription plan',
      error: error.message
    });
  }
};

// @desc    Create new subscription plan
// @route   POST /api/subscription-plans
// @access  Private (Owner only)
exports.createPlan = async (req, res) => {
  try {
    console.log('🚀 Creating new subscription plan...');
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    const {
      name,
      displayName,
      description,
      durationType,
      durationDays,
      pricePerDay,
      totalPrice,
      planCategory,
      type,
      menuCategory,
      mealTypes,
      weeklyMenu,
      features,
      sortOrder
    } = req.body;
    
    // Validate required fields
    if (!name || !displayName || !totalPrice || !durationType) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, displayName, totalPrice, durationType'
      });
    }
    
    // Check if plan with same name exists
    const existingPlan = await SubscriptionPlan.findOne({ name });
    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: 'A plan with this name already exists'
      });
    }
    
    // Create plan
    const plan = await SubscriptionPlan.create({
      name,
      displayName,
      description: description || '',
      durationType,
      durationDays: durationDays || (durationType === 'monthly' ? 30 : durationType === 'weekly' ? 7 : 1),
      pricePerDay: pricePerDay || Math.round(totalPrice / durationDays),
      totalPrice,
      planCategory: planCategory || 'classic',
      type: type || 'MIX',
      menuCategory: menuCategory || 'classic',
      mealTypes: mealTypes || { lunch: true, dinner: true },
      weeklyMenu: weeklyMenu || {},
      features: features || [],
      sortOrder: sortOrder || 0,
      isActive: true,
      createdBy: req.user._id
    });
    
    console.log('✅ Subscription plan created:', plan._id);
    
    res.status(201).json({
      success: true,
      message: 'Subscription plan created successfully',
      data: plan
    });
  } catch (error) {
    console.error('❌ Error creating plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating subscription plan',
      error: error.message
    });
  }
};

// @desc    Update subscription plan
// @route   PUT /api/subscription-plans/:id
// @access  Private (Owner only)
exports.updatePlan = async (req, res) => {
  try {
    console.log(`🔄 Updating subscription plan: ${req.params.id}`);
    console.log('📥 Update data:', JSON.stringify(req.body, null, 2));
    
    const plan = await SubscriptionPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }
    
    // Update fields
    const allowedUpdates = [
      'displayName', 'description', 'durationType', 'durationDays',
      'pricePerDay', 'totalPrice', 'planCategory', 'type', 'menuCategory',
      'mealTypes', 'weeklyMenu', 'features', 'sortOrder', 'isActive'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        plan[field] = req.body[field];
      }
    });
    
    await plan.save();
    
    console.log('✅ Plan updated successfully');
    
    res.status(200).json({
      success: true,
      message: 'Subscription plan updated successfully',
      data: plan
    });
  } catch (error) {
    console.error('❌ Error updating plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating subscription plan',
      error: error.message
    });
  }
};

// @desc    Toggle plan active status
// @route   PATCH /api/subscription-plans/:id/status
// @access  Private (Owner only)
exports.togglePlanStatus = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }
    
    plan.isActive = !plan.isActive;
    await plan.save();
    
    console.log(`✅ Plan ${plan.isActive ? 'activated' : 'deactivated'}: ${plan.displayName}`);
    
    res.status(200).json({
      success: true,
      message: `Plan ${plan.isActive ? 'activated' : 'deactivated'} successfully`,
      data: plan
    });
  } catch (error) {
    console.error('❌ Error toggling plan status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating plan status',
      error: error.message
    });
  }
};

// @desc    Delete subscription plan
// @route   DELETE /api/subscription-plans/:id
// @access  Private (Owner only)
exports.deletePlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }
    
    // Check if plan is being used by any active subscriptions
    const Subscription = require('../models/Subscription');
    const activeSubscriptions = await Subscription.countDocuments({
      planId: plan._id,
      status: { $in: ['active', 'pending'] }
    });
    
    if (activeSubscriptions > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete plan. It is currently used by ${activeSubscriptions} active subscription(s). Deactivate it instead.`
      });
    }
    
    await plan.deleteOne();
    
    console.log(`✅ Plan deleted: ${plan.displayName}`);
    
    res.status(200).json({
      success: true,
      message: 'Subscription plan deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting subscription plan',
      error: error.message
    });
  }
};

