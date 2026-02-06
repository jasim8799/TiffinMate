/**
 * ======================================================================
 * DATABASE MIGRATION: Fix Duplicate MealOrders
 * ======================================================================
 * This script:
 * 1. Ensures unique compound index exists on MealOrder
 * 2. Identifies and removes duplicate MealOrders
 * 3. Validates data integrity
 * 
 * Run this BEFORE deploying the code fix
 * ======================================================================
 */

const mongoose = require('mongoose');
const MealOrder = require('./models/MealOrder');
const moment = require('moment-timezone');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tiffinmate';

async function fixDuplicateMealOrders() {
  try {
    console.log('\n======================================================================');
    console.log('🔧 DATABASE MIGRATION: Fix Duplicate MealOrders');
    console.log('======================================================================\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // ========================================
    // STEP 1: Check Current Index Status
    // ========================================
    console.log('📋 STEP 1: Checking Index Status');
    console.log('----------------------------------------------------------------------');
    
    const indexes = await MealOrder.collection.getIndexes();
    console.log('Current indexes:', Object.keys(indexes));
    
    const uniqueIndexExists = indexes.hasOwnProperty('unique_user_date_mealtype') || 
                              Object.values(indexes).some(idx => 
                                idx.unique && 
                                idx.key && 
                                idx.key.user && 
                                idx.key.deliveryDate && 
                                idx.key.mealType
                              );
    
    if (uniqueIndexExists) {
      console.log('✅ Unique compound index already exists');
    } else {
      console.log('⚠️  Unique compound index NOT found');
      console.log('   Creating index: { user: 1, deliveryDate: 1, mealType: 1 }');
      
      try {
        await MealOrder.collection.createIndex(
          { user: 1, deliveryDate: 1, mealType: 1 },
          { unique: true, name: 'unique_user_date_mealtype' }
        );
        console.log('✅ Unique compound index created successfully');
      } catch (err) {
        if (err.code === 11000) {
          console.error('❌ Cannot create index - duplicates exist!');
          console.log('   Will proceed to remove duplicates first...');
        } else {
          throw err;
        }
      }
    }

    // ========================================
    // STEP 2: Find Duplicate MealOrders
    // ========================================
    console.log('\n📋 STEP 2: Finding Duplicate MealOrders');
    console.log('----------------------------------------------------------------------');
    
    const duplicates = await MealOrder.aggregate([
      {
        $group: {
          _id: {
            user: '$user',
            deliveryDate: '$deliveryDate',
            mealType: '$mealType'
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
          createdAts: { $push: '$createdAt' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    console.log(`Found ${duplicates.length} duplicate groups\n`);

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found - database is clean!');
    } else {
      console.log('⚠️  Duplicates found! Details:\n');
      
      let totalDuplicates = 0;
      for (const dup of duplicates) {
        totalDuplicates += (dup.count - 1);
        
        // Get user details
        const mealOrder = await MealOrder.findById(dup.ids[0]).populate('user', 'name userId');
        const userName = mealOrder?.user?.name || 'Unknown User';
        const userId = mealOrder?.user?.userId || 'Unknown ID';
        
        console.log(`📦 Group: ${userName} (${userId})`);
        console.log(`   Date: ${moment(dup._id.deliveryDate).format('YYYY-MM-DD')}`);
        console.log(`   Type: ${dup._id.mealType}`);
        console.log(`   Duplicates: ${dup.count} records`);
        console.log(`   IDs: ${dup.ids.map(id => id.toString()).join(', ')}`);
        console.log('');
      }
      
      console.log(`📊 Summary: ${totalDuplicates} duplicate records to remove\n`);

      // ========================================
      // STEP 3: Remove Duplicates (Keep Oldest)
      // ========================================
      console.log('📋 STEP 3: Removing Duplicates');
      console.log('----------------------------------------------------------------------');
      console.log('Strategy: Keep OLDEST record (earliest createdAt), delete others\n');

      let removedCount = 0;

      for (const dup of duplicates) {
        // Sort IDs by createdAt (oldest first)
        const sortedData = dup.ids.map((id, index) => ({
          id: id,
          createdAt: dup.createdAts[index]
        })).sort((a, b) => a.createdAt - b.createdAt);

        // Keep the first (oldest), remove the rest
        const idsToRemove = sortedData.slice(1).map(item => item.id);

        console.log(`Removing ${idsToRemove.length} duplicates for group ${dup._id.user}...`);
        
        const result = await MealOrder.deleteMany({
          _id: { $in: idsToRemove }
        });

        removedCount += result.deletedCount;
        console.log(`✅ Removed ${result.deletedCount} duplicate records`);
      }

      console.log(`\n✅ Total removed: ${removedCount} duplicate records\n`);
    }

    // ========================================
    // STEP 4: Try Creating Index Again
    // ========================================
    if (!uniqueIndexExists) {
      console.log('📋 STEP 4: Creating Unique Index');
      console.log('----------------------------------------------------------------------');
      
      try {
        await MealOrder.collection.createIndex(
          { user: 1, deliveryDate: 1, mealType: 1 },
          { unique: true, name: 'unique_user_date_mealtype' }
        );
        console.log('✅ Unique compound index created successfully');
      } catch (err) {
        console.error('❌ Failed to create index:', err.message);
      }
    }

    // ========================================
    // STEP 5: Validation
    // ========================================
    console.log('\n📋 STEP 5: Final Validation');
    console.log('----------------------------------------------------------------------');
    
    const remainingDuplicates = await MealOrder.aggregate([
      {
        $group: {
          _id: {
            user: '$user',
            deliveryDate: '$deliveryDate',
            mealType: '$mealType'
          },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    if (remainingDuplicates.length === 0) {
      console.log('✅ Validation passed: No duplicates remain');
    } else {
      console.error(`❌ Validation failed: ${remainingDuplicates.length} duplicate groups still exist`);
    }

    // Check index
    const finalIndexes = await MealOrder.collection.getIndexes();
    const indexExists = finalIndexes.hasOwnProperty('unique_user_date_mealtype');
    
    if (indexExists) {
      console.log('✅ Unique compound index is active');
    } else {
      console.error('❌ Unique compound index NOT found');
    }

    // Get statistics
    const totalMealOrders = await MealOrder.countDocuments();
    const todayMealOrders = await MealOrder.countDocuments({
      deliveryDate: {
        $gte: moment().startOf('day').toDate(),
        $lte: moment().endOf('day').toDate()
      }
    });

    console.log('\n📊 Database Statistics:');
    console.log(`   - Total MealOrders: ${totalMealOrders}`);
    console.log(`   - Today's MealOrders: ${todayMealOrders}`);

    console.log('\n======================================================================');
    console.log('✅ MIGRATION COMPLETE');
    console.log('======================================================================\n');

    await mongoose.connection.close();
    console.log('📡 Disconnected from MongoDB\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run migration
fixDuplicateMealOrders();
