import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('concurrent file-material metadata saves preserve every entry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pfc-file-material-store-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/file-material-store.js?concurrent=${Date.now()}`);

  try {
    await Promise.all([
      store.savePrinterFileMaterialMetadata('p1', 'first.gcode', {
        metadataAvailable:true,
        requiredMaterial:'PLA',
        materials:['PLA'],
        source:'filament_type'
      }),
      store.savePrinterFileMaterialMetadata('p1', 'second.gcode', {
        metadataAvailable:true,
        requiredMaterial:'PETG',
        materials:['PETG'],
        source:'filament_type'
      })
    ]);

    const first = await store.getPrinterFileMaterialMetadata('p1', 'first.gcode');
    const second = await store.getPrinterFileMaterialMetadata('p1', 'second.gcode');
    assert.equal(first.requiredMaterial, 'PLA');
    assert.equal(second.requiredMaterial, 'PETG');
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});
