import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { BambuX1cCameraSource, x1cDecoderPath, x1cCameraUrl, x1cDecoderArgs } from '../src/bambu-x1c-camera.js';
import { BambuLabAdapter, normalizeBambuStatus } from '../src/adapters/bambu-lab-adapter.js';
import { CameraManager } from '../src/camera-manager.js';

const printer = { id:'x1c-camera', model:'X1C', host:'192.0.2.42', checkCode:'private-code' };
const frame = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);

function harness(t, options = {}) {
  const children = [];
  const calls = [];
  const source = new BambuX1cCameraSource(printer, {
    decoderPath: process.execPath, frameTimeoutMs:100, retryBaseMs:10, tlsVerifyOption:true,
    spawnProcess(command, args, config) {
      calls.push({ command, args, config });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.kills = [];
      child.kill = signal => {
        child.kills.push(signal || 'SIGTERM');
        queueMicrotask(() => child.emit('close', 0));
      };
      children.push(child);
      return child;
    },
    ...options
  });
  t.after(() => source.stop());
  return { source, children, calls };
}

test('X1C decoder configuration comes only from an absolute deployment path', () => {
  assert.equal(x1cDecoderPath({}), null);
  assert.equal(x1cDecoderPath({ PFC_FFMPEG_PATH:'ffmpeg' }), null);
  assert.equal(x1cDecoderPath({ PFC_FFMPEG_PATH:'./ffmpeg' }), null);
  assert.equal(x1cDecoderPath({ PFC_FFMPEG_PATH:process.execPath }), process.execPath);
});

test('X1C URL uses configured host and encoded credentials, never a reported camera URL', () => {
  const url = new URL(x1cCameraUrl({ ...printer, checkCode:'a@b:/?#', cameraUrl:'rtsps://attacker.invalid' }));
  assert.equal(url.hostname, printer.host);
  assert.equal(url.port, '322');
  assert.equal(url.pathname, '/streaming/live/1');
  assert.equal(decodeURIComponent(url.password), 'a@b:/?#');
  assert.equal(new URL(x1cCameraUrl({ ...printer, host:'::1' })).hostname, '[::1]');
  for (const host of ['host/path','host@elsewhere','host:322','-option','host\\other']) {
    assert.throws(() => x1cCameraUrl({ ...printer, host }), /IP address or DNS hostname/);
  }
  assert.throws(() => x1cCameraUrl({ ...printer, cameraPort:65536 }), /port/);
  assert.throws(() => x1cCameraUrl({ ...printer, checkCode:'' }), /access code/);
  const args = x1cDecoderArgs(printer);
  assert.equal(args.at(-1), 'pipe:1');
  assert.ok(args.includes('fps=1,scale=960:-2'));
});

test('X1C decoder shares startup, parses split and multiple JPEGs, and clears idle resources', async t => {
  const { source, children, calls } = harness(t);
  const first = source.start();
  const second = source.start();
  assert.equal(children.length, 1);
  const child = children[0];
  child.stdout.write(Buffer.concat([Buffer.from('noise'), frame.subarray(0,1)]));
  child.stdout.write(frame.subarray(1,5));
  child.stdout.write(frame.subarray(5));
  await Promise.all([first, second]);
  assert.deepEqual(await source.getSnapshot(), frame);
  assert.equal(calls[0].config.shell, false);
  assert.equal(calls[0].config.windowsHide, true);
  assert.deepEqual(calls[0].config.stdio, ['ignore','pipe','ignore']);
  const newer = Buffer.from([0xff, 0xd8, 7, 8, 0xff, 0xd9]);
  child.stdout.write(Buffer.concat([frame, newer]));
  const snapshot = await source.getSnapshot();
  assert.deepEqual(snapshot, newer);
  snapshot[2] = 0;
  assert.equal(source.latestFrame[2], 7, 'callers do not mutate the shared cached frame');
  await source.stop();
  child.stdout.write(frame);
  assert.equal(source.latestFrame, null);
  assert.equal(source.waiters.size, 0);
  assert.equal(child.kills.length, 1);
});

test('X1C startup timeout terminates the decoder and rejects concurrent requests', async t => {
  const { source, children } = harness(t, { frameTimeoutMs:20 });
  const results = await Promise.allSettled([source.start(), source.start()]);
  assert.ok(results.every(result => result.status === 'rejected' && /fresh X1C camera frame/.test(result.reason.message)));
  assert.equal(children.length, 1);
  assert.equal(children[0].kills.length, 1);
  assert.equal(source.child, null);
  assert.equal(source.waiters.size, 0);
});

test('X1C stop during an executable probe cannot launch a decoder afterward', async t => {
  let finishProbe;
  const probe = new Promise(resolve => { finishProbe = resolve; });
  const { source, children } = harness(t, { tlsVerifyOption:null, probeTlsOption:() => probe });
  const started = source.start();
  const rejected = assert.rejects(started, /camera stopped/);
  await source.stop();
  finishProbe(false);
  await rejected;
  assert.equal(children.length,0);
});

test('X1C process failures redact credentials and back off before reconnect', async t => {
  const { source, children } = harness(t, { retryBaseMs:1000 });
  const started = source.start();
  children[0].emit('error', new Error(`ENOENT ${x1cCameraUrl(printer)}`));
  await assert.rejects(started, error => /decoder unavailable/.test(error.message) && !error.message.includes(printer.checkCode));
  await assert.rejects(source.start(), /waiting before retry/);
  assert.equal(children.length, 1);
  source.retryAt = 0;
  const restarted = source.start();
  children[1].stdout.write(frame);
  await restarted;
  assert.equal(children.length, 2);
  assert.deepEqual(await source.getSnapshot(), frame);
  assert.ok(!source.sourceLabel.includes(printer.checkCode));
});

test('X1C stale frames are not reported indefinitely as a healthy feed', async t => {
  const { source, children } = harness(t, { frameTimeoutMs:20 });
  const started = source.start();
  children[0].stdout.write(frame);
  await started;
  source.latestFrameAt = 0;
  await assert.rejects(source.getSnapshot(), /fresh X1C camera frame/);
  assert.equal(source.latestFrame, null);
  assert.equal(source.child, null);
});

test('X1C oversized output is bounded and the decoder is terminated', async t => {
  const { source, children } = harness(t);
  const started = source.start();
  children[0].stdout.write(Buffer.concat([Buffer.from([0xff,0xd8]), Buffer.alloc(4 * 1024 * 1024 + 1)]));
  await assert.rejects(started, /size limit/);
  assert.equal(source.buffer.length, 0);
  assert.equal(children[0].kills.length, 1);
});

test('X1C idle stop cancels pending first-frame wait and escalates an unresponsive process', async t => {
  const { source, children } = harness(t, { killTimeoutMs:10 });
  const started = source.start();
  const rejection = assert.rejects(started, /camera stopped/);
  children[0].kill = signal => {
    children[0].kills.push(signal || 'SIGTERM');
    if (signal === 'SIGKILL') queueMicrotask(() => children[0].emit('close', 0));
  };
  await source.stop();
  await rejection;
  assert.deepEqual(children[0].kills, ['SIGTERM','SIGKILL']);
  assert.equal(source.waiters.size, 0);
});

test('X1C adapter advertises the external decoder only when configured', async t => {
  const previous = process.env.PFC_FFMPEG_PATH;
  t.after(() => { if (previous === undefined) delete process.env.PFC_FFMPEG_PATH; else process.env.PFC_FFMPEG_PATH = previous; });
  const adapter = new BambuLabAdapter(printer);
  delete process.env.PFC_FFMPEG_PATH;
  assert.equal(adapter.capabilities.camera, false);
  assert.equal(normalizeBambuStatus({ print:{} }, printer).cameraAvailable, false);
  process.env.PFC_FFMPEG_PATH = process.execPath;
  assert.equal(adapter.capabilities.camera, true);
  assert.equal(normalizeBambuStatus({ print:{} }, printer).cameraAvailable, true);
  assert.ok(await adapter.getCameraSource() instanceof BambuX1cCameraSource);
});

test('CameraManager shares an X1C decoder between snapshots and MJPEG viewers and awaits shutdown', async t => {
  const { source, children } = harness(t);
  const manager = new CameraManager({ lookupPrinter:async () => printer,
    adapterResolver:() => ({ capabilities:{ camera:true }, getCameraSource:async () => source }) });
  t.after(() => manager.stop());
  function response() {
    return Object.assign(new EventEmitter(), { chunks:[],
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      write(chunk) { this.chunks.push(chunk); return true; },
      end(chunk) { this.body = chunk; }
    });
  }
  const snapshot = response();
  const loading = manager.handleSnapshot(printer.id, snapshot);
  await new Promise(resolve => setImmediate(resolve));
  children[0].stdout.write(frame);
  await loading;
  assert.equal(snapshot.status, 200);
  assert.deepEqual(snapshot.body, frame);
  const live = response();
  await manager.handleStream(printer.id, new EventEmitter(), live);
  assert.equal(children.length, 1);
  assert.match(live.headers['content-type'], /multipart\/x-mixed-replace/);
  assert.ok(Buffer.concat(live.chunks).includes(frame));
  await manager.stop();
  assert.equal(source.child, null);
  assert.equal(children[0].kills.length, 1);
});
