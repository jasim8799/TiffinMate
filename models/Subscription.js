const mongoose = require('mongoose');

// Constants for clarity (future-proof naming)
const FOOD_TYPES = ['trial', 'classic', 'premium-veg', 'premium-non-veg'];
const BILLING_CATEGORIES = ['trial', 'classic', 'premium'];
const SUBSCRIPTION_STATUSES = ['pending_approval', 'pending', 'active', 'expired', 'grace', 'disabled', 'paused', 'rejected'];

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPlan'
  },
  // TODO: Future migration - rename to 'foodType'
  planType: {
    type: String,
    enum: FOOD_TYPES, // Currently stores food type: trial, classic, premium-veg, premium-non-veg
    required: true
  },
  // TODO: Future migration - rename to 'billingCategory'
  planCategory: {
    type: String,
    enum: BILLING_CATEGORIES, // Currently stores billing category: trial, classic, premium
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  expiredAt: {
    type: Date // Timestamp when subscription was moved to expired status
  },
  graceStartedAt: {
    type: Date,
    default: null // Timestamp when grace period started
  },
  totalDays: {
    type: Number,
    required: true
  },
  usedDays: {
    type: Number,
    default: 0
  },
  remainingDays: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: SUBSCRIPTION_STATUSES,
    default: 'pending_approval'
  },
  amount: {
    type: Number,
    required: true
  },
  paymentMode: {
    type: String,
    enum: ['cash', 'online'],
    default: 'cash'
  },
  planDetails: {
    planId: mongoose.Schema.Types.ObjectId,
    planName: String,
    // LEGACY FIELD: planType was ambiguous (could be duration or food type)
    // Use durationType and foodType instead for new records
    planType: String, // Legacy: ambiguous field (duration or food type)
    // NEW FIELDS: Clear separation of concerns
    durationType: {
      type: String,
      enum: ['monthly', 'weekly', 'custom']
    },
    foodType: {
      type: String,
      enum: ['veg', 'non-veg', 'both']
    }
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: {
    type: Date
  },
  mealPreferences: {
    includesLunch: {
      type: Boolean,
      default: true
    },
    includesDinner: {
      type: Boolean,
      default: true
    },
    dietaryPreference: {
      type: String,
      enum: ['veg', 'non-veg', 'both'],
      default: 'both'
    }
  },
  // Clear lifecycle notification flags (replaces confusing expiryReminderSent, expiryWarningSent, disableReminderSent)
  reminderSent: {
    type: Boolean,
    default: false // T-2 days reminder
  },
  expiredNotified: {
    type: Boolean,
    default: false // T=0 expiry notification
  },
  graceNotified: {
    type: Boolean,
    default: false // T+1 grace period warning
  },
  disabledNotified: {
    type: Boolean,
    default: false // Final disable notification
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  activatedViaPaymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  // ── Phase 5: Renewal ledger ──────────────────────────────────
  previousExpiryDate: {
    type: Date,
    default: null
  },
  renewedAt: {
    type: Date,
    default: null
  },
  renewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Skip ledger counters
  totalLunchSkipped: {
    type: Number,
    default: 0
  },
  totalDinnerSkipped: {
    type: Number,
    default: 0
  },
  overrideLog: [{
    action: {
      type: String,
      required: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    at: {
      type: Date,
      default: Date.now
    },
    note: {
      type: String,
      default: ''
    }
  }]
}, {
  timestamps: true
});

// Add performance index for user and status queries
subscriptionSchema.index({ user: 1, status: 1 });

// Add partial unique index: user unique where status in ['active','grace','paused']
subscriptionSchema.index(
  { user: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['active', 'grace', 'paused'] }
    }
  }
);

// Update remaining days before saving
// Ensures remainingDays stays correct even if usedDays changes later
subscriptionSchema.pre('save', async function(next) {
  // Only recompute remainingDays when usedDays or totalDays are modified
  if (this.isModified('usedDays') || this.isModified('totalDays')) {
    this.remainingDays = Math.max(0, this.totalDays - this.usedDays);
  }

  // Chaos mode: randomly delay saves to test race conditions
  if (process.env.CHAOS_MODE === 'true') {
    const delay = Math.random() * 5000; // 0-5 seconds
    console.log(`CHAOS_MODE: Delaying subscription save by ${delay.toFixed(0)}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  next();
});

// Method to check if subscription is about to expire
subscriptionSchema.methods.isNearExpiry = function(days = 2) {
  // Return false unless status is active or grace
  if (this.status !== 'active' && this.status !== 'grace') {
    return false;
  }

  // Normalize date comparison using start-of-day math
  const moment = require('moment');
  const today = moment().startOf('day');
  const endDate = moment(this.endDate).startOf('day');
  const daysUntilExpiry = endDate.diff(today, 'days');

  return daysUntilExpiry <= days && daysUntilExpiry > 0;
};

  // Method to check if subscription is past its end date
  subscriptionSchema.methods.isPastEndDate = function() {
    return new Date() > this.endDate;
  };

  // Legacy method - kept for backward compatibility but semantically incorrect
  subscriptionSchema.methods.hasExpired = function() {
    return this.isPastEndDate();
  };

// Method to increment used days
// NOTE: Removed expiry logic - expiry is now handled ONLY by cron jobs to prevent race conditions
subscriptionSchema.methods.markDayUsed = async function() {
  this.usedDays += 1;
  this.remainingDays = this.totalDays - this.usedDays;
  await this.save();
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
