const mongoose = require('mongoose');

const cronLockSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CronLock', cronLockSchema);
