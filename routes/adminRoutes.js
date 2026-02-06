const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getExpiringSubscriptions,
  createCustomerWithSubscription,
  getExtraTiffinRequests,
  approveExtraTiffin,
  getPauseRequests,
  approvePauseRequest,
  resetUserPassword
} = require('../controllers/adminController');
const { getAllLeads } = require('../controllers/leadController');
const { protect, authorize } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const User = require('../models/User');
const OwnerAuditLog = require('../models/OwnerAuditLog');

// Apply stricter rate limiting to all admin routes (60 requests per minute per IP)
router.use(adminLimiter);

router.get('/dashboard', protect, authorize('owner'), getDashboardStats);
router.get('/expiring-subscriptions', protect, authorize('owner'), getExpiringSubscriptions);
router.post('/create-customer', protect, authorize('owner'), createCustomerWithSubscription);
router.get('/extra-tiffins', protect, authorize('owner'), getExtraTiffinRequests);
router.post('/extra-tiffins/:id/approve', protect, authorize('owner'), approveExtraTiffin);
router.get('/pause-requests', protect, authorize('owner'), getPauseRequests);
router.post('/pause-requests/:id/approve', protect, authorize('owner'), approvePauseRequest);
router.post('/reset-user-password/:userId', protect, authorize('owner'), resetUserPassword);

// Leads Management
router.get('/leads', protect, authorize('owner'), getAllLeads);

// ID Verification Routes
router.get('/id-verification-users', protect, authorize('owner'), async (req, res) => {
  try {
    const users = await User.find({
      idVerificationStatus: { $ne: 'not_uploaded' },
      role: 'customer',
      deletedAt: { $exists: false }
    })
    .select('name mobile profileImage idDocument idDocumentType idVerificationStatus')
    .sort({ createdAt: -1 });

    console.log(`📋 [ID VERIFICATION] Found ${users.length} users with ID documents`);

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('Error fetching ID verification users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching ID verification users',
      error: error.message
    });
  }
});

router.patch('/users/:id/verify-id', protect, authorize('owner'), async (req, res) => {
  try {
    const { status } = req.body;
    
    console.log('🔵 [ID VERIFICATION] Approval request received');
    console.log('   User ID:', req.params.id);
    console.log('   Requested Status:', status);
    console.log('   Owner:', req.user.name);
    
    if (!['approved', 'rejected'].includes(status)) {
      console.log('❌ [ID VERIFICATION] Invalid status:', status);
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be "approved" or "rejected"'
      });
    }

    // Use findByIdAndUpdate for atomic update
    const updateData = { idVerificationStatus: status };
    
    // If approved, record timestamp and owner
    if (status === 'approved') {
      updateData.idVerifiedAt = new Date();
      updateData.idVerifiedBy = req.user._id;
    }
    
    // If rejected, allow re-upload by clearing ID fields and reset status
    if (status === 'rejected') {
      updateData.idDocument = null;
      updateData.idDocumentType = null;
      updateData.idVerificationStatus = 'not_uploaded';
      updateData.idVerifiedAt = null;
      updateData.idVerifiedBy = null;
    }

    console.log('📝 [ID VERIFICATION] Update data:', updateData);

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!user) {
      console.log('❌ [ID VERIFICATION] User not found:', req.params.id);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log(`✅ [ID VERIFICATION] User ${user.name} ID ${status}`);
    console.log('   Updated Status:', user.idVerificationStatus);
    console.log('   ID Document:', user.idDocument ? '✅ Present' : '❌ Cleared');

    // Log the action
    await OwnerAuditLog.logAction(
      req.user._id,
      'verify_id',
      user._id,
      { status }
    );

    res.status(200).json({
      success: true,
      message: `ID verification ${status} successfully`,
      data: {
        idVerificationStatus: user.idVerificationStatus,
        idDocument: user.idDocument,
        idDocumentType: user.idDocumentType
      }
    });
  } catch (error) {
    console.error('Error verifying ID:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying ID',
      error: error.message
    });
  }
});

console.log('📌 adminRoutes initialized');

module.exports = router;
