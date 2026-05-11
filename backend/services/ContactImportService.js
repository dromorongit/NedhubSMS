const xlsx = require('xlsx');
const Contact = require('../models/Contact');
const ContactImport = require('../models/ContactImport');
const BlacklistedNumber = require('../models/BlacklistedNumber');
const logger = require('../utils/logger');

class ContactImportService {
  constructor() {
    this.nameColumnPatterns = [
      /^name$/i,
      /^recipient.?name$/i,
      /^full.?name$/i,
      /^first.?name$/i,
      /^last.?name$/i,
      /^contact.?name$/i,
      /^customer.?name$/i,
      /^person.?name$/i,
      /^contact$/i,
      /^whatsapp.?name$/i
    ];

    this.phoneColumnPatterns = [
      /^phone$/i,
      /^phone.?number$/i,
      /^mobile$/i,
      /^mobile.?number$/i,
      /^contact.?number$/i,
      /^number$/i,
      /^telephone$/i,
      /^tel$/i,
      /^msisdn$/i,
      /^cell$/i,
      /^cell.?number$/i,
      /^whatsapp$/i,
      /^whatsapp.?number$/i
    ];
  }

  /**
   * Parse file content based on type
   * @param {Buffer} fileBuffer - The file buffer
   * @param {string} fileName - The original file name
   * @returns {Array} - Array of parsed rows
   */
  async parseFile(fileBuffer, fileName) {
    console.log('[Upload] Starting file parse', { fileName, bufferSize: fileBuffer.length });
    const ext = this.getFileExtension(fileName);

    try {
      let rows;
      switch (ext) {
        case 'csv':
        case 'txt':
          rows = this.parseCSV(fileBuffer);
          break;
        case 'xlsx':
        case 'xls':
          rows = this.parseExcel(fileBuffer);
          break;
        default:
          throw new Error(`Unsupported file type: ${ext}`);
      }

      console.log('[Upload] File parsed successfully', {
        fileName,
        rowsCount: rows.length,
        sample: rows.slice(0, 3)
      });
      return rows;
    } catch (error) {
      console.error('[Upload] Parse error', { fileName, error: error.message });
      throw error;
    }
  }

  /**
   * Parse CSV content
   * @param {Buffer} fileBuffer - The file buffer
   * @returns {Array} - Array of parsed rows
   */
  parseCSV(fileBuffer) {
    const content = fileBuffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());

    if (lines.length === 0) {
      throw new Error('File is empty');
    }

    // Parse header
    const headerLine = lines[0];
    const headers = this.parseCSVLine(headerLine);
    console.log('[Upload] CSV headers detected', { headers, count: headers.length });

    // Parse data rows
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = this.parseCSVLine(line);
      if (values.length === headers.length) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });
        rows.push(row);
      }
    }

    console.log('[Upload] CSV parsed', { rowsCount: rows.length });
    return rows;
  }

  /**
   * Parse a single CSV line handling quoted values
   * @param {string} line - The CSV line
   * @returns {Array} - Array of parsed values
   */
  parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    // Add the last field
    values.push(current.trim());

    return values;
  }

  /**
   * Parse Excel file
   * @param {Buffer} fileBuffer - The file buffer
   * @returns {Array} - Array of parsed rows
   */
  parseExcel(fileBuffer) {
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
    console.log('[Upload] Excel parsed', { rowsCount: rows.length, sheetName });
    return rows;
  }

  /**
   * Detect name and phone columns from headers
   * @param {Array} headers - Array of column headers
   * @returns {Object} - Object with detectedNameColumn and detectedPhoneColumn
   */
  detectColumns(headers) {
    console.log('[Preview] Starting column detection', { headers, count: headers.length });

    // Score ALL columns (don't stop at first match)
    const headerScores = headers.map(header => {
      const lower = String(header).toLowerCase().trim();
      let nameScore = 0;
      let phoneScore = 0;

      // Score name columns - check all patterns
      for (const pattern of this.nameColumnPatterns) {
        if (pattern.test(lower)) {
          nameScore = 1;
          break;
        }
      }
      // Exact matches get higher score
      if (nameScore > 0) {
        if (lower === 'name' || lower === 'full name' || lower === 'recipient name') {
          nameScore = 2;
        }
      }

      // Score phone columns - check all patterns
      for (const pattern of this.phoneColumnPatterns) {
        if (pattern.test(lower)) {
          phoneScore = 1;
          break;
        }
      }
      // Prioritize common phone column names
      if (phoneScore > 0) {
        if (lower === 'phone' || lower === 'phone number' || lower === 'mobile') {
          phoneScore = 2;
        } else if (lower === 'msisdn') {
          phoneScore = 3; // MSISDN is unambiguous and preferred
        }
      }

      return {
        original: header,
        lower,
        nameScore,
        phoneScore
      };
    });

    // Select best name column (highest score, first in file if tied)
    const bestName = headerScores
      .filter(item => item.nameScore > 0)
      .sort((a, b) => b.nameScore - a.nameScore || headers.indexOf(a.original) - headers.indexOf(b.original))[0];

    // Select best phone column (highest score, first in file if tied)
    const bestPhone = headerScores
      .filter(item => item.phoneScore > 0)
      .sort((a, b) => b.phoneScore - a.phoneScore || headers.indexOf(a.original) - headers.indexOf(b.original))[0];

    let nameColumn = bestName ? bestName.original : null;
    let phoneColumn = bestPhone ? bestPhone.original : null;

    // Fallback: positional detection
    if (!nameColumn && headers.length >= 1) {
      nameColumn = headers[0];
      console.log('[Preview] Name column fallback to first column', { nameColumn });
    }

    if (!phoneColumn && headers.length >= 2) {
      phoneColumn = headers[1];
      console.log('[Preview] Phone column fallback to second column', { phoneColumn });
    }

    const result = {
      detectedNameColumn: nameColumn,
      detectedPhoneColumn: phoneColumn
    };

    console.log('[Preview] Column detection complete', result);
    return result;
  }

  /**
   * Generate preview data for import modal
   * @param {Array} rows - Array of parsed row objects
   * @param {Object} columnMapping - { nameColumn, phoneColumn }
   * @returns {Array} - Array of preview objects with canonical schema
   */
  generatePreview(rows, columnMapping) {
    const { nameColumn, phoneColumn } = columnMapping;
    console.log('[Preview] Generating preview', { totalRows: rows.length, nameColumn, phoneColumn });

    const preview = [];
    const maxPreviewRows = Math.min(rows.length, 500); // Limit preview to 500 rows for performance

    for (let i = 0; i < maxPreviewRows; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      const recipientName = row[nameColumn]?.toString().trim() || '';
      const rawPhone = row[phoneColumn]?.toString().trim() || '';

      // Validate and normalize
      const phoneValidation = this.validateAndNormalizePhone(rawPhone);

      const previewRow = {
        recipientName: recipientName || '-',
        phoneNumber: rawPhone || '-',
        normalizedPhoneNumber: phoneValidation.isValid ? phoneValidation.normalizedNumber : '-',
        validationStatus: phoneValidation.isValid ? 'valid' : 'invalid',
        validationMessage: phoneValidation.isValid ? 'Valid' : (phoneValidation.error || 'Invalid')
      };

      preview.push(previewRow);

      if (i < 3) {
        console.log('[Preview] Sample row', { row: rowNumber, ...previewRow });
      }
    }

    const validCount = preview.filter(r => r.validationStatus === 'valid').length;
    const invalidCount = preview.filter(r => r.validationStatus === 'invalid').length;

    console.log('[Preview] Generation complete', { 
      previewRows: preview.length, 
      valid: validCount, 
      invalid: invalidCount 
    });

    return preview;
  }

  /**
   * Validate and normalize phone number
   * @param {string} phoneNumber - The phone number to validate
   * @returns {Object} - Validation result with isValid, normalizedNumber, and error
   */
  validateAndNormalizePhone(phoneNumber) {
    if (!phoneNumber) {
      return { isValid: false, normalizedNumber: null, error: 'Phone number is required' };
    }

    let cleaned = String(phoneNumber).replace(/[\s\-()+]/g, '');

    // Remove any non-digit characters
    cleaned = cleaned.replace(/\D/g, '');

    // Handle Ghanaian numbers
    if (cleaned.startsWith('233')) {
      // Already in international format
      if (cleaned.length === 12) {
        return { isValid: true, normalizedNumber: cleaned, error: null };
      }
    } else if (cleaned.startsWith('0')) {
      // Local format, convert to international
      if (cleaned.length === 10) {
        const international = '233' + cleaned.substring(1);
        return { isValid: true, normalizedNumber: international, error: null };
      }
    } else if (cleaned.length === 9) {
      // Missing country code, assume Ghana
      const international = '233' + cleaned;
      return { isValid: true, normalizedNumber: international, error: null };
    }

    // Check if it's a valid Ghanaian number pattern
    const ghanaRegex = /^233[0-9]{9}$/;
    if (ghanaRegex.test(cleaned)) {
      return { isValid: true, normalizedNumber: cleaned, error: null };
    }

    return {
      isValid: false,
      normalizedNumber: null,
      error: `Invalid phone number format: ${phoneNumber}`
    };
  }

  /**
   * Process import with validation and deduplication
   * @param {string} userId - The user ID
   * @param {Array} rows - Array of row objects
   * @param {Object} columnMapping - Column mapping object
   * @param {string} fileName - Original file name
   * @returns {Object} - Import results with comprehensive statistics
   */
  async processImport(userId, rows, columnMapping, fileName) {
    const { nameColumn, phoneColumn } = columnMapping;
    
    console.log('[Import] Starting import process', { 
      userId, 
      fileName, 
      totalRows: rows.length, 
      nameColumn, 
      phoneColumn,
      timestamp: new Date().toISOString()
    });
    if (rows.length > 0) {
      console.log('[Import] Sample raw rows (first 3)', rows.slice(0, 3));
    }

    // Create import record for tracking
    const importRecord = await ContactImport.createImport(
      userId,
      fileName,
      this.getFileExtension(fileName),
      { name: nameColumn, phone: phoneColumn }
    );

    console.log('[Import] Created import record', { importId: importRecord._id });

    // Load blacklisted numbers for this user (including global blacklist)
    console.log('[Validation] Loading blacklisted numbers', { userId });
    const blacklistedNumbers = await BlacklistedNumber.find({
      $or: [{ userId }, { userId: null }]
    }).select('normalizedPhoneNumber');
    const blacklistedSet = new Set(blacklistedNumbers.map(b => b.normalizedPhoneNumber));
    console.log('[Validation] Blacklisted numbers loaded', { count: blacklistedSet.size });

    // Pre-load existing contacts for this user to detect duplicates (single query)
    console.log('[Validation] Loading existing contacts for duplicate detection', { userId });
    const existingContacts = await Contact.find({ userId }).select('phoneNumber normalizedPhoneNumber');
    const existingPhones = new Set(existingContacts.map(c => c.normalizedPhoneNumber));
    console.log('[Validation] Existing contacts loaded', { count: existingPhones.size });

    // Track duplicates within the uploaded file
    const seenInFile = new Map();

    const results = {
      totalRows: rows.length,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 0,
      blacklistedRows: 0,
      importedRows: 0,
      skippedRows: 0,
      importedContacts: [],
      errors: []
    };

    console.log('[Import] Beginning row-by-row processing', { totalRows: rows.length });
    
    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      try {
        const recipientName = row[nameColumn]?.toString().trim();
        let phoneNumber = row[phoneColumn]?.toString().trim();

        if (i < 5) {
          console.log('[Import] Processing row', { row: rowNumber, recipientName, phoneNumber });
        }

        // Validate name
        if (!recipientName) {
          const error = { 
            row: rowNumber, 
            error: 'Name is required', 
            data: { recipientName, phoneNumber } 
          };
          results.errors.push(error);
          results.invalidRows++;
          console.log('[Validation] Row FAILED: Name required', { row: rowNumber });
          continue;
        }

        // Validate and normalize phone
        const phoneValidation = this.validateAndNormalizePhone(phoneNumber);
        if (!phoneValidation.isValid) {
          const error = { 
            row: rowNumber, 
            error: phoneValidation.error, 
            data: { recipientName, phoneNumber } 
          };
          results.errors.push(error);
          results.invalidRows++;
          console.log('[Validation] Row FAILED: Invalid phone', { 
            row: rowNumber, 
            phone: phoneNumber, 
            error: phoneValidation.error 
          });
          continue;
        }

        const normalizedPhone = phoneValidation.normalizedNumber;

        // Check for duplicates within the uploaded file
        if (seenInFile.has(normalizedPhone)) {
          results.duplicateRows++;
          results.errors.push({
            row: rowNumber,
            error: 'Duplicate phone number within uploaded file',
            data: { recipientName, phoneNumber }
          });
          console.log('[Validation] Row SKIPPED: Duplicate within file', { 
            row: rowNumber, 
            normalizedPhone 
          });
          continue;
        }
        seenInFile.set(normalizedPhone, rowNumber);

        // Check for duplicates against existing contacts
        if (existingPhones.has(normalizedPhone)) {
          results.duplicateRows++;
          results.errors.push({
            row: rowNumber,
            error: 'Phone number already exists in your contacts',
            data: { recipientName, phoneNumber }
          });
          console.log('[Validation] Row SKIPPED: Duplicate with existing contacts', { 
            row: rowNumber, 
            normalizedPhone 
          });
          continue;
        }

        // Check blacklist
        if (blacklistedSet.has(normalizedPhone)) {
          results.blacklistedRows++;
          results.errors.push({
            row: rowNumber,
            error: 'Phone number is blacklisted',
            data: { recipientName, phoneNumber }
          });
          console.log('[Validation] Row SKIPPED: Blacklisted', { 
            row: rowNumber, 
            normalizedPhone 
          });
          continue;
        }

        // All validations passed - create contact with atomic operation
        try {
          const contactId = await Contact.create(userId, recipientName, normalizedPhone, 'Imported');
          
          results.validRows++;
          results.importedRows++;
          results.importedContacts.push({
            id: contactId,
            recipientName,
            phoneNumber: normalizedPhone
          });
          
          // Update existing phones set to prevent duplicates in same batch
          existingPhones.add(normalizedPhone);
          
          console.log('[Contacts] Row SUCCESS: Imported contact', {
            row: rowNumber,
            contactId,
            recipientName,
            normalizedPhone
          });
        } catch (dbError) {
          // Handle potential race condition or duplicate key error
          if (dbError.code === 11000) { // MongoDB duplicate key error
            results.duplicateRows++;
            results.errors.push({
              row: rowNumber,
              error: 'Duplicate phone number (race condition)',
              data: { recipientName, phoneNumber }
            });
            console.log('[Contacts] Row SKIPPED: Duplicate key error (race condition)', { 
              row: rowNumber, 
              normalizedPhone 
            });
          } else {
            throw dbError;
          }
        }

      } catch (error) {
        results.errors.push({
          row: rowNumber,
          error: `Processing error: ${error.message}`,
          data: row
        });
        results.invalidRows++;
        console.error('[Import] Row ERROR', { row: rowNumber, error: error.message });
      }
    }

    // Calculate skipped rows (duplicates + blacklisted)
    results.skippedRows = results.duplicateRows + results.blacklistedRows;

    console.log('[Import] Import completed', {
      total: results.totalRows,
      valid: results.validRows,
      invalid: results.invalidRows,
      duplicates: results.duplicateRows,
      blacklisted: results.blacklistedRows,
      imported: results.importedRows,
      skipped: results.skippedRows,
      timestamp: new Date().toISOString()
    });
    if (results.importedContacts.length > 0) {
      console.log('[Import] Sample imported contacts', results.importedContacts.slice(0, 3));
    }

    // Update import record with comprehensive statistics
    await importRecord.updateStats(
      results.totalRows,
      results.validRows,
      results.invalidRows,
      results.duplicateRows,
      results.blacklistedRows,
      results.importedRows
    );

    return results;
  }

  /**
   * Get file extension from filename
   * @param {string} fileName - The file name
   * @returns {string} - The extension without dot
   */
  getFileExtension(fileName) {
    return fileName.split('.').pop().toLowerCase();
  }
}

module.exports = new ContactImportService();
