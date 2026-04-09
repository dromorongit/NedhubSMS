const mongoose = require('mongoose');

const contactImportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  sourceType: {
    type: String,
    enum: ['csv', 'xlsx', 'xls', 'vcf', 'txt'],
    required: true
  },
  detectedNameColumn: {
    type: String,
    trim: true
  },
  detectedPhoneColumn: {
    type: String,
    trim: true
  },
  totalRows: {
    type: Number,
    default: 0,
    min: 0
  },
  validRows: {
    type: Number,
    default: 0,
    min: 0
  },
  invalidRows: {
    type: Number,
    default: 0,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Static method to find imports by user
contactImportSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Static method to create import record
contactImportSchema.statics.createImport = async function(userId, fileName, sourceType, detectedColumns = {}) {
  const importRecord = new this({
    userId,
    fileName,
    sourceType,
    detectedNameColumn: detectedColumns.name,
    detectedPhoneColumn: detectedColumns.phone,
    totalRows: 0,
    validRows: 0,
    invalidRows: 0
  });

  await importRecord.save();
  return importRecord;
};

// Method to update import statistics
contactImportSchema.methods.updateStats = async function(totalRows, validRows, invalidRows) {
  this.totalRows = totalRows;
  this.validRows = validRows;
  this.invalidRows = invalidRows;
  await this.save();
  return this;
};

module.exports = mongoose.model('ContactImport', contactImportSchema);