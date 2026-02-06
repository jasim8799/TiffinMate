const mongoose = require('mongoose');

const deliveryHistorySchema = new mongoose.Schema({
  delivery: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'created',
      'cooking_started',
      'cooking_completed',
      'dispatched',
      'out_for_delivery',
      'delivered',
      'failed',
      'cancelled',
      'rescheduled',
      'status_changed'
    ]
  },
  previousStatus: {
    type: String,
    enum: ['pending', 'preparing', 'on-the-way', 'delivered', 'cancelled', 'failed']
  },
  newStatus: {
    type: String,
    enum: ['pending', 'preparing', 'on-the-way', 'delivered', 'cancelled', 'failed']
  },
  deliveryDate: {
    type: Date,
    required: true
  },
  mealType: {
    type: String,
    enum: ['lunch', 'dinner'],
    required: true
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  notes: {
    type: String,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
deliveryHistorySchema.index({ delivery: 1, createdAt: -1 });
deliveryHistorySchema.index({ user: 1, deliveryDate: -1 });
deliveryHistorySchema.index({ action: 1, createdAt: -1 });
deliveryHistorySchema.index({ deliveryDate: 1, mealType: 1 });

module.exports = mongoose.model('DeliveryHistory', deliveryHistorySchema);
