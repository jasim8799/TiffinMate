const express = require('express');
const router = express.Router();
const {
  login,
  verifyOTP,
  changePassword,
  requestAccess,
  getMe,
  resendOTP,
  checkServiceAvailability,
  forgotPassword,
  resetPassword
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { otpLimiter, loginLimiter } = require('../middleware/rateLimiter');
const {
  loginValidation,
  otpValidation,
  changePasswordValidation,
  accessRequestValidation,
  accessPreCheckValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  validate
} = require('../middleware/validators');

// Apply rate limiting and validation to sensitive endpoints
router.post('/login', loginLimiter, loginValidation, validate, login);
router.post('/verify-otp', otpLimiter, otpValidation, validate, verifyOTP);
router.post('/resend-otp', otpLimiter, validate, resendOTP);
router.post(
  '/check-service',
  accessPreCheckValidation,
  validate,
  checkServiceAvailability
);
router.post('/request-access', accessRequestValidation, validate, requestAccess);
router.post('/forgot-password', forgotPasswordValidation, validate, forgotPassword);
router.post('/reset-password', resetPasswordValidation, validate, resetPassword);
router.post('/change-password', protect, changePasswordValidation, validate, changePassword);
router.get('/me', protect, getMe);

module.exports = router;
