const { body, param, query, validationResult } = require('express-validator');

// Validation middleware to check for errors
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

// Auth validations
exports.loginValidation = [
  body('userId')
    .trim()
    .notEmpty()
    .withMessage('User ID is required')
    .isLength({ min: 3, max: 50 })
    .withMessage('User ID must be between 3 and 50 characters'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
];

exports.otpValidation = [
  body('userId')
    .trim()
    .notEmpty()
    .withMessage('User ID is required'),
  body('otp')
    .trim()
    .notEmpty()
    .withMessage('OTP is required')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits')
    .isNumeric()
    .withMessage('OTP must be numeric')
];

exports.changePasswordValidation = [
  body('oldPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
  // NOTE: No confirmPassword required - Flutter app handles confirmation on client side
];

exports.forgotPasswordValidation = [
  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required')
];

exports.resetPasswordValidation = [
  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required'),
  body('otp')
    .trim()
    .notEmpty()
    .withMessage('OTP is required')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits'),
  body('newPassword')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
];

exports.accessPreCheckValidation = [
  body('pincode')
    .trim()
    .notEmpty()
    .withMessage('Pincode is required')
    .matches(/^\d{6}$/)
    .withMessage('Invalid pincode')
];

exports.accessRequestValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required')
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Invalid Indian mobile number'),
  body('address.street')
    .trim()
    .notEmpty()
    .withMessage('Street address is required'),
  body('address.city')
    .trim()
    .notEmpty()
    .withMessage('City is required'),
  body('address.state')
    .trim()
    .notEmpty()
    .withMessage('State is required'),
  body('address.pincode')
    .trim()
    .notEmpty()
    .withMessage('Pincode is required')
    .matches(/^\d{6}$/)
    .withMessage('Invalid pincode'),
  body('planType')
    .notEmpty()
    .withMessage('Plan type is required')
    .isIn(['weekly', 'monthly'])
    .withMessage('Invalid plan type')
];

// Subscription validations
exports.createSubscriptionValidation = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID'),
  body('planType')
    .notEmpty()
    .withMessage('Plan type is required')
    .isIn(['weekly', 'monthly'])
    .withMessage('Plan type must be weekly or monthly'),
  body('startDate')
    .notEmpty()
    .withMessage('Start date is required')
    .isISO8601()
    .withMessage('Invalid start date format'),
  body('totalDays')
    .notEmpty()
    .withMessage('Total days is required')
    .isInt({ min: 1 })
    .withMessage('Total days must be at least 1')
];

// Delivery validations
exports.deliveryStatusValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid delivery ID'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['preparing', 'on-the-way', 'delivered'])
    .withMessage('Invalid delivery status')
];

// Meal selection validation
exports.mealSelectionValidation = [
  body('deliveryDate')
    .notEmpty()
    .withMessage('Delivery date is required')
    .isISO8601()
    .withMessage('Invalid delivery date format'),
  body('lunch')
    .optional()
    .isString()
    .withMessage('Lunch must be a string'),
  body('dinner')
    .optional()
    .isString()
    .withMessage('Dinner must be a string')
];

// Payment validation
exports.paymentValidation = [
  body('subscriptionId')
    .notEmpty()
    .withMessage('Subscription ID is required')
    .isMongoId()
    .withMessage('Invalid subscription ID'),
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 0 })
    .withMessage('Amount must be a positive number'),
  body('paymentMethod')
    .notEmpty()
    .withMessage('Payment method is required')
    .isIn(['cash', 'upi'])
    .withMessage('Payment method must be cash or upi')
];

// MongoDB ID validation
exports.mongoIdValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid ID format')
];

module.exports = exports;
