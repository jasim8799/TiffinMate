const mongoose = require('mongoose');

const idempotencySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  endpoint: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['processing', 'completed'],
    default: 'processing'
  },
  response: {
    statusCode: Number,
    body: mongoose.Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // 24 hours TTL
  }
}, {
  timestamps: true
});

// Compound index for key + userId + endpoint
idempotencySchema.index({ key: 1, userId: 1, endpoint: 1 }, { unique: true });

module.exports = mongoose.model('Idempotency', idempotencySchema);
