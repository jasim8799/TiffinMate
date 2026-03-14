/**
 * testDefaultMealCron.js
 *
 * Temporary test script to manually trigger the default meal
 * assignment logic without waiting for the scheduled cron (8:35 PM IST).
 *
 * Usage:
 *   npm run test:default-meals
 *
 * DO NOT modify cronService, schemas, or any production logic here.
 */

'use strict';

// Load environment variables from .env before anything else
require('dotenv').config();

// Must connect to DB before importing service models
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const cronService = require('../services/cronService');
const { getTodayIST, normaliseDeliveryDate } = require('../utils/dateService');

(async () => {
  try {
    // Connect to MongoDB (same connection used by the server)
    await connectDB();

    console.log('\n========================================');
    console.log('  Testing default meal cron assignment');
    console.log('========================================\n');

    // Compute tomorrow's delivery date — identical to what the cron does
    const effectiveDate = getTodayIST().add(1, 'day');
    const targetDeliveryDate = normaliseDeliveryDate(effectiveDate);

    console.log('Target Delivery Date:', effectiveDate.format('YYYY-MM-DD'));
    console.log('(UTC stored value)  :', targetDeliveryDate.toISOString());
    console.log('----------------------------------------\n');

    // Lunch
    const lunch = await cronService.assignDefaultMealsForType(targetDeliveryDate, 'lunch');
    console.log('\n----------------------------------------');
    console.log('Lunch assigned :', lunch);

    // Dinner
    const dinner = await cronService.assignDefaultMealsForType(targetDeliveryDate, 'dinner');
    console.log('Dinner assigned:', dinner);

    console.log('\n========================================');
    console.log(`  TOTAL MEAL ORDERS CREATED: ${lunch + dinner}`);
    console.log('========================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cron test failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
})();
