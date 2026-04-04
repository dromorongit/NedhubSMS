const AuditLog = require('../models/AuditLog');

const logAction = async (adminId, action, targetType, targetId, details = {}) => {
  try {
    // Skip if no adminId (non-admin actions like user registration)
    if (!adminId) {
      return;
    }
    
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