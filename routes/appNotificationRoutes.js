const express = require('express');
const router = express.Router();
const appNotificationController = require('../controllers/appNotificationController');
const { protect, ownerOnly } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Customer — get my notifications
router.get('/my', appNotificationController.getMyNotifications);

// Customer — my unread count
router.get('/my-unread-count', appNotificationController.getMyUnreadCount);

// Customer — mark all my notifications read
router.put('/my-mark-all-read', appNotificationController.markAllAsReadForUser);

// Customer — mark my notification read
router.put('/:id/read', appNotificationController.markAsRead);

// Owner-Only Admin Routes
// Get all notifications with filters and pagination
router.get('/', ownerOnly, appNotificationController.getAllNotifications);

// Get unread count
router.get('/unread-count', ownerOnly, appNotificationController.getUnreadCount);

// Get notification statistics
router.get('/stats', ownerOnly, appNotificationController.getNotificationStats);

// Get notifications by type
router.get('/type/:type', ownerOnly, appNotificationController.getNotificationsByType);

// Delete old notifications (cleanup)
router.delete('/cleanup', ownerOnly, appNotificationController.deleteOldNotifications);

module.exports = router;
