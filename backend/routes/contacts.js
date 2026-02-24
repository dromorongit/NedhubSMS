const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Contact = require('../models/Contact');
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

// Import contacts from file
router.post('/import', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.userId;
    const groupName = req.body.groupName || 'Imported';
    const fileContent = req.file.buffer.toString('utf-8');
    const ext = path.extname(req.file.originalname).toLowerCase();

    let contacts = [];

    // Parse based on file type
    if (ext === '.csv' || ext === '.txt') {
      contacts = parseCSV(fileContent);
    } else if (ext === '.vcf') {
      contacts = parseVCF(fileContent);
    } else if (ext === '.xls' || ext === '.xlsx') {
      // For Excel files, we'll use a simple parsing approach
      // In production, you'd use a library like 'xlsx'
      contacts = parseExcelSimple(fileContent);
    }

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No valid contacts found in file' });
    }

    // Save contacts to database
    let imported = 0;
    let duplicates = 0;

    for (const contact of contacts) {
      try {
        // Validate phone number
        if (!contact.phoneNumber || !validator.isMobilePhone(contact.phoneNumber, 'any', { strictMode: false })) {
          duplicates++;
          continue;
        }

        // Validate name
        if (!contact.name || contact.name.trim() === '') {
          duplicates++;
          continue;
        }

        // Create contact
        await Contact.create(userId, contact.name.trim(), contact.phoneNumber, groupName);
        imported++;
      } catch (err) {
        // Skip duplicates or invalid contacts
        if (err.code === 11000) {
          duplicates++;
        } else {
          console.error('Error importing contact:', err);
        }
      }
    }

    res.json({ 
      message: 'Import completed',
      imported,
      duplicates,
      total: contacts.length
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import contacts: ' + error.message });
  }
});

// Parse CSV/TXT file
function parseCSV(content) {
  const contacts = [];
  const lines = content.split(/\r?\n/);
  
  // Skip header if present
  let startIndex = 0;
  const firstLine = lines[0]?.toLowerCase() || '';
  if (firstLine.includes('name') && firstLine.includes('phone')) {
    startIndex = 1;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Try different delimiters
    let parts = line.split(',');
    if (parts.length < 2) {
      parts = line.split(';');
    }
    if (parts.length < 2) {
      parts = line.split('\t');
    }

    if (parts.length >= 2) {
      const name = parts[0].trim().replace(/^"|"$/g, '');
      let phone = parts[1].trim().replace(/^"|"$/g, '');
      
      // Clean phone number
      phone = phone.replace(/[^0-9+]/g, '');
      
      if (phone.startsWith('0')) {
        phone = '+233' + phone.substring(1);
      }

      if (name && phone) {
        contacts.push({ name, phoneNumber: phone });
      }
    }
  }

  return contacts;
}

// Parse VCF file
function parseVCF(content) {
  const contacts = [];
  const vcards = content.split('END:VCARD');

  for (const vcard of vcards) {
    if (!vcard.includes('BEGIN:VCARD')) continue;

    let name = '';
    let phone = '';

    // Extract name
    const fnMatch = vcard.match(/FN[;:](.*)/i);
    if (fnMatch) {
      name = fnMatch[1].split(':')[1]?.trim() || '';
    }

    // If no FN, try N
    if (!name) {
      const nMatch = vcard.match(/N[;:](.*)/i);
      if (nMatch) {
        const parts = nMatch[1].split(':')[1]?.split(';') || [];
        name = (parts[1] || '') + ' ' + (parts[0] || '');
        name = name.trim();
      }
    }

    // Extract phone
    const telMatch = vcard.match(/TEL[;:](.*)/i);
    if (telMatch) {
      phone = telMatch[1].split(':')[1]?.replace(/[^0-9+]/g, '') || '';
      
      if (phone.startsWith('0')) {
        phone = '+233' + phone.substring(1);
      }
    }

    if (name && phone) {
      contacts.push({ name, phoneNumber: phone });
    }
  }

  return contacts;
}

// Simple Excel parsing (for .xls/.xlsx - basic XML parsing)
// Note: For production, consider using 'xlsx' library
function parseExcelSimple(content) {
  const contacts = [];
  
  // This is a very basic approach - in production use 'xlsx' library
  // For now, return empty and suggest using CSV format
  console.log('Excel parsing not fully implemented, please use CSV format');
  
  return contacts;
}

// Create contact
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, phoneNumber, groupName } = req.body;
    const userId = req.user.userId;

    // Validate input
    if (!name || !phoneNumber) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Validate Ghana phone number format
    if (!validator.isMobilePhone(phoneNumber, 'any', { strictMode: false })) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Create contact
    const contactId = await Contact.create(userId, name, phoneNumber, groupName);

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
    const { name, phoneNumber, groupName } = req.body;
    const contactId = req.params.id;
    const userId = req.user.userId;

    // Validate input
    if (!name || !phoneNumber) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Check if contact exists and belongs to user
    const contact = await Contact.findById(contactId);
    if (!contact || contact.user_id !== userId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Update contact
    await Contact.update(contactId, name, phoneNumber, groupName);

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
    if (!contact || contact.user_id !== userId) {
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