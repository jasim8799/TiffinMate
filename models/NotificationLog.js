const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  mobile: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: [
      'otp',
      'credentials',
      'subscription-reminder',
      'subscription-expiry',
      'subscription-disabled',
      'delivery-preparing',
      'delivery-on-way',
      'delivery-delivered',
      'payment-reminder',
      'payment-overdue',
      'access-approved',
      'access-rejected',
      'other'
    ],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['sent', 'failed', 'pending'],
    default: 'pending'
  },
  provider: {
    type: String,
    default: 'fast2sms'
  },
  response: mongoose.Schema.Types.Mixed,
  sentAt: Date,
  errorMessage: String
}, {
  timestamps: true
});

// Index for efficient querying
notificationLogSchema.index({ user: 1, createdAt: -1 });
notificationLogSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
