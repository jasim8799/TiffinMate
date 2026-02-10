const RestaurantStatus = require('../models/RestaurantStatus');

module.exports = async (req, res, next) => {
  try {
    const status = await RestaurantStatus.findOne();

    if (!status?.isOpen) {
      return res.status(403).json({
        success: false,
        message: status?.message || 'Restaurant is closed today'
      });
    }

    next();
  } catch (error) {
    console.error('Error checking restaurant status:', error);
    // Allow request to proceed if there's an error checking status
    next();
  }
};
