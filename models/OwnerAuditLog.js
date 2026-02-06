const mongoose = require('mongoose');

const ownerAuditLogSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'approve_pause',
      'approve_extra',
      'verify_id',
      'reset_password',
      'create_customer'
    ]
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for performance
ownerAuditLogSchema.index({ ownerId: 1, createdAt: -1 });
ownerAuditLogSchema.index({ action: 1, createdAt: -1 });
ownerAuditLogSchema.index({ targetUserId: 1, createdAt: -1 });

// Static method to create audit log
ownerAuditLogSchema.statics.logAction = async function(ownerId, action, targetUserId, metadata = {}) {
  try {
    const auditLog = await this.create({
      ownerId,
      action,
      targetUserId,
      metadata
    });
    return auditLog;
  } catch (error) {
    console.error('Error creating audit log:', error);
    throw error;
  }
};

module.exports = mongoose.model('OwnerAuditLog', ownerAuditLogSchema);
