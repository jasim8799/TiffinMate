const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: [
      'NEW_USER',
      'NEW_CUSTOMER',
      'PAYMENT_PENDING',
      'PAYMENT_RECEIVED',
      'PAYMENT_VERIFIED',
      'PAYMENT_FAILED',
      'MEAL_ORDERED',
      'MEAL_CHANGED',
      'SUBSCRIPTION_CREATED',
      'SUBSCRIPTION_EXPIRING',
      'SUBSCRIPTION_EXPIRED',
      'SUBSCRIPTION_RENEWED',
      'DELIVERY_SCHEDULED',
      'DELIVERY_COMPLETED',
      'NEW_LEAD',
      'CUSTOMER_COMPLAINT',
      'LOW_STOCK',
      'OTHER'
    ],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'relatedModel'
  },
  relatedModel: {
    type: String,
    enum: ['User', 'Payment', 'Subscription', 'MealOrder', 'Delivery', 'Lead']
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
