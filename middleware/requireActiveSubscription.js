const Subscription = require('../models/Subscription');
const moment = require('moment');

module.exports = async function requireActiveSubscription(req, res, next) {
  try {
    if (req.user.role !== 'customer') {
      return next();
    }

    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: { $in: ['active', 'grace'] }
    });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'Active subscription required'
      });
    }

    req.subscription = subscription;

    next();

  } catch (error) {
    console.error('Subscription lock error:', error);
    res.status(500).json({
      success: false,
      message: 'Subscription validation failed'
    });
  }
};
