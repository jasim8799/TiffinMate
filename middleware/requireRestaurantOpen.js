const RestaurantStatus = require('../models/RestaurantStatus');
const { getNextOrderableDate } = require('../utils/dateService');

function normalize(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

module.exports = async (req, res, next) => {
  try {
    const status = await RestaurantStatus.findOne();

    if (!status) return next();

    // Global close
    if (status.isOpen === false) {
      return res.status(403).json({
        success: false,
        message: status.message || 'Restaurant is currently closed'
      });
    }

    if (status.closedDate) {
      // IMPORTANT:
      // Determine actual deliveryDate being requested
      let deliveryDate;

      if (req.body && req.body.offset !== undefined) {
        deliveryDate = getNextOrderableDate(req.body.offset);
      } else {
        deliveryDate = getNextOrderableDate(0);
      }

      const closed = normalize(new Date(status.closedDate));
      const requested = normalize(new Date(deliveryDate));

      if (closed.getTime() === requested.getTime()) {
        return res.status(403).json({
          success: false,
          message: status.message || 'Restaurant is closed for this delivery date'
        });
      }
    }

    next();
  } catch (error) {
    console.error('Restaurant status middleware error:', error);
    next(); // Never block on middleware failure
  }
};
