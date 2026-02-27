const express = require('express');
const router = express.Router();
const { getMyCalendar } = require('../controllers/calendarController');
const { protect } = require('../middleware/auth');

router.get('/my', protect, getMyCalendar);

module.exports = router;
