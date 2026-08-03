const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ContactImportService = require('../services/ContactImportService');
const multer = require('multer');
const path = require('path');
const logger = require('../utils/logger');

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.csv', '.xls', '.xlsx', '.txt'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, XLS, XLSX, and TXT files are allowed.'));
    }
  }
});

/**
 * Parse a contact file for Send SMS recipient upload.
 * This endpoint performs parse-only: no MongoDB writes, no Contact DB comparison.
 * Returns raw rows, detected columns, and preview data for client-side column mapping.
 */
router.post('/upload-temp', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    const fileName = req.file.originalname;

    logger.info('[SmsUpload] File received', {
      userId: req.user.userId,
      fileName,
      size: req.file.size,
      type: req.file.mimetype
    });

    const rows = await ContactImportService.parseFile(req.file.buffer, fileName);

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'The file is empty. Please upload a file with contact data.'
      });
    }

    const headers = Object.keys(rows[0]);
    const detectedColumns = ContactImportService.detectColumns(headers);

    const preview = ContactImportService.generatePreview(rows, {
      nameColumn: detectedColumns.detectedNameColumn,
      phoneColumn: detectedColumns.detectedPhoneColumn
    });

    logger.info('[SmsUpload] File parsed successfully', {
      userId: req.user.userId,
      fileName,
      rowsCount: rows.length,
      validPreview: preview.filter(r => r.validationStatus === 'valid').length
    });

    res.json({
      message: 'File parsed successfully',
      fileName,
      totalRows: rows.length,
      detectedColumns,
      preview,
      headers,
      fileData: rows
    });
  } catch (error) {
    logger.error('[SmsUpload] Parse error', {
      userId: req.user.userId,
      error: error.message
    });
    res.status(500).json({
      error: 'Failed to parse file. Please check the file format and try again.'
    });
  }
});

module.exports = router;
