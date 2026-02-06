const mongoose = require('mongoose');

const premiumMenuItemSchema = new mongoose.Schema({
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['dal', 'rice', 'bread', 'veg', 'non-veg', 'biryani', 'raita_sweets_salad'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'Item name is required'],
    trim: true,
    uppercase: true
  },
  isVegOnly: {
    type: Boolean,
    required: true,
    default: true
  },
  compulsoryAddon: {
    type: String,
    default: null,
    trim: true,
    uppercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for efficient querying
premiumMenuItemSchema.index({ category: 1, isVegOnly: 1, isActive: 1 });

// Compound unique index to prevent duplicate items
premiumMenuItemSchema.index({ category: 1, name: 1 }, { unique: true });

const PremiumMenuItem = mongoose.model('PremiumMenuItem', premiumMenuItemSchema);

module.exports = PremiumMenuItem;
