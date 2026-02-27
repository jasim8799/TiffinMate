const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['preparing', 'on-the-way', 'delivered', 'paused', 'disabled'],
    default: 'preparing'
  },
  // ── Per-meal statuses (owned by API, never by time) ──────────────────────
  lunchStatus: {
    type: String,
    enum: ['preparing', 'on-the-way', 'delivered', 'paused'],
    default: 'preparing'
  },
  dinnerStatus: {
    type: String,
    enum: ['preparing', 'on-the-way', 'delivered', 'paused'],
    default: 'preparing'
  },
  deliveryBoy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  meals: {
    lunch: {
      name: String,
      items: [String]
    },
    dinner: {
      name: String,
      items: [String]
    }
  },
  preparingStartTime: Date,
  outForDeliveryTime: Date,
  deliveredTime: Date,
  estimatedDeliveryTime: Date,
  notes: String,
  isExtraTiffin: {
    type: Boolean,
    default: false
  },
  extraCharge: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for efficient querying
deliverySchema.index({ user: 1, deliveryDate: 1 });
deliverySchema.index({ deliveryDate: 1, status: 1 });

// Unique indexes
deliverySchema.index({ user: 1, deliveryDate: 1 }, { unique: true });
deliverySchema.index({ user: 1, deliveryDate: 1, mealType: 1 }, { unique: true });

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH — MANDATORY ARCHITECTURE RULE
//
// ALL delivery status changes MUST go through updateMealStatus().
// updateStatus() has been intentionally removed to prevent architectural drift.
//
// Rationale:
//   updateStatus() only wrote delivery.status and left lunchStatus/dinnerStatus
//   stale, causing UI mismatch on the Home screen and the Today tab.
//
//   updateMealStatus() writes the per-meal status and then derives the overall
//   delivery.status via computeDerivedStatus() — the single source of truth.
//
// If you find yourself needing an "overall" status update without a meal type,
// decide which meals are affected (all of them if delivery.mealType === 'both')
// and call updateMealStatus() for each one.
// ─────────────────────────────────────────────────────────────────────────────

// REMOVED: getDeliveryStatus() — time-based auto-override is prohibited.
// REMOVED: updateStatus() — replaced by updateMealStatus() as the single source of truth.
// Status ONLY changes via owner action through updateMealStatus().

// ─────────────────────────────────────────────────────────────────────────────
// Derive the overall delivery status from per-meal statuses.
// Rules:
//   both delivered            → 'delivered'
//   any on-the-way            → 'on-the-way'
//   any preparing             → 'preparing'
//   both paused               → 'paused'
// This is called automatically by updateMealStatus().
// ─────────────────────────────────────────────────────────────────────────────
deliverySchema.statics.computeDerivedStatus = function(lunchStatus, dinnerStatus, mealType) {
  const statuses = [];
  if (mealType === 'lunch' || mealType === 'both') statuses.push(lunchStatus || 'preparing');
  if (mealType === 'dinner' || mealType === 'both') statuses.push(dinnerStatus || 'preparing');
  if (statuses.length === 0) return 'preparing';
  if (statuses.every(s => s === 'delivered')) return 'delivered';
  if (statuses.some(s => s === 'on-the-way')) return 'on-the-way';
  if (statuses.some(s => s === 'preparing')) return 'preparing';
  if (statuses.every(s => s === 'paused')) return 'paused';
  return 'preparing';
};

// ─────────────────────────────────────────────────────────────────────────────
// Update the status for a specific meal type and recompute the derived status.
// mealType must be 'lunch' or 'dinner'.
// newStatus must be one of: preparing | on-the-way | delivered | paused
// ─────────────────────────────────────────────────────────────────────────────
deliverySchema.methods.updateMealStatus = async function(mealType, newStatus) {
  const allowedStatuses = ['preparing', 'on-the-way', 'delivered', 'paused'];
  if (!allowedStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: "${newStatus}". Allowed: ${allowedStatuses.join(', ')}`);
  }
  if (!['lunch', 'dinner'].includes(mealType)) {
    throw new Error(`mealType must be "lunch" or "dinner", got: "${mealType}"`);
  }

  // Apply per-meal status
  if (mealType === 'lunch') this.lunchStatus = newStatus;
  if (mealType === 'dinner') this.dinnerStatus = newStatus;

  // Timestamp housekeeping
  if (newStatus === 'preparing' && !this.preparingStartTime) {
    this.preparingStartTime = new Date();
  }
  if (newStatus === 'on-the-way' && !this.outForDeliveryTime) {
    this.outForDeliveryTime = new Date();
    if (!this.estimatedDeliveryTime) {
      this.estimatedDeliveryTime = new Date(Date.now() + 60 * 60 * 1000);
    }
  }
  if (newStatus === 'delivered') {
    this.deliveredTime = new Date();
  }

  // Derive and write overall status
  this.status = this.constructor.computeDerivedStatus(
    this.lunchStatus,
    this.dinnerStatus,
    this.mealType
  );

  return this.save();
};

module.exports = mongoose.model('Delivery', deliverySchema);
