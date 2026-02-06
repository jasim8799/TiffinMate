const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    // ======================
    // CORE REFERENCES
    // ======================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null
    },

    // ======================
    // PAYMENT TYPE
    // ======================
    paymentFor: {
      type: String,
      enum: ['subscription', 'daily_meal'],
      required: true,
      index: true
    },

    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'online', 'manual', 'other'],
      default: 'cash'
    },

    paymentGateway: {
      type: String,
      enum: ['RAZORPAY', null],
      default: null
    },

    // ======================
    // AMOUNT & STATUS
    // ======================
    amount: {
      type: Number,
      required: true
    },

    paidAmount: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ['pending', 'pending_manual', 'paid', 'verified', 'failed', 'rejected'],
      default: 'pending',
      index: true
    },

    // ======================
    // DAILY MEAL SUPPORT 🔥
    // ======================
    deliveryDate: {
      type: Date,
      index: true
    },

    metadata: {
      lunch: { type: Object },
      dinner: { type: Object },
      pricePerMeal: { type: Number }
    },

    // ======================
    // RAZORPAY FIELDS
    // ======================
    razorpayOrderId: {
      type: String,
      index: true
    },

    razorpayPaymentId: {
      type: String
    },

    razorpaySignature: {
      type: String
    },

    webhookId: {
      type: String
    },

    webhookProcessedAt: {
      type: Date
    },

    // ======================
    // TIME TRACKING
    // ======================
    paymentDate: {
      type: Date,
      default: Date.now
    },

    paidAt: {
      type: Date
    },

    receivedAt: {
      type: Date
    },

    verifiedAt: {
      type: Date
    },

    // ======================
    // OWNER ACTIONS
    // ======================
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    referenceNote: {
      type: String,
      default: ''
    },

    // ======================
    // MONTHLY TRACKING
    // ======================
    month: {
      type: Number,
      index: true
    },

    year: {
      type: Number,
      index: true
    }
  },
  {
    timestamps: true
  }
);


// ======================
// IMPORTANT INDEXES
// ======================
// Compound index for daily meals
paymentSchema.index(
  { user: 1, paymentFor: 1, deliveryDate: 1, status: 1 },
  { unique: false }
);

// Subscription monthly summary index
paymentSchema.index(
  { user: 1, subscription: 1, month: 1, year: 1 },
  { unique: false }
);

// 🔒 CRITICAL: Database-level protection for daily meal payment uniqueness
// Ensures only ONE payment per user per delivery date with status pending/paid/verified
paymentSchema.index(
  { user: 1, paymentFor: 1, deliveryDate: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentFor: 'daily_meal',
      status: { $in: ['pending', 'paid', 'verified'] }
    },
    name: 'daily_meal_unique_constraint'
  }
);

module.exports = mongoose.model('Payment', paymentSchema);
