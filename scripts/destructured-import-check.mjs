// Destructured-import pre-deploy check.
// Statically finds every `const { a, b } = require('./relative/path')` and
// every `require('./relative/path').name` across backend and server, resolves
// each path, loads the module in the dummy-env child process, and fails if any
// imported name is not exported or is not defined.
// Prints file:line, the name, and the module for every failure.
// No new dependencies. Run: node scripts/destructured-import-check.mjs

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const CHECK_DIRS = [join(ROOT, 'backend'), join(ROOT, 'server')];

let failures = 0;

function log(...args) { console.log(...args); }
function fail(...args) { failures += 1; console.error(...args); }

function rel(file) { return file.replace(ROOT + '/', ''); }

// Dummy environment for loading modules.
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

// Apply dummy env so modules load without real keys.
Object.assign(process.env, DUMMY_ENV);

// Pattern 1: const { a, b, ... } = require('./relative/path')
const DESTRUCTURE_RE = /(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*require\s*\(\s*['"](\.\/+[^'"]+)['"]\s*\)/g;
// Pattern 2: require('./relative/path').name
const PROPERTY_RE = /require\s*\(\s*['"](\.\/+[^'"]+)['"]\s*\)\s*\.\s*(\w+)/g;

// Cache of loaded module exports: resolved absolute path -> exports object.
const moduleExportCache = new Map();

function collectJs(dir) {
  const out = [];
  (function walk(d) {
    for (const entry of readDirWithTypes(d)) {
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

function readDirWithTypes(d) {
  try {
    return readdirSync(d, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

const allFiles = CHECK_DIRS.flatMap(d => existsSync(d) ? collectJs(d) : []);

// Load a module and return its exports, caching by resolved path.
function getModuleExports(requirePath, fromFile) {
  let resolved;
  try {
    resolved = resolve(dirname(fromFile), requirePath);
    // Try .js extension if not present
    if (!existsSync(resolved) && !existsSync(resolved + '.js')) {
      return { ok: false, error: `cannot resolve ${requirePath} from ${rel(fromFile)}` };
    }
    if (!existsSync(resolved)) resolved = resolved + '.js';
  } catch (err) {
    return { ok: false, error: `cannot resolve ${requirePath} from ${rel(fromFile)}: ${err.message}` };
  }

  if (moduleExportCache.has(resolved)) {
    return { ok: true, exports: moduleExportCache.get(resolved) };
  }

  let exports;
  try {
    // Use a child process with dummy env to load the module and dump its exports.
    const runner = join(ROOT, 'scripts', '_child-export-runner.cjs');
    const result = spawnSync(process.execPath, [runner, resolved], {
      env: DUMMY_ENV,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10000,
    });

    if (result.error || result.status !== 0) {
      const msg = result.error ? result.error.message :
        (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
      return { ok: false, error: `cannot load ${requirePath}: ${msg}` };
    }

    exports = JSON.parse(result.stdout);
  } catch (err) {
    return { ok: false, error: `cannot load ${requirePath}: ${err.message}` };
  }

  moduleExportCache.set(resolved, exports);
  return { ok: true, exports };
}

// Split a destructured binding list into individual names, ignoring commas,
// `as` aliases, and rest elements.
function splitBindings(bindingList) {
  return bindingList
    .split(',')
    .map(b => b.trim())
    .filter(b => b.length > 0)
    .map(b => {
      // Handle `a as b` -> the imported name is `a`, local is `b`
      const asMatch = b.match(/^(\w+)\s+as\s+\w+$/);
      if (asMatch) return asMatch[1];
      // Handle `...rest` -> rest is not a named import
      if (b.startsWith('...')) return null;
      // Plain name: `a` or `a: localAlias` -> imported name is before colon
      const colonMatch = b.match(/^(\w+):/);
      if (colonMatch) return colonMatch[1];
      return b;
    })
    .filter(b => b !== null);
}

export function runDestructuredImportCheck(files) {
  const filesToCheck = files || allFiles;
  log('\n== destructured-import check (verify every required name is exported) ==');
  log(`Scanning ${filesToCheck.length} file(s) under backend/ and server/`);

  let ok = true;
  let importCount = 0;

  for (const file of filesToCheck) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }

    // Pattern 1: const { a, b } = require('./path')
    let match;
    const re1 = new RegExp(DESTRUCTURE_RE.source, 'g');
    while ((match = re1.exec(content)) !== null) {
      const bindingList = match[1];
      const requirePath = match[2];
      // Find the line number
      const lineNo = content.substring(0, match.index).split('\n').length;
      const names = splitBindings(bindingList);

      importCount += names.length;

      const mod = getModuleExports(requirePath, file);
      if (!mod.ok) {
        ok = false;
        fail(`IMPORT FAIL: ${rel(file)}:${lineNo}`);
        fail(`  require path: ${requirePath}`);
        fail(`  error: ${mod.error}`);
        continue;
      }

      const exports = mod.exports || {};
      for (const name of names) {
        if (!(name in exports)) {
          ok = false;
          fail(`MISSING EXPORT: ${rel(file)}:${lineNo}`);
          fail(`  name: ${name}`);
          fail(`  module: ${requirePath} (resolved: ${resolve(dirname(file), requirePath)}.js)`);
          fail(`  exported keys: ${Object.keys(exports).join(', ') || '(none)'}`);
        }
      }
    }

    // Pattern 2: require('./path').name
    const re2 = new RegExp(PROPERTY_RE.source, 'g');
    while ((match = re2.exec(content)) !== null) {
      const requirePath = match[1];
      const propName = match[2];
      const lineNo = content.substring(0, match.index).split('\n').length;

      importCount += 1;

      const mod = getModuleExports(requirePath, file);
      if (!mod.ok) {
        ok = false;
        fail(`IMPORT FAIL: ${rel(file)}:${lineNo}`);
        fail(`  require path: ${requirePath}`);
        fail(`  error: ${mod.error}`);
        continue;
      }

      const exports = mod.exports || {};
      if (!(propName in exports)) {
        ok = false;
        fail(`MISSING EXPORT: ${rel(file)}:${lineNo}`);
        fail(`  name: ${propName}`);
        fail(`  module: ${requirePath} (resolved: ${resolve(dirname(file), requirePath)}.js)`);
        fail(`  exported keys: ${Object.keys(exports).join(', ') || '(none)'}`);
      }
    }
  }

  log(ok ? `destructured-import check: OK (${importCount} import(s) verified)` : `destructured-import check: FAILED`);
  return { ok, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok } = runDestructuredImportCheck();
  process.exit(ok ? 0 : 1);
}
