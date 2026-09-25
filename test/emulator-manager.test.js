import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { EmulatorManager } from '../src/emulator-manager.js';

test('integrated emulator enablement persists and controls protocol lifecycle', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-emulator-manager-'));
  const settingsPath = path.join(directory, 'emulator-settings.json');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const first = new EmulatorManager({ settingsPath, withDefaults: false });
  assert.equal((await first.init()).running, false);
  assert.equal((await first.setEnabled(true)).running, true);
  await first.stop();

  const second = new EmulatorManager({ settingsPath, withDefaults: false });
  assert.equal((await second.init()).running, true);
  assert.equal((await second.setEnabled(false)).running, false);
  await second.stop();
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')), { enabled:false, printers:[] });
});

test('integrated emulator exposes management API and UI under controller paths', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-emulator-routes-'));
  const manager = new EmulatorManager({ settingsPath: path.join(directory, 'settings.json'), withDefaults: false });
  await manager.setEnabled(true);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/emulator')) await manager.handleApi(request, response, url);
    else await manager.serveStatic(response, url);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await manager.stop();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const status = await fetch(`${base}/api/emulator/status`).then((response) => response.json());
  assert.equal(status.running, true);
  assert.equal(status.loopbackOnly, true);
  const profiles = await fetch(`${base}/api/emulator/profiles`).then((response) => response.json());
  assert.ok(profiles.profiles.some((profile) => profile.id === 'bambu-x1c'));
  assert.ok(profiles.profiles.some((profile) => profile.id === 'bambu-a1-mini'));
  const app = await fetch(`${base}/simulator/app.js`).then((response) => response.text());
  assert.match(app, /\/api\/emulator/);
});


test('Creator 5 virtual printer settings are recognised as simulated controller devices', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-emulator-creator5-detect-'));
  const manager = new EmulatorManager({ settingsPath:path.join(directory, 'settings.json'), withDefaults:false });
  await manager.setEnabled(true);
  t.after(async () => {
    await manager.stop();
    await fs.rm(directory, { recursive:true, force:true });
  });

  const virtual = await manager.emulator.addPrinter({
    profileId:'flashforge-creator-5-pro',
    name:'Virtual Creator 5 Pro',
    ports:{ httpPort:0, cameraPort:0 }
  });

  assert.equal(manager.isSimulatedConfig(virtual.controllerSettings), true);
  assert.equal(manager.isSimulatedConfig({
    ...virtual.controllerSettings,
    httpPort:Number(virtual.controllerSettings.httpPort) + 1
  }), false);
});


test('integrated emulator restores a custom Creator 5 Pro definition after restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-emulator-persist-creator5-'));
  const settingsPath = path.join(directory, 'emulator-settings.json');
  t.after(() => fs.rm(directory, { recursive:true, force:true }));

  const first = new EmulatorManager({ settingsPath, withDefaults:false });
  await first.setEnabled(true);
  const created = await first.emulator.addPrinter({
    profileId:'flashforge-creator-5-pro',
    name:'Persistent Creator 5 Pro',
    ports:{ httpPort:0, cameraPort:0 }
  });
  const savedHttpPort = created.ports.httpPort;
  const savedCameraPort = created.ports.cameraPort;
  const savedSerial = created.serialNumber;
  await first.stop();

  const persisted = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.equal(persisted.enabled, true);
  assert.equal(persisted.printers.length, 1);
  assert.equal(persisted.printers[0].profileId, 'flashforge-creator-5-pro');
  assert.equal(persisted.printers[0].ports.httpPort, savedHttpPort);
  assert.equal(persisted.printers[0].ports.cameraPort, savedCameraPort);

  const second = new EmulatorManager({ settingsPath, withDefaults:false });
  const status = await second.init();
  assert.equal(status.running, true);
  const restored = [...second.emulator.printers.values()];
  assert.equal(restored.length, 1);
  assert.equal(restored[0].profileId, 'flashforge-creator-5-pro');
  assert.equal(restored[0].name, 'Persistent Creator 5 Pro');
  assert.equal(restored[0].serialNumber, savedSerial);
  assert.equal(restored[0].ports.httpPort, savedHttpPort);
  assert.equal(restored[0].ports.cameraPort, savedCameraPort);
  await second.stop();
});

test('legacy emulator settings can recover a registered simulated Creator 5 Pro', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-emulator-legacy-recovery-'));
  const settingsPath = path.join(directory, 'emulator-settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({ enabled:true }), 'utf8');
  t.after(() => fs.rm(directory, { recursive:true, force:true }));

  const registered = [{
    name:'Registered Virtual Creator 5 Pro',
    adapterType:'flashforge-creator5',
    model:'Creator 5 Pro',
    host:'127.0.0.1',
    simulated:true,
    serialNumber:'SIM-RECOVERY-C5P',
    checkCode:'SIMULATOR',
    httpPort:0,
    cameraPort:0
  }];
  const manager = new EmulatorManager({
    settingsPath,
    withDefaults:false,
    registeredPrintersProvider:async () => registered
  });
  await manager.init();
  const recovered = [...manager.emulator.printers.values()];
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].profileId, 'flashforge-creator-5-pro');
  assert.equal(recovered[0].name, 'Registered Virtual Creator 5 Pro');
  assert.equal(recovered[0].serialNumber, 'SIM-RECOVERY-C5P');
  await manager.stop();
});
