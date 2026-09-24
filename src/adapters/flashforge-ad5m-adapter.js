import { PrinterAdapter, normalizeCapabilities } from './printer-adapter.js';
import {
  BED_MAX_C,
  NOZZLE_MAX_C,
  fallbackCameraUrl,
  getFiles,
  getRecentFiles,
  getStatus,
  levelBed,
  openCamera,
  printLocalFile,
  setFans,
  setFiltration,
  setJobState,
  setTemperatures
} from '../printer-api.js';
import { listAllFilesTcp } from '../tcp-files.js';
import { uploadGcodeFile } from '../upload-gcode.js';
import { discoverPrinters } from '../discovery.js';
import { colorFamily, normalizeColor, normalizeColorFamily } from '../color-family.js';

export const FLASHFORGE_AD5M_ADAPTER_TYPE = 'flashforge-ad5m';

function cleanHost(host) {
  return String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export function prepareFlashForgeAd5mConfig(input = {}) {
  const name = String(input.name || '').trim();
  const host = cleanHost(input.host);
  const serialNumber = String(input.serialNumber || '').trim();
  const checkCode = String(input.checkCode || '').trim();
  if (!name || !host || !serialNumber || !checkCode) {
    throw new Error('name, host, serialNumber and checkCode are required');
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Host/IP contains invalid characters');
  const httpPort = Number(input.httpPort || 8898);
  const cameraPort = Number(input.cameraPort || 8080);
  const tcpPort = Number(input.tcpPort || input.commandPort || 8899);
  for (const [label, port] of [['HTTP', httpPort], ['TCP command', tcpPort], ['Camera', cameraPort]]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} port must be 1-65535`);
  }
  return {
    name,
    host,
    serialNumber,
    checkCode,
    httpPort,
    cameraPort,
    tcpPort,
    adapterType: FLASHFORGE_AD5M_ADAPTER_TYPE,
    manufacturer: 'FlashForge',
    model: String(input.model || 'Adventurer 5M Pro')
  };
}

const CAPABILITIES = normalizeCapabilities({
  status: true,
  localFiles: true,
  fileUpload: true,
  printLocalFile: true,
  jobControl: true,
  nozzleTemperature: true,
  bedTemperature: true,
  coolingFan: true,
  chamberFan: true,
  filtration: true,
  bedLeveling: true,
  levelBeforePrint: true,
  camera: true,
  chamberPreheat: true,
  materialStatus: true,
  materialDesignation: true,
  nozzleDesignation: true
});

function normalizedFileName(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^0:\/user\//i, '')
    .replace(/^\/data\//i, '')
    .replace(/^\/+/, '')
    .trim()
    .toLocaleLowerCase();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class FlashForgeAd5mAdapter extends PrinterAdapter {
  get type() { return FLASHFORGE_AD5M_ADAPTER_TYPE; }
  get manufacturer() { return 'FlashForge'; }
  get model() { return this.printer.model || 'Adventurer 5M Pro'; }
  get capabilities() { return CAPABILITIES; }
  get uploadExtensions() { return ['.gcode', '.gx', '.3mf']; }
  get limits() {
    return Object.freeze({
      bedTemperature: { min: 0, max: BED_MAX_C },
      nozzleTemperature: { min: 0, max: NOZZLE_MAX_C },
      fanPercent: { min: 0, max: 100 },
      chamberPreheatBedTemperature: { min: 30, max: BED_MAX_C },
      chamberPreheatMinutes: { min: 1, max: 120 }
    });
  }

  async getStatus() {
    const status = await getStatus(this.printer);
    const filament = status?.tools?.[0]?.filament;
    if (filament) {
      const reportedMaterial = filament.material || null;
      const reportedColor = normalizeColor(filament.color);
      const reportedColorFamily = colorFamily(reportedColor);
      const manualMaterial = String(this.printer.adapterConfig?.filamentDesignation || '').trim() || null;
      const manualColor = normalizeColor(this.printer.adapterConfig?.filamentColorDesignation);
      const manualColorFamily = normalizeColorFamily(this.printer.adapterConfig?.filamentColorFamilyDesignation)
        || colorFamily(manualColor);
      filament.reportedMaterial = reportedMaterial;
      filament.reportedColor = reportedColor;
      filament.reportedColorFamily = reportedColorFamily;
      if (manualMaterial) {
        filament.material = manualMaterial;
        filament.materialSource = 'manual';
      }
      if (manualColorFamily) {
        filament.colorFamily = manualColorFamily;
        filament.colorFamilySource = 'manual';
        if (manualColor) {
          filament.color = manualColor;
          filament.colorSource = 'manual';
        } else {
          filament.color = null;
          filament.colorSource = null;
        }
      } else {
        filament.color = reportedColor;
        filament.colorSource = reportedColor ? 'printer' : null;
        filament.colorFamily = reportedColorFamily;
        filament.colorFamilySource = reportedColorFamily ? 'printer' : null;
      }
      filament.manuallyAssigned = Boolean(manualMaterial || manualColorFamily);
      if (manualMaterial || manualColorFamily) filament.metadataAvailable = true;
    }

    const tool = status?.tools?.[0];
    if (tool) {
      const reportedNozzle = Number(tool.nozzleDiameter);
      const reportedNozzleDiameter = Number.isFinite(reportedNozzle) && reportedNozzle > 0 ? reportedNozzle : null;
      const manualNozzle = Number(this.printer.adapterConfig?.nozzleDiameterDesignation);
      const manualNozzleDiameter = Number.isFinite(manualNozzle) && manualNozzle > 0 ? manualNozzle : null;
      tool.reportedNozzleDiameter = reportedNozzleDiameter;
      if (manualNozzleDiameter) {
        tool.nozzleDiameter = manualNozzleDiameter;
        tool.nozzleDiameterSource = 'manual';
        tool.nozzleManuallyAssigned = true;
      } else {
        tool.nozzleDiameter = reportedNozzleDiameter;
        tool.nozzleDiameterSource = reportedNozzleDiameter ? 'printer' : null;
        tool.nozzleManuallyAssigned = false;
      }
    }
    return status;
  }
  async getFiles() { return getFiles(this.printer); }
  async uploadFile(filePath, options = {}) { return uploadGcodeFile(this.printer, filePath, options); }
  async printLocalFile(fileName, options = true) {
    const levelingBeforePrint = typeof options === 'object' && options !== null
      ? options.levelingBeforePrint !== false
      : options !== false;
    return printLocalFile(this.printer, fileName, levelingBeforePrint);
  }
  async setTemperatures(values) { return setTemperatures(this.printer, values); }
  async setFans(values) { return setFans(this.printer, values); }
  async setFiltration(values) { return setFiltration(this.printer, values); }
  async setJobState(action) { return setJobState(this.printer, action); }
  async levelBed() { return levelBed(this.printer); }
  async activateCamera() { return openCamera(this.printer); }
  fallbackCameraUrl() { return fallbackCameraUrl(this.printer); }

  async verifyFile(fileName, { attempts = 3 } = {}) {
    const wanted = normalizedFileName(fileName);
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await sleep(500 * attempt);
      try {
        const files = await listAllFilesTcp(this.printer);
        if (files.some((file) => normalizedFileName(file) === wanted)) {
          return { verified: true, source: 'tcp-m661' };
        }
      } catch (error) {
        lastError = error;
        break;
      }
    }

    try {
      const recent = await getRecentFiles(this.printer);
      if (recent.some((file) => normalizedFileName(file) === wanted)) {
        return { verified: true, source: 'http-recent' };
      }
    } catch (error) {
      lastError ||= error;
    }

    return {
      verified: false,
      source: null,
      warning: lastError
        ? `Upload accepted, but verification failed: ${lastError.message}`
        : 'Upload accepted, but the file was not visible in printer storage after verification.'
    };
  }
}

export const flashForgeAd5mAdapterDefinition = Object.freeze({
  type: FLASHFORGE_AD5M_ADAPTER_TYPE,
  manufacturer: 'FlashForge',
  label: 'FlashForge Adventurer 5M family',
  models: ['Adventurer 5M', 'Adventurer 5M Pro'],
  capabilities: CAPABILITIES,
  configFields: [
    { name: 'httpPort', label: 'HTTP API port', required: true, type: 'number', defaultValue: 8898, min: 1, max: 65535, help: 'Leave at 8898 for physical 5M-family printers. Emulator endpoints may use a different port.' },
    { name: 'tcpPort', label: 'TCP command port', required: true, type: 'number', defaultValue: 8899, min: 1, max: 65535, help: 'Leave at 8899 for physical 5M-family printers.' },
    { name: 'cameraPort', label: 'Camera port', required: true, type: 'number', defaultValue: 8080, min: 1, max: 65535, help: 'Leave at 8080 for the stock FlashForge camera.' },
    { name: 'serialNumber', label: 'Serial number', required: true, placeholder: 'SN...' },
    { name: 'checkCode', label: 'Printer ID / Check code', required: true, secret: true, placeholder: "Shown on the printer's LAN Only screen", help: 'On the printer: Settings → Network → Network Mode → LAN Only.' }
  ],
  discover: discoverPrinters,
  prepareConfig: prepareFlashForgeAd5mConfig,
  create: (printer) => new FlashForgeAd5mAdapter(printer)
});
