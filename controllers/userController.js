const User = require('../models/User');
const Subscription = require('../models/Subscription');
const AppNotification = require('../models/AppNotification');
const moment = require('moment');
const smsService = require('../services/smsService');
const { createNotification } = require('./notificationController');
const socketService = require('../services/socketService');

// @desc    Get my profile (logged-in user)
// @route   GET /api/users/me
// @access  Private (JWT required)
exports.getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -otp');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        mobile: user.mobile,
        role: user.role,
        isActive: user.isActive,
        isPasswordChanged: user.isPasswordChanged,
        address: user.address,
        profileImage: user.profileImage || null,
        idDocument: user.idDocument || null,
        idDocumentType: user.idDocumentType || null,
        idVerificationStatus: user.idVerificationStatus || 'not_uploaded',
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get my profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: error.message
    });
  }
};

// @desc    Update my profile (logged-in user)
// @route   PUT /api/users/me
// @access  Private (JWT required)
exports.updateMyProfile = async (req, res) => {
  try {
    const { name, address } = req.body;

    // At least one field must be provided
    if (!name && !address) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one field to update (name or address)'
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate and update name if provided
    if (name) {
      if (name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Name must be at least 2 characters long'
        });
      }

      if (name.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Name must not exceed 50 characters'
        });
      }

      user.name = name.trim();
    }

    // Validate and update address if provided
    if (address) {
      if (address.trim().length < 5) {
        return res.status(400).json({
          success: false,
          message: 'Address must be at least 5 characters long'
        });
      }

      if (address.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Address must not exceed 200 characters'
        });
      }

      user.address = address.trim();
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        userId: user.userId,
        name: user.name,
        mobile: user.mobile,
        address: user.address,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update my profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
};

// Helper function to generate unique customer userId
const generateCustomerId = async () => {
  try {
    // Find the last customer by userId
    const lastCustomer = await User.findOne({ 
      userId: /^CUST\d+$/ 
    }).sort({ userId: -1 });

    let nextNumber = 1001; // Starting number

    if (lastCustomer && lastCustomer.userId) {
      const lastNumber = parseInt(lastCustomer.userId.replace('CUST', ''));
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }

    return `CUST${nextNumber}`;
  } catch (error) {
    console.error('Error generating customer ID:', error);
    // Fallback to timestamp-based ID if error occurs
    return `CUST${Date.now().toString().slice(-4)}`;
  }
};

// Helper function to generate temporary password
const generateTempPassword = () => {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit password
};

// @desc    Create new customer (Owner only)
// @route   POST /api/users/create
// @access  Private (Owner only)
exports.createCustomer = async (req, res) => {
  try {
    const { name, mobile, address, landmark } = req.body;

    // Validate required fields
    if (!name || !mobile) {
      return res.status(400).json({
        success: false,
        message: 'Name and mobile number are required'
      });
    }

    // Check if mobile already exists
    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number already registered'
      });
    }

    // Generate unique userId
    const userId = await generateCustomerId();

    // Generate temporary password
    const tempPassword = generateTempPassword();

    // Create user object
    const userData = {
      userId,
      password: tempPassword,
      name,
      mobile,
      role: 'customer',
      isActive: true,
      forcePasswordChange: true,
      createdBy: req.user._id
    };

    // Add address if provided
    if (address || landmark) {
      userData.address = {
        street: address || '',
        landmark: landmark || ''
      };
    }

    // Create user in database
    const user = await User.create(userData);

    // Send SMS with credentials
    try {
      const smsMessage = `Welcome to The Home Kitchen! Your User ID is ${userId} and Temporary Password is ${tempPassword}. Please login and change your password.`;
      
      await smsService.sendSMS(
        mobile,
        smsMessage,
        'customer_creation',
        user._id
      );
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
      // Continue even if SMS fails - owner can manually share credentials
    }

    // Create notification for owner
    await createNotification(
      'NEW_USER',
      `New customer registered: ${name}`,
      user._id,
      'User'
    );

    // Create AppNotification for owner dashboard
    try {
      await AppNotification.createNotification({
        type: 'user_created',
        title: 'New Customer Created',
        message: `${name} (${userId}) - ${mobile}`,
        relatedUser: user._id,
        relatedModel: 'User',
        relatedId: user._id,
        priority: 'medium',
        metadata: {
          userId: user.userId,
          mobile: user.mobile,
          createdBy: req.user._id
        }
      });

      // Emit notification event to owner
      socketService.emitNotification({
        type: 'user_created',
        title: 'New Customer Created',
        message: `${name} (${userId}) has been added`,
        priority: 'medium'
      });
    } catch (notifError) {
      console.error('Failed to create app notification:', notifError);
      // Non-critical, continue
    }

    // Emit real-time event for owner
    socketService.emitUserCreated({
      _id: user._id,
      userId: user.userId,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt
    });

    // Return success response
    res.status(201).json({
      success: true,
      message: 'Customer created successfully. User can now login and select subscription plan.',
      data: {
        userId,
        tempPassword, // Return for owner to share with customer
        name,
        mobile
      }
    });

  } catch (error) {
    console.error('Create customer error:', error);
    
    // Handle duplicate userId error (edge case)
    if (error.code === 11000 && error.keyPattern && error.keyPattern.userId) {
      return res.status(400).json({
        success: false,
        message: 'Failed to generate unique user ID. Please try again.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating customer',
      error: error.message
    });
  }
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Owner only)
exports.getAllUsers = async (req, res) => {
  try {
    const { role, isActive } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const users = await User.find(filter)
      .select('-password -otp')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -otp');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

// @desc    Update user profile
// @route   PATCH /api/users/:id
// @access  Private (Owner or self)
exports.updateUser = async (req, res) => {
  try {
    const { name, mobile, address } = req.body;

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (name) user.name = name;
    if (mobile) user.mobile = mobile;
    if (address !== undefined) {
      // Handle address as string or object
      if (typeof address === 'string') {
        user.address = { street: address, landmark: '' };
      } else if (address && typeof address === 'object') {
        user.address = {
          street: address.street || address.address || '',
          landmark: address.landmark || ''
        };
      }
    }

    await user.save();

    // Create AppNotification for owner dashboard
    const AppNotification = require('../models/AppNotification');
    try {
      await AppNotification.createNotification({
        type: 'user_updated',
        title: 'Customer Updated',
        message: `${user.name} (${user.userId}) details have been updated`,
        relatedUser: user._id,
        relatedModel: 'User',
        relatedId: user._id,
        priority: 'medium',
        metadata: {
          userId: user.userId,
          mobile: user.mobile,
          updatedBy: req.user._id,
          updatedFields: Object.keys(req.body)
        }
      });
    } catch (notifError) {
      console.error('Error creating notification:', notifError);
      // Continue even if notification fails
    }

    // Emit real-time update event
    socketService.emitUserUpdated({
      _id: user._id,
      userId: user.userId,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      isActive: user.isActive,
      address: user.address
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  }
};

// @desc    Toggle user active status
// @route   PATCH /api/users/:id/toggle-active
// @access  Private (Owner only)
exports.toggleUserActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    // Create AppNotification for owner dashboard
    const AppNotification = require('../models/AppNotification');
    try {
      await AppNotification.createNotification({
        type: 'user_updated',
        title: `Customer ${user.isActive ? 'Activated' : 'Deactivated'}`,
        message: `${user.name} (${user.userId}) has been ${user.isActive ? 'activated' : 'deactivated'}`,
        relatedUser: user._id,
        relatedModel: 'User',
        relatedId: user._id,
        priority: 'high',
        metadata: {
          userId: user.userId,
          mobile: user.mobile,
          isActive: user.isActive,
          toggledBy: req.user._id
        }
      });
    } catch (notifError) {
      console.error('Error creating notification:', notifError);
      // Continue even if notification fails
    }

    // Emit real-time update event
    socketService.emitUserUpdated({
      _id: user._id,
      userId: user.userId,
      name: user.name,
      mobile: user.mobile,
      role: user.role,
      isActive: user.isActive
    });

    res.status(200).json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: user
    });
  } catch (error) {
    console.error('Toggle user active error:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling user status',
      error: error.message
    });
  }
};

// @desc    Delete user (soft delete)
// @route   DELETE /api/users/:id
// @access  Private (Owner only)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userId = user._id;
    const userName = user.name;
    const userIdString = user.userId;

    console.log(`🗑️ Starting cascade delete for user: ${userName} (${userIdString})`);

    // ========== CASCADE DELETE ALL RELATED DATA ==========
    
    // Import all required models
    const Subscription = require('../models/Subscription');
    const Payment = require('../models/Payment');
    const MealOrder = require('../models/MealOrder');
    const Delivery = require('../models/Delivery');
    const Pause = require('../models/Pause');
    const ExtraTiffin = require('../models/ExtraTiffin');
    const AppNotification = require('../models/AppNotification');
    const Notification = require('../models/Notification');

    // Track deletion counts for logging
    const deletionStats = {
      subscriptions: 0,
      payments: 0,
      mealOrders: 0,
      deliveries: 0,
      pauses: 0,
      extraTiffins: 0,
      notifications: 0
    };

    try {
      // 1. Delete/Cancel all subscriptions
      const subscriptions = await Subscription.updateMany(
        { user: userId },
        { 
          $set: { 
            status: 'cancelled',
            isActive: false,
            deletedAt: new Date(),
            cancelledReason: 'User account deleted'
          }
        }
      );
      deletionStats.subscriptions = subscriptions.modifiedCount;
      console.log(`  ✅ Cancelled ${deletionStats.subscriptions} subscriptions`);

      // 2. Mark all payments as inactive
      const payments = await Payment.updateMany(
        { user: userId },
        { 
          $set: { 
            isActive: false,
            deletedAt: new Date()
          }
        }
      );
      deletionStats.payments = payments.modifiedCount;
      console.log(`  ✅ Marked ${deletionStats.payments} payments as inactive`);

      // 3. Delete all meal orders
      const mealOrders = await MealOrder.deleteMany({ user: userId });
      deletionStats.mealOrders = mealOrders.deletedCount;
      console.log(`  ✅ Deleted ${deletionStats.mealOrders} meal orders`);

      // 4. Delete all deliveries
      const deliveries = await Delivery.deleteMany({ user: userId });
      deletionStats.deliveries = deliveries.deletedCount;
      console.log(`  ✅ Deleted ${deletionStats.deliveries} deliveries`);

      // 5. Delete all pauses
      const pauses = await Pause.deleteMany({ user: userId });
      deletionStats.pauses = pauses.deletedCount;
      console.log(`  ✅ Deleted ${deletionStats.pauses} pauses`);

      // 6. Delete all extra tiffins
      const extraTiffins = await ExtraTiffin.deleteMany({ user: userId });
      deletionStats.extraTiffins = extraTiffins.deletedCount;
      console.log(`  ✅ Deleted ${deletionStats.extraTiffins} extra tiffins`);

      // 7. Delete user-specific notifications
      const notifications = await Notification.deleteMany({ userId: userId });
      deletionStats.notifications = notifications.deletedCount;
      console.log(`  ✅ Deleted ${deletionStats.notifications} notifications`);

    } catch (cascadeError) {
      console.error('⚠️ Error during cascade delete:', cascadeError);
      // Continue with user deletion even if cascade fails
    }

    // ========== SOFT DELETE USER ==========
    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();
    console.log(`  ✅ User marked as deleted`);

    // ========== CREATE DELETION NOTIFICATION ==========
    try {
      await AppNotification.createNotification({
        type: 'user_deleted',
        title: 'Customer Deleted',
        message: `${userName} (${userIdString}) and all related data removed`,
        relatedUser: userId,
        relatedModel: 'User',
        relatedId: userId,
        priority: 'high',
        metadata: {
          userId: userIdString,
          mobile: user.mobile,
          deletedBy: req.user._id,
          deletedAt: new Date(),
          cascadeStats: deletionStats
        }
      });
    } catch (notifError) {
      console.error('Error creating notification:', notifError);
    }

    // ========== EMIT REAL-TIME EVENTS ==========
    socketService.emitUserDeleted(userId.toString());

    // Also emit specific events for data changes
    if (deletionStats.subscriptions > 0) {
      socketService.emitSubscriptionUpdated({ userId: userId.toString() });
    }
    if (deletionStats.payments > 0) {
      socketService.emitPaymentReceived({ userId: userId.toString() });
    }
    if (deletionStats.mealOrders > 0) {
      socketService.emitMealUpdated({ userId: userId.toString() });
    }
    if (deletionStats.deliveries > 0) {
      socketService.emitDeliveryUpdated({ userId: userId.toString() });
    }

    console.log(`✅ CASCADE DELETE COMPLETE for ${userName}`);
    console.log(`📊 Deletion Stats:`, deletionStats);

    res.status(200).json({
      success: true,
      message: 'User and all related data deleted successfully',
      data: {
        user: {
          _id: user._id,
          userId: user.userId,
          name: user.name,
          deletedAt: user.deletedAt
        },
        deletionStats
      }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message
    });
  }
};

// @desc    Get customers only
// @desc    Get all customers with their subscription details
// @route   GET /api/users/customers
// @access  Private (Owner only)
exports.getCustomers = async (req, res) => {
  try {
    const Subscription = require('../models/Subscription');
    
    // Get only ACTIVE customers (exclude soft-deleted ones)
    const customers = await User.find({ 
      role: 'customer',
      isActive: true,
      deletedAt: { $exists: false }
    })
      .select('-password -otp')
      .sort({ createdAt: -1 });

    console.log(`📊 Found ${customers.length} customers in database`);
    
    // Get active subscription for each customer
    const customersWithSubscriptions = await Promise.all(
      customers.map(async (customer) => {
        // Find the most recent active or pending subscription
        const activeSubscription = await Subscription.findOne({
          user: customer._id,
          status: { $in: ['active', 'pending', 'paused'] }
        })
        .sort({ createdAt: -1 })
        .lean();

        const customerData = customer.toObject();
        
        // Add subscription data if exists
        if (activeSubscription) {
          customerData.subscription = {
            _id: activeSubscription._id,
            status: activeSubscription.status,
            planType: activeSubscription.planType,
            amount: activeSubscription.amount,
            startDate: activeSubscription.startDate,
            endDate: activeSubscription.endDate,
            remainingDays: activeSubscription.remainingDays,
            daysUsed: activeSubscription.daysUsed || 0,
          };
          console.log(`  ✅ ${customer.name} - Has ${activeSubscription.status} subscription`);
        } else {
          customerData.subscription = null;
          console.log(`  ⚠️ ${customer.name} - No active subscription`);
        }
        
        return customerData;
      })
    );

    res.status(200).json({
      success: true,
      count: customersWithSubscriptions.length,
      data: customersWithSubscriptions
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customers',
      error: error.message
    });
  }
};

// @desc    Upload profile image
// @route   POST /api/users/upload-profile-image
// @access  Private (JWT required)
exports.uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Validate file size (2MB max)
    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'Image size must be less than 2MB'
      });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Only JPEG and PNG images are allowed'
      });
    }

    // ✅ Build correct image URL - always use /uploads/profiles/ path
    const imageUrl = `/uploads/profiles/${req.file.filename}`;
    
    console.log('📸 Profile image upload:');
    console.log('   User ID:', req.user._id);
    console.log('   File name:', req.file.filename);
    console.log('   Image URL:', imageUrl);
    
    // ✅ CRITICAL FIX: Use findByIdAndUpdate for proper DB persistence
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profileImage: imageUrl },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('   ✅ Saved to DB:', user.profileImage);

    res.status(200).json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading profile image',
      error: error.message
    });
  }
};
