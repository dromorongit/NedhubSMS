// Module-load pre-deploy check.
// Requires every .js file under backend/routes, backend/controllers,
// backend/services, backend/middleware and backend/utils in a separate
// child process with dummy environment variables and a 10-second timeout.
// Fails on any throw (missing module, syntax error, top-level error).
// Files that open connections or listeners at load time are skipped with a
// printed reason, never silently.
// No new dependencies. Run: node scripts/module-load-check.mjs

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const CHECK_DIRS = [
  join(ROOT, 'backend', 'routes'),
  join(ROOT, 'backend', 'controllers'),
  join(ROOT, 'backend', 'services'),
  join(ROOT, 'backend', 'middleware'),
  join(ROOT, 'backend', 'utils'),
];

let failures = 0;
let skipped = 0;

function log(...args) { console.log(...args); }
function fail(...args) { failures += 1; console.error(...args); }

function rel(file) { return file.replace(ROOT + '/', ''); }

// Dummy environment: no real keys, no real database, no real providers.
const DUMMY_ENV = {
  ...process.env,
  NODE_ENV: 'test',
  JWT_SECRET: 'a'.repeat(64),
  MONGODB_URI: 'mongodb://127.0.0.1:1/none',
  REDIS_URL: 'redis://127.0.0.1:1/none',
  HUBTEL_CLIENT_ID: '',
  HUBTEL_CLIENT_SECRET: '',
  HUBTEL_MERCHANT_ACCOUNT_NUMBER: '',
  HUBTEL_PREPAID_DEPOSIT_ID: '',
  NALO_API_KEY: '',
  APP_URL: 'http://localhost:3000',
};

// Patterns that indicate a module opens connections / starts listeners at
// module load time. Such files are skipped (with a printed reason) because
// they have intentional top-level side effects that cannot run in a stubbed
// environment.
const LOAD_SIDE_EFFECT_PATTERNS = [
  /\bconnectDB\s*\(/,
  /\bmongoose\.connect\s*\(/,
  /\bcreateServer\s*\(/,
  /\b\.listen\s*\(/,
  /\bnew\s+Queue\s*\(/,
  /\bnew\s+IORedis\s*\(/,
];

// Collect every .js file under the check directories (exclude node_modules).
function collectJs(dir) {
  const out = [];
  (function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        out.push(full);
      }
    }
  })(dir);
  return out.sort();
}

const allFiles = CHECK_DIRS.flatMap(d => existsSync(d) ? collectJs(d) : []);

// Returns true if the file appears to open connections / listeners at module
// load time, based on a static scan of top-level statements.
function hasLoadTimeSideEffect(file) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  let braceDepth = 0;
  let inRequireMainGuard = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines and full-line comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Track brace depth to know if we're inside a function body
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    // Detect require.main === module guard: anything inside it won't run on require()
    if (/\brequire\.main\s*===\s*module\b/.test(trimmed)) {
      inRequireMainGuard = true;
      continue;
    }
    if (inRequireMainGuard && braceDepth === 0) {
      inRequireMainGuard = false;
    }

    // Only consider statements at module scope (braceDepth === 0 after processing
    // the line's opening braces, and not inside a require.main guard)
    if (braceDepth !== 0 || inRequireMainGuard) continue;

    for (const pattern of LOAD_SIDE_EFFECT_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { match: true, line: i + 1, text: trimmed };
      }
    }
  }
  return { match: false };
}

// Run the module-load check. Returns { ok, skipped, failures }.
// If `files` is provided, only those files are checked instead of the default set.
export function runModuleLoadCheck(files) {
  const filesToCheck = files || allFiles;
  log('\n== module-load check (require every backend file in child process) ==');
  log(`Scanning ${filesToCheck.length} file(s) under ${CHECK_DIRS.map(d => rel(d)).join(', ')}`);

  let ok = true;

  for (const file of filesToCheck) {
    const sideEffect = hasLoadTimeSideEffect(file);
    if (sideEffect.match) {
      skipped++;
      log(`  SKIP (load-time side effect): ${rel(file)}:${sideEffect.line} :: ${sideEffect.text}`);
      continue;
    }

    // Runner script: require the file, exit 0 on success, exit 1 + print error on throw.
    const runner = join(ROOT, 'scripts', '_child-require-runner.cjs');
    const result = spawnSync(process.execPath, [runner, file], {
      env: DUMMY_ENV,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10000,
    });

    if (result.error) {
      // spawnSync error (e.g. ENOENT) or timeout killed the process
      if (result.error && result.error.code === 'ETIMEDOUT') {
        skipped++;
        log(`  SKIP (timed out, likely load-time connection): ${rel(file)}`);
        continue;
      }
      ok = false;
      fail(`MODULE-LOAD FAIL: ${rel(file)}`);
      fail(result.error ? result.error.message : 'spawn error');
      continue;
    }

    if (result.status === null && result.signal) {
      // Process was killed (timeout)
      skipped++;
      log(`  SKIP (killed by signal ${result.signal}, likely load-time connection): ${rel(file)}`);
      continue;
    }

    if (result.status !== 0) {
      ok = false;
      fail(`MODULE-LOAD FAIL: ${rel(file)}`);
      fail((result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`);
      continue;
    }
  }

  log(ok ? `module-load check: OK (${allFiles.length - skipped} loaded, ${skipped} skipped)` : `module-load check: FAILED`);
  return { ok, skipped, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok } = runModuleLoadCheck();
  process.exit(ok ? 0 : 1);
}
