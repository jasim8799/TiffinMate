const express = require('express');
const router = express.Router();
const {
  getPlans,
  getDurationTypes,
  getPlansWithMenus,
  selectPlan,
  updateSubscriptionStatus,
  createSubscription,
  getUserSubscriptions,
  getMyActiveSubscription,
  getAllSubscriptions,
  renewSubscription,
  togglePauseSubscription,
  getSubscription,
  requestSubscription,
  approveSubscription,
  rejectSubscription,
  emergencyOverrideSubscription,
  getPendingSubscriptions
} = require('../controllers/subscriptionController');
const { protect, authorize } = require('../middleware/auth');
const idempotencyMiddleware = require('../middleware/idempotency');

// Public routes
router.get('/plans', getPlans);
router.get('/duration-types', getDurationTypes);
router.get('/plans-with-menus', getPlansWithMenus);

// Customer routes
router.post('/select', protect, authorize('customer'), selectPlan);
router.get('/my-active', protect, getMyActiveSubscription);
router.post('/request', protect, authorize('customer'), requestSubscription);

// Owner routes
router.post('/', protect, authorize('owner'), idempotencyMiddleware, createSubscription);
router.get('/', protect, authorize('owner'), getAllSubscriptions);
router.get('/pending', protect, authorize('owner'), getPendingSubscriptions);
router.put('/:id/status', protect, authorize('owner'), updateSubscriptionStatus);
router.patch('/:id/approve', protect, authorize('owner'), approveSubscription);
router.patch('/:id/reject', protect, authorize('owner'), rejectSubscription);
router.get('/user/:userId', protect, authorize('owner'), getUserSubscriptions);
router.get('/:id', protect, getSubscription);
router.post('/:id/renew', protect, authorize('owner'), renewSubscription);
router.patch('/:id/toggle-pause', protect, authorize('owner'), togglePauseSubscription);
router.patch('/:id/override', protect, authorize('owner'), emergencyOverrideSubscription);

module.exports = router;
