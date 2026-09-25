import { PrinterAdapter, normalizeCapabilities } from './printer-adapter.js';
import {
  CREATOR5_BED_MAX_C,
  CREATOR5_NOZZLE_MAX_C,
  CREATOR5_TOOL_COUNT,
  creator5CameraUrl,
  getCreator5Files,
  getCreator5Status,
  levelCreator5Bed,
  printCreator5File,
  setCreator5JobState,
  setCreator5Temperatures,
  verifyCreator5File
} from '../creator5-api.js';
import { uploadGcodeFile } from '../upload-gcode.js';
import { discoverPrinters } from '../discovery.js';
import { colorFamily, normalizeColor } from '../color-family.js';

export const FLASHFORGE_CREATOR5_ADAPTER_TYPE = 'flashforge-creator5';
const CREATOR5_MODELS = Object.freeze(['Creator 5', 'Creator 5 Pro']);

function cleanHost(host) {
  return String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export function prepareFlashForgeCreator5Config(input = {}) {
  const name = String(input.name || '').trim();
  const host = cleanHost(input.host);
  const serialNumber = String(input.serialNumber || '').trim();
  const checkCode = String(input.checkCode || '').trim();
  const requestedModel = String(input.model || 'Creator 5 Pro').trim();
  const model = CREATOR5_MODELS.find((item) => item.toLowerCase() === requestedModel.toLowerCase());
  if (!name || !host || !serialNumber || !checkCode) {
    throw new Error('name, host, serialNumber and checkCode are required');
  }
  if (!model) throw new Error('Model must be Creator 5 or Creator 5 Pro');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Host/IP contains invalid characters');
  const httpPort = Number(input.httpPort || 8898);
  const cameraPort = Number(input.cameraPort || 8080);
  for (const [label, port] of [['HTTP', httpPort], ['Camera', cameraPort]]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} port must be 1-65535`);
  }
  return {
    name,
    host,
    serialNumber,
    checkCode,
    httpPort,
    cameraPort,
    adapterType:FLASHFORGE_CREATOR5_ADAPTER_TYPE,
    manufacturer:'FlashForge',
    model
  };
}

const COMMON_CAPABILITIES = normalizeCapabilities({
  status:true,
  localFiles:true,
  fileUpload:true,
  printLocalFile:true,
  jobControl:true,
  nozzleTemperature:true,
  toolTemperatures:true,
  bedTemperature:true,
  coolingFan:false,
  chamberFan:false,
  filtration:false,
  bedLeveling:true,
  levelBeforePrint:true,
  camera:true,
  chamberPreheat:false,
  chamberTemperatureSensor:false,
  materialStatus:true,
  materialDesignation:false,
  nozzleDesignation:true,
  printToolMapping:true,
  flowCalibrationBeforePrint:true,
  timeLapseBeforePrint:true
});

const PRO_CAPABILITIES = normalizeCapabilities({
  ...COMMON_CAPABILITIES,
  chamberTemperatureSensor:true
});

function isPro(model) {
  return /creator\s*5\s*pro/i.test(String(model || ''));
}

function normalizedFileName(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .toLocaleLowerCase();
}

export async function discoverCreator5Printers() {
  const printers = await discoverPrinters();
  return printers.filter((printer) => CREATOR5_MODELS.includes(printer.model));
}

export class FlashForgeCreator5Adapter extends PrinterAdapter {
  get type() { return FLASHFORGE_CREATOR5_ADAPTER_TYPE; }
  get manufacturer() { return 'FlashForge'; }
  get model() { return this.printer.model || 'Creator 5 Pro'; }
  get capabilities() { return isPro(this.model) ? PRO_CAPABILITIES : COMMON_CAPABILITIES; }
  get uploadExtensions() { return ['.gcode', '.3mf']; }
  get limits() {
    return Object.freeze({
      bedTemperature:{ min:0, max:CREATOR5_BED_MAX_C },
      nozzleTemperature:{ min:0, max:CREATOR5_NOZZLE_MAX_C },
      toolCount:CREATOR5_TOOL_COUNT,
      ...(isPro(this.model) ? { chamberTemperature:{ min:0, max:65 } } : {})
    });
  }

  async getStatus() {
    const status = await getCreator5Status(this.printer);
    const manualNozzle = Number(this.printer.adapterConfig?.nozzleDiameterDesignation);
    const manualNozzleDiameter = Number.isFinite(manualNozzle) && manualNozzle > 0 ? manualNozzle : null;
    for (const tool of status.tools || []) {
      const filament = tool.filament || {};
      const reportedColor = normalizeColor(filament.color);
      filament.color = reportedColor;
      filament.colorFamily = colorFamily(reportedColor);
      filament.colorFamilySource = filament.colorFamily ? 'printer' : null;
      filament.colorSource = reportedColor ? 'printer' : null;

      const reportedNozzle = Number(tool.nozzleDiameter);
      tool.reportedNozzleDiameter = Number.isFinite(reportedNozzle) && reportedNozzle > 0 ? reportedNozzle : null;
      if (manualNozzleDiameter) {
        tool.nozzleDiameter = manualNozzleDiameter;
        tool.nozzleDiameterSource = 'manual';
        tool.nozzleManuallyAssigned = true;
      } else {
        tool.nozzleDiameter = tool.reportedNozzleDiameter;
        tool.nozzleDiameterSource = tool.reportedNozzleDiameter ? 'printer' : null;
        tool.nozzleManuallyAssigned = false;
      }
    }
    if (status.materials?.tools) {
      status.materials.tools = (status.tools || []).map((tool) => ({ index:tool.index, ...tool.filament }));
    }
    return status;
  }

  async getFiles() { return getCreator5Files(this.printer); }

  async getPrintSetup(fileName) {
    const status = await this.getStatus();
    return {
      fileName,
      mappingMode:'creator5',
      logicalTools:[],
      referencedTools:[],
      physicalTools:(status.tools || []).map((tool) => ({
        index:tool.index,
        nozzleDiameter:tool.nozzleDiameter ?? null,
        filament:tool.filament ? { ...tool.filament } : null
      })),
      warning:'Creator 5 series firmware does not expose per-file tool/material requirements for files already stored on the printer. Controller-managed Print Library jobs retain their sliced tool metadata and can be mapped automatically; a printer-local file can only be started with its saved/default material mapping.'
    };
  }

  async uploadFile(filePath, options = {}) {
    const requirements = options.requirements || {};
    const requestedToolCount = Number(options.toolCount || requirements.toolCount || requirements.requiredTools?.length || 1);
    return uploadGcodeFile(this.printer, filePath, {
      ...options,
      creator5:true,
      toolCount:Math.max(1, Math.min(CREATOR5_TOOL_COUNT, Number.isFinite(requestedToolCount) ? requestedToolCount : 1))
    });
  }

  async verifyFile(fileName) {
    return verifyCreator5File(this.printer, normalizedFileName(fileName));
  }

  async printLocalFile(fileName, options = {}) {
    return printCreator5File(this.printer, fileName, typeof options === 'object' && options !== null ? options : {
      levelingBeforePrint:options !== false
    });
  }

  async setTemperatures(values) { return setCreator5Temperatures(this.printer, values); }
  async setJobState(action) { return setCreator5JobState(this.printer, action); }
  async levelBed() { return levelCreator5Bed(this.printer); }
  async activateCamera() { return null; }
  fallbackCameraUrl() { return creator5CameraUrl(this.printer); }
}

export const flashForgeCreator5AdapterDefinition = Object.freeze({
  type:FLASHFORGE_CREATOR5_ADAPTER_TYPE,
  manufacturer:'FlashForge',
  label:'FlashForge Creator 5 series',
  models:[...CREATOR5_MODELS],
  capabilities:COMMON_CAPABILITIES,
  configFields:[
    { name:'httpPort', label:'HTTP API port', required:true, type:'number', defaultValue:8898, min:1, max:65535, help:'Leave at 8898 for physical Creator 5 series printers. Creator 5 does not use the legacy TCP 8899 control/file interface.' },
    { name:'cameraPort', label:'Camera port', required:true, type:'number', defaultValue:8080, min:1, max:65535, help:'Leave at 8080 for the built-in Creator 5 camera.' },
    { name:'serialNumber', label:'Serial number', required:true, placeholder:'SN...' },
    { name:'checkCode', label:'Printer ID / Check code', required:true, secret:true, placeholder:"Shown on the printer's LAN/local network screen", help:'Use the Creator 5 local/LAN API credentials shown by the printer.' }
  ],
  discover:discoverCreator5Printers,
  prepareConfig:prepareFlashForgeCreator5Config,
  create:(printer) => new FlashForgeCreator5Adapter(printer)
});
