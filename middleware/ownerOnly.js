/**
 * Owner Only Middleware
 * Ensures only owner role can access certain routes
 */

module.exports = (req, res, next) => {
  // req.user is set by auth middleware
  if (req.user && req.user.role === 'owner') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Owner role required.'
    });
  }
};
