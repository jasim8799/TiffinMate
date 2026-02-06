const express = require('express');
const router = express.Router();
const {
  createPayment,
  markPaymentPaid,
  uploadUPIScreenshot,
  getUserPayments,
  getMyPayments,
  getPendingPayments,
  verifyPayment,
  receivePayment,
  getAllPayments,
  getPayment,
  getMonthlyCollectionSummary,
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook
} = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const idempotencyMiddleware = require('../middleware/idempotency');

// ====================================
// WEBHOOK ENDPOINTS (Public - No Auth)
// ====================================
router.post('/webhook/razorpay', handleRazorpayWebhook);

// ====================================
// USER ROUTES (Customer)
// ====================================
router.post('/create', protect, authorize('customer'), idempotencyMiddleware, createPayment);
router.get('/my', protect, authorize('customer'), getMyPayments);
router.post('/razorpay/create-order', protect, authorize('customer'), createRazorpayOrder);
router.post('/razorpay/verify', protect, authorize('customer'), verifyRazorpayPayment);

// ====================================
// OWNER ROUTES
// ====================================
router.get('/owner/monthly-summary', protect, authorize('owner'), getMonthlyCollectionSummary);
router.get('/pending', protect, authorize('owner'), getPendingPayments);
router.put('/:id/verify', protect, authorize('owner'), verifyPayment);
router.put('/:id/receive', protect, authorize('owner'), receivePayment);
router.get('/all', protect, authorize('owner'), getAllPayments);

// ====================================
// LEGACY ROUTES (Backward compatibility)
// ====================================
router.post('/', protect, authorize('owner'), createPayment);
router.get('/', protect, authorize('owner'), getAllPayments);
router.get('/user/:userId', protect, getUserPayments);
router.get('/:id', protect, getPayment);
router.patch('/:id/mark-paid', protect, authorize('owner'), markPaymentPaid);
router.post('/:id/upload-screenshot', protect, authorize('customer'), upload.single('screenshot'), uploadUPIScreenshot);

module.exports = router;
