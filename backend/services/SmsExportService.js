const XLSX = require('xlsx');
const SmsRecipient = require('../models/SmsRecipient');
const ContactGroup = require('../models/ContactGroup');
const logger = require('../utils/logger');

class SmsExportService {
  /**
   * Export campaign recipients to CSV or Excel
   * @param {string} campaignId - Campaign ID
   * @param {string} userId - User ID for authorization
   * @param {string} format - 'csv' or 'excel'
   * @param {Object} filters - Additional filters
   * @returns {Buffer} File buffer
   */
  static async exportCampaignRecipients(campaignId, userId, format = 'csv', filters = {}, res) {
    try {
      // Build query with authorization
      const query = {
        campaignId,
        userId
      };

      // Apply filters
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.deliveryStatus) {
        query.providerStatus = filters.deliveryStatus;
      }

      if (format === 'excel') {
        const recipients = await SmsRecipient.find(query)
          .populate('groupIds', 'name')
          .sort({ createdAt: 1 })
          .lean();

        const exportData = recipients.map(recipient => ({
          'Recipient Name': recipient.recipientName || '',
          'Phone Number': recipient.phoneNumber || '',
          'Status': recipient.status || '',
          'Sent At': recipient.sentAt ? new Date(recipient.sentAt).toISOString() : '',
          'Delivered At': recipient.deliveredAt ? new Date(recipient.deliveredAt).toISOString() : '',
          'Error Message': recipient.errorMessage || '',
          'Personalized Message': recipient.personalizedMessage || '',
          'Segments': recipient.segments || 1,
          'Cost': recipient.actualCost || recipient.estimatedCost || 0,
          'Groups': recipient.groupIds ? recipient.groupIds.map(g => g.name).join(', ') : '',
          'Provider Status': recipient.providerStatus || '',
          'Retry Count': recipient.retryCount || 0
        }));

        return this.generateExcel(exportData);
      }

      const headers = [
        'Recipient Name', 'Phone Number', 'Status', 'Sent At', 'Delivered At',
        'Error Message', 'Personalized Message', 'Segments', 'Cost', 'Groups',
        'Provider Status', 'Retry Count'
      ];

      if (res) {
        res.write(headers.join(',') + '\n');
        const BATCH_SIZE = 500;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          try {
            const batch = await SmsRecipient.find(query)
              .populate('groupIds', 'name')
              .sort({ createdAt: 1 })
              .skip(offset)
              .limit(BATCH_SIZE)
              .lean();

            if (batch.length === 0) {
              hasMore = false;
              break;
            }

            for (const recipient of batch) {
              const row = [
                recipient.recipientName || '',
                recipient.phoneNumber || '',
                recipient.status || '',
                recipient.sentAt ? new Date(recipient.sentAt).toISOString() : '',
                recipient.deliveredAt ? new Date(recipient.deliveredAt).toISOString() : '',
                recipient.errorMessage || '',
                recipient.personalizedMessage || '',
                recipient.segments || 1,
                recipient.actualCost || recipient.estimatedCost || 0,
                recipient.groupIds ? recipient.groupIds.map(g => g.name).join(', ') : '',
                recipient.providerStatus || '',
                recipient.retryCount || 0
              ];
              const csvRow = row.map(value => {
                const stringValue = String(value);
                if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                  return '"' + stringValue.replace(/"/g, '""') + '"';
                }
                return stringValue;
              }).join(',');
              res.write(csvRow + '\n');
            }

            offset += BATCH_SIZE;
            if (batch.length < BATCH_SIZE) hasMore = false;
          } catch (streamError) {
            logger.error('[ExportStream] Error during CSV streaming', {
              campaignId,
              userId,
              error: streamError.message
            });
            res.destroy(streamError);
            return;
          }
        }

        res.end();
        return;
      }

      const recipients = await SmsRecipient.find(query)
        .populate('groupIds', 'name')
        .sort({ createdAt: 1 })
        .lean();

      const exportData = recipients.map(recipient => ({
        'Recipient Name': recipient.recipientName || '',
        'Phone Number': recipient.phoneNumber || '',
        'Status': recipient.status || '',
        'Sent At': recipient.sentAt ? new Date(recipient.sentAt).toISOString() : '',
        'Delivered At': recipient.deliveredAt ? new Date(recipient.deliveredAt).toISOString() : '',
        'Error Message': recipient.errorMessage || '',
        'Personalized Message': recipient.personalizedMessage || '',
        'Segments': recipient.segments || 1,
        'Cost': recipient.actualCost || recipient.estimatedCost || 0,
        'Groups': recipient.groupIds ? recipient.groupIds.map(g => g.name).join(', ') : '',
        'Provider Status': recipient.providerStatus || '',
        'Retry Count': recipient.retryCount || 0
      }));

      return this.generateCSV(exportData);
    } catch (error) {
      console.error('Export error:', error);
      throw new Error('Failed to export campaign recipients: ' + error.message);
    }
  }

  /**
   * Generate Excel file from data
   * @param {Array} data - Data array
   * @returns {Buffer} Excel file buffer
   */
  static generateExcel(data) {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Recipients');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
  }

  /**
   * Generate CSV string from data
   * @param {Array} data - Data array
   * @returns {string} CSV string
   */
  static generateCSV(data) {
    if (data.length === 0) {
      return 'No data available';
    }

    const headers = Object.keys(data[0]);
    const csvRows = [];

    // Add headers
    csvRows.push(headers.join(','));

    // Add data rows
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header] || '';
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return '"' + stringValue.replace(/"/g, '""') + '"';
        }
        return stringValue;
      });
      csvRows.push(values.join(','));
    });

    return csvRows.join('\n');
  }

  /**
   * Get content type for format
   * @param {string} format - File format
   * @returns {string} MIME type
   */
  static getContentType(format) {
    return format === 'excel'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';
  }

  /**
   * Get file extension for format
   * @param {string} format - File format
   * @returns {string} File extension
   */
  static getFileExtension(format) {
    return format === 'excel' ? 'xlsx' : 'csv';
  }

  /**
   * Generate filename for export
   * @param {string} campaignId - Campaign ID
   * @param {string} format - File format
   * @returns {string} Filename
   */
  static generateFilename(campaignId, format) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const extension = this.getFileExtension(format);
    return `campaign_${campaignId}_recipients_${timestamp}.${extension}`;
  }
}

module.exports = SmsExportService;