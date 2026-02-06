const mongoose = require('mongoose');

const pauseHistorySchema = new mongoose.Schema({
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
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
    enum: ['paused', 'resumed', 'extended', 'cancelled']
  },
  pauseStartDate: {
    type: Date,
    required: true
  },
  pauseEndDate: {
    type: Date,
    required: true
  },
  actualResumeDate: {
    type: Date
  },
  pauseDays: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    default: ''
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
pauseHistorySchema.index({ subscription: 1, createdAt: -1 });
pauseHistorySchema.index({ user: 1, pauseStartDate: -1 });
pauseHistorySchema.index({ action: 1, status: 1 });
pauseHistorySchema.index({ pauseStartDate: 1, pauseEndDate: 1 });

module.exports = mongoose.model('PauseHistory', pauseHistorySchema);
