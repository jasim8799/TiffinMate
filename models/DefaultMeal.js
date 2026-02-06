const mongoose = require('mongoose');

const defaultMealSchema = new mongoose.Schema({
  mealType: {
    type: String,
    enum: ['lunch', 'dinner'],
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  items: [{
    type: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('DefaultMeal', defaultMealSchema);
