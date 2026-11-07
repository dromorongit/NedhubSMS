// Shared status-bucket mapping for Message History.
// Single source of truth used by /api/sms/logs and /api/sms/messages/stats.
const DELIVERED_STATUSES = ['sent', 'delivered'];
const FAILED_STATUSES = ['failed'];
const QUEUED_STATUSES = ['queued', 'processing', 'scheduled'];
const CANCELLED_STATUSES = ['cancelled'];

function normalize(status) {
  return String(status || '').toLowerCase().trim();
}

function bucketOf(status) {
  const s = normalize(status);
  if (DELIVERED_STATUSES.includes(s)) return 'delivered';
  if (FAILED_STATUSES.includes(s)) return 'failed';
  if (QUEUED_STATUSES.includes(s)) return 'queued';
  if (CANCELLED_STATUSES.includes(s)) return 'cancelled';
  return 'other';
}

// Statuses matched by a frontend filter value.
function statusesForFilter(filter) {
  const f = normalize(filter);
  if (!f || f === 'all') return null;
  if (f === 'delivered' || f === 'sent') return DELIVERED_STATUSES.slice();
  if (f === 'failed') return FAILED_STATUSES.slice();
  if (f === 'queued') return QUEUED_STATUSES.slice();
  if (f === 'cancelled') return CANCELLED_STATUSES.slice();
  return [f];
}

function isDelivered(status) { return bucketOf(status) === 'delivered'; }
function isFailed(status) { return bucketOf(status) === 'failed'; }
function isQueued(status) { return bucketOf(status) === 'queued'; }

module.exports = {
  DELIVERED_STATUSES,
  FAILED_STATUSES,
  QUEUED_STATUSES,
  CANCELLED_STATUSES,
  normalize,
  bucketOf,
  statusesForFilter,
  isDelivered,
  isFailed,
  isQueued
};
