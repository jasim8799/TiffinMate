const RestaurantStatus = require('../models/RestaurantStatus');
const moment = require('moment-timezone');
const { getNextOrderableDeliveryMoment } = require('../utils/deliveryDateHelper');

module.exports = async (req, res, next) => {
  try {
    const status = await RestaurantStatus.findOne();

    // ✅ If no status doc exists → assume OPEN
    if (!status) {
      return next();
    }

    // ✅ Existing: block if globally closed
    if (status.isOpen === false) {
      return res.status(403).json({
        success: false,
        message: status.message || 'Restaurant is closed today'
      });
    }

    // ✅ BUG 2 FIX: Date-scoped block — check if closedDate matches the effective delivery date.
    // The effective delivery date is what selectMeal & skipMeal will operate on.
    // After the closed date passes into the past, this check auto-clears (no manual reset needed).
    if (status.closedDate) {
      const closedDay = moment.tz(status.closedDate, 'Asia/Kolkata').startOf('day');
      const effectiveDay = getNextOrderableDeliveryMoment().startOf('day');
      if (closedDay.isSame(effectiveDay, 'day')) {
        return res.status(403).json({
          success: false,
          message: status.message || 'Restaurant is closed for tomorrow'
        });
      }
    }

    next();
  } catch (error) {
    console.error('Error checking restaurant status:', error);

    // ✅ Never block meals if middleware fails
    next();
  }
};
