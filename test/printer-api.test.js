import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus } from '../src/printer-api.js';

test('normalizes FlashForge progress ratio into percent', () => {
  const status = normalizeStatus({
    status: 'printing',
    printProgress: 0.42,
    printLayer: 42,
    targetPrintLayer: 100,
    estimatedTime: 1800,
    printDuration: 900,
    rightTemp: 208.5,
    rightTargetTemp: 210,
    platTemp: 59,
    platTargetTemp: 60
  });
  assert.equal(status.progress, 42);
  assert.equal(status.remainingSeconds, 1800);
  assert.equal(status.elapsedSeconds, 900);
  assert.deepEqual(status.nozzle, { actual: 208.5, target: 210 });
});



test('normalizes FlashForge printer-reported filament type into toolhead status', () => {
  const status = normalizeStatus({
    status: 'ready',
    rightFilamentType: 'PETG',
    rightTemp: 24,
    rightTargetTemp: 0,
    platTemp: 23,
    platTargetTemp: 0
  });

  assert.equal(status.tools.length, 1);
  assert.equal(status.tools[0].index, 0);
  assert.equal(status.tools[0].filament.material, 'PETG');
  assert.equal(status.tools[0].filament.metadataAvailable, true);
  assert.equal(status.tools[0].filament.materialSource, 'printer');
  assert.equal(status.tools[0].filament.present, null);
});

test('treats empty FlashForge filament type as unknown without inventing presence', () => {
  const status = normalizeStatus({ rightFilamentType: 'NONE' });
  assert.equal(status.tools[0].filament.material, null);
  assert.equal(status.tools[0].filament.metadataAvailable, false);
  assert.equal(status.tools[0].filament.present, null);
});
test('accepts already-percent progress defensively', () => {
  assert.equal(normalizeStatus({ printProgress: 55 }).progress, 55);
});

test('orders printer files with recent print history first', async () => {
  const { orderFilesByRecent } = await import('../src/printer-api.js');
  const ordered = orderFilesByRecent(
    ['zebra.gcode', 'alpha.gcode', 'bracket 10.gcode', 'bracket 2.gcode', 'last-job.gcode'],
    ['last-job.gcode', 'bracket 2.gcode']
  );

  assert.deepEqual(ordered, [
    'last-job.gcode',
    'bracket 2.gcode',
    'alpha.gcode',
    'bracket 10.gcode',
    'zebra.gcode'
  ]);
});

test('recent ordering tolerates /data prefixes and case differences', async () => {
  const { orderFilesByRecent } = await import('../src/printer-api.js');
  assert.deepEqual(
    orderFilesByRecent(['Parts/Widget.gcode', 'other.gcode'], ['/data/parts/widget.GCODE']),
    ['Parts/Widget.gcode', 'other.gcode']
  );
});
