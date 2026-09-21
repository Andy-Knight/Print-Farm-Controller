import http from 'node:http';
import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 5000;
const UPLOAD_TIMEOUT_MS = 180000;
export const SNAPMAKER_U1_BED_MAX_C = 100;
export const SNAPMAKER_U1_NOZZLE_MAX_C = 300;
export const SNAPMAKER_U1_TOOL_COUNT = 4;

export class MoonrakerApiError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'MoonrakerApiError';
    this.status = status;
  }
}

export function moonrakerBaseUrl(printer) {
  return `http://${printer.host}:${Number(printer.httpPort || 7125)}`;
}

function apiKey(printer) {
  return String(printer?.adapterConfig?.apiKey || '').trim();
}

function moonrakerHeaders(printer, extra = {}) {
  const key = apiKey(printer);
  return {
    accept: 'application/json',
    ...(key ? { 'X-Api-Key': key } : {}),
    ...extra
  };
}

function unwrapMoonrakerPayload(data) {
  if (data && typeof data === 'object' && data.error) {
    const message = data.error.message || data.error.error || 'Moonraker API error';
    throw new MoonrakerApiError(message);
  }
  if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'result')) return data.result;
  return data;
}

export async function moonrakerRequest(printer, endpoint, {
  method = 'GET',
  body = undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {}
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${moonrakerBaseUrl(printer)}${endpoint}`, {
      method,
      headers: moonrakerHeaders(printer, {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers
      }),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || (typeof data === 'string' ? data : '');
      const authHint = response.status === 401 || response.status === 403
        ? ' Check Moonraker trusted-clients/API-key settings.'
        : '';
      throw new MoonrakerApiError(`Moonraker returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.${authHint}`.replace('..', '.'), { status: response.status });
    }
    return unwrapMoonrakerPayload(data);
  } catch (error) {
    if (error instanceof MoonrakerApiError) throw error;
    if (error?.name === 'AbortError') throw new MoonrakerApiError(`Timed out connecting to Moonraker at ${printer.host}:${printer.httpPort || 7125}`);
    throw new MoonrakerApiError(`Could not connect to Moonraker at ${printer.host}:${printer.httpPort || 7125}: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

const TOOL_OBJECTS = ['extruder', 'extruder1', 'extruder2', 'extruder3'];
const FILAMENT_SENSOR_OBJECTS = TOOL_OBJECTS.map((_, index) => `filament_motion_sensor e${index}_filament`);
const STATUS_QUERY = [
  'webhooks', 'print_stats', 'virtual_sdcard', 'display_status', 'heater_bed',
  ...TOOL_OBJECTS, 'toolhead', 'temperature_sensor cavity', 'fan_generic cavity_fan', 'purifier'
].map((name) => encodeURIComponent(name)).join('&');
const MATERIAL_STATUS_QUERY = ['filament_detect', 'print_task_config', 'extruder_offset_calibration', ...FILAMENT_SENSOR_OBJECTS]
  .map((name) => encodeURIComponent(name)).join('&');

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function activeToolIndex(toolhead = {}) {
  const active = String(toolhead.extruder || 'extruder');
  const index = TOOL_OBJECTS.indexOf(active);
  return index >= 0 ? index : 0;
}

function cleanFilamentText(value) {
  const text = String(value ?? '').trim();
  return !text || text.toUpperCase() === 'NONE' || text.toUpperCase() === 'UNKNOWN' ? null : text;
}

function filamentColorHex(value) {
  if (value === null || value === undefined || value === '') return null;
  let number;
  if (typeof value === 'string') {
    const text = value.trim();
    number = /^0x/i.test(text) ? Number.parseInt(text.slice(2), 16) : Number(text);
  } else {
    number = Number(value);
  }
  if (!Number.isFinite(number)) return null;
  const rgb = (number >>> 0) & 0xFFFFFF;
  return `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`;
}

function filamentRgbaHex(value) {
  const text = String(value ?? '').trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9A-Fa-f]{8}$/.test(text)) return null;
  return `#${text.slice(0, 6).toUpperCase()}`;
}

function arrayValue(source, key, index) {
  const values = source && Array.isArray(source[key]) ? source[key] : [];
  return values[index];
}

export function normalizeSnapmakerFilament(objects = {}) {
  const detector = objects.filament_detect || {};
  const taskConfig = objects.print_task_config || {};
  const info = Array.isArray(detector.info) ? detector.info : [];
  const detectorState = Array.isArray(detector.state) ? detector.state : [];
  return TOOL_OBJECTS.map((_, index) => {
    const sensor = objects[FILAMENT_SENSOR_OBJECTS[index]] || null;
    const meta = info[index] && typeof info[index] === 'object' ? info[index] : {};
    const sensorEnabled = sensor ? sensor.enabled !== false : null;
    const present = sensor ? (sensorEnabled ? Boolean(sensor.filament_detected) : null) : null;

    const rfidVendor = cleanFilamentText(meta.VENDOR);
    const rfidManufacturer = cleanFilamentText(meta.MANUFACTURER);
    const rfidMaterial = cleanFilamentText(meta.MAIN_TYPE);
    const rfidVariant = cleanFilamentText(meta.SUB_TYPE);
    const rfidColor = Number(meta.ARGB_COLOR) ? filamentColorHex(meta.ARGB_COLOR) : null;
    const rfidMetadataAvailable = Boolean(rfidVendor || rfidManufacturer || rfidMaterial || rfidVariant || rfidColor);

    // print_task_config is Snapmaker's effective per-tool material configuration.
    // It contains both RFID-derived values and manual assignments made on the U1
    // touchscreen. Prefer it whenever it carries meaningful data; fall back to the
    // raw RFID record when a firmware variant does not expose the task config.
    const configuredVendor = cleanFilamentText(arrayValue(taskConfig, 'filament_vendor', index));
    const configuredMaterial = cleanFilamentText(arrayValue(taskConfig, 'filament_type', index));
    const configuredVariant = cleanFilamentText(arrayValue(taskConfig, 'filament_sub_type', index));
    const configuredColor = filamentRgbaHex(arrayValue(taskConfig, 'filament_color_rgba', index));
    const configuredOfficial = arrayValue(taskConfig, 'filament_official', index);
    const configuredExists = arrayValue(taskConfig, 'filament_exist', index);
    const configuredEditable = arrayValue(taskConfig, 'filament_edit', index);
    const configuredMeaningful = Boolean(configuredVendor || configuredMaterial || configuredVariant ||
      (configuredColor && configuredColor !== '#FFFFFF'));

    const materialSource = configuredMeaningful
      ? (configuredOfficial === true ? 'rfid' : 'manual')
      : (rfidMetadataAvailable ? 'rfid' : null);
    const vendor = configuredMeaningful ? (configuredVendor || rfidVendor) : rfidVendor;
    const manufacturer = rfidManufacturer;
    const material = configuredMeaningful ? (configuredMaterial || rfidMaterial) : rfidMaterial;
    const materialVariant = configuredMeaningful ? (configuredVariant || rfidVariant) : rfidVariant;
    const color = configuredMeaningful ? (configuredColor || rfidColor) : rfidColor;
    const metadataAvailable = Boolean(vendor || manufacturer || material || materialVariant || color);

    return {
      index,
      present,
      sensorEnabled,
      detecting: Number(detectorState[index]) === 1,
      metadataAvailable,
      rfidMetadataAvailable,
      materialSource,
      manuallyAssigned: materialSource === 'manual',
      officialFilament: configuredOfficial === true,
      configuredExists: typeof configuredExists === 'boolean' ? configuredExists : null,
      editable: typeof configuredEditable === 'boolean' ? configuredEditable : (configuredOfficial === true ? false : null),
      colorEditable: typeof configuredEditable === 'boolean' ? configuredEditable : (configuredOfficial === true ? false : null),
      vendor,
      manufacturer,
      material,
      materialVariant,
      color
    };
  });
}

export function normalizeMoonrakerStatus(objects = {}, printerInfo = {}) {
  const printStats = objects.print_stats || {};
  const virtualSd = objects.virtual_sdcard || {};
  const display = objects.display_status || {};
  const hooks = objects.webhooks || {};
  const taskConfig = objects.print_task_config || {};
  const activeIndex = activeToolIndex(objects.toolhead || {});
  const filamentTools = normalizeSnapmakerFilament(objects);
  const tools = TOOL_OBJECTS.map((heater, index) => {
    const source = objects[heater] || {};
    const filament = filamentTools[index] || {};
    return {
      index,
      name: `T${index}`,
      heater,
      actual: numeric(source.temperature),
      target: numeric(source.target),
      active: index === activeIndex,
      nozzleDiameter: Number.isFinite(Number(source.nozzle_diameter)) ? Number(source.nozzle_diameter) : null,
      nozzleVolumeType: cleanFilamentText(source.nozzle_volume_type),
      offset: Array.isArray(source.extruder_offset) && source.extruder_offset.length >= 3
        ? source.extruder_offset.slice(0, 3).map((value) => Number(value)).map((value) => Number.isFinite(value) ? value : 0)
        : null,
      filament
    };
  });
  const activeTool = tools[activeIndex] || tools[0];
  const progressRaw = Math.max(numeric(display.progress), numeric(virtualSd.progress));
  const progress = Math.max(0, Math.min(100, progressRaw <= 1 ? progressRaw * 100 : progressRaw));
  const elapsedSeconds = numeric(printStats.print_duration ?? printStats.total_duration);
  const progressFraction = progress / 100;
  const remainingSeconds = progressFraction > 0.01 && progressFraction < 1
    ? Math.max(0, Math.round(elapsedSeconds * (1 - progressFraction) / progressFraction))
    : 0;
  const klippyReady = !hooks.state || String(hooks.state).toLowerCase() === 'ready';
  let state = String(printStats.state || 'standby').toLowerCase();
  if (!klippyReady) state = 'error';
  if (['standby', 'complete', 'cancelled'].includes(state)) state = 'idle';

  return {
    status: state,
    statusMessage: !klippyReady ? (hooks.state_message || hooks.message || 'Klipper is not ready') : (printStats.message || ''),
    printerName: printerInfo.hostname || null,
    firmwareVersion: printerInfo.software_version || printerInfo.softwareVersion || null,
    fileName: printStats.filename || null,
    progress,
    currentLayer: numeric(printStats.info?.current_layer),
    totalLayers: numeric(printStats.info?.total_layer),
    remainingSeconds,
    elapsedSeconds,
    activeTool: activeIndex,
    nozzle: {
      actual: activeTool?.actual || 0,
      target: activeTool?.target || 0
    },
    tools,
    materials: {
      available: filamentTools.some((tool) => tool.present !== null || tool.metadataAvailable),
      loadedCount: filamentTools.filter((tool) => tool.present === true).length,
      toolCount: filamentTools.length,
      metadataCount: filamentTools.filter((tool) => tool.metadataAvailable).length,
      detecting: filamentTools.some((tool) => tool.detecting),
      tools: filamentTools
    },
    printPreferences: {
      timeLapseCamera: typeof taskConfig.time_lapse_camera === 'boolean' ? taskConfig.time_lapse_camera : null,
      autoReplenishFilament: typeof taskConfig.auto_replenish_filament === 'boolean' ? taskConfig.auto_replenish_filament : null,
      replenishIgnoreColor: typeof taskConfig.replenish_ignore_color === 'boolean' ? taskConfig.replenish_ignore_color : null,
      filamentEntangleDetect: typeof taskConfig.filament_entangle_detect === 'boolean' ? taskConfig.filament_entangle_detect : null,
      filamentEntangleSensitivity: ['low', 'medium', 'high'].includes(String(taskConfig.filament_entangle_sen || '').toLowerCase())
        ? String(taskConfig.filament_entangle_sen).toLowerCase()
        : null
    },
    toolOffsetCalibration: (() => {
      const calibration = objects.extruder_offset_calibration || {};
      const available = Object.keys(calibration).length > 0;
      return {
        available,
        state: cleanFilamentText(calibration.calibration_step) || (available ? 'idle' : null),
        bedPlateCheck: typeof calibration.bed_plate_check === 'boolean' ? calibration.bed_plate_check : null,
        prehomed: typeof calibration.is_prehoming === 'boolean' ? calibration.is_prehoming : null,
        tools: TOOL_OBJECTS.map((heater, index) => ({
          index,
          result: Array.isArray(calibration[`${heater}_last_xyz_result`])
            ? calibration[`${heater}_last_xyz_result`].slice(0, 3).map((value) => Number(value))
            : null,
          nozzleClean: typeof calibration[`${heater}_nozzle_clean`] === 'boolean' ? calibration[`${heater}_nozzle_clean`] : null
        }))
      };
    })(),
    bed: {
      actual: numeric(objects.heater_bed?.temperature),
      target: numeric(objects.heater_bed?.target)
    },
    chamber: {
      actual: Number.isFinite(Number(objects['temperature_sensor cavity']?.temperature)) ? Number(objects['temperature_sensor cavity'].temperature) : null
    },
    coolingFan: 0,
    chamberFan: Math.max(0, Math.min(100, numeric(objects['fan_generic cavity_fan']?.speed) * 100)),
    filtration: {
      available: Boolean(objects.purifier) && objects.purifier.power_detected !== false,
      internal: Math.max(0, Math.min(100, numeric(objects.purifier?.inner_fan?.speed) * 100)),
      external: Math.max(0, Math.min(100, numeric(objects.purifier?.exhaust_fan?.speed) * 100)),
      internalRpm: Number.isFinite(Number(objects.purifier?.inner_fan_rpm)) ? Number(objects.purifier.inner_fan_rpm) : null
    },
    cameraAvailable: true
  };
}

const printerInfoCache = new Map();
async function getCachedPrinterInfo(printer) {
  const key = `${printer.host}:${printer.httpPort || 7125}`;
  const cached = printerInfoCache.get(key);
  if (cached && Date.now() - cached.at < 300000) return cached.value;
  try {
    const value = await moonrakerRequest(printer, '/printer/info');
    printerInfoCache.set(key, { at: Date.now(), value: value || {} });
    return value || {};
  } catch {
    return cached?.value || {};
  }
}

export async function getMoonrakerStatus(printer) {
  const [query, materialQuery, info] = await Promise.all([
    moonrakerRequest(printer, `/printer/objects/query?${STATUS_QUERY}`),
    // Material sensing is useful but must never make the core U1 status poll fail on
    // firmware variants that omit one of Snapmaker's RFID/sensor objects.
    moonrakerRequest(printer, `/printer/objects/query?${MATERIAL_STATUS_QUERY}`).catch(() => ({ status:{} })),
    getCachedPrinterInfo(printer)
  ]);
  const status = {
    ...(query?.status || query || {}),
    ...(materialQuery?.status || materialQuery || {})
  };
  return normalizeMoonrakerStatus(status, info);
}

function normalizeFileName(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

export function orderMoonrakerFilesByHistory(fileEntries = [], historyJobs = []) {
  const entries = [...fileEntries].filter((entry) => entry?.path);
  const rank = new Map();
  for (const job of historyJobs || []) {
    const name = normalizeFileName(job?.filename).toLocaleLowerCase();
    if (name && !rank.has(name)) rank.set(name, rank.size);
  }
  return entries.sort((a, b) => {
    const ar = rank.get(normalizeFileName(a.path).toLocaleLowerCase());
    const br = rank.get(normalizeFileName(b.path).toLocaleLowerCase());
    if (ar !== undefined && br !== undefined) return ar - br;
    if (ar !== undefined) return -1;
    if (br !== undefined) return 1;
    const modifiedDiff = numeric(b.modified) - numeric(a.modified);
    if (modifiedDiff) return modifiedDiff;
    return String(a.path).localeCompare(String(b.path), undefined, { numeric: true, sensitivity: 'base' });
  });
}

export async function getMoonrakerFiles(printer) {
  const [files, history] = await Promise.all([
    moonrakerRequest(printer, '/server/files/list?root=gcodes'),
    moonrakerRequest(printer, '/server/history/list?limit=100&order=desc').catch(() => ({ jobs: [] }))
  ]);
  const entries = Array.isArray(files) ? files : (files?.files || []);
  const jobs = Array.isArray(history?.jobs) ? history.jobs : [];
  const ordered = orderMoonrakerFilesByHistory(entries, jobs);
  return {
    files: ordered.map((entry) => normalizeFileName(entry.path)),
    recentFiles: jobs.map((job) => normalizeFileName(job.filename)).filter(Boolean),
    complete: true,
    source: 'moonraker-files+history',
    ordering: jobs.length ? 'last-printed-first' : 'modified-newest-first',
    warning: null
  };
}

function splitMetadataList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim());
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.includes(';')) return text.split(';').map((item) => item.trim());
  if (text.includes(',')) return text.split(',').map((item) => item.trim());
  return [text];
}

function normalizeHexColor(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const prefixed = text.startsWith('#') ? text : `#${text}`;
  if (/^#[0-9A-Fa-f]{8}$/.test(prefixed)) return prefixed.slice(0, 7).toUpperCase();
  if (/^#[0-9A-Fa-f]{6}$/.test(prefixed)) return prefixed.toUpperCase();
  return null;
}

function parseSlicerConfig(text = '') {
  const result = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*;\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (!result[key]) result[key] = match[2].trim();
  }
  return result;
}

function firstConfigValue(config, keys) {
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(config, key)) return config[key];
  return null;
}

function parseNumberList(value) {
  return splitMetadataList(value).map((item) => Number.parseFloat(item)).map((number) => Number.isFinite(number) ? number : null);
}

async function readResponsePrefix(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const take = Math.min(value.length, maxBytes - total);
      chunks.push(Buffer.from(value.subarray(0, take)));
      total += take;
      if (take < value.length || total >= maxBytes) break;
    }
  } finally {
    if (total >= maxBytes) await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

function encodedGcodePath(fileName) {
  return normalizeFileName(fileName).split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function readMoonrakerFileRange(printer, fileName, start, end, { maxBytes = 262144 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${moonrakerBaseUrl(printer)}/server/files/gcodes/${encodedGcodePath(fileName)}`, {
      headers: moonrakerHeaders(printer, { range: `bytes=${Math.max(0, start)}-${Math.max(start, end)}` }),
      signal: controller.signal
    });
    if (!response.ok && response.status !== 206) throw new MoonrakerApiError(`Moonraker file read returned HTTP ${response.status}`, { status: response.status });
    return await readResponsePrefix(response, maxBytes);
  } finally {
    clearTimeout(timer);
  }
}

export async function getMoonrakerPrintSetup(printer, fileName) {
  const normalized = normalizeFileName(fileName);
  if (!normalized) throw new MoonrakerApiError('fileName is required');

  const metadata = await moonrakerRequest(printer, `/server/files/metadata?filename=${encodeURIComponent(normalized)}`).catch(() => ({}));
  const size = Number(metadata?.size || 0);
  let snippet = '';
  try {
    const chunkSize = 262144;
    const head = await readMoonrakerFileRange(printer, normalized, 0, chunkSize - 1, { maxBytes: chunkSize });
    let tail = '';
    if (size > chunkSize) {
      const tailStart = Math.max(0, size - chunkSize);
      tail = await readMoonrakerFileRange(printer, normalized, tailStart, Math.max(tailStart, size - 1), { maxBytes: chunkSize });
    }
    snippet = `${head}\n${tail}`;
  } catch {
    // Moonraker metadata alone is enough on current versions; range reads are
    // a bounded fallback for older U1 firmware/slicer combinations.
  }

  const config = parseSlicerConfig(snippet);
  const metadataColors = splitMetadataList(metadata?.filament_colors).map(normalizeHexColor);
  const metadataExtruderColors = splitMetadataList(metadata?.extruder_colors).map(normalizeHexColor);
  const configColors = splitMetadataList(firstConfigValue(config, ['filament_colour', 'filament_color', 'extruder_colour', 'extruder_color'])).map(normalizeHexColor);
  const colors = metadataColors.length ? metadataColors : metadataExtruderColors.length ? metadataExtruderColors : configColors;

  const metadataTypes = splitMetadataList(metadata?.filament_type);
  const configTypes = splitMetadataList(firstConfigValue(config, ['filament_type', 'filament_types']));
  const types = metadataTypes.length ? metadataTypes : configTypes;
  const names = splitMetadataList(metadata?.filament_name);

  const metadataWeights = Array.isArray(metadata?.filament_weights)
    ? metadata.filament_weights.map((item) => Number(item))
    : [];
  const configWeights = parseNumberList(firstConfigValue(config, ['filament used [g]', 'filament_used_g']));
  const weights = metadataWeights.length ? metadataWeights : configWeights;

  const metadataNozzles = parseNumberList(metadata?.nozzle_diameter ?? metadata?.nozzle_diameters);
  const configNozzles = parseNumberList(firstConfigValue(config, ['nozzle_diameter', 'nozzle_diameters']));
  const nozzleDiameters = metadataNozzles.some((value) => value != null) ? metadataNozzles : configNozzles;

  const referenced = new Set(
    (Array.isArray(metadata?.referenced_tools) ? metadata.referenced_tools : [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0)
  );
  for (let index = 0; index < weights.length; index++) {
    if (Number(weights[index]) > 0) referenced.add(index);
  }
  for (const line of snippet.split(/\r?\n/)) {
    const code = line.split(';')[0].trim();
    const match = code.match(/^T(\d+)\b/i);
    if (match) referenced.add(Number(match[1]));
  }

  let usageReliable = referenced.size > 0;
  if (!referenced.size) {
    const count = Math.max(colors.length, types.length, names.length, 1);
    for (let index = 0; index < count; index++) referenced.add(index);
    usageReliable = count === 1;
  }

  const referencedTools = [...referenced].filter((index) => Number.isInteger(index) && index >= 0).sort((a, b) => a - b);
  const logicalTools = referencedTools.map((index) => ({
    index,
    color: colors[index] || null,
    material: cleanFilamentText(types[index] ?? (types.length === 1 ? types[0] : null)),
    name: cleanFilamentText(names[index] ?? (names.length === 1 ? names[0] : null)),
    weightGrams: Number.isFinite(Number(weights[index])) ? Number(weights[index]) : null,
    nozzleDiameter: Number.isFinite(Number(nozzleDiameters[index]))
      ? Number(nozzleDiameters[index])
      : (nozzleDiameters.length === 1 && Number.isFinite(Number(nozzleDiameters[0])) ? Number(nozzleDiameters[0]) : null)
  }));

  return {
    fileName: normalized,
    slicer: cleanFilamentText(metadata?.slicer),
    slicerVersion: cleanFilamentText(metadata?.slicer_version),
    referencedTools,
    logicalTools,
    usageReliable,
    source: Array.isArray(metadata?.referenced_tools) && metadata.referenced_tools.length ? 'moonraker-metadata' : (snippet ? 'metadata+gcode-fallback' : 'moonraker-metadata-fallback'),
    warning: usageReliable ? null : 'The file did not expose reliable used-tool metadata, so all detected palette entries are shown.'
  };
}

export async function verifyMoonrakerFile(printer, fileName) {
  const wanted = normalizeFileName(fileName).toLocaleLowerCase();
  try {
    const files = await moonrakerRequest(printer, '/server/files/list?root=gcodes');
    const entries = Array.isArray(files) ? files : (files?.files || []);
    const verified = entries.some((entry) => normalizeFileName(entry.path).toLocaleLowerCase() === wanted);
    return {
      verified,
      source: 'moonraker-files',
      ...(!verified ? { warning: 'Upload completed, but the file was not visible in Moonraker storage verification.' } : {})
    };
  } catch (error) {
    return { verified: false, source: null, warning: `Moonraker file verification failed: ${error.message}` };
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function multipartField(boundary, name, value) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8');
}

export async function uploadMoonrakerFile(printer, filePath, { fileName = null } = {}) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new MoonrakerApiError('Upload source is not a file');
  const remoteName = normalizeFileName(fileName || path.basename(filePath));
  if (!/\.(?:gcode|gco|g)$/i.test(remoteName)) {
    throw new MoonrakerApiError('Snapmaker U1 / Moonraker upload currently supports G-code files (.gcode, .gco, .g)');
  }

  const checksum = await sha256File(filePath);
  const boundary = `----PrintFleet${crypto.randomBytes(12).toString('hex')}`;
  const fields = Buffer.concat([
    multipartField(boundary, 'root', 'gcodes'),
    multipartField(boundary, 'checksum', checksum)
  ]);
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${remoteName.replace(/["\r\n]/g, '_')}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    'utf8'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const contentLength = fields.length + fileHeader.length + stats.size + suffix.length;
  const base = new URL(moonrakerBaseUrl(printer));

  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: base.hostname,
      port: Number(base.port || 80),
      path: '/server/files/upload',
      method: 'POST',
      headers: moonrakerHeaders(printer, {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': contentLength
      })
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
          reject(new MoonrakerApiError(`Moonraker upload returned HTTP ${response.statusCode}: ${data?.error?.message || data?.message || 'upload failed'}`, { status: response.statusCode }));
          return;
        }
        try { resolve(unwrapMoonrakerPayload(data)); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(UPLOAD_TIMEOUT_MS, () => request.destroy(new MoonrakerApiError('Moonraker file upload timed out')));
    request.once('error', reject);
    request.write(fields);
    request.write(fileHeader);
    const source = createReadStream(filePath);
    source.once('error', (error) => request.destroy(error));
    source.once('end', () => request.end(suffix));
    source.pipe(request, { end: false });
  });
}

function encodeGcodeScript(script) {
  return `/printer/gcode/script?script=${encodeURIComponent(script)}`;
}

export async function runMoonrakerGcode(printer, script, { timeoutMs = 15000 } = {}) {
  return moonrakerRequest(printer, encodeGcodeScript(script), { method: 'POST', timeoutMs });
}

function validateTemperature(value, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new MoonrakerApiError(`${label} must be 0-${max} C`);
  return number;
}

export async function setMoonrakerFilamentColor(printer, { toolIndex, color } = {}) {
  const index = Number(toolIndex);
  if (!Number.isInteger(index) || index < 0 || index >= SNAPMAKER_U1_TOOL_COUNT) {
    throw new MoonrakerApiError('Tool index must be 0-3');
  }
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor || !/^#[0-9A-F]{6}$/.test(normalizedColor)) {
    throw new MoonrakerApiError('Filament colour must be a 6-digit RGB hex value');
  }

  const current = await moonrakerRequest(printer, '/printer/objects/query?print_stats&print_task_config');
  const status = current?.status || current || {};
  const printState = String(status.print_stats?.state || 'unknown').toLowerCase();
  if (!['standby', 'complete', 'cancelled'].includes(printState)) {
    throw new MoonrakerApiError('U1 filament colour can only be changed while the printer is idle');
  }

  const taskConfig = status.print_task_config || {};
  const exists = arrayValue(taskConfig, 'filament_exist', index);
  if (exists !== true) throw new MoonrakerApiError(`No filament is loaded in U1 T${index}`);

  const material = cleanFilamentText(arrayValue(taskConfig, 'filament_type', index));
  const official = arrayValue(taskConfig, 'filament_official', index);
  const editable = arrayValue(taskConfig, 'filament_edit', index);
  if (!material) throw new MoonrakerApiError(`U1 T${index} has no manually assigned filament material to edit`);
  if (official === true || editable === false) {
    throw new MoonrakerApiError(`U1 T${index} colour is locked by its official Snapmaker RFID filament`);
  }

  const rgba = `${normalizedColor.slice(1)}FF`;
  await runMoonrakerGcode(
    printer,
    `SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER='${index}' FILAMENT_COLOR_RGBA='${rgba}' SAVE='1'`
  );

  const verified = await moonrakerRequest(printer, '/printer/objects/query?print_task_config');
  const verifiedStatus = verified?.status || verified || {};
  const reported = String(arrayValue(verifiedStatus.print_task_config || {}, 'filament_color_rgba', index) || '').toUpperCase();
  if (reported !== rgba) {
    throw new MoonrakerApiError(`U1 did not confirm the filament colour change for T${index}`);
  }
  return { toolIndex:index, color:normalizedColor, rgba, verified:true };
}

export const SNAPMAKER_U1_GENERIC_FILAMENT_TYPES = Object.freeze([
  'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PVA', 'PA', 'PA-CF', 'PA-GF',
  'PA6-CF', 'PA6-GF', 'PC', 'PC-ABS', 'PETG-CF', 'PLA-CF', 'PEBA'
]);

export async function setMoonrakerFilamentConfig(printer, { toolIndex, material, color } = {}) {
  const index = Number(toolIndex);
  if (!Number.isInteger(index) || index < 0 || index >= SNAPMAKER_U1_TOOL_COUNT) {
    throw new MoonrakerApiError('Tool index must be 0-3');
  }
  const normalizedMaterial = String(material || '').trim().toUpperCase();
  if (!SNAPMAKER_U1_GENERIC_FILAMENT_TYPES.includes(normalizedMaterial)) {
    throw new MoonrakerApiError(`Unsupported U1 filament type: ${normalizedMaterial || 'empty'}`);
  }
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor || !/^#[0-9A-F]{6}$/.test(normalizedColor)) {
    throw new MoonrakerApiError('Filament colour must be a 6-digit RGB hex value');
  }

  const current = await moonrakerRequest(printer, '/printer/objects/query?print_stats&print_task_config');
  const status = current?.status || current || {};
  const printState = String(status.print_stats?.state || 'unknown').toLowerCase();
  if (!['standby', 'complete', 'cancelled'].includes(printState)) {
    throw new MoonrakerApiError('U1 filament configuration can only be changed while the printer is idle');
  }

  const taskConfig = status.print_task_config || {};
  const exists = arrayValue(taskConfig, 'filament_exist', index);
  if (exists !== true) throw new MoonrakerApiError(`No filament is loaded in U1 T${index}`);
  const official = arrayValue(taskConfig, 'filament_official', index);
  const editable = arrayValue(taskConfig, 'filament_edit', index);
  if (official === true || editable === false) {
    throw new MoonrakerApiError(`U1 T${index} material is locked by its official Snapmaker RFID filament`);
  }

  const vendor = 'generic';
  const subtype = 'generic';
  const rgba = `${normalizedColor.slice(1)}FF`;
  await runMoonrakerGcode(
    printer,
    `SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER='${index}' VENDOR='${vendor}' FILAMENT_TYPE='${normalizedMaterial}' FILAMENT_SUBTYPE='${subtype}' FILAMENT_COLOR_RGBA='${rgba}' SAVE='1'`
  );

  const verified = await moonrakerRequest(printer, '/printer/objects/query?print_task_config');
  const verifiedStatus = verified?.status || verified || {};
  const verifiedConfig = verifiedStatus.print_task_config || {};
  const reportedMaterial = cleanFilamentText(arrayValue(verifiedConfig, 'filament_type', index));
  const reportedVendor = cleanFilamentText(arrayValue(verifiedConfig, 'filament_vendor', index));
  const reportedSubtype = cleanFilamentText(arrayValue(verifiedConfig, 'filament_sub_type', index));
  const reportedRgba = String(arrayValue(verifiedConfig, 'filament_color_rgba', index) || '').toUpperCase();
  if (reportedMaterial !== normalizedMaterial || reportedVendor?.toLowerCase() !== vendor ||
      reportedSubtype?.toLowerCase() !== subtype || reportedRgba !== rgba) {
    throw new MoonrakerApiError(`U1 did not confirm the filament configuration change for T${index}`);
  }
  return { toolIndex:index, material:normalizedMaterial, color:normalizedColor, rgba, vendor, subtype, verified:true };
}

export async function setMoonrakerFilamentType(printer, { toolIndex, material } = {}) {
  const index = Number(toolIndex);
  if (!Number.isInteger(index) || index < 0 || index >= SNAPMAKER_U1_TOOL_COUNT) {
    throw new MoonrakerApiError('Tool index must be 0-3');
  }
  const normalizedMaterial = String(material || '').trim().toUpperCase();
  if (!SNAPMAKER_U1_GENERIC_FILAMENT_TYPES.includes(normalizedMaterial)) {
    throw new MoonrakerApiError(`Unsupported U1 filament type: ${normalizedMaterial || 'empty'}`);
  }

  const current = await moonrakerRequest(printer, '/printer/objects/query?print_stats&print_task_config');
  const status = current?.status || current || {};
  const printState = String(status.print_stats?.state || 'unknown').toLowerCase();
  if (!['standby', 'complete', 'cancelled'].includes(printState)) {
    throw new MoonrakerApiError('U1 filament type can only be changed while the printer is idle');
  }

  const taskConfig = status.print_task_config || {};
  const exists = arrayValue(taskConfig, 'filament_exist', index);
  if (exists !== true) throw new MoonrakerApiError(`No filament is loaded in U1 T${index}`);

  const official = arrayValue(taskConfig, 'filament_official', index);
  const editable = arrayValue(taskConfig, 'filament_edit', index);
  if (official === true || editable === false) {
    throw new MoonrakerApiError(`U1 T${index} material is locked by its official Snapmaker RFID filament`);
  }

  const vendor = 'generic';
  const subtype = 'generic';
  await runMoonrakerGcode(
    printer,
    `SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER='${index}' VENDOR='${vendor}' FILAMENT_TYPE='${normalizedMaterial}' FILAMENT_SUBTYPE='${subtype}' SAVE='1'`
  );

  const verified = await moonrakerRequest(printer, '/printer/objects/query?print_task_config');
  const verifiedStatus = verified?.status || verified || {};
  const verifiedConfig = verifiedStatus.print_task_config || {};
  const reportedMaterial = cleanFilamentText(arrayValue(verifiedConfig, 'filament_type', index));
  const reportedVendor = cleanFilamentText(arrayValue(verifiedConfig, 'filament_vendor', index));
  const reportedSubtype = cleanFilamentText(arrayValue(verifiedConfig, 'filament_sub_type', index));
  if (reportedMaterial !== normalizedMaterial || reportedVendor?.toLowerCase() !== vendor || reportedSubtype?.toLowerCase() !== subtype) {
    throw new MoonrakerApiError(`U1 did not confirm the filament type change for T${index}`);
  }
  return { toolIndex:index, material:normalizedMaterial, vendor, subtype, verified:true };
}

export async function setMoonrakerTemperatures(printer, { nozzle, bed, toolIndex, allTools = false } = {}) {
  const commands = [];
  if (bed !== undefined) {
    const value = validateTemperature(bed, SNAPMAKER_U1_BED_MAX_C, 'Bed');
    commands.push(`SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${value}`);
  }
  if (nozzle !== undefined) {
    const value = validateTemperature(nozzle, SNAPMAKER_U1_NOZZLE_MAX_C, 'Nozzle');
    if (allTools) {
      for (const heater of TOOL_OBJECTS) commands.push(`SET_HEATER_TEMPERATURE HEATER=${heater} TARGET=${value}`);
    } else if (toolIndex !== undefined && toolIndex !== null) {
      const index = Number(toolIndex);
      if (!Number.isInteger(index) || index < 0 || index >= TOOL_OBJECTS.length) throw new MoonrakerApiError('Tool index must be 0-3');
      commands.push(`SET_HEATER_TEMPERATURE HEATER=${TOOL_OBJECTS[index]} TARGET=${value}`);
    } else {
      // Standard Klipper M104 without a T parameter applies to the currently active extruder.
      commands.push(`M104 S${value}`);
    }
  }
  if (!commands.length) throw new MoonrakerApiError('No temperature value supplied');
  return runMoonrakerGcode(printer, commands.join('\n'));
}


function validatePercent(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new MoonrakerApiError(`${label} must be 0-100%`);
  return number;
}

export async function setMoonrakerFans(printer, { chamberFan } = {}) {
  if (chamberFan === undefined) throw new MoonrakerApiError('No supported fan value supplied');
  const percent = validatePercent(chamberFan, 'Chamber fan');
  return runMoonrakerGcode(printer, `SET_FAN_SPEED FAN=cavity_fan SPEED=${percent / 100}`);
}

export async function setMoonrakerFiltration(printer, { internal, external } = {}) {
  const commands = [];
  if (internal !== undefined) {
    const percent = validatePercent(internal, 'Internal purifier fan');
    commands.push(`SET_PURIFIER FAN=inner SPEED=${percent / 100} DELAY_OFF=0`);
  }
  if (external !== undefined) {
    const percent = validatePercent(external, 'Exhaust purifier fan');
    commands.push(`SET_PURIFIER FAN=exhaust SPEED=${percent / 100} DELAY_OFF=0`);
  }
  if (!commands.length) throw new MoonrakerApiError('No purifier control value supplied');
  return runMoonrakerGcode(printer, commands.join('\n'));
}

export async function startMoonrakerChamberPreheat(printer, { fanPercent = 60 } = {}) {
  const percent = validatePercent(fanPercent, 'Chamber preheat circulation fan');
  return runMoonrakerGcode(
    printer,
    `SET_PURIFIER_MODE MODE=2 DESIRE_TEMP=0 FAN_SPEED=${percent / 100} DELAY_OFF=0`
  );
}

export async function stopMoonrakerChamberPreheat(printer) {
  return runMoonrakerGcode(
    printer,
    'SET_PURIFIER_MODE MODE=0 EXHAUST_FAN_DELAY_OFF=0 INNER_FAN_DELAY_OFF=0'
  );
}

export async function levelMoonrakerBed(printer) {
  const status = await getMoonrakerStatus(printer);
  if (String(status.status || '').toLowerCase() !== 'idle') {
    throw new MoonrakerApiError('Bed levelling can only be started while the U1 is idle');
  }
  // Stock U1 macro heats the bed, allows its configured soak time, then runs BED_MESH_CALIBRATE.
  return runMoonrakerGcode(printer, 'AUTO_BED_MESH_CALIBRATE');
}

export async function calibrateMoonrakerToolOffsets(printer, { action, toolIndex } = {}) {
  const status = await getMoonrakerStatus(printer);
  if (String(status.status || '').toLowerCase() !== 'idle') {
    throw new MoonrakerApiError('U1 toolhead offset calibration can only run while the printer is idle');
  }

  const normalizedAction = String(action || '').trim().toLowerCase();
  if (normalizedAction === 'start') {
    // Snapmaker's touchscreen owns the orchestration between the low-level stock
    // calibration actions. Mirror that experience here: enter calibration mode,
    // preheat/home, then immediately prepare T0 for the first manual nozzle clean.
    // The user should only have to confirm each physical clean, not manually choose
    // which toolhead to prepare next.
    return runMoonrakerGcode(printer, [
      'EXTRUDER_OFFSET_ACTION_PRESTART',
      'EXTRUDER_OFFSET_ACTION_PREHOMING',
      'EXTRUDER_OFFSET_ACTION_HEAT TOOL_ID=T0',
      'EXTRUDER_OFFSET_ACTION_AUTO_CLEAN TOOL_ID=T0',
      'EXTRUDER_OFFSET_ACTION_MANUAL_CLEAN TOOL_ID=T0'
    ].join('\n'), { timeoutMs: 420000 });
  }
  if (normalizedAction === 'advance-cleaning' || normalizedAction === 'calibrate-tool') {
    const index = Number(toolIndex);
    if (!Number.isInteger(index) || index < 0 || index >= SNAPMAKER_U1_TOOL_COUNT) {
      throw new MoonrakerApiError('Tool index must be 0-3');
    }
    const tool = `T${index}`;
    if (normalizedAction === 'advance-cleaning') {
      const calibrationTool = status?.toolOffsetCalibration?.tools?.find((entry) => Number(entry.index) === index);
      if (calibrationTool?.nozzleClean === false) {
        throw new MoonrakerApiError(`T${index} has not reached the manual nozzle-clean stage yet`);
      }
      const commands = [`EXTRUDER_OFFSET_ACTION_WAIT_COOL TOOL_ID=${tool} TEMP=140`];
      if (index < SNAPMAKER_U1_TOOL_COUNT - 1) {
        const nextTool = `T${index + 1}`;
        commands.push(
          `EXTRUDER_OFFSET_ACTION_HEAT TOOL_ID=${nextTool}`,
          `EXTRUDER_OFFSET_ACTION_AUTO_CLEAN TOOL_ID=${nextTool}`,
          `EXTRUDER_OFFSET_ACTION_MANUAL_CLEAN TOOL_ID=${nextTool}`
        );
      }
      // One acknowledgement advances the stock sequence: cool the nozzle the user
      // has just cleaned, then prepare the next physical head automatically. T3 is
      // the final clean, so its acknowledgement only performs the cooldown.
      return runMoonrakerGcode(printer, commands.join('\n'), { timeoutMs: 420000 });
    }
    // Probing is deliberately separate from cleaning. The stock U1 UI walks the user
    // through all four manual nozzle-clean confirmations before plate verification and
    // XYZ probing, so jumping straight from auto-clean to probe can leave the printer
    // waiting for a user action that the controller never presented.
    return runMoonrakerGcode(printer, `EXTRUDER_OFFSET_ACTION_PROBE_CALIBRATE TOOL_ID=${tool}`, { timeoutMs: 300000 });
  }
  if (normalizedAction === 'check-plate') {
    return runMoonrakerGcode(printer, 'EXTRUDER_OFFSET_ACTION_DETECT_PLATE PRESENCE=0', { timeoutMs: 90000 });
  }
  if (normalizedAction === 'save') {
    return runMoonrakerGcode(printer, 'EXTRUDER_OFFSET_ACTION_SAVE_RESULT FORCE_SAVE=0', { timeoutMs: 60000 });
  }
  if (normalizedAction === 'exit') {
    return runMoonrakerGcode(printer, 'EXTRUDER_OFFSET_ACTION_EXIT', { timeoutMs: 60000 });
  }
  throw new MoonrakerApiError('Unsupported U1 toolhead calibration action');
}

export async function setMoonrakerJobState(printer, action) {
  const endpoints = {
    pause: '/printer/print/pause',
    resume: '/printer/print/resume',
    cancel: '/printer/print/cancel'
  };
  const endpoint = endpoints[action];
  if (!endpoint) throw new MoonrakerApiError(`Unsupported job action: ${action}`);
  return moonrakerRequest(printer, endpoint, { method: 'POST', timeoutMs: 10000 });
}

function normalizeMoonrakerPrintOptions(options) {
  if (typeof options === 'boolean') return { levelingBeforePrint: options };
  if (!options || typeof options !== 'object') return { levelingBeforePrint: true };
  return options;
}

function validateToolMap(toolMap, usedLogicalTools = []) {
  if (toolMap === null || toolMap === undefined) return null;
  if (typeof toolMap !== 'object' || Array.isArray(toolMap)) throw new MoonrakerApiError('toolMap must be an object');
  const normalized = {};
  for (const [logicalRaw, physicalRaw] of Object.entries(toolMap)) {
    const logical = Number(logicalRaw);
    const physical = Number(physicalRaw);
    if (!Number.isInteger(logical) || logical < 0 || logical > 31) throw new MoonrakerApiError('Logical tool index must be 0-31');
    if (!Number.isInteger(physical) || physical < 0 || physical >= SNAPMAKER_U1_TOOL_COUNT) throw new MoonrakerApiError('Physical U1 tool index must be 0-3');
    normalized[logical] = physical;
  }
  for (const logicalRaw of usedLogicalTools || []) {
    const logical = Number(logicalRaw);
    if (Number.isInteger(logical) && logical >= 0 && normalized[logical] === undefined) {
      throw new MoonrakerApiError(`No physical U1 tool mapping supplied for logical T${logical}`);
    }
  }
  return normalized;
}

export async function printMoonrakerFile(printer, fileName, options = true) {
  const normalized = normalizeFileName(fileName);
  if (!normalized) throw new MoonrakerApiError('fileName is required');

  const printOptions = normalizeMoonrakerPrintOptions(options);
  const levelingBeforePrint = printOptions.levelingBeforePrint !== false;
  const flowCalibrationBeforePrint = printOptions.flowCalibrationBeforePrint === true;
  const timeLapseBeforePrint = typeof printOptions.timeLapseBeforePrint === 'boolean' ? printOptions.timeLapseBeforePrint : null;
  const autoReplenishFilament = typeof printOptions.autoReplenishFilament === 'boolean' ? printOptions.autoReplenishFilament : null;
  const filamentEntangleDetect = typeof printOptions.filamentEntangleDetect === 'boolean' ? printOptions.filamentEntangleDetect : null;
  const filamentEntangleSensitivity = printOptions.filamentEntangleSensitivity == null
    ? null
    : String(printOptions.filamentEntangleSensitivity).trim().toLowerCase();
  if (filamentEntangleSensitivity !== null && !['low', 'medium', 'high'].includes(filamentEntangleSensitivity)) {
    throw new MoonrakerApiError('Filament entanglement sensitivity must be low, medium, or high');
  }
  const usedLogicalTools = Array.isArray(printOptions.usedLogicalTools) ? printOptions.usedLogicalTools : [];
  const toolMap = validateToolMap(printOptions.toolMap, usedLogicalTools);
  const commands = [];

  if (toolMap && Object.keys(toolMap).length) {
    const logicalTools = (usedLogicalTools.length ? usedLogicalTools : Object.keys(toolMap))
      .map(Number).filter((index) => Number.isInteger(index) && index >= 0).sort((a, b) => a - b);
    for (const logical of logicalTools) {
      if (toolMap[logical] === undefined) continue;
      commands.push(`SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=${logical} MAP_EXTRUDER=${toolMap[logical]}`);
    }
    const physicalTools = [...new Set(logicalTools.map((logical) => toolMap[logical]).filter((value) => value !== undefined))];
    if (physicalTools.length) commands.push(`SET_PRINT_USED_EXTRUDERS EXTRUDERS=${physicalTools.join(',')}`);
  }

  // Snapmaker U1 stores per-print calibration choices in print_task_config.
  // Set BED_LEVEL immediately before starting the selected file so the stock
  // print sequence can run (or skip) its own bed-mesh and flow-calibration steps.
  const preferenceParts = [
    `BED_LEVEL=${levelingBeforePrint ? 1 : 0}`,
    `FLOW_CALIBRATE=${flowCalibrationBeforePrint ? 1 : 0}`
  ];
  if (timeLapseBeforePrint !== null) preferenceParts.push(`TIME_LAPSE_CAMERA=${timeLapseBeforePrint ? 1 : 0}`);
  if (autoReplenishFilament !== null) preferenceParts.push(`AUTO_REPLENISH_FILAMENT=${autoReplenishFilament ? 1 : 0}`);
  if (filamentEntangleDetect !== null) preferenceParts.push(`FILAMENT_ENTANGLE_DETECT=${filamentEntangleDetect ? 1 : 0}`);
  if (filamentEntangleSensitivity !== null) preferenceParts.push(`FILAMENT_ENTANGLE_SEN=${filamentEntangleSensitivity}`);
  commands.push(`SET_PRINT_PREFERENCES ${preferenceParts.join(' ')}`);
  await runMoonrakerGcode(printer, commands.join('\n'));

  return moonrakerRequest(printer, `/printer/print/start?filename=${encodeURIComponent(normalized)}`, { method: 'POST', timeoutMs: 15000 });
}

function absoluteCameraUrl(printer, raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const absolute = new URL(value);
    if (!['http:', 'https:'].includes(absolute.protocol)) return null;
    if (absolute.hostname !== printer.host) return null;
    if (absolute.protocol === 'https:') return null; // Current proxy is intentionally HTTP-only.
    return absolute.toString();
  } catch {
    const relative = value.startsWith('/') ? value : `/${value}`;
    return `http://${printer.host}${relative}`;
  }
}

export async function getMoonrakerCameraUrl(printer) {
  try {
    const result = await moonrakerRequest(printer, '/server/webcams/list');
    const webcams = Array.isArray(result?.webcams) ? result.webcams : (Array.isArray(result) ? result : []);
    const camera = webcams.find((item) => item?.enabled !== false && item?.stream_url) || webcams.find((item) => item?.stream_url);
    const resolved = absoluteCameraUrl(printer, camera?.stream_url);
    if (resolved) return resolved;
  } catch {}
  return `http://${printer.host}/webcam/?action=stream`;
}

export async function getMoonrakerObjectList(printer) {
  const result = await moonrakerRequest(printer, '/printer/objects/list');
  return Array.isArray(result?.objects) ? result.objects : (Array.isArray(result) ? result : []);
}

export function isSnapmakerU1ObjectList(objects = []) {
  const set = new Set(objects.map(String));
  const fourTools = TOOL_OBJECTS.every((name) => set.has(name));
  const snapmakerMarker = set.has('print_task_config') || set.has('temperature_sensor cavity') || set.has('purifier');
  return fourTools && snapmakerMarker;
}
