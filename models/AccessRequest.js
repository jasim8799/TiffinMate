const mongoose = require('mongoose');

const accessRequestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  mobile: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    landmark: String
  },
planType: {
  type: String,
  enum: ['daily', 'weekly', 'monthly'],
  required: true
},
  mealPreferences: {
    includesLunch: {
      type: Boolean,
      default: true
    },
    includesDinner: {
      type: Boolean,
      default: true
    }
  },
  message: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  rejectionReason: String,
  createdUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  credentialsSent: {
    type: Boolean,
    default: false
  },
  credentialsSentAt: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('AccessRequest', accessRequestSchema);
