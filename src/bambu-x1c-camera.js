import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { isIP } from 'node:net';

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const execute = promisify(execFile);
const decoderProbes = new Map();

async function decoderTlsOption(executable) {
  if (!decoderProbes.has(executable)) {
    const probe = execute(executable, ['-hide_banner', '-h', 'demuxer=rtsp'], {
      windowsHide:true, timeout:5000, maxBuffer:256 * 1024
    }).then(({stdout}) => /^\s+-tls_verify\s/m.test(stdout)).catch(() => {
      decoderProbes.delete(executable);
      throw new Error('X1C camera decoder probe failed; check PFC_FFMPEG_PATH');
    });
    decoderProbes.set(executable, probe);
  }
  return decoderProbes.get(executable);
}

// Only trusted deployment configuration may select an executable. Never take
// this from a printer, an HTTP request, the working directory or a search PATH.
export function x1cDecoderPath(env = process.env) {
  const value = String(env.PFC_FFMPEG_PATH || '').trim();
  return value && path.isAbsolute(value) ? value : null;
}

export function x1cCameraUrl(printer) {
  const host = String(printer.host || '').trim().replace(/^\[|\]$/g, '');
  const accessCode = String(printer.checkCode || printer.accessCode || printer.adapterConfig?.accessCode || '').trim();
  const port = Number(printer.cameraPort || printer.adapterConfig?.cameraPort || 322);
  if (!host || (!isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))) {
    throw new Error('X1C camera requires a printer IP address or DNS hostname');
  }
  if (!accessCode) throw new Error('X1C camera requires a LAN access code');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('X1C camera port must be 1-65535');
  const url = new URL(`rtsps://${isIP(host) === 6 ? `[${host}]` : host}:${port}/streaming/live/1`);
  url.username = 'bblp';
  url.password = accessCode;
  return url.toString();
}

export function x1cDecoderArgs(printer, { tlsVerifyOption = true } = {}) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-rtsp_transport', 'tcp', ...(tlsVerifyOption ? ['-tls_verify', '0'] : []), '-timeout', '10000000',
    '-threads', '1', '-i', x1cCameraUrl(printer),
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', 'fps=1,scale=960:-2', '-filter_threads', '1', '-threads', '1',
    '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'
  ];
}

export class BambuX1cCameraSource {
  constructor(printer, {
    decoderPath = x1cDecoderPath(), spawnProcess = spawn,
    frameTimeoutMs = 10000, maxFrameAgeMs = 2500,
    retryBaseMs = 1000, killTimeoutMs = 2000, tlsVerifyOption = null,
    probeTlsOption = decoderTlsOption
  } = {}) {
    this.printer = printer;
    this.decoderPath = decoderPath;
    this.spawnProcess = spawnProcess;
    this.frameTimeoutMs = frameTimeoutMs;
    this.maxFrameAgeMs = maxFrameAgeMs;
    this.retryBaseMs = retryBaseMs;
    this.killTimeoutMs = killTimeoutMs;
    this.tlsVerifyOption = tlsVerifyOption;
    this.probeTlsOption = probeTlsOption;
    this.generation = 0;
    this.kind = 'snapshot';
    this.intervalMs = 1000;
    this.sourceLabel = `${printer.host}:${printer.cameraPort || printer.adapterConfig?.cameraPort || 322} X1C RTSPS camera`;
    this.child = null;
    this.starting = null;
    this.stopping = null;
    this.closed = null;
    this.failure = null;
    this.retryAt = 0;
    this.failures = 0;
    this.buffer = Buffer.alloc(0);
    this.latestFrame = null;
    this.latestFrameAt = 0;
    this.waiters = new Set();
  }

  async start() {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    if (this.child && !this.failure) return;
    if (!this.decoderPath) throw new Error('X1C camera needs an absolute PFC_FFMPEG_PATH to an external FFmpeg executable');
    if (Date.now() < this.retryAt) throw new Error('X1C camera reconnect is waiting before retry');
    this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }

  async launch() {
    if (this.child) await this.stop();
    const generation = this.generation;
    this.failure = null;
    this.buffer = Buffer.alloc(0);
    this.latestFrame = null;
    this.latestFrameAt = 0;
    let child;
    try {
      // Older FFmpeg RTSPS defaults to unverified TLS but rejects this option;
      // newer versions expose it explicitly. Probe once per executable path.
      if (this.tlsVerifyOption === null) this.tlsVerifyOption = await this.probeTlsOption(this.decoderPath);
      if (generation !== this.generation) throw new Error('X1C camera stopped');
      child = this.spawnProcess(this.decoderPath, x1cDecoderArgs(this.printer, { tlsVerifyOption:this.tlsVerifyOption }), {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch {
      if (generation !== this.generation) throw new Error('X1C camera stopped');
      this.fail(new Error('X1C camera decoder could not start; check PFC_FFMPEG_PATH'));
      throw this.failure;
    }
    this.child = child;
    let resolveClosed;
    this.closed = new Promise(resolve => { resolveClosed = resolve; });
    child.once('close', () => {
      if (this.child === child) {
        this.child = null;
        this.fail(new Error('X1C camera decoder stopped; check LAN liveview, access code and decoder support'));
      }
      resolveClosed();
    });
    // Neither FFmpeg stderr nor spawn errors are exposed: they may contain the
    // authenticated URL. Host administrators can still inspect process argv.
    child.once('error', () => {
      if (this.child === child) this.fail(new Error('X1C camera decoder unavailable; check PFC_FFMPEG_PATH'));
    });
    child.stdout.on('data', chunk => {
      if (this.child === child && !this.failure) this.acceptData(chunk);
    });
    child.stdout.on('error', () => {
      if (this.child === child) this.fail(new Error('X1C camera decoder output failed'));
    });
    try {
      await this.waitForFrame();
    } catch (error) {
      this.fail(error);
      await this.stop();
      throw error;
    }
  }

  fail(error) {
    if (!this.failure) {
      this.failure = error;
      this.retryAt = Date.now() + Math.min(30000, this.retryBaseMs * 2 ** Math.min(this.failures++, 5));
    }
    this.latestFrame = null;
    this.latestFrameAt = 0;
    this.buffer = Buffer.alloc(0);
    for (const waiter of [...this.waiters]) waiter.reject(this.failure);
    void this.stop();
  }

  acceptData(chunk) {
    // Consume bounded slices even if a producer delivers an oversized chunk.
    for (let offset = 0; offset < chunk.length; offset += 65536) {
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, offset + 65536)]);
      while (this.buffer.length) {
        const start = this.buffer.indexOf(SOI);
        if (start < 0) { this.buffer = this.buffer.subarray(-1); break; }
        if (start > 0) this.buffer = this.buffer.subarray(start);
        const end = this.buffer.indexOf(EOI, 2);
        if (end < 0) break;
        const frame = this.buffer.subarray(0, end + 2);
        if (frame.length > MAX_FRAME_BYTES) { this.fail(new Error('X1C camera frame exceeded size limit')); return; }
        this.latestFrame = Buffer.from(frame);
        this.latestFrameAt = Date.now();
        this.failures = 0;
        for (const waiter of [...this.waiters]) waiter.resolve(this.latestFrame);
        this.buffer = this.buffer.subarray(end + 2);
      }
      if (this.buffer.length > MAX_FRAME_BYTES) { this.fail(new Error('X1C camera frame exceeded size limit')); return; }
    }
  }

  waitForFrame() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.latestFrame && Date.now() - this.latestFrameAt <= this.maxFrameAgeMs) {
      return Promise.resolve(Buffer.from(this.latestFrame));
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.waiters.delete(waiter); };
      const waiter = {
        resolve: frame => { cleanup(); resolve(Buffer.from(frame)); },
        reject: error => { cleanup(); reject(error); }
      };
      const timer = setTimeout(() => waiter.reject(new Error('Timed out waiting for a fresh X1C camera frame')), this.frameTimeoutMs);
      this.waiters.add(waiter);
    });
  }

  async waitForFirstSnapshot() { await this.start(); return this.waitForFrame(); }

  async getSnapshot() {
    await this.start();
    try { return await this.waitForFrame(); }
    catch (error) { this.fail(error); await this.stop(); throw error; }
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopChild().finally(() => { this.stopping = null; });
    return this.stopping;
  }

  async stopChild() {
    this.generation++;
    const child = this.child;
    // Detach first, so late data/close events cannot revive a stopped source.
    this.child = null;
    for (const waiter of [...this.waiters]) waiter.reject(new Error('X1C camera stopped'));
    this.latestFrame = null;
    this.latestFrameAt = 0;
    this.buffer = Buffer.alloc(0);
    if (!child) return;
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, this.killTimeoutMs);
    try { child.kill(); } catch {}
    try { await this.closed; } finally { clearTimeout(timer); }
  }
}
