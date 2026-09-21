import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import { createEmulator } from '../emulator/server.js';
import { CameraManager } from '../src/camera-manager.js';
import { getPrinterAdapter } from '../src/adapters/adapter-registry.js';
import { prepareFlashForgeAd5mConfig } from '../src/adapters/flashforge-ad5m-adapter.js';
import { prepareSnapmakerU1Config } from '../src/adapters/snapmaker-u1-adapter.js';
import { prepareBambuLabConfig } from '../src/adapters/bambu-lab-adapter.js';
import { listAllFilesTcp } from '../src/tcp-files.js';

function fakeResponse() {
  const response = new EventEmitter();
  return Object.assign(response, {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    write() { return true; },
    end(body = Buffer.alloc(0)) { this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); this.writableEnded = true; }
  });
}

test('emulator management API creates and controls a virtual printer', async (t) => {
  const emulator = createEmulator({ managementPort: 0, withDefaults: false });
  const address = await emulator.start();
  t.after(() => emulator.stop());
  const base = `http://127.0.0.1:${address.port}`;

  const profiles = await fetch(`${base}/api/profiles`).then((response) => response.json());
  assert.deepEqual(profiles.profiles.map((profile) => profile.id).sort(), ['bambu-p1p', 'bambu-p1s', 'bambu-x1c', 'flashforge-ad5m-pro', 'snapmaker-u1']);

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

function mqttLength(value) {
  const bytes = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function mqttString(value) {
  const body = Buffer.from(value);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length);
  return Buffer.concat([length, body]);
}

function mqttPacket(type, payload) {
  return Buffer.concat([Buffer.from([type]), mqttLength(payload.length), payload]);
}

function waitForData(socket, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('Timed out waiting for socket data')), timeoutMs);
    const onData = (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (predicate(received)) finish(null, received);
    };
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off('data', onData);
      if (error) reject(error); else resolve(value);
    };
    socket.on('data', onData);
  });
}

test('Bambu P1P, P1S and X1C profiles expose authenticated LAN protocol endpoints', async (t) => {
  const emulator = createEmulator({ managementPort: 0, withDefaults: false });
  await emulator.start();
  t.after(() => emulator.stop());
  const p1p = await emulator.addPrinter({
    profileId: 'bambu-p1p',
    ports: { mqttPort: 0, ftpsPort: 0, cameraPort: 0 }
  });
  const p1s = await emulator.addPrinter({
    profileId: 'bambu-p1s',
    ports: { mqttPort: 0, ftpsPort: 0, cameraPort: 0 }
  });
  const x1c = await emulator.addPrinter({
    profileId: 'bambu-x1c',
    ports: { mqttPort: 0, ftpsPort: 0, cameraPort: 0 }
  });

  assert.equal(p1p.model, 'P1P');
  assert.equal(p1s.model, 'P1S');
  assert.equal(x1c.model, 'X1C');
  assert.equal(x1c.tools[0].nozzleVolumeType, 'hardened-steel');
  assert.equal(p1p.controllerSettings.protocolStatus, 'simulated-unverified');
  assert.notEqual(p1p.ports.mqttPort, p1s.ports.mqttPort);

  const mqtt = tls.connect({ host: p1p.host, port: p1p.ports.mqttPort, rejectUnauthorized: false });
  await new Promise((resolve, reject) => { mqtt.once('secureConnect', resolve); mqtt.once('error', reject); });
  const connectBody = Buffer.concat([
    mqttString('MQTT'), Buffer.from([4, 0xc2, 0, 30]), mqttString('emulator-test'),
    mqttString('bblp'), mqttString(p1p.checkCode)
  ]);
  mqtt.write(mqttPacket(0x10, connectBody));
  assert.ok((await waitForData(mqtt, (data) => data.includes(Buffer.from([0x20, 0x02, 0x00, 0x00])))).length);
  const reportTopic = `device/${p1p.serialNumber}/report`;
  const requestTopic = `device/${p1p.serialNumber}/request`;
  mqtt.write(mqttPacket(0x82, Buffer.concat([Buffer.from([0, 1]), mqttString(reportTopic), Buffer.from([0])])));
  const status = await waitForData(mqtt, (data) => data.includes(Buffer.from('"gcode_state":"IDLE"')));
  assert.ok(status.includes(Buffer.from(reportTopic)));
  const startCommand = Buffer.from(JSON.stringify({ print: { command: 'project_file', sequence_id: '7', subtask_name: 'bambu-test.3mf' } }));
  mqtt.write(mqttPacket(0x30, Buffer.concat([mqttString(requestTopic), startCommand])));
  await waitForData(mqtt, (data) => data.includes(Buffer.from('"gcode_state":"RUNNING"')));
  assert.equal(emulator.printers.get(p1p.id).status, 'printing');
  mqtt.end();

  const ftps = tls.connect({ host: p1p.host, port: p1p.ports.ftpsPort, rejectUnauthorized: false });
  await new Promise((resolve, reject) => { ftps.once('secureConnect', resolve); ftps.once('error', reject); });
  await waitForData(ftps, (data) => data.includes(Buffer.from('220 ')));
  ftps.write(`USER bblp\r\nPASS ${p1p.checkCode}\r\nPWD\r\n`);
  const login = await waitForData(ftps, (data) => data.includes(Buffer.from('257 "/"')));
  assert.ok(login.includes(Buffer.from('230 Login successful')));
  ftps.end('QUIT\r\n');

  const camera = tls.connect({ host: p1p.host, port: p1p.ports.cameraPort, rejectUnauthorized: false });
  await new Promise((resolve, reject) => { camera.once('secureConnect', resolve); camera.once('error', reject); });
  const auth = Buffer.alloc(80);
  auth.writeUInt32LE(0x40, 0);
  auth.writeUInt32LE(0x3000, 4);
  auth.write('bblp', 16);
  auth.write(p1p.checkCode, 48);
  camera.write(auth);
  const frame = await waitForData(camera, (data) => data.length >= 16 && data.length >= 16 + data.readUInt32LE(0));
  const frameLength = frame.readUInt32LE(0);
  assert.ok(frame.subarray(16, 16 + frameLength).includes(Buffer.from([0xff, 0xd8, 0xff])));
  camera.destroy();
});

test('Bambu X1C profile interoperates with controller status, files, controls and AMS mapping', async (t) => {
  const emulator = createEmulator({ managementPort: 0, withDefaults: false });
  await emulator.start();
  t.after(() => emulator.stop());
  const virtual = await emulator.addPrinter({
    profileId:'bambu-x1c', name:'Adapter Test X1C',
    ports:{ mqttPort:0, ftpsPort:0, cameraPort:0 }
  });
  const config = prepareBambuLabConfig({
    name:virtual.name, model:virtual.model, host:virtual.host,
    serialNumber:virtual.serialNumber, accessCode:virtual.checkCode,
    mqttPort:virtual.ports.mqttPort, ftpsPort:virtual.ports.ftpsPort,
    cameraPort:virtual.ports.cameraPort
  });
  const adapter = getPrinterAdapter(config);
  const initial = await adapter.getStatus();
  assert.equal(initial.model, 'X1C');
  assert.equal(initial.lidarAvailable, true);
  assert.equal(initial.cameraAvailable, false);
  assert.equal(initial.materialSources.filter((source) => source.kind === 'ams').length, 4);
  assert.equal(adapter.capabilities.camera, false);
  assert.equal(adapter.limits.bedTemperature.max, 120);
  assert.deepEqual((await adapter.getFiles()).files, ['calibration-cube.gcode']);
  await adapter.uploadFile(new URL('../README.md', import.meta.url), { fileName:'X1C upload test.3mf' });
  assert.equal((await adapter.verifyFile('X1C upload test.3mf')).verified, true);
  await adapter.printLocalFile('X1C upload test.3mf', { materialMap:{ 0:2 }, usedLogicalTools:[0] });
  const printing = await adapter.getStatus();
  assert.equal(printing.status, 'printing');
  assert.equal(printing.materialSources.find((source) => source.active).protocolIndex, 2);
  await adapter.setTemperatures({ nozzle:225, bed:105 });
  await adapter.setFans({ coolingFan:35, chamberFan:60 });
  const controlled = await adapter.getStatus();
  assert.equal(controlled.nozzle.target, 225);
  assert.equal(controlled.bed.target, 105);
  assert.ok(Math.abs(controlled.chamberFan - 60) <= 1);
  await assert.rejects(() => adapter.getCameraSource(), /not supported/i);
});

test('Bambu P1S profile interoperates with the production controller adapter', async (t) => {
  const emulator = createEmulator({ managementPort: 0, withDefaults: false });
  await emulator.start();
  t.after(() => emulator.stop());
  const virtual = await emulator.addPrinter({
    profileId: 'bambu-p1s',
    name: 'Adapter Test P1S',
    ports: { mqttPort: 0, ftpsPort: 0, cameraPort: 0 }
  });
  const config = prepareBambuLabConfig({
    name: virtual.name,
    model: virtual.model,
    host: virtual.host,
    serialNumber: virtual.serialNumber,
    accessCode: virtual.checkCode,
    mqttPort: virtual.ports.mqttPort,
    ftpsPort: virtual.ports.ftpsPort,
    cameraPort: virtual.ports.cameraPort
  });
  const adapter = getPrinterAdapter(config);

  const initial = await adapter.getStatus();
  assert.equal(initial.status, 'idle');
  assert.equal(initial.model, 'P1S');
  assert.equal(initial.tools.length, 1);
  assert.equal(initial.tools[0].filament.material, 'PLA');
  assert.equal(initial.amsAttached, true);
  assert.equal(initial.materialSources.filter((source) => source.kind === 'ams').length, 4);

  const listed = await adapter.getFiles();
  assert.deepEqual(listed.files, ['calibration-cube.gcode']);
  const setup = await adapter.getPrintSetup('calibration-cube.gcode');
  assert.deepEqual(setup.referencedTools, [0]);
  assert.equal(setup.logicalTools[0].material, 'PLA');
  assert.equal(setup.materialSources.filter((source) => source.kind === 'ams').length, 4);
  await adapter.uploadFile(new URL('../README.md', import.meta.url), { fileName:'Controller upload test.3mf' });
  assert.equal((await adapter.verifyFile('Controller upload test.3mf')).verified, true);
  assert.ok((await adapter.getFiles()).files.includes('Controller upload test.3mf'));
  await adapter.printLocalFile('Controller upload test.3mf', { materialMap:{ 0:2 }, usedLogicalTools:[0] });
  const printing = await adapter.getStatus();
  assert.equal(printing.status, 'printing');
  assert.equal(printing.materialSources.find((source) => source.active).protocolIndex, 2);
  await adapter.setJobState('pause');
  assert.equal((await adapter.getStatus()).status, 'paused');
  await adapter.setJobState('resume');
  assert.equal((await adapter.getStatus()).status, 'printing');
  await adapter.setTemperatures({ nozzle: 215, bed: 65 });
  const heated = await adapter.getStatus();
  assert.equal(heated.nozzle.target, 215);
  assert.equal(heated.bed.target, 65);
  await adapter.setFans({ coolingFan: 40, chamberFan: 60 });
  const fans = await adapter.getStatus();
  assert.ok(Math.abs(fans.coolingFan - 40) <= 1);
  assert.ok(Math.abs(fans.chamberFan - 60) <= 1);

  const camera = await adapter.getCameraSource();
  await camera.start();
  const jpeg = await camera.getSnapshot();
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  assert.ok(jpeg.length > 10000);
  await camera.stop();

  await adapter.setJobState('cancel');
  assert.equal((await adapter.getStatus()).status, 'cancelled');
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
  const filamentConfig = await adapter.setFilamentConfig({ toolIndex:0, material:'PETG', color:'#123456' });
  assert.equal(filamentConfig.verified, true);
  const configured = await adapter.getStatus();
  assert.equal(configured.tools[0].filament.material, 'PETG');
  assert.equal(configured.tools[0].filament.color, '#123456');
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

  const camera = await adapter.getCameraSource();
  await camera.start();
  const jpeg = await camera.getSnapshot();
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  assert.ok(jpeg.length > 10000, 'simulated camera should return a visible test frame rather than a tiny placeholder');
  await camera.stop();
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
  assert.equal(initial.tools[0].filament.material, null);
  assert.equal(initial.tools[0].filament.materialSource, null);
  assert.equal(virtual.tools[0].filament.material, 'PLA');
  const files = await listAllFilesTcp(config, { settleMs: 20 });
  assert.deepEqual(files, ['calibration-cube.gcode']);
  await adapter.printLocalFile('calibration-cube.gcode', false);
  assert.equal((await adapter.getStatus()).status, 'printing');
  await adapter.setJobState('cancel');
  assert.equal((await adapter.getStatus()).status, 'cancelled');

  const printer = { ...config, id: 'simulated-flashforge-camera' };
  const cameraManager = new CameraManager({
    lookupPrinter: async () => printer,
    idleCloseMs: 50,
    connectTimeoutMs: 1000,
    frameTimeoutMs: 2000
  });
  const cameraResponse = fakeResponse();
  await cameraManager.handleSnapshot(printer.id, cameraResponse);
  assert.equal(cameraResponse.statusCode, 200);
  assert.equal(cameraResponse.headers['content-type'], 'image/jpeg');
  assert.ok(cameraResponse.body.length > 10000);
  assert.equal(cameraResponse.body[0], 0xff);
  assert.equal(cameraResponse.body[1], 0xd8);
  cameraManager.stop();
});

test('FlashForge port configuration validates emulator overrides', () => {
  assert.throws(() => prepareFlashForgeAd5mConfig({
    name: 'Invalid', host: '127.0.0.1', serialNumber: 'SIM', checkCode: 'SIM', httpPort: 70000
  }), /HTTP port must be 1-65535/);
});
