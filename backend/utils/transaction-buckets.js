// Shared transaction type/status buckets used by list filter, stats and frontend pills.
const SPENT_TYPES = ['debit'];
const RECEIVED_TYPES = ['credit']; // credits include refunds
const STATUS_MAP = {
  completed: 'Completed',
  success: 'Completed',
  successful: 'Completed',
  paid: 'Completed',
  applied: 'Completed',
  sent: 'Completed',
  delivered: 'Completed',
  pending: 'Pending',
  pending_confirmation: 'Pending',
  pending_payment: 'Pending',
  processing: 'Pending',
  queued: 'Pending',
  failed: 'Failed',
  error: 'Failed',
  cancelled: 'Failed',
  rejected: 'Failed'
};
function normalizeStatus(raw){ const k=String(raw||'').toLowerCase(); if(!k) return 'Pending'; return STATUS_MAP[k] || 'Pending'; }
function isSpent(tx){ return SPENT_TYPES.includes(String(tx.type||'').toLowerCase()); }
function isReceived(tx){ return RECEIVED_TYPES.includes(String(tx.type||'').toLowerCase()); }
module.exports = { SPENT_TYPES, RECEIVED_TYPES, STATUS_MAP, normalizeStatus, isSpent, isReceived };
