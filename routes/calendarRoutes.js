const express = require('express');
const router = express.Router();
const { getMyCalendar } = require('../controllers/calendarController');
const { protect } = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');

router.get('/my', protect, requireActiveSubscription, getMyCalendar);

module.exports = router;
