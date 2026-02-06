const express = require('express');
const router = express.Router();
const { submitLead, getAllLeads, updateLead } = require('../controllers/leadController');
const { protect, authorize } = require('../middleware/auth');

// Public route - submit lead
router.post('/', submitLead);

// Owner routes - manage leads
router.get('/', protect, authorize('owner'), getAllLeads);
router.put('/:id', protect, authorize('owner'), updateLead);

module.exports = router;
