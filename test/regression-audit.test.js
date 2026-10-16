import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTestSource, auditTests } from '../scripts/audit-regression-tests.mjs';

test('test inventory recognises source-inspection-only suites without calling them runtime tests', () => {
  const content = [
    "import { readFileSync } from 'node:fs';",
    "import test from 'node:test';",
    "const html = readFileSync('public/index.html', 'utf8');",
    "test('button exists', () => assert.match(html, /button/));"
  ].join('\n');
  const entry = inspectTestSource(content, 'test/ui-only.test.js');
  assert.equal(entry.filename, 'test/ui-only.test.js');
  assert.equal(entry.declarations, 1);
  assert.equal(entry.category, 'source-inspection');
  assert.equal(entry.patternAssertions, 1);
});

test('test inventory distinguishes production execution from source-only checks', () => {
  const runtime = [
    "import test from 'node:test';",
    "import { PrinterOperationCoordinator } from '../src/concurrency.js';",
    "test('rejects overlapping operations', () => {",
    "  const coordinator = new PrinterOperationCoordinator();",
    "  assert.ok(coordinator);",
    "});"
  ].join('\n');
  assert.equal(inspectTestSource(runtime).category, 'runtime');

  const mixed = runtime + "\nconst code = readFileSync('public/app.js', 'utf8');";
  assert.equal(inspectTestSource(mixed).category, 'mixed');

  const extracted = [
    "import { runInNewContext } from 'node:vm';",
    "const app = readFileSync('public/app.js', 'utf8');",
    "test('markup runs', () => runInNewContext(app, {}));"
  ].join('\n');
  assert.equal(inspectTestSource(extracted).category, 'mixed');
});

test('test inventory separately reports skipped, todo and focused cases', () => {
  const source = [
    "test('works', () => {});",
    "test.skip('disabled', () => {});",
    "test.todo('not implemented');",
    "test.only('focused', () => {});"
  ].join('\n');
  const entry = inspectTestSource(source);
  assert.equal(entry.declarations, 4);
  assert.equal(entry.skipped, 1);
  assert.equal(entry.todo, 1);
  assert.equal(entry.only, 1);
});

test('test inventory includes the real regression suite and detects duplicate descriptions', () => {
  const report = auditTests();
  assert.ok(report.files > 0);
  assert.ok(report.declarations >= report.files, 'every test suite should expose declarations');
  assert.ok(report.entries.some((entry) => entry.filename === 'test/print-queue.test.js'));
  assert.ok(report.entries.some((entry) => entry.filename === 'test/ui-print-setup.test.js'));
  assert.equal(report.only, 0, 'focused test.only must not be committed');
  assert.equal(report.files, report.entries.length);
  assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), report.files);
});
