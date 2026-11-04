// Pre-deploy check for the NedhubSMS backend.
// Runs before every deploy:
//   1. `node --check` on every backend/ and server/ .js file (syntax).
//   2. Undefined-identifier check (eslint no-undef) on the backend/server files
//      changed since main (the same set as the audit). Skipped with a clear
//      message when there is no network (npx download).
//   3. Route-level smoke tests (tests/payment-routes-smoke.test.js) that mount
//      the real routers with stubs and exercise every changed handler end to end.
// Exits non-zero on any failure.
// No new dependencies; does not edit package.json or lockfiles.
// Run: node scripts/predeploy-check.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BACKEND = join(ROOT, 'backend');
const SERVER = join(ROOT, 'server');

let failures = 0;

function log(...args) { console.log(...args); }
function fail(...args) { failures += 1; console.error(...args); }

function rel(file) { return file.replace(ROOT + '/', ''); }

// Resolve the npx executable (Windows ships it as npx.cmd).
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
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

const allFiles = [...collectJs(BACKEND), ...collectJs(SERVER)].sort();
log(`Found ${allFiles.length} backend/server .js files.`);

// ---------------------------------------------------------------------------
// 1. Syntax check: node --check on every backend/server .js file, plus the
//    new smoke test and this script itself.
// ---------------------------------------------------------------------------
log('\n== node --check (syntax) ==');
const syntaxFiles = [...allFiles, join(ROOT, 'tests/payment-routes-smoke.test.js')];
let syntaxOk = true;
for (const file of syntaxFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    syntaxOk = false;
    fail(`SYNTAX FAIL: ${rel(file)}`);
    fail(err.stderr ? err.stderr.toString().trim() : err.message);
  }
}
log(syntaxOk ? `node --check: OK (${syntaxFiles.length} files)` : `node --check: FAILED`);

// ---------------------------------------------------------------------------
// 2. Undefined-identifier check: eslint no-undef on the files changed since
//    main (the audit set). Temporary npx download; no package.json change.
// ---------------------------------------------------------------------------
log('\n== eslint no-undef (changed files since main) ==');
let eslintRan = false;
let eslintOk = true;
let changedFiles = [];
try {
  const gitOut = execFileSync('git', ['diff', 'main', '--name-only', '--', 'backend', 'server'], {
    encoding: 'utf8', stdio: 'pipe'
  });
  changedFiles = gitOut.split(/\r?\n/).map(f => f.trim()).filter(Boolean).map(f => join(ROOT, f)).filter(f => existsSync(f));
} catch (err) {
  log(`git diff unavailable (${err.message}); skipping eslint check`);
}
if (changedFiles.length) {
  try {
    const cmd = [
      NPX, '--yes', 'eslint@8', '--no-eslintrc', '--env', 'node,es2021',
      '--parser-options', 'ecmaVersion:2021', '--rule', 'no-undef:error',
      ...changedFiles.map(f => `"${f}"`)
    ].join(' ');
    const result = spawnSync(cmd, { shell: true, encoding: 'utf8', stdio: 'pipe' });
    if (result.error) {
      eslintRan = false;
      log(`eslint no-undef: SKIPPED (could not run npx eslint: ${result.error.message})`);
    } else {
      eslintRan = true;
      if (result.stdout) log(result.stdout.trim());
      if (result.stderr && !result.stdout) log(result.stderr.trim());
      if (result.status !== 0) { eslintOk = false; fail(`eslint no-undef: FAILED (exit ${result.status})`); }
    }
  } catch (err) {
    eslintRan = false;
    log(`eslint no-undef: SKIPPED (could not run npx eslint: ${err.message})`);
  }
} else {
  log('eslint no-undef: SKIPPED (no backend/server files changed since main)');
}
if (eslintRan) log(eslintOk ? `eslint no-undef: OK (${changedFiles.length} changed file(s))` : `eslint no-undef: FAILED`);

// ---------------------------------------------------------------------------
// 3. Route-level smoke tests.
// ---------------------------------------------------------------------------
log('\n== smoke tests: tests/payment-routes-smoke.test.js ==');
const testResult = spawnSync(process.execPath, [
  '--test', join(ROOT, 'tests/payment-routes-smoke.test.js')
], { encoding: 'utf8', stdio: 'pipe' });
if (testResult.stdout) log(testResult.stdout.trim());
if (testResult.stderr) log(testResult.stderr.trim());
const smokeOk = testResult.status === 0;
log(smokeOk ? 'smoke tests: OK' : `smoke tests: FAILED (exit ${testResult.status})`);

// ---------------------------------------------------------------------------
const ok = syntaxOk && eslintOk && smokeOk;
log('\n== RESULT ==');
if (ok) {
  log('PRE-DEPLOY CHECK: ALL PASSED');
  process.exit(0);
} else {
  fail(`PRE-DEPLOY CHECK: FAILED (${failures} problem(s))`);
  process.exit(1);
}
