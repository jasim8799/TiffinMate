const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true
  },
  deliveryDate: {
    type: Date,
    required: true
  },
  mealType: {
    type: String,
    enum: ['lunch', 'dinner', 'both'],
    required: true
  },
  status: {
    type: String,
    enum: ['preparing', 'on-the-way', 'delivered', 'paused', 'disabled'],
    default: 'preparing'
  },
  deliveryBoy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  meals: {
    lunch: {
      name: String,
      items: [String]
    },
    dinner: {
      name: String,
      items: [String]
    }
  },
  preparingStartTime: Date,
  outForDeliveryTime: Date,
  deliveredTime: Date,
  estimatedDeliveryTime: Date,
  notes: String,
  isExtraTiffin: {
    type: Boolean,
    default: false
  },
  extraCharge: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for efficient querying
deliverySchema.index({ user: 1, deliveryDate: 1 });
deliverySchema.index({ deliveryDate: 1, status: 1 });

// Unique indexes
deliverySchema.index({ user: 1, deliveryDate: 1 }, { unique: true });
deliverySchema.index({ user: 1, deliveryDate: 1, mealType: 1 }, { unique: true });

// Method to update status with timestamp.
// STATUS CHANGES ONLY VIA OWNER ACTION — never auto, never cron.
deliverySchema.methods.updateStatus = async function(newStatus) {
  const allowedStatuses = ['preparing', 'on-the-way', 'delivered', 'paused', 'disabled'];
  if (!allowedStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Allowed: ${allowedStatuses.join(', ')}`);
  }

  this.status = newStatus;

  switch (newStatus) {
    case 'preparing':
      this.preparingStartTime = new Date();
      break;
    case 'on-the-way':
      this.outForDeliveryTime = new Date();
      if (!this.estimatedDeliveryTime) {
        this.estimatedDeliveryTime = new Date(Date.now() + 60 * 60 * 1000);
      }
      break;
    case 'delivered':
      this.deliveredTime = new Date();
      break;
    // paused / disabled: no timestamp needed
  }

  return this.save();
};

// REMOVED: getDeliveryStatus() — time-based auto-override is prohibited.
// Status ONLY changes via owner action through updateStatus().

module.exports = mongoose.model('Delivery', deliverySchema);
