const mongoose = require('mongoose');

// Weekly Menu Schema
const mealSchema = new mongoose.Schema({
  lunch: {
    type: String,
    default: ''
  },
  dinner: {
    type: String,
    default: ''
  }
}, { _id: false });

const weeklyMenuSchema = new mongoose.Schema({
  sunday: { type: mealSchema, default: () => ({}) },
  monday: { type: mealSchema, default: () => ({}) },
  tuesday: { type: mealSchema, default: () => ({}) },
  wednesday: { type: mealSchema, default: () => ({}) },
  thursday: { type: mealSchema, default: () => ({}) },
  friday: { type: mealSchema, default: () => ({}) },
  saturday: { type: mealSchema, default: () => ({}) }
}, { _id: false });

const subscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  durationType: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true
  },
  durationDays: {
    type: Number,
    required: true
  },
  pricePerDay: {
    type: Number,
    required: true
  },
  totalPrice: {
    type: Number,
    required: true
  },
  planCategory: {
    type: String,
    enum: ['trial', 'classic', 'premium'],
    default: 'classic'
  },
  type: {
    type: String,
    enum: ['VEG', 'NON_VEG', 'MIX'],
    required: true,
    default: 'MIX'
  },
  menuCategory: {
    type: String,
    enum: ['classic', 'premium-veg', 'premium-non-veg'],
    required: true
  },
  mealTypes: {
    lunch: {
      type: Boolean,
      default: true
    },
    dinner: {
      type: Boolean,
      default: true
    }
  },
  // Weekly menu for the subscription plan
  weeklyMenu: {
    type: weeklyMenuSchema,
    default: () => ({})
  },
  isActive: {
    type: Boolean,
    default: true
  },
  features: [String],
  sortOrder: {
    type: Number,
    default: 0
  },
  // Owner who created this plan
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for efficient querying
subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });
subscriptionPlanSchema.index({ durationType: 1, isActive: 1 });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
