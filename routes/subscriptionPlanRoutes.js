const express = require('express');
const router = express.Router();
const {
  getSubscriptionPlans,
  getAllPlansForOwner,
  getPlanById,
  createPlan,
  updatePlan,
  togglePlanStatus,
  deletePlan
} = require('../controllers/subscriptionPlanController');
const { protect } = require('../middleware/auth');
const ownerOnly = require('../middleware/ownerOnly');

// Public route - Get active plans (used during Add Customer)
router.get('/', getSubscriptionPlans);

// Protected routes - Owner only
router.get('/all', protect, ownerOnly, getAllPlansForOwner);
router.get('/:id', protect, ownerOnly, getPlanById);
router.post('/', protect, ownerOnly, createPlan);
router.put('/:id', protect, ownerOnly, updatePlan);
router.patch('/:id/status', protect, ownerOnly, togglePlanStatus);
router.delete('/:id', protect, ownerOnly, deletePlan);

module.exports = router;
