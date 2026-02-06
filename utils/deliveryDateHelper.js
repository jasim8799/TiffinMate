const moment = require('moment-timezone');

/**
 * ✅ SINGLE SOURCE OF TRUTH FOR DELIVERY DATE MAPPING
 * 
 * This is the PRIMARY helper for calculating delivery dates by offset.
 * 
 * OFFSET MAPPING:
 * offset = -1 → TODAY (current delivery, read-only)
 * offset = 0  → TOMORROW (next orderable, editable before cutoff)
 * 
 * LOGIC:
 * Base date = start of today in IST
 * Delivery date = base + (offset + 1) days
 * 
 * Examples:
 * offset -1 → base + 0 days = today
 * offset 0  → base + 1 day = tomorrow
 * 
 * @param {number} offset - The tab offset (-1 for today, 0 for tomorrow)
 * @returns {moment.Moment} Delivery date moment in IST
 */
function getDeliveryDateByOffset(offset) {
  const now = moment.tz('Asia/Kolkata');
  const baseDate = now.clone().startOf('day');
  
  // CRITICAL: Map offset to delivery date
  // offset = -1 → -1 + 1 = 0 days → today
  // offset = 0 → 0 + 1 = 1 day → tomorrow
  return baseDate.clone().add(offset + 1, 'days');
}

/**
 * ✅ AUTOMATIC DAILY MEAL ROLLOVER LOGIC
 *
 * This function implements automatic daily meal rollover:
 * - Meals can be selected only for the NEXT delivery date
 * - Cutoff time is 11:00 PM IST
 * - After 11:00 PM, current "tomorrow" is LOCKED
 * - At exactly 00:00 (midnight), delivery date moves forward by 1 day
 *
 * RULE:
 * - if now < 23:00 → deliveryDate = tomorrow
 * - if now >= 23:00 → deliveryDate = day after tomorrow
 *
 * ALL meal ordering logic MUST use this function.
 *
 * @returns {moment.Moment} The next orderable delivery moment in IST
 */
function getNextOrderableDeliveryMoment() {
  // Use offset=0 to get tomorrow's orderable date
  return getDeliveryDateByOffset(0);
}

/**
 * Get the cutoff time for a specific delivery date
 * Cutoff is always 11:00 PM on the day BEFORE delivery
 *
 * @param {Date|string|moment.Moment} deliveryDate - The delivery date
 * @returns {moment.Moment} The cutoff time
 */
function getCutoffTimeForDate(deliveryDate) {
  return moment
    .tz(deliveryDate, 'Asia/Kolkata')
    .subtract(1, 'day')
    .hour(23)
    .minute(0)
    .second(0)
    .millisecond(0);
}

/**
 * ✅ FIX: Get IST day boundaries for date range queries
 * 
 * This function solves the midnight UTC issue where:
 * - MongoDB stores: 2026-01-29T18:30:00.000Z (UTC)
 * - Which is: 2026-01-30 00:00 IST (midnight next day)
 * 
 * By using date range queries instead of equality,
 * meals saved yesterday appear in today's tab after midnight IST.
 * 
 * @param {Date} date - Any date (will be interpreted in IST timezone)
 * @returns {Object} { start: Date, end: Date } for MongoDB $gte and $lte
 */
function getISTDayRange(date) {
  const istMoment = moment.tz(date, 'Asia/Kolkata');
  const start = istMoment.clone().startOf('day').toDate();
  const end = istMoment.clone().endOf('day').toDate();
  return { start, end };
}

module.exports = {
  getDeliveryDateByOffset,
  getNextOrderableDeliveryMoment,
  getCutoffTimeForDate,
  getISTDayRange,
};
