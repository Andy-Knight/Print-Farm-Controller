import tls from 'node:tls';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_VERIFY_ATTEMPTS = 4;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BambuFtpsError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'BambuFtpsError';
  }
}

function settingsFor(printer) {
  const host = String(printer?.host || '').trim();
  const accessCode = String(printer?.checkCode || printer?.accessCode || printer?.adapterConfig?.accessCode || '').trim();
  const port = Number(printer?.ftpsPort || printer?.adapterConfig?.ftpsPort || 990);
  if (!host || !accessCode) throw new BambuFtpsError('Bambu host and access code are required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BambuFtpsError('Bambu FTPS port must be 1-65535');
  return { host, accessCode, port };
}

function safeRemoteName(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('../') || normalized === '..' || /[\r\n\0]/.test(normalized)) {
    throw new BambuFtpsError('Invalid Bambu printer file name');
  }
  return normalized;
}

function normalizedRemoteName(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^(?:internal|user)\//i, '')
    .trim()
    .toLocaleLowerCase();
}

function connectTls({ host, port }, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false, servername: undefined });
    const timer = setTimeout(() => socket.destroy(new BambuFtpsError(`Timed out connecting to ${host}:${port}`)), timeoutMs);
    socket.once('secureConnect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error instanceof BambuFtpsError ? error : new BambuFtpsError(`FTPS connection failed: ${error.message}`, { cause: error })); });
  });
}

class ImplicitFtpsClient {
  constructor(printer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.settings = settingsFor(printer);
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.buffer = '';
    this.responses = [];
    this.waiters = [];
    this.multilineCode = null;
    this.multilineLines = [];
  }

  acceptLine(line) {
    if (this.multilineCode) {
      this.multilineLines.push(line);
      if (line.startsWith(`${this.multilineCode} `)) {
        this.acceptResponse({ code: Number(this.multilineCode), message: this.multilineLines.join('\n') });
        this.multilineCode = null;
        this.multilineLines = [];
      }
      return;
    }
    const match = line.match(/^(\d{3})([- ])(.*)$/);
    if (!match) return;
    if (match[2] === '-') {
      this.multilineCode = match[1];
      this.multilineLines = [line];
      return;
    }
    this.acceptResponse({ code: Number(match[1]), message: line });
  }

  acceptResponse(response) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(response);
    else this.responses.push(response);
  }

  readResponse(label = 'response') {
    if (this.responses.length) return Promise.resolve(this.responses.shift());
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new BambuFtpsError(`Timed out waiting for FTPS ${label}`));
      }, this.timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async connect() {
    this.socket = await connectTls({ host: this.settings.host, port: this.settings.port }, this.timeoutMs);
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk) => {
      this.buffer += chunk;
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || '';
      for (const line of lines) this.acceptLine(line);
    });
    this.socket.on('error', (error) => {
      for (const waiter of this.waiters.splice(0)) waiter.reject(new BambuFtpsError(`FTPS connection failed: ${error.message}`, { cause: error }));
    });
    const greeting = await this.readResponse('greeting');
    if (greeting.code !== 220) throw new BambuFtpsError(`Bambu FTPS rejected the connection: ${greeting.message}`);
    await this.command('USER bblp', [331, 230]);
    await this.command(`PASS ${this.settings.accessCode}`, [230], 'Bambu FTPS rejected the access code');
    await this.command('PBSZ 0', [200]);
    await this.command('PROT P', [200]);
    await this.command('TYPE I', [200]);
    return this;
  }

  async command(line, accepted = [200], failureMessage = null) {
    if (!this.socket || this.socket.destroyed) throw new BambuFtpsError('FTPS connection is not open');
    this.socket.write(`${line}\r\n`);
    const response = await this.readResponse(line.split(' ')[0]);
    if (!accepted.includes(response.code)) throw new BambuFtpsError(failureMessage || `FTPS ${line.split(' ')[0]} failed: ${response.message}`);
    return response;
  }

  async passiveDataSocket() {
    let response;
    try { response = await this.command('EPSV', [229]); }
    catch { response = await this.command('PASV', [227]); }
    let port;
    const epsv = response.message.match(/\(\|\|\|(\d+)\|\)/);
    if (epsv) port = Number(epsv[1]);
    else {
      const pasv = response.message.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
      if (pasv) port = Number(pasv[5]) * 256 + Number(pasv[6]);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BambuFtpsError(`Could not parse passive FTPS port: ${response.message}`);
    return connectTls({ host: this.settings.host, port }, this.timeoutMs);
  }

  async transfer(command, writer) {
    const dataSocket = await this.passiveDataSocket();
    this.socket.write(`${command}\r\n`);
    const preliminary = await this.readResponse(command.split(' ')[0]);
    if (![125, 150].includes(preliminary.code)) {
      dataSocket.destroy();
      throw new BambuFtpsError(`FTPS transfer failed: ${preliminary.message}`);
    }
    await writer(dataSocket);
    const complete = await this.readResponse('transfer completion');
    if (![226, 250].includes(complete.code)) throw new BambuFtpsError(`FTPS transfer did not complete: ${complete.message}`);
  }

  async list() {
    const chunks = [];
    const collect = (dataSocket) => new Promise((resolve, reject) => {
      dataSocket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      dataSocket.once('end', resolve);
      dataSocket.once('close', resolve);
      dataSocket.once('error', reject);
    });
    let machineReadable = true;
    try { await this.transfer('MLSD', collect); }
    catch {
      machineReadable = false;
      chunks.length = 0;
      await this.transfer('LIST', collect);
    }
    return Buffer.concat(chunks).toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      if (!machineReadable) {
        const unix = line.match(/^[-l][^ ]*\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+[\d:]+\s+(.+)$/);
        return unix?.[1] ? [unix[1]] : [];
      }
      const separator = line.indexOf(' ');
      if (separator < 0) return [];
      const facts = line.slice(0, separator).toLowerCase();
      const name = line.slice(separator + 1).trim();
      return facts.includes('type=file') && name ? [name] : [];
    });
  }

  async upload(localPath, remoteName) {
    const target = safeRemoteName(remoteName || path.basename(localPath));
    const stat = await fs.stat(localPath);
    await this.transfer(`STOR ${target}`, (dataSocket) => new Promise((resolve, reject) => {
      const source = createReadStream(localPath);
      source.once('error', reject);
      dataSocket.once('error', reject);
      dataSocket.once('close', resolve);
      source.pipe(dataSocket);
    }));
    return { fileName: target, size: stat.size };
  }

  async exists(remoteName) {
    const target = safeRemoteName(remoteName);
    try {
      const response = await this.command(`SIZE ${target}`, [213]);
      return /^213\s+\d+/m.test(response.message);
    } catch {
      return false;
    }
  }

  async close() {
    if (!this.socket || this.socket.destroyed) return;
    try { await this.command('QUIT', [221]); } catch {}
    this.socket.destroy();
  }
}

async function withClient(printer, operation, options) {
  const client = new ImplicitFtpsClient(printer, options);
  try {
    await client.connect();
    return await operation(client);
  } finally {
    await client.close();
  }
}

export function listBambuFiles(printer, options = {}) {
  return withClient(printer, (client) => client.list(), options);
}

export function uploadBambuFile(printer, localPath, { fileName } = {}, options = {}) {
  return withClient(printer, (client) => client.upload(localPath, fileName), options);
}

export async function verifyBambuFile(printer, fileName, { attempts = DEFAULT_VERIFY_ATTEMPTS, retryDelayMs = 300, ...clientOptions } = {}) {
  const target = safeRemoteName(fileName);
  const wanted = normalizedRemoteName(target);
  const wantedBaseName = path.posix.basename(wanted);
  let lastError = null;
  for (let attempt = 0; attempt < Math.max(1, Number(attempts) || 1); attempt++) {
    if (attempt) await sleep(retryDelayMs * attempt);
    try {
      const verified = await withClient(printer, async (client) => {
        if (await client.exists(target)) return true;
        const files = await client.list();
        return files.some((file) => {
          const candidate = normalizedRemoteName(file);
          return candidate === wanted || path.posix.basename(candidate) === wantedBaseName;
        });
      }, clientOptions);
      if (verified) return { verified:true, source:'bambu-ftps' };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    verified:false,
    source:null,
    warning:lastError
      ? `Upload completed, but Bambu storage verification failed: ${lastError.message}`
      : 'Upload completed, but the file was not visible in Bambu printer storage.'
  };
}

export const bambuFtpsInternals = { ImplicitFtpsClient, safeRemoteName, normalizedRemoteName, settingsFor };
