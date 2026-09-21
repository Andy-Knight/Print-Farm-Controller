export class UnsupportedPrinterOperationError extends Error {
  constructor(operation, adapterType = 'unknown') {
    super(`${operation} is not supported by printer adapter ${adapterType}`);
    this.name = 'UnsupportedPrinterOperationError';
    this.operation = operation;
    this.adapterType = adapterType;
  }
}

export const DEFAULT_CAPABILITIES = Object.freeze({
  status: false,
  localFiles: false,
  fileUpload: false,
  printLocalFile: false,
  jobControl: false,
  nozzleTemperature: false,
  toolTemperatures: false,
  bedTemperature: false,
  coolingFan: false,
  chamberFan: false,
  filtration: false,
  bedLeveling: false,
  levelBeforePrint: false,
  camera: false,
  chamberPreheat: false,
  chamberTemperatureSensor: false,
  materialStatus: false,
  materialDesignation: false,
  filamentTypeControl: false,
  filamentColorControl: false,
  nozzleDesignation: false,
  printToolMapping: false,
  materialSlotMapping: false,
  flowCalibrationBeforePrint: false,
  timeLapseBeforePrint: false,
  autoFilamentReplenishment: false,
  filamentEntanglementDetection: false,
  toolheadNozzleStatus: false,
  toolheadOffsetCalibration: false
});

export function normalizeCapabilities(capabilities = {}) {
  return Object.freeze({ ...DEFAULT_CAPABILITIES, ...(capabilities || {}) });
}

export class PrinterAdapter {
  constructor(printer) {
    if (!printer) throw new Error('printer is required');
    this.printer = printer;
  }

  get type() { return 'unknown'; }
  get manufacturer() { return this.printer.manufacturer || 'Unknown'; }
  get model() { return this.printer.model || 'Unknown'; }
  get capabilities() { return DEFAULT_CAPABILITIES; }
  get limits() { return {}; }
  get uploadExtensions() { return []; }

  unsupported(operation) {
    throw new UnsupportedPrinterOperationError(operation, this.type);
  }

  async getStatus() { return this.unsupported('Status'); }
  async getFiles() { return this.unsupported('File listing'); }
  async uploadFile() { return this.unsupported('File upload'); }
  async verifyFile() { return this.unsupported('File verification'); }
  async getPrintSetup() { return null; }
  async printLocalFile() { return this.unsupported('Printing local files'); }
  async setTemperatures() { return this.unsupported('Temperature control'); }
  async setFans() { return this.unsupported('Fan control'); }
  async setFiltration() { return this.unsupported('Filtration control'); }
  async setFilamentColor() { return this.unsupported('Filament colour control'); }
  // Optional lifecycle hooks used by the generic bounded chamber-preheat service.
  // Adapters that need printer-native circulation/mode changes can override them.
  async prepareChamberPreheat() { return null; }
  async finishChamberPreheat() { return null; }
  async setJobState() { return this.unsupported('Job control'); }
  async levelBed() { return this.unsupported('Bed levelling'); }
  async calibrateToolOffsets() { return this.unsupported('Toolhead offset calibration'); }
  async activateCamera() { return this.unsupported('Camera activation'); }
  async getCameraSource() { return null; }
  fallbackCameraUrl() { return null; }
}
