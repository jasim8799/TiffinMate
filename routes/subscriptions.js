const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');

// POST /api/subscriptions - Create a new subscription
router.post('/', async (req, res) => {
  try {
    const { userId, providerId, mealType } = req.body;

    // Check if user already has an active subscription
    const existingSubscription = await Subscription.findOne({
      userId: userId,
      status: 'Active'
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'User already has an active subscription'
      });
    }

    const subscription = new Subscription({
      userId,
      providerId,
      mealType,
      status: 'Active'
    });

    const newSubscription = await subscription.save();
    const populatedSubscription = await Subscription.findById(newSubscription._id)
      .populate('providerId');

    res.status(201).json({
      success: true,
      data: populatedSubscription,
      message: ""
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

// GET /api/subscriptions/:userId - Get user's subscription
router.get('/:userId', async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      userId: req.params.userId,
      status: 'Active'
    }).populate('providerId');

    if (!subscription) {
      return res.json({
        success: true,
        data: null,
        message: ""
      });
    }

    res.json({
      success: true,
      data: subscription,
      message: ""
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

// POST /api/subscriptions/pause/:subscriptionId - Pause subscription
router.post('/pause/:subscriptionId', async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'Subscription not found'
      });
    }

    subscription.status = 'Paused';
    await subscription.save();

    const updatedSubscription = await Subscription.findById(subscription._id)
      .populate('providerId');

    res.json({
      success: true,
      data: updatedSubscription,
      message: ""
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

// POST /api/subscriptions/resume/:subscriptionId - Resume subscription
router.post('/resume/:subscriptionId', async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'Subscription not found'
      });
    }

    subscription.status = 'Active';
    await subscription.save();

    const updatedSubscription = await Subscription.findById(subscription._id)
      .populate('providerId');

    res.json({
      success: true,
      data: updatedSubscription,
      message: ""
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

// POST /api/subscriptions/pause-date - Pause subscription for a specific date
router.post('/pause-date', async (req, res) => {
  try {
    const { subscriptionId, date } = req.body;

    const subscription = await Subscription.findById(subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'Subscription not found'
      });
    }

    const pauseDate = new Date(date);
    if (subscription.pauseDates.some(d => d.toDateString() === pauseDate.toDateString())) {
      return res.status(400).json({
        success: false,
        data: null,
        message: 'Date already paused'
      });
    }

    subscription.pauseDates.push(pauseDate);
    await subscription.save();

    const updatedSubscription = await Subscription.findById(subscription._id)
      .populate('providerId');

    res.json({
      success: true,
      data: updatedSubscription,
      message: ""
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

// POST /api/subscriptions/mark-paid/:subscriptionId - Mark subscription as paid
router.post('/mark-paid/:subscriptionId', async (req, res) => {
  try {
    const { paymentMode } = req.body;

    const subscription = await Subscription.findById(req.params.subscriptionId);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        data: null,
        message: 'Subscription not found'
      });
    }

    subscription.paymentStatus = 'Paid';
    subscription.paymentMode = paymentMode || 'Cash';
    await subscription.save();

    const updatedSubscription = await Subscription.findById(subscription._id)
      .populate('providerId');

    res.json({
      success: true,
      data: updatedSubscription,
      message: ""
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

module.exports = router;
