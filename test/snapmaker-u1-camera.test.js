import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { SnapmakerU1CameraSource } from '../src/snapmaker-u1-camera.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function decodeClientTextFrame(buffer) {
  if (buffer.length < 6) return null;
  const opcode = buffer[0] & 0x0f;
  if (opcode !== 0x1) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { length = buffer.readUInt16BE(2); offset = 4; }
  else if (length === 127) { length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
  const masked = (buffer[1] & 0x80) !== 0;
  if (!masked || buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return payload.toString('utf8');
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('Snapmaker U1 camera source starts the native camera monitor over Moonraker websocket and reads monitor.jpg', async (t) => {
  const jpeg = Buffer.from([0xff, 0xd8, 7, 7, 7, 0xff, 0xd9]);
  const methods = [];
  let tokenSeen = null;
  let monitorStarted = false;
  const upgradedSockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.url === '/access/api_key') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'camera-test-token' }));
      return;
    }
    if (req.url?.startsWith('/server/files/camera/monitor.jpg')) {
      if (!monitorStarted) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpeg.length });
      res.end(jpeg);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('upgrade', (req, socket) => {
    upgradedSockets.add(socket);
    socket.once('close', () => upgradedSockets.delete(socket));
    const url = new URL(req.url, 'http://localhost');
    tokenSeen = url.searchParams.get('token');
    const key = String(req.headers['sec-websocket-key'] || '');
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'));
    socket.on('data', (data) => {
      const text = decodeClientTextFrame(data);
      if (!text) return;
      const json = JSON.parse(text);
      methods.push(json.method);
      if (json.method === 'camera.start_monitor') monitorStarted = true;
    });
  });
  const port = await listen(server);
  t.after(async () => {
    for (const socket of upgradedSockets) socket.destroy();
    await close(server);
  });

  const source = new SnapmakerU1CameraSource({ host: '127.0.0.1', httpPort: port, adapterConfig: {} });
  source.warmupMs = 10;
  await source.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  const frame = await source.getSnapshot();
  assert.equal(tokenSeen, 'camera-test-token');
  assert.ok(methods.includes('camera.start_monitor'));
  assert.deepEqual(frame, jpeg);
  await source.stop();
});
