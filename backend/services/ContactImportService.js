const xlsx = require('xlsx');
const Contact = require('../models/Contact');
const ContactImport = require('../models/ContactImport');

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
      /^person.?name$/i
    ];

    this.phoneColumnPatterns = [
      /^phone$/i,
      /^phone.?number$/i,
      /^mobile$/i,
      /^mobile.?number$/i,
      /^contact$/i,
      /^contact.?number$/i,
      /^number$/i,
      /^telephone$/i,
      /^tel$/i,
      /^msisdn$/i
    ];
  }

  /**
   * Parse file content based on type
   * @param {Buffer} fileBuffer - The file buffer
   * @param {string} fileName - The original file name
   * @returns {Array} - Array of parsed rows
   */
  async parseFile(fileBuffer, fileName) {
    const ext = this.getFileExtension(fileName);

    switch (ext) {
      case 'csv':
      case 'txt':
        return this.parseCSV(fileBuffer);
      case 'xlsx':
      case 'xls':
        return this.parseExcel(fileBuffer);
      default:
        throw new Error(`Unsupported file type: ${ext}`);
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

    return rows;
  }

  /**
   * Detect name and phone columns from headers
   * @param {Array} headers - Array of column headers
   * @returns {Object} - Object with detectedNameColumn and detectedPhoneColumn
   */
  detectColumns(headers) {
    let nameColumn = null;
    let phoneColumn = null;

    // First pass: exact pattern matching
    for (const header of headers) {
      const headerStr = String(header).toLowerCase().trim();

      if (!nameColumn && this.nameColumnPatterns.some(pattern => pattern.test(headerStr))) {
        nameColumn = header;
      }

      if (!phoneColumn && this.phoneColumnPatterns.some(pattern => pattern.test(headerStr))) {
        phoneColumn = header;
      }

      if (nameColumn && phoneColumn) break;
    }

    // Second pass: fuzzy matching if exact match failed
    if (!nameColumn || !phoneColumn) {
      for (const header of headers) {
        const headerStr = String(header).toLowerCase().trim();

        if (!nameColumn && (headerStr.includes('name') || headerStr.includes('recipient'))) {
          nameColumn = nameColumn || header;
        }

        if (!phoneColumn && (headerStr.includes('phone') || headerStr.includes('mobile') ||
                            headerStr.includes('contact') || headerStr.includes('number'))) {
          phoneColumn = phoneColumn || header;
        }
      }
    }

    // Third pass: positional fallback
    if (!nameColumn && headers.length >= 1) {
      nameColumn = headers[0]; // Assume first column is name
    }

    if (!phoneColumn && headers.length >= 2) {
      phoneColumn = headers[1]; // Assume second column is phone
    }

    return {
      detectedNameColumn: nameColumn,
      detectedPhoneColumn: phoneColumn
    };
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
   * @returns {Object} - Import results
   */
  async processImport(userId, rows, columnMapping, fileName) {
    const { nameColumn, phoneColumn } = columnMapping;
    const results = {
      totalRows: rows.length,
      validRows: 0,
      invalidRows: 0,
      importedContacts: [],
      errors: []
    };

    const importRecord = await ContactImport.createImport(
      userId,
      fileName,
      this.getFileExtension(fileName),
      { name: nameColumn, phone: phoneColumn }
    );

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;

      try {
        const recipientName = row[nameColumn]?.toString().trim();
        const phoneNumber = row[phoneColumn]?.toString().trim();

        // Validate name
        if (!recipientName) {
          results.errors.push({
            row: rowNumber,
            error: 'Name is required',
            data: { recipientName, phoneNumber }
          });
          results.invalidRows++;
          continue;
        }

        // Validate and normalize phone
        const phoneValidation = this.validateAndNormalizePhone(phoneNumber);
        if (!phoneValidation.isValid) {
          results.errors.push({
            row: rowNumber,
            error: phoneValidation.error,
            data: { recipientName, phoneNumber }
          });
          results.invalidRows++;
          continue;
        }

        // Check for duplicates (same user, same phone number)
        const existingContact = await Contact.findOne({
          userId,
          phoneNumber: phoneValidation.normalizedNumber
        });

        if (existingContact) {
          results.errors.push({
            row: rowNumber,
            error: 'Duplicate phone number (contact already exists)',
            data: { recipientName, phoneNumber }
          });
          results.invalidRows++;
          continue;
        }

        // Create contact
        const contactId = await Contact.create(userId, recipientName, phoneValidation.normalizedNumber, 'Imported');

        results.validRows++;
        results.importedContacts.push({
          id: contactId,
          recipientName,
          phoneNumber: phoneValidation.normalizedNumber
        });

      } catch (error) {
        results.errors.push({
          row: rowNumber,
          error: `Processing error: ${error.message}`,
          data: row
        });
        results.invalidRows++;
      }
    }

    // Update import record with statistics
    await importRecord.updateStats(results.totalRows, results.validRows, results.invalidRows);

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

  /**
   * Generate preview of import data
   * @param {Array} rows - Array of row objects
   * @param {Object} columnMapping - Column mapping
   * @param {number} limit - Maximum number of preview rows
   * @returns {Array} - Preview data
   */
  generatePreview(rows, columnMapping, limit = 10) {
    const { nameColumn, phoneColumn } = columnMapping;
    const preview = [];

    for (let i = 0; i < Math.min(rows.length, limit); i++) {
      const row = rows[i];

      const recipientName = row[nameColumn]?.toString().trim() || '';
      const phoneNumber = row[phoneColumn]?.toString().trim() || '';

      const phoneValidation = this.validateAndNormalizePhone(phoneNumber);

      preview.push({
        rowNumber: i + 1,
        detectedName: recipientName,
        detectedNumber: phoneNumber,
        validationStatus: phoneValidation.isValid ? 'valid' : 'invalid',
        errorMessage: phoneValidation.error || null
      });
    }

    return preview;
  }
}

module.exports = new ContactImportService();