import path from 'node:path';
import { getPrinter } from './store.js';
import { getPrinterAdapter } from './adapters/adapter-registry.js';
import { isPrintJobActive } from './chamber-preheat.js';
import { readFileMaterialMetadata, assessMaterialCompatibility } from './file-material-metadata.js';
import { savePrinterFileMaterialMetadata } from './file-material-store.js';

const MAX_DISTRIBUTION_PRINTERS = 50;
const VERIFY_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizedFileName(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^0:\/user\//i, '')
    .replace(/^\/data\//i, '')
    .replace(/^\/+/, '')
    .trim()
    .toLocaleLowerCase();
}

export function validateDistributionRequest({ printerIds, fileName, startPrint = false, levelingBeforePrint = true, flowCalibrationBeforePrint = false } = {}) {
  if (!Array.isArray(printerIds)) throw new Error('printerIds must be an array');
  const ids = [...new Set(printerIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new Error('Select at least one printer');
  if (ids.length > MAX_DISTRIBUTION_PRINTERS) throw new Error(`A distribution may contain at most ${MAX_DISTRIBUTION_PRINTERS} printers`);
  const name = String(fileName || '').trim();
  if (!name) throw new Error('fileName is required');
  return { printerIds: ids, fileName: name, startPrint: Boolean(startPrint), levelingBeforePrint: Boolean(levelingBeforePrint), flowCalibrationBeforePrint: Boolean(flowCalibrationBeforePrint) };
}

/**
 * Generic verification entry point. Adapters normally own file verification.
 * The optional list functions remain for protocol/unit testing and custom adapters.
 */
export async function verifyPrinterFile(printer, fileName, {
  attempts = VERIFY_ATTEMPTS,
  adapterResolver = getPrinterAdapter,
  listAllFilesFn = null,
  getRecentFilesFn = null
} = {}) {
  if (!listAllFilesFn && !getRecentFilesFn) {
    return adapterResolver(printer).verifyFile(fileName, { attempts });
  }

  const wanted = normalizedFileName(fileName);
  let lastError = null;

  if (listAllFilesFn) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await sleep(500 * attempt);
      try {
        const files = await listAllFilesFn(printer);
        if (files.some((file) => normalizedFileName(file) === wanted)) return { verified: true, source: 'tcp-m661' };
      } catch (error) {
        lastError = error;
        break;
      }
    }
  }

  if (getRecentFilesFn) {
    try {
      const recent = await getRecentFilesFn(printer);
      if (recent.some((file) => normalizedFileName(file) === wanted)) return { verified: true, source: 'http-recent' };
    } catch (error) {
      lastError ||= error;
    }
  }

  return {
    verified: false,
    source: null,
    warning: lastError ? `Upload accepted, but verification failed: ${lastError.message}` : 'Upload accepted, but the file was not visible in printer storage after verification.'
  };
}

export class FileDistributionService {
  constructor({
    fleetState,
    chamberPreheat,
    getPrinterFn = getPrinter,
    adapterResolver = getPrinterAdapter,
    uploadFileFn = null,
    verifyFileFn = null,
    printLocalFileFn = null,
    fileMetadataReader = readFileMaterialMetadata,
    fileMetadataSaver = savePrinterFileMaterialMetadata,
    printerAllowedFn = null,
    operationCoordinator = null,
    maxConcurrent = 2
  } = {}) {
    if (!fleetState) throw new Error('fleetState is required');
    if (!chamberPreheat) throw new Error('chamberPreheat is required');
    this.fleetState = fleetState;
    this.chamberPreheat = chamberPreheat;
    this.getPrinter = getPrinterFn;
    this.adapterResolver = adapterResolver;
    this.uploadFileOverride = uploadFileFn;
    this.verifyFileOverride = verifyFileFn;
    this.printLocalFileOverride = printLocalFileFn;
    this.fileMetadataReader = fileMetadataReader;
    this.fileMetadataSaver = fileMetadataSaver;
    this.printerAllowed = typeof printerAllowedFn === 'function' ? printerAllowedFn : () => true;
    this.operationCoordinator = operationCoordinator;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 2);
  }

  async distribute({ printerIds, filePath, fileName, startPrint = false, levelingBeforePrint = true, flowCalibrationBeforePrint = false }) {
    const request = validateDistributionRequest({ printerIds, fileName, startPrint, levelingBeforePrint, flowCalibrationBeforePrint });
    if (!filePath) throw new Error('filePath is required');
    const queue = [...request.printerIds];
    const results = [];
    let fileMaterialMetadata = null;
    try {
      fileMaterialMetadata = await this.fileMetadataReader(filePath);
    } catch {
      fileMaterialMetadata = null;
    }

    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        results.push(await this.distributeOne(id, { ...request, filePath, fileMaterialMetadata }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.maxConcurrent, queue.length) }, () => worker()));

    const order = new Map(request.printerIds.map((id, index) => [id, index]));
    results.sort((a, b) => order.get(a.id) - order.get(b.id));
    return {
      fileName: request.fileName,
      requested: request.printerIds.length,
      uploaded: results.filter((item) => item.uploaded).length,
      verified: results.filter((item) => item.verified).length,
      started: results.filter((item) => item.started).length,
      succeeded: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results
    };
  }

  async distributeOne(id, options) {
    if (!this.operationCoordinator) return this.distributeOneUnlocked(id, options);
    const label = options.startPrint ? 'file upload and print start' : 'file upload';
    try {
      return await this.operationCoordinator.run(id, label, () => this.distributeOneUnlocked(id, options));
    } catch (error) {
      const printer = await this.getPrinter(id).catch(() => null);
      return {
        id,
        name:printer?.name || id,
        ok:false,
        uploaded:false,
        verified:false,
        started:false,
        error:error.message || 'Printer operation is busy'
      };
    }
  }

  async distributeOneUnlocked(id, { filePath, fileName, startPrint, levelingBeforePrint, flowCalibrationBeforePrint, fileMaterialMetadata = null }) {
    const printer = await this.getPrinter(id);
    const name = printer?.name || id;
    if (!printer) return { id, name, ok: false, uploaded: false, verified: false, started: false, error: 'Printer not found' };
    if (!this.printerAllowed(id)) return { id, name, ok:false, uploaded:false, verified:false, started:false, error:'Printer is inactive because it does not currently have a licence slot' };

    const state = this.fleetState.getPrinterState(id);
    if (!state?.online) return { id, name, ok: false, uploaded: false, verified: false, started: false, error: state?.error || 'Printer is offline' };
    if (startPrint && isPrintJobActive(state.status || {})) {
      return { id, name, ok: false, uploaded: false, verified: false, started: false, error: 'Printer already has an active print; upload/start skipped' };
    }

    let uploaded = false;
    let verified = false;
    let verificationSource = null;
    let started = false;
    try {
      const adapter = this.adapterResolver(printer);
      if (!adapter.capabilities?.fileUpload) throw new Error('File upload is not supported by this printer');
      if (!adapter.capabilities?.localFiles) throw new Error('Printer storage verification is not supported by this printer');
      if (startPrint && !adapter.capabilities?.printLocalFile) throw new Error('Starting uploaded files is not supported by this printer');
      const uploadExtensions = [...new Set((adapter.uploadExtensions || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
      const extension = path.extname(fileName).toLowerCase();
      if (uploadExtensions.length && !uploadExtensions.includes(extension)) {
        throw new Error(`${adapter.manufacturer || adapter.type || 'This printer'} does not support ${extension || 'this file type'} uploads. Supported: ${uploadExtensions.join(', ')}`);
      }

      if (this.uploadFileOverride) {
        await this.uploadFileOverride(printer, filePath, {
          firmwareVersion: state.status?.firmwareVersion,
          levelingBeforePrint
        });
      } else {
        await adapter.uploadFile(filePath, {
          fileName,
          firmwareVersion: state.status?.firmwareVersion,
          levelingBeforePrint
        });
      }
      uploaded = true;

      const verification = this.verifyFileOverride
        ? await this.verifyFileOverride(printer, fileName)
        : await adapter.verifyFile(fileName);
      verified = Boolean(verification.verified);
      verificationSource = verification.source || null;
      if (!verified) {
        return {
          id, name, adapterType: adapter.type, ok: false, uploaded, verified, started, verificationSource,
          error: `${verification.warning}${startPrint ? ' Print was not started.' : ''}`
        };
      }

      if (fileMaterialMetadata?.metadataAvailable) {
        await this.fileMetadataSaver(printer.id, fileName, fileMaterialMetadata).catch(() => {});
      }

      if (startPrint) {
        const materialCheck = assessMaterialCompatibility(printer.adapterConfig?.filamentDesignation, fileMaterialMetadata || {});
        if (materialCheck.mismatch) {
          return {
            id, name, adapterType: adapter.type, ok: false, uploaded, verified, started, verificationSource,
            error: `Material mismatch: file requires ${materialCheck.requiredMaterial}, but this printer is manually designated ${materialCheck.designatedMaterial}. Print was not started.`
          };
        }
        if (this.chamberPreheat.isActive(id)) {
          await this.chamberPreheat.stop(id, { reason: 'distribution-print-started', turnOff: false });
        }
        if (this.printLocalFileOverride) await this.printLocalFileOverride(printer, fileName, levelingBeforePrint);
        else await adapter.printLocalFile(fileName, { levelingBeforePrint, flowCalibrationBeforePrint });
        started = true;
      }

      return { id, name, adapterType: adapter.type, ok: true, uploaded, verified, verificationSource, started };
    } catch (error) {
      return { id, name, ok: false, uploaded, verified, verificationSource, started, error: error.message || 'File distribution failed' };
    }
  }
}
