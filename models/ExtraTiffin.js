const mongoose = require('mongoose');

const extraTiffinSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestDate: {
    type: Date,
    default: Date.now
  },
  deliveryDate: {
    type: Date,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  mealType: {
    type: String,
    enum: ['lunch', 'dinner', 'both'],
    required: true
  },
  reason: {
    type: String,
    default: 'guest'
  },
  chargePerTiffin: {
    type: Number,
    required: true
  },
  totalCharge: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'delivered'],
    default: 'pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  delivery: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery'
  },
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  notes: String
}, {
  timestamps: true
});

// Calculate total charge before saving
extraTiffinSchema.pre('save', function(next) {
  this.totalCharge = this.quantity * this.chargePerTiffin;
  next();
});

module.exports = mongoose.model('ExtraTiffin', extraTiffinSchema);
