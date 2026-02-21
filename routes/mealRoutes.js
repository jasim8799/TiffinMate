const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');
const requireRestaurantOpen = require('../middleware/requireRestaurantOpen');
const mealController = require('../controllers/mealController');

// ─── Owner kitchen aggregated view (Phase 16 / Kitchen screen) ───────────────
// GET /api/meals/owner/aggregated?date=YYYY-MM-DD
router.get('/owner/aggregated', protect, authorize('owner'), mealController.getOwnerAggregatedKitchen);

// ─── Phase 6: Unified date-based query (used by all tabs, kitchen, dashboard) ─
// GET /api/meals/by-date?date=YYYY-MM-DD
router.get('/by-date', protect, mealController.getMealsByDate);

// ─── Phase 14: Calendar endpoint ──────────────────────────────────────────────
// GET /api/meals/calendar?month=YYYY-MM
router.get('/calendar', protect, mealController.getMealsCalendar);

// 🔐 Subscription-based routes
router.post('/select', protect, requireActiveSubscription, requireRestaurantOpen, mealController.selectMeal);
router.post('/skip', protect, requireActiveSubscription, requireRestaurantOpen, mealController.skipMeal);
router.get('/my-selection', protect, mealController.getMyMealSelection); // ✅ SUPPORTS OFFSET PARAMETER FOR TIME-BASED TABS

// 🟢 Daily meal routes (NO subscription middleware)
router.post('/daily/select', protect, mealController.selectDailyMeal);
router.get('/daily/my-selection', protect, mealController.getMyDailyMealSelection);

module.exports = router;
