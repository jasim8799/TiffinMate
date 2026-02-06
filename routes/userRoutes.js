const express = require('express');
const router = express.Router();
const {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  toggleUserActive,
  getCustomers,
  createCustomer,
  getMyProfile,
  updateMyProfile,
  uploadProfileImage
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');
const { uploadSingle, uploadProfileImage: profileImageUpload } = require('../middleware/upload');
const uploadId = require('../middleware/uploadId');
const User = require('../models/User');

// Profile routes (logged-in user)
router.get('/me', protect, getMyProfile);
router.put('/me', protect, updateMyProfile);
router.post('/upload-profile-image', protect, profileImageUpload.single('profileImage'), uploadProfileImage);

// ID Document Upload (Customer only)
router.post('/upload-id', protect, authorize('customer'), uploadId.single('idDocument'), async (req, res) => {
  try {
    // Check if ID is already approved (LOCK)
    const existingUser = await User.findById(req.user._id);
    
    if (existingUser.idVerificationStatus === 'approved') {
      console.log('🔒 [ID UPLOAD] Blocked - ID already verified for:', existingUser.name);
      return res.status(403).json({
        success: false,
        message: 'ID already verified. Upload locked.'
      });
    }
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded' 
      });
    }

    const idDocumentPath = `/uploads/id-documents/${req.file.filename}`;
    const idType = req.body.idType || 'Unknown';

    console.log('🆔 ID Document uploaded:');
    console.log('   User ID:', req.user._id);
    console.log('   File:', req.file.filename);
    console.log('   Type:', idType);
    console.log('   Path:', idDocumentPath);

    // ✅ CRITICAL FIX: Use findByIdAndUpdate for proper DB persistence
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        idDocument: idDocumentPath,
        idDocumentType: idType,
        idVerificationStatus: 'pending'
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('   ✅ Saved to DB:', user.idDocument);
    console.log('   ✅ Status:', user.idVerificationStatus);

    res.status(200).json({
      success: true,
      message: 'ID uploaded successfully',
      data: {
        idDocument: user.idDocument,
        idDocumentType: user.idDocumentType,
        idVerificationStatus: user.idVerificationStatus
      }
    });
  } catch (error) {
    console.error('ID upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading ID document',
      error: error.message
    });
  }
});

// Create customer (Owner only)
router.post('/create', protect, authorize('owner'), createCustomer);

router.get('/', protect, authorize('owner'), getAllUsers);
router.get('/customers', protect, authorize('owner'), getCustomers);
router.get('/:id', protect, getUserById);
router.patch('/:id', protect, authorize('owner'), updateUser);
router.delete('/:id', protect, authorize('owner'), deleteUser);
router.patch('/:id/toggle-active', protect, authorize('owner'), toggleUserActive);

module.exports = router;
