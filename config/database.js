const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`📦 MongoDB Connected: ${conn.connection.host}`);

    // ====================================================
    // SELF-HEALING: Drop the conflicting unique_daily_user_date
    // index from MealOrder if it still exists from a prior
    // schema version.  That index enforced uniqueness on
    // { user, deliveryDate, orderSource } WITHOUT mealType,
    // which prevented a daily user from having both a lunch
    // AND a dinner MealOrder on the same date.
    // The correct uniqueness is already handled by the
    // unique_user_date_mealtype index: { user, deliveryDate, mealType }.
    // ====================================================
    try {
      const mealOrdersCol = conn.connection.collection('mealorders');
      const indexes = await mealOrdersCol.indexes();
      if (indexes.some(idx => idx.name === 'unique_daily_user_date')) {
        await mealOrdersCol.dropIndex('unique_daily_user_date');
        console.log('\u2705 DB heal: dropped conflicting index unique_daily_user_date from mealorders');
      }
    } catch (idxErr) {
      // Non-fatal: log and continue. The migration script can be run manually.
      console.warn('\u26a0\ufe0f Could not drop unique_daily_user_date index:', idxErr.message);
    }

    // Ensure performance index for fast per-user date lookups (critical for new users)
    try {
      const mealOrdersCol2 = conn.connection.collection('mealorders');
      await mealOrdersCol2.createIndex(
        { user: 1, deliveryDate: 1 },
        { name: 'user_deliveryDate_perf', background: true }
      );
      console.log('\u2705 DB: Ensured index user_deliveryDate_perf on mealorders');
    } catch (idxErr) {
      console.warn('\u26a0\ufe0f Could not create user_deliveryDate_perf index:', idxErr.message);
    }

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
