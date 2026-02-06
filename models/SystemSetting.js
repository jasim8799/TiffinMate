const mongoose = require('mongoose');

const systemSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

// Update the updatedAt field on save
systemSettingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to get setting value
systemSettingSchema.statics.getValue = async function(key, defaultValue = null) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : defaultValue;
};

// Static method to set setting value
systemSettingSchema.statics.setValue = async function(key, value, description = '', updatedBy = 'system') {
  const result = await this.findOneAndUpdate(
    { key },
    {
      value,
      description,
      updatedBy,
      updatedAt: new Date()
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
  return result;
};

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
