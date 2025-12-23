const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  area: {
    type: String,
    required: true
  },
  priceMonthly: {
    type: Number,
    required: true
  },
  mealTypes: {
    type: [String],
    required: true,
    default: []
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Provider', providerSchema);
