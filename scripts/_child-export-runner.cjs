// Child process runner for destructured-import check.
// Usage: node scripts/_child-export-runner.cjs <absolute-module-path>
// Requires the module, prints its exports as JSON to stdout, exits 0 on success,
// exits 1 and prints the error on throw.
'use strict';

const path = require('path');
const file = process.argv[2];
if (!file) {
  console.error('Usage: node _child-export-runner.cjs <file>');
  process.exit(2);
}

try {
  const mod = require(path.resolve(file));
  const exports = {};
  if (mod && typeof mod === 'object') {
    for (const key of Object.keys(mod)) {
      exports[key] = typeof mod[key];
    }
  }
  console.log(JSON.stringify(exports));
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
