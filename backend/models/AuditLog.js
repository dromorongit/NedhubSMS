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

auditLogSchema.statics.log = async function (data) {
  try {
    return await this.create({
      adminId: data && data.userId ? data.userId : data && data.adminId,
      action: data && data.action ? data.action : 'UNKNOWN',
      targetType: 'system',
      targetId: data && (data.resourceId || data.targetId) ? (data.resourceId || data.targetId) : new mongoose.Types.ObjectId(),
      details: data && data.details ? data.details : {},
      ipAddress: data && data.ipAddress,
      userAgent: data && data.userAgent
    });
  } catch (e) {
    console.error('AuditLog.log failed:', e && e.message ? e.message : e);
    return null;
  }
};

module.exports = mongoose.model('AuditLog', auditLogSchema);