import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmulator } from '../emulator/server.js';
import { getPrinterAdapter } from '../src/adapters/adapter-registry.js';
import { prepareFlashForgeAd5mConfig } from '../src/adapters/flashforge-ad5m-adapter.js';
import { prepareSnapmakerU1Config } from '../src/adapters/snapmaker-u1-adapter.js';
import { listAllFilesTcp } from '../src/tcp-files.js';

test('emulator management API creates and controls a virtual printer', async (t) => {
  const emulator = createEmulator({ managementPort: 0, withDefaults: false });
  const address = await emulator.start();
  t.after(() => emulator.stop());
  const base = `http://127.0.0.1:${address.port}`;

  const profiles = await fetch(`${base}/api/profiles`).then((response) => response.json());
  assert.deepEqual(profiles.profiles.map((profile) => profile.id).sort(), ['flashforge-ad5m-pro', 'snapmaker-u1']);

  const createdResponse = await fetch(`${base}/api/printers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'snapmaker-u1', name: 'Test U1', ports: { httpPort: 0 } })
  });
  assert.equal(createdResponse.status, 201);
  const { printer } = await createdResponse.json();
  assert.equal(printer.name, 'Test U1');
  assert.equal(printer.host, '127.0.0.1');
  assert.ok(printer.ports.httpPort > 0);

  const scenarioResponse = await fetch(`${base}/api/printers/${printer.id}/scenarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: 'cancel-retained-filename' })
  });
  const scenario = await scenarioResponse.json();
  assert.equal(scenario.printer.status, 'cancelled');
  assert.equal(scenario.printer.faults.stuckCancel, true);
  assert.ok(scenario.printer.fileName);
});

test('Snapmaker profile interoperates with the production adapter', async (t) => {
  const emulator = createEmulator({ managementPort: 0, withDefaults: false });
  await emulator.start();
  t.after(() => emulator.stop());
  const virtual = await emulator.addPrinter({ profileId: 'snapmaker-u1', name: 'Adapter Test U1', ports: { httpPort: 0 } });
  const config = prepareSnapmakerU1Config({
    name: virtual.name,
    host: virtual.host,
    httpPort: virtual.ports.httpPort,
    adapterType: 'snapmaker-u1'
  });
  const adapter = getPrinterAdapter(config);

  const initial = await adapter.getStatus();
  assert.equal(initial.status, 'idle');
  assert.equal(initial.tools.length, 4);
  assert.equal(initial.tools[0].filament.material, 'PLA');

  const files = await adapter.getFiles();
  assert.deepEqual(files.files, ['calibration-cube.gcode']);
  await adapter.printLocalFile('calibration-cube.gcode', { levelingBeforePrint: false });
  assert.equal((await adapter.getStatus()).status, 'printing');
  await adapter.setJobState('pause');
  assert.equal((await adapter.getStatus()).status, 'paused');
  await adapter.setJobState('resume');
  assert.equal((await adapter.getStatus()).status, 'printing');
  await adapter.setTemperatures({ bed: 60, nozzle: 210, toolIndex: 0 });
  const heated = await adapter.getStatus();
  assert.equal(heated.bed.target, 60);
  assert.equal(heated.tools[0].target, 210);
});

test('FlashForge profile interoperates with HTTP and TCP production clients', async (t) => {
  const emulator = createEmulator({ managementPort: 0, withDefaults: false });
  await emulator.start();
  t.after(() => emulator.stop());
  const virtual = await emulator.addPrinter({
    profileId: 'flashforge-ad5m-pro',
    name: 'Adapter Test AD5M',
    ports: { httpPort: 0, tcpPort: 0, cameraPort: 0 }
  });
  const config = prepareFlashForgeAd5mConfig({
    name: virtual.name,
    host: virtual.host,
    serialNumber: virtual.serialNumber,
    checkCode: virtual.checkCode,
    httpPort: virtual.ports.httpPort,
    tcpPort: virtual.ports.tcpPort,
    cameraPort: virtual.ports.cameraPort
  });
  const adapter = getPrinterAdapter(config);

  const initial = await adapter.getStatus();
  assert.equal(initial.status, 'ready');
  assert.equal(initial.tools[0].filament.material, 'PLA');
  const files = await listAllFilesTcp(config, { settleMs: 20 });
  assert.deepEqual(files, ['calibration-cube.gcode']);
  await adapter.printLocalFile('calibration-cube.gcode', false);
  assert.equal((await adapter.getStatus()).status, 'printing');
  await adapter.setJobState('cancel');
  assert.equal((await adapter.getStatus()).status, 'cancelled');
});

test('FlashForge port configuration validates emulator overrides', () => {
  assert.throws(() => prepareFlashForgeAd5mConfig({
    name: 'Invalid', host: '127.0.0.1', serialNumber: 'SIM', checkCode: 'SIM', httpPort: 70000
  }), /HTTP port must be 1-65535/);
});
