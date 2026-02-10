const User = require('../models/User');
const AccessRequest = require('../models/AccessRequest');
const Lead = require('../models/Lead');
const AppNotification = require('../models/AppNotification');
const smsService = require('../services/smsService');
const { generateToken } = require('../middleware/auth');
const { isServiceAvailable } = require('../utils/serviceAreaHelper');
const bcrypt = require('bcryptjs');
const { sanitizeMobile } = require('../utils/validation');

// @desc    Check service availability
// @route   POST /api/auth/check-service
// @access  Public
//test
exports.checkServiceAvailability = async (req, res) => {
  try {
    const { pincode } = req.body;

    if (!pincode) {
      return res.status(400).json({
        success: false,
        message: 'Pincode is required'
      });
    }

    const serviceAvailable = await isServiceAvailable(pincode);

    if (!serviceAvailable) {
      await Lead.create({
        name: 'Service Check',
        phone: '0000000000',
        area: pincode,
        source: 'app'
      });

      return res.status(200).json({
        success: false,
        serviceAvailable: false,
        message: 'Service not available in your area'
      });
    }

    return res.status(200).json({
      success: true,
      serviceAvailable: true,
      message: 'Service available'
    });
  } catch (error) {
    console.error('Check service availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking service availability',
      error: error.message
    });
  }
};

// @desc    Login - Step 1: Verify credentials and send OTP
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide user ID and password'
      });
    }

    // Find user
    const user = await User.findOne({ userId }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Please contact support.'
      });
    }

    // Verify password
    const isPasswordMatch = await user.comparePassword(password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // DIRECT LOGIN FLOW (OTP disabled for now)
    // Both OWNER and CUSTOMER: Direct login with JWT token
    
    console.log(`🔑 LOGIN: ${user.userId} (${user.role}) - Direct login`);
    
    // Generate JWT token directly
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      requiresOtp: false,
      token: token,
      data: {
        userId: user.userId,
        name: user.name,
        mobile: user.mobile,
        role: user.role,
        requiresPasswordChange: !user.isPasswordChanged
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during login',
      error: error.message
    });
  }
};

// @desc    Login - Step 2: Verify OTP and complete login
// @route   POST /api/auth/verify-otp
// @access  Public (OWNER ONLY)
exports.verifyOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide user ID and OTP'
      });
    }

    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // SECURITY: Verify OTP is only for OWNER role
    if (user.role !== 'owner') {
      console.warn(`⚠️ Unauthorized OTP verification attempt for ${user.role}: ${userId}`);
      return res.status(403).json({
        success: false,
        message: 'OTP verification is only available for owner accounts'
      });
    }

    // Verify OTP (now async - uses bcrypt.compare)
    const verification = await user.verifyOTP(otp);

    if (!verification.success) {
      await user.save(); // Save updated attempt count
      return res.status(400).json({
        success: false,
        message: verification.message,
        attemptsRemaining: user.otp ? Math.max(0, 3 - user.otp.attempts) : 0
      });
    }

    await user.save(); // Clear OTP after successful verification

    // Generate JWT token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token: token,
      data: {
        userId: user.userId,
        name: user.name,
        mobile: user.mobile,
        role: user.role,
        requiresPasswordChange: !user.isPasswordChanged
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during OTP verification',
      error: error.message
    });
  }
};

// @desc    Change password
// @route   POST /api/auth/change-password
// @access  Private (JWT required)
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    // Strict contract validation - reject extra fields
    const allowedFields = ['oldPassword', 'newPassword'];
    const extraFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
    
    if (extraFields.length > 0) {
      console.log(`Change password request with extra fields: ${extraFields.join(', ')}`);
      return res.status(400).json({
        success: false,
        message: `Unexpected fields: ${extraFields.join(', ')}. Only 'oldPassword' and 'newPassword' are accepted.`
      });
    }

    // Validate required fields (backup validation)
    if (!oldPassword) {
      console.log(`Change password failed: missing oldPassword for user ${req.user._id}`);
      return res.status(400).json({
        success: false,
        message: 'Current password is required'
      });
    }

    if (!newPassword) {
      console.log(`Change password failed: missing newPassword for user ${req.user._id}`);
      return res.status(400).json({
        success: false,
        message: 'New password is required'
      });
    }

    // Password strength validation (simple & realistic)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    
    if (!passwordRegex.test(newPassword)) {
      console.log(`Change password failed: weak password for user ${req.user._id}`);
      
      // Provide specific feedback
      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters long'
        });
      }
      if (!/[A-Z]/.test(newPassword)) {
        return res.status(400).json({
          success: false,
          message: 'Password must contain at least one uppercase letter'
        });
      }
      if (!/[a-z]/.test(newPassword)) {
        return res.status(400).json({
          success: false,
          message: 'Password must contain at least one lowercase letter'
        });
      }
      if (!/[0-9]/.test(newPassword)) {
        return res.status(400).json({
          success: false,
          message: 'Password must contain at least one number'
        });
      }
      
      // Fallback generic message
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters and contain uppercase, lowercase, and number'
      });
    }

    // Fetch user from database with password field
    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      console.error(`Change password failed: user not found with ID ${req.user._id}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify old password using bcrypt.compare
    const isMatch = await user.comparePassword(oldPassword);

    if (!isMatch) {
      console.log(`Change password failed: incorrect old password for user ${user.userId}`);
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password (bcrypt hash handled by User model pre-save hook)
    user.password = newPassword;
    user.isPasswordChanged = true;
    await user.save();

    console.log(`Password changed successfully for user ${user.userId}`);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error changing password. Please try again.'
    });
  }
};

// @desc    Request access (for new users)
// @route   POST /api/auth/request-access
// @access  Public
exports.requestAccess = async (req, res) => {
  try {
    const { name, mobile, address, planType, mealPreferences, message } = req.body;

    if (!name || !mobile || !planType) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, mobile, and plan type'
      });
    }

    const pincode = address?.pincode;

    // 🔒 SERVICE AVAILABILITY CHECK (BACKEND AUTHORITY)
    const serviceAvailable = await isServiceAvailable(pincode);

    if (!serviceAvailable) {
      // Save as Lead
      await Lead.create({
        name,
        phone: mobile,
        area: pincode,
        source: 'app'
      });

      return res.status(200).json({
        success: false,
        message: 'Service is not available in your area. Our team will contact you when service starts.'
      });
    }

    // Check if mobile already exists
    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this mobile number already exists'
      });
    }

    // Check if request already exists
    const existingRequest = await AccessRequest.findOne({ mobile, status: 'pending' });
    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'Access request already submitted. Please wait for approval.'
      });
    }

    // Create access request
    const accessRequest = await AccessRequest.create({
      name,
      mobile,
      address,
      planType,
      mealPreferences,
      message
    });

    res.status(201).json({
      success: true,
      message: 'Access request submitted successfully. You will receive credentials via SMS once approved.',
      data: accessRequest
    });
  } catch (error) {
    console.error('Access request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting access request',
      error: error.message
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -otp');

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: error.message
    });
  }
};

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
exports.resendOTP = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide user ID'
      });
    }

    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new OTP (now async)
    const otp = await user.generateOTP();
    await user.save();

    // Send OTP via SMS
    const smsResult = await smsService.sendOTP(user.mobile, otp, user._id);

    if (!smsResult.success) {
      user.otp = undefined;
      await user.save();

      return res.status(503).json({
        success: false,
        message: 'OTP service unavailable. Please try again later.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'OTP resent successfully',
      data: {
        otpExpiry: user.otp.expiry
      }
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resending OTP',
      error: error.message
    });
  }
};

// @desc    Forgot password - Send OTP
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { mobile } = req.body;
    const cleanMobile = sanitizeMobile(mobile);

    if (!cleanMobile) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile number'
      });
    }

    // Find user by mobile
    const user = await User.findOne({ mobile: cleanMobile });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this mobile number'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Please contact support.'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash OTP with bcrypt for security
    const salt = await bcrypt.genSalt(10);
    const hashedOTP = await bcrypt.hash(otp, salt);

    // Save OTP with 10-minute expiry
    user.otp = {
      code: hashedOTP,
      expiry: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      attempts: 0
    };
    await user.save();

    // Send OTP via SMS
    const smsResult = await smsService.sendPasswordResetOTP(user.mobile, otp, user._id);

    if (!smsResult.success) {
      user.otp = undefined;
      await user.save();

      return res.status(503).json({
        success: false,
        message: 'SMS service unavailable. Please try again later.'
      });
    }

    // Create AppNotification
    await AppNotification.create({
      relatedUser: user._id,
      type: 'password_reset',
      title: 'Password Reset OTP',
      message: 'OTP sent for password reset',
      relatedModel: 'User',
      relatedId: user._id
    });

    res.status(200).json({
      success: true,
      message: 'Password reset OTP sent successfully',
      data: {
        otpExpiry: user.otp.expiry
      }
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending password reset OTP',
      error: error.message
    });
  }
};

// @desc    Reset password with OTP
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { mobile, otp, newPassword } = req.body;
    const cleanMobile = sanitizeMobile(mobile);

    if (!cleanMobile || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile, OTP, and new password'
      });
    }

    // Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters and contain uppercase, lowercase, and number'
      });
    }

    // Find user by mobile
    const user = await User.findOne({ mobile: cleanMobile });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this mobile number'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Please contact support.'
      });
    }

    // Verify OTP exists
    if (!user.otp || !user.otp.code) {
      return res.status(400).json({
        success: false,
        message: 'No OTP generated. Please request password reset first.'
      });
    }

    // Check OTP expiry
    if (new Date() > user.otp.expiry) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired. Please request a new one.'
      });
    }

    // Check attempts
    if (user.otp.attempts >= 3) {
      return res.status(400).json({
        success: false,
        message: 'Maximum OTP attempts exceeded. Please request a new OTP.'
      });
    }

    // Verify OTP
    const isMatch = await bcrypt.compare(otp, user.otp.code);

    if (!isMatch) {
      user.otp.attempts += 1;
      await user.save();

      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
        attemptsRemaining: Math.max(0, 3 - user.otp.attempts)
      });
    }

    // Update password (bcrypt hash handled by pre-save hook)
    user.password = newPassword;
    user.otp = undefined; // Clear OTP
    user.forcePasswordChange = false; // Reset force change flag
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password',
      error: error.message
    });
  }
};
