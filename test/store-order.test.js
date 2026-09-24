import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('dashboard order persists and new printers append after a custom order', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ff-fleet-order-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/store.js?order-test=${Date.now()}`);

  try {
    const a = await store.addPrinter({ name:'Zulu', host:'10.0.0.1', serialNumber:'A', checkCode:'1' });
    const b = await store.addPrinter({ name:'Alpha', host:'10.0.0.2', serialNumber:'B', checkCode:'2' });
    assert.equal(store.publicPrinter(a).dashboardOrder, null);
    assert.equal(store.publicPrinter(b).dashboardOrder, null);

    await store.reorderPrinters([b.id, a.id]);
    const ordered = await store.listPrinters();
    assert.equal(ordered.find((p) => p.id === b.id).dashboardOrder, 0);
    assert.equal(ordered.find((p) => p.id === a.id).dashboardOrder, 1);

    const c = await store.addPrinter({ name:'New', host:'10.0.0.3', serialNumber:'C', checkCode:'3' });
    assert.equal(c.dashboardOrder, 2);
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});

test('dashboard order rejects incomplete lists', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ff-fleet-order-invalid-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/store.js?order-invalid-test=${Date.now()}`);

  try {
    const a = await store.addPrinter({ name:'One', host:'10.0.1.1', serialNumber:'A', checkCode:'1' });
    await store.addPrinter({ name:'Two', host:'10.0.1.2', serialNumber:'B', checkCode:'2' });
    await assert.rejects(() => store.reorderPrinters([a.id]), /every configured printer exactly once/);
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});

test('legacy stored FlashForge printers are hydrated with adapter metadata without re-adding them', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ff-fleet-adapter-migration-'));
  process.env.DATA_DIR = dir;
  const legacy = [{
    id:'legacy-1', name:'Legacy Pro', host:'10.0.2.1', serialNumber:'SN', checkCode:'CODE',
    httpPort:8898, tcpPort:8899, cameraPort:8080, createdAt:'2026-01-01T00:00:00.000Z'
  }];
  await writeFile(path.join(dir, 'printers.json'), JSON.stringify(legacy));
  const store = await import(`../src/store.js?adapter-migration-test=${Date.now()}`);

  try {
    const [printer] = await store.listPrinters();
    assert.equal(printer.adapterType, 'flashforge-ad5m');
    assert.equal(printer.manufacturer, 'FlashForge');
    assert.equal(printer.model, 'Adventurer 5M Pro');
    assert.equal(store.publicPrinter(printer).adapterType, 'flashforge-ad5m');
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});

test('FlashForge manual material designation persists without exposing adapter secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ff-fleet-material-designation-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/store.js?material-designation-test=${Date.now()}`);

  try {
    const printer = await store.addPrinter({
      name:'Material Test', host:'10.0.3.1', serialNumber:'SN', checkCode:'CODE',
      adapterConfig:{ secretValue:'keep-private' }
    });
    const assigned = await store.setPrinterMaterialDesignation(printer.id, 'PETG-CF', '#12ab34');
    assert.equal(assigned.adapterConfig.filamentDesignation, 'PETG-CF');
    assert.equal(assigned.adapterConfig.filamentColorDesignation, '#12AB34');
    assert.equal(assigned.adapterConfig.filamentColorFamilyDesignation, 'green');
    assert.equal(assigned.adapterConfig.secretValue, 'keep-private');
    assert.equal(store.publicPrinter(assigned).materialDesignation, 'PETG-CF');
    assert.equal(store.publicPrinter(assigned).materialColorDesignation, '#12AB34');
    assert.equal(store.publicPrinter(assigned).materialColorFamilyDesignation, 'green');
    assert.equal('adapterConfig' in store.publicPrinter(assigned), false);
    await assert.rejects(() => store.setPrinterMaterialDesignation(printer.id, 'PETG-CF', 'green'), /6-digit hex colour/);

    const familyOnly = await store.setPrinterMaterialDesignation(printer.id, 'PETG-CF', null, 'red');
    assert.equal(familyOnly.adapterConfig.filamentColorDesignation, undefined);
    assert.equal(familyOnly.adapterConfig.filamentColorFamilyDesignation, 'red');
    assert.equal(store.publicPrinter(familyOnly).materialColorFamilyDesignation, 'red');

    await assert.rejects(
      () => store.setPrinterMaterialDesignation(printer.id, 'PETG-CF', '#0000FF', 'red'),
      /shade must belong to the selected colour family/
    );
    await assert.rejects(
      () => store.setPrinterMaterialDesignation(printer.id, 'PETG-CF', null, 'chartreuse'),
      /colour family is not supported/
    );

    const cleared = await store.setPrinterMaterialDesignation(printer.id, null, null);
    assert.equal(cleared.adapterConfig.filamentDesignation, undefined);
    assert.equal(cleared.adapterConfig.filamentColorDesignation, undefined);
    assert.equal(cleared.adapterConfig.filamentColorFamilyDesignation, undefined);
    assert.equal(cleared.adapterConfig.secretValue, 'keep-private');
    assert.equal(store.publicPrinter(cleared).materialDesignation, null);
    assert.equal(store.publicPrinter(cleared).materialColorDesignation, null);
    assert.equal(store.publicPrinter(cleared).materialColorFamilyDesignation, null);
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});

test('FlashForge controller nozzle designation persists without exposing adapter secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ff-fleet-nozzle-designation-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/store.js?nozzle-designation-test=${Date.now()}`);

  try {
    const printer = await store.addPrinter({
      name:'Nozzle Test', host:'10.0.3.2', serialNumber:'SN', checkCode:'CODE',
      adapterConfig:{ secretValue:'keep-private' }
    });
    const assigned = await store.setPrinterNozzleDesignation(printer.id, 0.6);
    assert.equal(assigned.adapterConfig.nozzleDiameterDesignation, 0.6);
    assert.equal(assigned.adapterConfig.secretValue, 'keep-private');
    assert.equal(store.publicPrinter(assigned).nozzleDiameterDesignation, 0.6);
    assert.equal('adapterConfig' in store.publicPrinter(assigned), false);
    await assert.rejects(() => store.setPrinterNozzleDesignation(printer.id, 2), /between 0.1 and 1.2 mm/);

    const cleared = await store.setPrinterNozzleDesignation(printer.id, null);
    assert.equal(cleared.adapterConfig.nozzleDiameterDesignation, undefined);
    assert.equal(cleared.adapterConfig.secretValue, 'keep-private');
    assert.equal(store.publicPrinter(cleared).nozzleDiameterDesignation, null);
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});

test('Bambu connection ports persist without exposing the LAN access code', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pfc-bambu-store-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/store.js?bambu-store-test=${Date.now()}`);

  try {
    const stored = await store.addPrinter({
      name:'Bambu P1S', adapterType:'bambu-lab', manufacturer:'Bambu Lab', model:'P1S',
      host:'127.0.0.1', serialNumber:'01S00SIM000001', checkCode:'secret-code',
      mqttPort:18893, ftpsPort:20000, cameraPort:16010,
      adapterConfig:{ mqttPort:18893, ftpsPort:20000, cameraPort:16010, experimental:true }
    });
    const publicValue = store.publicPrinter(stored);
    assert.equal(publicValue.mqttPort, 18893);
    assert.equal(publicValue.ftpsPort, 20000);
    assert.equal(publicValue.cameraPort, 16010);
    assert.equal('checkCode' in publicValue, false);
    assert.equal('adapterConfig' in publicValue, false);
    const [reloaded] = await store.listPrinters();
    assert.equal(reloaded.checkCode, 'secret-code');
    assert.equal(reloaded.mqttPort, 18893);
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});

test('default controller data directory is the application-local data folder', async () => {
  const previous = process.env.DATA_DIR;
  delete process.env.DATA_DIR;

  try {
    const store = await import(`../src/store.js?application-local-data-test=${Date.now()}`);
    const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const expectedDataDir = path.join(applicationRoot, 'data');

    assert.equal(store.controllerApplicationDir, applicationRoot);
    assert.equal(store.controllerDataDir, expectedDataDir);
    assert.equal(store.printerStorePath, path.join(expectedDataDir, 'printers.json'));
    assert.ok(store.legacyControllerDataDirs.length >= 1);
    assert.ok(store.legacyControllerDataDirs.every((candidate) => path.resolve(candidate) !== expectedDataDir));
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  }
});

test('printer controller name can be renamed without changing connection identity', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ff-fleet-rename-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/store.js?rename-test=${Date.now()}`);

  try {
    const printer = await store.addPrinter({
      name:'Original Name', host:'10.0.4.1', serialNumber:'SERIAL-1', checkCode:'CODE-1',
      adapterConfig:{ apiKey:'private' }
    });
    const renamed = await store.renamePrinter(printer.id, 'Workshop U1');
    assert.equal(renamed.name, 'Workshop U1');
    assert.equal(renamed.host, '10.0.4.1');
    assert.equal(renamed.serialNumber, 'SERIAL-1');
    assert.equal(renamed.checkCode, 'CODE-1');
    assert.equal(renamed.adapterConfig.apiKey, 'private');
    assert.equal(store.publicPrinter(renamed).name, 'Workshop U1');
    await assert.rejects(() => store.renamePrinter(printer.id, '   '), /Printer name is required/);
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});


test('concurrent printer registry mutations preserve both changes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pfc-concurrent-store-'));
  process.env.DATA_DIR = dir;
  const store = await import(`../src/store.js?concurrent-store-test=${Date.now()}`);

  try {
    const printer = await store.addPrinter({
      name:'Concurrent Test',
      host:'10.0.5.1',
      serialNumber:'SERIAL-C',
      checkCode:'CODE-C'
    });

    await Promise.all([
      store.setPrinterMaterialDesignation(printer.id, 'PETG', '#112233'),
      store.setPrinterNozzleDesignation(printer.id, 0.6)
    ]);

    const reloaded = await store.getPrinter(printer.id);
    assert.equal(reloaded.adapterConfig.filamentDesignation, 'PETG');
    assert.equal(reloaded.adapterConfig.filamentColorDesignation, '#112233');
    assert.equal(reloaded.adapterConfig.nozzleDiameterDesignation, 0.6);
  } finally {
    delete process.env.DATA_DIR;
    await rm(dir, { recursive:true, force:true });
  }
});
