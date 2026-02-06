const mongoose = require('mongoose');

const weeklyMenuSchema = new mongoose.Schema({
  dayOfWeek: {
    type: String,
    enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    required: true
  },
  mealType: {
    type: String,
    enum: ['lunch', 'dinner'],
    required: true
  },
  planCategory: {
    type: String,
    enum: ['classic', 'premium-veg', 'premium-non-veg'],
    required: true
  },
  items: {
    type: [String],
    required: true
  },
  description: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index to ensure unique menu per day/meal/plan
weeklyMenuSchema.index({ dayOfWeek: 1, mealType: 1, planCategory: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyMenu', weeklyMenuSchema);
