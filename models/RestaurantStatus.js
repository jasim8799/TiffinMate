const mongoose = require('mongoose');

const restaurantStatusSchema = new mongoose.Schema({
  isOpen: {
    type: Boolean,
    required: true,
    default: true
  },
  // ✅ BUG 2 FIX: Date-scoped close. When set, only orders for THIS date are blocked.
  // After the date passes, the middleware auto-ignores it (no manual reset needed).
  closedDate: {
    type: Date,
    default: null
  },
  message: {
    type: String,
    default: 'Restaurant is closed today'
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// Ensure only one document exists
restaurantStatusSchema.index({}, { unique: true, name: 'unique_restaurant_status' });

module.exports = mongoose.model('RestaurantStatus', restaurantStatusSchema);
