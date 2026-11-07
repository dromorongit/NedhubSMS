// Fixture test for the predeploy checks.
// Creates temporary files with (1) a missing export and (2) a missing module,
// proves both checks fail on them, then cleans up.
// Runs with: node --test tests/predeploy-checks-fixture.test.js

import { describe, it } from 'node:test';
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { runModuleLoadCheck } from '../scripts/module-load-check.mjs';
import { runDestructuredImportCheck } from '../scripts/destructured-import-check.mjs';

const ROOT = process.cwd();
const TMPDIR = join(ROOT, 'tests', '_fixture_tmp');

describe('predeploy checks fixture tests', () => {
  it('module-load check fails on a file with a missing required module', async () => {
    mkdirSync(TMPDIR, { recursive: true });

    // File that requires a module that does not exist.
    const badFile = join(TMPDIR, 'missing-module.js');
    writeFileSync(badFile, "require('./does-not-exist-module');\n");

    try {
      const result = runModuleLoadCheck([badFile]);
      // The check should report failure (missing module throws at load time).
      if (result.ok) {
        throw new Error('Expected module-load check to fail on missing module, but it passed');
      }
    } finally {
      unlinkSync(badFile);
      rmdirSync(TMPDIR);
    }
  });

  it('destructured-import check fails on a missing export', async () => {
    mkdirSync(TMPDIR, { recursive: true });

    // Module that only exports `foo` (not `bar`).
    const provider = join(TMPDIR, 'provider.js');
    writeFileSync(provider, "module.exports = { foo: 1 };\n");

    // Importer that destructures `bar` (which is not exported).
    const importer = join(TMPDIR, 'importer.js');
    writeFileSync(importer, "const { bar } = require('./provider');\n");

    try {
      const result = runDestructuredImportCheck([importer]);
      // The check should report failure (bar is not exported by provider).
      if (result.ok) {
        throw new Error('Expected destructured-import check to fail on missing export, but it passed');
      }
    } finally {
      unlinkSync(provider);
      unlinkSync(importer);
      rmdirSync(TMPDIR);
    }
  });

  it('module-load check passes on a clean file', async () => {
    mkdirSync(TMPDIR, { recursive: true });

    // Clean module with no side effects.
    const cleanFile = join(TMPDIR, 'clean.js');
    writeFileSync(cleanFile, "module.exports = { hello: 'world' };\n");

    try {
      const result = runModuleLoadCheck([cleanFile]);
      if (!result.ok) {
        throw new Error('Expected module-load check to pass on clean file, but it failed');
      }
    } finally {
      unlinkSync(cleanFile);
      rmdirSync(TMPDIR);
    }
  });

  it('destructured-import check passes when all names are exported', async () => {
    mkdirSync(TMPDIR, { recursive: true });

    // Module that exports `foo`.
    const provider = join(TMPDIR, 'provider-ok.js');
    writeFileSync(provider, "module.exports = { foo: 1 };\n");

    // Importer that destructures `foo` (which is exported).
    const importer = join(TMPDIR, 'importer-ok.js');
    writeFileSync(importer, "const { foo } = require('./provider-ok');\n");

    try {
      const result = runDestructuredImportCheck([importer]);
      if (!result.ok) {
        throw new Error('Expected destructured-import check to pass when all names are exported, but it failed');
      }
    } finally {
      unlinkSync(provider);
      unlinkSync(importer);
      rmdirSync(TMPDIR);
    }
  });
});
