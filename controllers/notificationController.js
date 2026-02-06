const Notification = require('../models/Notification');
const User = require('../models/User');

// @desc    Get notifications for current user (owner)
// @route   GET /api/notifications/owner
// @access  Private (Owner only)
exports.getOwnerNotifications = async (req, res) => {
  try {
    // Find owner user
    const owner = await User.findOne({ role: 'owner', isActive: true });
    
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found'
      });
    }

    const notifications = await Notification.find({ userId: owner._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const unreadCount = await Notification.countDocuments({
      userId: owner._id,
      read: false
    });

    res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      data: notification
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification',
      error: error.message
    });
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/mark-all-read
// @access  Private (Owner only)
exports.markAllAsRead = async (req, res) => {
  try {
    const owner = await User.findOne({ role: 'owner', isActive: true });
    
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Owner not found'
      });
    }

    await Notification.updateMany(
      { userId: owner._id, read: false },
      { read: true }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notifications',
      error: error.message
    });
  }
};

// Helper function to create notification
exports.createNotification = async (type, message, relatedId = null, relatedModel = null, metadata = {}) => {
  try {
    const owner = await User.findOne({ role: 'owner', isActive: true });
    
    if (!owner) {
      console.error('No owner found for notification');
      return null;
    }

    const notification = await Notification.create({
      userId: owner._id,
      type,
      message,
      relatedId,
      relatedModel,
      metadata
    });

    console.log(`✅ Notification created: ${type} - ${message}`);
    return notification;
  } catch (error) {
    console.error('Create notification error:', error);
    return null;
  }
};
