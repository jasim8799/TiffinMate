const AccessRequest = require('../models/AccessRequest');
const User = require('../models/User');
const smsService = require('../services/smsService');

// @desc    Get all access requests
// @route   GET /api/access-requests
// @access  Private (Owner only)
exports.getAllAccessRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status) filter.status = status;

    const requests = await AccessRequest.find(filter)
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('Get access requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching access requests',
      error: error.message
    });
  }
};

// @desc    Approve access request
// @route   POST /api/access-requests/:id/approve
// @access  Private (Owner only)
exports.approveAccessRequest = async (req, res) => {
  try {
    const accessRequest = await AccessRequest.findById(req.params.id);

    if (!accessRequest) {
      return res.status(404).json({
        success: false,
        message: 'Access request not found'
      });
    }

    if (accessRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Access request already processed'
      });
    }

    // Generate user ID and temporary password
    const userCount = await User.countDocuments({ role: 'customer' });
    const userId = `CUST${String(userCount + 1).padStart(4, '0')}`;
    const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();

    // Create user
    const user = await User.create({
      userId,
      password: tempPassword,
      name: accessRequest.name,
      mobile: accessRequest.mobile,
      address: accessRequest.address,
      role: 'customer',
      isActive: false, // Will be activated when subscription is created
      isPasswordChanged: false,
      createdBy: req.user._id
    });

    // Update access request
    accessRequest.status = 'approved';
    accessRequest.reviewedBy = req.user._id;
    accessRequest.reviewedAt = new Date();
    accessRequest.createdUser = user._id;
    accessRequest.credentialsSent = true;
    accessRequest.credentialsSentAt = new Date();
    await accessRequest.save();

    // Send credentials via SMS
    await smsService.sendAccessApproved(
      accessRequest.mobile,
      accessRequest.name,
      userId,
      tempPassword
    );

    res.status(200).json({
      success: true,
      message: 'Access request approved and credentials sent',
      data: {
        userId,
        tempPassword,
        user
      }
    });
  } catch (error) {
    console.error('Approve access request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving access request',
      error: error.message
    });
  }
};

// @desc    Reject access request
// @route   POST /api/access-requests/:id/reject
// @access  Private (Owner only)
exports.rejectAccessRequest = async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    const accessRequest = await AccessRequest.findById(req.params.id);

    if (!accessRequest) {
      return res.status(404).json({
        success: false,
        message: 'Access request not found'
      });
    }

    if (accessRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Access request already processed'
      });
    }

    accessRequest.status = 'rejected';
    accessRequest.reviewedBy = req.user._id;
    accessRequest.reviewedAt = new Date();
    accessRequest.rejectionReason = rejectionReason || 'Not specified';
    await accessRequest.save();

    // Send rejection SMS
    await smsService.sendAccessRejected(
      accessRequest.mobile,
      accessRequest.name,
      rejectionReason || 'Not specified'
    );

    res.status(200).json({
      success: true,
      message: 'Access request rejected',
      data: accessRequest
    });
  } catch (error) {
    console.error('Reject access request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting access request',
      error: error.message
    });
  }
};

// @desc    Get access request by ID
// @route   GET /api/access-requests/:id
// @access  Private (Owner only)
exports.getAccessRequest = async (req, res) => {
  try {
    const accessRequest = await AccessRequest.findById(req.params.id)
      .populate('reviewedBy', 'name userId')
      .populate('createdUser', 'userId name mobile');

    if (!accessRequest) {
      return res.status(404).json({
        success: false,
        message: 'Access request not found'
      });
    }

    res.status(200).json({
      success: true,
      data: accessRequest
    });
  } catch (error) {
    console.error('Get access request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching access request',
      error: error.message
    });
  }
};
