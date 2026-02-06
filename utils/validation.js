/**
 * Validation utilities for TiffinMate backend
 */

/**
 * Validates Indian mobile number format
 * @param {string} mobile - Mobile number to validate
 * @returns {boolean} - True if valid, false otherwise
 */
exports.isValidIndianMobile = (mobile) => {
  if (!mobile || typeof mobile !== 'string') {
    return false;
  }
  
  // Remove any spaces or special characters
  const cleanMobile = mobile.replace(/[\s-]/g, '');
  
  // Indian mobile: 10 digits, starts with 6, 7, 8, or 9
  return /^[6-9]\d{9}$/.test(cleanMobile);
};

/**
 * Formats Indian mobile number for display (masks middle digits)
 * @param {string} mobile - Mobile number to format
 * @returns {string} - Masked mobile number (e.g., ******7890)
 */
exports.maskMobileNumber = (mobile) => {
  if (!mobile || mobile.length !== 10) {
    return '**********';
  }
  
  // Show only last 4 digits
  return `******${mobile.substring(6)}`;
};

/**
 * Validates OTP format
 * @param {string} otp - OTP to validate
 * @returns {boolean} - True if valid 6-digit OTP
 */
exports.isValidOTP = (otp) => {
  if (!otp || typeof otp !== 'string') {
    return false;
  }
  
  return /^\d{6}$/.test(otp);
};

/**
 * Validates Indian pincode format
 * @param {string} pincode - Pincode to validate
 * @returns {boolean} - True if valid 6-digit pincode
 */
exports.isValidPincode = (pincode) => {
  if (!pincode || typeof pincode !== 'string') {
    return false;
  }
  
  return /^\d{6}$/.test(pincode);
};

/**
 * Sanitizes mobile number (removes spaces, dashes, etc.)
 * @param {string} mobile - Mobile number to sanitize
 * @returns {string} - Clean mobile number
 */
exports.sanitizeMobile = (mobile) => {
  if (!mobile || typeof mobile !== 'string') {
    return '';
  }
  
  // Remove all non-digit characters
  return mobile.replace(/\D/g, '');
};

/**
 * Normalizes Indian mobile number for Fast2SMS API
 * Converts 10-digit number to 91XXXXXXXXXX format
 * @param {string} mobile - 10-digit Indian mobile number
 * @returns {string} - Normalized mobile in 91XXXXXXXXXX format
 */
exports.normalizeMobileForSMS = (mobile) => {
  const cleanMobile = exports.sanitizeMobile(mobile);
  
  // If already has country code, return as is
  if (cleanMobile.startsWith('91') && cleanMobile.length === 12) {
    return cleanMobile;
  }
  
  // Add country code if 10-digit number
  if (cleanMobile.length === 10) {
    return `91${cleanMobile}`;
  }
  
  return cleanMobile;
};

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid email
 */
exports.isValidEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates password strength
 * @param {string} password - Password to validate
 * @returns {Object} - { valid: boolean, message: string }
 */
exports.validatePassword = (password) => {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  
  if (password.length < 6) {
    return { valid: false, message: 'Password must be at least 6 characters' };
  }
  
  // Check for at least one uppercase, one lowercase, and one number
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  
  if (!hasUpperCase || !hasLowerCase || !hasNumber) {
    return { 
      valid: false, 
      message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number' 
    };
  }
  
  return { valid: true, message: 'Password is valid' };
};

module.exports = exports;
