const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');

/**
 * CREATE SUBSCRIPTION
 * POST /api/subscriptions
 */
router.post('/', async (req, res) => {
  try {
    const { userId, providerId, mealType } = req.body;

    // Validate required fields
    if (!userId || !providerId || !mealType) {
      return res.status(400).json({
        success: false,
        message: 'userId, providerId and mealType are required',
      });
    }

    // Check if user already has an active subscription
    const existingSubscription = await Subscription.findOne({
      userId,
      status: 'Active', // ✅ MATCHES SCHEMA
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        message: 'User already has an active subscription',
      });
    }

    // Create new subscription
    const subscription = new Subscription({
      userId,
      providerId,
      mealType,          // ✅ REQUIRED FIELD
      status: 'Active',  // ✅ VALID ENUM VALUE
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const savedSubscription = await subscription.save();

    const populatedSubscription = await Subscription.findById(savedSubscription._id)
      .populate('providerId');

    return res.status(201).json({
      success: true,
      data: populatedSubscription,
    });
  } catch (error) {
    console.error('Subscription create error:', error);
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * PAUSE SUBSCRIPTION
 * POST /api/subscriptions/pause/:subscriptionId
 */
router.post('/pause/:subscriptionId', async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    subscription.status = 'Paused'; // ✅ MATCHES SCHEMA
    await subscription.save();

    return res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * RESUME SUBSCRIPTION
 * POST /api/subscriptions/resume/:subscriptionId
 */
router.post('/resume/:subscriptionId', async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    subscription.status = 'Active'; // ✅ MATCHES SCHEMA
    await subscription.save();

    return res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
