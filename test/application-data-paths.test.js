import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('persistent controller stores default to the application-local data directory', async () => {
  const previous = process.env.DATA_DIR;
  delete process.env.DATA_DIR;

  try {
    const token = Date.now();
    const store = await import(`../src/store.js?application-data-paths=${token}`);
    const queueStore = await import(`../src/queue-store.js?application-data-paths=${token}`);
    const materialStore = await import(`../src/file-material-store.js?application-data-paths=${token}`);
    const library = await import(`../src/print-library.js?application-data-paths=${token}`);
    const { EmulatorManager } = await import(`../src/emulator-manager.js?application-data-paths=${token}`);

    const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const dataDir = path.join(applicationRoot, 'data');

    assert.equal(store.controllerApplicationDir, applicationRoot);
    assert.equal(store.controllerDataDir, dataDir);
    assert.equal(store.printerStorePath, path.join(dataDir, 'printers.json'));
    assert.equal(queueStore.printQueueStorePath, path.join(dataDir, 'print-jobs.json'));
    assert.equal(materialStore.fileMaterialStorePath, path.join(dataDir, 'file-material-metadata.json'));
    assert.equal(library.printLibraryPath, path.join(dataDir, 'print-library'));

    const emulator = new EmulatorManager({
      emulator: {
        running:false,
        printers:new Map()
      }
    });
    assert.equal(emulator.settingsPath, path.join(dataDir, 'emulator-settings.json'));
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  }
});
