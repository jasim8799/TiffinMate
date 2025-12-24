const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');

// CREATE SUBSCRIPTION
router.post('/', async (req, res) => {
  try {
    const { userId, providerId, mealType } = req.body;

    const existingSubscription = await Subscription.findOne({
      userId,
      status: 'ACTIVE',
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        message: 'User already has an active subscription',
      });
    }

    const subscription = new Subscription({
      userId,
      providerId,
      plan: mealType,
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await subscription.save();

    const populated = await Subscription.findById(subscription._id)
      .populate('providerId');

    res.status(201).json({
      success: true,
      data: populated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PAUSE
router.post('/pause/:subscriptionId', async (req, res) => {
  const subscription = await Subscription.findById(req.params.subscriptionId);
  subscription.status = 'PAUSED';
  await subscription.save();
  res.json({ success: true });
});

// RESUME
router.post('/resume/:subscriptionId', async (req, res) => {
  const subscription = await Subscription.findById(req.params.subscriptionId);
  subscription.status = 'ACTIVE';
  await subscription.save();
  res.json({ success: true });
});

module.exports = router;
