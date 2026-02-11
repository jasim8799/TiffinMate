const RestaurantStatus = require('../models/RestaurantStatus');

module.exports = async (req, res, next) => {
  try {
    const status = await RestaurantStatus.findOne();

    // ✅ If no status doc exists → assume OPEN
    if (!status) {
      return next();
    }

    // ✅ Only block if explicitly closed
    if (status.isOpen === false) {
      return res.status(403).json({
        success: false,
        message: status.message || 'Restaurant is closed today'
      });
    }

    next();
  } catch (error) {
    console.error('Error checking restaurant status:', error);

    // ✅ Never block meals if middleware fails
    next();
  }
};
