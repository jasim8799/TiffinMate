/**
 * deliveryNotificationService.js
 *
 * RESPONSIBILITY: SMS + in-app AppNotification creation ONLY.
 * Socket emission is handled EXCLUSIVELY by deliveryController.js via
 * socketService.emitDeliveryStatusUpdated(). This service must NEVER emit
 * any socket event to prevent duplicate events and race conditions.
 */

const AppNotification = require('../models/AppNotification');
const User = require('../models/User');
const smsService = require('./smsService');
// NOTE: socketService is intentionally NOT imported here.

async function notifyDeliveryStatus(delivery, status) {
  try {
    if (!delivery.user) return;

    // Safety: if delivery.user is ObjectId (not populated), fetch User model
    let user = delivery.user;
    if (typeof delivery.user === 'string' || delivery.user instanceof require('mongoose').Types.ObjectId) {
      user = await User.findById(delivery.user);
      if (!user) return;
    }

    let title = '';
    let message = '';

    if (status === 'preparing') {
      title = 'Cooking Started';
      message = 'Your food is being prepared';
      await smsService.sendDeliveryPreparing(user.mobile, user.name, user._id);
    } else if (status === 'on-the-way') {
      title = 'Out For Delivery';
      message = 'Your food is out for delivery';
      await smsService.sendDeliveryOnWay(user.mobile, user.name, user._id);
    } else if (status === 'delivered') {
      title = 'Delivered';
      message = 'Your food has been delivered';
      await smsService.sendDeliveryDelivered(user.mobile, user.name, user._id);
    }

    // Guard: unknown status — nothing to notify
    if (!title) return;

    // Prevent duplicate in-app notifications within last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const notificationType =
      status === 'preparing'    ? 'delivery_cooking'    :
      status === 'on-the-way'   ? 'delivery_dispatched' :
      /* delivered */             'delivery_completed';

    const existingNotification = await AppNotification.findOne({
      relatedId: delivery._id,
      type: notificationType,
      createdAt: { $gte: tenMinutesAgo }
    });

    if (existingNotification) return; // skip duplicate

    await AppNotification.create({
      relatedUser: user._id,
      type: notificationType,
      title,
      message,
      relatedModel: 'Delivery',
      relatedId: delivery._id,
      priority: 'high',
      metadata: { deliveryId: delivery._id, status }
    });

  } catch (err) {
    console.error('Delivery notify error:', err);
  }
}

module.exports = { notifyDeliveryStatus };
