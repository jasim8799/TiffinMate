const express = require('express');
const router = express.Router();
const { protect, ownerOnly } = require('../middleware/auth');
const {
  getOwnerNotifications,
  markAsRead,
  markAllAsRead
} = require('../controllers/notificationController');

// All routes require authentication
router.use(protect);

// Owner notifications
router.get('/owner', ownerOnly, getOwnerNotifications);
router.put('/:id/read', markAsRead);
router.put('/mark-all-read', ownerOnly, markAllAsRead);

module.exports = router;
