const mongoose = require('mongoose');

const MealSkipSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true
  },
  deliveryDate: {
    type: Date,
    required: true
  },
  mealType: {
    type: String,
    enum: ['lunch', 'dinner', 'both'],
    required: true
  },
  reason: {
    type: String
  }
}, { timestamps: true });

// 🔐 HARD GUARANTEE — no duplicate skips
MealSkipSchema.index(
  { user: 1, deliveryDate: 1, mealType: 1 },
  { unique: true }
);

module.exports = mongoose.model('MealSkip', MealSkipSchema);
