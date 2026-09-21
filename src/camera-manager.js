import http from 'node:http';
import { EventEmitter } from 'node:events';
import { getPrinter } from './store.js';
import { getPrinterAdapter } from './adapters/adapter-registry.js';

const DEFAULT_IDLE_CLOSE_MS = 15000;
const DEFAULT_CONNECT_TIMEOUT_MS = 6000;
const DEFAULT_FRAME_TIMEOUT_MS = 10000;
const DEFAULT_SNAPSHOT_CACHE_MAX_AGE_MS = 30000;
const MAX_SUBSCRIBER_BUFFER = 2 * 1024 * 1024;
const MAX_FRAME_PARSE_BUFFER = 4 * 1024 * 1024;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

function nowIso() {
  return new Date().toISOString();
}

function defaultCameraUrl(printer) {
  return `http://${printer.host}:${printer.cameraPort || 8080}/?action=stream`;
}

export function safeCameraUrl(printer, reportedUrl, fallbackUrl = null) {
  const fallback = new URL(fallbackUrl || defaultCameraUrl(printer));
  if (!reportedUrl) return fallback.toString();

  try {
    const candidate = new URL(reportedUrl);
    // Only proxy plain HTTP back to the configured printer. Never accept a
    // printer-reported URL that points the controller at another host.
    if (candidate.protocol !== 'http:' || candidate.hostname !== printer.host) {
      return fallback.toString();
    }
    return candidate.toString();
  } catch {
    return fallback.toString();
  }
}

export class CameraManager extends EventEmitter {
  constructor({
    lookupPrinter = getPrinter,
    adapterResolver = getPrinterAdapter,
    activateCamera = null,
    idleCloseMs = DEFAULT_IDLE_CLOSE_MS,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    frameTimeoutMs = DEFAULT_FRAME_TIMEOUT_MS,
    snapshotCacheMaxAgeMs = DEFAULT_SNAPSHOT_CACHE_MAX_AGE_MS,
    onHealthChange = null
  } = {}) {
    super();
    this.lookupPrinter = lookupPrinter;
    this.adapterResolver = adapterResolver;
    this.activateCameraOverride = activateCamera;
    this.idleCloseMs = idleCloseMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.frameTimeoutMs = frameTimeoutMs;
    this.snapshotCacheMaxAgeMs = snapshotCacheMaxAgeMs;
    this.onHealthChange = onHealthChange;
    this.streams = new Map();
    this.health = new Map();
  }

  getHealth(id) {
    return this.health.get(id) || {
      state: 'idle',
      subscribers: 0,
      connectedAt: null,
      lastFrameAt: null,
      lastError: null,
      source: null
    };
  }

  setHealth(id, patch) {
    const previous = this.getHealth(id);
    const next = { ...previous, ...patch };
    this.health.set(id, next);
    this.emit('health', id, next);
    try { this.onHealthChange?.(id, next); } catch {}
  }

  async handleStream(id, req, res) {
    const printer = await this.lookupPrinter(id);
    if (!printer) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Printer not found');
      return;
    }

    const stream = await this.getOrCreateStream(printer);
    try {
      // Establish (or reuse) the one upstream camera connection first. This
      // gives us the printer's exact multipart boundary before committing the
      // downstream response headers.
      await this.ensureConnected(printer, stream);
    } catch (error) {
      res.writeHead(502, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(error?.message || 'Camera stream unavailable');
      return;
    }

    res.writeHead(200, {
      'content-type': stream.contentType || 'multipart/x-mixed-replace; boundary=boundarydonotcross',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });

    stream.subscribers.add(res);
    if (stream.idleTimer) {
      clearTimeout(stream.idleTimer);
      stream.idleTimer = null;
    }
    this.setHealth(id, { subscribers: stream.subscribers.size });
    if (stream.sourceMode === 'snapshot' && stream.latestFrame) {
      try { res.write(this.framePart(stream.latestFrame)); } catch {}
    }

    const cleanup = () => this.unsubscribe(id, res);
    req.once('close', cleanup);
    res.once('close', cleanup);
  }

  async getOrCreateStream(printer) {
    let stream = this.streams.get(printer.id);
    if (!stream) {
      stream = {
        printer,
        subscribers: new Set(),
        request: null,
        response: null,
        connecting: null,
        idleTimer: null,
        contentType: null,
        sourceUrl: null,
        frameBuffer: Buffer.alloc(0),
        latestFrame: null,
        latestFrameAt: null,
        connected: false,
        sourceMode: null,
        sourceControl: null,
        snapshotTimer: null,
        snapshotBusy: false,
        snapshotFailures: 0
      };
      this.streams.set(printer.id, stream);
    } else {
      stream.printer = printer;
    }
    return stream;
  }

  async ensureConnected(printer, stream) {
    if (stream.connected && (stream.sourceMode === 'snapshot' || (stream.response && !stream.response.destroyed))) return;
    if (stream.connecting) return stream.connecting;

    stream.connecting = this.connectUpstream(printer, stream)
      .finally(() => { stream.connecting = null; });
    return stream.connecting;
  }

  async connectUpstream(printer, stream) {
    this.setHealth(printer.id, {
      state: 'connecting',
      subscribers: stream.subscribers.size,
      lastError: null
    });

    const adapter = this.adapterResolver(printer);
    if (!adapter.capabilities?.camera) throw new Error('Camera is not supported by this printer');

    const cameraSource = await adapter.getCameraSource?.();
    if (cameraSource?.kind === 'snapshot') {
      return this.connectSnapshotSource(printer, stream, cameraSource);
    }

    let reportedUrl = null;
    try {
      reportedUrl = this.activateCameraOverride
        ? await this.activateCameraOverride(printer)
        : await adapter.activateCamera();
    } catch {
      // Some firmware already has the stream active but rejects/ignores the
      // explicit open command. The adapter fallback remains a valid source.
    }
    const adapterFallback = adapter.fallbackCameraUrl?.() || defaultCameraUrl(printer);
    const sourceUrl = safeCameraUrl(printer, reportedUrl, adapterFallback);
    stream.sourceUrl = sourceUrl;

    await new Promise((resolve, reject) => {
      const url = new URL(sourceUrl);
      const upstreamReq = http.get({
        hostname: url.hostname,
        port: Number(url.port || 80),
        path: `${url.pathname}${url.search}`,
        headers: { connection: 'keep-alive', accept: 'multipart/x-mixed-replace,image/jpeg,*/*' }
      });
      stream.request = upstreamReq;

      const timer = setTimeout(() => {
        upstreamReq.destroy(new Error('Camera connection timed out'));
      }, this.connectTimeoutMs);

      upstreamReq.once('response', (upstreamRes) => {
        clearTimeout(timer);
        if (upstreamRes.statusCode !== 200) {
          upstreamRes.resume();
          const error = new Error(`Camera returned HTTP ${upstreamRes.statusCode}`);
          this.failStream(printer.id, stream, error);
          reject(error);
          return;
        }

        const contentType = String(upstreamRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=boundarydonotcross');
        if (!/multipart\/x-mixed-replace/i.test(contentType) && !/image\/jpeg/i.test(contentType)) {
          upstreamRes.resume();
          const error = new Error(`Unexpected camera content type: ${contentType}`);
          this.failStream(printer.id, stream, error);
          reject(error);
          return;
        }

        stream.response = upstreamRes;
        stream.connected = true;
        stream.sourceMode = 'mjpeg';
        stream.sourceControl = null;
        stream.contentType = contentType;
        this.setHealth(printer.id, {
          state: 'streaming',
          subscribers: stream.subscribers.size,
          connectedAt: nowIso(),
          lastFrameAt: null,
          lastError: null,
          source: `${url.hostname}:${url.port || 80}`
        });

        upstreamRes.on('data', (chunk) => {
          this.captureFrames(printer.id, stream, chunk);
          for (const subscriber of [...stream.subscribers]) {
            if (subscriber.destroyed || subscriber.writableEnded) {
              this.unsubscribe(printer.id, subscriber);
              continue;
            }
            if ((subscriber.writableLength || 0) > MAX_SUBSCRIBER_BUFFER) {
              subscriber.destroy();
              this.unsubscribe(printer.id, subscriber);
              continue;
            }
            try { subscriber.write(chunk); } catch { this.unsubscribe(printer.id, subscriber); }
          }
        });

        upstreamRes.once('end', () => this.endUpstream(printer.id, stream, 'Camera stream ended'));
        upstreamRes.once('close', () => this.endUpstream(printer.id, stream, 'Camera stream closed'));
        upstreamRes.once('error', (error) => this.failStream(printer.id, stream, error));
        resolve();
      });

      upstreamReq.once('error', (error) => {
        clearTimeout(timer);
        this.failStream(printer.id, stream, error);
        reject(error);
      });
    });
  }

  async connectSnapshotSource(printer, stream, source) {
    stream.sourceMode = 'snapshot';
    stream.sourceControl = source;
    stream.sourceUrl = source.sourceLabel || `${printer.host}:${printer.httpPort || 80} snapshot`;
    stream.contentType = 'multipart/x-mixed-replace; boundary=printfleetframe';
    try {
      await source.start();
      let frame;
      if (typeof source.waitForFirstSnapshot === 'function') {
        frame = await source.waitForFirstSnapshot();
      } else {
        const warmupMs = Number(source.warmupMs || 0);
        if (warmupMs > 0) await new Promise((resolve) => setTimeout(resolve, warmupMs));
        frame = await source.getSnapshot();
      }
      stream.connected = true;
      stream.snapshotFailures = 0;
      this.publishFrame(printer.id, stream, frame, { broadcast: false });
      this.setHealth(printer.id, {
        state: 'streaming',
        subscribers: stream.subscribers.size,
        connectedAt: nowIso(),
        lastFrameAt: stream.latestFrameAt,
        lastError: null,
        source: stream.sourceUrl
      });
      this.startSnapshotPolling(printer.id, stream);
    } catch (error) {
      stream.connected = false;
      try { await source.stop?.(); } catch {}
      stream.sourceControl = null;
      this.setHealth(printer.id, { state: 'error', lastError: error?.message || 'Snapshot camera failed', source: stream.sourceUrl });
      throw error;
    }
  }

  startSnapshotPolling(id, stream) {
    if (stream.snapshotTimer) clearInterval(stream.snapshotTimer);
    const intervalMs = Math.max(500, Number(stream.sourceControl?.intervalMs || 1000));
    stream.snapshotTimer = setInterval(() => {
      this.pollSnapshotSource(id, stream).catch(() => {});
    }, intervalMs);
    stream.snapshotTimer.unref?.();
  }

  async pollSnapshotSource(id, stream) {
    if (!stream.connected || stream.sourceMode !== 'snapshot' || !stream.sourceControl || stream.snapshotBusy) return;
    stream.snapshotBusy = true;
    try {
      const frame = await stream.sourceControl.getSnapshot();
      stream.snapshotFailures = 0;
      this.publishFrame(id, stream, frame, { broadcast: true });
      const health = this.getHealth(id);
      if (health.state !== 'streaming' || health.lastError) {
        this.setHealth(id, { state: 'streaming', lastError: null, lastFrameAt: stream.latestFrameAt });
      }
    } catch (error) {
      stream.snapshotFailures += 1;
      // Keep the last good frame visible through brief camera hiccups. Snapmaker's
      // stock U1 monitor can sleep; after repeated misses explicitly wake it again.
      if (stream.snapshotFailures >= 3) {
        try { await stream.sourceControl.refresh?.(); } catch {}
        this.setHealth(id, {
          state: 'error',
          lastError: error?.message || 'Camera snapshot refresh failed',
          lastFrameAt: stream.latestFrameAt
        });
      }
    } finally {
      stream.snapshotBusy = false;
    }
  }

  framePart(frame) {
    return Buffer.concat([
      Buffer.from(`--printfleetframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`, 'ascii'),
      frame,
      Buffer.from('\r\n', 'ascii')
    ]);
  }

  publishFrame(id, stream, frame, { broadcast = true } = {}) {
    if (!Buffer.isBuffer(frame) || frame.length < 4 || frame[0] !== 0xff || frame[1] !== 0xd8) return;
    stream.latestFrame = Buffer.from(frame);
    stream.latestFrameAt = nowIso();
    const existing = this.getHealth(id);
    this.health.set(id, { ...existing, lastFrameAt: stream.latestFrameAt });
    this.emit('frame', id, stream.latestFrame);
    if (!broadcast || stream.subscribers.size === 0) return;
    const part = this.framePart(stream.latestFrame);
    for (const subscriber of [...stream.subscribers]) {
      if (subscriber.destroyed || subscriber.writableEnded) {
        this.unsubscribe(id, subscriber);
        continue;
      }
      if ((subscriber.writableLength || 0) > MAX_SUBSCRIBER_BUFFER) {
        subscriber.destroy();
        this.unsubscribe(id, subscriber);
        continue;
      }
      try { subscriber.write(part); } catch { this.unsubscribe(id, subscriber); }
    }
  }

  captureFrames(id, stream, chunk) {
    stream.frameBuffer = Buffer.concat([stream.frameBuffer, chunk]);
    if (stream.frameBuffer.length > MAX_FRAME_PARSE_BUFFER) {
      const soi = stream.frameBuffer.lastIndexOf(JPEG_SOI);
      stream.frameBuffer = soi >= 0
        ? stream.frameBuffer.subarray(soi)
        : stream.frameBuffer.subarray(-2);
    }

    while (true) {
      const start = stream.frameBuffer.indexOf(JPEG_SOI);
      if (start < 0) {
        if (stream.frameBuffer.length > 2) stream.frameBuffer = stream.frameBuffer.subarray(-2);
        break;
      }
      const end = stream.frameBuffer.indexOf(JPEG_EOI, start + 2);
      if (end < 0) {
        if (start > 0) stream.frameBuffer = stream.frameBuffer.subarray(start);
        break;
      }

      const frame = Buffer.from(stream.frameBuffer.subarray(start, end + 2));
      stream.frameBuffer = stream.frameBuffer.subarray(end + 2);
      this.publishFrame(id, stream, frame, { broadcast: false });

      // Keep last-frame timestamps internally; do not publish at video rate.
    }
  }

  async handleSnapshot(id, res) {
    const printer = await this.lookupPrinter(id);
    if (!printer) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Printer not found');
      return;
    }

    const stream = await this.getOrCreateStream(printer);
    const previousFrameAt = stream.latestFrameAt;
    try {
      await this.ensureConnected(printer, stream);
      const frame = this.getCachedFrame(stream) || await this.waitForFrame(id, this.frameTimeoutMs, previousFrameAt);
      this.writeSnapshot(res, frame, false);
      this.scheduleIdleClose(id, stream);
    } catch (error) {
      // A fleet preview should not disappear because of a brief reconnect race.
      // If we have a recently captured frame, serve that while the next refresh
      // retries the printer camera connection.
      const cached = this.getCachedFrame(stream, this.snapshotCacheMaxAgeMs);
      if (cached) {
        this.writeSnapshot(res, cached, true);
      } else {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end(error?.message || 'Camera snapshot unavailable');
      }
      this.scheduleIdleClose(id, stream);
    }
  }

  writeSnapshot(res, frame, stale = false) {
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': frame.length,
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      ...(stale ? { 'x-camera-stale': '1' } : {})
    });
    res.end(frame);
  }

  getCachedFrame(stream, maxAgeMs = this.snapshotCacheMaxAgeMs) {
    if (!stream?.latestFrame || !stream.latestFrameAt) return null;
    const capturedAt = Date.parse(stream.latestFrameAt);
    if (!Number.isFinite(capturedAt)) return null;
    if (Date.now() - capturedAt > maxAgeMs) return null;
    return stream.latestFrame;
  }

  waitForFrame(id, timeoutMs, afterFrameAt = null) {
    const stream = this.streams.get(id);
    const afterMs = afterFrameAt ? Date.parse(afterFrameAt) : null;
    const currentMs = stream?.latestFrameAt ? Date.parse(stream.latestFrameAt) : null;
    if (stream?.latestFrame && (afterMs == null || (Number.isFinite(currentMs) && currentMs > afterMs))) {
      return Promise.resolve(stream.latestFrame);
    }
    return new Promise((resolve, reject) => {
      const onFrame = (frameId, frame) => {
        if (frameId !== id) return;
        cleanup();
        resolve(frame);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for camera frame'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('frame', onFrame);
      };
      this.on('frame', onFrame);
    });
  }

  scheduleIdleClose(id, stream) {
    // Every successful or failed snapshot is activity. Push the idle deadline
    // forward instead of leaving the timer created by the first snapshot in
    // place, otherwise a regularly refreshing dashboard can race teardown.
    if (stream.idleTimer) {
      clearTimeout(stream.idleTimer);
      stream.idleTimer = null;
    }
    if (stream.subscribers.size > 0) return;
    stream.idleTimer = setTimeout(() => this.closeStream(id), this.idleCloseMs);
    stream.idleTimer.unref?.();
  }

  unsubscribe(id, res) {
    const stream = this.streams.get(id);
    if (!stream) return;
    stream.subscribers.delete(res);
    this.setHealth(id, { subscribers: stream.subscribers.size });
    if (stream.subscribers.size === 0) this.scheduleIdleClose(id, stream);
  }

  endUpstream(id, stream, message) {
    if (stream.response) stream.response.removeAllListeners();
    stream.response = null;
    stream.request = null;
    stream.connected = false;
    if (stream.subscribers.size > 0) {
      this.setHealth(id, { state: 'error', lastError: message, source: stream.sourceUrl });
      for (const subscriber of [...stream.subscribers]) {
        try { subscriber.end(); } catch {}
      }
      stream.subscribers.clear();
    } else {
      this.setHealth(id, { state: 'idle', lastError: null, subscribers: 0 });
    }
  }

  failStream(id, stream, error) {
    const message = error?.message || 'Camera stream failed';
    this.setHealth(id, { state: 'error', lastError: message, subscribers: stream.subscribers.size });
    if (stream.response) stream.response.destroy();
    stream.response = null;
    if (stream.request) stream.request.destroy();
    stream.request = null;
    stream.connected = false;
  }

  closeStream(id) {
    const stream = this.streams.get(id);
    if (!stream) return;
    if (stream.idleTimer) clearTimeout(stream.idleTimer);
    stream.idleTimer = null;
    if (stream.response) stream.response.destroy();
    if (stream.request) stream.request.destroy();
    if (stream.snapshotTimer) clearInterval(stream.snapshotTimer);
    stream.snapshotTimer = null;
    stream.snapshotBusy = false;
    const sourceControl = stream.sourceControl;
    stream.sourceControl = null;
    if (sourceControl?.stop) Promise.resolve(sourceControl.stop()).catch(() => {});
    stream.response = null;
    stream.request = null;
    stream.connected = false;
    stream.sourceMode = null;
    stream.connecting = null;
    stream.frameBuffer = Buffer.alloc(0);
    // Keep the last good JPEG as a short-lived fallback for fleet previews.
    // It is naturally discarded when the printer is removed or the manager stops.
    this.setHealth(id, { state: 'idle', subscribers: 0, lastError: null });
  }

  remove(id) {
    this.closeStream(id);
    this.streams.delete(id);
    this.health.delete(id);
  }

  stop() {
    for (const id of this.streams.keys()) this.closeStream(id);
    this.streams.clear();
  }
}
