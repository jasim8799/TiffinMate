const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  mealType: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Paused'],
    default: 'Active'
  },
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid'],
    default: 'Pending'
  },
  paymentMode: {
    type: String,
    enum: ['Cash', 'UPI']
  },
  deliveredDates: [{
    type: Date
  }],
  deliveryHistory: [{
    date: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ['Pending', 'OutForDelivery', 'Delivered'],
      required: true
    }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
