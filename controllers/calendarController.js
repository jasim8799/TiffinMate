const Subscription = require('../models/Subscription');
const MealOrder = require('../models/MealOrder');
const moment = require('moment');

// @desc    Get user's calendar (subscription-based meal delivery status)
// @route   GET /api/calendar/my
// @access  Private (any authenticated user, no active subscription required)
exports.getMyCalendar = async (req, res) => {
  try {
    // Find the user's most recent subscription (any status)
    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: { $in: ['active', 'grace', 'paused', 'expired', 'pending_approval', 'disabled'] }
    }).sort({ startDate: -1 });

    if (!subscription) {
      return res.status(200).json({
        success: true,
        message: 'No subscription found',
        data: []
      });
    }

    // Generate date range from subscription
    const startDate = moment(subscription.startDate).startOf('day');
    const endDate   = moment(subscription.endDate).startOf('day');
    const today     = moment().startOf('day');

    const startKey = startDate.format('YYYY-MM-DD');
    const endKey   = endDate.format('YYYY-MM-DD');

    // Fetch all MealOrders for this user + subscription within the date range
    const mealOrders = await MealOrder.find({
      user: req.user._id,
      subscription: subscription._id,
      deliveryDate: {
        $gte: startDate.toDate(),
        $lte: endDate.clone().endOf('day').toDate()
      }
    }).select('deliveryDate selectedMeal status');

    // Build a map: dateKey -> { hasSkipped: bool, hasNormal: bool }
    const mealOrderMap = {};
    mealOrders.forEach(order => {
      const dateKey = moment(order.deliveryDate).format('YYYY-MM-DD');
      if (!mealOrderMap[dateKey]) {
        mealOrderMap[dateKey] = { hasSkipped: false, hasNormal: false };
      }

      const isSkipped =
        order.selectedMeal?.isSkip === true ||
        order.status === 'cancelled';

      if (isSkipped) {
        mealOrderMap[dateKey].hasSkipped = true;
      } else {
        mealOrderMap[dateKey].hasNormal = true;
      }
    });

    // Build calendar entries for the entire subscription period
    const calendarData = [];
    let cursor = startDate.clone();

    while (cursor.isSameOrBefore(endDate, 'day')) {
      const dateKey = cursor.format('YYYY-MM-DD');
      let status;

      // Subscription boundary markers take priority
      if (dateKey === startKey) {
        status = 'subscription_start';
      } else if (dateKey === endKey) {
        status = 'subscription_end';
      } else {
        const orderInfo = mealOrderMap[dateKey];

        // A day is skipped when ALL its orders are skipped (or explicitly cancelled)
        // and there are no normal orders
        const isSkipped = orderInfo && orderInfo.hasSkipped && !orderInfo.hasNormal;

        if (isSkipped) {
          status = 'skipped';
        } else if (cursor.isBefore(today, 'day')) {
          status = 'delivered';
        } else if (cursor.isSame(today, 'day')) {
          status = 'pending';
        } else {
          status = 'upcoming';
        }
      }

      calendarData.push({ date: dateKey, status });
      cursor.add(1, 'day');
    }

    res.status(200).json({
      success: true,
      data: calendarData
    });
  } catch (error) {
    console.error('Get calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching calendar',
      error: error.message
    });
  }
};

