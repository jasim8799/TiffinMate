const mongoose = require('mongoose');

const mealOrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  },
  deliveryDate: {
    type: Date,
    required: true
  },
  mealType: {
    type: String,
    enum: ['lunch', 'dinner'],
    required: true
  },
  selectedMeal: {
    name: { type: String },
    items: [{ type: String }],
    isSkip: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false }
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled'],
    default: 'confirmed',
    index: true
  },
  orderSource: {
    type: String,
    enum: ['subscription', 'daily'],
    default: 'subscription',
    index: true
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  cutoffTime: {
    type: Date
  },
  isAfterCutoff: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for efficient querying (covers deliveryDate queries too)
mealOrderSchema.index({ deliveryDate: 1, status: 1 });

// ========================================
// CRITICAL: UNIQUE COMPOUND INDEX
// ========================================
// This prevents duplicate MealOrders for the same user + date + mealType
// Enforces: ONE MealOrder per (user + deliveryDate + mealType)
mealOrderSchema.index(
  { user: 1, deliveryDate: 1, mealType: 1 },
  { unique: true, name: 'unique_user_date_mealtype' }
);

// ========================================
// ISSUE 2 FIX: UNIQUE INDEX FOR DAILY MEALS
// ========================================
// Prevents duplicate daily meal orders per user per day
// Enforces: ONE daily MealOrder per (user + deliveryDate)
mealOrderSchema.index(
  { user: 1, deliveryDate: 1, orderSource: 1 },
  {
    unique: true,
    partialFilterExpression: { orderSource: 'daily' },
    name: 'unique_daily_user_date'
  }
);

// Chaos mode removed - was causing production timeouts

// Method to check if order is after cutoff
mealOrderSchema.methods.checkCutoff = function() {
  this.isAfterCutoff = new Date() > this.cutoffTime;
  return this.isAfterCutoff;
};

module.exports = mongoose.model('MealOrder', mealOrderSchema);
