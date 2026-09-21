import { MoonrakerWebSocket } from './moonraker-websocket.js';
import { moonrakerBaseUrl, moonrakerRequest } from './moonraker-api.js';

const CAMERA_WARMUP_MS = 1600;
const CAMERA_INTERVAL_MS = 1000;
const CAMERA_KEEPALIVE_MS = 10000;
const SNAPSHOT_TIMEOUT_MS = 4000;
const JPEG_SOI_0 = 0xff;
const JPEG_SOI_1 = 0xd8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function configuredApiKey(printer) {
  return String(printer?.adapterConfig?.apiKey || '').trim();
}

async function resolveCameraToken(printer) {
  const configured = configuredApiKey(printer);
  if (configured) return configured;
  try {
    const value = await moonrakerRequest(printer, '/access/api_key', { timeoutMs: 3000 });
    if (typeof value === 'string') return value.trim();
    return String(value?.api_key || value?.apiKey || '').trim();
  } catch {
    // Trusted LAN clients can often open the websocket without a token.
    return '';
  }
}

function validJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 4 && buffer[0] === JPEG_SOI_0 && buffer[1] === JPEG_SOI_1;
}

export class SnapmakerU1CameraSource {
  constructor(printer) {
    this.printer = printer;
    this.kind = 'snapshot';
    this.intervalMs = CAMERA_INTERVAL_MS;
    this.warmupMs = CAMERA_WARMUP_MS;
    this.sourceLabel = `${printer.host}:${printer.httpPort || 7125} camera.start_monitor`;
    this.ws = null;
    this.keepalive = null;
    this.rpcId = 9000;
    this.started = false;
    this.starting = null;
  }

  async start() {
    if (this.started && this.ws?.connected) return;
    if (this.starting) return this.starting;
    this.starting = this.openAndStart().finally(() => { this.starting = null; });
    return this.starting;
  }

  async openAndStart() {
    this.stopKeepalive();
    this.ws?.close();
    const token = await resolveCameraToken(this.printer);
    const base = new URL(moonrakerBaseUrl(this.printer));
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new MoonrakerWebSocket(`ws://${base.hostname}:${base.port || 80}/websocket${query}`, {
      headers: configuredApiKey(this.printer) ? { 'X-Api-Key': configuredApiKey(this.printer) } : {},
      timeoutMs: 5000
    });
    // Camera sessions recover lazily on the next request if the socket drops.
    ws.on('error', () => {});
    ws.on('close', () => { this.started = false; this.stopKeepalive(); });
    this.ws = ws;
    await ws.connect();
    this.sendStartMonitor();
    this.started = true;
    this.keepalive = setInterval(() => {
      try { this.sendStartMonitor(); } catch { this.started = false; }
    }, CAMERA_KEEPALIVE_MS);
    this.keepalive.unref?.();
  }

  sendStartMonitor() {
    if (!this.ws?.connected) throw new Error('Snapmaker camera WebSocket is not connected');
    this.ws.sendJson({
      jsonrpc: '2.0',
      method: 'camera.start_monitor',
      params: { domain: 'lan', interval: 0 },
      id: ++this.rpcId
    });
  }

  async refresh() {
    if (!this.ws?.connected) {
      this.started = false;
      await this.start();
      return;
    }
    this.sendStartMonitor();
  }

  async getSnapshot() {
    // If the dedicated camera websocket dropped, re-open it before reading the
    // monitor file. Otherwise Moonraker can continue serving the last JPEG while
    // the stock U1 camera has silently stopped producing new frames.
    if (!this.ws?.connected) await this.refresh();
    const base = moonrakerBaseUrl(this.printer);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
    try {
      const key = configuredApiKey(this.printer);
      const response = await fetch(`${base}/server/files/camera/monitor.jpg?_=${Date.now()}`, {
        headers: { accept: 'image/jpeg,*/*', ...(key ? { 'X-Api-Key': key } : {}) },
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Snapmaker camera snapshot returned HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!validJpeg(buffer)) throw new Error('Snapmaker camera snapshot was not a valid JPEG');
      return buffer;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Timed out fetching Snapmaker camera snapshot');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async waitForFirstSnapshot({ attempts = 3 } = {}) {
    await sleep(this.warmupMs);
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
      try { return await this.getSnapshot(); } catch (error) { lastError = error; }
      if (i < attempts - 1) await sleep(700);
    }
    throw lastError || new Error('Snapmaker camera did not produce a frame');
  }

  stopKeepalive() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  async stop() {
    this.stopKeepalive();
    if (this.ws?.connected) {
      try {
        this.ws.sendJson({
          jsonrpc: '2.0',
          method: 'camera.stop_monitor',
          params: { domain: 'lan' },
          id: ++this.rpcId
        });
      } catch {}
    }
    this.ws?.close();
    this.ws = null;
    this.started = false;
  }
}

export function createSnapmakerU1CameraSource(printer) {
  return new SnapmakerU1CameraSource(printer);
}
