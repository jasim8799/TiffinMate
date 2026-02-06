const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit phone number']
  },
  // Location is OPTIONAL (for out-of-service area leads)
  location: {
    latitude: {
      type: Number
    },
    longitude: {
      type: Number
    },
    distance: {
      type: Number,
      comment: 'Distance from restaurant in km'
    },
    address: {
      type: String,
      default: ''
    }
  },
  // General inquiry fields
  area: {
    type: String,
    trim: true,
    default: '',
    comment: 'General area/locality for non-location leads'
  },
  message: {
    type: String,
    default: '',
    comment: 'Customer message or inquiry'
  },
  source: {
    type: String,
    enum: ['app', 'referral', 'walk-in', 'location', 'other'],
    default: 'app',
    comment: 'How the lead was generated'
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'converted', 'not-interested', 'closed'],
    default: 'new'
  },
  notificationSent: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for searching
leadSchema.index({ phone: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ status: 1 });

module.exports = mongoose.model('Lead', leadSchema);
