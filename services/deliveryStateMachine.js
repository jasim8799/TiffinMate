/**
 * ============================================================
 * DELIVERY STATE MACHINE
 * ============================================================
 *
 * ABSOLUTE RULE: Delivery status changes ONLY via owner action.
 * NO cron, NO auto-update.
 *
 * Valid statuses:   preparing → on_the_way → delivered
 * Invalid skip:     preparing → delivered   (BLOCKED)
 *
 * Status names used in Delivery model: 'preparing', 'on-the-way', 'delivered'
 * ============================================================
 */

'use strict';

/**
 * Allowed next states from each current state.
 * Owner can only move forward, never skip, never go back.
 */
const TRANSITIONS = {
  preparing:  ['on-the-way'],
  'on-the-way': ['delivered'],
  delivered:  [],          // terminal state
  paused:     ['preparing'], // can resume from paused
  disabled:   [],           // terminal state
};

/**
 * Human-readable state labels for UI / error messages.
 */
const STATE_LABELS = {
  preparing:    'Preparing',
  'on-the-way': 'On the Way',
  delivered:    'Delivered',
  paused:       'Paused',
  disabled:     'Disabled',
};

class DeliveryStateMachine {
  /**
   * Validate that a transition from currentStatus → newStatus is legal.
   *
   * @param {string} currentStatus
   * @param {string} newStatus
   * @throws {Error} if transition is illegal
   */
  static validateTransition(currentStatus, newStatus) {
    const allowed = TRANSITIONS[currentStatus];

    if (!allowed) {
      throw new Error(
        `Unknown current delivery status: "${currentStatus}". ` +
        `Valid statuses: ${Object.keys(TRANSITIONS).join(', ')}`
      );
    }

    if (!TRANSITIONS[newStatus] && newStatus !== 'paused' && newStatus !== 'disabled') {
      throw new Error(
        `Unknown target delivery status: "${newStatus}". ` +
        `Valid statuses: ${Object.keys(TRANSITIONS).join(', ')}`
      );
    }

    if (!allowed.includes(newStatus)) {
      const allowedLabels = allowed.map(s => STATE_LABELS[s] || s);
      throw new Error(
        `Cannot transition delivery from "${STATE_LABELS[currentStatus] || currentStatus}" ` +
        `to "${STATE_LABELS[newStatus] || newStatus}". ` +
        `Allowed next states: ${allowedLabels.length ? allowedLabels.join(', ') : 'none (terminal)'}`
      );
    }
  }

  /**
   * Returns true if the given status string is valid.
   * @param {string} status
   * @returns {boolean}
   */
  static isValidStatus(status) {
    return Object.keys(TRANSITIONS).includes(status);
  }

  /**
   * Returns the allowed next statuses from the current state.
   * @param {string} currentStatus
   * @returns {string[]}
   */
  static nextAllowedStatuses(currentStatus) {
    return TRANSITIONS[currentStatus] ?? [];
  }

  /**
   * Returns all valid status values.
   * @returns {string[]}
   */
  static allStatuses() {
    return Object.keys(TRANSITIONS);
  }
}

module.exports = DeliveryStateMachine;
