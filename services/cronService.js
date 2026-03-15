const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Payment = require('../models/Payment');
const MealOrder = require('../models/MealOrder');
const DefaultMeal = require('../models/DefaultMeal');
const Delivery = require('../models/Delivery');
const SystemSetting = require('../models/SystemSetting');
const RestaurantStatus = require('../models/RestaurantStatus');
const smsService = require('./smsService');
const socketService = require('./socketService');
const logger = require('../utils/logger');
const moment = require('moment-timezone');
const { getActiveUserIds } = require('../utils/activeUserHelper');
const { getTodayIST, normaliseDeliveryDate, getCutoffForDeliveryDate, CUTOFF_HOUR, CUTOFF_MINUTE, getISTDayBounds } = require('../utils/dateService');

// Helper function to get current IST time
const nowIST = () => {
  return moment.tz('Asia/Kolkata');
};

// Helper function to convert date to IST
const toIST = (date) => {
  return moment.tz(date, 'Asia/Kolkata');
};

class CronService {
  constructor() {
    this.jobs = [];
  }

  // ========================================
  // CRON RUN GUARD: Prevent double runs on server restart
  // ========================================
  async shouldRunCronJob(jobName) {
    try {
      const key = `lastCronRun_${jobName}`;

      const lastRun = await SystemSetting.getValue(key);

      if (lastRun) {
        const lastRunTime = moment(lastRun);
        const timeSinceLastRun = nowIST().diff(lastRunTime, 'minutes');

        if (timeSinceLastRun < 10) {
          logger.warn(`⏭️ Skipping cron job "${jobName}" — last run ${timeSinceLastRun} minutes ago`);
          return false;
        }
      }

      await SystemSetting.setValue(
        key,
        nowIST().toDate(),
        `Last run for ${jobName}`,
        'cron-service'
      );

      logger.info(`✅ Cron guard passed for ${jobName}`);

      return true;
    } catch (error) {
      logger.error(`❌ Cron guard error for ${jobName}`, error);

      return true;
    }
  }

  // Check for subscriptions expiring in 2 days
  checkExpiringSubscriptions() {
    const job = cron.schedule('0 9 * * *', async () => {
      const jobName = 'Check Expiring Subscriptions';

      // Check cron run guard
      if (!(await this.shouldRunCronJob(jobName))) return;

      logger.info(`Running: ${jobName}`);

      try {
        const twoDaysFromNow = nowIST().add(2, 'days').endOf('day').toDate();
        const today = nowIST().startOf('day').toDate();

        const expiringSubscriptions = await Subscription.find({
          status: 'active',
          endDate: { $gte: today, $lte: twoDaysFromNow },
          reminderSent: false
        }).populate('user');

        let sentCount = 0;
        for (const subscription of expiringSubscriptions) {
          try {
            const user = subscription.user;
            const daysRemaining = Math.ceil((subscription.endDate - nowIST().toDate()) / (1000 * 60 * 60 * 24));

            await smsService.sendSubscriptionReminder(
              user.mobile,
              user.name,
              daysRemaining,
              user._id
            );

            subscription.reminderSent = true;
            await subscription.save();
            sentCount++;
          } catch (err) {
            logger.error(`Failed to send reminder for subscription ${subscription._id}`, err);
          }
        }

        await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');
        logger.success(`${jobName} completed: ${sentCount}/${expiringSubscriptions.length} reminders sent`);
      } catch (error) {
        logger.error(`${jobName} failed`, error);
      }
    });

    this.jobs.push({ name: 'checkExpiringSubscriptions', job });
    return job;
  }

  // Check for expired subscriptions and manage grace period
  checkExpiredSubscriptions() {
    const job = cron.schedule('0 10 * * *', async () => {
      const jobName = 'Check Expired Subscriptions & Grace Period';

      // Check cron run guard
      if (!(await this.shouldRunCronJob(jobName))) return;

      logger.info(`Running: ${jobName}`);
      logger.info('⏰ EXPIRY CHECK TIME = 10:00 AM daily');
      logger.info('📅 SINGLE SOURCE OF EXPIRY TRUTH - Date-driven only');

      try {
        const today = nowIST().startOf('day').toDate();
        const gracePeriodDays = 1; // Configurable grace period

        // ========================================

        // ========================================
        // PHASE 2: Move EXPIRED → GRACE (next day after expiry)
        // ========================================
        const subscriptionsToGrace = await Subscription.find({
          status: 'expired',
          expiredAt: { $lt: today }, // Move to grace the day AFTER expiry
          graceNotified: false
        }).populate('user');

        logger.info(`🔍 PHASE 2: Found ${subscriptionsToGrace.length} subscriptions to move to GRACE`);

        for (const subscription of subscriptionsToGrace) {
          try {
            const user = subscription.user;

            logger.info(`\n⚠️  [EXPIRED → GRACE]`);
            logger.info(`   User: ${user.name} (${user._id})`);
            logger.info(`   Subscription ID: ${subscription._id}`);

            // Send grace period warning
            await smsService.sendGracePeriodWarning(user.mobile, user.name, gracePeriodDays, user._id);

            // Update subscription
            const previousStatus = subscription.status;
            subscription.status = 'grace';
            subscription.graceNotified = true;
            await subscription.save();

            // Log to SubscriptionHistory
            await this.logSubscriptionHistory(subscription._id, user._id, 'grace_started', previousStatus, 'grace', 'grace-period-started', { cronName: jobName, graceUntil: subscription.graceUntil });

            logger.info(`   ✅ Moved to GRACE period`);
          } catch (err) {
            logger.error(`Failed to move subscription ${subscription._id} to grace`, err);
          }
        }

        // ========================================
        // PHASE 3: Move GRACE → DISABLED (grace period ended)
        // ========================================
        const subscriptionsToDisable = await Subscription.find({
          status: 'grace',
          graceUntil: { $lt: today },
          disabledNotified: false
        }).populate('user');

        logger.info(`🔍 PHASE 3: Found ${subscriptionsToDisable.length} subscriptions to DISABLE`);

        for (const subscription of subscriptionsToDisable) {
          try {
            const user = subscription.user;

            logger.info(`\n🚫 [GRACE → DISABLED]`);
            logger.info(`   User: ${user.name} (${user._id})`);
            logger.info(`   Subscription ID: ${subscription._id}`);

            // Send final disable notification
            await smsService.sendServiceDisabled(user.mobile, user.name, user._id);

            // Update subscription (NEVER set user.isActive = false)
            const previousStatus = subscription.status;
            subscription.status = 'disabled';
            subscription.disabledNotified = true;
            await subscription.save();

            // Log to SubscriptionHistory
            await this.logSubscriptionHistory(subscription._id, user._id, 'disabled', previousStatus, 'disabled', 'grace-period-ended', { cronName: jobName, graceUntil: subscription.graceUntil });

            logger.info(`   ✅ Moved to DISABLED (user remains active for login/renewal)`);
          } catch (err) {
            logger.error(`Failed to disable subscription ${subscription._id}`, err);
          }
        }

        await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');
        logger.success(`${jobName} completed successfully`);
      } catch (error) {
        logger.error(`${jobName} failed`, error);
      }
    });

    this.jobs.push({ name: 'checkExpiredSubscriptions', job });
    return job;
  }



  // Check for overdue payments
  checkOverduePayments() {
    const job = cron.schedule('0 12 * * *', async () => {
      const jobName = 'Check Overdue Payments';

      // Check cron run guard
      if (!(await this.shouldRunCronJob(jobName))) return;

      logger.info(`Running: ${jobName}`);

      try {
        const today = nowIST().toDate();

        const overduePayments = await Payment.find({
          paymentStatus: { $in: ['pending', 'partial'] },
          dueDate: { $lt: today }
        }).populate('user');

        let reminderCount = 0;
        for (const payment of overduePayments) {
          try {
            const user = payment.user;

            // Send reminder if not sent today
            const lastReminder = payment.lastReminderDate;
            if (!lastReminder || toIST(lastReminder).isBefore(nowIST(), 'day')) {
              await smsService.sendPaymentOverdue(
                user.mobile,
                user.name,
                payment.pendingAmount,
                user._id
              );

              payment.paymentStatus = 'overdue';
              payment.reminderSent = true;
              payment.reminderCount += 1;
              payment.lastReminderDate = nowIST().toDate();
              await payment.save();
              reminderCount++;
            }
          } catch (err) {
            logger.error(`Failed to send overdue reminder for payment ${payment._id}`, err);
          }
        }

        await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');
        logger.success(`${jobName} completed: ${reminderCount} overdue payment reminders sent`);
      } catch (error) {
        logger.error(`${jobName} failed`, error);
      }
    });

    this.jobs.push({ name: 'checkOverduePayments', job });
    return job;
  }

  // ========================================
  // UNIFIED CUTOFF: Auto-assign default meals
  // ========================================
  // ✅ Cutoff at 8:30 PM IST (TEMPORARY for testing)
  // ✅ After cutoff → meals assigned for TOMORROW
  // Run at 8:35 PM IST (5 minutes after cutoff)
  autoAssignDefaultMeals() {
    // TEST MODE: Run every minute so auto-assign can be verified immediately
    const defaultMealsJob = cron.schedule('* * * * *', async () => {
      const jobName = 'Auto-assign Default Meals (Lunch & Dinner)';

      // TEST MODE — disable cron guard so job runs every minute
      // if (!(await this.shouldRunCronJob(jobName))) return;

      const now = nowIST();
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Running: ${jobName}`);
      logger.info(`Time: ${now.format('YYYY-MM-DD HH:mm:ss z')}`);
      logger.info(`${'='.repeat(60)}`);
      logger.info(`⎰ UNIFIED_CUTOFF_TIME = ${CUTOFF_HOUR}:${CUTOFF_MINUTE} IST`);
      logger.info('� TEST MODE: cron runs every minute for auto-assign verification');
      logger.info('📋 Assigns defaults for EFFECTIVE DELIVERY DATE (tomorrow)');

      try {
        // ✅ CRITICAL: Cron runs at 8:35 PM IST (5-minute buffer after cutoff).
        // Target = TOMORROW (today + 1 day in IST).
        // MUST use getTodayIST().add(1,'day') — NOT getNextOrderableDate()
        // because getNextOrderableDate() returns day+2 when called after cutoff.
        // normaliseDeliveryDate() guarantees IST start-of-day → UTC for DB keys.
        const effectiveDate    = getTodayIST().add(1, 'day');          // moment (IST) — for logging
        const targetDeliveryDate = normaliseDeliveryDate(effectiveDate); // Date (UTC)    — for DB ops
        logger.info(`\n📅 Target Date: ${effectiveDate.format('YYYY-MM-DD (dddd)')}`);
        logger.info(`   Explanation: 8:35 PM cron — assigning defaults for TOMORROW`);

        // ✅ BUG 1 FIX: Guard — skip if restaurant is globally closed or closed for this date
        const restaurantStatus = await RestaurantStatus.findOne();
        if (restaurantStatus) {
          if (restaurantStatus.isOpen === false) {
            logger.info('⏭️ Restaurant is globally closed — skipping default meal assignment');
            return;
          }
          if (restaurantStatus.closedDate) {
            const closedDay = moment.tz(restaurantStatus.closedDate, 'Asia/Kolkata').startOf('day');
            if (closedDay.isSame(effectiveDate, 'day')) {
              logger.info('⏭️ Restaurant is closed for delivery date — skipping default meal assignment');
              return;
            }
          }
        }

        // Assign lunch defaults
        logger.info('\n🍱 Assigning LUNCH defaults...');
        const lunchCount = await this.assignDefaultMealsForType(targetDeliveryDate, 'lunch');
        logger.info(`✅ Lunch: ${lunchCount} defaults assigned`);

        // Assign dinner defaults
        logger.info('\n🍽️  Assigning DINNER defaults...');
        const dinnerCount = await this.assignDefaultMealsForType(targetDeliveryDate, 'dinner');
        logger.info(`✅ Dinner: ${dinnerCount} defaults assigned`);

        await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');

        // ========================================
        // PRODUCTION FIX: Emit ONLY ONE dashboard refresh event
        // After cron completes, notify owner to refresh ONCE
        // ========================================
        socketService.emitToOwners('dashboard_refresh_required', {
          reason: 'cron-default-assignment',
          targetDate: effectiveDate.format('YYYY-MM-DD'),
          lunchCount,
          dinnerCount,
          totalCount: lunchCount + dinnerCount
        });

        logger.info(`\n${'='.repeat(60)}`);
        logger.success(`${jobName} completed successfully`);
        logger.info(`Total: ${lunchCount + dinnerCount} default meals assigned`);
        logger.info(`📤 Emitted single dashboard_refresh_required event`);
        logger.info(`${'='.repeat(60)}\n`);
      } catch (error) {
        logger.error(`${jobName} failed`, error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });

    this.jobs.push({ name: 'autoAssignDefaultMeals', job: defaultMealsJob });
    return { defaultMealsJob };
  }

  // Helper method to assign default meals
  async assignDefaultMealsForType(deliveryDate, mealType) {
    try {
      // ========================================
      // STEP 1: GET ACTIVE USERS ONLY
      // ========================================
      // Filter: role=customer, isActive=true, deletedAt not exists
      const activeUserIds = await getActiveUserIds();

      logger.info(`🔍 ACTIVE USERS: ${activeUserIds.length} total`);
      logger.info(`   Filter: role=customer, isActive=true, no deletedAt`);

      // ========================================
      // STEP 2: GET ACTIVE SUBSCRIPTIONS
      // ========================================
      // Only users with active subscriptions covering deliveryDate.
      // DO NOT include grace — meals blocked during grace.
      //
      // Use IST day bounds for range comparison so that UTC-stored
      // startDate/endDate values are compared against the correct IST
      // day window, regardless of the UTC offset.
      //
      // Correct check: subscription overlaps the delivery day
      //   startDate < endOfDeliveryDay  (subscription started before day ends)
      //   endDate   >= startOfDeliveryDay (subscription hasn't ended yet)
      const { startUTC, nextDayStartUTC } = getISTDayBounds(deliveryDate);

      const subscriptions = await Subscription.find({
        user: { $in: activeUserIds },
        status: 'active', // NEVER grace — meals blocked during grace
        startDate: { $lt: nextDayStartUTC },
        endDate: { $gte: startUTC }
      }).populate('user');

      logger.info(`📋 ACTIVE SUBSCRIPTIONS: ${subscriptions.length} for ${moment(deliveryDate).format('YYYY-MM-DD')}`);
      logger.info(`   Coverage: startDate <= deliveryDate <= endDate`);

      let assignedCount = 0;
      let skippedCount = 0;

      // ========================================
      // STEP 3: ASSIGN DEFAULT MEALS (IDEMPOTENT)
      // ========================================
      logger.info(`\n🔄 Processing ${subscriptions.length} subscriptions...`);

      for (const subscription of subscriptions) {
        try {
          // Safety guard: skip if subscription is not active (paused subscriptions
          // have status 'paused' and are already excluded by the query above, but
          // guard here for belt-and-suspenders safety).
          if (subscription.status !== 'active') {
            skippedCount++;
            logger.debug(`   ⏭️  Skipped (not active): ${subscription.user.name}`);
            continue;
          }

          // ========================================
          // DETECTION: Range query to find any existing MealOrder for tomorrow.
          // Using $gte/$lt range (not exact timestamp) so that orders saved with
          // any timestamp within the IST delivery day are correctly detected.
          // This is the core fix — exact-match on deliveryDate missed orders
          // whose stored UTC timestamp differed by even 1ms from the cron value.
          // ========================================
          const existingOrder = await MealOrder.findOne({
            user: subscription.user._id,
            mealType: mealType,
            deliveryDate: {
              $gte: startUTC,
              $lt: nextDayStartUTC
            }
          });

          if (existingOrder) {
            // Respect skip: user deliberately skipped this meal → do not override.
            if (existingOrder.selectedMeal && existingOrder.selectedMeal.isSkip === true) {
              skippedCount++;
              logger.debug(`   ⏭️  Skipped (user skipped meal): ${subscription.user.name}`);
            } else {
              skippedCount++;
              logger.debug(`   ⏭️  Skipped (already selected): ${subscription.user.name}`);
            }
            continue;
          }

          // ========================================
          // No existing order found → create default meal.
          // ========================================
          // Get day of week in IST (not server local time) to pick the correct menu.
          const dayOfWeek = moment.tz(startUTC, 'Asia/Kolkata').day();
          const planType = subscription.planType || 'classic';
          const defaultMealName = this.getDefaultMealForDay(dayOfWeek, planType, mealType);

          // Cutoff is 8:30 PM IST on the day BEFORE delivery — dateService is authoritative.
          const cutoffTime = getCutoffForDeliveryDate(deliveryDate);

          await MealOrder.create({
            user: subscription.user._id,
            subscription: subscription._id,
            deliveryDate: startUTC,
            mealType: mealType,
            orderDate: nowIST().toDate(),
            orderSource: 'subscription',
            selectedMeal: {
              name: defaultMealName,
              items: [],
              isDefault: true,
              isSkip: false
            },
            cutoffTime: cutoffTime.toDate(),
            isAfterCutoff: true,
            status: 'confirmed'
          });

          assignedCount++;
          logger.info(`   ✅ Created: ${subscription.user.name} - ${defaultMealName}`);
          // NOTE: Per-user socket emit intentionally omitted here.
          // A single dashboard_refresh_required event is emitted after cron completes.
        } catch (err) {
          // 11000 = duplicate key — another process beat us to the insert.
          // Treat as success (idempotent), not an error.
          if (err.code === 11000) {
            skippedCount++;
            logger.debug(`   ⚠️  Duplicate prevented: user ${subscription.user._id}`);
          } else {
            logger.error(`   ❌ Failed: user ${subscription.user._id} - ${err.message}`);
          }
        }
      }

      // ========================================
      // SUMMARY
      // ========================================
      logger.info(`\n📊 SUMMARY for ${mealType.toUpperCase()}:`);
      logger.info(`   Created: ${assignedCount}`);
      logger.info(`   Skipped: ${skippedCount} (already selected or skipped by user)`);
      logger.info(`   Total: ${assignedCount + skippedCount}`);
      logger.success(`✅ ${mealType} assignment completed`);

      return assignedCount;
    } catch (error) {
      logger.error(`Error in assignDefaultMealsForType (${mealType}):`, error);
      throw error;
    }
  }

  // Get default meal (first option) for a specific day and plan type
  // ✅ VERIFICATION: This function dynamically selects meal based on dayOfWeek (0-6)
  // Array indices: [0]=Sunday, [1]=Monday, [2]=Tuesday, [3]=Wednesday, [4]=Thursday, [5]=Friday, [6]=Saturday
  getDefaultMealForDay(dayOfWeek, planType, mealType) {
    const mealsByDay = {
      'premium-veg': {
        lunch: [
          'MIX-VEG, DAL, JEERA RICE, ROTI & SALAD', // Sunday
          'AALOO SOYABEEN, DAL, FRIED RICE, ROTI & KHEER', // Monday
          'RAJMA, AALOO BHUJIYA, JEERA RICE, ROTI & RAITA', // Tuesday
          'MUTAR MUSHROOM, DAL, SOYA RICE, ROTI & SALAD', // Wednesday
          'VEGITABLE, DAL, RICE, ROTI & SALAD', // Thursday
          'PANEER MASALA, PLAIN PARATHA & HALWA', // Friday
          'KHICHDI, AALOO CHOKHA / PICKLE' // Saturday
        ],
        dinner: [
          'VEG BIRYANI, SALAD & RAITA', // Sunday
          'SEASONAL VEG, DAL, RICE, ROTI & SALAD', // Monday
          'KADAI PANEER, LACHHA PARATHA & SALAD', // Tuesday
          'DAL FRY, ROTI & KHEER', // Wednesday
          'MIX-VEG, DAL, FRIED RICE, ROTI & SALAD', // Thursday
          'BESAN GATTA, JEERA RICE, ROTI & SALAD', // Friday
          'CHHOLE MASALA, PURI & SWEETS' // Saturday
        ]
      },
      'premium-non-veg': {
        lunch: [
          'CHICKEN CURRY (BIHARI STYLE), JEERA RICE, ROTI & SALAD', // Sunday
          'EGG CURRY, FRIED RICE, ROTI & KHEER', // Monday
          'N/A', // Tuesday
          'CHICKEN MASALA, DAL, SOYA RICE, ROTI & SALAD', // Wednesday
          'EGG AALOO DUM, RICE, ROTI & SALAD', // Thursday
          'HYDRABADI BIRYANI, RAITA & HALWA', // Friday
          'KEEMA, DAL, RICE, ROTI & SALAD' // Saturday
        ],
        dinner: [
          'CHICKEN BIRYANI, RAITA & SALAD', // Sunday
          'TANDOORI CHICKEN, PARATHA (PLAIN) & HALWA', // Monday
          'N/A', // Tuesday
          'MURADABADI BIRYANI, CHUTNEY & KHEER', // Wednesday
          'CHICKEN KORMA, LACHHA PARATHA & SALAD', // Thursday
          'EGG BHURJI, DAL, JEERA RICE, ROTI & SALAD', // Friday
          'BUTTER CHICKEN, SATTU PARATHA, SWEETS' // Saturday
        ]
      },
      'classic': {
        lunch: [
          'MIX-VEG, DAL, RICE & SALAD', // Sunday
          'AALOO SOYABEEN, RICE & SALAD', // Monday
          'RAJMA, RICE & RAITA', // Tuesday
          'CHICKEN CURRY, RICE & SALAD', // Wednesday
          'VEGITABLE, RICE & SALAD', // Thursday
          'CHHOLE MASALA, RICE & SALAD', // Friday
          'KHICHDI, AALOO CHOKHA / PICKLE' // Saturday
        ],
        dinner: [
          'CHICKEN BIRYANI, SALAD & RAITA', // Sunday
          'SEASONAL VEG, ROTI & SALAD', // Monday
          'KADAI PANEER, ROTI & HALWA', // Tuesday
          'DAL FRY, ROTI & SALAD', // Wednesday
          'MIX-VEG, ROTI & SALAD', // Thursday
          'EGG CURRY, ROTI & SALAD', // Friday
          'CHHOLE MASALA, PURI & SWEETS' // Saturday
        ]
      }
    };

    // Default to classic if plan type not found
    const plan = mealsByDay[planType] || mealsByDay['classic'];
    const meals = plan[mealType] || plan['lunch'];

    return meals[dayOfWeek] || 'Dal Rice';
  }

  // Auto-mark deliveries as delivered after 1 hour
  autoMarkDelivered() {
    const jobName = 'Auto Mark Delivered';

    // Run every 10 minutes to check for overdue deliveries
    const job = cron.schedule('*/10 * * * *', async () => {
      // Check cron run guard
      if (!(await this.shouldRunCronJob(jobName))) return;

      console.log('[AUTO DELIVERY CHECK]');
      console.log('Current Time:', nowIST().format('YYYY-MM-DD HH:mm:ss z'));
      logger.info(`Running: ${jobName}`);

      try {
        const oneHourAgo = nowIST().subtract(1, 'hour').toDate();

        // ✅ USE MEALORDER AS SOURCE OF TRUTH
        // Find meal orders that are "out_for_delivery" for more than 1 hour
        const overdueMealOrders = await MealOrder.find({
          status: 'out_for_delivery',
          updatedAt: { $lte: oneHourAgo }
        }).populate('user');

        console.log(`Found ${overdueMealOrders.length} orders to mark as delivered`);

        let markedCount = 0;
        for (const order of overdueMealOrders) {
          try {
            // Log order details before update
            const minutesSinceUpdate = (Date.now() - order.updatedAt.getTime()) / 60000;
            console.log('Order ID:', order._id.toString());
            console.log('User:', order.user.name, '(', order.user._id.toString(), ')');
            console.log('Status:', order.status);
            console.log('UpdatedAt:', order.updatedAt);
            console.log('Minutes since update:', minutesSinceUpdate.toFixed(2));

            // Auto-mark as delivered
            order.status = 'delivered';
            await order.save();
            console.log('✅ Marked DELIVERED:', order._id.toString());

            // ✅ EMIT SOCKET EVENT for real-time update
            console.log('📤 Emitting delivery_status_updated to user:', order.user._id.toString());
            socketService.emitToUser(order.user._id.toString(), 'delivery_status_updated', {
              orderId: order._id,
              userId: order.user._id,
              status: 'delivered',
              mealType: order.mealType,
              deliveryDate: order.deliveryDate,
              message: '🍽️ Your food has been delivered!'
            });

            // Send SMS notification
            await smsService.sendDeliveryDelivered(
              order.user.mobile,
              order.user.name,
              order.user._id
            );

            markedCount++;
            logger.info(`Auto-marked meal order ${order._id} as delivered for user ${order.user.name}`);
          } catch (err) {
            logger.error(`Failed to auto-mark meal order ${order._id}`, err);
          }
        }

        if (markedCount > 0) {
          await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');
          logger.success(`Auto-marked ${markedCount} meal orders as delivered`);
        }
      } catch (error) {
        logger.error('Error in autoMarkDelivered', error);
      }
    });

    this.jobs.push({ name: jobName, job });
    logger.info(`Scheduled: ${jobName} - Every 10 minutes`);
  }

  // Create deliveries from meal orders (runs at 5 AM daily)
  autoCreateDeliveries() {
    const jobName = 'Auto Create Deliveries';

    // Run at 5:00 AM every day to create deliveries for today
    const job = cron.schedule('0 5 * * *', async () => {
      // Check cron run guard
      if (!(await this.shouldRunCronJob(jobName))) return;

      logger.info(`Running: ${jobName}`);
      logger.info('🍳 DELIVERY_CREATE_TIME = 5:00 AM daily');
      logger.info('📦 Creates delivery records for all confirmed meal orders');

      try {
        const today = nowIST().startOf('day').toDate();
        const tomorrow = nowIST().add(1, 'day').startOf('day').toDate();

        // Get all confirmed meal orders for today that don't have deliveries yet
        const mealOrders = await MealOrder.find({
          deliveryDate: { $gte: today, $lt: tomorrow },
          status: 'confirmed'
        }).populate('user');

        let createdCount = 0;

        for (const mealOrder of mealOrders) {
          try {
            // Check if delivery already exists
            const existingDelivery = await Delivery.findOne({
              user: mealOrder.user._id,
              deliveryDate: mealOrder.deliveryDate,
              mealType: mealOrder.mealType
            });

            if (existingDelivery) {
              continue; // Skip if delivery already exists
            }

            // Get user's active subscription (only for subscription orders)
            let subscription = null;
            if (mealOrder.orderSource === 'subscription') {
              subscription = await Subscription.findOne({
                user: mealOrder.user._id,
                status: 'active',
                startDate: { $lte: mealOrder.deliveryDate },
                endDate: { $gte: mealOrder.deliveryDate }
              });

              if (!subscription) {
                logger.warn(`No active subscription for user ${mealOrder.user.name}`);
                continue;
              }
            }

            // Create delivery
            const meals = {};
            if (mealOrder.mealType === 'lunch' || mealOrder.mealType === 'both') {
              meals.lunch = {
                name: mealOrder.selectedMeal.name,
                items: mealOrder.selectedMeal.items || []
              };
            }
            if (mealOrder.mealType === 'dinner' || mealOrder.mealType === 'both') {
              meals.dinner = {
                name: mealOrder.selectedMeal.name,
                items: mealOrder.selectedMeal.items || []
              };
            }

            await Delivery.create({
              user: mealOrder.user._id,
              subscription: subscription ? subscription._id : null,
              deliveryDate: mealOrder.deliveryDate,
              mealType: mealOrder.mealType,
              meals: meals,
              status: 'preparing',
              notes: mealOrder.notes,
              source: mealOrder.orderSource
            });

            createdCount++;
            logger.info(`Created delivery for ${mealOrder.user.name} - ${mealOrder.mealType}`);
          } catch (err) {
            logger.error(`Failed to create delivery for order ${mealOrder._id}`, err);
          }
        }

        await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');
        logger.success(`${jobName} completed: ${createdCount} deliveries created`);
      } catch (error) {
        logger.error(`${jobName} failed`, error);
      }
    });

    this.jobs.push({ name: jobName, job });
    logger.info(`Scheduled: ${jobName} - Daily at 5:00 AM`);
  }

  // ========== DAILY MIDNIGHT TASKS ==========
  // REMOVED: Expiry logic moved to checkExpiredSubscriptions() to prevent race conditions
  // Run at midnight every day to:
  // 1. Update remaining days for active subscriptions
  // 2. Handle trial expiry (FIXED: use usedDays instead of daysUsed)
  dailyMidnightTasks() {
    const job = cron.schedule('0 0 * * *', async () => {
      const jobName = 'Daily Midnight Tasks';

      // Check cron run guard
      if (!(await this.shouldRunCronJob(jobName))) return;

      logger.info(`Running: ${jobName}`);
      logger.info('📅 SINGLE EXPIRY SOURCE: checkExpiredSubscriptions() at 12:00 PM');

      try {
        const today = nowIST().startOf('day').toDate();
        let tasksCompleted = 0;

        // Task 1: Update remaining days for all active subscriptions
        const activeSubscriptions = await Subscription.find({
          status: 'active'
        });

        for (const subscription of activeSubscriptions) {
          try {
            const daysLeft = toIST(subscription.endDate).diff(nowIST(), 'days');
            subscription.remainingDays = Math.max(0, daysLeft);
            await subscription.save();
            tasksCompleted++;
          } catch (err) {
            logger.error(`Failed to update remaining days for ${subscription._id}`, err);
          }
        }



        await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');
        logger.success(`${jobName} completed: ${tasksCompleted} subscriptions processed`);
      } catch (error) {
        logger.error(`${jobName} failed`, error);
      }
    });

    this.jobs.push({ name: 'dailyMidnightTasks', job });
    logger.info(`Scheduled: Daily Midnight Tasks - Every day at 00:00`);
    return job;
  }

  // Auto-update delivery statuses based on time
  // ⚠️ DISABLED — Per Phase 9 rules: delivery status is OWNER-CONTROLLED ONLY.
  //   No cron, no auto-status. Owner updates manually via /api/deliveries/:id/status
  //   or /api/deliveries/update-by-user. This method is intentionally a no-op.
  autoUpdateDeliveryStatuses() {
    console.log('ℹ️  [CRON] autoUpdateDeliveryStatuses() is DISABLED. Delivery status is owner-controlled only.');
    // DO NOTHING — returning immediately without scheduling any job
    return null;
  }

  // Weekly repair cron: Find active subscriptions past endDate and mark expired
  weeklyRepairExpiredSubscriptions() {
    const jobName = 'Weekly Repair Expired Subscriptions';

    // Run every Sunday at midnight
    const job = cron.schedule('0 0 * * 0', async () => {
      // Check cron run guard
      if (!(await this.shouldRunCronJob(jobName))) return;

      logger.info(`Running: ${jobName}`);
      logger.info('🔧 REPAIR MODE: Finding active subscriptions that should be expired');

      try {
        const now = nowIST().startOf('day').toDate();

        // Find active subscriptions that have expired (endDate < today)
        const expiredActiveSubs = await Subscription.find({
          status: 'active',
          endDate: { $lt: now }
        }).populate('user');

        logger.info(`🔍 Found ${expiredActiveSubs.length} active subscriptions past endDate`);

        let repairedCount = 0;
        for (const subscription of expiredActiveSubs) {
          try {
            const user = subscription.user;

            logger.info(`🔧 [REPAIR] Marking expired: ${subscription._id} for user ${user.name} (${user._id})`);
            logger.info(`   EndDate: ${subscription.endDate}, Today: ${now}`);

            // Mark as expired
            subscription.status = 'expired';
            subscription.expiredAt = now;
            await subscription.save();

            repairedCount++;
            logger.info(`   ✅ Repaired: Set status to 'expired'`);
          } catch (err) {
            logger.error(`Failed to repair subscription ${subscription._id}`, err);
          }
        }

        await SystemSetting.setValue('lastCronRun', nowIST().toDate(), 'Last cron run timestamp', 'cron-service');
        logger.success(`${jobName} completed: ${repairedCount} subscriptions repaired`);
      } catch (error) {
        logger.error(`${jobName} failed`, error);
      }
    });

    this.jobs.push({ name: jobName, job });
    logger.info(`Scheduled: ${jobName} - Every Sunday at midnight`);
    return job;
  }

  // Helper method to log subscription history changes
  async logSubscriptionHistory(subscriptionId, userId, action, previousStatus, newStatus, reason, metadata = {}) {
    try {
      const SubscriptionHistory = require('../models/SubscriptionHistory');

      await SubscriptionHistory.create({
        subscription: subscriptionId,
        user: userId,
        action: action,
        previousStatus: previousStatus,
        newStatus: newStatus,
        reason: reason,
        metadata: metadata
      });

      logger.info(`📝 Logged subscription history: ${action} (${previousStatus} → ${newStatus})`);
    } catch (error) {
      logger.error('Failed to log subscription history:', error);
    }
  }

  // Start all cron jobs
  startAllJobs() {
    logger.info('Starting all cron jobs...');
    logger.info('⏳ Delaying cron start by 60 seconds to prevent duplicate runs on server restart...');

    setTimeout(() => {
      this.checkExpiringSubscriptions();
      this.checkExpiredSubscriptions();
      this.checkOverduePayments();
      this.autoAssignDefaultMeals();
      this.autoMarkDelivered();
      this.autoCreateDeliveries();
      this.autoUpdateDeliveryStatuses(); // NEW: Auto-update delivery statuses
      this.dailyMidnightTasks(); // NEW: Daily midnight subscription management
      this.weeklyRepairExpiredSubscriptions(); // NEW: Weekly repair expired subscriptions

      logger.success(`All ${this.jobs.length} cron jobs started successfully`);
    }, 60000); // 60 seconds delay
  }

  // Stop all cron jobs (for graceful shutdown)
  stopAllJobs() {
    logger.info('Stopping all cron jobs...');
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      logger.info(`Stopped: ${name}`);
    });
    this.jobs = [];
  }
}

module.exports = new CronService();
