/**
 * ============================================================
 * CUTOFF ENGINE — CENTRAL BUSINESS RULE ENGINE
 * ============================================================
 *
 * ALL cutoff-related decisions go through this module.
 * Remove scattered cutoff checks from controllers.
 *
 * RULES:
 *  - Before 11 PM IST → Users can select meals
 *  - After  11 PM IST → Daily user locked; Subscription user gets default
 *  - restaurantClosed  → Blocks ALL selection and default assignment
 *
 * Never duplicate these rules in controllers.
 * ============================================================
 */

'use strict';

const { getISTNow, isCutoffPassed, getCutoffForDeliveryDate } = require('../utils/dateService');
const moment = require('moment-timezone');

/**
 * Result shape returned by CutoffEngine methods.
 * @typedef {Object} CutoffResult
 * @property {boolean} allowed
 * @property {string}  reason     - machine-readable reason code
 * @property {string}  message    - human-readable message
 */

class CutoffEngine {
  /**
   * Check whether meal selection is currently allowed.
   *
   * @param {Object} opts
   * @param {boolean} opts.isRestaurantOpen
   * @param {'subscription'|'daily'} opts.orderSource
   * @param {Date|string} [opts.deliveryDate] - If provided, checks cutoff for that date
   * @returns {CutoffResult}
   */
  static canSelectMeal({ isRestaurantOpen, orderSource, deliveryDate }) {
    // 1. Restaurant closed → block everything
    if (!isRestaurantOpen) {
      return {
        allowed: false,
        reason: 'RESTAURANT_CLOSED',
        message: 'Restaurant is currently closed. Meal selection is not available.',
      };
    }

    // 2. Check cutoff
    const cutoffPassed = deliveryDate
      ? getISTNow().isSameOrAfter(getCutoffForDeliveryDate(deliveryDate))
      : isCutoffPassed();

    if (cutoffPassed) {
      if (orderSource === 'daily') {
        return {
          allowed: false,
          reason: 'CUTOFF_PASSED_DAILY',
          message: 'Cutoff time has passed. Daily meal selection is locked.',
        };
      }
      // Subscription users: not "allowed" to manually select, but system will auto-default
      return {
        allowed: false,
        reason: 'CUTOFF_PASSED_SUBSCRIPTION',
        message: 'Cutoff time has passed. Default meal will be assigned automatically.',
        willAutoDefault: true,
      };
    }

    return { allowed: true, reason: 'OK', message: 'Meal selection is open.' };
  }

  /**
   * Check whether default auto-assignment is permitted for a given date.
   *
   * @param {Object} opts
   * @param {boolean} opts.isRestaurantOpen
   * @param {Date}    opts.deliveryDate
   * @returns {CutoffResult}
   */
  static canAutoAssignDefault({ isRestaurantOpen, deliveryDate }) {
    if (!isRestaurantOpen) {
      return {
        allowed: false,
        reason: 'RESTAURANT_CLOSED',
        message: 'Restaurant closed — no default assignment.',
      };
    }

    const cutoffPassed = getISTNow().isSameOrAfter(getCutoffForDeliveryDate(deliveryDate));
    if (!cutoffPassed) {
      return {
        allowed: false,
        reason: 'BEFORE_CUTOFF',
        message: 'Cutoff has not passed yet — user can still select.',
      };
    }

    return { allowed: true, reason: 'OK', message: 'Auto-default assignment allowed.' };
  }

  /**
   * Determine which meals tab the user is currently viewing.
   * TODAY tab = deliveries for IST today.
   * TOMORROW tab = deliveries for IST tomorrow.
   *
   * Before 11 PM IST:
   *   - Today tab   → today's date
   *   - Tomorrow tab → tomorrow's date  (orderable)
   * After 11 PM IST:
   *   - Today tab   → today's date      (read-only display)
   *   - Tomorrow tab → tomorrow's date  (locked until midnight, then new day opens)
   *
   * @param {'today'|'tomorrow'} tab
   * @returns {{ deliveryDate: moment.Moment, isLocked: boolean, canSelect: boolean }}
   */
  static getTabState(tab) {
    const now = getISTNow();
    const cutoffPassed = isCutoffPassed();
    const today = now.clone().startOf('day');
    const tomorrow = today.clone().add(1, 'day');

    if (tab === 'today') {
      return {
        deliveryDate: today,
        isLocked: true, // today is always read-only for selection
        canSelect: false,
      };
    }

    // Tomorrow tab
    return {
      deliveryDate: tomorrow,
      isLocked: cutoffPassed, // locked after 11 PM
      canSelect: !cutoffPassed,
    };
  }

  /**
   * Get a standardised "restaurant closed" response body.
   * Used by middleware and controllers.
   */
  static restaurantClosedResponse() {
    return {
      success: false,
      reason: 'RESTAURANT_CLOSED',
      message: 'Restaurant is currently closed. Please try again later.',
    };
  }
}

module.exports = CutoffEngine;
