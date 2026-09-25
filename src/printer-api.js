import { listAllFilesTcp } from './tcp-files.js';
import { runPrinterHttpExclusive } from './printer-http-queue.js';
const DEFAULT_TIMEOUT_MS = 5000;

export const BED_MAX_C = 110;
export const NOZZLE_MAX_C = 265;

export class PrinterApiError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'PrinterApiError';
    this.code = code;
  }
}

function baseUrl(printer) {
  return `http://${printer.host}:${printer.httpPort || 8898}`;
}

function auth(printer) {
  return {
    serialNumber: printer.serialNumber,
    checkCode: printer.checkCode
  };
}

export function printerAuth(printer) {
  return auth(printer);
}

async function post(printer, endpoint, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return runPrinterHttpExclusive(printer, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl(printer)}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new PrinterApiError(`Printer returned HTTP ${response.status}`);
      }

      const data = await response.json();
      // FlashForge firmware has used both negative and positive non-zero codes.
      if (typeof data.code === 'number' && data.code !== 0) {
        if (data.code === -2 || /lan mode error/i.test(String(data.message || ''))) {
          throw new PrinterApiError(
            'Printer LAN API is disabled. On the printer, open Settings > Network/Wi-Fi > Network Mode and enable LAN Only / Local Network Only, then try again.',
            { code: data.code }
          );
        }
        throw new PrinterApiError(data.message || `Printer API error ${data.code}`, { code: data.code });
      }
      return data;
    } catch (error) {
      if (error instanceof PrinterApiError) throw error;
      if (error?.name === 'AbortError') {
        throw new PrinterApiError(`Timed out connecting to ${printer.host}`);
      }
      throw new PrinterApiError(`Could not connect to ${printer.host}: ${error.message}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function postPrinterApi(printer, endpoint, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return post(printer, endpoint, body, timeoutMs);
}

function normalizeFilamentType(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:none|null|unknown|n\/?a)$/i.test(text)) return null;
  return text;
}

export function normalizeStatus(detail = {}) {
  const progressRaw = Number(detail.printProgress ?? 0);
  const progressPercent = progressRaw <= 1 ? progressRaw * 100 : progressRaw;
  const rightFilamentType = normalizeFilamentType(detail.rightFilamentType);

  return {
    status: String(detail.status || 'unknown'),
    printerName: detail.name || null,
    firmwareVersion: detail.firmwareVersion || null,
    pid: detail.pid ?? null,
    fileName: detail.printFileName || null,
    progress: Math.max(0, Math.min(100, progressPercent)),
    currentLayer: Number(detail.printLayer || 0),
    totalLayers: Number(detail.targetPrintLayer || 0),
    remainingSeconds: Number(detail.estimatedTime || 0),
    elapsedSeconds: Number(detail.printDuration || 0),
    nozzle: {
      actual: Number(detail.rightTemp ?? 0),
      target: Number(detail.rightTargetTemp ?? 0)
    },
    tools: [{
      index: 0,
      active: true,
      filament: {
        present: null,
        detecting: false,
        material: rightFilamentType,
        materialVariant: null,
        color: null,
        vendor: null,
        manufacturer: null,
        materialSource: rightFilamentType ? 'printer' : null,
        metadataAvailable: Boolean(rightFilamentType)
      }
    }],
    bed: {
      actual: Number(detail.platTemp ?? 0),
      target: Number(detail.platTargetTemp ?? 0)
    },
    coolingFan: Number(detail.coolingFanSpeed ?? detail.coolingFan ?? 0),
    chamberFan: Number(detail.chamberFanSpeed ?? detail.chamberFan ?? 0),
    light: detail.lightStatus || null,
    tvoc: detail.tvoc ?? null,
    cameraAvailable: Boolean(detail.cameraStreamUrl)
  };
}

export async function getStatus(printer) {
  const response = await post(printer, '/detail', auth(printer));
  return normalizeStatus(response.detail || {});
}

export async function getRecentFiles(printer) {
  const response = await post(printer, '/gcodeList', auth(printer));
  if (Array.isArray(response.gcodeList)) return response.gcodeList.filter(Boolean);
  if (Array.isArray(response.gcodeListDetail)) {
    return response.gcodeListDetail.map((file) => file.gcodeFileName).filter(Boolean);
  }
  return [];
}

function normalizeFileKey(fileName) {
  return String(fileName || '')
    .replace(/\\/g, '/')
    .replace(/^0:\/user\//i, '')
    .replace(/^\/data\//i, '')
    .replace(/^\/+/, '')
    .trim()
    .toLocaleLowerCase();
}

/**
 * Put the printer's recent-job list first, preserving the order reported by
 * /gcodeList (most-recent first on the 5M family). M661 exposes the complete
 * storage directory but does not include last-printed timestamps, so files
 * outside the recent window fall back to natural alphabetical ordering.
 */
export function orderFilesByRecent(fullFiles, recentFiles = []) {
  const full = [...new Set((fullFiles || []).filter(Boolean))];
  const recentRanks = new Map();

  for (const [index, file] of recentFiles.entries()) {
    const key = normalizeFileKey(file);
    if (key && !recentRanks.has(key)) recentRanks.set(key, index);
  }

  return full.sort((a, b) => {
    const aRank = recentRanks.get(normalizeFileKey(a));
    const bRank = recentRanks.get(normalizeFileKey(b));
    const aRecent = aRank !== undefined;
    const bRecent = bRank !== undefined;

    if (aRecent && bRecent) return aRank - bRank;
    if (aRecent) return -1;
    if (bRecent) return 1;

    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export async function getFiles(printer) {
  try {
    const files = await listAllFilesTcp(printer);
    // M661 contains the full directory but no recency metadata. Overlay the
    // HTTP recent list when available so the files the user printed most
    // recently appear at the top of the complete list.
    let recentFiles = [];
    try {
      recentFiles = await getRecentFiles(printer);
    } catch {
      // A failed recent-history lookup should never hide a valid full listing.
    }
    return {
      files: orderFilesByRecent(files, recentFiles),
      recentFiles,
      complete: true,
      source: 'tcp-m661+http-recent',
      ordering: recentFiles.length ? 'last-printed-first' : 'alphabetical',
      warning: null
    };
  } catch (tcpError) {
    // /gcodeList is intentionally limited by 5M/5M Pro firmware to the ten
    // most recent files. Keep it as a graceful fallback when TCP 8899 is
    // blocked/busy, but make the limitation explicit to the UI.
    const files = await getRecentFiles(printer);
    return {
      files,
      recentFiles: files,
      complete: false,
      source: 'http-recent',
      ordering: 'last-printed-first',
      warning: `Full file listing over TCP port ${printer.tcpPort || printer.commandPort || 8899} failed (${tcpError.message}). Showing the printer's 10 most recent files instead.`
    };
  }
}

export async function printLocalFile(printer, fileName, levelingBeforePrint = true) {
  return post(printer, '/printGcode', {
    ...auth(printer),
    fileName,
    levelingBeforePrint: Boolean(levelingBeforePrint)
  }, 10000);
}

export async function control(printer, cmd, args) {
  return post(printer, '/control', {
    ...auth(printer),
    payload: { cmd, args }
  }, 10000);
}

export async function setTemperatures(printer, { nozzle, bed }) {
  const args = {};
  if (nozzle !== undefined) {
    const value = Number(nozzle);
    if (!Number.isFinite(value) || value < 0 || value > NOZZLE_MAX_C) throw new PrinterApiError(`Nozzle must be 0-${NOZZLE_MAX_C} C`);
    args.rightNozzle = value;
  }
  if (bed !== undefined) {
    const value = Number(bed);
    if (!Number.isFinite(value) || value < 0 || value > BED_MAX_C) throw new PrinterApiError(`Bed must be 0-${BED_MAX_C} C`);
    args.platform = value;
  }
  if (Object.keys(args).length === 0) throw new PrinterApiError('No temperature value supplied');
  return control(printer, 'temperatureCtl_cmd', args);
}

export async function setFans(printer, { coolingFan, chamberFan }) {
  const args = {};
  if (coolingFan !== undefined) args.coolingFan = Number(coolingFan);
  if (chamberFan !== undefined) args.chamberFan = Number(chamberFan);
  if (Object.keys(args).length === 0) throw new PrinterApiError('No fan value supplied');
  return control(printer, 'printerCtl_cmd', args);
}

export async function setFiltration(printer, { internal, external }) {
  const args = {};
  if (internal !== undefined) args.internal = internal ? 'open' : 'close';
  if (external !== undefined) args.external = external ? 'open' : 'close';
  if (Object.keys(args).length === 0) throw new PrinterApiError('No filtration value supplied');
  return control(printer, 'circulateCtl_cmd', args);
}

export async function setJobState(printer, action) {
  const map = { pause: 'pause', resume: 'continue', cancel: 'cancel' };
  const printerAction = map[action];
  if (!printerAction) throw new PrinterApiError(`Unsupported job action: ${action}`);
  return control(printer, 'jobCtl_cmd', { jobID: '', action: printerAction });
}

export async function levelBed(printer) {
  return control(printer, 'calibration_cmd', {
    levelingDetection: 'open',
    vibrationCompensation: 'close'
  });
}

export async function openCamera(printer) {
  await control(printer, 'streamCtrl_cmd', { action: 'open' });
  const response = await post(printer, '/detail', auth(printer)).catch(() => null);
  return response?.detail?.cameraStreamUrl || `http://${printer.host}:${printer.cameraPort || 8080}/?action=stream`;
}

export function fallbackCameraUrl(printer) {
  return `http://${printer.host}:${printer.cameraPort || 8080}/?action=stream`;
}
