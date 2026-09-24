import path from 'node:path';
import { PrinterAdapter, normalizeCapabilities } from './printer-adapter.js';
import { getBambuReport, sendBambuCommand } from '../bambu-mqtt.js';
import { downloadBambuFile, listBambuFiles, uploadBambuFile, verifyBambuFile } from '../bambu-ftps.js';
import { createBambuCameraSource } from '../bambu-camera.js';
import { colorFamily } from '../color-family.js';
import { parse3mfPrintRequirements, parseGcodePrintRequirements } from '../file-print-requirements.js';

export const BAMBU_LAB_ADAPTER_TYPE = 'bambu-lab';
export const BAMBU_LAB_MODELS = Object.freeze(['P1P', 'P1S', 'X1C', 'A1 Mini']);

function cleanHost(host) {
  return String(host || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '').replace(/:\d+$/, '');
}

function validPort(value, fallback, label) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} port must be 1-65535`);
  return port;
}

function normalizeModel(value) {
  const raw = String(value || 'P1S').trim();
  const compact = raw.toUpperCase().replace(/[\s_-]+/g, '');
  if (compact === 'A1MINI') return 'A1 Mini';
  const model = raw.toUpperCase();
  if (!BAMBU_LAB_MODELS.includes(model)) throw new Error('Bambu model must be P1P, P1S, X1C or A1 Mini');
  return model;
}

export function prepareBambuLabConfig(input = {}) {
  const name = String(input.name || '').trim();
  const host = cleanHost(input.host);
  const serialNumber = String(input.serialNumber || '').trim();
  const accessCode = String(input.accessCode || input.checkCode || input.adapterConfig?.accessCode || '').trim();
  const model = normalizeModel(input.model);
  if (!name || !host || !serialNumber || !accessCode) throw new Error('name, host, serialNumber and accessCode are required');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Host/IP contains invalid characters');
  if (serialNumber.length > 64 || /[\x00-\x1f\x7f]/.test(serialNumber)) throw new Error('Bambu serial number is invalid');
  if (accessCode.length > 64 || /[\x00-\x1f\x7f]/.test(accessCode)) throw new Error('Bambu access code is invalid');
  const mqttPort = validPort(input.mqttPort || input.adapterConfig?.mqttPort, 8883, 'MQTT TLS');
  const ftpsPort = validPort(input.ftpsPort || input.adapterConfig?.ftpsPort, 990, 'FTPS TLS');
  const cameraPort = validPort(input.cameraPort || input.adapterConfig?.cameraPort, model === 'X1C' ? 322 : 6000, model === 'X1C' ? 'Camera RTSPS' : 'Camera TLS');
  return {
    name,
    host,
    serialNumber,
    checkCode: accessCode,
    mqttPort,
    ftpsPort,
    cameraPort,
    adapterType: BAMBU_LAB_ADAPTER_TYPE,
    manufacturer: 'Bambu Lab',
    model,
    adapterConfig: { mqttPort, ftpsPort, cameraPort, cameraProtocol:model === 'X1C' ? 'rtsps-h264' : 'tls-jpeg', experimental: true }
  };
}

function stateName(value, report = {}) {
  const state = String(value || '').trim().toUpperCase();
  if (['RUNNING', 'PREPARE'].includes(state)) return 'printing';
  if (state === 'PAUSE') return 'paused';
  if (state === 'FINISH') return 'completed';
  if (state === 'FAILED') return Number(report.print_error || 0) ? 'failed' : 'cancelled';
  if (['IDLE', 'READY'].includes(state)) return 'idle';
  return state.toLowerCase() || 'unknown';
}

function fanPercent(value) {
  const numeric = Number(value || 0);
  return Math.max(0, Math.min(100, Math.round(numeric <= 15 ? numeric / 15 * 100 : numeric)));
}

function rgbaColor(value) {
  const text = String(value || '').trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{8}$/.test(text)) return `#${text.slice(0, 6)}`;
  if (/^[0-9A-F]{6}$/.test(text)) return `#${text}`;
  return null;
}

function firstTray(print = {}) {
  const virtual = print.vt_tray || print.virtual_tray;
  const units = Array.isArray(print.ams?.ams) ? print.ams.ams : [];
  const trays = units.flatMap((unit) => Array.isArray(unit?.tray) ? unit.tray : []);
  const activeId = String(print.tray_now ?? '');
  const activeAms = trays.find((tray) => String(tray.id ?? tray.tray_id ?? '') === activeId);
  if (activeAms) return activeAms;
  if (virtual && (virtual.tray_type || virtual.tray_color)) return virtual;
  return trays.find((tray) => tray?.tray_type || tray?.tray_color) || null;
}

function trayMaterial(tray = {}) {
  const color = rgbaColor(tray.tray_color);
  return {
    material:String(tray.tray_type || '').trim() || null,
    materialVariant:String(tray.tray_sub_brands || '').trim() || null,
    color,
    colorFamily:colorFamily(color),
    vendor:String(tray.tray_info_idx || '').trim() || null
  };
}

export function normalizeBambuMaterialSources(print = {}) {
  const activeId = String(print.tray_now ?? '');
  const units = Array.isArray(print.ams?.ams) ? print.ams.ams : [];
  const sources = [];
  units.forEach((unit, unitPosition) => {
    const unitIndex = Number.isInteger(Number(unit?.id)) ? Number(unit.id) : unitPosition;
    const trays = Array.isArray(unit?.tray) ? unit.tray : [];
    trays.forEach((tray, slotPosition) => {
      const slotIndex = Number.isInteger(Number(tray?.id)) ? Number(tray.id) : slotPosition;
      const protocolIndex = unitIndex * 4 + slotIndex;
      const material = trayMaterial(tray);
      const present = tray?.tray_exist_bits !== undefined
        ? Boolean(Number(tray.tray_exist_bits))
        : Boolean(material.material || material.color);
      sources.push({
        id:`ams-${unitIndex}-${slotIndex}`,
        kind:'ams', unitIndex, slotIndex, protocolIndex,
        label:`AMS ${unitIndex + 1} · Slot ${slotIndex + 1}`,
        present,
        active:activeId === String(protocolIndex) || (units.length === 1 && activeId === String(slotIndex)),
        ...material
      });
    });
  });
  const virtual = print.vt_tray || print.virtual_tray;
  if (virtual) {
    const material = trayMaterial(virtual);
    sources.push({
      id:'external', kind:'external', unitIndex:null, slotIndex:null, protocolIndex:254,
      label:'External spool', present:Boolean(material.material || material.color),
      active:['254','255'].includes(activeId) || (!sources.some((source) => source.active) && units.length === 0),
      ...material
    });
  }
  return sources;
}

export function normalizeBambuStatus(payload = {}, printer = {}) {
  const print = payload.print || payload;
  const materialSources = normalizeBambuMaterialSources(print);
  const selectedSource = materialSources.find((source) => source.active)
    || materialSources.find((source) => source.kind === 'external' && source.present)
    || materialSources.find((source) => source.present)
    || null;
  const nozzleDiameter = Number(print.nozzle_diameter ?? printer.adapterConfig?.nozzleDiameterDesignation);
  const material = selectedSource?.material || null;
  const color = selectedSource?.color || null;
  const model = normalizeModel(printer.model);
  return {
    status: stateName(print.gcode_state, print),
    rawStatus: String(print.gcode_state || 'unknown'),
    printerName: print.dev_name || null,
    firmwareVersion: print.firmware_version || print.sw_ver || null,
    fileName: print.subtask_name || print.gcode_file || null,
    progress: Math.max(0, Math.min(100, Number(print.mc_percent || 0))),
    currentLayer: Number(print.layer_num || 0),
    totalLayers: Number(print.total_layer_num || 0),
    remainingSeconds: Math.max(0, Number(print.mc_remaining_time || 0) * 60),
    elapsedSeconds: Math.max(0, Number(print.mc_print_time || 0)),
    nozzle: { actual: Number(print.nozzle_temper || 0), target: Number(print.nozzle_target_temper || 0) },
    tools: [{
      index: 0,
      active: true,
      actual: Number(print.nozzle_temper || 0),
      target: Number(print.nozzle_target_temper || 0),
      nozzleDiameter: Number.isFinite(nozzleDiameter) && nozzleDiameter > 0 ? nozzleDiameter : null,
      filament: {
        present: selectedSource ? selectedSource.present : null,
        detecting: false,
        material,
        materialVariant: selectedSource?.materialVariant || null,
        color,
        colorFamily:selectedSource?.colorFamily || colorFamily(color),
        vendor: selectedSource?.vendor || null,
        manufacturer: null,
        materialSource: material ? 'printer' : null,
        metadataAvailable: Boolean(material || color)
      }
    }],
    materialSources,
    amsAttached: materialSources.some((source) => source.kind === 'ams'),
    bed: { actual: Number(print.bed_temper || 0), target: Number(print.bed_target_temper || 0) },
    chamber: { actual: Number(print.chamber_temper || 0) },
    coolingFan: fanPercent(print.cooling_fan_speed),
    chamberFan: fanPercent(print.big_fan2_speed),
    auxiliaryFan: fanPercent(print.big_fan1_speed),
    light: Array.isArray(print.lights_report) ? print.lights_report.find((item) => item.node === 'chamber_light')?.mode || null : null,
    cameraAvailable: model !== 'X1C',
    lidarAvailable: model === 'X1C',
    model,
    experimental: true
  };
}

function sequenceId() {
  return String(Date.now());
}

function printCommand(fileName, options = {}) {
  const name = String(fileName || '').replace(/^\/+/, '');
  const extension = path.extname(name).toLowerCase();
  if (extension === '.3mf') {
    const materialMap = options.materialMap && typeof options.materialMap === 'object' ? options.materialMap : {};
    const logical = (Array.isArray(options.usedLogicalTools) && options.usedLogicalTools.length
      ? options.usedLogicalTools
      : Object.keys(materialMap)).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const amsMapping = logical.map((index) => Number(materialMap[index] ?? materialMap[String(index)])).filter(Number.isFinite);
    const useAms = amsMapping.length > 0 && amsMapping.every((index) => index >= 0 && index < 254);
    return {
      print: {
        command: 'project_file',
        sequence_id: sequenceId(),
        param: 'Metadata/plate_1.gcode',
        project_id: '0',
        profile_id: '0',
        task_id: '0',
        subtask_id: '0',
        subtask_name: name,
        url: `file:///sdcard/${name}`,
        bed_type: 'auto',
        timelapse: Boolean(options.timeLapseBeforePrint),
        bed_leveling: options.levelingBeforePrint !== false,
        flow_cali: Boolean(options.flowCalibrationBeforePrint),
        vibration_cali: true,
        layer_inspect: false,
        use_ams: useAms,
        ...(amsMapping.length ? { ams_mapping:amsMapping } : {})
      }
    };
  }
  return { print: { command: 'gcode_file', sequence_id: sequenceId(), param: name, file: name } };
}

const P1P_CAPABILITIES = normalizeCapabilities({
  status: true,
  localFiles: true,
  fileUpload: true,
  printLocalFile: true,
  jobControl: true,
  nozzleTemperature: true,
  bedTemperature: true,
  coolingFan: true,
  camera: true,
  materialStatus: true,
  materialSlotMapping: true,
  levelBeforePrint: true,
  flowCalibrationBeforePrint: true,
  timeLapseBeforePrint: true,
  toolheadNozzleStatus: true
});

const A1_MINI_CAPABILITIES = normalizeCapabilities({
  ...P1P_CAPABILITIES
});

const P1S_CAPABILITIES = normalizeCapabilities({
  ...P1P_CAPABILITIES,
  chamberFan: true,
  chamberPreheat: true,
  chamberTemperatureSensor: true
});

const X1C_CAPABILITIES = normalizeCapabilities({
  ...P1S_CAPABILITIES,
  // X1C exposes H.264 over RTSPS rather than the P1 TLS/JPEG stream. The
  // controller has no native H.264 decoder, so do not advertise camera support.
  camera: false
});

export class BambuLabAdapter extends PrinterAdapter {
  get type() { return BAMBU_LAB_ADAPTER_TYPE; }
  get manufacturer() { return 'Bambu Lab'; }
  get model() { return normalizeModel(this.printer.model); }
  get capabilities() {
    if (this.model === 'X1C') return X1C_CAPABILITIES;
    if (this.model === 'P1S') return P1S_CAPABILITIES;
    if (this.model === 'A1 Mini') return A1_MINI_CAPABILITIES;
    return P1P_CAPABILITIES;
  }
  get uploadExtensions() { return ['.3mf', '.gcode']; }
  get limits() {
    const maxBedTemperature = this.model === 'X1C' ? 120 : this.model === 'A1 Mini' ? 80 : 100;
    return Object.freeze({
      bedTemperature: { min: 0, max: maxBedTemperature },
      nozzleTemperature: { min: 0, max: 300 },
      fanPercent: { min: 0, max: 100 },
      chamberPreheatBedTemperature: { min: 30, max: maxBedTemperature },
      chamberPreheatMinutes: { min: 1, max: 120 },
      toolCount: 1
    });
  }

  async getStatus() { return normalizeBambuStatus(await getBambuReport(this.printer), this.printer); }
  async getFiles() {
    const files = await listBambuFiles(this.printer);
    return { files: files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })), recentFiles: [], complete: true, source: 'bambu-ftps', ordering: 'alphabetical', warning: null };
  }
  async uploadFile(filePath, options = {}) { return uploadBambuFile(this.printer, filePath, { fileName: options.fileName || path.basename(filePath) }); }
  async verifyFile(fileName, options = {}) { return verifyBambuFile(this.printer, fileName, options); }
  async getPrintSetup(fileName) {
    const content = await downloadBambuFile(this.printer, fileName);
    const extension = path.extname(String(fileName || '')).toLowerCase();
    const requirements = extension === '.3mf'
      ? parse3mfPrintRequirements(content, { fileName })
      : parseGcodePrintRequirements(content.toString('utf8'), { fileName });
    const status = await this.getStatus();
    return {
      ...requirements,
      referencedTools:[...requirements.requiredTools],
      materialSources:status.materialSources || [],
      amsAttached:status.amsAttached === true,
      amsMappingSupported:extension === '.3mf' || requirements.toolCount <= 1,
      warning:extension !== '.3mf' && requirements.toolCount > 1
        ? 'Bambu multi-material AMS/AMS Lite printing requires a sliced .3mf project file.'
        : requirements.warning
    };
  }
  async printLocalFile(fileName, options = {}) { return sendBambuCommand(this.printer, printCommand(fileName, options)); }
  async setJobState(action) {
    const command = { pause: 'pause', resume: 'resume', cancel: 'stop' }[String(action || '').toLowerCase()];
    if (!command) throw new Error(`Unsupported Bambu job action: ${action}`);
    return sendBambuCommand(this.printer, { print: { command, sequence_id: sequenceId() } });
  }
  async setTemperatures({ nozzle, bed } = {}) {
    const commands = [];
    if (nozzle !== undefined) commands.push(`M104 S${Number(nozzle)}`);
    if (bed !== undefined) commands.push(`M140 S${Number(bed)}`);
    if (!commands.length) throw new Error('No Bambu temperature value supplied');
    return sendBambuCommand(this.printer, { print: { command: 'gcode_line', sequence_id: sequenceId(), param: `${commands.join('\n')}\n` } });
  }
  async setFans({ coolingFan, chamberFan } = {}) {
    const commands = [];
    if (coolingFan !== undefined) commands.push(`M106 P1 S${Math.round(Number(coolingFan) / 100 * 255)}`);
    if (chamberFan !== undefined) commands.push(`M106 P3 S${Math.round(Number(chamberFan) / 100 * 255)}`);
    if (!commands.length) throw new Error('No Bambu fan value supplied');
    return sendBambuCommand(this.printer, { print: { command: 'gcode_line', sequence_id: sequenceId(), param: `${commands.join('\n')}\n` } });
  }
  async getCameraSource() {
    if (this.model === 'X1C') return this.unsupported('X1C RTSPS/H.264 camera');
    return createBambuCameraSource(this.printer);
  }
  async activateCamera() { return { ok: true }; }
}

export const bambuLabAdapterDefinition = Object.freeze({
  type: BAMBU_LAB_ADAPTER_TYPE,
  manufacturer: 'Bambu Lab',
  label: 'Bambu Lab P1P / P1S / X1C / A1 Mini (experimental)',
  models: [...BAMBU_LAB_MODELS],
  capabilities: P1S_CAPABILITIES,
  experimental: true,
  configFields: [
    { name: 'model', label: 'Model', required: true, type:'select', defaultValue:'P1S', options:[
      { value:'P1P', label:'P1P' },
      { value:'P1S', label:'P1S' },
      { value:'X1C', label:'X1 Carbon (X1C)' },
      { value:'A1 Mini', label:'A1 Mini' }
    ], help:'Select the Bambu printer model. Support remains experimental until validated on physical hardware.' },
    { name: 'serialNumber', label: 'Printer serial number', required: true, placeholder: 'Shown in printer device information' },
    { name: 'accessCode', label: 'LAN access code', required: true, secret: true, placeholder: 'Shown in LAN / Developer mode', help: 'Enable LAN Only or Developer mode on the printer, then enter its access code.' },
    { name: 'mqttPort', label: 'MQTT TLS port', required: true, type: 'number', defaultValue: 8883, min: 1, max: 65535 },
    { name: 'ftpsPort', label: 'FTPS TLS port', required: true, type: 'number', defaultValue: 990, min: 1, max: 65535 },
    { name: 'cameraPort', label: 'Camera port', required: true, type: 'number', defaultValue: 6000, min: 1, max: 65535, help: 'P1P/P1S/A1 Mini use TLS/JPEG port 6000. X1C uses RTSPS/H.264 port 322; X1C camera decoding is not yet supported by the controller.' }
  ],
  prepareConfig: prepareBambuLabConfig,
  create: (printer) => new BambuLabAdapter(printer)
});

export const bambuAdapterInternals = { fanPercent, firstTray, normalizeBambuMaterialSources, printCommand, rgbaColor, stateName };
