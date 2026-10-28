import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { BambuX1cCameraSource, x1cDecoderPath } from '../src/bambu-x1c-camera.js';

// A generated solid-blue, two-frame H.264 fixture; no captured printer footage.
const video = readFileSync(new URL('fixtures/x1c-blue.h264', import.meta.url));
const nals = video.toString('hex').split(/00000001|000001/).filter(Boolean).map(hex => Buffer.from(hex, 'hex'));
const decoderPath = process.env.PFC_TEST_FFMPEG_PATH || x1cDecoderPath();

test('bundled or selected FFmpeg decodes authenticated RTSPS/RTP H.264 into fresh JPEG snapshots', {
  skip: !decoderPath, timeout:30000
}, async t => {
  const sockets = new Set();
  const commands = [];
  const sps = nals.find(nal => (nal[0] & 31) === 7).toString('base64');
  const pps = nals.find(nal => (nal[0] & 31) === 8).toString('base64');
  const keyframe = nals.find(nal => (nal[0] & 31) === 5);
  let authenticated = false;
  const server = tls.createServer({
    key:readFileSync(new URL('../emulator/assets/bambu-simulator-key.pem', import.meta.url)),
    cert:readFileSync(new URL('../emulator/assets/bambu-simulator-cert.pem', import.meta.url))
  }, socket => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let interval;
    socket.on('error', () => {});
    socket.on('close', () => { clearInterval(interval); sockets.delete(socket); });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        // Discard client RTCP packets interleaved on the TLS connection.
        if (buffer[0] === 36) {
          if (buffer.length < 4 || buffer.length < 4 + buffer.readUInt16BE(2)) return;
          buffer = buffer.subarray(4 + buffer.readUInt16BE(2));
          continue;
        }
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const request = buffer.subarray(0,end).toString();
        buffer = buffer.subarray(end+4);
        const method = request.split(' ')[0];
        commands.push(method);
        const cseq = request.match(/CSeq: (\d+)/i)?.[1] || '1';
        const reply = (status, headers = '', body = '') => socket.write(
          `RTSP/1.0 ${status}\r\nCSeq: ${cseq}\r\n${headers}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        if (method === 'OPTIONS') { reply('200 OK','Public: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN\r\n'); continue; }
        const auth = request.match(/Authorization: Basic ([^\r\n]+)/i)?.[1];
        if (auth !== Buffer.from('bblp:test-access').toString('base64')) {
          reply('401 Unauthorized','WWW-Authenticate: Basic realm="camera"\r\n');
          continue;
        }
        authenticated = true;
        if (method === 'DESCRIBE') {
          reply('200 OK','Content-Type: application/sdp\r\n',
            `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Camera test\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\na=control:*\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1;sprop-parameter-sets=${sps},${pps}\r\na=control:trackID=0\r\n`);
        } else if (method === 'SETUP') {
          reply('200 OK','Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\nSession: test-session\r\n');
        } else if (method === 'PLAY') {
          reply('200 OK','Session: test-session\r\n');
          let sequence = 0;
          let timestamp = 0;
          const send = () => {
            // Repeat independently decodable IDR frames with fresh RTP timing.
            const rtp = Buffer.alloc(12 + keyframe.length);
            rtp[0] = 0x80; rtp[1] = 0x80 | 96;
            rtp.writeUInt16BE(sequence++ & 65535, 2);
            rtp.writeUInt32BE(timestamp >>> 0, 4);
            rtp.writeUInt32BE(42, 8);
            keyframe.copy(rtp,12);
            timestamp += 90000;
            const header = Buffer.from([36,0,0,0]);
            header.writeUInt16BE(rtp.length,2);
            socket.write(Buffer.concat([header,rtp]));
          };
          send();
          interval = setInterval(send,200);
        } else reply('200 OK','Session: test-session\r\n');
      }
    });
  });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let decoderErrors = '';
  const source = new BambuX1cCameraSource({
    host:'127.0.0.1', cameraPort:server.address().port, checkCode:'test-access'
  }, { decoderPath, frameTimeoutMs:15000,
    spawnProcess(command,args,options) {
      const child = spawn(command,args,{ ...options, stdio:['ignore','pipe','pipe'] });
      child.stderr.on('data',chunk => { decoderErrors = (decoderErrors + chunk.toString()).slice(-4000); });
      return child;
    }
  });
  t.after(() => source.stop());
  let frame;
  try { frame = await source.waitForFirstSnapshot(); }
  catch (error) { t.diagnostic(decoderErrors.replace(/rtsps:\/\/\S+/g,'[redacted camera URL]')); throw error; }
  assert.equal(frame[0],0xff);
  assert.equal(frame[1],0xd8);
  assert.equal(frame.at(-2),0xff);
  assert.equal(frame.at(-1),0xd9);
  assert.ok(frame.length > 100);
  assert.ok(authenticated);
  for (const method of ['DESCRIBE','SETUP','PLAY']) assert.ok(commands.includes(method));
  source.latestFrameAt = 0;
  assert.ok((await source.getSnapshot()).length > 100, 'a new decoded frame arrives on the existing session');
  await source.stop();
  assert.equal(source.child,null);
  const denied = new BambuX1cCameraSource({
    host:'127.0.0.1', cameraPort:server.address().port, checkCode:'wrong-code'
  }, { decoderPath, frameTimeoutMs:5000 });
  t.after(() => denied.stop());
  await assert.rejects(denied.waitForFirstSnapshot(), error =>
    /decoder stopped/.test(error.message) && !/wrong-code|rtsps:\/\//.test(error.message),
    'authentication rejection is reported without credential-bearing diagnostics');
});
