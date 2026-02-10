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
    type: String,
    default: null  // null = skipped
  },
  skipped: {
    type: Boolean,
    default: false
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
  }
}, {
  timestamps: true
});

// Index for efficient querying
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

// Chaos mode: randomly delay saves to test race conditions
mealOrderSchema.pre('save', async function(next) {
  if (process.env.CHAOS_MODE === 'true') {
    const delay = Math.random() * 5000; // 0-5 seconds
    console.log(`CHAOS_MODE: Delaying meal order save by ${delay.toFixed(0)}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  next();
});

// Method to check if order is after cutoff
mealOrderSchema.methods.checkCutoff = function() {
  this.isAfterCutoff = new Date() > this.cutoffTime;
  return this.isAfterCutoff;
};

module.exports = mongoose.model('MealOrder', mealOrderSchema);
