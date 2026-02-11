const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');
const requireRestaurantOpen = require('../middleware/requireRestaurantOpen');
const mealController = require('../controllers/mealController');

// 🔐 Subscription-based routes
router.post('/select', protect, requireActiveSubscription, requireRestaurantOpen, mealController.selectMeal);
router.post('/skip', protect, requireActiveSubscription, requireRestaurantOpen, mealController.skipMeal);
router.get('/my-selection', protect, mealController.getMyMealSelection); // ✅ SUPPORTS OFFSET PARAMETER FOR TIME-BASED TABS

// 🟢 Daily meal routes (NO subscription middleware)
router.post('/daily/select', protect, mealController.selectDailyMeal);
router.get('/daily/my-selection', protect, mealController.getMyDailyMealSelection);



module.exports = router;
