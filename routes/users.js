const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');

// GET /profile/:userId
router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch latest ACTIVE or PAUSED subscription for the user
    const subscription = await Subscription.findOne({
      userId: userId,
      status: { $in: ['ACTIVE', 'PAUSED'] }
    }).sort({ createdAt: -1 });

    let activeSubscription = null;
    if (subscription) {
      activeSubscription = {
        id: subscription._id,
        providerName: subscription.providerName,
        plan: subscription.plan,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status
      };
    }

    // Static user info (for now)
    const userProfile = {
      userId: userId,
      name: 'Test User',
      phone: '9999999999',
      city: 'Surat',
      address: 'Adajan, Surat',
      activeSubscription: activeSubscription,
    };

    res.json(userProfile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
