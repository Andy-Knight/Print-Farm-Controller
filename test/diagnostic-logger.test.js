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

test('diagnostic logger writes normal entries and gates debug entries behind verbose mode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-diagnostics-'));
  try {
    const logger = new DiagnosticLogger({ logDir:dir, version:'test' });
    await logger.init();
    await logger.debug('test', 'hidden debug');
    await logger.info('test', 'normal info', { password:'secret', printerId:'p1' });
    let entries = await logger.recent({ limit:50 });
    assert.ok(entries.some((entry) => entry.message === 'normal info'));
    assert.ok(!entries.some((entry) => entry.message === 'hidden debug'));
    const normal = entries.find((entry) => entry.message === 'normal info');
    assert.equal(normal.meta.password, '[REDACTED]');

    await logger.setVerbose(true, 30);
    await logger.debug('test', 'visible debug', { accessCode:'1234' });
    entries = await logger.recent({ limit:50, level:'DEBUG' });
    assert.ok(entries.some((entry) => entry.message === 'visible debug'));
    assert.equal(entries.find((entry) => entry.message === 'visible debug').meta.accessCode, '[REDACTED]');
    assert.equal(logger.status().verbose, true);
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
