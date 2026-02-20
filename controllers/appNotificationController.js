const AppNotification = require('../models/AppNotification');
//test
// Get all notifications (Owner only)
exports.getAllNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 50, isRead, type, priority } = req.query;
    
    // Build filter
    const filter = {};
    if (isRead !== undefined) {
      filter.isRead = isRead === 'true';
    }
    if (type) {
      filter.type = type;
    }
    if (priority) {
      filter.priority = priority;
    }

    // Execute query with pagination
    const notifications = await AppNotification.find(filter)
      .populate('relatedUser', 'name mobile userId')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await AppNotification.countDocuments(filter);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

// Get unread count (Owner only)
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await AppNotification.countDocuments({ isRead: false });
    
    res.json({
      success: true,
      unreadCount: count
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
      error: error.message
    });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    
    const notification = await AppNotification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.markAsRead();

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
};

// Mark all as read
exports.markAllAsRead = async (req, res) => {
  try {
    const result = await AppNotification.updateMany(
      { isRead: false },
      { 
        $set: { 
          isRead: true, 
          readAt: new Date() 
        } 
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all as read',
      error: error.message
    });
  }
};

// Delete old notifications (cleanup)
exports.deleteOldNotifications = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await AppNotification.deleteMany({
      createdAt: { $lt: cutoffDate },
      isRead: true
    });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} old notifications`
    });
  } catch (error) {
    console.error('Delete old notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete old notifications',
      error: error.message
    });
  }
};

// Get notifications by type
exports.getNotificationsByType = async (req, res) => {
  try {
    const { type } = req.params;
    const { limit = 20 } = req.query;

    const notifications = await AppNotification.find({ type })
      .populate('relatedUser', 'name mobile userId')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Get notifications by type error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

// Get notification statistics
exports.getNotificationStats = async (req, res) => {
  try {
    const [
      totalCount,
      unreadCount,
      byType,
      byPriority,
      recentCount
    ] = await Promise.all([
      AppNotification.countDocuments(),
      AppNotification.countDocuments({ isRead: false }),
      AppNotification.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      AppNotification.aggregate([
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      AppNotification.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
    ]);

    res.json({
      success: true,
      stats: {
        total: totalCount,
        unread: unreadCount,
        read: totalCount - unreadCount,
        last24Hours: recentCount,
        byType: byType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        byPriority: byPriority.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Get notification stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification stats',
      error: error.message
    });
  }
};

// Get my notifications (User specific)
exports.getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const notifications = await AppNotification.find({ relatedUser: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await AppNotification.countDocuments({ relatedUser: req.user._id });

    res.json({
      success: true,
      data: notifications,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get my notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

// Get my unread count (User specific)
exports.getMyUnreadCount = async (req, res) => {
  try {
    const count = await AppNotification.countDocuments({
      relatedUser: req.user._id,
      isRead: false
    });

    res.json({
      success: true,
      unreadCount: count
    });
  } catch (error) {
    console.error('Get my unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
      error: error.message
    });
  }
};

// Mark all as read for user (User specific)
exports.markAllAsReadForUser = async (req, res) => {
  try {
    const result = await AppNotification.updateMany(
      {
        relatedUser: req.user._id,
        isRead: false
      },
      {
        $set: {
          isRead: true,
          readAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`
    });
  } catch (error) {
    console.error('Mark all as read for user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all as read',
      error: error.message
    });
  }
};
