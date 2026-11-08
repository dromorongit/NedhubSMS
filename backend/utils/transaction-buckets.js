// Shared transaction type/status buckets used by list filter, stats and frontend pills.
const SPENT_TYPES = ['debit'];
const RECEIVED_TYPES = ['credit']; // credits include refunds
const STATUS_MAP = {
  completed: 'Completed',
  success: 'Completed',
  paid: 'Completed',
  pending: 'Pending',
  processing: 'Pending',
  failed: 'Failed',
  error: 'Failed',
  cancelled: 'Failed'
};
function normalizeStatus(raw){ const k=String(raw||'').toLowerCase(); return STATUS_MAP[k] || (raw?String(raw).charAt(0).toUpperCase()+String(raw).slice(1):'Completed'); }
function isSpent(tx){ return SPENT_TYPES.includes(String(tx.type||'').toLowerCase()); }
function isReceived(tx){ return RECEIVED_TYPES.includes(String(tx.type||'').toLowerCase()); }
module.exports = { SPENT_TYPES, RECEIVED_TYPES, STATUS_MAP, normalizeStatus, isSpent, isReceived };
