const AuditLog = require('../models/AuditLog');

const logAction = async (adminId, action, targetType, targetId, details = {}) => {
  try {
    const auditEntry = new AuditLog({
      adminId,
      action,
      targetType,
      targetId,
      details
    });
    await auditEntry.save();
  } catch (error) {
    console.error('Failed to log audit action:', error);
  }
};

module.exports = {
  logAction
};