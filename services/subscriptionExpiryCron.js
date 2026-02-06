const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Delivery = require('../models/Delivery');
const Pause = require('../models/Pause');
const CronLock = require('../models/CronLock');
const ExpiryAudit = require('../models/ExpiryAudit');
const SubscriptionLock = require('../models/SubscriptionLock');
const socketService = require('./socketService');
const moment = require('moment');

async function runSubscriptionExpiryCheck() {
  const isDryRun = process.env.CRON_DRY_RUN === 'true';

  try {
    // Acquire lock
    let lock;
    try {
      lock = await CronLock.create({ type: 'expiry' });
    } catch (err) {
      if (err.code === 11000) {
        console.log('⏭️ Expiry cron already running, skipping...');
        return;
      }
      throw err;
    }

    console.log(`\n⏰ Running subscription expiry cron${isDryRun ? ' (DRY RUN)' : ''}...`);

    const now = moment().startOf('day');
    const graceDays = 1;

    // Find active subscriptions that have expired and not already expired
    const expiredSubs = await Subscription.find({
      status: 'active',
      endDate: { $lt: now.toDate() },
      expiredAt: { $exists: false }
    });

    for (const sub of expiredSubs) {
      try {
        // Attempt to acquire subscription lock
        const lockResult = await SubscriptionLock.acquireLock(sub._id, 'expiry_cron', 'expiry-cron');
        if (!lockResult.success) {
          console.log(`⏭️ Skipping ${sub._id}: subscription is locked (${lockResult.reason})`);
          continue;
        }

        try {
          // Re-check current status before processing (never assume previous state)
          const currentSub = await Subscription.findById(sub._id);
          if (!currentSub) {
            console.log(`⏭️ Skipping ${sub._id}: subscription not found`);
            continue;
          }

          // If already expired, skip
          if (currentSub.status === 'expired') {
            console.log(`⏭️ Skipping ${sub._id}: already expired`);
            continue;
          }

          // If no longer active, skip
          if (currentSub.status !== 'active') {
            console.log(`⏭️ Skipping ${sub._id}: status is ${currentSub.status}, not active`);
            continue;
          }

          // Calculate total paused days
          const pauses = await Pause.find({ subscription: currentSub._id, status: 'approved' });
          const totalPausedDays = pauses.reduce((sum, p) => sum + p.totalPausedDays, 0);

          // Calculate effective end date
          const effectiveEndDate = moment(currentSub.endDate).add(totalPausedDays, 'days').startOf('day');

          if (effectiveEndDate.isBefore(now)) {
            const graceUntil = effectiveEndDate.clone().add(graceDays, 'days');

            if (graceUntil.isSameOrAfter(now)) {
              currentSub.status = 'grace';
              currentSub.graceUntil = graceUntil.toDate();
              console.log(`${isDryRun ? '[DRY RUN] ' : ''}➡️ ACTIVE → GRACE: ${sub._id} (effectiveEndDate: ${effectiveEndDate.format()}, graceUntil: ${graceUntil.format()})`);
            } else {
              currentSub.status = 'expired';
              currentSub.expiredAt = now.toDate();
              console.log(`${isDryRun ? '[DRY RUN] ' : ''}➡️ ACTIVE → EXPIRED: ${sub._id} (effectiveEndDate: ${effectiveEndDate.format()})`);

              if (isDryRun) {
                console.log(`   📦 [DRY RUN] Would cancel future deliveries for user ${sub.user}`);
                console.log(`   📝 [DRY RUN] Would create expiry audit log`);
                console.log(`   📡 [DRY RUN] Would emit socket events`);
              } else {
                // Use transaction for expiry operations
                const session = await mongoose.startSession();
                session.startTransaction();

                try {
                  // Update subscription
                  await currentSub.save({ session });

                  // Cancel future deliveries
                  await Delivery.updateMany(
                    { user: currentSub.user, deliveryDate: { $gte: now.toDate() }, status: { $ne: 'delivered' } },
                    { status: 'cancelled_due_to_expiry' },
                    { session }
                  );
                  console.log(`   📦 Cancelled future deliveries for user ${currentSub.user}`);

                  // Create audit log
                  await ExpiryAudit.create([{
                    subscriptionId: currentSub._id,
                    userId: currentSub.user,
                    oldStatus: 'active',
                    newStatus: 'expired',
                    expiredAt: currentSub.expiredAt,
                    cronRunId: lock._id
                  }], { session });

                  // Commit transaction
                  await session.commitTransaction();

                  // Emit socket events after successful commit
                  socketService.emitToUser(currentSub.user.toString(), 'subscription_expired', {
                    subscriptionId: currentSub._id
                  });
                  socketService.emitToOwners('subscription_expired', {
                    subscriptionId: currentSub._id,
                    userId: currentSub.user
                  });

                } catch (transactionErr) {
                  await session.abortTransaction();
                  throw transactionErr;
                } finally {
                  session.endSession();
                }
              }
            }
          } else {
            // Effective end date is still in the future, skip
            console.log(`⏭️ Skipping ${sub._id}: effectiveEndDate ${effectiveEndDate.format()} is in the future`);
            continue;
          }

          // Save subscription for grace status (not in transaction since only one operation)
          if (currentSub.status === 'grace') {
            if (isDryRun) {
              console.log(`   💾 [DRY RUN] Would update subscription to grace status`);
            } else {
              await currentSub.save();
            }
          }
          // For expired, save is already done in transaction above
        } finally {
          // Always release the subscription lock
          await SubscriptionLock.releaseLock(sub._id);
        }
      } catch (err) {
        console.error(`❌ Error processing subscription ${sub._id}:`, err);
        // Continue to next subscription
      }
    }

    console.log(`✅ Expiry cron completed: ${expiredSubs.length} subscriptions processed\n`);

    // Emit dashboard refresh for owners
    if (!isDryRun) {
      socketService.emitDashboardRefreshRequired('subscription_expiry_completed');
    }

    // Release lock
    await CronLock.deleteOne({ type: 'expiry' });

  } catch (err) {
    console.error('❌ Expiry cron error:', err);
    // Attempt to release lock on error
    try {
      await CronLock.deleteOne({ type: 'expiry' });
    } catch (lockErr) {
      console.error('❌ Failed to release cron lock:', lockErr);
    }
  }
}

module.exports = runSubscriptionExpiryCheck;
