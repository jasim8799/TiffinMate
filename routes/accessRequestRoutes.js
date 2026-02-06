const express = require('express');
const router = express.Router();
const {
  getAllAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  getAccessRequest
} = require('../controllers/accessRequestController');
const { protect, authorize } = require('../middleware/auth');

router.get('/', protect, authorize('owner'), getAllAccessRequests);
router.get('/:id', protect, authorize('owner'), getAccessRequest);
router.post('/:id/approve', protect, authorize('owner'), approveAccessRequest);
router.post('/:id/reject', protect, authorize('owner'), rejectAccessRequest);

module.exports = router;
