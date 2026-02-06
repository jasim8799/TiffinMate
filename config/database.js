const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`📦 MongoDB Connected: ${conn.connection.host}`);

    // Create default admin user on first run
    const User = require('../models/User');
    const adminExists = await User.findOne({ role: 'owner' });
    
    if (!adminExists) {
      console.log('🔧 Creating default admin user...');
      
      // Validate required environment variables
      const adminMobile = process.env.DEFAULT_ADMIN_MOBILE;
      if (!adminMobile || adminMobile === '1234567890') {
        console.error('❌ DEFAULT_ADMIN_MOBILE must be set to a valid 10-digit Indian mobile number in environment variables');
        process.exit(1);
      }
      
      // Validate Indian mobile format (10 digits, starts with 6-9)
      if (!/^[6-9]\d{9}$/.test(adminMobile)) {
        console.error('❌ DEFAULT_ADMIN_MOBILE must be a valid 10-digit Indian mobile number (starting with 6-9)');
        process.exit(1);
      }
      
      await User.create({
        userId: process.env.DEFAULT_ADMIN_USERID || 'ADMIN001',
        password: process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123',
        mobile: adminMobile,
        name: 'Admin',
        role: 'owner',
        isActive: true,
        isPasswordChanged: false
      });
      console.log(`✅ Default admin user created with mobile: ${adminMobile.substring(0, 3)}****${adminMobile.substring(7)}`);
    }
  } catch (error) {
    console.error(`❌ Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
