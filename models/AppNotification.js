const mongoose = require('mongoose');

const appNotificationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'user_created',
      'subscription_requested',
      'subscription_approved',
      'subscription_rejected',
      'subscription_activated',
      'meal_selected',
      'payment_created',
      'payment_verified',
      'delivery_cooking',
      'delivery_dispatched',
      'delivery_completed',
      'trial_expiring',
      'subscription_expiring',
      'password_reset',
      'password_reset_admin',
      'password_changed',
      'subscription_paused',
      'subscription_resumed',
      'meal_skipped',
      'extra_tiffin_ordered',
      'extra_tiffin_new'
    ]
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  relatedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  relatedModel: {
    type: String,
    enum: ['User', 'Subscription', 'Meal', 'Payment', 'Delivery', 'ExtraTiffin'],
    required: true
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for performance
appNotificationSchema.index({ type: 1, createdAt: -1 });
appNotificationSchema.index({ isRead: 1, createdAt: -1 });
appNotificationSchema.index({ relatedUser: 1, createdAt: -1 });
appNotificationSchema.index({ priority: 1, isRead: 1, createdAt: -1 });

// Static method to create notification
appNotificationSchema.statics.createNotification = async function(data) {
  try {
    const notification = await this.create(data);
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Instance method to mark as read
appNotificationSchema.methods.markAsRead = async function() {
  this.isRead = true;
  this.readAt = new Date();
  await this.save();
  return this;
};

module.exports = mongoose.model('AppNotification', appNotificationSchema);
