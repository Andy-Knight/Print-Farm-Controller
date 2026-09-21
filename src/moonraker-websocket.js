import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeClientFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | data.length;
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

export class MoonrakerWebSocket extends EventEmitter {
  constructor(url, { headers = {}, timeoutMs = 5000 } = {}) {
    super();
    this.url = new URL(url);
    this.headers = headers;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.closed = false;
  }

  async connect() {
    if (this.connected && this.socket && !this.socket.destroyed) return this;
    this.closed = false;
    await new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const expectedAccept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
      let settled = false;
      const request = http.request({
        hostname: this.url.hostname,
        port: Number(this.url.port || 80),
        path: `${this.url.pathname}${this.url.search}`,
        method: 'GET',
        headers: {
          Host: this.url.host,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
          ...this.headers
        }
      });

      const timer = setTimeout(() => request.destroy(new Error('Moonraker WebSocket connection timed out')), this.timeoutMs);
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      request.once('upgrade', (response, socket, head) => {
        const accept = String(response.headers['sec-websocket-accept'] || '');
        if (response.statusCode !== 101 || accept !== expectedAccept) {
          socket.destroy();
          done(reject, new Error(`Moonraker WebSocket upgrade failed (HTTP ${response.statusCode || 'unknown'})`));
          return;
        }
        this.socket = socket;
        this.connected = true;
        socket.setNoDelay(true);
        socket.on('data', (chunk) => this.onData(chunk));
        socket.once('error', (error) => this.onSocketError(error));
        socket.once('close', () => this.onSocketClose());
        if (head?.length) this.onData(head);
        this.emit('open');
        done(resolve, this);
      });
      request.once('response', (response) => {
        response.resume();
        done(reject, new Error(`Moonraker WebSocket returned HTTP ${response.statusCode}`));
      });
      request.once('error', (error) => done(reject, error));
      request.end();
    });
    return this;
  }

  sendJson(value) {
    if (!this.connected || !this.socket || this.socket.destroyed) throw new Error('Moonraker WebSocket is not connected');
    this.socket.write(encodeClientFrame(JSON.stringify(value), 0x1));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.close();
          return;
        }
        length = Number(big);
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      let payload = Buffer.from(this.buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this.buffer = this.buffer.subarray(offset + maskLength + length);

      if (opcode === 0x8) {
        this.close(false);
        return;
      }
      if (opcode === 0x9) {
        if (this.socket && !this.socket.destroyed) this.socket.write(encodeClientFrame(payload, 0xA));
        continue;
      }
      if (opcode === 0x1) this.emit('message', payload.toString('utf8'));
    }
  }

  onSocketError(error) {
    this.emit('error', error);
  }

  onSocketClose() {
    this.connected = false;
    this.socket = null;
    if (!this.closed) this.emit('close');
  }

  close(sendClose = true) {
    this.closed = true;
    this.connected = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.destroyed) return;
    try { if (sendClose) socket.write(encodeClientFrame(Buffer.alloc(0), 0x8)); } catch {}
    try { socket.end(); } catch {}
    const killer = setTimeout(() => { try { socket.destroy(); } catch {} }, 250);
    killer.unref?.();
  }
}
