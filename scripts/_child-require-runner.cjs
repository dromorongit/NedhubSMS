// Child process runner for module-load check.
// Usage: node scripts/_child-require-runner.cjs <absolute-file-path>
// Requires the file, exits 0 on success, exits 1 and prints the error on throw.
'use strict';

const path = require('path');
const file = process.argv[2];
if (!file) {
  console.error('Usage: node _child-require-runner.cjs <file>');
  process.exit(2);
}

try {
  require(path.resolve(file));
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
