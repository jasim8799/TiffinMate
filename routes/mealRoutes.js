const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { ownerOnly } = require('../middleware/ownerOnly');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');
const requireRestaurantOpen = require('../middleware/requireRestaurantOpen');
const mealController = require('../controllers/mealController');

// 🔐 Subscription-based routes
router.post('/select', protect, requireActiveSubscription, requireRestaurantOpen, mealController.selectMeal);
router.post('/skip', protect, requireActiveSubscription, requireRestaurantOpen, mealController.skipMeal);
router.get('/my-selection', protect, mealController.getMyMealSelectionByOffset); // ✅ SUPPORTS OFFSET PARAMETER FOR TIME-BASED TABS

// 🟢 Daily meal routes (NO subscription middleware)
router.post('/daily/select', protect, mealController.selectDailyMeal);
router.get('/daily/my-selection', protect, mealController.getMyDailyMealSelection);

// 🏪 Restaurant status routes (Owner only)
router.patch('/restaurant/status', protect, ownerOnly, mealController.updateRestaurantStatus);
router.get('/restaurant/status', protect, ownerOnly, mealController.getRestaurantStatus);

module.exports = router;
