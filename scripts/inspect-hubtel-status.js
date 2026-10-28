#!/usr/bin/env node
'use strict';

/*
 * scripts/inspect-hubtel-status.js
 *
 * Read-only operational script for the repository owner. Intended to be run on
 * Railway (never by automated tooling) to capture a REAL Hubtel response shape
 * for one transaction, so the assumed status words and amount field can be
 * verified against reality.
 *
 * Usage:
 *   node scripts/inspect-hubtel-status.js <clientReference> <type>
 *     type: payment | transfer | commission
 *
 * It makes exactly ONE GET to the provider status endpoint (the same endpoint
 * the service's checkTransactionStatus method uses), then prints only:
 *   - the HTTP status
 *   - the list of response keys (nested up to 2 levels)
 *   - the value of every field whose name contains status, code, amount,
 *     charge or fee
 *   - what our mapper decides (paid / failed / pending / success)
 *
 * It never prints names, phone numbers, emails or secrets, and redacts any
 * value longer than 40 characters. It refuses to run with more than one
 * reference. It performs no writes and never touches a database.
 */

const HubtelPaymentService = require('../backend/services/HubtelPaymentService');
const hubtelTransferService = require('../backend/services/HubtelTransferService');
const hubtelCommissionService = require('../backend/services/HubtelCommissionService');

const TYPES = ['payment', 'transfer', 'commission'];
const REDACT_LEN = 40;
const INTERESTING = /(status|code|amount|charge|fee)/i;
const SECRETISH = /(secret|token|password|apikey|api.key|signature)/i;

const SERVICES = {
  payment: new HubtelPaymentService(),
  transfer: hubtelTransferService,
  commission: hubtelCommissionService
};

const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: node scripts/inspect-hubtel-status.js <clientReference> <type>');
  console.error('  type: payment | transfer | commission');
  console.error('Refusing to run: provide exactly one clientReference and one type.');
  process.exit(1);
}

const [clientReference, type] = args;
if (!clientReference || typeof clientReference !== 'string') {
  console.error('Error: a clientReference is required.');
  process.exit(1);
}
if (!TYPES.includes(type)) {
  console.error(`Error: unknown type '${type}'. Expected one of: ${TYPES.join(', ')}.`);
  process.exit(1);
}

const service = SERVICES[type];

/*
 * Capture the raw provider response + HTTP status by observing the single GET
 * that checkTransactionStatus makes through this.httpClient.get. No second
 * request is made and nothing is written.
 */
let captured = null;
const origGet = service.httpClient.get.bind(service.httpClient);
service.httpClient.get = async (url, config) => {
  const response = await origGet(url, config);
  captured = { httpStatus: response.status, data: response.data };
  return response;
};

function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > REDACT_LEN ? `<redacted: ${value.length} chars>` : value;
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > REDACT_LEN ? `<redacted: ${json.length} chars>` : json;
  }
  return value;
}

function collectKeys(data, depth, prefix, out) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || depth > 2) return;
  for (const key of Object.keys(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    const child = data[key];
    if (child && typeof child === 'object' && !Array.isArray(child) && depth < 2) {
      collectKeys(child, depth + 1, path, out);
    }
  }
}

function printInteresting(data, prefix) {
  if (!data || typeof data !== 'object') return;
  for (const key of Object.keys(data)) {
    if (SECRETISH.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const value = data[key];
    if (INTERESTING.test(key)) {
      console.log(`  ${path}: ${redact(value)}`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      printInteresting(value, path);
    }
  }
}

(async () => {
  let result;
  try {
    result = await service.checkTransactionStatus(clientReference);
  } catch (err) {
    const httpStatus = (captured && captured.httpStatus)
      || (err && err.response && err.response.status)
      || 'unknown';
    console.log(`HTTP status: ${httpStatus}`);
    if (captured && captured.data) {
      console.log('Response keys:');
      const keys = [];
      collectKeys(captured.data, 1, '', keys);
      console.log(`  ${keys.join(', ') || '(none)'}`);
      console.log('Interesting fields:');
      printInteresting(captured.data);
    }
    console.log('Mapper decision: undetermined (provider call failed)');
    console.log(`Provider error: ${redact(err && err.message ? err.message : String(err))}`);
    process.exit(1);
  }

  console.log(`HTTP status: ${captured ? captured.httpStatus : 'unknown'}`);
  if (captured && captured.data) {
    console.log('Response keys:');
    const keys = [];
    collectKeys(captured.data, 1, '', keys);
    console.log(`  ${keys.join(', ') || '(none)'}`);
    console.log('Interesting fields:');
    printInteresting(captured.data);
  }
  console.log(`Mapper decision: ${result.status}`);
})();
