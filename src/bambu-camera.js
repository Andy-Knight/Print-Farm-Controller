import tls from 'node:tls';

const FRAME_HEADER_BYTES = 16;
const MAX_FRAME_BYTES = 10 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 6000;
const FRAME_TIMEOUT_MS = 10000;

function cameraSettings(printer) {
  const host = String(printer?.host || '').trim();
  const accessCode = String(printer?.checkCode || printer?.accessCode || printer?.adapterConfig?.accessCode || '').trim();
  const port = Number(printer?.cameraPort || printer?.adapterConfig?.cameraPort || 6000);
  if (!host || !accessCode) throw new Error('Bambu camera host and access code are required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Bambu camera port must be 1-65535');
  return { host, accessCode, port };
}

function authPacket(accessCode) {
  const packet = Buffer.alloc(80);
  packet.writeUInt32LE(0x40, 0);
  packet.writeUInt32LE(0x3000, 4);
  packet.write('bblp', 16, 32, 'utf8');
  packet.write(String(accessCode).slice(0, 32), 48, 32, 'utf8');
  return packet;
}

function validJpeg(frame) {
  return Buffer.isBuffer(frame) && frame.length > 4 && frame[0] === 0xff && frame[1] === 0xd8 && frame[frame.length - 2] === 0xff && frame[frame.length - 1] === 0xd9;
}

export class BambuCameraSource {
  constructor(printer) {
    this.printer = printer;
    this.kind = 'snapshot';
    this.intervalMs = 1000;
    this.warmupMs = 0;
    this.sourceLabel = `${printer.host}:${printer.cameraPort || printer.adapterConfig?.cameraPort || 6000} Bambu LAN camera`;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.latestFrame = null;
    this.frameWaiters = [];
    this.starting = null;
  }

  async start() {
    if (this.socket && !this.socket.destroyed) return;
    if (this.starting) return this.starting;
    this.starting = this.connect().finally(() => { this.starting = null; });
    return this.starting;
  }

  async connect() {
    await this.stop();
    const settings = cameraSettings(this.printer);
    const socket = tls.connect({ host: settings.host, port: settings.port, rejectUnauthorized: false, servername: undefined });
    this.socket = socket;
    socket.on('data', (chunk) => this.acceptData(chunk));
    socket.on('error', (error) => this.failWaiters(new Error(`Bambu camera connection failed: ${error.message}`)));
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.failWaiters(new Error('Bambu camera connection closed'));
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => socket.destroy(new Error('Bambu camera connection timed out')), CONNECT_TIMEOUT_MS);
      socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    socket.write(authPacket(settings.accessCode));
  }

  acceptData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= FRAME_HEADER_BYTES) {
      const frameLength = this.buffer.readUInt32LE(0);
      if (frameLength < 4 || frameLength > MAX_FRAME_BYTES) {
        this.buffer = Buffer.alloc(0);
        this.socket?.destroy(new Error(`Invalid Bambu camera frame length: ${frameLength}`));
        return;
      }
      if (this.buffer.length < FRAME_HEADER_BYTES + frameLength) return;
      const frame = Buffer.from(this.buffer.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + frameLength));
      this.buffer = this.buffer.subarray(FRAME_HEADER_BYTES + frameLength);
      if (!validJpeg(frame)) continue;
      this.latestFrame = frame;
      for (const waiter of this.frameWaiters.splice(0)) waiter.resolve(frame);
    }
  }

  failWaiters(error) {
    for (const waiter of this.frameWaiters.splice(0)) waiter.reject(error);
  }

  async waitForFrame({ fresh = false, timeoutMs = FRAME_TIMEOUT_MS } = {}) {
    if (!fresh && this.latestFrame) return Buffer.from(this.latestFrame);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (frame) => { clearTimeout(timer); resolve(Buffer.from(frame)); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      };
      const timer = setTimeout(() => {
        const index = this.frameWaiters.indexOf(waiter);
        if (index >= 0) this.frameWaiters.splice(index, 1);
        reject(new Error('Timed out waiting for a Bambu camera frame'));
      }, timeoutMs);
      this.frameWaiters.push(waiter);
    });
  }

  async waitForFirstSnapshot() {
    await this.start();
    return this.waitForFrame();
  }

  async getSnapshot() {
    if (!this.socket || this.socket.destroyed) await this.start();
    return this.waitForFrame();
  }

  async stop() {
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.destroy();
    this.buffer = Buffer.alloc(0);
    this.latestFrame = null;
  }
}

export function createBambuCameraSource(printer) {
  return new BambuCameraSource(printer);
}

export const bambuCameraInternals = { authPacket, cameraSettings, validJpeg };
