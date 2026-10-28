import tls from 'node:tls';
import crypto from 'node:crypto';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const FRAME_RATE = 5;
const METHODS = new Set(['OPTIONS','DESCRIBE','SETUP','PLAY','GET_PARAMETER','TEARDOWN']);

export function annexBNals(video) {
  const nals = [];
  let start = -1;
  for (let offset = 0; offset < video.length-2; offset++) {
    if (video[offset] !== 0 || video[offset+1] !== 0) continue;
    const prefix = video[offset+2] === 1 ? 3
      : video[offset+2] === 0 && video[offset+3] === 1 ? 4 : 0;
    if (!prefix) continue;
    if (start >= 0 && offset > start) nals.push(video.subarray(start,offset));
    start = offset+prefix;
    offset += prefix-1;
  }
  if (start >= 0 && start < video.length) nals.push(video.subarray(start));
  return nals;
}

// One generated intra-frame image is repeated with fresh RTP timestamps. This
// exercises the real RTSPS/H.264 adapter/decoder; there is no simulator shortcut.
export function createX1cCameraServer(printer, { tlsOptions, video }) {
  const nals = annexBNals(video).filter(nal => [5,6,7,8].includes(nal[0] & 31));
  const sps = nals.find(nal => (nal[0] & 31) === 7);
  const pps = nals.find(nal => (nal[0] & 31) === 8);
  if (!sps || !pps || !nals.some(nal => (nal[0] & 31) === 5)) throw new Error('X1C simulator H.264 asset is incomplete');
  const available = () => printer.online && !printer.faults.cameraUnavailable;
  const server = tls.createServer({ ...tlsOptions, handshakeTimeout:5000 }, socket => {
    let buffer = Buffer.alloc(0);
    let timer;
    let channel = 0;
    let setup = false;
    let sequence = 0;
    let timestamp = 0;
    const ssrc = crypto.randomBytes(4).readUInt32BE(0);
    const session = crypto.randomBytes(12).toString('hex');
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.once('close', () => clearInterval(timer));
    const packet = (payload, marker) => {
      const header = Buffer.alloc(16);
      header[0] = 36; header[1] = channel;
      header.writeUInt16BE(12 + payload.length,2);
      header[4] = 0x80; header[5] = 96 | (marker ? 0x80 : 0);
      header.writeUInt16BE(sequence++ & 65535,6);
      header.writeUInt32BE(timestamp >>> 0,8);
      header.writeUInt32BE(ssrc,12);
      socket.write(Buffer.concat([header,payload]));
    };
    const sendFrame = () => {
      if (socket.destroyed) return;
      if (!available() || socket.writableLength > MAX_OUTPUT_BYTES) { socket.destroy(); return; }
      for (let index = 0; index < nals.length; index++) {
        const nal = nals[index];
        const lastNal = index === nals.length - 1;
        if (nal.length <= 1200) packet(nal,lastNal);
        else {
          for (let offset = 1; offset < nal.length; offset += 1198) {
            const last = offset + 1198 >= nal.length;
            const fu = Buffer.from([(nal[0] & 0xe0) | 28,
              (nal[0] & 31) | (offset === 1 ? 0x80 : 0) | (last ? 0x40 : 0)]);
            packet(Buffer.concat([fu,nal.subarray(offset,offset+1198)]),lastNal && last);
          }
        }
      }
      timestamp += 90000 / FRAME_RATE;
    };
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer,chunk]);
      if (buffer.length > MAX_REQUEST_BYTES) { socket.destroy(); return; }
      while (buffer.length) {
        if (buffer[0] === 36) {
          if (buffer.length < 4 || buffer.length < 4 + buffer.readUInt16BE(2)) return;
          buffer = buffer.subarray(4+buffer.readUInt16BE(2));
          continue;
        }
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const lines = buffer.subarray(0,end).toString().split('\r\n');
        const [method,uri,version] = lines.shift().split(' ');
        const headers = Object.fromEntries(lines.map(line => {
          const colon = line.indexOf(':');
          return [line.slice(0,colon).toLowerCase(),line.slice(colon+1).trim()];
        }));
        const length = Number(headers['content-length'] || 0);
        if (!Number.isInteger(length) || length < 0 || end + 4 + length > MAX_REQUEST_BYTES) { socket.destroy(); return; }
        if (buffer.length < end + 4 + length) return;
        buffer = buffer.subarray(end+4+length);
        const reply = (status,extra = '',body = '') => socket.write(
          `RTSP/1.0 ${status}\r\nCSeq: ${headers.cseq || '1'}\r\n${extra}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        if (version !== 'RTSP/1.0' || !METHODS.has(method) || !/^\d+$/.test(headers.cseq || '')) {
          reply('400 Bad Request'); continue;
        }
        if (method === 'OPTIONS') { reply('200 OK',`Public: ${[...METHODS].join(', ')}\r\n`); continue; }
        const expected = Buffer.from('Basic '+Buffer.from(`bblp:${printer.checkCode}`).toString('base64'));
        const auth = Buffer.from(headers.authorization || '');
        if (auth.length !== expected.length || !crypto.timingSafeEqual(auth,expected)) {
          printer.log('bambu-camera','RTSPS authentication rejected');
          reply('401 Unauthorized','WWW-Authenticate: Basic realm="simulated-x1c"\r\n'); continue;
        }
        if (!available()) { reply('503 Service Unavailable'); continue; }
        let pathname;
        try { pathname = new URL(uri).pathname; } catch { reply('400 Bad Request'); continue; }
        if (!['/streaming/live/1','/streaming/live/1/','/streaming/live/1/trackID=0'].includes(pathname)) {
          reply('404 Not Found'); continue;
        }
        printer.log('bambu-camera',`RTSPS ${method}`);
        if (method === 'DESCRIBE') {
          const host = printer.host.includes(':') ? `[${printer.host}]` : printer.host;
          reply('200 OK',`Content-Type: application/sdp\r\nContent-Base: rtsps://${host}:${printer.ports.cameraPort}/streaming/live/1/\r\n`,
            `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Simulated X1C camera\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\na=control:*\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=framerate:${FRAME_RATE}\r\na=fmtp:96 packetization-mode=1;sprop-parameter-sets=${sps.toString('base64')},${pps.toString('base64')}\r\na=control:trackID=0\r\n`);
        } else if (method === 'SETUP') {
          const channels = headers.transport?.match(/^RTP\/AVP\/TCP;.*interleaved=(\d+)-(\d+)(?:;|$)/i);
          if (!channels || Number(channels[1]) > 254 || Number(channels[2]) !== Number(channels[1])+1) {
            reply('461 Unsupported Transport'); continue;
          }
          channel = Number(channels[1]); setup = true;
          reply('200 OK',`Transport: RTP/AVP/TCP;unicast;interleaved=${channel}-${channel+1}\r\nSession: ${session}\r\n`);
        } else if (!setup || headers.session?.split(';')[0] !== session) reply('454 Session Not Found');
        else if (method === 'PLAY') {
          reply('200 OK',`Session: ${session}\r\n`);
          if (!timer) { sendFrame(); timer = setInterval(sendFrame,1000/FRAME_RATE); timer.unref?.(); }
        } else if (method === 'TEARDOWN') {
          clearInterval(timer); timer = null;
          reply('200 OK',`Session: ${session}\r\n`); socket.end();
        } else reply('200 OK',`Session: ${session}\r\n`);
      }
    });
  });
  server.maxConnections = 16;
  server.emulatorSockets = new Set();
  server.on('connection', socket => {
    server.emulatorSockets.add(socket);
    socket.once('close', () => server.emulatorSockets.delete(socket));
  });
  const onChange = () => { if (!available()) for (const socket of server.emulatorSockets) socket.destroy(); };
  printer.on('change',onChange);
  server.once('close',() => printer.off('change',onChange));
  return server;
}
