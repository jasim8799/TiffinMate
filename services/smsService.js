const axios = require('axios');
const NotificationLog = require('../models/NotificationLog');
const logger = require('../utils/logger');
const { isValidIndianMobile, sanitizeMobile, normalizeMobileForSMS } = require('../utils/validation');

class Fast2SMSService {
  constructor() {
    this.apiKey = process.env.FAST2SMS_API_KEY;
    this.baseURL = 'https://www.fast2sms.com/dev/bulkV2';
  }

  async sendSMS(mobile, message, type = 'other', userId = null) {
    try {
      // Validate API key
      if (!this.apiKey) {
        const error = 'Fast2SMS API key not configured in environment variables';
        logger.error(error);
        throw new Error(error);
      }

      // Sanitize and validate mobile number
      const cleanMobile = sanitizeMobile(mobile);
      
      if (!isValidIndianMobile(cleanMobile)) {
        logger.error(`Invalid mobile format for ${type} SMS: ******${cleanMobile.substring(6) || 'XXXX'}`);
        throw new Error('Invalid mobile number format');
      }

      // Normalize to Fast2SMS format: 91XXXXXXXXXX
      const normalizedMobile = normalizeMobileForSMS(cleanMobile);

      // Log SMS attempt (without exposing full number)
      logger.info(`Sending ${type} SMS to ******${cleanMobile.substring(6)}`);

      const response = await axios.post(this.baseURL, {
        route: 'v3',
        sender_id: 'TIFFIN',
        message: message,
        language: 'english',
        flash: 0,
        numbers: normalizedMobile
      }, {
        headers: {
          'authorization': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      // Check if SMS was sent successfully
      const success = response.data && response.data.return === true;

      // Log notification in database
      if (userId) {
        await NotificationLog.create({
          user: userId,
          mobile: cleanMobile,
          type: type,
          message: message,
          status: success ? 'sent' : 'failed',
          response: response.data,
          sentAt: new Date()
        });
      }

      if (success) {
        logger.success(`${type} SMS sent successfully to ******${cleanMobile.substring(6)}`);
      } else {
        logger.warn(`SMS may have failed: ${JSON.stringify(response.data)}`);
      }

      return {
        success: success,
        data: response.data
      };
    } catch (error) {
      logger.error(`Fast2SMS Error (${type}):`, error);

      // Log failed notification in database
      if (userId && mobile) {
        try {
          await NotificationLog.create({
            user: userId,
            mobile: sanitizeMobile(mobile),
            type: type,
            message: message,
            status: 'failed',
            errorMessage: error.message
          });
        } catch (logError) {
          logger.error('Failed to log SMS error:', logError);
        }
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send OTP via Fast2SMS Quick Transactional Route ('q')
   * This uses the SAME method as the School Management System - NO DLT required
   * @param {string} mobile - 10-digit Indian mobile number
   * @param {string} otp - 6-digit OTP
   * @param {string} userId - User ID for logging
   * @returns {Object} { success: boolean, data?: object, error?: string }
   */
  async sendOTP(mobile, otp, userId) {
    try {
      // Validate API key
      if (!this.apiKey) {
        logger.error('Fast2SMS API key not configured in environment');
        return {
          success: false,
          error: 'OTP service not configured'
        };
      }

      // Validate OTP format (6 digits)
      if (!/^\d{6}$/.test(otp)) {
        logger.error('Invalid OTP format - must be 6 digits');
        return {
          success: false,
          error: 'Invalid OTP format'
        };
      }

      // Sanitize mobile number (remove spaces, dashes, etc.)
      const cleanMobile = sanitizeMobile(mobile);
      
      // Validate Indian mobile number (10 digits, starts with 6-9)
      if (!isValidIndianMobile(cleanMobile)) {
        logger.error(`Invalid Indian mobile number format`);
        return {
          success: false,
          error: 'Invalid mobile number'
        };
      }

      // Log attempt (mask mobile for security)
      logger.info(`Attempting to send OTP to ******${cleanMobile.substring(6)}`);

      // CRITICAL: Use Quick Transactional Route 'q' (SAME AS SCHOOL PROJECT)
      // This route does NOT require DLT templates or OTP Message API
      // Replace {{OTP}} placeholder with actual OTP in the message
      const message = `Your The Home Kitchen login OTP is ${otp}. Valid for 5 minutes. Do not share this OTP.`;

      // EXACT Fast2SMS Quick Transactional payload structure
      const payload = {
        route: 'q',                 // Quick Transactional Route - NO DLT required
        language: 'english',
        message: message,           // Dynamic message with OTP embedded
        numbers: cleanMobile        // 10-digit number WITHOUT country code
      };

      // Make API request
      const response = await axios.post(this.baseURL, payload, {
        headers: {
          'authorization': this.apiKey,   // NO "Bearer" prefix
          'Content-Type': 'application/json'
        },
        timeout: 15000  // 15 second timeout
      });

      // Check Fast2SMS response
      const success = response.data && response.data.return === true;

      // Log to database (don't store actual OTP)
      if (userId) {
        await NotificationLog.create({
          user: userId,
          mobile: cleanMobile,
          type: 'otp',
          message: 'OTP sent via Quick Transactional route',  // Don't log actual OTP
          status: success ? 'sent' : 'failed',
          response: response.data,
          sentAt: new Date()
        });
      }

      if (success) {
        logger.success(`OTP sent successfully to ******${cleanMobile.substring(6)}`);
        return {
          success: true,
          data: response.data
        };
      } else {
        logger.error(`Fast2SMS returned non-success response: ${JSON.stringify(response.data)}`);
        return {
          success: false,
          error: 'OTP service error',
          data: response.data
        };
      }

    } catch (error) {
      // Log full error details (but not OTP)
      logger.error(`Fast2SMS OTP Error: ${error.message}`);
      
      if (error.response) {
        logger.error(`Fast2SMS HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      }

      // Log failure to database
      if (userId && mobile) {
        try {
          await NotificationLog.create({
            user: userId,
            mobile: sanitizeMobile(mobile),
            type: 'otp',
            message: 'OTP failed',
            status: 'failed',
            errorMessage: error.message,
            sentAt: new Date()
          });
        } catch (logError) {
          logger.error('Failed to log OTP error to database:', logError);
        }
      }

      return {
        success: false,
        error: 'OTP service unavailable'
      };
    }
  }

  async sendCredentials(mobile, userId, password) {
    const message = `Welcome to The Home Kitchen! Your User ID: ${userId}, Temporary Password: ${password}. Please change your password on first login.`;
    return await this.sendSMS(mobile, message, 'credentials');
  }

  async sendSubscriptionReminder(mobile, userName, daysRemaining, userId) {
    const message = `Hi ${userName}, your The Home Kitchen subscription will expire in ${daysRemaining} days. Please renew to continue enjoying our service.`;
    return await this.sendSMS(mobile, message, 'subscription-reminder', userId);
  }

  async sendSubscriptionExpiry(mobile, userName, userId) {
    const message = `Hi ${userName}, your The Home Kitchen subscription has expired. Please contact us to renew your service.`;
    return await this.sendSMS(mobile, message, 'subscription-expiry', userId);
  }

  async sendTrialExpired(mobile, userName, userId) {
    const message = `Hi ${userName}, your 3-day trial period has ended. Thank you for trying The Home Kitchen! Please purchase a subscription to continue ordering delicious meals.`;
    return await this.sendSMS(mobile, message, 'trial-expired', userId);
  }

  async sendServiceDisabled(mobile, userName, userId) {
    const message = `Hi ${userName}, your The Home Kitchen service has been temporarily disabled due to subscription expiry. Please renew to resume service.`;
    return await this.sendSMS(mobile, message, 'subscription-disabled', userId);
  }

  async sendDeliveryPreparing(mobile, userName, userId) {
    const message = `Hi ${userName}, your food is being prepared. It will be delivered soon!`;
    return await this.sendSMS(mobile, message, 'delivery-preparing', userId);
  }

  async sendDeliveryOnWay(mobile, userName, userId) {
    const message = `Hi ${userName}, your food is on the way! We will deliver within 1 hour. Please stay at your delivery location.`;
    return await this.sendSMS(mobile, message, 'delivery-on-way', userId);
  }

  async sendDeliveryDelivered(mobile, userName, userId) {
    const message = `Hi ${userName}, your tiffin has been delivered. Enjoy your meal!`;
    return await this.sendSMS(mobile, message, 'delivery-delivered', userId);
  }

  async sendPaymentReminder(mobile, userName, amount, userId) {
    const message = `Hi ${userName}, reminder: Your payment of Rs.${amount} is pending. Please make the payment at your earliest convenience.`;
    return await this.sendSMS(mobile, message, 'payment-reminder', userId);
  }

  async sendPaymentOverdue(mobile, userName, amount, userId) {
    const message = `Hi ${userName}, your payment of Rs.${amount} is overdue. Please clear the dues to avoid service interruption.`;
    return await this.sendSMS(mobile, message, 'payment-overdue', userId);
  }

  async sendAccessApproved(mobile, userName, userId, password) {
    const message = `Hi ${userName}, your access request has been approved! User ID: ${userId}, Password: ${password}. Download The Home Kitchen app to login.`;
    return await this.sendSMS(mobile, message, 'access-approved');
  }

  async sendAccessRejected(mobile, userName, reason) {
    const message = `Hi ${userName}, we regret to inform you that your access request has been rejected. Reason: ${reason}. Please contact us for more details.`;
    return await this.sendSMS(mobile, message, 'access-rejected');
  }

  async sendPasswordResetOTP(mobile, otp, userId) {
    const message = `Your password reset OTP is ${otp}. Valid for 10 minutes. Do not share this OTP.`;
    return await this.sendSMS(mobile, message, 'password-reset', userId);
  }
}

module.exports = new Fast2SMSService();
