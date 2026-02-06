const express = require('express');
const router = express.Router();
const {
  createDelivery,
  updateDeliveryStatus,
  getTodaysDeliveries,
  getUserDeliveries,
  getMyDeliveries,
  getMyTodayDelivery,
  getKitchenSummary,
  getDelivery,
  autoCreateTodaysDeliveries,
  markAllOutForDelivery,
  getTodayUsers,
  markSelectedOutForDelivery
} = require('../controllers/deliveryController');
const { protect, authorize } = require('../middleware/auth');

router.post('/', protect, authorize('owner'), createDelivery);
router.post('/auto-create-today', protect, authorize('owner'), autoCreateTodaysDeliveries);
router.get('/today-users', protect, authorize('owner'), getTodayUsers);
router.patch('/out-for-delivery', protect, authorize('owner'), markSelectedOutForDelivery);
router.patch('/mark-out-for-delivery', protect, authorize('owner'), markAllOutForDelivery);
router.get('/today', protect, authorize('owner', 'delivery'), getTodaysDeliveries);
router.get('/kitchen-summary', protect, authorize('owner'), getKitchenSummary);
router.get('/my', protect, authorize('customer'), getMyDeliveries);
router.get('/my-today', protect, authorize('customer'), getMyTodayDelivery);
router.get('/user/:userId', protect, getUserDeliveries);
router.get('/:id', protect, getDelivery);
router.patch('/:id/status', protect, authorize('owner', 'delivery'), updateDeliveryStatus);

module.exports = router;
