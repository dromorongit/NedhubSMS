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

    // Parse the file
    const rows = await ContactImportService.parseFile(req.file.buffer, fileName);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Get headers from first row
    const headers = Object.keys(rows[0]);

    // Auto-detect columns
    const detectedColumns = ContactImportService.detectColumns(headers);

    // Generate preview
    const preview = ContactImportService.generatePreview(rows, {
      nameColumn: detectedColumns.detectedNameColumn,
      phoneColumn: detectedColumns.detectedPhoneColumn
    });

    res.json({
      message: 'File parsed successfully',
      fileName,
      totalRows: rows.length,
      detectedColumns,
      preview,
      headers
    });
  } catch (error) {
    console.error('Import parsing error:', error);
    res.status(500).json({ error: 'Failed to parse file: ' + error.message });
  }
});

// Confirm import with column mapping
router.post('/import/confirm', authenticate, async (req, res) => {
  try {
    const { fileData, columnMapping, fileName } = req.body;
    const userId = req.user.userId;

    if (!fileData || !Array.isArray(fileData) || fileData.length === 0) {
      return res.status(400).json({ error: 'File data is required' });
    }

    if (!columnMapping || !columnMapping.nameColumn || !columnMapping.phoneColumn) {
      return res.status(400).json({ error: 'Column mapping is required' });
    }

    // Process the import
    const results = await ContactImportService.processImport(
      userId,
      fileData,
      columnMapping,
      fileName
    );

    res.json({
      message: 'Import completed',
      results
    });
  } catch (error) {
    console.error('Import confirmation error:', error);
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
    const contacts = await Contact.findByUserId(userId);
    res.json(contacts);
  } catch (error) {
    console.error(error);
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

module.exports = router;