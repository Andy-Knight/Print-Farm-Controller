import { promises as fs } from 'node:fs';
import path from 'node:path';
import util from 'node:util';

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const SENSITIVE_KEY = /(password|passwd|access.?code|api.?key|token|secret|private.?key|authorization|credential)/i;
const LOG_FILE_RE = /^controller(?:\.\d+)?\.log$/;

function safeString(value) {
  if (value instanceof Error) return value.stack || value.message || String(value);
  if (typeof value === 'string') return value;
  return util.inspect(value, { depth:4, breakLength:160, maxArrayLength:50 });
}

export function redactDiagnosticValue(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) out[key] = '[REDACTED]';
    else if (/^(filePath|absolutePath|sourcePath|storedPath)$/i.test(key)) out[key] = path.basename(String(item || ''));
    else out[key] = redactDiagnosticValue(item, seen);
  }
  return out;
}

export function redactDiagnosticText(input) {
  let text = String(input ?? '');
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@]+)(@)/gi, '$1[REDACTED]$3');
  text = text.replace(/\b(password|passwd|access[_ -]?code|api[_ -]?key|token|secret|private[_ -]?key|authorization)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  return text;
}

async function tailText(filePath, maxBytes = 768 * 1024) {
  const stat = await fs.stat(filePath);
  const length = Math.min(stat.size, maxBytes);
  if (!length) return '';
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:(date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date:((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replaceAll('\\', '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralData, end]);
}

export class DiagnosticLogger {
  constructor({
    logDir,
    version = 'unknown',
    maxBytes = 5 * 1024 * 1024,
    retainedFiles = 7,
    now = () => new Date()
  } = {}) {
    this.logDir = path.resolve(logDir || path.join(process.cwd(), 'logs'));
    this.version = String(version || 'unknown');
    this.maxBytes = Math.max(128 * 1024, Number(maxBytes) || 5 * 1024 * 1024);
    this.retainedFiles = Math.max(2, Number(retainedFiles) || 7);
    this.now = now;
    this.activeFile = path.join(this.logDir, 'controller.log');
    this.verboseUntilMs = 0;
    this.writeChain = Promise.resolve();
    this.consolePatched = false;
    this.originalConsole = null;
  }

  async init() {
    await fs.mkdir(this.logDir, { recursive:true });
    await this._prune();
    await this.info('controller', 'Diagnostic logger initialized', {
      version:this.version,
      logDir:this.logDir,
      maxBytes:this.maxBytes,
      retainedFiles:this.retainedFiles
    });
    return this;
  }

  status() {
    const now = this.now().getTime();
    return {
      enabled:true,
      level:this.isVerbose() ? 'debug' : 'info',
      verbose:this.isVerbose(),
      verboseUntil:this.verboseUntilMs > now ? new Date(this.verboseUntilMs).toISOString() : null,
      logDir:this.logDir,
      activeFile:path.basename(this.activeFile),
      maxFileBytes:this.maxBytes,
      retainedFiles:this.retainedFiles
    };
  }

  isVerbose() {
    return this.verboseUntilMs > this.now().getTime();
  }

  async setVerbose(enabled, minutes = 30) {
    const safeMinutes = Math.min(120, Math.max(1, Number(minutes) || 30));
    this.verboseUntilMs = enabled ? this.now().getTime() + safeMinutes * 60_000 : 0;
    await this.info('diagnostics', enabled ? 'Verbose diagnostic logging enabled' : 'Verbose diagnostic logging disabled', enabled ? { minutes:safeMinutes } : {});
    return this.status();
  }

  debug(subsystem, message, meta = {}) {
    if (!this.isVerbose()) return Promise.resolve();
    return this._write('debug', subsystem, message, meta);
  }
  info(subsystem, message, meta = {}) { return this._write('info', subsystem, message, meta); }
  warn(subsystem, message, meta = {}) { return this._write('warn', subsystem, message, meta); }
  error(subsystem, message, meta = {}) { return this._write('error', subsystem, message, meta); }

  _write(level, subsystem, message, meta = {}) {
    const normalized = LEVELS.has(level) ? level : 'info';
    const entry = {
      timestamp:this.now().toISOString(),
      level:normalized.toUpperCase(),
      subsystem:String(subsystem || 'controller'),
      message:redactDiagnosticText(message),
      meta:redactDiagnosticValue(meta)
    };
    const line = JSON.stringify(entry) + '\n';
    this.writeChain = this.writeChain
      .then(() => this._append(line))
      .catch((error) => {
        this.originalConsole?.error?.('Diagnostic log write failed:', error.message);
      });
    return this.writeChain;
  }

  async _append(line) {
    await fs.mkdir(this.logDir, { recursive:true });
    let size = 0;
    try { size = (await fs.stat(this.activeFile)).size; } catch {}
    if (size + Buffer.byteLength(line) > this.maxBytes) await this._rotate();
    await fs.appendFile(this.activeFile, line, 'utf8');
  }

  async _rotate() {
    for (let index = this.retainedFiles - 1; index >= 1; index--) {
      const source = index === 1 ? this.activeFile : path.join(this.logDir, `controller.${index - 1}.log`);
      const target = path.join(this.logDir, `controller.${index}.log`);
      try {
        await fs.rm(target, { force:true });
        await fs.rename(source, target);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  async _prune() {
    const files = await fs.readdir(this.logDir).catch(() => []);
    for (const file of files) {
      const match = file.match(/^controller\.(\d+)\.log$/);
      if (match && Number(match[1]) >= this.retainedFiles) await fs.rm(path.join(this.logDir, file), { force:true });
    }
  }

  patchConsole() {
    if (this.consolePatched) return;
    this.consolePatched = true;
    this.originalConsole = {
      log:console.log.bind(console),
      info:console.info.bind(console),
      warn:console.warn.bind(console),
      error:console.error.bind(console)
    };
    const install = (method, level) => {
      console[method] = (...args) => {
        this.originalConsole[method](...args);
        const message = args.map(safeString).join(' ');
        this._write(level, 'console', message).catch(() => {});
      };
    };
    install('log', 'info');
    install('info', 'info');
    install('warn', 'warn');
    install('error', 'error');
  }

  async recent({ limit = 300, level = '', search = '' } = {}) {
    await this.writeChain;
    const requested = Math.min(1000, Math.max(1, Number(limit) || 300));
    const normalizedLevel = String(level || '').trim().toUpperCase();
    const query = String(search || '').trim().toLowerCase();
    const files = await this.logFiles();
    const entries = [];
    for (const file of files) {
      let text = '';
      try { text = await tailText(path.join(this.logDir, file)); } catch { continue; }
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (normalizedLevel && entry.level !== normalizedLevel) continue;
          if (query && !JSON.stringify(entry).toLowerCase().includes(query)) continue;
          entries.push(entry);
        } catch {}
      }
    }
    entries.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return entries.slice(-requested);
  }

  async logFiles() {
    const files = (await fs.readdir(this.logDir).catch(() => []))
      .filter((name) => LOG_FILE_RE.test(name));
    files.sort((a, b) => {
      if (a === 'controller.log') return 1;
      if (b === 'controller.log') return -1;
      const ai = Number(a.match(/\.(\d+)\.log$/)?.[1] || 0);
      const bi = Number(b.match(/\.(\d+)\.log$/)?.[1] || 0);
      return bi - ai;
    });
    return files;
  }

  async createBundle({ system = {}, printers = [], queue = {} } = {}) {
    await this.writeChain;
    const safeSystem = redactDiagnosticValue(system);
    const safePrinters = redactDiagnosticValue(printers);
    const safeQueue = redactDiagnosticValue(queue);
    const entries = [
      {
        name:'diagnostic-summary.txt',
        data:[
          'Print Farm Controller diagnostic bundle',
          `Generated: ${this.now().toISOString()}`,
          `Controller version: ${this.version}`,
          `Log level: ${this.isVerbose() ? 'DEBUG (verbose)' : 'INFO'}`,
          `Printers: ${Array.isArray(printers) ? printers.length : 0}`,
          '',
          'Sensitive credential fields are redacted. Print files and licence contents are not included.'
        ].join('\n')
      },
      { name:'system.json', data:JSON.stringify(safeSystem, null, 2) + '\n' },
      { name:'printers.json', data:JSON.stringify(safePrinters, null, 2) + '\n' },
      { name:'queue.json', data:JSON.stringify(safeQueue, null, 2) + '\n' }
    ];

    for (const file of await this.logFiles()) {
      try {
        entries.push({ name:`logs/${file}`, data:await fs.readFile(path.join(this.logDir, file)) });
      } catch {}
    }
    return createStoredZip(entries);
  }
}
