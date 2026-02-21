/**
 * ensureIndexes.js — Phase 15 Performance Hardening
 *
 * Creates compound and single-field indexes that the kitchen aggregator,
 * dashboard aggregator, and delivery queries rely on.
 *
 * Safe to call on every server start (createIndex is idempotent).
 * Can also be run once manually:  node backend/scripts/ensureIndexes.js
 */

const MealOrder   = require('../models/MealOrder');
const Delivery    = require('../models/Delivery');
const Payment     = require('../models/Payment');
const Subscription = require('../models/Subscription');
const User        = require('../models/User');

/**
 * Helper — log success or skip quietly.
 */
async function idx(model, spec, opts = {}) {
  try {
    await model.collection.createIndex(spec, { background: true, ...opts });
  } catch (err) {
    // Index already exists or name conflict — not fatal
    console.warn(`⚠️  Index on ${model.modelName}`, JSON.stringify(spec), '→', err.message);
  }
}

async function ensureIndexes() {
  console.log('📑 ensureIndexes: Creating performance indexes…');

  // ── MealOrder ───────────────────────────────────────────────────────────
  await idx(MealOrder, { deliveryDate: 1 });
  await idx(MealOrder, { userId: 1, deliveryDate: 1, mealType: 1 },
    { name: 'meal_user_date_type' });
  await idx(MealOrder, { status: 1, deliveryDate: 1 },
    { name: 'meal_status_date' });
  await idx(MealOrder, { subscriptionId: 1, deliveryDate: 1 },
    { name: 'meal_sub_date' });

  // ── Delivery ────────────────────────────────────────────────────────────
  // NOTE: Delivery schema already declares { user, deliveryDate } and
  //       { deliveryDate, status } via schema.index() — skip to avoid duplicates.
  await idx(Delivery, { subscriptionId: 1, deliveryDate: 1 },
    { name: 'delivery_sub_date' });

  // ── Subscription ────────────────────────────────────────────────────────
  await idx(Subscription, { userId: 1, status: 1 });
  await idx(Subscription, { status: 1, endDate: 1 },
    { name: 'sub_status_enddate' });
  await idx(Subscription, { endDate: 1 });

  // ── Payment ─────────────────────────────────────────────────────────────
  await idx(Payment, { paymentDate: 1, userId: 1 });
  await idx(Payment, { subscriptionId: 1, status: 1 },
    { name: 'pay_sub_status' });

  // ── User ────────────────────────────────────────────────────────────────
  // email uniqueness index typically created by mongoose schema — skip
  await idx(User, { isActive: 1, role: 1 },
    { name: 'user_active_role' });

  console.log('✅ ensureIndexes: All indexes confirmed.');
}

module.exports = { ensureIndexes };

// Allow standalone execution
if (require.main === module) {
  const connectDB = require('../config/database');
  connectDB()
    .then(() => ensureIndexes())
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ ensureIndexes failed:', err);
      process.exit(1);
    });
}
