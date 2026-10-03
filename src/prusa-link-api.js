import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 10_000;
const INFO_CACHE_MS = 300_000;
const digestSessions = new Map();
const infoCache = new Map();

export class PrusaLinkApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'PrusaLinkApiError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

function cleanHost(host) {
  return String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/:\d+$/, '');
}

function baseUrl(printer) {
  const host = cleanHost(printer?.host);
  const port = Number(printer?.httpPort || 80);
  if (!host) throw new PrusaLinkApiError('PrusaLink host is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new PrusaLinkApiError('PrusaLink HTTP port must be 1-65535');
  return `http://${host}:${port}`;
}

function credentials(printer) {
  const config = printer?.adapterConfig || {};
  return {
    username:String(config.prusaLinkUsername || 'maker').trim() || 'maker',
    password:String(config.prusaLinkPassword || '').trim(),
    apiKey:String(config.apiKey || '').trim()
  };
}

function sessionKey(printer) {
  const auth = credentials(printer);
  return `${baseUrl(printer)}|${auth.username}`;
}

function parseDigestChallenge(header) {
  const text = String(header || '').trim();
  if (!/^Digest\s+/i.test(text)) return null;
  const params = {};
  const source = text.replace(/^Digest\s+/i, '');
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"((?:\\.|[^"])*)"|([^,\s]+))/g;
  let match;
  while ((match = pattern.exec(source))) {
    params[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').replace(/\\(["\\])/g, '$1');
  }
  if (!params.realm || !params.nonce) return null;
  return params;
}

function digestHash(algorithm, input) {
  const normalized = String(algorithm || 'MD5').toUpperCase();
  const nodeAlgorithm = normalized.startsWith('SHA-256') ? 'sha256' : 'md5';
  return crypto.createHash(nodeAlgorithm).update(input).digest('hex');
}

function digestAuthorization({ method, uri, username, password, challenge, nc }) {
  const algorithm = String(challenge.algorithm || 'MD5');
  const cnonce = crypto.randomBytes(12).toString('hex');
  const qops = String(challenge.qop || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : null;
  const ncText = Math.max(1, Number(nc || 1)).toString(16).padStart(8, '0');

  let ha1 = digestHash(algorithm, `${username}:${challenge.realm}:${password}`);
  if (/sess$/i.test(algorithm)) ha1 = digestHash(algorithm, `${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = digestHash(algorithm, `${String(method || 'GET').toUpperCase()}:${uri}`);
  const response = qop
    ? digestHash(algorithm, `${ha1}:${challenge.nonce}:${ncText}:${cnonce}:${qop}:${ha2}`)
    : digestHash(algorithm, `${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username.replace(/["\\]/g, '\\$&')}"`,
    `realm="${challenge.realm.replace(/["\\]/g, '\\$&')}"`,
    `nonce="${challenge.nonce.replace(/["\\]/g, '\\$&')}"`,
    `uri="${uri.replace(/["\\]/g, '\\$&')}"`,
    `response="${response}"`
  ];
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque.replace(/["\\]/g, '\\$&')}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${ncText}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal:controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new PrusaLinkApiError(`PrusaLink request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function obtainDigestChallenge(printer, { force = false } = {}) {
  const key = sessionKey(printer);
  if (!force) {
    const existing = digestSessions.get(key);
    if (existing?.challenge) return existing;
  }
  const response = await fetchWithTimeout(`${baseUrl(printer)}/api/version`, {
    method:'GET',
    headers:{ accept:'application/json' }
  });
  const challenge = parseDigestChallenge(response.headers.get('www-authenticate'));
  if (!challenge) {
    throw new PrusaLinkApiError(
      response.status === 401
        ? 'PrusaLink did not provide a supported Digest authentication challenge'
        : `PrusaLink authentication probe returned HTTP ${response.status}`,
      { status:response.status }
    );
  }
  const session = { challenge, nc:0 };
  digestSessions.set(key, session);
  return session;
}

async function responseError(response) {
  let detail = '';
  try {
    const contentType = String(response.headers.get('content-type') || '');
    if (contentType.includes('application/json')) {
      const body = await response.json();
      detail = body?.text || body?.title || body?.message || body?.error || '';
    } else {
      detail = (await response.text()).trim();
    }
  } catch {}
  const suffix = detail ? `: ${detail}` : '';
  return new PrusaLinkApiError(`PrusaLink returned HTTP ${response.status}${suffix}`, { status:response.status });
}

async function prusaRequest(printer, pathname, {
  method = 'GET',
  headers = {},
  bodyFactory = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  responseType = 'json'
} = {}) {
  const auth = credentials(printer);
  if (!auth.apiKey && !auth.password) throw new PrusaLinkApiError('Enter the PrusaLink password or API key for this printer');
  const url = new URL(pathname, `${baseUrl(printer)}/`);
  const uri = `${url.pathname}${url.search}`;
  const requestMethod = String(method || 'GET').toUpperCase();

  for (let attempt = 0; attempt < 2; attempt++) {
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('accept')) requestHeaders.set('accept', 'application/json');

    if (auth.apiKey) {
      requestHeaders.set('x-api-key', auth.apiKey);
    } else {
      const session = await obtainDigestChallenge(printer, { force:attempt > 0 });
      session.nc += 1;
      requestHeaders.set('authorization', digestAuthorization({
        method:requestMethod,
        uri,
        username:auth.username,
        password:auth.password,
        challenge:session.challenge,
        nc:session.nc
      }));
    }

    const body = typeof bodyFactory === 'function' ? bodyFactory() : undefined;
    const options = { method:requestMethod, headers:requestHeaders, ...(body ? { body, duplex:'half' } : {}) };
    const response = await fetchWithTimeout(url, options, timeoutMs);

    if (response.status === 401 && !auth.apiKey && attempt === 0) {
      digestSessions.delete(sessionKey(printer));
      try { body?.destroy?.(); } catch {}
      continue;
    }
    if (!response.ok) throw await responseError(response);
    if (response.status === 204 || requestMethod === 'HEAD' || responseType === 'none') return null;
    if (responseType === 'text') return response.text();
    const contentType = String(response.headers.get('content-type') || '');
    if (!contentType.includes('json')) {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    return response.json();
  }

  throw new PrusaLinkApiError('PrusaLink authentication failed', { status:401 });
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeState(value) {
  switch (String(value || '').trim().toUpperCase()) {
    case 'PRINTING': return 'printing';
    case 'PAUSED': return 'paused';
    case 'BUSY': return 'working';
    case 'FINISHED': return 'complete';
    case 'STOPPED': return 'cancelled';
    case 'ERROR':
    case 'ATTENTION': return 'error';
    case 'READY':
    case 'IDLE':
    default: return 'idle';
  }
}

async function cachedInfo(printer) {
  const key = baseUrl(printer);
  const cached = infoCache.get(key);
  if (cached && Date.now() - cached.at < INFO_CACHE_MS) return cached.value;
  const [info, version] = await Promise.all([
    prusaRequest(printer, '/api/v1/info').catch(() => ({})),
    prusaRequest(printer, '/api/version').catch(() => ({}))
  ]);
  const value = { info:info || {}, version:version || {} };
  infoCache.set(key, { at:Date.now(), value });
  return value;
}

function manualFilament(printer) {
  const config = printer?.adapterConfig || {};
  const material = String(config.filamentDesignation || '').trim() || null;
  const colorText = String(config.filamentColorDesignation || '').trim().toUpperCase();
  const color = /^#[0-9A-F]{6}$/.test(colorText) ? colorText : null;
  const colorFamily = String(config.filamentColorFamilyDesignation || '').trim().toLowerCase() || null;
  return {
    present:null,
    material,
    materialSource:material ? 'manual' : null,
    color,
    colorSource:color ? 'manual' : null,
    colorFamily,
    colorFamilySource:colorFamily ? 'manual' : null,
    metadataAvailable:Boolean(material || color || colorFamily),
    manuallyAssigned:Boolean(material || color || colorFamily)
  };
}

export async function getPrusaLinkStatus(printer) {
  const [{ info, version }, status, job] = await Promise.all([
    cachedInfo(printer),
    prusaRequest(printer, '/api/v1/status'),
    prusaRequest(printer, '/api/v1/job').catch((error) => error?.status === 404 ? null : Promise.reject(error))
  ]);
  const telemetry = status?.printer || {};
  const activeJob = job || status?.job || null;
  const filament = manualFilament(printer);
  const reportedNozzle = Number(info?.nozzle_diameter);
  const manualNozzle = Number(printer?.adapterConfig?.nozzleDiameterDesignation);
  const nozzleDiameter = Number.isFinite(manualNozzle) && manualNozzle > 0
    ? manualNozzle
    : (Number.isFinite(reportedNozzle) && reportedNozzle > 0 ? reportedNozzle : null);
  const jobState = activeJob?.state || telemetry.state;
  const state = normalizeState(jobState);
  const statusMessage = telemetry?.status_printer?.ok === false
    ? (telemetry.status_printer.message || 'Printer requires attention')
    : '';

  const tool = {
    index:0,
    name:'T0',
    actual:numeric(telemetry.temp_nozzle),
    target:numeric(telemetry.target_nozzle),
    active:true,
    nozzleDiameter,
    nozzleDiameterSource:Number.isFinite(manualNozzle) && manualNozzle > 0 ? 'manual' : (nozzleDiameter ? 'printer' : null),
    nozzleManuallyAssigned:Number.isFinite(manualNozzle) && manualNozzle > 0,
    filament
  };

  return {
    status:state,
    statusMessage,
    printerName:info?.name || printer?.name || null,
    firmwareVersion:version?.firmware || version?.printer || null,
    serialNumber:info?.serial || printer?.serialNumber || null,
    fileName:activeJob?.file?.display_name || activeJob?.file?.name || null,
    progress:Math.max(0, Math.min(100, numeric(activeJob?.progress ?? status?.job?.progress))),
    currentLayer:0,
    totalLayers:0,
    remainingSeconds:Math.max(0, numeric(activeJob?.time_remaining ?? status?.job?.time_remaining)),
    elapsedSeconds:Math.max(0, numeric(activeJob?.time_printing ?? status?.job?.time_printing)),
    activeTool:0,
    nozzle:{ actual:tool.actual, target:tool.target },
    tools:[tool],
    materials:{
      available:filament.metadataAvailable,
      loadedCount:0,
      toolCount:1,
      metadataCount:filament.metadataAvailable ? 1 : 0,
      detecting:false,
      tools:[filament]
    },
    bed:{
      actual:numeric(telemetry.temp_bed),
      target:numeric(telemetry.target_bed)
    },
    chamber:{ actual:null, target:null },
    coolingFan:Math.max(0, numeric(telemetry.fan_print)),
    chamberFan:0,
    filtration:{ available:false, internal:0, external:0 },
    cameraAvailable:info?.active_camera === true
  };
}

function storageKey(storage) {
  return String(storage?.path || storage?.type || '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
}

export async function getPrusaLinkStorage(printer) {
  const payload = await prusaRequest(printer, '/api/v1/storage');
  const list = Array.isArray(payload?.storage_list) ? payload.storage_list : [];
  const chosen = list.find((item) => item?.available !== false && item?.read_only !== true && storageKey(item))
    || list.find((item) => item?.available !== false && storageKey(item));
  if (!chosen) {
    const status = await prusaRequest(printer, '/api/v1/status');
    if (storageKey(status?.storage)) return status.storage;
    throw new PrusaLinkApiError('No available PrusaLink storage was reported by the printer');
  }
  return chosen;
}

function encodePath(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function flattenFolder(folder, prefix = '') {
  const files = [];
  for (const child of Array.isArray(folder?.children) ? folder.children : []) {
    const displayName = String(child?.display_name || child?.name || '').trim();
    if (!displayName) continue;
    const relative = prefix ? `${prefix}/${displayName}` : displayName;
    if (String(child?.type || '').toUpperCase() === 'FOLDER') files.push(...flattenFolder(child, relative));
    else if (String(child?.type || '').toUpperCase() === 'PRINT_FILE') files.push(relative);
  }
  return files;
}

export async function getPrusaLinkFiles(printer) {
  const storage = await getPrusaLinkStorage(printer);
  const key = storageKey(storage);
  const folder = await prusaRequest(printer, `/api/v1/files/${encodeURIComponent(key)}/`);
  const files = flattenFolder(folder).sort((a, b) => a.localeCompare(b, undefined, { numeric:true, sensitivity:'base' }));
  return {
    files,
    recentFiles:[],
    complete:true,
    source:'prusalink-v1-files',
    ordering:'alphabetical',
    warning:null
  };
}

async function targetPath(printer, fileName) {
  const storage = await getPrusaLinkStorage(printer);
  const key = storageKey(storage);
  const normalized = String(fileName || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new PrusaLinkApiError('Invalid PrusaLink file name');
  }
  return { key, normalized, route:`/api/v1/files/${encodeURIComponent(key)}/${encodePath(normalized)}` };
}

export async function uploadPrusaLinkFile(printer, filePath, { fileName = null } = {}) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new PrusaLinkApiError('Upload source is not a file');
  const target = await targetPath(printer, fileName || path.basename(filePath));
  await prusaRequest(printer, target.route, {
    method:'PUT',
    headers:{
      'content-type':'application/octet-stream',
      'content-length':String(stat.size),
      'overwrite':'?1',
      'print-after-upload':'?0'
    },
    bodyFactory:() => createReadStream(filePath),
    timeoutMs:Math.max(120_000, Math.ceil(stat.size / (64 * 1024)) * 1000),
    responseType:'none'
  });
  return { uploaded:true, fileName:target.normalized, storage:target.key };
}

export async function verifyPrusaLinkFile(printer, fileName) {
  try {
    const target = await targetPath(printer, fileName);
    await prusaRequest(printer, target.route, { method:'HEAD', responseType:'none' });
    return { verified:true, source:'prusalink-v1-head' };
  } catch (error) {
    return { verified:false, source:null, warning:`Upload accepted, but PrusaLink file verification failed: ${error.message}` };
  }
}

export async function printPrusaLinkFile(printer, fileName) {
  const target = await targetPath(printer, fileName);
  await prusaRequest(printer, target.route, { method:'POST', responseType:'none' });
  return { started:true, fileName:target.normalized };
}

export async function setPrusaLinkJobState(printer, action) {
  const job = await prusaRequest(printer, '/api/v1/job');
  const id = Number(job?.id);
  if (!Number.isInteger(id) || id < 0) throw new PrusaLinkApiError('PrusaLink did not report an active job');
  if (action === 'pause') {
    await prusaRequest(printer, `/api/v1/job/${id}/pause`, { method:'PUT', responseType:'none' });
  } else if (action === 'resume') {
    await prusaRequest(printer, `/api/v1/job/${id}/resume`, { method:'PUT', responseType:'none' });
  } else if (action === 'cancel') {
    await prusaRequest(printer, `/api/v1/job/${id}`, { method:'DELETE', responseType:'none' });
  } else {
    throw new PrusaLinkApiError(`Unsupported PrusaLink job action: ${action}`);
  }
  return { ok:true, action, jobId:id };
}

export const prusaLinkInternals = Object.freeze({
  parseDigestChallenge,
  digestAuthorization,
  normalizeState,
  storageKey,
  flattenFolder
});
