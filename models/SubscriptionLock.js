const mongoose = require('mongoose');

const subscriptionLockSchema = new mongoose.Schema({
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
    unique: true,
    index: true
  },
  operation: {
    type: String,
    enum: ['expiry_cron', 'api_update', 'pause_approval', 'payment_processing'],
    required: true
  },
  lockedAt: {
    type: Date,
    default: Date.now,
    expires: 300 // Auto-expire after 5 minutes to prevent deadlocks
  },
  lockedBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

// Prevent duplicate locks
subscriptionLockSchema.index({ subscriptionId: 1 }, { unique: true });

// Static method to acquire lock
subscriptionLockSchema.statics.acquireLock = async function(subscriptionId, operation, lockedBy = 'system') {
  try {
    const lock = await this.create({
      subscriptionId,
      operation,
      lockedBy
    });
    return { success: true, lock };
  } catch (error) {
    if (error.code === 11000) {
      // Lock already exists
      return { success: false, reason: 'already_locked' };
    }
    throw error;
  }
};

// Static method to release lock
subscriptionLockSchema.statics.releaseLock = async function(subscriptionId) {
  try {
    const result = await this.deleteOne({ subscriptionId });
    return result.deletedCount > 0;
  } catch (error) {
    console.error('Error releasing subscription lock:', error);
    return false;
  }
};

// Static method to check if locked
subscriptionLockSchema.statics.isLocked = async function(subscriptionId) {
  const lock = await this.findOne({ subscriptionId });
  return !!lock;
};

module.exports = mongoose.model('SubscriptionLock', subscriptionLockSchema);
