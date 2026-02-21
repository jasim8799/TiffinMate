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
      'create_customer',
      'restaurant_toggle'
    ]
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
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
    const doc = { ownerId, action, metadata };
    if (targetUserId) doc.targetUserId = targetUserId;
    return await this.create(doc);
  } catch (error) {
    // Non-fatal — audit log must NEVER crash business logic
    console.error('⚠️ Audit log failed (non-fatal):', error.message);
    return null;
  }
};

module.exports = mongoose.model('OwnerAuditLog', ownerAuditLogSchema);
