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
  deliveryStatus: {
    type: String,
    enum: ['IDLE', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'],
    default: 'IDLE'
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

// Method to update status with timestamp
deliverySchema.methods.updateStatus = async function(newStatus) {
  // Status whitelist validation
  const allowedStatuses = ['preparing', 'on-the-way', 'delivered', 'paused', 'disabled'];
  if (!allowedStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Allowed: ${allowedStatuses.join(', ')}`);
  }

  this.status = newStatus;

  switch (newStatus) {
    case 'preparing':
      this.preparingStartTime = new Date();
      this.deliveryStatus = 'PREPARING';
      break;
    case 'on-the-way':
      this.outForDeliveryTime = new Date();
      this.deliveryStatus = 'OUT_FOR_DELIVERY';
      // Do not overwrite ETA repeatedly: only set if not already set
      if (!this.estimatedDeliveryTime) {
        this.estimatedDeliveryTime = new Date(Date.now() + 60 * 60 * 1000);
      }
      break;
    case 'delivered':
      this.deliveredTime = new Date();
      this.deliveryStatus = 'DELIVERED';
      break;
    case 'paused':
    case 'disabled':
      this.deliveryStatus = 'IDLE';
      break;
  }

  return this.save();
};

// Method to get time-aware delivery status
deliverySchema.methods.getDeliveryStatus = function() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // Define meal times
  const LUNCH_TIME = 12; // 12:00 PM (noon)
  const DINNER_TIME = 20; // 8:00 PM
  
  // Preparation window: 1 hour before meal time
  // LUNCH: 11:00 AM - 12:00 PM
  // DINNER: 7:00 PM - 8:00 PM
  
  // If owner has marked as OUT_FOR_DELIVERY
  if (this.deliveryStatus === 'OUT_FOR_DELIVERY') {
    // Check if 1 hour has passed since outForDeliveryTime
    if (this.outForDeliveryTime) {
      const hoursSinceDelivery = (now - this.outForDeliveryTime) / (1000 * 60 * 60);
      if (hoursSinceDelivery >= 1) {
        return 'DELIVERED';
      }
    }
    return 'OUT_FOR_DELIVERY';
  }
  
  // If already delivered
  if (this.deliveryStatus === 'DELIVERED') {
    return 'DELIVERED';
  }
  
  // Check if within 1 hour before meal time
  const mealType = this.mealType.toLowerCase();
  if (mealType === 'lunch' || mealType === 'both') {
    if (currentHour === LUNCH_TIME - 1 || (currentHour === LUNCH_TIME && currentMinute === 0)) {
      return 'PREPARING';
    }
  }
  
  if (mealType === 'dinner' || mealType === 'both') {
    if (currentHour === DINNER_TIME - 1 || (currentHour === DINNER_TIME && currentMinute === 0)) {
      return 'PREPARING';
    }
  }
  
  return 'IDLE';
};

module.exports = mongoose.model('Delivery', deliverySchema);
