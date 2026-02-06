const Subscription = require('../models/Subscription');
const Delivery = require('../models/Delivery');
const moment = require('moment');

// @desc    Get user's calendar (subscription-based delivery status)
// @route   GET /api/calendar/my
// @access  Private
exports.getMyCalendar = async (req, res) => {
  try {
    // Find user's active subscription
    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: 'active'
    });

    if (!subscription) {
      // Return success with empty data instead of 404
      return res.status(200).json({
        success: true,
        message: 'No active subscription',
        data: []
      });
    }

    // Generate date range from subscription
    const startDate = moment(subscription.startDate).startOf('day');
    const endDate = moment(subscription.endDate).endOf('day');
    const today = moment().startOf('day');

    // Fetch all deliveries for this subscription
    const deliveries = await Delivery.find({
      user: req.user._id,
      subscription: subscription._id,
      deliveryDate: {
        $gte: startDate.toDate(),
        $lte: endDate.toDate()
      }
    }).select('deliveryDate status');

    // Create a map of delivery statuses by date
    const deliveryMap = {};
    deliveries.forEach(delivery => {
      const dateKey = moment(delivery.deliveryDate).format('YYYY-MM-DD');
      deliveryMap[dateKey] = delivery.status;
    });

    // Generate calendar data for entire subscription period
    const calendarData = [];
    let currentDate = moment(startDate);

    while (currentDate.isSameOrBefore(endDate, 'day')) {
      const dateKey = currentDate.format('YYYY-MM-DD');
      let status;

      if (currentDate.isBefore(today, 'day')) {
        // Past dates
        if (deliveryMap[dateKey]) {
          // Has delivery record
          const deliveryStatus = deliveryMap[dateKey];
          if (deliveryStatus === 'delivered') {
            status = 'delivered';
          } else if (deliveryStatus === 'paused' || deliveryStatus === 'disabled') {
            status = 'skipped';
          } else {
            status = 'expired'; // Was scheduled but not delivered
          }
        } else {
          // No delivery record for past date
          status = 'expired';
        }
      } else if (currentDate.isSame(today, 'day')) {
        // Today
        if (deliveryMap[dateKey]) {
          const deliveryStatus = deliveryMap[dateKey];
          if (deliveryStatus === 'delivered') {
            status = 'delivered';
          } else if (deliveryStatus === 'paused' || deliveryStatus === 'disabled') {
            status = 'skipped';
          } else {
            status = 'pending'; // Preparing or on-the-way
          }
        } else {
          status = 'pending'; // Scheduled for today
        }
      } else {
        // Future dates
        if (deliveryMap[dateKey]) {
          const deliveryStatus = deliveryMap[dateKey];
          if (deliveryStatus === 'paused' || deliveryStatus === 'disabled') {
            status = 'skipped';
          } else {
            status = 'upcoming';
          }
        } else {
          status = 'upcoming'; // Will be delivered
        }
      }

      calendarData.push({
        date: dateKey,
        status: status
      });

      currentDate.add(1, 'day');
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
