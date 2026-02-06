// Centralized pricing configuration
// All meal and subscription pricing should be managed here

const PRICING = {
  // Daily meal pricing
  dailyMeal: {
    pricePerMeal: 80, // ₹80 per meal
    currency: 'INR'
  },

  // Subscription pricing is handled by MealPlan model
  // This file focuses on operational pricing constants
};

module.exports = {
  PRICING,
  getDailyMealPrice: () => PRICING.dailyMeal.pricePerMeal,
  getDailyMealCurrency: () => PRICING.dailyMeal.currency
};
