const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true
  },
  targetType: {
    type: String,
    required: true,
    enum: ['user', 'wallet', 'sender_id', 'campaign', 'system']
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient querying
auditLogSchema.index({ adminId: 1, timestamp: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);