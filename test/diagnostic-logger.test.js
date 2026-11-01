import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiagnosticLogger, createStoredZip, redactDiagnosticText, redactDiagnosticValue } from '../src/diagnostic-logger.js';

test('diagnostic redaction removes credential values but preserves useful context', () => {
  assert.equal(redactDiagnosticText('password=hunter2 host=192.168.1.10'), 'password=[REDACTED] host=192.168.1.10');
  const value = redactDiagnosticValue({
    host:'192.168.1.10',
    accessCode:'12345678',
    nested:{ apiKey:'abc', model:'P1S' },
    filePath:'C:/prints/private-part.3mf'
  });
  assert.equal(value.host, '192.168.1.10');
  assert.equal(value.accessCode, '[REDACTED]');
  assert.equal(value.nested.apiKey, '[REDACTED]');
  assert.equal(value.nested.model, 'P1S');
  assert.equal(value.filePath, 'private-part.3mf');
});

test('diagnostic logger records operation starts and results without temporary configuration', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-diagnostics-'));
  try {
    const logger = new DiagnosticLogger({ logDir:dir, version:'test' });
    await logger.init();
    await logger.info('printer-operation', 'Starting printer operation', { printerId:'p1', label:'print start', password:'secret' });
    await logger.info('printer-operation', 'Printer operation completed', { printerId:'p1' });
    await logger.warn('printer-operation', 'Printer operation failed or was blocked', { printerId:'p2' });
    const entries = await logger.recent({ limit:50, level:'INFO', search:'printer-operation' });
    assert.deepEqual(entries.map((entry) => entry.message), ['Starting printer operation', 'Printer operation completed']);
    assert.equal(entries[0].meta.password, '[REDACTED]');
    assert.equal((await logger.recent({ level:'WARN' })).length, 1);
    assert.equal(logger.status().level, 'info');
    assert.ok(!('verbose' in logger.status()));
    assert.ok(!('verboseUntil' in logger.status()));
    const bundle = await logger.createBundle();
    assert.ok(bundle.includes(Buffer.from('Log level: INFO')));
    assert.ok(bundle.includes(Buffer.from('Starting printer operation')));
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('diagnostic bundle writer creates a ZIP container', () => {
  const zip = createStoredZip([
    { name:'diagnostic-summary.txt', data:'hello' },
    { name:'system.json', data:'{}' }
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.ok(zip.includes(Buffer.from('diagnostic-summary.txt')));
  assert.ok(zip.includes(Buffer.from('system.json')));
});
