// Shared subscription activation and extension utilities
// Extracted to eliminate code duplication across payment endpoints

const moment = require('moment');

/**
 * Activate or extend a subscription based on payment
 * Handles all subscription status transitions and date calculations
 *
 * @param {Object} subscription - The subscription document to update
 * @param {Object} payment - The payment document that triggered the activation
 * @returns {Object} Updated subscription document
 */
async function activateOrExtendSubscription(subscription, payment) {
  // Check if subscription is already active
  if (subscription.status === 'active') {
    // Subscription already active - extend it
    const currentEndDate = subscription.endDate;
    const isExpired = moment().isAfter(currentEndDate);

    if (isExpired) {
      // Subscription expired - start fresh from today
      subscription.startDate = moment().startOf('day').toDate();
      subscription.endDate = moment()
        .add(subscription.totalDays - 1, 'days')
        .endOf('day')
        .toDate();
      subscription.remainingDays = subscription.totalDays;
    } else {
      // Subscription still active - extend from current end date
      subscription.endDate = moment(currentEndDate)
        .add(subscription.totalDays, 'days')
        .endOf('day')
        .toDate();
      subscription.remainingDays = moment(subscription.endDate).diff(moment().startOf('day'), 'days') + 1;
    }
  } else {
    // Subscription not active (pending/expired) - activate it
    subscription.status = 'active';
    subscription.startDate = moment().startOf('day').toDate();
    subscription.endDate = moment()
      .add(subscription.totalDays - 1, 'days')
      .endOf('day')
      .toDate();
    subscription.remainingDays = subscription.totalDays;
  }

  // Link payment to subscription activation
  subscription.activatedViaPaymentId = payment._id;

  return subscription;
}

module.exports = {
  activateOrExtendSubscription
};
