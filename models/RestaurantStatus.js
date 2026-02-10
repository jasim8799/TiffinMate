const mongoose = require('mongoose');

const restaurantStatusSchema = new mongoose.Schema({
  isOpen: {
    type: Boolean,
    required: true,
    default: true
  },
  message: {
    type: String,
    default: 'Restaurant is closed today'
  }
}, {
  timestamps: true
});

// Ensure only one document exists
restaurantStatusSchema.index({}, { unique: true, name: 'unique_restaurant_status' });

module.exports = mongoose.model('RestaurantStatus', restaurantStatusSchema);
