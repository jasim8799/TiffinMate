const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  mobile: {
    type: String,
    required: [true, 'Mobile number is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Remove spaces, dashes, and plus signs
        const cleaned = v.replace(/[\s\-\+]/g, '');
        // Accept 10-15 digit numbers (international format)
        return /^\d{10,15}$/.test(cleaned);
      },
      message: props => `${props.value} is not a valid mobile number! Must be 10-15 digits.`
    }
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    landmark: String
  },
  role: {
    type: String,
    enum: ['owner', 'customer', 'delivery'],
    default: 'customer'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPasswordChanged: {
    type: Boolean,
    default: false
  },
  forcePasswordChange: {
    type: Boolean,
    default: true  // New users must change password on first login
  },
  hasUsedTrial: {
    type: Boolean,
    default: false  // Track if user has used their 3-day trial period
  },
  profileImage: {
    type: String,
    default: null
  },
  idDocument: {
    type: String,
    default: null
  },
  idDocumentType: {
    type: String,
    default: null
  },
  idVerificationStatus: {
    type: String,
    enum: ['not_uploaded', 'pending', 'approved', 'rejected'],
    default: 'not_uploaded'
  },
  idVerifiedAt: {
    type: Date,
    default: null
  },
  idVerifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  otp: {
    code: String,
    expiry: Date,
    attempts: {
      type: Number,
      default: 0
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to generate OTP
userSchema.methods.generateOTP = async function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Hash OTP with bcrypt for security (same salt rounds as password)
  const salt = await bcrypt.genSalt(10);
  const hashedOTP = await bcrypt.hash(otp, salt);
  
  this.otp = {
    code: hashedOTP,  // Store HASHED OTP, not plain text
    expiry: new Date(Date.now() + 5 * 60 * 1000),  // 5 minutes expiry
    attempts: 0
  };
  
  return otp;  // Return plain OTP to send via SMS
};

// Method to verify OTP
userSchema.methods.verifyOTP = async function(candidateOTP) {
  if (!this.otp || !this.otp.code) {
    return { success: false, message: 'No OTP generated' };
  }
  
  if (this.otp.attempts >= 3) {
    return { success: false, message: 'Maximum OTP attempts exceeded' };
  }
  
  if (new Date() > this.otp.expiry) {
    return { success: false, message: 'OTP expired' };
  }
  
  this.otp.attempts += 1;
  
  // Compare OTP using bcrypt (since we store hashed OTP)
  const isMatch = await bcrypt.compare(candidateOTP, this.otp.code);
  
  if (isMatch) {
    this.otp = undefined; // Clear OTP after successful verification
    return { success: true, message: 'OTP verified successfully' };
  }
  
  return { success: false, message: 'Invalid OTP' };
};

module.exports = mongoose.model('User', userSchema);
