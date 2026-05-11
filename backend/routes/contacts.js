const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Contact = require('../models/Contact');
const ContactImport = require('../models/ContactImport');
const ContactImportService = require('../services/ContactImportService');
const validator = require('validator');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.csv', '.xls', '.xlsx', '.vcf', '.txt'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, XLS, XLSX, VCF, and TXT files are allowed.'));
    }
  }
});

// Import contacts from file (initial parsing and column detection)
router.post('/import', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.userId;
    const fileName = req.file.originalname;

    console.log('[Upload] File received', { 
      userId, 
      fileName, 
      size: req.file.size, 
      type: req.file.mimetype,
      timestamp: new Date().toISOString()
    });

    // Parse the file
    const rows = await ContactImportService.parseFile(req.file.buffer, fileName);

    console.log('[Upload] File parsed', { 
      fileName, 
      rowsCount: rows.length,
      sample: rows.slice(0, 2)
    });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Get headers from first row
    const headers = Object.keys(rows[0]);

    // Auto-detect columns
    const detectedColumns = ContactImportService.detectColumns(headers);

    console.log('[Preview] Column detection result', detectedColumns);

    // Generate preview with canonical schema
    const preview = ContactImportService.generatePreview(rows, {
      nameColumn: detectedColumns.detectedNameColumn,
      phoneColumn: detectedColumns.detectedPhoneColumn
    });

    console.log('[Preview] Generated preview', { 
      previewRows: preview.length,
      firstRow: preview[0]
    });

    res.json({
      message: 'File parsed successfully',
      fileName,
      totalRows: rows.length,
      detectedColumns,
      preview,
      headers,
      fileData: rows // Include parsed rows for import confirmation
    });
  } catch (error) {
    console.error('[Upload] Error', { error: error.message });
    res.status(500).json({ error: 'Failed to parse file: ' + error.message });
  }
});

// Confirm import with column mapping
router.post('/import/confirm', authenticate, async (req, res) => {
  try {
    const { fileData, columnMapping, fileName } = req.body;
    const userId = req.user.userId;

    console.log('[Import] Confirm request received', { 
      userId, 
      fileName, 
      columnMapping,
      fileDataCount: fileData?.length,
      timestamp: new Date().toISOString()
    });
    if (fileData && fileData.length > 0) {
      console.log('[Import] First row sample', fileData[0]);
    }

    // Allow import if fileData exists OR if parsed data was previously stored
    if ((!fileData || !Array.isArray(fileData) || fileData.length === 0)) {
      // Check if we have a previously stored import session
      const storedImport = await ContactImport.findOne({ userId }).sort({ createdAt: -1 });
      if (!storedImport || !storedImport.importedRows || storedImport.importedRows === 0) {
        return res.status(400).json({
          error: 'File data is required. Please upload a file first'
        });
      }
      // Use previously stored data - reconstruct from the import record
      // This path is for when the import was already processed
      return res.json({
        message: 'Import already completed from previous session',
        results: {
          totalRows: storedImport.totalRows,
          validRows: storedImport.validRows,
          invalidRows: storedImport.invalidRows,
          duplicateRows: storedImport.duplicateRows,
          blacklistedRows: storedImport.blacklistedRows,
          importedRows: storedImport.importedRows,
          skippedRows: storedImport.skippedRows,
          importedContacts: [],
          errors: []
        }
      });
    }

    if (!columnMapping || !columnMapping.nameColumn || !columnMapping.phoneColumn) {
      return res.status(400).json({ error: 'Column mapping is required' });
    }

    // Process the import with comprehensive validation
    console.log('[Import] Starting import processing', { 
      userId, 
      fileName, 
      totalRows: fileData.length,
      columns: columnMapping 
    });
    const results = await ContactImportService.processImport(
      userId,
      fileData,
      columnMapping,
      fileName
    );

    console.log('[Import] Completed successfully', {
      total: results.totalRows,
      valid: results.validRows,
      invalid: results.invalidRows,
      duplicates: results.duplicateRows,
      blacklisted: results.blacklistedRows,
      imported: results.importedRows,
      skipped: results.skippedRows
    });
    if (results.importedContacts.length > 0) {
      console.log('[Import] Sample imported contacts', results.importedContacts.slice(0, 3));
    }

    // Return comprehensive summary
    res.json({
      message: 'Import completed',
      results: {
        totalRows: results.totalRows,
        validRows: results.validRows,
        invalidRows: results.invalidRows,
        duplicateRows: results.duplicateRows,
        blacklistedRows: results.blacklistedRows,
        importedRows: results.importedRows,
        skippedRows: results.skippedRows,
        importedContacts: results.importedContacts,
        errors: results.errors.slice(0, 50) // Return first 50 errors only
      }
    });
  } catch (error) {
    console.error('[Import] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to complete import: ' + error.message });
  }
});


// Create contact
router.post('/', authenticate, async (req, res) => {
  try {
    const { recipientName, phoneNumber, groupName } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!recipientName || !phoneNumber) {
      return res.status(400).json({ error: 'Recipient name and phone number are required' });
    }

    // Validate Ghana phone number format
    if (!validator.isMobilePhone(phoneNumber, 'any', { strictMode: false })) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Create contact
    const contactId = await Contact.create(userId, recipientName, phoneNumber, groupName);

    res.status(201).json({ contactId, message: 'Contact created successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all contacts for user
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    // Populate groupIds to get group names
    const contacts = await Contact.find({ userId })
      .populate('groupIds', 'name')
      .sort({ createdAt: -1 });
    res.json(contacts);
  } catch (error) {
    console.error('[Contacts] Error fetching contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update contact
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { recipientName, phoneNumber, groupName } = req.body;
    const contactId = req.params.id;
    const userId = req.user.userId;

    // Validate input
    if (!recipientName || !phoneNumber) {
      return res.status(400).json({ error: 'Recipient name and phone number are required' });
    }

    // Check if contact exists and belongs to user
    const contact = await Contact.findById(contactId);
    if (!contact || contact.userId.toString() !== userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Update contact
    await Contact.update(contactId, recipientName, phoneNumber, groupName);

    res.json({ message: 'Contact updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete contact
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const contactId = req.params.id;
    const userId = req.user.userId;

    // Check if contact exists and belongs to user
    const contact = await Contact.findById(contactId);
    if (!contact || contact.userId.toString() !== userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Delete contact
    await Contact.delete(contactId);

    res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Regenerate preview with new column mapping (for frontend dynamic updates)
router.post('/preview', authenticate, async (req, res) => {
  try {
    const { fileData, columnMapping } = req.body;
    const userId = req.user.userId;

    if (!fileData || !Array.isArray(fileData) || fileData.length === 0) {
      return res.status(400).json({ error: 'File data is required' });
    }

    if (!columnMapping || !columnMapping.nameColumn || !columnMapping.phoneColumn) {
      return res.status(400).json({ error: 'Column mapping is required' });
    }

    console.log('[Preview] Regenerate request:', {
      userId,
      rows: fileData.length,
      columns: columnMapping
    });

    // Generate preview using ContactImportService
    const ContactImportService = require('../services/ContactImportService');
    const preview = ContactImportService.generatePreview(fileData, columnMapping);

    console.log('[Preview] Regenerated', preview.length, 'preview rows');

    res.json({ preview });
  } catch (error) {
    console.error('[Preview] Regenerate error:', error.message);
    res.status(500).json({ error: 'Failed to regenerate preview: ' + error.message });
  }
});

module.exports = router;