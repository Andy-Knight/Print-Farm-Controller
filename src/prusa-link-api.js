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

function configuredToolCount(printer) {
  const count = Number(printer?.adapterConfig?.toolCount || 1);
  return [1, 4, 8].includes(count) ? count : 1;
}

function cleanHexColor(value) {
  const text = String(value || '').trim().replace(/^#/, '').slice(0, 6).toUpperCase();
  return /^[0-9A-F]{6}$/.test(text) ? `#${text}` : null;
}

function manualToolDesignation(printer, index) {
  const config = printer?.adapterConfig || {};
  const multi = configuredToolCount(printer) > 1;
  const stored = config.prusaToolDesignations && typeof config.prusaToolDesignations === 'object'
    ? (config.prusaToolDesignations[String(index)] || config.prusaToolDesignations[index] || {})
    : {};
  const material = String(
    stored.material ?? (!multi && index === 0 ? config.filamentDesignation : '') ?? ''
  ).trim() || null;
  const color = cleanHexColor(stored.color ?? (!multi && index === 0 ? config.filamentColorDesignation : null));
  const colorFamily = String(
    stored.colorFamily ?? (!multi && index === 0 ? config.filamentColorFamilyDesignation : '') ?? ''
  ).trim().toLowerCase() || null;
  const storedNozzle = Number(stored.nozzleDiameter ?? (!multi && index === 0 ? config.nozzleDiameterDesignation : null));
  const nozzleDiameter = Number.isFinite(storedNozzle) && storedNozzle > 0 ? storedNozzle : null;
  return { material, color, colorFamily, nozzleDiameter };
}

function reportedFilament(source = {}) {
  const material = String(
    source.filament_type ?? source.filamentType ?? source.material ?? source.material_type ?? ''
  ).trim() || null;
  const color = cleanHexColor(source.filament_color ?? source.filamentColor ?? source.color);
  const colorFamily = String(source.color_family ?? source.colorFamily ?? '').trim().toLowerCase() || null;
  const presentValue = source.filament_present ?? source.filamentPresent ?? source.present;
  const present = typeof presentValue === 'boolean' ? presentValue : null;
  return {
    present,
    material,
    materialSource:material ? 'printer' : null,
    color,
    colorSource:color ? 'printer' : null,
    colorFamily,
    colorFamilySource:colorFamily ? 'printer' : null,
    metadataAvailable:Boolean(material || color || colorFamily),
    manuallyAssigned:false,
    reportedMaterial:material,
    reportedColor:color,
    reportedColorFamily:colorFamily
  };
}

function effectiveFilament(printer, index, source = {}) {
  const reported = reportedFilament(source);
  const manual = manualToolDesignation(printer, index);
  return {
    ...reported,
    material:manual.material || reported.material,
    materialSource:manual.material ? 'manual' : reported.materialSource,
    color:manual.color || reported.color,
    colorSource:manual.color ? 'manual' : reported.colorSource,
    colorFamily:manual.colorFamily || reported.colorFamily,
    colorFamilySource:manual.colorFamily ? 'manual' : reported.colorFamilySource,
    metadataAvailable:Boolean(
      manual.material || manual.color || manual.colorFamily
      || reported.metadataAvailable
    ),
    manuallyAssigned:Boolean(manual.material || manual.color || manual.colorFamily)
  };
}

function reportedTools(info = {}, status = {}, telemetry = {}) {
  for (const candidate of [telemetry.tools, status.tools, info.tools, info.toolheads]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function activeToolIndex(status = {}, telemetry = {}) {
  const value = telemetry.active_tool ?? telemetry.activeTool ?? status.active_tool ?? status.activeTool ?? 0;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

export async function getPrusaLinkStatus(printer) {
  const [{ info, version }, status, job] = await Promise.all([
    cachedInfo(printer),
    prusaRequest(printer, '/api/v1/status'),
    prusaRequest(printer, '/api/v1/job').catch((error) => error?.status === 404 ? null : Promise.reject(error))
  ]);
  const telemetry = status?.printer || {};
  const activeJob = job || status?.job || null;
  const toolCount = configuredToolCount(printer);
  const sourceTools = reportedTools(info, status, telemetry);
  const activeTool = Math.min(toolCount - 1, activeToolIndex(status, telemetry));
  const nozzleArray = Array.isArray(info?.nozzle_diameters) ? info.nozzle_diameters : [];
  const scalarReportedNozzle = Number(info?.nozzle_diameter);

  const tools = Array.from({ length:toolCount }, (_, index) => {
    const source = sourceTools.find((item, sourceIndex) => Number(item?.index ?? item?.tool ?? sourceIndex) === index) || {};
    const manual = manualToolDesignation(printer, index);
    const candidateNozzle = Number(
      source.nozzle_diameter
      ?? source.nozzleDiameter
      ?? nozzleArray[index]
      ?? (index === 0 ? scalarReportedNozzle : null)
    );
    const reportedNozzle = Number.isFinite(candidateNozzle) && candidateNozzle > 0 ? candidateNozzle : null;
    const nozzleDiameter = manual.nozzleDiameter || reportedNozzle;
    const isActive = index === activeTool;
    const actual = numeric(
      source.temp_nozzle ?? source.nozzle_temperature ?? source.actual
      ?? (isActive ? telemetry.temp_nozzle : 0)
    );
    const target = numeric(
      source.target_nozzle ?? source.nozzle_target ?? source.target
      ?? (isActive ? telemetry.target_nozzle : 0)
    );
    return {
      index,
      name:`T${index}`,
      actual,
      target,
      active:isActive,
      nozzleDiameter,
      reportedNozzleDiameter:reportedNozzle,
      nozzleDiameterSource:manual.nozzleDiameter ? 'manual' : (reportedNozzle ? 'printer' : null),
      nozzleManuallyAssigned:Boolean(manual.nozzleDiameter),
      filament:effectiveFilament(printer, index, source)
    };
  });

  const jobState = activeJob?.state || telemetry.state;
  const state = normalizeState(jobState);
  const statusMessage = telemetry?.status_printer?.ok === false
    ? (telemetry.status_printer.message || 'Printer requires attention')
    : '';
  const active = tools[activeTool] || tools[0];
  const materialTools = tools.map((tool) => ({ index:tool.index, ...tool.filament }));
  const metadataCount = tools.filter((tool) => tool.filament?.metadataAvailable).length;
  const loadedCount = tools.filter((tool) => tool.filament?.present === true).length;

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
    activeTool,
    nozzle:{ actual:active?.actual || 0, target:active?.target || 0 },
    tools,
    materials:{
      available:metadataCount > 0,
      loadedCount,
      toolCount,
      metadataCount,
      detecting:false,
      tools:materialTools
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
