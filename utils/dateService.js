/**
 * ============================================================
 * DATE SERVICE — SINGLE SOURCE OF TRUTH FOR ALL DATE LOGIC
 * ============================================================
 *
 * ABSOLUTE RULES:
 *  1. All business logic runs in IST (Asia/Kolkata).
 *  2. DB stores dates in UTC only — MongoDB handles auto-conversion.
 *  3. IST is calculated first → then converted to UTC for DB queries.
 *  4. NEVER call moment() or new Date() directly in business code.
 *     Use functions from this module instead.
 *
 * CUTOFF RULE:
 *  Meals can be selected until 8:30 PM IST on the day BEFORE delivery.
 *  After 8:30 PM IST → tomorrow becomes locked, next day opens.
 *
 * MIDNIGHT RULE (Phase 3):
 *  At 00:00 IST tabs simply change their date filter.
 *  NO data is physically moved.
 * ============================================================
 */

'use strict';

const moment = require('moment-timezone');

const IST = 'Asia/Kolkata';
const CUTOFF_HOUR = 0;     // ⚠️ TESTING ONLY — restore to 20 after test
const CUTOFF_MINUTE = 30;  // 30 minutes

// ─────────────────────────────────────────────
// CORE IST HELPERS
// ─────────────────────────────────────────────

/**
 * Returns the current moment in IST.
 * @returns {moment.Moment}
 */
function getISTNow() {
  return moment.tz(IST);
}

/**
 * Returns the start of the current IST day (00:00:00 IST → UTC).
 * @returns {Date} UTC Date representing IST midnight.
 */
function getISTStartOfDay(date) {
  const base = date ? moment.tz(date, IST) : moment.tz(IST);
  return base.startOf('day').toDate();
}

/**
 * Returns the start of the NEXT IST day (tomorrow 00:00:00 IST → UTC).
 * Used as the upper bound for "today" queries.
 * @returns {Date}
 */
function getISTNextDayStart(date) {
  const base = date ? moment.tz(date, IST) : moment.tz(IST);
  return base.startOf('day').add(1, 'day').toDate();
}

/**
 * Returns IST day boundaries for MongoDB range queries.
 * ALWAYS use $gte start and $lt nextDayStart (not $lte endOfDay).
 *
 * @param {Date|string|moment.Moment} [date] - Any date (defaults to now)
 * @returns {{ startUTC: Date, nextDayStartUTC: Date }}
 */
function getISTDayBounds(date) {
  const m = date ? moment.tz(date, IST) : moment.tz(IST);
  const startUTC = m.clone().startOf('day').toDate();
  const nextDayStartUTC = m.clone().startOf('day').add(1, 'day').toDate();
  return { startUTC, nextDayStartUTC };
}

/**
 * Converts an IST moment/date to UTC Date for DB storage.
 * @param {moment.Moment|Date|string} istDate
 * @returns {Date}
 */
function convertISTToUTC(istDate) {
  if (moment.isMoment(istDate)) {
    return istDate.toDate();
  }
  return moment.tz(istDate, IST).toDate();
}

// ─────────────────────────────────────────────
// CUTOFF LOGIC
// ─────────────────────────────────────────────

/**
 * Returns the cutoff moment for a given delivery date.
 * Cutoff = 8:30 PM IST the day BEFORE the delivery date.
 *
 * @param {Date|string|moment.Moment} deliveryDate
 * @returns {moment.Moment} Cutoff time in IST
 */
function getCutoffForDeliveryDate(deliveryDate) {
  return moment
    .tz(deliveryDate, IST)
    .subtract(1, 'day')
    .hour(CUTOFF_HOUR)
    .minute(CUTOFF_MINUTE)
    .second(0)
    .millisecond(0);
}

/**
 * Returns the UTC Date of tonight's cutoff (8:30 PM IST today).
 * Used for CRON and server-side guard checks.
 * @returns {Date}
 */
function getCutoffTimeUTC() {
  return moment
    .tz(IST)
    .hour(CUTOFF_HOUR)
    .minute(CUTOFF_MINUTE)
    .second(0)
    .millisecond(0)
    .toDate();
}

/**
 * Returns true if the current IST time is past the 8:30 PM cutoff.
 * @returns {boolean}
 */
function isCutoffPassed() {
  const now = getISTNow();
  const cutoff = now.clone().hour(CUTOFF_HOUR).minute(CUTOFF_MINUTE).second(0).millisecond(0);
  return now.isSameOrAfter(cutoff);
}

// ─────────────────────────────────────────────
// DELIVERY DATE MAPPING
// ─────────────────────────────────────────────

/**
 * Returns the NEXT ORDERABLE delivery date.
 *
 * Before 8:30 PM IST → tomorrow
 * After  8:30 PM IST → day after tomorrow
 *
 * This is what the USER selects for.
 *
 * @returns {moment.Moment} Delivery date in IST
 */
function getNextOrderableDate() {
  const now = getISTNow();
  const cutoff = now.clone().hour(CUTOFF_HOUR).minute(CUTOFF_MINUTE).second(0).millisecond(0);
  if (now.isBefore(cutoff)) {
    return now.clone().startOf('day').add(1, 'day');
  }
  return now.clone().startOf('day').add(2, 'days');
}

/**
 * Returns TODAY's IST date (start of day moment).
 * Used by kitchen and dashboard to always show TODAY.
 *
 * CRITICAL: Kitchen always looks at TODAY, not "next orderable".
 * After 11 PM the kitchen still prepares for today until midnight.
 * At midnight (00:00 IST), "today" automatically becomes yesterday's tomorrow.
 *
 * @returns {moment.Moment}
 */
function getTodayIST() {
  return getISTNow().startOf('day');
}

/**
 * Given a tab offset, returns the corresponding delivery date.
 *   offset = 0 → today's delivery date (IST)
 *   offset = 1 → tomorrow's delivery date
 *
 * Tabs are purely date filters. No data is moved.
 *
 * @param {number} offset
 * @returns {moment.Moment}
 */
function getDeliveryDateForTab(offset) {
  return getISTNow().startOf('day').add(offset, 'days');
}

/**
 * Normalise any date to IST start-of-day UTC (for DB upsert keys).
 * This ensures consistent deliveryDate values in MealOrder and Delivery.
 *
 * @param {Date|string|moment.Moment} date
 * @returns {Date}
 */
function normaliseDeliveryDate(date) {
  return moment.tz(date, IST).startOf('day').toDate();
}

/**
 * Returns IST day boundaries as { start, end } for backward-compatible range queries.
 * start = IST start-of-day UTC (inclusive, use with $gte)
 * end   = IST end-of-day UTC   (inclusive, use with $lte)
 *
 * Prefer getISTDayBounds() for new code (uses $lt nextDayStart instead of $lte endOfDay).
 * This alias exists to support existing queries without semantic change.
 *
 * @param {Date|string|moment.Moment} [date]
 * @returns {{ start: Date, end: Date }}
 */
function getISTDayRange(date) {
  const m = date ? moment.tz(date, IST) : moment.tz(IST);
  const start = m.clone().startOf('day').toDate();
  const end   = m.clone().endOf('day').toDate();
  return { start, end };
}

// ─────────────────────────────────────────────
// DATE FORMATTING
// ─────────────────────────────────────────────

/**
 * Returns today's IST date as YYYY-MM-DD string.
 * @returns {string}
 */
function todayISTString() {
  return getISTNow().format('YYYY-MM-DD');
}

/**
 * Format a UTC date as IST-aware string.
 * @param {Date} date
 * @param {string} [fmt='YYYY-MM-DD HH:mm:ss']
 * @returns {string}
 */
function formatIST(date, fmt = 'YYYY-MM-DD HH:mm:ss') {
  return moment.tz(date, IST).format(fmt);
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  IST,
  CUTOFF_HOUR,
  CUTOFF_MINUTE,
  getISTNow,
  getISTStartOfDay,
  getISTNextDayStart,
  getISTDayBounds,
  getISTDayRange,
  convertISTToUTC,
  getCutoffForDeliveryDate,
  getCutoffTimeUTC,
  isCutoffPassed,
  getNextOrderableDate,
  getTodayIST,
  getDeliveryDateForTab,
  normaliseDeliveryDate,
  todayISTString,
  formatIST,
};
