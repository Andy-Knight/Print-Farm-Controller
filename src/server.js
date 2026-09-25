import http from 'node:http';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  addPrinter,
  getPrinter,
  listPrinters,
  publicPrinter,
  removePrinter,
  renamePrinter,
  reorderPrinters,
  setPrinterLicenseSlotActive,
  setPrinterMaterialDesignation,
  setPrinterNozzleDesignation,
  controllerDataDir
} from './store.js';
import {
  getPrinterAdapter,
  listAdapterDefinitions,
  discoverSupportedPrinters,
  preparePrinterConfig
} from './adapters/adapter-registry.js';
import { FleetStateService } from './fleet-state.js';
import { CameraManager } from './camera-manager.js';
import { ChamberPreheatService } from './chamber-preheat.js';
import { BatchControlService } from './batch-control.js';
import { FileDistributionService } from './file-distribution.js';
import { stageUploadRequest } from './upload-staging.js';
import { addLibraryFile, getLibraryPreview, listLibraryFiles, removeLibraryFile, updateLibraryFileMetadata } from './print-library.js';
import { PrintQueueService } from './print-queue.js';
import { assessMaterialCompatibility } from './file-material-metadata.js';
import { getPrinterFileMaterialMetadata, removePrinterFileMaterialMetadata } from './file-material-store.js';
import { EmulatorManager } from './emulator-manager.js';
import { loadLicenseManager } from './licensing/license-loader.js';
import { resolveControllerRuntimePaths } from './runtime-paths.js';
import { publicAssetKey, readRuntimeAsset } from './runtime-assets.js';
import { KeyedSerialExecutor, PrinterOperationCoordinator } from './concurrency.js';
import { evaluatePrinterOperation, PrinterPhysicalActivityTracker, PRINTER_OPERATION_TYPES } from './printer-operation-policy.js';
import { DiagnosticLogger } from './diagnostic-logger.js';
import { MaintenanceService } from './maintenance-service.js';
import { PrinterGroupService } from './printer-groups.js';
import { ManualBackupManager } from './backup-recovery/manual-backup-manager.js';
import { BackupOperationLock } from './backup-recovery/backup-operation-lock.js';
import { ScheduledBackupService } from './backup-recovery/scheduled-backup-service.js';
import { inspectRestoreBackup } from './backup-recovery/restore-inspector.js';
import { stageRestoreUploadRequest } from './backup-recovery/restore-upload-staging.js';
import {
  activatePendingRestore,
  cancelStagedRestore,
  commitActivatedRestore,
  pendingRestoreStatus,
  rollbackActivatedRestore,
  stageRestoreBackup
} from './backup-recovery/restore-service.js';

const runtimePaths = resolveControllerRuntimePaths();
const PUBLIC_DIR = runtimePaths.publicDir;
const APP_DIR = runtimePaths.applicationDir;
const PACKAGE_PATH = runtimePaths.packageJsonPath;
const bundledVersion = typeof __PFC_VERSION__ === 'string' ? __PFC_VERSION__ : null;
const packageInfo = PACKAGE_PATH ? JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) : {};
const CONTROLLER_VERSION = String(bundledVersion || packageInfo.version || 'unknown');
const PORT = Number(process.env.PORT || 4242);
const HOST = process.env.HOST || '0.0.0.0';
const diagnosticLogger = new DiagnosticLogger({ logDir:runtimePaths.logDir, version:CONTROLLER_VERSION });
const backupOperationLock = new BackupOperationLock();
const manualBackupManager = new ManualBackupManager({
  dataDir:runtimePaths.dataDir,
  applicationDir:runtimePaths.applicationDir,
  licensePath:runtimePaths.licensePath,
  controllerVersion:CONTROLLER_VERSION,
  operationLock:backupOperationLock
});
const scheduledBackupService = new ScheduledBackupService({
  dataDir:runtimePaths.dataDir,
  applicationDir:runtimePaths.applicationDir,
  licensePath:runtimePaths.licensePath,
  controllerVersion:CONTROLLER_VERSION,
  operationLock:backupOperationLock,
  diagnosticFn:(level, message, meta) => diagnosticLogger[level]?.('backup', message, meta)
});
const fleetState = new FleetStateService({
  diagnosticFn:(level, message, meta) => diagnosticLogger[level]?.('fleet', message, meta)
});
const printerActivities = new PrinterPhysicalActivityTracker();
const U1_BED_LEVEL_SOAK_MS = 120_000;
const u1BedLevelProgress = new Map();
let chamberPreheat = null;
const printerOperations = new PrinterOperationCoordinator({
  evaluateFn:evaluatePrinterOperation,
  contextProvider:(id) => {
    const state = fleetState.getPrinterState(id);
    return {
      status:state?.status || {},
      chamberPreheatActive:Boolean(chamberPreheat?.isActive(id)),
      trackedActivity:printerActivities.current(id, state?.status || null)
    };
  }
});
const controllerMutations = new KeyedSerialExecutor();
const cameraManager = new CameraManager({
  onHealthChange: (id, health) => fleetState.setCameraHealth(id, health)
});
chamberPreheat = new ChamberPreheatService({ fleetState, operationCoordinator:printerOperations });
const emulatorManager = new EmulatorManager();
let licenseManager = null;
let restoreInspectionInProgress = false;
let restorePendingRestart = false;
let activeMutationRequests = 0;

function isControllerSimulator(printer) {
  return printer?.simulated === true || emulatorManager.isSimulatedConfig(printer);
}

function resolveLicensedFleet(printers = fleetState.getFleet()) {
  return licenseManager.resolvePrinterAccess(printers, {
    isSimulated: isControllerSimulator
  });
}

function controllerActivityFor(printer) {
  const activity = printerActivities.current(printer?.id, printer?.status || null);
  if (!activity) {
    u1BedLevelProgress.delete(String(printer?.id || ''));
    return null;
  }

  if (printer?.adapterType !== 'snapmaker-u1' || activity.kind !== 'bed-leveling') {
    u1BedLevelProgress.delete(String(printer?.id || ''));
    return activity;
  }

  const id = String(printer.id || '');
  const actual = Number(printer.status?.bed?.actual);
  const target = Number(printer.status?.bed?.target);
  const now = Date.now();
  const progress = u1BedLevelProgress.get(id) || { stableSinceMs:null };
  let phase = 'homing';
  let remainingSeconds = null;

  if (Number.isFinite(target) && target >= 50) {
    if (!Number.isFinite(actual) || actual < target - 1) {
      phase = 'heating';
      progress.stableSinceMs = null;
    } else {
      if (!progress.stableSinceMs) progress.stableSinceMs = now;
      const stableForMs = Math.max(0, now - progress.stableSinceMs);
      if (stableForMs < U1_BED_LEVEL_SOAK_MS) {
        phase = 'stabilising';
        remainingSeconds = Math.max(0, Math.ceil((U1_BED_LEVEL_SOAK_MS - stableForMs) / 1000));
      } else {
        phase = 'probing';
      }
    }
  } else {
    progress.stableSinceMs = null;
  }

  u1BedLevelProgress.set(id, progress);
  return {
    ...activity,
    phase,
    remainingSeconds,
    bedActual:Number.isFinite(actual) ? actual : null,
    bedTarget:Number.isFinite(target) ? target : null
  };
}

function decoratedFleet(printers = fleetState.getFleet()) {
  return resolveLicensedFleet(printers).printers.map((printer) => {
    const controllerActivity = controllerActivityFor(printer);
    const maintenance = maintenanceService?.getPrinterStatus?.(printer.id) || { state:'none', total:0, due:0, dueSoon:0 };
    return {
      ...printer,
      ...(controllerActivity ? { controllerActivity } : {}),
      maintenance
    };
  });
}

function currentLicenseSnapshot(printers = fleetState.getFleet()) {
  return licenseManager.getSnapshot({
    printers,
    isSimulated: isControllerSimulator
  });
}

function restorePhysicalActivityBlockers() {
  const blockers = [];
  const activeQueue = printQueue?.getSnapshot?.().active || 0;
  if (activeQueue > 0) blockers.push(`${activeQueue} controller queue operation${activeQueue === 1 ? '' : 's'} are active`);

  const fleetById = new Map(decoratedFleet().map((printer) => [printer.id, printer]));
  for (const operation of printerOperations.activeOperations()) {
    const printer = fleetById.get(operation.printerId);
    if (!printer || isControllerSimulator(printer)) continue;
    blockers.push(`${printer.name || printer.id}: ${operation.label || 'controller operation'}`);
  }

  for (const printer of fleetById.values()) {
    if (isControllerSimulator(printer)) continue;
    const state = String(printer?.status?.status || '').trim().toLowerCase();
    const activePrint = ['printing','working','building_from_sd','pause','paused'].includes(state)
      || (state === 'heating' && Boolean(printer?.status?.fileName));
    if (activePrint) blockers.push(`${printer.name || printer.id}: active print`);
    if (printer?.chamberPreheat?.active) blockers.push(`${printer.name || printer.id}: chamber preheat`);
    if (printer?.controllerActivity) blockers.push(`${printer.name || printer.id}: ${printer.controllerActivity.label || printer.controllerActivity.kind || 'controller operation'}`);
  }
  return [...new Set(blockers)];
}

function printerLicensedForNewWork(printerId) {
  const printer = resolveLicensedFleet().printers.find((item) => item.id === printerId);
  return printer ? printer.licenseActive !== false : false;
}

async function runPrinterMutation(printerId, label, task, { allowInactive = false, operationType = null } = {}) {
  const meta = { printerId, operationType:operationType || null, label };
  await diagnosticLogger.debug('printer-operation', 'Starting printer operation', meta);
  try {
    const result = await printerOperations.run(printerId, label, async () => {
      const currentPrinter = await getPrinter(printerId);
      if (!currentPrinter) {
        const error = new Error('Printer not found');
        error.statusCode = 404;
        throw error;
      }
      if (!allowInactive && !printerLicensedForNewWork(printerId)) {
        const error = new Error('Printer is inactive because it does not currently have a licence slot. Select it for a licence slot before sending new control commands.');
        error.statusCode = 409;
        throw error;
      }
      return task(currentPrinter, getPrinterAdapter(currentPrinter));
    }, { operationType });
    await diagnosticLogger.info('printer-operation', 'Printer operation completed', meta);
    return result;
  } catch (error) {
    await diagnosticLogger.warn('printer-operation', 'Printer operation failed or was blocked', {
      ...meta,
      error:error?.message || String(error),
      statusCode:error?.statusCode || null
    });
    throw error;
  }
}

const batchControl = new BatchControlService({
  fleetState,
  chamberPreheat,
  printerAllowedFn: printerLicensedForNewWork,
  operationCoordinator:printerOperations
});
const fileDistribution = new FileDistributionService({
  fleetState,
  chamberPreheat,
  printerAllowedFn: printerLicensedForNewWork,
  operationCoordinator:printerOperations
});
const printerGroups = new PrinterGroupService({ dataDir:runtimePaths.dataDir });
const printQueue = new PrintQueueService({
  fleetState,
  chamberPreheat,
  getPrinterGroupFn:(groupId) => printerGroups.get(groupId),
  printerAllowedFn: printerLicensedForNewWork,
  operationCoordinator:printerOperations,
  onChange: () => fleetState.schedulePublish(),
  diagnosticFn:(level, message, meta) => diagnosticLogger[level]?.('queue', message, meta)
});
const maintenanceService = new MaintenanceService({
  fleetState,
  groupLookupFn:(groupId) => printerGroups.get(groupId)
});
const toolOffsetCalibrationLocks = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function installLicenseDocument(input) {
  const documentText = typeof input === 'string'
    ? input.trim()
    : (input && typeof input === 'object' ? JSON.stringify(input) : '');

  if (!documentText) {
    const error = new Error('Select a licence file to install');
    error.statusCode = 400;
    throw error;
  }
  if (Buffer.byteLength(documentText, 'utf8') > 256_000) {
    const error = new Error('Licence file is too large');
    error.statusCode = 400;
    throw error;
  }

  const validationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'print-controller-license-install-'));
  let candidate;
  try {
    await fs.writeFile(path.join(validationDir, 'license.json'), `${documentText}\n`, { encoding:'utf8', mode:0o600 });
    candidate = await loadLicenseManager({
      appDir:validationDir,
      dataDir:null,
      env:{},
      now:new Date()
    });
  } finally {
    await fs.rm(validationDir, { recursive:true, force:true }).catch(() => {});
  }

  const candidateSnapshot = candidate.getSnapshot();
  if (candidateSnapshot.licenseStatus !== 'valid') {
    const error = new Error(candidateSnapshot.configurationWarning || 'Licence file is invalid or expired');
    error.statusCode = 400;
    throw error;
  }

  const target = runtimePaths.licensePath;
  try {
    await fs.writeFile(target, `${documentText}\n`, { encoding:'utf8', mode:0o600 });
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      const permissionError = new Error(
        `Windows blocked writing the licence to ${target}. Restart Print Farm Controller with Administrator rights, then install the licence again.`
      );
      permissionError.statusCode = 403;
      throw permissionError;
    }
    throw error;
  }

  licenseManager = await loadLicenseManager({
    appDir:APP_DIR,
    dataDir:controllerDataDir,
    preferredLicenseFile:runtimePaths.licensePath
  });

  fleetState.schedulePublish();
  const installedLicense = {
    ...candidateSnapshot,
    licenseFile:target
  };
  return {
    ok:true,
    restartRequired:false,
    installedLicense,
    license:currentLicenseSnapshot()
  };
}

function validateAddPrinter(body) {
  return preparePrinterConfig(body);
}

function validatePrinterModelTarget(input, errorMessage = 'Choose a supported printer model') {
  if (input == null || input === '' || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error(errorMessage);
    error.statusCode = 400;
    throw error;
  }
  const requestedType = String(input.adapterType || '').trim();
  const requestedModel = String(input.model || '').trim();
  const adapter = listAdapterDefinitions().find((item) => String(item.type) === requestedType);
  const model = adapter?.models?.find((item) => String(item).toLowerCase() === requestedModel.toLowerCase());
  if (!adapter || !model) {
    const error = new Error(errorMessage);
    error.statusCode = 400;
    throw error;
  }
  return { adapterType:adapter.type, model };
}

function validateLibraryPrinterTarget(input) {
  if (input == null || input === '') return null;
  return validatePrinterModelTarget(input, 'Choose a supported printer type for this Print Library file');
}

function validatePrinterGroupTarget(input, errorMessage = 'Choose a printer group') {
  const groupId = typeof input === 'object' && input !== null
    ? String(input.groupId || '').trim()
    : String(input || '').trim();
  const group = groupId ? printerGroups.get(groupId) : null;
  if (!group) {
    const error = new Error(errorMessage);
    error.statusCode = 400;
    throw error;
  }
  return { groupId:group.id };
}

function openEventStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write('retry: 2000\n\n');

  const unsubscribe = fleetState.subscribe((printers) => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: fleet\ndata: ${JSON.stringify({
      printers:decoratedFleet(printers),
      queue:printQueue.getSnapshot(),
      version:CONTROLLER_VERSION,
      license:currentLicenseSnapshot(printers),
      serverTime:new Date().toISOString()
    })}\n\n`);
  });
  const keepAlive = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);
  const cleanup = () => {
    clearInterval(keepAlive);
    unsubscribe();
  };
  req.once('close', cleanup);
  res.once('close', cleanup);
}

async function refreshAfterCommand(id) {
  // Allow the printer a moment to apply the command, then move it to the front of the poll queue.
  setTimeout(() => fleetState.refreshNow(id).catch(() => {}), 250);
}

async function apiRoute(req, res, url) {
  const mutation = ['POST','PUT','PATCH','DELETE'].includes(req.method);
  const mayCancelStagedRestore = req.method === 'DELETE' && url.pathname === '/api/restore/stage';
  if ((restorePendingRestart || restoreInspectionInProgress) && mutation && !mayCancelStagedRestore) {
    const error = new Error(restorePendingRestart
      ? 'A restore is staged and waiting for controller restart. Restart the controller to activate it, or cancel the staged restore before making further changes.'
      : 'A restore backup operation is in progress. Try this change again after it finishes.');
    error.statusCode = 409;
    throw error;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'printer-fleet-controller', version: CONTROLLER_VERSION, license: currentLicenseSnapshot(), liveState: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/license') {
    return json(res, 200, { license: currentLicenseSnapshot() });
  }

  if (req.method === 'GET' && url.pathname === '/api/backup/status') {
    const [manual, schedule] = await Promise.all([
      manualBackupManager.status(),
      scheduledBackupService.status()
    ]);
    return json(res, 200, {
      backup:{
        ...manual,
        schedule,
        operation:backupOperationLock.status()
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/backup/settings') {
    return json(res, 200, { schedule:await scheduledBackupService.status() });
  }

  if (req.method === 'PUT' && url.pathname === '/api/backup/settings') {
    const body = await readJson(req);
    const schedule = await scheduledBackupService.updateSettings(body);
    return json(res, 200, { schedule });
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/test-destination') {
    const body = await readJson(req);
    const result = await scheduledBackupService.testDestination(body.destination);
    return json(res, 200, { destination:result });
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/create') {
    await diagnosticLogger.info('backup', 'Manual backup requested');
    try {
      const backup = await manualBackupManager.create();
      await diagnosticLogger.info('backup', 'Manual backup created and verified', {
        fileName:backup.fileName,
        size:backup.size,
        createdAt:backup.manifest?.createdAt || null,
        printers:backup.manifest?.counts?.printers ?? null,
        printLibrary:backup.manifest?.counts?.printLibrary ?? null,
        queued:backup.manifest?.counts?.queued ?? null,
        history:backup.manifest?.counts?.history ?? null,
        licenseIncluded:backup.manifest?.licenseIncluded === true
      });
      return json(res, 201, { backup });
    } catch (error) {
      await diagnosticLogger.warn('backup', 'Manual backup creation failed', {
        error:error?.message || String(error)
      });
      throw error;
    }
  }

  const backupDownloadMatch = url.pathname.match(/^\/api\/backup\/download\/([^/]+)$/);
  if (backupDownloadMatch && req.method === 'GET') {
    const backupId = decodeURIComponent(backupDownloadMatch[1]);
    await diagnosticLogger.info('backup', 'Manual backup download started', { backupId });
    try {
      await manualBackupManager.stream(backupId, res);
      await diagnosticLogger.info('backup', 'Manual backup download completed', { backupId });
      return;
    } catch (error) {
      if (!res.headersSent) throw error;
      await diagnosticLogger.warn('backup', 'Manual backup download interrupted', {
        backupId,
        error:error?.message || String(error)
      });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/restore/status') {
    return json(res, 200, { restore:await pendingRestoreStatus(runtimePaths.dataDir) });
  }

  if (req.method === 'POST' && url.pathname === '/api/restore/stage') {
    if (restoreInspectionInProgress) {
      const error = new Error('A restore backup operation is already in progress');
      error.statusCode = 409;
      throw error;
    }

    printQueue.setDispatchPaused(true);
    scheduledBackupService.stop();
    restoreInspectionInProgress = true;
    const blockers = restorePhysicalActivityBlockers();
    if (activeMutationRequests > 1) blockers.push('another controller change request is still in progress');
    if (backupOperationLock.isBusy()) blockers.push(`${backupOperationLock.status()?.kind || 'backup'} backup operation is still in progress`);
    if (blockers.length) {
      restoreInspectionInProgress = false;
      printQueue.setDispatchPaused(false);
      scheduledBackupService.start().catch(() => {});
      const error = new Error(`Restore cannot be staged while controller or physical printer work is active: ${blockers.join('; ')}`);
      error.statusCode = 409;
      throw error;
    }

    let uploaded = null;
    let stagedSuccessfully = false;
    try {
      uploaded = await stageRestoreUploadRequest(req, req.headers['x-file-name']);
      await diagnosticLogger.info('restore', 'Restore staging requested', {
        fileName:uploaded.fileName,
        size:uploaded.size
      });
      const restore = await stageRestoreBackup(uploaded.filePath, {
        dataDir:runtimePaths.dataDir,
        licensePath:runtimePaths.licensePath,
        currentControllerVersion:CONTROLLER_VERSION,
        originalFileName:uploaded.fileName
      });
      restorePendingRestart = true;
      stagedSuccessfully = true;
      await diagnosticLogger.warn('restore', 'Restore staged; controller restart required', {
        fileName:restore.fileName,
        backupId:restore.backupId,
        recoveryHeldJobs:restore.recoveryHeldJobs
      });
      return json(res, 202, { restore });
    } catch (error) {
      await diagnosticLogger.warn('restore', 'Restore staging failed', {
        fileName:uploaded?.fileName || null,
        error:error?.message || String(error)
      });
      throw error;
    } finally {
      restoreInspectionInProgress = false;
      if (!stagedSuccessfully) {
        printQueue.setDispatchPaused(false);
        scheduledBackupService.start().catch(() => {});
      }
      await uploaded?.cleanup().catch(() => {});
    }
  }

  if (req.method === 'DELETE' && url.pathname === '/api/restore/stage') {
    const result = await cancelStagedRestore(runtimePaths.dataDir);
    restorePendingRestart = false;
    printQueue.setDispatchPaused(false);
    await scheduledBackupService.start();
    await diagnosticLogger.info('restore', 'Staged restore cancelled', {
      backupId:result.backupId || null,
      fileName:result.fileName || null
    });
    return json(res, 200, { restore:result });
  }

  if (req.method === 'POST' && url.pathname === '/api/restore/inspect') {
    if (restoreInspectionInProgress) {
      const error = new Error('A restore backup is already being inspected');
      error.statusCode = 409;
      throw error;
    }
    restoreInspectionInProgress = true;
    let staged = null;
    try {
      staged = await stageRestoreUploadRequest(req, req.headers['x-file-name']);
      await diagnosticLogger.info('restore', 'Restore backup inspection requested', {
        fileName:staged.fileName,
        size:staged.size
      });
      const inspection = await inspectRestoreBackup(staged.filePath, {
        currentControllerVersion:CONTROLLER_VERSION,
        targetDataDir:runtimePaths.dataDir,
        originalFileName:staged.fileName
      });
      await diagnosticLogger.info('restore', 'Restore backup inspection passed', {
        fileName:inspection.fileName,
        sourceControllerVersion:inspection.sourceControllerVersion,
        createdAt:inspection.createdAt,
        printers:inspection.counts.printers,
        printLibrary:inspection.counts.printLibrary,
        queued:inspection.counts.queued,
        history:inspection.counts.history,
        licenseIncluded:inspection.licenseIncluded,
        migrationsRequired:inspection.migrationsRequired.length
      });
      return json(res, 200, { inspection });
    } catch (error) {
      await diagnosticLogger.warn('restore', 'Restore backup inspection failed', {
        fileName:staged?.fileName || null,
        error:error?.message || String(error)
      });
      throw error;
    } finally {
      restoreInspectionInProgress = false;
      await staged?.cleanup().catch(() => {});
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    const entries = await diagnosticLogger.recent({
      limit:url.searchParams.get('limit') || 300,
      level:url.searchParams.get('level') || '',
      search:url.searchParams.get('search') || ''
    });
    return json(res, 200, { status:diagnosticLogger.status(), entries });
  }

  if (req.method === 'POST' && url.pathname === '/api/diagnostics/verbose') {
    const body = await readJson(req);
    const status = await diagnosticLogger.setVerbose(body.enabled !== false, body.minutes || 30);
    return json(res, 200, { status });
  }

  if (req.method === 'GET' && url.pathname === '/api/diagnostics/bundle') {
    await diagnosticLogger.info('diagnostics', 'Diagnostic bundle requested');
    const printers = decoratedFleet().map((printer) => ({
      id:printer.id,
      name:printer.name,
      host:printer.host,
      manufacturer:printer.manufacturer,
      model:printer.model,
      adapterType:printer.adapterType,
      serialNumber:printer.serialNumber,
      online:printer.online,
      lastSeen:printer.lastSeen,
      latencyMs:printer.latencyMs,
      consecutiveFailures:printer.consecutiveFailures,
      capabilities:printer.capabilities,
      status:printer.status,
      cameraHealth:printer.cameraHealth,
      chamberPreheat:printer.chamberPreheat,
      controllerActivity:printer.controllerActivity
    }));
    const license = currentLicenseSnapshot();
    const bundle = await diagnosticLogger.createBundle({
      system:{
        controllerVersion:CONTROLLER_VERSION,
        generatedAt:new Date().toISOString(),
        nodeVersion:process.version,
        platform:process.platform,
        architecture:process.arch,
        uptimeSeconds:Math.round(process.uptime()),
        runningAsSea:runtimePaths.runningAsSea,
        dataDirectoryMode:runtimePaths.customDataDir ? 'custom' : 'application-local',
        logDirectoryMode:runtimePaths.customLogDir ? 'custom' : 'application-local',
        license:{
          edition:license.edition,
          label:license.label,
          licenseStatus:license.licenseStatus,
          enforcementEnabled:license.enforcementEnabled,
          maxPrinters:license.maxPrinters
        }
      },
      printers,
      queue:(() => {
        const snapshot = printQueue.getSnapshot();
        return {
          queued:snapshot.queued,
          active:snapshot.active,
          history:snapshot.history,
          needsReview:snapshot.needsReview,
          awaitingClearance:snapshot.awaitingClearance,
          bedClearance:snapshot.bedClearance,
          jobs:(snapshot.jobs || []).map((job) => ({
            id:job.id,
            fileName:job.fileName,
            assignmentMode:job.assignmentMode,
            printerId:job.printerId,
            printerName:job.printerName,
            priority:job.priority,
            status:job.status,
            queuedAt:job.queuedAt,
            startedAt:job.startedAt,
            finishedAt:job.finishedAt,
            selectionReason:job.selectionReason,
            error:job.error,
            bedClearanceRequired:job.bedClearanceRequired
          }))
        };
      })()
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.writeHead(200, {
      'content-type':'application/zip',
      'content-length':bundle.length,
      'content-disposition':`attachment; filename="PrintFarmController-Diagnostics-${stamp}.zip"`,
      'cache-control':'no-store'
    });
    res.end(bundle);
    return;
  }


  if (req.method === 'POST' && url.pathname === '/api/license/install') {
    const body = await readJson(req);
    const result = await controllerMutations.run('printer-registry', () => installLicenseDocument(body.license));
    return json(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/adapters') {
    return json(res, 200, { adapters: listAdapterDefinitions() });
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    openEventStream(req, res);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/discovery') {
    const [discovered, saved] = await Promise.all([
      discoverSupportedPrinters(),
      listPrinters()
    ]);
    const savedHosts = new Set(saved.map((printer) => printer.host));
    const savedSerials = new Set(saved.map((printer) => printer.serialNumber).filter(Boolean));
    return json(res, 200, {
      printers: discovered.map((printer) => ({
        ...printer,
        alreadyAdded: savedHosts.has(printer.host) || (printer.serialNumber && savedSerials.has(printer.serialNumber))
      }))
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/printer-groups') {
    const printers = (await listPrinters()).map(publicPrinter);
    return json(res, 200, printerGroups.snapshot(printers));
  }

  if (req.method === 'POST' && url.pathname === '/api/printer-groups') {
    const body = await readJson(req);
    const group = await controllerMutations.run('printer-groups', () => printerGroups.create({
      name:body.name,
      printerIds:body.printerIds
    }));
    await diagnosticLogger.info('printer-groups', 'Printer group created', {
      groupId:group.id,
      groupName:group.name,
      members:group.printerIds.length
    });
    fleetState.schedulePublish();
    return json(res, 201, { group });
  }

  const printerGroupMatch = url.pathname.match(/^\/api\/printer-groups\/([^/]+)$/);
  if (printerGroupMatch) {
    const groupId = decodeURIComponent(printerGroupMatch[1]);
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const group = await controllerMutations.run('printer-groups', () => printerGroups.update(groupId, {
        name:body.name,
        printerIds:body.printerIds
      }));
      await diagnosticLogger.info('printer-groups', 'Printer group updated', {
        groupId:group.id,
        groupName:group.name,
        members:group.printerIds.length
      });
      fleetState.schedulePublish();
      return json(res, 200, { group });
    }
    if (req.method === 'DELETE') {
      const activeGroupJobs = (printQueue.getSnapshot().jobs || []).filter((job) =>
        job.groupId === groupId && !['completed','failed','cancelled'].includes(job.status)
      );
      if (activeGroupJobs.length) {
        const error = new Error('This printer group is still referenced by active or queued print jobs');
        error.statusCode = 409;
        throw error;
      }
      if (maintenanceService.hasGroupTaskReference(groupId)) {
        const error = new Error('Delete this group\'s maintenance rules before deleting the printer group');
        error.statusCode = 409;
        throw error;
      }
      const existing = printerGroups.get(groupId);
      await controllerMutations.run('printer-groups', () => printerGroups.delete(groupId));
      await diagnosticLogger.info('printer-groups', 'Printer group deleted', {
        groupId,
        groupName:existing?.name || null
      });
      fleetState.schedulePublish();
      return json(res, 200, { ok:true });
    }
    return json(res, 405, { error:'Printer group operation is not supported' });
  }

  if (req.method === 'GET' && url.pathname === '/api/printers') {
    const printers = decoratedFleet((await listPrinters()).map(publicPrinter));
    return json(res, 200, { printers, license:currentLicenseSnapshot(printers) });
  }

  if (req.method === 'GET' && url.pathname === '/api/fleet') {
    return json(res, 200, { printers: decoratedFleet(), queue: printQueue.getSnapshot(), version: CONTROLLER_VERSION, license: currentLicenseSnapshot() });
  }

  if (req.method === 'GET' && url.pathname === '/api/queue') {
    return json(res, 200, printQueue.getSnapshot());
  }

  if (req.method === 'GET' && url.pathname === '/api/maintenance') {
    const printers = (await listPrinters()).map(publicPrinter);
    return json(res, 200, { maintenance:await maintenanceService.getSnapshot(printers) });
  }

  if (req.method === 'GET' && url.pathname === '/api/library') {
    const queueSnapshot = printQueue.getSnapshot();
    const files = (await listLibraryFiles()).map((file) => {
      const references = (queueSnapshot.jobs || []).filter((job) => job.stagedFile?.id === file.id);
      const completed = references.filter((job) => job.status === 'completed');
      const finished = references
        .map((job) => job.finishedAt)
        .filter(Boolean)
        .sort();
      return {
        ...file,
        previewUrl:file.preview?.available ? `/api/library/${encodeURIComponent(file.id)}/preview` : null,
        usage: {
          queueReferences: references.length,
          activeReferences: references.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status)).length,
          completedPrints: completed.length,
          lastPrintedAt: finished.length ? finished[finished.length - 1] : null
        }
      };
    });
    return json(res, 200, { files });
  }

  if (req.method === 'POST' && url.pathname === '/api/library') {
    const stagedUpload = await stageUploadRequest(req, req.headers['x-file-name']);
    try {
      const file = await controllerMutations.run('library-queue', () => addLibraryFile(stagedUpload.filePath, stagedUpload.fileName));
      return json(res, file.duplicate ? 200 : 201, { file });
    } finally {
      await stagedUpload.cleanup().catch(() => {});
    }
  }

  const libraryPreviewMatch = url.pathname.match(/^\/api\/library\/([^/]+)\/preview$/);
  if (libraryPreviewMatch && req.method === 'GET') {
    const fileId = decodeURIComponent(libraryPreviewMatch[1]);
    const preview = await getLibraryPreview(fileId);
    if (!preview) return json(res, 404, { error:'No preview is available for this Print Library file' });
    const data = await fs.readFile(preview.filePath);
    res.writeHead(200, {
      'content-type':preview.mimeType,
      'content-length':data.length,
      'cache-control':'private, max-age=3600'
    });
    res.end(data);
    return;
  }

  const libraryFileMatch = url.pathname.match(/^\/api\/library\/([^/]+)$/);
  if (libraryFileMatch && req.method === 'PATCH') {
    const fileId = decodeURIComponent(libraryFileMatch[1]);
    const body = await readJson(req);
    const file = await controllerMutations.run('library-queue', () => updateLibraryFileMetadata(fileId, {
      description:body.description,
      printerTarget:body.printerTarget === undefined ? undefined : validateLibraryPrinterTarget(body.printerTarget)
    }));
    return json(res, 200, { file });
  }
  if (libraryFileMatch && req.method === 'DELETE') {
    const fileId = decodeURIComponent(libraryFileMatch[1]);
    await controllerMutations.run('library-queue', async () => {
      const references = (printQueue.getSnapshot().jobs || []).filter((job) => job.stagedFile?.id === fileId);
      if (references.length) {
        throw new Error('This library file is still referenced by the print queue or history. Cancel/clear those records before deleting it.');
      }
      await removeLibraryFile(fileId);
    });
    return json(res, 200, { ok:true });
  }


  if (req.method === 'POST' && url.pathname === '/api/queue/stage') {
    const stagedUpload = await stageUploadRequest(req, req.headers['x-file-name']);
    try {
      const stagedFile = await controllerMutations.run('library-queue', () => addLibraryFile(stagedUpload.filePath, stagedUpload.fileName));
      return json(res, stagedFile.duplicate ? 200 : 201, { stagedFile });
    } finally {
      await stagedUpload.cleanup().catch(() => {});
    }
  }

  const stagedQueueFileMatch = url.pathname.match(/^\/api\/queue\/stage\/([^/]+)$/);
  if (stagedQueueFileMatch && req.method === 'DELETE') {
    // Compatibility with pre-library clients: staged files are now durable
    // Print Library entries, so queue cleanup must never delete them.
    return json(res, 200, { ok:true, preserved:true });
  }

  if (req.method === 'POST' && url.pathname === '/api/queue') {
    const body = await readJson(req);
    const job = await controllerMutations.run('library-queue', () => printQueue.add({
      assignmentMode: body.assignmentMode,
      printerId: body.printerId,
      fileName: body.fileName,
      stagedFileId: body.libraryFileId || body.stagedFileId,
      quantity: body.quantity,
      priority: body.priority,
      groupId: body.groupId || null,
      options: body.options || {}
    }));
    return json(res, 201, { job, queue: printQueue.getSnapshot() });
  }

  if (req.method === 'PUT' && url.pathname === '/api/queue/order') {
    const body = await readJson(req);
    return json(res, 200, await controllerMutations.run('library-queue', () => printQueue.reorder(body.jobIds)));
  }

  if (req.method === 'DELETE' && url.pathname === '/api/queue/history') {
    const cleared = await controllerMutations.run('library-queue', () => printQueue.clearHistory());
    return json(res, 200, { ok: true, cleared, queue: printQueue.getSnapshot() });
  }

  const productionQueueMatch = url.pathname.match(/^\/api\/queue\/production\/([^/]+)\/(pause|resume|cancel|quantity|priority|reprint)$/);
  if (productionQueueMatch && req.method === 'POST') {
    const batchId = decodeURIComponent(productionQueueMatch[1]);
    const action = productionQueueMatch[2];
    const body = ['priority', 'quantity'].includes(action) ? await readJson(req) : {};
    const result = await controllerMutations.run('library-queue', async () => {
      if (action === 'pause') return printQueue.pauseProduction(batchId);
      if (action === 'resume') return printQueue.resumeProduction(batchId);
      if (action === 'cancel') return printQueue.cancelProduction(batchId);
      if (action === 'reprint') return printQueue.reprintProduction(batchId);
      return action === 'priority'
        ? printQueue.setProductionPriority(batchId, body.priority)
        : printQueue.setProductionQuantity(batchId, body.quantity);
    });
    return json(res, 200, { ok:true, production:result, queue:printQueue.getSnapshot() });
  }

  const bedClearanceMatch = url.pathname.match(/^\/api\/queue\/bed-clearance\/([^/]+)$/);
  if (bedClearanceMatch && req.method === 'POST') {
    const result = await controllerMutations.run('library-queue', () => printQueue.clearBed(decodeURIComponent(bedClearanceMatch[1])));
    return json(res, 200, { ok: true, clearance: result, queue: printQueue.getSnapshot() });
  }

  const queueMatch = url.pathname.match(/^\/api\/queue\/([^/]+)(?:\/(reprint|recheck|priority))?$/);
  if (queueMatch) {
    const [, jobId, queueAction] = queueMatch;
    if (req.method === 'DELETE' && !queueAction) {
      const job = await controllerMutations.run('library-queue', () => printQueue.cancel(jobId));
      return json(res, 200, { ok: true, job, queue: printQueue.getSnapshot() });
    }
    if (req.method === 'POST' && queueAction === 'reprint') {
      const job = await controllerMutations.run('library-queue', () => printQueue.reprint(jobId));
      return json(res, 201, { job, queue: printQueue.getSnapshot() });
    }
    if (req.method === 'POST' && queueAction === 'recheck') {
      const job = await controllerMutations.run('library-queue', () => printQueue.recheck(jobId));
      return json(res, 200, { job, queue: printQueue.getSnapshot() });
    }
    if (req.method === 'POST' && queueAction === 'priority') {
      const body = await readJson(req);
      const job = await controllerMutations.run('library-queue', () => printQueue.setPriority(jobId, body.priority));
      return json(res, 200, { job, queue: printQueue.getSnapshot() });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/distribute') {
    let printerIds;
    try {
      printerIds = JSON.parse(String(req.headers['x-printer-ids'] || '[]'));
    } catch {
      throw new Error('Invalid printer selection');
    }
    if (!Array.isArray(printerIds) || !printerIds.length) throw new Error('Select at least one printer');

    const startPrint = String(req.headers['x-start-print'] || 'false').toLowerCase() === 'true';
    const levelingBeforePrint = String(req.headers['x-level-before-print'] || 'true').toLowerCase() !== 'false';
    const flowCalibrationBeforePrint = String(req.headers['x-flow-calibration-before-print'] || 'false').toLowerCase() === 'true';
    const staged = await stageUploadRequest(req, req.headers['x-file-name']);
    try {
      const result = await fileDistribution.distribute({
        printerIds,
        filePath: staged.filePath,
        fileName: staged.fileName,
        startPrint,
        levelingBeforePrint,
        flowCalibrationBeforePrint
      });
      for (const item of result.results) {
        if (item.started) refreshAfterCommand(item.id);
      }
      return json(res, 200, { ...result, fileSize: staged.size });
    } finally {
      await staged.cleanup().catch(() => {});
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/batch') {
    const request = await readJson(req);
    const result = await batchControl.execute(request);
    for (const item of result.results) {
      if (item.ok) {
        refreshAfterCommand(item.id);
        if (String(request.action || '').toLowerCase() === 'cancel') {
          await controllerMutations.run('library-queue', () => printQueue.noteExternalCancel(item.id));
        }
      }
    }
    return json(res, 200, result);
  }

  if (req.method === 'PUT' && url.pathname === '/api/printers/order') {
    const body = await readJson(req);
    const printers = await controllerMutations.run('printer-registry', async () => {
      const updated = await reorderPrinters(body.printerIds);
      await fleetState.syncRegistry();
      return updated;
    });
    return json(res, 200, { printers: printers.map(publicPrinter) });
  }

  if (req.method === 'POST' && url.pathname === '/api/printers') {
    const input = validateAddPrinter(await readJson(req));
    const result = await controllerMutations.run('printer-registry', async () => {
      const simulatedCandidate = emulatorManager.isSimulatedConfig(input);
      if (!simulatedCandidate) {
        const configured = await listPrinters();
        const physicalCount = configured.filter((printer) => !isControllerSimulator(printer)).length;
        licenseManager.requirePrinterCapacity(physicalCount);
      }
      const candidate = { ...input, id: 'candidate' };
      // Validate LAN mode + credentials before persisting the printer.
      const status = await getPrinterAdapter(candidate).getStatus();
      const printer = await addPrinter({ ...input, simulated:simulatedCandidate });
      await fleetState.syncRegistry();
      await fleetState.refreshNow(printer.id);
      return { printer, status };
    });
    return json(res, 201, { printer: publicPrinter(result.printer), status:result.status });
  }

  const maintenanceModelTaskMatch = url.pathname.match(/^\/api\/maintenance\/model-tasks(?:\/([^/]+))?(?:\/(complete))?$/);
  if (maintenanceModelTaskMatch) {
    const taskId = maintenanceModelTaskMatch[1] ? decodeURIComponent(maintenanceModelTaskMatch[1]) : null;
    const completeAction = maintenanceModelTaskMatch[2] === 'complete';
    if (req.method === 'POST' && !taskId) {
      const body = await readJson(req);
      const target = validatePrinterModelTarget(body.target);
      const task = await controllerMutations.run('maintenance', () => maintenanceService.addModelTask(target, body));
      fleetState.schedulePublish();
      return json(res, 201, { task });
    }
    if (req.method === 'PATCH' && taskId && !completeAction) {
      const body = await readJson(req);
      const target = body.target === undefined ? undefined : validatePrinterModelTarget(body.target);
      const task = await controllerMutations.run('maintenance', () => maintenanceService.updateModelTask(taskId, body, target));
      fleetState.schedulePublish();
      return json(res, 200, { task });
    }
    if (req.method === 'POST' && taskId && completeAction) {
      const body = await readJson(req);
      const result = await controllerMutations.run('maintenance', () => maintenanceService.completeModelTask(taskId, body.notes));
      await diagnosticLogger.info('maintenance', 'Model-wide maintenance task completed', {
        taskId,
        taskName:result.task?.name || null,
        matching:result.summary?.matching || 0,
        completed:result.summary?.completed || 0,
        skipped:result.summary?.skipped || 0
      });
      fleetState.schedulePublish();
      return json(res, 200, result);
    }
    if (req.method === 'DELETE' && taskId && !completeAction) {
      await controllerMutations.run('maintenance', () => maintenanceService.deleteModelTask(taskId));
      fleetState.schedulePublish();
      return json(res, 200, { ok:true });
    }
    return json(res, 405, { error:'Model maintenance task operation is not supported' });
  }

  const maintenanceHistoryMatch = url.pathname.match(/^\/api\/printers\/([^/]+)\/maintenance\/history$/);
  if (maintenanceHistoryMatch) {
    const printerId = decodeURIComponent(maintenanceHistoryMatch[1]);
    if (!await getPrinter(printerId)) return json(res, 404, { error:'Printer not found' });
    if (req.method === 'DELETE') {
      const result = await controllerMutations.run('maintenance', () => maintenanceService.clearHistory(printerId));
      await diagnosticLogger.info('maintenance', 'Maintenance history cleared', {
        printerId,
        cleared:result.cleared
      });
      fleetState.schedulePublish();
      return json(res, 200, { ok:true, ...result });
    }
    return json(res, 405, { error:'Maintenance history operation is not supported' });
  }

  const maintenanceGroupTaskMatch = url.pathname.match(/^\/api\/maintenance\/group-tasks(?:\/([^/]+))?(?:\/(complete))?$/);
  if (maintenanceGroupTaskMatch) {
    const taskId = maintenanceGroupTaskMatch[1] ? decodeURIComponent(maintenanceGroupTaskMatch[1]) : null;
    const completeAction = maintenanceGroupTaskMatch[2] === 'complete';
    if (req.method === 'POST' && !taskId) {
      const body = await readJson(req);
      const target = validatePrinterGroupTarget(body.target);
      const task = await controllerMutations.run('maintenance', () => maintenanceService.addGroupTask(target, body));
      fleetState.schedulePublish();
      return json(res, 201, { task });
    }
    if (req.method === 'PATCH' && taskId && !completeAction) {
      const body = await readJson(req);
      const target = body.target === undefined ? undefined : validatePrinterGroupTarget(body.target);
      const task = await controllerMutations.run('maintenance', () => maintenanceService.updateGroupTask(taskId, body, target));
      fleetState.schedulePublish();
      return json(res, 200, { task });
    }
    if (req.method === 'POST' && taskId && completeAction) {
      const body = await readJson(req);
      const result = await controllerMutations.run('maintenance', () => maintenanceService.completeGroupTask(taskId, body.notes));
      await diagnosticLogger.info('maintenance', 'Group-wide maintenance task completed', {
        taskId,
        taskName:result.task?.name || null,
        groupId:result.task?.assignment?.groupId || null,
        matching:result.summary?.matching || 0,
        completed:result.summary?.completed || 0,
        skipped:result.summary?.skipped || 0
      });
      fleetState.schedulePublish();
      return json(res, 200, result);
    }
    if (req.method === 'DELETE' && taskId && !completeAction) {
      await controllerMutations.run('maintenance', () => maintenanceService.deleteGroupTask(taskId));
      fleetState.schedulePublish();
      return json(res, 200, { ok:true });
    }
    return json(res, 405, { error:'Group maintenance task operation is not supported' });
  }

    const maintenanceTaskMatch = url.pathname.match(/^\/api\/printers\/([^/]+)\/maintenance\/tasks(?:\/([^/]+))?(?:\/(complete))?$/);
  if (maintenanceTaskMatch) {
    const printerId = decodeURIComponent(maintenanceTaskMatch[1]);
    const taskId = maintenanceTaskMatch[2] ? decodeURIComponent(maintenanceTaskMatch[2]) : null;
    const completeAction = maintenanceTaskMatch[3] === 'complete';
    if (!await getPrinter(printerId)) return json(res, 404, { error:'Printer not found' });

    if (req.method === 'POST' && !taskId) {
      const body = await readJson(req);
      const task = await controllerMutations.run('maintenance', () => maintenanceService.addTask(printerId, body));
      fleetState.schedulePublish();
      return json(res, 201, { task });
    }
    if (req.method === 'PATCH' && taskId && !completeAction) {
      const body = await readJson(req);
      const task = await controllerMutations.run('maintenance', () => maintenanceService.updateTask(printerId, taskId, body));
      fleetState.schedulePublish();
      return json(res, 200, { task });
    }
    if (req.method === 'DELETE' && taskId && !completeAction) {
      await controllerMutations.run('maintenance', () => maintenanceService.deleteTask(printerId, taskId));
      fleetState.schedulePublish();
      return json(res, 200, { ok:true });
    }
    if (req.method === 'POST' && taskId && completeAction) {
      const body = await readJson(req);
      const result = await controllerMutations.run('maintenance', () => maintenanceService.completeTask(printerId, taskId, body.notes));
      await diagnosticLogger.info('maintenance', 'Maintenance task completed', {
        printerId,
        taskId,
        taskName:result.task?.name || null
      });
      fleetState.schedulePublish();
      return json(res, 200, result);
    }
    return json(res, 405, { error:'Maintenance task operation is not supported' });
  }

  const match = url.pathname.match(/^\/api\/printers\/([^/]+)(?:\/(.+))?$/);
  if (!match) return false;
  const [, id, action] = match;
  const printer = await getPrinter(id);
  if (!printer) return json(res, 404, { error: 'Printer not found' });
  if (req.method === 'PUT' && action === 'license-slot') {
    const body = await readJson(req);
    if (typeof body.active !== 'boolean') throw new Error('active must be true or false');
    if (isControllerSimulator(printer)) {
      return json(res, 200, { ok:true, printer:{ ...publicPrinter(printer), simulated:true, licenseActive:true }, license:currentLicenseSnapshot() });
    }

    const result = await controllerMutations.run('printer-registry', () => printerOperations.run(id, 'licence slot change', async () => {
      const configured = (await listPrinters()).map(publicPrinter);
      const access = licenseManager.resolvePrinterAccess(configured, {
        isSimulated:isControllerSimulator
      });
      const current = access.printers.find((item) => item.id === id);
      if (body.active === true && current?.licenseActive !== true && access.maxPrinters != null && access.activePhysicalPrinters >= access.maxPrinters) {
        throw new Error(`All ${access.maxPrinters} licence slots are already in use. Release a slot from another printer first.`);
      }

      if (body.active === false && chamberPreheat.isActive(id)) {
        await chamberPreheat.stop(id, { reason:'licence-slot-released', turnOff:true });
      }
      const updated = await setPrinterLicenseSlotActive(id, body.active);
      await fleetState.syncRegistry();
      return updated;
    }, { operationType:PRINTER_OPERATION_TYPES.LICENSE_SLOT }));
    return json(res, 200, {
      ok:true,
      printer:resolveLicensedFleet().printers.find((item) => item.id === id) || publicPrinter(result),
      license:currentLicenseSnapshot()
    });
  }

  const licenseAccess = resolveLicensedFleet().printers.find((item) => item.id === id);
  const inactiveAllowed = req.method === 'GET'
    || (req.method === 'DELETE' && !action)
    || (req.method === 'PUT' && action === 'name')
    || (req.method === 'POST' && action === 'camera')
    || (req.method === 'POST' && action === 'job')
    || (req.method === 'DELETE' && action === 'chamber-preheat')
    || ['material-designation', 'nozzle-designation'].includes(action);
  if (licenseAccess?.licenseActive === false && !inactiveAllowed) {
    throw new Error('Printer is inactive because it does not currently have a licence slot. Select it for a licence slot before sending new control commands.');
  }

  if (req.method === 'DELETE' && !action) {
    await controllerMutations.run('printer-registry', () => printerOperations.run(id, 'printer removal', async () => {
      if (chamberPreheat.isActive(id)) await chamberPreheat.stop(id, { reason: 'printer-removed', turnOff: true });
      await removePrinter(id);
      await printerGroups.removePrinter(id).catch(() => {});
      await removePrinterFileMaterialMetadata(id).catch(() => {});
      printerActivities.clear(id);
      cameraManager.remove(id);
      await fleetState.syncRegistry();
    }, { operationType:PRINTER_OPERATION_TYPES.PRINTER_REMOVAL }));
    return json(res, 200, { ok: true });
  }

  if (req.method === 'PUT' && action === 'name') {
    const body = await readJson(req);
    const updated = await controllerMutations.run('printer-registry', async () => {
      const value = await renamePrinter(id, body.name);
      if (!value) throw new Error('Printer not found');
      await fleetState.syncRegistry();
      return value;
    });
    return json(res, 200, { ok: true, printer: publicPrinter(updated) });
  }

  const adapter = getPrinterAdapter(printer);

  if (req.method === 'GET' && action === 'status') {
    return json(res, 200, { status: await adapter.getStatus(), capabilities: adapter.capabilities, limits: adapter.limits });
  }

  if (req.method === 'POST' && action === 'filament-color') {
    if (!adapter.capabilities?.filamentColorControl) throw new Error('Filament colour control is not supported by this printer');
    const body = await readJson(req);
    const result = await runPrinterMutation(id, 'filament colour change', (_currentPrinter, currentAdapter) => currentAdapter.setFilamentColor({ toolIndex:body.toolIndex, color:body.color }), { operationType:PRINTER_OPERATION_TYPES.FILAMENT_CONFIG });
    refreshAfterCommand(id);
    return json(res, 200, { ok:true, ...result });
  }

  if (req.method === 'POST' && action === 'filament-type') {
    if (!adapter.capabilities?.filamentTypeControl) throw new Error('Filament type control is not supported by this printer');
    const body = await readJson(req);
    const result = await runPrinterMutation(id, 'filament type change', (_currentPrinter, currentAdapter) => currentAdapter.setFilamentType({ toolIndex:body.toolIndex, material:body.material }), { operationType:PRINTER_OPERATION_TYPES.FILAMENT_CONFIG });
    refreshAfterCommand(id);
    return json(res, 200, { ok:true, ...result });
  }

  if (req.method === 'POST' && action === 'filament-config') {
    if (!adapter.capabilities?.filamentTypeControl || !adapter.capabilities?.filamentColorControl) {
      throw new Error('Combined filament control is not supported by this printer');
    }
    const body = await readJson(req);
    const result = await runPrinterMutation(id, 'filament configuration change', (_currentPrinter, currentAdapter) => currentAdapter.setFilamentConfig({ toolIndex:body.toolIndex, material:body.material, color:body.color }), { operationType:PRINTER_OPERATION_TYPES.FILAMENT_CONFIG });
    refreshAfterCommand(id);
    return json(res, 200, { ok:true, ...result });
  }

  if (action === 'material-designation' && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!adapter.capabilities?.materialDesignation) throw new Error('Manual material designation is not supported by this printer');
    const body = req.method === 'POST' ? await readJson(req) : {};
    const updated = await controllerMutations.run('printer-registry', () => runPrinterMutation(id, 'material designation change', async () => {
      const value = await setPrinterMaterialDesignation(
        id,
        req.method === 'POST' ? body.material : null,
        req.method === 'POST' ? body.color : null,
        req.method === 'POST' ? body.colorFamily : null
      );
      if (!value) throw new Error('Printer not found');
      await fleetState.syncRegistry();
      return value;
    }, { allowInactive:true, operationType:PRINTER_OPERATION_TYPES.MATERIAL_DESIGNATION }));
    fleetState.refreshNow(id).catch(() => {});
    return json(res, 200, {
      ok: true,
      printer: publicPrinter(updated),
      materialDesignation: updated.adapterConfig?.filamentDesignation || null,
      materialColorDesignation: updated.adapterConfig?.filamentColorDesignation || null,
      materialColorFamilyDesignation: publicPrinter(updated).materialColorFamilyDesignation
    });
  }

  if (action === 'nozzle-designation' && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!adapter.capabilities?.nozzleDesignation) throw new Error('Manual nozzle designation is not supported by this printer');
    const body = req.method === 'POST' ? await readJson(req) : {};
    const updated = await controllerMutations.run('printer-registry', () => runPrinterMutation(id, 'nozzle designation change', async () => {
      const value = await setPrinterNozzleDesignation(id, req.method === 'POST' ? body.nozzleDiameter : null);
      if (!value) throw new Error('Printer not found');
      await fleetState.syncRegistry();
      return value;
    }, { allowInactive:true, operationType:PRINTER_OPERATION_TYPES.NOZZLE_DESIGNATION }));
    fleetState.refreshNow(id).catch(() => {});
    return json(res, 200, {
      ok: true,
      printer: publicPrinter(updated),
      nozzleDiameterDesignation: Number.isFinite(Number(updated.adapterConfig?.nozzleDiameterDesignation))
        ? Number(updated.adapterConfig.nozzleDiameterDesignation)
        : null
    });
  }

  if (req.method === 'GET' && action === 'files') {
    if (!adapter.capabilities?.localFiles) throw new Error('File listing is not supported by this printer');
    return json(res, 200, await adapter.getFiles());
  }

  if (req.method === 'POST' && action === 'files') {
    if (!adapter.capabilities?.fileUpload) throw new Error('File upload is not supported by this printer');
    if (!adapter.capabilities?.localFiles) throw new Error('Printer storage verification is not supported by this printer');
    const staged = await stageUploadRequest(req, req.headers['x-file-name']);
    try {
      const result = await fileDistribution.distribute({
        printerIds:[id],
        filePath:staged.filePath,
        fileName:staged.fileName,
        startPrint:false
      });
      const item = result.results?.[0];
      if (!item?.ok) throw new Error(item?.error || 'Printer file upload failed');
      return json(res, 201, {
        ok:true,
        fileName:staged.fileName,
        fileSize:staged.size,
        verified:item.verified === true,
        verificationSource:item.verificationSource || null
      });
    } finally {
      await staged.cleanup().catch(() => {});
    }
  }

  if (req.method === 'GET' && action === 'file-material') {
    const fileName = String(url.searchParams.get('fileName') || '').trim();
    if (!fileName) throw new Error('fileName is required');
    const metadata = await getPrinterFileMaterialMetadata(id, fileName);
    const designation = String(printer.adapterConfig?.filamentDesignation || '').trim() || null;
    const compatibility = assessMaterialCompatibility(designation, metadata);
    return json(res, 200, { ...metadata, designatedMaterial: designation, ...compatibility });
  }

  if (req.method === 'GET' && action === 'print-setup') {
    if (!adapter.capabilities?.printToolMapping && !adapter.capabilities?.materialSlotMapping) throw new Error('Print material mapping is not supported by this printer');
    const fileName = String(url.searchParams.get('fileName') || '').trim();
    if (!fileName) throw new Error('fileName is required');
    return json(res, 200, await adapter.getPrintSetup(fileName));
  }

  if (req.method === 'GET' && action === 'camera/stream') {
    await cameraManager.handleStream(id, req, res);
    return true;
  }

  if (req.method === 'GET' && action === 'camera/status') {
    return json(res, 200, { health: cameraManager.getHealth(id) });
  }

  if (req.method === 'GET' && action === 'camera/snapshot') {
    await cameraManager.handleSnapshot(id, res);
    return true;
  }

  if (req.method === 'POST' && action === 'print') {
    const body = await readJson(req);
    if (!body.fileName) throw new Error('fileName is required');
    if (!adapter.capabilities?.printLocalFile) throw new Error('Printing local files is not supported by this printer');
    await runPrinterMutation(id, 'print start', async (currentPrinter, currentAdapter) => {
      const fileMaterial = await getPrinterFileMaterialMetadata(id, String(body.fileName));
      const materialCheck = assessMaterialCompatibility(currentPrinter.adapterConfig?.filamentDesignation, fileMaterial);
      if (materialCheck.mismatch && body.allowMaterialMismatch !== true) {
        throw new Error(`Material mismatch: file requires ${materialCheck.requiredMaterial}, but this printer is manually designated ${materialCheck.designatedMaterial}. Confirm Print anyway to override this warning.`);
      }
      if (chamberPreheat.isActive(id)) await chamberPreheat.stop(id, { reason: 'print-started', turnOff: false });
      await currentAdapter.printLocalFile(String(body.fileName), {
        levelingBeforePrint: body.levelingBeforePrint !== false,
        flowCalibrationBeforePrint: body.flowCalibrationBeforePrint === true,
        timeLapseBeforePrint: typeof body.timeLapseBeforePrint === 'boolean' ? body.timeLapseBeforePrint : undefined,
        autoReplenishFilament: typeof body.autoReplenishFilament === 'boolean' ? body.autoReplenishFilament : undefined,
        filamentEntangleDetect: typeof body.filamentEntangleDetect === 'boolean' ? body.filamentEntangleDetect : undefined,
        filamentEntangleSensitivity: body.filamentEntangleSensitivity ?? undefined,
        toolMap: body.toolMap ?? null,
        materialMap: body.materialMap ?? null,
        usedLogicalTools: Array.isArray(body.usedLogicalTools) ? body.usedLogicalTools : []
      });
    }, { operationType:PRINTER_OPERATION_TYPES.PRINT_START });
    refreshAfterCommand(id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && action === 'job') {
    const body = await readJson(req);
    if (!adapter.capabilities?.jobControl) throw new Error('Job control is not supported by this printer');
    const normalizedJobAction = String(body.action || '').toLowerCase();
    const jobOperationType = normalizedJobAction === 'pause'
      ? PRINTER_OPERATION_TYPES.PRINT_PAUSE
      : normalizedJobAction === 'resume'
        ? PRINTER_OPERATION_TYPES.PRINT_RESUME
        : normalizedJobAction === 'cancel'
          ? PRINTER_OPERATION_TYPES.PRINT_CANCEL
          : null;
    await runPrinterMutation(
      id,
      `job ${normalizedJobAction || 'control'}`,
      (_currentPrinter, currentAdapter) => currentAdapter.setJobState(body.action),
      { allowInactive:true, operationType:jobOperationType }
    );
    if (String(body.action || '').toLowerCase() === 'cancel') {
      await controllerMutations.run('library-queue', () => printQueue.noteExternalCancel(id));
    }
    refreshAfterCommand(id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && action === 'temperature') {
    const body = await readJson(req);
    if (body.nozzle !== undefined) {
      if (!adapter.capabilities?.nozzleTemperature) throw new Error('Nozzle temperature control is not supported by this printer');
      const max = Number(adapter.limits?.nozzleTemperature?.max ?? 265);
      if (body.nozzle < 0 || body.nozzle > max) throw new Error(`Nozzle must be 0-${max} C`);
      if (body.toolIndex !== undefined) {
        if (!adapter.capabilities?.toolTemperatures) throw new Error('Per-tool temperature control is not supported by this printer');
        const toolCount = Number(adapter.limits?.toolCount ?? 1);
        if (!Number.isInteger(Number(body.toolIndex)) || Number(body.toolIndex) < 0 || Number(body.toolIndex) >= toolCount) {
          throw new Error(`Tool index must be 0-${Math.max(0, toolCount - 1)}`);
        }
      }
    }
    if (body.bed !== undefined) {
      if (!adapter.capabilities?.bedTemperature) throw new Error('Bed temperature control is not supported by this printer');
      const max = Number(adapter.limits?.bedTemperature?.max ?? 110);
      if (body.bed < 0 || body.bed > max) throw new Error(`Bed must be 0-${max} C`);
    }
    await runPrinterMutation(id, 'temperature change', async (_currentPrinter, currentAdapter) => {
      // A manual bed command is an explicit override of chamber preheat.
      if (body.bed !== undefined && chamberPreheat.isActive(id)) await chamberPreheat.stop(id, { reason: 'manual-bed-override', turnOff: false });
      await currentAdapter.setTemperatures(body);
    }, { operationType:PRINTER_OPERATION_TYPES.TEMPERATURE });
    refreshAfterCommand(id);
    return json(res, 200, { ok: true });
  }


  if (req.method === 'GET' && action === 'chamber-preheat') {
    return json(res, 200, { chamberPreheat: chamberPreheat.get(id) });
  }

  if (req.method === 'POST' && action === 'chamber-preheat') {
    const body = await readJson(req);
    const session = await runPrinterMutation(id, 'chamber preheat start', () => chamberPreheat.start(id, {
      bedTemperature: body.bedTemperature,
      durationMinutes: body.durationMinutes
    }), { operationType:PRINTER_OPERATION_TYPES.CHAMBER_PREHEAT_START });
    refreshAfterCommand(id);
    return json(res, 200, { ok: true, chamberPreheat: session });
  }

  if (req.method === 'DELETE' && action === 'chamber-preheat') {
    const result = await runPrinterMutation(
      id,
      'chamber preheat stop',
      () => chamberPreheat.stop(id, { reason: 'manual', turnOff: true }),
      { allowInactive:true, operationType:PRINTER_OPERATION_TYPES.CHAMBER_PREHEAT_STOP }
    );
    refreshAfterCommand(id);
    return json(res, 200, { ok: true, ...result });
  }

  if (req.method === 'POST' && action === 'fans') {
    const body = await readJson(req);
    for (const key of ['coolingFan', 'chamberFan']) {
      if (body[key] !== undefined && (body[key] < 0 || body[key] > 100)) throw new Error(`${key} must be 0-100%`);
    }
    if (body.coolingFan !== undefined && !adapter.capabilities?.coolingFan) throw new Error('Cooling fan control is not supported by this printer');
    if (body.chamberFan !== undefined && !adapter.capabilities?.chamberFan) throw new Error('Chamber fan control is not supported by this printer');
    await runPrinterMutation(id, 'fan change', (_currentPrinter, currentAdapter) => currentAdapter.setFans(body), { operationType:PRINTER_OPERATION_TYPES.FAN });
    refreshAfterCommand(id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && action === 'filtration') {
    if (!adapter.capabilities?.filtration) throw new Error('Filtration control is not supported by this printer');
    const body = await readJson(req);
    if (adapter.limits?.filtrationSpeed) {
      const min = Number(adapter.limits.filtrationSpeed.min ?? 0);
      const max = Number(adapter.limits.filtrationSpeed.max ?? 100);
      for (const key of ['internal', 'external']) {
        if (body[key] === undefined) continue;
        const value = Number(body[key]);
        if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${key} filtration must be ${min}-${max}%`);
        body[key] = value;
      }
    }
    await runPrinterMutation(id, 'filtration change', (_currentPrinter, currentAdapter) => currentAdapter.setFiltration(body), { operationType:PRINTER_OPERATION_TYPES.FILTRATION });
    refreshAfterCommand(id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && action === 'level') {
    if (!adapter.capabilities?.bedLeveling) throw new Error('Bed levelling is not supported by this printer');
    await runPrinterMutation(id, 'bed levelling', async (currentPrinter, currentAdapter) => {
      // Moonraker's U1 levelling request stays open for the stock homing/heating/
      // soak/probing workflow. Keep that controller-owned activity sticky so
      // transient idle-looking polls cannot erase it while the macro is still
      // running. This also means a printer-detail dialog that is closed and
      // reopened can reconstruct the live banner from the fleet state.
      const stickyUntilRequestCompletes = currentPrinter.adapterType === 'snapmaker-u1';
      printerActivities.start(id, 'bed-leveling', 'bed levelling', {
        sticky:stickyUntilRequestCompletes,
        maxDurationMs:20 * 60_000
      });
      fleetState.schedulePublish();
      try {
        await currentAdapter.levelBed();
      } catch (error) {
        printerActivities.clear(id);
        u1BedLevelProgress.delete(String(id));
        fleetState.schedulePublish();
        throw error;
      } finally {
        if (stickyUntilRequestCompletes) {
          printerActivities.clear(id);
          u1BedLevelProgress.delete(String(id));
          fleetState.schedulePublish();
        }
      }
      fleetState.refreshNow(id).catch(() => {});
    }, { operationType:PRINTER_OPERATION_TYPES.BED_LEVEL });
    refreshAfterCommand(id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && action === 'tool-offset-calibration') {
    if (!adapter.capabilities?.toolheadOffsetCalibration) throw new Error('Toolhead offset calibration is not supported by this printer');
    const body = await readJson(req);
    if (toolOffsetCalibrationLocks.has(id)) {
      throw new Error('A U1 XYZ toolhead calibration action is already running for this printer');
    }
    toolOffsetCalibrationLocks.set(id, { action: String(body.action || ''), startedAt: Date.now() });
    try {
      const calibrationAction = String(body.action || '').toLowerCase();
      const calibrationOperationType = calibrationAction === 'start'
        ? PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_START
        : calibrationAction === 'exit'
          ? PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_EXIT
          : PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_STEP;
      await runPrinterMutation(id, 'tool offset calibration', async (_currentPrinter, currentAdapter) => {
        if (calibrationAction === 'start' && chamberPreheat.isActive(id)) {
          await chamberPreheat.stop(id, { reason: 'tool-offset-calibration', turnOff: true });
        }
        await currentAdapter.calibrateToolOffsets({ action:body.action, toolIndex:body.toolIndex });
        if (calibrationAction === 'start') {
          printerActivities.start(id, 'calibration', 'tool calibration', { sticky:true, maxDurationMs:2 * 60 * 60_000 });
        } else if (calibrationAction === 'exit') {
          printerActivities.clear(id);
        }
        fleetState.refreshNow(id).catch(() => {});
      }, { operationType:calibrationOperationType });
      refreshAfterCommand(id);
      return json(res, 200, { ok: true });
    } finally {
      toolOffsetCalibrationLocks.delete(id);
    }
  }

  if (req.method === 'POST' && action === 'camera') {
    if (!adapter.capabilities?.camera) throw new Error('Camera is not supported by this printer');
    await runPrinterMutation(id, 'camera restart', (_currentPrinter, currentAdapter) => currentAdapter.activateCamera(), { allowInactive:true, operationType:PRINTER_OPERATION_TYPES.CAMERA });
    return json(res, 200, { cameraUrl: `/api/printers/${encodeURIComponent(id)}/camera/stream` });
  }

  return false;
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : String(pathname || '').replace(/^\/+/, '');
  const normalized = path.posix.normalize(requested.replaceAll('\\', '/'));
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return false;
  const filePath = PUBLIC_DIR ? path.join(PUBLIC_DIR, ...normalized.split('/')) : null;
  try {
    const data = await readRuntimeAsset({
      key:publicAssetKey(normalized),
      filePath
    });
    res.writeHead(200, {
      'content-type': contentTypes[path.extname(normalized)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const countedMutation = url.pathname.startsWith('/api/')
    && ['POST','PUT','PATCH','DELETE'].includes(req.method);
  if (countedMutation) activeMutationRequests += 1;
  try {
    if (url.pathname.startsWith('/api/emulator')) {
      if ((restorePendingRestart || restoreInspectionInProgress) && ['POST','PUT','PATCH','DELETE'].includes(req.method)) {
        return json(res, 409, {
          error:restorePendingRestart
            ? 'A restore is staged and waiting for controller restart. Restart or cancel the staged restore before changing simulator state.'
            : 'A restore backup operation is in progress. Try this change again after it finishes.'
        });
      }
      await emulatorManager.handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const handled = await apiRoute(req, res, url);
      if (handled !== false) return;
      return json(res, 404, { error: 'API route not found' });
    }

    if (url.pathname === '/simulator') {
      res.writeHead(302, { location: '/simulator/' });
      res.end();
      return;
    }
    if (url.pathname.startsWith('/simulator/')) {
      await emulatorManager.serveStatic(res, url);
      return;
    }

    if (await serveStatic(res, url.pathname)) return;
    if (await serveStatic(res, '/index.html')) return;
    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    await diagnosticLogger.error('http', 'Request failed', {
      method:req.method,
      pathname:url.pathname,
      statusCode:error?.statusCode || null,
      error:error?.message || String(error),
      stack:error?.stack || null
    });
    console.error(`[${new Date().toISOString()}]`, error.message);
    const status = Number.isInteger(Number(error?.statusCode)) ? Number(error.statusCode) : 400;
    if (!res.headersSent) json(res, status, { error: error.message || 'Request failed' });
    else res.end();
  } finally {
    if (countedMutation) activeMutationRequests = Math.max(0, activeMutationRequests - 1);
  }
});

async function shutdown() {
  await diagnosticLogger.info('controller', 'Controller shutdown requested').catch(() => {});
  try { await chamberPreheat.stopAll({ reason: 'controller-shutdown', turnOff: true }); } catch {}
  chamberPreheat.stopService();
  scheduledBackupService.stop();
  await maintenanceService.stop().catch(() => {});
  printQueue.stop();
  fleetState.stop();
  cameraManager.stop();
  try { await emulatorManager.stop(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function listenControllerServer() {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(PORT, HOST);
  });
}

async function startController() {
  let restoreTransaction = null;
  try {
    const restoreStartup = await activatePendingRestore({
      dataDir:runtimePaths.dataDir,
      licensePath:runtimePaths.licensePath
    });
    if (restoreStartup?.activated) {
      restoreTransaction = restoreStartup;
      console.log(`Activating staged restore ${restoreStartup.fileName || restoreStartup.backupId || ''}`.trim());
    } else if (restoreStartup?.rolledBack) {
      console.warn(`Rolled back an incomplete restore startup: ${restoreStartup.reason}`);
    }

    try {
      await diagnosticLogger.init();
      diagnosticLogger.patchConsole();
      console.log(`Diagnostic logging enabled (${runtimePaths.customLogDir ? 'LOG_DIR override' : 'application-local logs directory'})`);
    } catch (error) {
      console.warn(`Diagnostic file logging unavailable: ${error.message}`);
    }
    try {
      await manualBackupManager.init();
    } catch (error) {
      await diagnosticLogger.warn('backup', 'Backup staging is unavailable at startup', {
        error:error?.message || String(error)
      }).catch(() => {});
      console.warn(`Backup staging unavailable: ${error.message}`);
    }
    licenseManager = await loadLicenseManager({
      appDir:APP_DIR,
      dataDir:controllerDataDir,
      preferredLicenseFile:runtimePaths.licensePath
    });

    try {
      const emulatorStatus = await emulatorManager.init();
      if (emulatorStatus.running) console.log(`Integrated printer simulator enabled with ${emulatorStatus.printerCount} loopback endpoints`);
    } catch (error) {
      console.error(`Could not start integrated printer simulator: ${error.message}`);
    }

    await printerGroups.init();
    await fleetState.start();
    await maintenanceService.start();
    await printQueue.start();
    chamberPreheat.startService();
    await listenControllerServer();

    if (restoreTransaction) {
      const committedRestore = await commitActivatedRestore(restoreTransaction);
      await diagnosticLogger.info('restore', 'Staged restore activated successfully', {
        backupId:restoreTransaction.backupId || null,
        fileName:restoreTransaction.fileName || null,
        rollbackRetainUntil:committedRestore?.rollbackRetainUntil || null
      }).catch(() => {});
      restoreTransaction = null;
    }

    try {
      await scheduledBackupService.start();
    } catch (error) {
      await diagnosticLogger.warn('backup', 'Scheduled backup service could not start', {
        error:error?.message || String(error)
      }).catch(() => {});
      console.warn(`Scheduled backup service unavailable: ${error.message}`);
    }

    console.log(`Print Farm Controller v${CONTROLLER_VERSION} running at http://localhost:${PORT}`);
    const license = currentLicenseSnapshot();
    console.log(`Licence: ${license.label} (${license.source}; enforcement ${license.enforcementEnabled ? 'enabled' : 'disabled'})`);
    console.log(`LAN access: http://<this-computer-ip>:${PORT}`);
    console.log('Generic printer adapter + capability layer enabled (FlashForge AD5M + Snapmaker U1 + experimental Bambu P1P/P1S/X1C/A1 Mini)');
    console.log('Live fleet polling + SSE enabled');
    console.log('Concurrent client command arbitration + serialized shared mutations enabled');
    console.log('Shared backend camera proxy enabled');
    console.log('Bounded chamber preheat control enabled');
    console.log('Batch fleet control enabled');
    console.log('Verified multi-printer file distribution enabled');
    console.log('Persistent fleet print queue + history enabled');
    console.log('Custom printer groups + group-restricted scheduling enabled');
    console.log('Maintenance tracking + controller-observed printer usage enabled');
  } catch (error) {
    chamberPreheat.stopService();
    scheduledBackupService.stop();
    await maintenanceService.stop().catch(() => {});
    printQueue.stop();
    fleetState.stop();
    cameraManager.stop();
    try { await emulatorManager.stop(); } catch {}
    if (restoreTransaction) {
      try {
        await rollbackActivatedRestore(restoreTransaction);
        console.error('Restored controller data failed startup validation and was rolled back automatically.');
      } catch (rollbackError) {
        console.error(`Automatic restore rollback failed: ${rollbackError.message}`);
      }
    }
    throw error;
  }
}

startController().catch((error) => {
  console.error(`Could not start Print Farm Controller: ${error.message}`);
  process.exitCode = 1;
});
