import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import http from 'node:http';
import { createEmulator } from '../emulator/server.js';
import { CameraManager } from '../src/camera-manager.js';
import { getPrinterAdapter } from '../src/adapters/adapter-registry.js';
import { x1cDecoderPath } from '../src/bambu-x1c-camera.js';
import { annexBNals } from '../emulator/x1c-camera.js';

test('Annex B framing uses byte-aligned start codes and preserves lookalike payload bits', () => {
  const payload = Buffer.from([0x65,0x10,0,0,0x10,0x55]);
  const data = Buffer.concat([Buffer.from([0,0,0,1]),payload,Buffer.from([0,0,1,0x67,4])]);
  assert.deepEqual(annexBNals(data),[payload,Buffer.from([0x67,4])]);
});

async function setup(t) {
  const emulator = createEmulator({ managementPort:0,withDefaults:false });
  await emulator.start();
  t.after(() => emulator.stop());
  const virtual = await emulator.addPrinter({ profileId:'bambu-x1c',ports:{ mqttPort:0,ftpsPort:0,cameraPort:0 } });
  return { emulator,virtual,printer:{ ...virtual.controllerSettings,id:virtual.id } };
}

function describe(printer, accessCode) {
  return new Promise((resolve,reject) => {
    const socket = tls.connect({ host:printer.host,port:printer.cameraPort,rejectUnauthorized:false });
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('RTSPS response timed out')); },3000);
    socket.once('secureConnect',() => {
      const auth = accessCode === undefined ? '' : `Authorization: Basic ${Buffer.from(`bblp:${accessCode}`).toString('base64')}\r\n`;
      socket.write(`DESCRIBE rtsps://${printer.host}:${printer.cameraPort}/streaming/live/1 RTSP/1.0\r\n`);
      socket.write(`CSeq: 1\r\n${auth}\r\n`);
    });
    socket.on('error',error => { clearTimeout(timer); reject(error); });
    socket.on('data',chunk => {
      buffer = Buffer.concat([buffer,chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const length = Number(buffer.subarray(0,end).toString().match(/Content-Length: (\d+)/i)?.[1] || 0);
      if (buffer.length < end + 4 + length) return;
      clearTimeout(timer); socket.destroy(); resolve(buffer.toString());
    });
  });
}

test('virtual X1C serves authenticated RTSPS/H.264 and honors camera/offline faults', async t => {
  const { emulator,virtual,printer } = await setup(t);
  assert.match(await describe(printer),/^RTSP\/1.0 401/);
  assert.match(await describe(printer,'wrong-code'),/^RTSP\/1.0 401/);
  const response = await describe(printer,printer.accessCode);
  assert.match(response,/^RTSP\/1.0 200/);
  assert.match(response,/H264\/90000/);
  assert.match(response,/sprop-parameter-sets=/);
  const state = emulator.printers.get(virtual.id);
  state.setFaults({ cameraUnavailable:true });
  assert.match(await describe(printer,printer.accessCode),/^RTSP\/1.0 503/);
  state.setFaults({ cameraUnavailable:false });
  state.action('offline');
  assert.match(await describe(printer,printer.accessCode),/^RTSP\/1.0 503/);
  assert.ok(!state.logs.some(entry => entry.message.includes(printer.accessCode)), 'camera protocol logs omit credentials');
});

test('virtual X1C populates actual HTTP JPEG and MJPEG views through the production adapter/decoder', {
  skip:!x1cDecoderPath(),timeout:30000
}, async t => {
  const { printer } = await setup(t);
  const manager = new CameraManager({ lookupPrinter:async () => printer,
    adapterResolver:getPrinterAdapter,idleCloseMs:100 });
  const server = http.createServer((req,res) => {
    const operation = req.url === '/snapshot' ? manager.handleSnapshot(printer.id,res)
      : manager.handleStream(printer.id,req,res);
    operation.catch(error => { res.statusCode = 500; res.end(error.message); });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { await manager.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await fetch(url+'/snapshot');
  const jpeg = Buffer.from(await snapshot.arrayBuffer());
  assert.equal(snapshot.status,200);
  assert.match(snapshot.headers.get('content-type'),/image\/jpeg/);
  assert.ok(jpeg.length > 1000);
  assert.deepEqual([...jpeg.subarray(0,2)],[255,216]);
  const source = manager.streams.get(printer.id).sourceControl;
  const decoderPid = source.child.pid;
  const live = await fetch(url+'/stream');
  assert.equal(live.status,200);
  assert.match(live.headers.get('content-type'),/multipart\/x-mixed-replace/);
  const reader = live.body.getReader();
  const part = Buffer.from((await reader.read()).value);
  assert.ok(part.includes(Buffer.from('Content-Type: image/jpeg')));
  assert.equal(source.child.pid,decoderPid,'snapshot and live view share the real decoder');
  await reader.cancel();
  for (let attempt=0;attempt<40 && source.child;attempt++) await new Promise(resolve => setTimeout(resolve,50));
  assert.equal(source.child,null,'closing the view stops its decoder after idle timeout');
});
