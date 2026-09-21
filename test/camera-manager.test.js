import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { CameraManager, safeCameraUrl } from '../src/camera-manager.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function createFakeResponse() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    statusCode: null,
    headers: null,
    body: null,
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write() { return true; },
    end(body = Buffer.alloc(0)) {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      this.writableEnded = true;
      this.emit('finish');
    },
    destroy() {
      this.destroyed = true;
      this.emit('close');
    }
  });
}

test('camera URL validation never proxies a different host', () => {
  const printer = { host: '192.168.1.55', cameraPort: 8080 };
  assert.equal(
    safeCameraUrl(printer, 'http://evil.example:8080/?action=stream'),
    'http://192.168.1.55:8080/?action=stream'
  );
  assert.equal(
    safeCameraUrl(printer, 'http://192.168.1.55:8080/custom-stream'),
    'http://192.168.1.55:8080/custom-stream'
  );
});

test('camera manager shares one upstream connection and captures snapshots', async (t) => {
  let connections = 0;
  const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 4, 0xff, 0xd9]);
  const upstream = http.createServer((req, res) => {
    connections++;
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
    res.write(Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n'));
    res.write(jpeg);
    res.write(Buffer.from('\r\n'));
  });
  const address = await listen(upstream);
  t.after(() => close(upstream));

  const printer = {
    id: 'printer-1',
    host: '127.0.0.1',
    cameraPort: address.port
  };
  const manager = new CameraManager({
    lookupPrinter: async () => printer,
    activateCamera: async () => `http://127.0.0.1:${address.port}/?action=stream`,
    idleCloseMs: 50,
    connectTimeoutMs: 1000
  });
  t.after(() => manager.stop());

  const stream = await manager.getOrCreateStream(printer);
  await Promise.all([
    manager.ensureConnected(printer, stream),
    manager.ensureConnected(printer, stream)
  ]);
  assert.equal(connections, 1);

  const response = createFakeResponse();
  await manager.handleSnapshot(printer.id, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/jpeg');
  assert.deepEqual(response.body, jpeg);
  assert.equal(connections, 1, 'snapshot should reuse the existing upstream stream');
  assert.equal(manager.getHealth(printer.id).state, 'streaming');
  assert.ok(manager.getHealth(printer.id).lastFrameAt);
});

test('camera manager serves the last good frame during a transient reconnect failure', async (t) => {
  const jpeg = Buffer.from([0xff, 0xd8, 9, 8, 7, 6, 0xff, 0xd9]);
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
    res.write(Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n'));
    res.write(jpeg);
    res.write(Buffer.from('\r\n'));
  });
  const address = await listen(upstream);

  const printer = { id: 'printer-cache', host: '127.0.0.1', cameraPort: address.port };
  const manager = new CameraManager({
    lookupPrinter: async () => printer,
    activateCamera: async () => `http://127.0.0.1:${address.port}/?action=stream`,
    idleCloseMs: 20,
    connectTimeoutMs: 300,
    frameTimeoutMs: 300,
    snapshotCacheMaxAgeMs: 5000
  });
  t.after(() => manager.stop());

  const first = createFakeResponse();
  await manager.handleSnapshot(printer.id, first);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, jpeg);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(manager.streams.get(printer.id).latestFrame, 'idle close should retain the last good frame');

  await close(upstream);

  const second = createFakeResponse();
  await manager.handleSnapshot(printer.id, second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-camera-stale'], '1');
  assert.deepEqual(second.body, jpeg);
});

test('camera snapshot can wait longer for the first frame than the TCP connect timeout', async (t) => {
  const jpeg = Buffer.from([0xff, 0xd8, 4, 3, 2, 1, 0xff, 0xd9]);
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
    res.flushHeaders();
    setTimeout(() => {
      if (res.destroyed) return;
      res.write(Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n'));
      res.write(jpeg);
      res.write(Buffer.from('\r\n'));
    }, 120);
  });
  const address = await listen(upstream);
  t.after(() => close(upstream));

  const printer = { id: 'printer-slow-frame', host: '127.0.0.1', cameraPort: address.port };
  const manager = new CameraManager({
    lookupPrinter: async () => printer,
    activateCamera: async () => `http://127.0.0.1:${address.port}/?action=stream`,
    idleCloseMs: 1000,
    connectTimeoutMs: 60,
    frameTimeoutMs: 300
  });
  t.after(() => manager.stop());

  const response = createFakeResponse();
  await manager.handleSnapshot(printer.id, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, jpeg);
});

test('repeated fleet snapshots extend the camera idle deadline', async (t) => {
  const jpeg = Buffer.from([0xff, 0xd8, 5, 5, 5, 0xff, 0xd9]);
  let connections = 0;
  const upstream = http.createServer((req, res) => {
    connections++;
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
    res.write(Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n'));
    res.write(jpeg);
    res.write(Buffer.from('\r\n'));
  });
  const address = await listen(upstream);
  t.after(() => close(upstream));

  const printer = { id: 'printer-idle-deadline', host: '127.0.0.1', cameraPort: address.port };
  const manager = new CameraManager({
    lookupPrinter: async () => printer,
    activateCamera: async () => `http://127.0.0.1:${address.port}/?action=stream`,
    idleCloseMs: 100,
    connectTimeoutMs: 300,
    frameTimeoutMs: 300
  });
  t.after(() => manager.stop());

  const first = createFakeResponse();
  await manager.handleSnapshot(printer.id, first);
  await new Promise((resolve) => setTimeout(resolve, 70));

  const second = createFakeResponse();
  await manager.handleSnapshot(printer.id, second);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(manager.streams.get(printer.id).response, 'second snapshot should extend idle close deadline');
  assert.equal(connections, 1, 'regular snapshots should keep reusing the same camera connection');

  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(manager.streams.get(printer.id).response, null, 'camera should still close after the refreshed idle window expires');
});

test('camera manager adapts a snapshot camera source into dashboard JPEGs and MJPEG stream parts', async (t) => {
  const first = Buffer.from([0xff, 0xd8, 1, 1, 1, 0xff, 0xd9]);
  const second = Buffer.from([0xff, 0xd8, 2, 2, 2, 0xff, 0xd9]);
  let starts = 0;
  let stops = 0;
  let reads = 0;
  const source = {
    kind: 'snapshot',
    intervalMs: 25,
    sourceLabel: 'snapmaker-test-camera',
    async start() { starts++; },
    async waitForFirstSnapshot() { return first; },
    async getSnapshot() { reads++; return second; },
    async refresh() {},
    async stop() { stops++; }
  };
  const printer = { id: 'u1-camera', host: '127.0.0.1', adapterType: 'snapmaker-u1' };
  const manager = new CameraManager({
    lookupPrinter: async () => printer,
    adapterResolver: () => ({ capabilities: { camera: true }, getCameraSource: async () => source }),
    idleCloseMs: 60,
    frameTimeoutMs: 250
  });
  t.after(() => manager.stop());

  const snapshotRes = createFakeResponse();
  await manager.handleSnapshot(printer.id, snapshotRes);
  assert.equal(snapshotRes.statusCode, 200);
  assert.deepEqual(snapshotRes.body, first);
  assert.equal(starts, 1);
  assert.equal(manager.streams.get(printer.id).sourceMode, 'snapshot');

  const req = new EventEmitter();
  const liveRes = createFakeResponse();
  const writes = [];
  liveRes.write = (chunk) => { writes.push(Buffer.from(chunk)); return true; };
  await manager.handleStream(printer.id, req, liveRes);
  assert.equal(liveRes.statusCode, 200);
  assert.match(liveRes.headers['content-type'], /multipart\/x-mixed-replace/);
  assert.ok(Buffer.concat(writes).includes(first), 'live stream should immediately receive the cached snapshot as an MJPEG part');

  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.ok(reads >= 1, 'snapshot source should be polled while active');
  assert.ok(Buffer.concat(writes).includes(second), 'new snapshot should be emitted into the synthesized MJPEG stream');

  req.emit('close');
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.ok(stops >= 1, 'snapshot camera source should be stopped after it becomes idle');
});
