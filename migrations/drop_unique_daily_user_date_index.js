/**
 * ======================================================================
 * DATABASE MIGRATION: Drop unique_daily_user_date index
 * ======================================================================
 * The index { user, deliveryDate, orderSource } (unique, partial daily)
 * prevents a daily user from having BOTH a lunch AND a dinner MealOrder
 * on the same date, because both share orderSource='daily'.
 *
 * The correct uniqueness is already enforced by the primary index
 *   { user, deliveryDate, mealType }  (name: unique_user_date_mealtype)
 * which allows one lunch AND one dinner per user per day.
 *
 * Run BEFORE or alongside the server deploy that removes the index
 * from MealOrder.js.
 *
 * Usage:
 *   node backend/migrations/drop_unique_daily_user_date_index.js
 * ======================================================================
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tiffinmate';
const INDEX_NAME = 'unique_daily_user_date';

async function run() {
  console.log('\n======================================================================');
  console.log('🔧 MIGRATION: Drop unique_daily_user_date index from MealOrder');
  console.log('======================================================================\n');

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const collection = mongoose.connection.collection('mealorders');
  const indexes = await collection.indexes();
  const exists = indexes.some(idx => idx.name === INDEX_NAME);

  if (!exists) {
    console.log(`ℹ️  Index "${INDEX_NAME}" does not exist – nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`🗑️  Dropping index "${INDEX_NAME}"…`);
  await collection.dropIndex(INDEX_NAME);
  console.log(`✅ Index "${INDEX_NAME}" dropped successfully.`);

  // Verify
  const afterIndexes = await collection.indexes();
  const stillExists = afterIndexes.some(idx => idx.name === INDEX_NAME);
  if (stillExists) {
    console.error('❌ Index still present after drop – check MongoDB permissions.');
    process.exit(1);
  }

  console.log('\n✅ Migration complete. Daily users can now have both lunch and dinner.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
