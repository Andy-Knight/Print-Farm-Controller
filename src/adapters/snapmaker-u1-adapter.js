import { PrinterAdapter, normalizeCapabilities } from './printer-adapter.js';
import {
  SNAPMAKER_U1_BED_MAX_C,
  SNAPMAKER_U1_NOZZLE_MAX_C,
  SNAPMAKER_U1_TOOL_COUNT,
  getMoonrakerFiles,
  getMoonrakerPrintSetup,
  getMoonrakerStatus,
  printMoonrakerFile,
  setMoonrakerJobState,
  setMoonrakerTemperatures,
  setMoonrakerFans,
  setMoonrakerFiltration,
  setMoonrakerFilamentConfig,
  setMoonrakerFilamentType,
  setMoonrakerFilamentColor,
  startMoonrakerChamberPreheat,
  stopMoonrakerChamberPreheat,
  levelMoonrakerBed,
  calibrateMoonrakerToolOffsets,
  uploadMoonrakerFile,
  verifyMoonrakerFile
} from '../moonraker-api.js';
import { discoverSnapmakerU1 } from '../moonraker-discovery.js';
import { createSnapmakerU1CameraSource } from '../snapmaker-u1-camera.js';

export const SNAPMAKER_U1_ADAPTER_TYPE = 'snapmaker-u1';

function cleanHost(host) {
  return String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/:\d+$/, '');
}

export function prepareSnapmakerU1Config(input = {}) {
  const name = String(input.name || '').trim();
  const host = cleanHost(input.host);
  const httpPort = Number(input.httpPort || input.moonrakerPort || 7125);
  const apiKey = String(input.apiKey || input.adapterConfig?.apiKey || '').trim();
  if (!name || !host) throw new Error('name and host are required');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Host/IP contains invalid characters');
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) throw new Error('Moonraker port must be 1-65535');
  return {
    name,
    host,
    httpPort,
    cameraPort: 80,
    adapterType: SNAPMAKER_U1_ADAPTER_TYPE,
    manufacturer: 'Snapmaker',
    model: 'U1',
    serialNumber: '',
    checkCode: '',
    adapterConfig: { ...(apiKey ? { apiKey } : {}) }
  };
}

const CAPABILITIES = normalizeCapabilities({
  status: true,
  localFiles: true,
  fileUpload: true,
  printLocalFile: true,
  jobControl: true,
  nozzleTemperature: true,
  toolTemperatures: true,
  bedTemperature: true,
  coolingFan: false,
  chamberFan: true,
  filtration: true,
  bedLeveling: true,
  levelBeforePrint: true,
  camera: true,
  chamberPreheat: true,
  chamberTemperatureSensor: true,
  materialStatus: true,
  filamentTypeControl: true,
  filamentColorControl: true,
  printToolMapping: true,
  flowCalibrationBeforePrint: true,
  timeLapseBeforePrint: true,
  autoFilamentReplenishment: true,
  filamentEntanglementDetection: true,
  toolheadNozzleStatus: true,
  toolheadOffsetCalibration: true
});

export class SnapmakerU1Adapter extends PrinterAdapter {
  get type() { return SNAPMAKER_U1_ADAPTER_TYPE; }
  get manufacturer() { return 'Snapmaker'; }
  get model() { return 'U1'; }
  get capabilities() { return CAPABILITIES; }
  get uploadExtensions() { return ['.gcode', '.gco', '.g']; }
  get limits() {
    return Object.freeze({
      bedTemperature: { min: 0, max: SNAPMAKER_U1_BED_MAX_C },
      nozzleTemperature: { min: 0, max: SNAPMAKER_U1_NOZZLE_MAX_C },
      filtrationSpeed: { min: 0, max: 100 },
      chamberPreheatBedTemperature: { min: 30, max: SNAPMAKER_U1_BED_MAX_C },
      chamberPreheatMinutes: { min: 1, max: 120 },
      chamberPreheatCirculationFan: { min: 0, max: 100, default: 60 },
      toolCount: SNAPMAKER_U1_TOOL_COUNT
    });
  }

  async getStatus() { return getMoonrakerStatus(this.printer); }
  async getFiles() { return getMoonrakerFiles(this.printer); }
  async getPrintSetup(fileName) { return getMoonrakerPrintSetup(this.printer, fileName); }
  async uploadFile(filePath, options = {}) { return uploadMoonrakerFile(this.printer, filePath, options); }
  async verifyFile(fileName) { return verifyMoonrakerFile(this.printer, fileName); }
  async printLocalFile(fileName, options = true) { return printMoonrakerFile(this.printer, fileName, options); }
  async setTemperatures(values) { return setMoonrakerTemperatures(this.printer, values); }
  async setFans(values) { return setMoonrakerFans(this.printer, values); }
  async setFiltration(values) { return setMoonrakerFiltration(this.printer, values); }
  async setFilamentConfig(values) { return setMoonrakerFilamentConfig(this.printer, values); }
  async setFilamentType(values) { return setMoonrakerFilamentType(this.printer, values); }
  async setFilamentColor(values) { return setMoonrakerFilamentColor(this.printer, values); }
  async prepareChamberPreheat(_options = {}, { status } = {}) {
    if (status?.filtration?.available === false) {
      throw new Error('Snapmaker U1 chamber preheat requires the purifier/top-cover hardware');
    }
    return startMoonrakerChamberPreheat(this.printer, {
      fanPercent: Number(this.limits.chamberPreheatCirculationFan.default || 60)
    });
  }
  async finishChamberPreheat() { return stopMoonrakerChamberPreheat(this.printer); }
  async setJobState(action) { return setMoonrakerJobState(this.printer, action); }
  async levelBed() { return levelMoonrakerBed(this.printer); }
  async calibrateToolOffsets(options = {}) { return calibrateMoonrakerToolOffsets(this.printer, options); }
  async getCameraSource() { return createSnapmakerU1CameraSource(this.printer); }
  async activateCamera() { return null; }
  fallbackCameraUrl() { return null; }
}

export const snapmakerU1AdapterDefinition = Object.freeze({
  type: SNAPMAKER_U1_ADAPTER_TYPE,
  manufacturer: 'Snapmaker',
  label: 'Snapmaker U1 (Moonraker)',
  models: ['U1'],
  capabilities: CAPABILITIES,
  configFields: [
    { name: 'httpPort', label: 'Moonraker port', required: true, type: 'number', defaultValue: 7125, min: 1, max: 65535, help: 'Stock Moonraker normally listens on port 7125. Use 80 if your U1 exposes the API only through its Fluidd reverse proxy.' },
    { name: 'apiKey', label: 'Moonraker API key', required: false, secret: true, placeholder: 'Optional', help: 'Leave blank on the normal trusted local network. Only needed if Moonraker authorization requires an API key.' }
  ],
  discover: discoverSnapmakerU1,
  prepareConfig: prepareSnapmakerU1Config,
  create: (printer) => new SnapmakerU1Adapter(printer)
});
