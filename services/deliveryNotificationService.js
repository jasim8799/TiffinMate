const AppNotification = require('../models/AppNotification');
const smsService = require('./smsService');
const socketService = require('./socketService');

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

    // Convert status checks into if/else-if chain
    if (status === 'preparing') {
      title = 'Cooking Started';
      message = 'Your food is being prepared';
      await smsService.sendDeliveryPreparing(user.mobile, user.name, user._id);
      socketService.emitCookingStarted(delivery);
    } else if (status === 'on-the-way') {
      title = 'Out For Delivery';
      message = 'Your food is out for delivery';
      await smsService.sendDeliveryOnWay(user.mobile, user.name, user._id);
      socketService.emitOutForDelivery(delivery);
    } else if (status === 'delivered') {
      title = 'Delivered';
      message = 'Your food has been delivered';
      await smsService.sendDeliveryDelivered(user.mobile, user.name, user._id);
      socketService.emitDelivered(delivery);
    }

    // Guard: if title is empty after status checks, return early
    if (!title) return;

    // Prevent duplicate notifications: check if exists within last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const notificationType = status === 'preparing' ? 'delivery_cooking' : status === 'on-the-way' ? 'delivery_dispatched' : 'delivery_completed';

    const existingNotification = await AppNotification.findOne({
      relatedId: delivery._id,
      type: notificationType,
      createdAt: { $gte: tenMinutesAgo }
    });

    if (existingNotification) {
      // Skip creating duplicate notification
      return;
    }

    await AppNotification.create({
      relatedUser: user._id,
      type: notificationType,
      title,
      message,
      relatedModel: 'Delivery',
      relatedId: delivery._id,
      priority: 'high',
      metadata: {
        deliveryId: delivery._id,
        status
      }
    });

    socketService.emitNotificationToUser(user._id.toString(), {
      type: 'delivery',
      title,
      message
    });

  } catch (err) {
    console.error('Delivery notify error:', err);
  }
}

module.exports = {
  notifyDeliveryStatus
};
