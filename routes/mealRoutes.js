const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');
const mealController = require('../controllers/mealController');

// 🔐 Subscription-based routes
router.post('/select', protect, requireActiveSubscription, mealController.selectMeal);
router.post('/skip', protect, requireActiveSubscription, mealController.skipMeal);
router.get('/my-selection', protect, mealController.getMyMealSelection); // ✅ REMOVED requireActiveSubscription to handle both user types

// 🟢 Daily meal routes (NO subscription middleware)
router.post('/daily/select', protect, mealController.selectDailyMeal);
router.get('/daily/my-selection', protect, mealController.getMyDailyMealSelection);

module.exports = router;
