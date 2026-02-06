const mongoose = require('mongoose');

const expiryAuditSchema = new mongoose.Schema({
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  oldStatus: {
    type: String,
    required: true
  },
  newStatus: {
    type: String,
    required: true
  },
  expiredAt: {
    type: Date,
    required: true
  },
  cronRunId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CronLock',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ExpiryAudit', expiryAuditSchema);
