import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrinterGroupService } from '../src/printer-groups.js';

function printers() {
  return [
    { id:'p1', name:'Printer 1', adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' },
    { id:'p2', name:'Printer 2', adapterType:'snapmaker-u1', model:'U1' },
    { id:'p3', name:'Printer 3', adapterType:'snapmaker-u1', model:'U1' }
  ];
}

test('printer groups persist and a printer can belong to multiple groups', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-printer-groups-'));
  const now = new Date('2026-09-25T16:00:00Z');
  try {
    const service = new PrinterGroupService({
      dataDir:dir,
      listPrintersFn:async () => printers(),
      nowFn:() => now
    });
    await service.init();

    const first = await service.create({ name:'Production', printerIds:['p1','p2'] });
    const second = await service.create({ name:'Prototype', printerIds:['p2','p3'] });
    assert.deepEqual(first.printerIds, ['p1','p2']);
    assert.deepEqual(second.printerIds, ['p2','p3']);
    assert.deepEqual(service.groupsForPrinter('p2').map((group) => group.id), [first.id, second.id]);
    assert.equal(service.groupForPrinter('p2').id, first.id);
    assert.equal(service.isPrinterInGroup('p2', first.id), true);
    assert.equal(service.isPrinterInGroup('p2', second.id), true);

    await service.update(second.id, { printerIds:['p1','p2','p3'] });
    assert.deepEqual(service.get(first.id).printerIds, ['p1','p2']);
    assert.deepEqual(service.get(second.id).printerIds, ['p1','p2','p3']);
    assert.deepEqual(service.groupsForPrinter('p1').map((group) => group.id), [first.id, second.id]);

    const reloaded = new PrinterGroupService({
      dataDir:dir,
      listPrintersFn:async () => printers(),
      nowFn:() => now
    });
    await reloaded.init();
    assert.equal(reloaded.list().length, 2);
    assert.deepEqual(reloaded.get(first.id).printerIds, ['p1','p2']);
    assert.deepEqual(reloaded.get(second.id).printerIds, ['p1','p2','p3']);
    assert.equal(reloaded.groupsForPrinter('p2').length, 2);
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('printer groups validate names and configured members', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-printer-groups-validation-'));
  try {
    const service = new PrinterGroupService({ dataDir:dir, listPrintersFn:async () => printers() });
    await service.init();
    await service.create({ name:'Production', printerIds:['p1'] });
    await assert.rejects(() => service.create({ name:' production ' }), /already exists/i);
    await assert.rejects(() => service.create({ name:'Invalid', printerIds:['missing'] }), /no longer configured/i);
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('removing a printer clears only its group membership', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-printer-groups-remove-'));
  try {
    const service = new PrinterGroupService({ dataDir:dir, listPrintersFn:async () => printers() });
    await service.init();
    const group = await service.create({ name:'Production', printerIds:['p1','p2'] });
    assert.equal(await service.removePrinter('p1'), true);
    assert.deepEqual(service.get(group.id).printerIds, ['p2']);
    assert.equal(await service.removePrinter('missing'), false);
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});
