import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectZipArchive, extractZipEntryToFile } from './backup-archive.js';
import { inspectRestoreBackup } from './restore-inspector.js';

const TERMINAL_STATES = new Set(['completed','failed','cancelled']);
const PRINT_MAY_HAVE_STARTED_STATES = new Set(['starting','printing']);
const RESERVED_EXTERNAL_LICENSE = '.pfc-restore-external-license.json';
const RESTORE_CONTROL_DIR = '.restore-control';
const BASE_MANAGED_ENTRIES = Object.freeze([
  'printers.json',
  'print-jobs.json',
  'file-material-metadata.json',
  'backup-settings.json',
  'emulator-settings.json',
  'maintenance.json',
  'print-library',
  // A historical queue-files directory must not survive a restore and then
  // migrate stale content back into the restored Print Library.
  'queue-files'
]);
export const RESTORE_ROLLBACK_RETENTION_MS = 24 * 60 * 60 * 1000;

export function restoreRuntimePaths(dataDir) {
  const resolved = path.resolve(dataDir);
  const controlDir = path.join(resolved, RESTORE_CONTROL_DIR);
  return {
    dataDir:resolved,
    controlDir,
    pendingMarkerPath:path.join(controlDir, 'pending-restore.json')
  };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive:true, mode:0o700 });
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode:0o600 });
    await fs.rename(temp, filePath);
  } finally {
    await fs.rm(temp, { force:true }).catch(() => {});
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function safeRelativePath(value, label = 'restore entry') {
  const relative = String(value || '').replace(/\\/g, '/');
  if (!relative || relative.startsWith('/') || /^[A-Za-z]:\//.test(relative)
    || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Pending restore marker ${label} is invalid`);
  }
  if (relative === RESTORE_CONTROL_DIR || relative.startsWith(`${RESTORE_CONTROL_DIR}/`)) {
    throw new Error(`Pending restore marker ${label} overlaps restore control state`);
  }
  return relative;
}

function licenseInsideData(dataDir, licensePath) {
  const relative = path.relative(path.resolve(dataDir), path.resolve(licensePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return safeRelativePath(relative, 'licence path');
}

function managedEntriesFromMarker(marker) {
  const entries = [...BASE_MANAGED_ENTRIES];
  if (marker.insideLicenseRelative) entries.push(safeRelativePath(marker.insideLicenseRelative, 'licence path'));
  return [...new Set(entries)];
}

function validatePendingMarkerPaths(marker, dataDir, licensePath = null) {
  const paths = restoreRuntimePaths(dataDir);
  if (!marker || marker.format !== 'print-farm-controller-pending-restore' || marker.version !== 2) {
    throw new Error('Pending restore marker is invalid');
  }
  if (path.resolve(marker.dataDir) !== paths.dataDir) {
    throw new Error('Pending restore marker data directory is invalid');
  }
  if (licensePath && path.resolve(marker.licensePath) !== path.resolve(licensePath)) {
    throw new Error('Pending restore marker licence path is invalid');
  }

  const validateControlChild = (value, prefix, label, extension = '') => {
    const resolved = path.resolve(String(value || ''));
    const name = path.basename(resolved);
    if (path.dirname(resolved) !== paths.controlDir
      || !name.startsWith(prefix)
      || (extension && !name.endsWith(extension))) {
      throw new Error(`Pending restore marker ${label} path is invalid`);
    }
    return resolved;
  };

  marker.stageDir = validateControlChild(marker.stageDir, 'stage-', 'stage');
  marker.rollbackDir = validateControlChild(marker.rollbackDir, 'rollback-', 'rollback');
  marker.externalLicenseBackupPath = validateControlChild(
    marker.externalLicenseBackupPath,
    'license-rollback-',
    'licence rollback',
    '.json'
  );

  if (marker.insideLicenseRelative) {
    marker.insideLicenseRelative = safeRelativePath(marker.insideLicenseRelative, 'licence path');
  }
  if (licensePath) {
    const expectedInside = licenseInsideData(dataDir, licensePath);
    if ((marker.insideLicenseRelative || null) !== (expectedInside || null)) {
      throw new Error('Pending restore marker licence placement is invalid');
    }
  }

  managedEntriesFromMarker(marker);
  return marker;
}

function cleanRestoredOptions(options = {}) {
  return {
    ...options,
    toolMap:null,
    materialMap:null,
    usedLogicalTools:[]
  };
}

export function prepareRestoredJobs(jobs, { restoredAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(jobs)) throw new Error('Restored queue/history store is invalid');
  return jobs.map((source) => {
    const job = structuredClone(source || {});
    if (TERMINAL_STATES.has(String(job.status || '').toLowerCase())) return job;

    const originalStatus = String(job.status || 'queued').toLowerCase();
    const automatic = job.assignmentMode === 'automatic';
    const mayHavePrinted = PRINT_MAY_HAVE_STARTED_STATES.has(originalStatus);
    job.status = 'needs_review';
    job.restoreRecoveryHold = true;
    job.restoreOriginalStatus = originalStatus;
    job.restoredAt = restoredAt;
    job.productionPaused = job.productionBatchId ? true : job.productionPaused === true;
    job.compatibility = null;
    job.selectionReason = null;
    job.toolSnapshot = [];
    job.options = cleanRestoredOptions(job.options || {});
    job.startRequestedAt = null;
    job.startedAt = null;
    job.finishedAt = null;
    job.maxProgress = 0;
    job.lastPrinterState = null;

    if (automatic && !mayHavePrinted) {
      job.printerId = null;
      job.printerName = 'Next available compatible printer';
    }
    // If an automatic job may already have printed, retain the physical
    // printer only until that build plate has been acknowledged clear.
    if (job.bedClearanceRequired === true || mayHavePrinted) {
      job.bedClearanceRequired = true;
      job.bedClearedAt = null;
    }
    job.updatedAt = restoredAt;
    job.error = 'Restored — review required. Confirm printer connectivity, material/nozzle state and build-plate clearance, then recheck this job.';
    return job;
  });
}

function restoredBackupSettings(settings = {}) {
  return {
    ...settings,
    enabled:false,
    lastError:settings.enabled === true
      ? 'Scheduled backups were restored disabled. Review the destination and re-enable the schedule explicitly.'
      : settings.lastError || null
  };
}

async function writeStateJson(stageDir, fileName, value) {
  await writeJsonAtomic(path.join(stageDir, fileName), value);
}

async function removeControlDirIfEmpty(controlDir) {
  const remaining = await fs.readdir(controlDir).catch(() => []);
  if (!remaining.length) await fs.rm(controlDir, { recursive:true, force:true }).catch(() => {});
}

async function cleanupCommittedRestore(marker, markerPath) {
  await fs.rm(marker.rollbackDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(marker.externalLicenseBackupPath, { force:true }).catch(() => {});
  await fs.rm(marker.stageDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(markerPath, { force:true }).catch(() => {});
  await removeControlDirIfEmpty(path.dirname(markerPath));
}

export async function stageRestoreBackup(filePath, {
  dataDir,
  licensePath,
  currentControllerVersion,
  originalFileName = null,
  now = new Date()
} = {}) {
  if (!dataDir || !licensePath) throw new Error('Restore staging requires data and licence paths');
  const paths = restoreRuntimePaths(dataDir);
  await fs.mkdir(paths.controlDir, { recursive:true, mode:0o700 });

  if (await pathExists(paths.pendingMarkerPath)) {
    const existing = validatePendingMarkerPaths(await readJson(paths.pendingMarkerPath), dataDir);
    if (existing.phase === 'committed') {
      await cleanupCommittedRestore(existing, paths.pendingMarkerPath);
      await fs.mkdir(paths.controlDir, { recursive:true, mode:0o700 });
    } else {
      const error = new Error('A restore is already staged and waiting for controller restart');
      error.statusCode = 409;
      throw error;
    }
  }

  const inspection = await inspectRestoreBackup(filePath, {
    currentControllerVersion,
    targetDataDir:dataDir,
    originalFileName
  });
  const archive = await inspectZipArchive(filePath);

  const id = crypto.randomUUID();
  const stageDir = path.join(paths.controlDir, `stage-${id}`);
  const rollbackDir = path.join(paths.controlDir, `rollback-${id}`);
  const externalLicenseBackupPath = path.join(paths.controlDir, `license-rollback-${id}.json`);
  const restoredAt = now.toISOString();
  const insideLicenseRelative = licenseInsideData(dataDir, licensePath);

  try {
    await fs.mkdir(stageDir, { recursive:false, mode:0o700 });

    const printers = JSON.parse((await archive.read('state/printers.json')).toString('utf8'));
    const jobs = JSON.parse((await archive.read('state/print-jobs.json')).toString('utf8'));
    const fileMaterials = JSON.parse((await archive.read('state/file-material-metadata.json')).toString('utf8'));
    const backupSettings = JSON.parse((await archive.read('state/backup-settings.json')).toString('utf8'));

    await writeStateJson(stageDir, 'printers.json', printers);
    await writeStateJson(stageDir, 'print-jobs.json', prepareRestoredJobs(jobs, { restoredAt }));
    await writeStateJson(stageDir, 'file-material-metadata.json', fileMaterials);
    await writeStateJson(stageDir, 'backup-settings.json', restoredBackupSettings(backupSettings));
    if (archive.byName.has('state/maintenance.json')) {
      const maintenance = JSON.parse((await archive.read('state/maintenance.json')).toString('utf8'));
      await writeStateJson(stageDir, 'maintenance.json', maintenance);
    } else {
      await writeStateJson(stageDir, 'maintenance.json', { version:1, printers:{} });
    }

    if (archive.byName.has('state/emulator-settings.json')) {
      const emulator = JSON.parse((await archive.read('state/emulator-settings.json')).toString('utf8'));
      await writeStateJson(stageDir, 'emulator-settings.json', emulator);
    }

    for (const entry of archive.entries) {
      if (!entry.name.startsWith('print-library/')) continue;
      const destination = path.join(stageDir, ...entry.name.split('/'));
      await extractZipEntryToFile(filePath, entry, destination);
    }

    let externalLicenseMode = 'inside-data';
    if (insideLicenseRelative) {
      if (archive.byName.has('state/license.json')) {
        await extractZipEntryToFile(
          filePath,
          archive.byName.get('state/license.json'),
          path.join(stageDir, insideLicenseRelative)
        );
      }
    } else {
      externalLicenseMode = archive.byName.has('state/license.json') ? 'restore' : 'remove';
      if (externalLicenseMode === 'restore') {
        await extractZipEntryToFile(
          filePath,
          archive.byName.get('state/license.json'),
          path.join(stageDir, RESERVED_EXTERNAL_LICENSE)
        );
      }
    }

    const stagedPrinters = JSON.parse(await fs.readFile(path.join(stageDir, 'printers.json'), 'utf8'));
    const stagedJobs = JSON.parse(await fs.readFile(path.join(stageDir, 'print-jobs.json'), 'utf8'));
    if (!Array.isArray(stagedPrinters) || !Array.isArray(stagedJobs)) throw new Error('Staged restore state is invalid');
    const unsafe = stagedJobs.some((job) => !TERMINAL_STATES.has(String(job?.status || '').toLowerCase())
      && (job.restoreRecoveryHold !== true || job.status !== 'needs_review'));
    if (unsafe) throw new Error('Staged restore contains unfinished queue work without a recovery hold');

    const marker = {
      format:'print-farm-controller-pending-restore',
      version:2,
      id,
      phase:'staged',
      stagedAt:restoredAt,
      backupId:inspection.backupId,
      backupFileName:inspection.fileName,
      sourceControllerVersion:inspection.sourceControllerVersion,
      targetControllerVersion:String(currentControllerVersion),
      stageDir,
      rollbackDir,
      dataDir:path.resolve(dataDir),
      licensePath:path.resolve(licensePath),
      insideLicenseRelative,
      externalLicenseMode,
      externalLicenseBackupPath,
      originalEntries:null,
      externalLicenseExisted:null
    };
    await writeJsonAtomic(paths.pendingMarkerPath, marker);

    return {
      staged:true,
      restartRequired:true,
      stagedAt:restoredAt,
      backupId:inspection.backupId,
      fileName:inspection.fileName,
      counts:inspection.counts,
      recoveryHeldJobs:inspection.counts.queued,
      productionBatchesPaused:true
    };
  } catch (error) {
    await fs.rm(stageDir, { recursive:true, force:true }).catch(() => {});
    await fs.rm(rollbackDir, { recursive:true, force:true }).catch(() => {});
    await fs.rm(externalLicenseBackupPath, { force:true }).catch(() => {});
    if (!await pathExists(paths.pendingMarkerPath)) await removeControlDirIfEmpty(paths.controlDir);
    throw error;
  }
}

async function backupExternalLicense(marker) {
  if (marker.externalLicenseMode === 'inside-data') return;
  const licensePath = path.resolve(marker.licensePath);
  if (marker.externalLicenseExisted === true) {
    await fs.copyFile(licensePath, marker.externalLicenseBackupPath);
  }
}

async function installExternalLicense(marker) {
  if (marker.externalLicenseMode === 'inside-data') return;
  const licensePath = path.resolve(marker.licensePath);
  if (marker.externalLicenseMode === 'restore') {
    const source = path.join(marker.stageDir, RESERVED_EXTERNAL_LICENSE);
    const temp = `${licensePath}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(licensePath), { recursive:true });
    try {
      await fs.copyFile(source, temp);
      await fs.rename(temp, licensePath);
    } finally {
      await fs.rm(temp, { force:true }).catch(() => {});
      await fs.rm(source, { force:true }).catch(() => {});
    }
  } else if (marker.externalLicenseMode === 'remove') {
    await fs.rm(licensePath, { force:true });
  }
}

async function rollbackExternalLicense(marker, { requireBackup = false } = {}) {
  if (marker.externalLicenseMode === 'inside-data') return;
  const licensePath = path.resolve(marker.licensePath);
  if (marker.externalLicenseExisted === true) {
    if (!await pathExists(marker.externalLicenseBackupPath)) {
      if (requireBackup) throw new Error('Restore rollback licence snapshot is missing');
      return;
    }
    const temp = `${licensePath}.${crypto.randomUUID()}.tmp`;
    await fs.copyFile(marker.externalLicenseBackupPath, temp);
    await fs.rename(temp, licensePath);
  } else if (marker.externalLicenseExisted === false) {
    await fs.rm(licensePath, { force:true }).catch(() => {});
  }
}

async function moveEntry(sourceRoot, destinationRoot, relative) {
  const source = path.join(sourceRoot, ...relative.split('/'));
  if (!await pathExists(source)) return false;
  const destination = path.join(destinationRoot, ...relative.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive:true, mode:0o700 });
  await fs.rename(source, destination);
  return true;
}

async function removeEntry(root, relative) {
  await fs.rm(path.join(root, ...relative.split('/')), { recursive:true, force:true });
}

async function rollbackActivatedMarker(marker, markerPath) {
  const entries = managedEntriesFromMarker(marker);
  const originalEntries = marker.originalEntries && typeof marker.originalEntries === 'object'
    ? marker.originalEntries
    : {};
  const installingOrLater = ['installing','activated'].includes(marker.phase);

  // Once installation may have begun, every originally-present entry must have
  // a rollback copy before any restored live entry is removed.
  if (installingOrLater) {
    for (const relative of entries) {
      if (originalEntries[relative] === true
        && !await pathExists(path.join(marker.rollbackDir, ...relative.split('/')))) {
        throw new Error(`Restore rollback snapshot is missing ${relative}`);
      }
    }
    if (marker.externalLicenseMode !== 'inside-data' && marker.externalLicenseExisted === true
      && !await pathExists(marker.externalLicenseBackupPath)) {
      throw new Error('Restore rollback licence snapshot is missing');
    }
  }

  for (const relative of entries) {
    const rollbackPath = path.join(marker.rollbackDir, ...relative.split('/'));
    if (originalEntries[relative] === true) {
      if (await pathExists(rollbackPath)) {
        await removeEntry(marker.dataDir, relative);
        await moveEntry(marker.rollbackDir, marker.dataDir, relative);
      }
      // During the activating phase a missing rollback copy means this entry
      // had not yet moved, so the original live entry is left untouched.
    } else if (installingOrLater) {
      await removeEntry(marker.dataDir, relative);
    }
  }

  await rollbackExternalLicense(marker, { requireBackup:installingOrLater });
  await fs.rm(marker.externalLicenseBackupPath, { force:true }).catch(() => {});
  await fs.rm(marker.stageDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(marker.rollbackDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(markerPath, { force:true }).catch(() => {});
  await removeControlDirIfEmpty(path.dirname(markerPath));
}

export async function activatePendingRestore({ dataDir, licensePath } = {}) {
  const paths = restoreRuntimePaths(dataDir);
  if (!await pathExists(paths.pendingMarkerPath)) return null;
  const marker = validatePendingMarkerPaths(
    await readJson(paths.pendingMarkerPath),
    dataDir,
    licensePath
  );

  if (marker.phase === 'committed') {
    const retainUntil = new Date(marker.rollbackRetainUntil || 0).getTime();
    if (!Number.isFinite(retainUntil) || retainUntil <= Date.now()) {
      await cleanupCommittedRestore(marker, paths.pendingMarkerPath);
      return {
        rollbackRetentionExpired:true,
        backupId:marker.backupId,
        fileName:marker.backupFileName
      };
    }
    return {
      committed:true,
      rollbackRetained:true,
      rollbackRetainUntil:marker.rollbackRetainUntil,
      backupId:marker.backupId,
      fileName:marker.backupFileName
    };
  }

  if (['activating','installing','activated'].includes(marker.phase)) {
    await rollbackActivatedMarker(marker, paths.pendingMarkerPath);
    return {
      rolledBack:true,
      reason:'Previous restored startup did not complete successfully',
      backupId:marker.backupId,
      fileName:marker.backupFileName
    };
  }
  if (marker.phase !== 'staged') throw new Error(`Unsupported pending restore phase: ${marker.phase}`);
  if (!await pathExists(marker.stageDir)) throw new Error('Pending restore staging directory is missing');

  const entries = managedEntriesFromMarker(marker);
  marker.originalEntries = {};
  for (const relative of entries) {
    marker.originalEntries[relative] = await pathExists(path.join(paths.dataDir, ...relative.split('/')));
  }
  marker.externalLicenseExisted = marker.externalLicenseMode === 'inside-data'
    ? null
    : await pathExists(licensePath);
  marker.phase = 'activating';
  marker.activationStartedAt = new Date().toISOString();
  await writeJsonAtomic(paths.pendingMarkerPath, marker);

  try {
    await fs.rm(marker.rollbackDir, { recursive:true, force:true }).catch(() => {});
    await fs.mkdir(marker.rollbackDir, { recursive:false, mode:0o700 });

    await backupExternalLicense(marker);

    for (const relative of entries) {
      if (marker.originalEntries[relative] === true) {
        await moveEntry(paths.dataDir, marker.rollbackDir, relative);
      }
    }

    marker.phase = 'installing';
    marker.installStartedAt = new Date().toISOString();
    await writeJsonAtomic(paths.pendingMarkerPath, marker);

    for (const relative of entries) {
      await moveEntry(marker.stageDir, paths.dataDir, relative);
    }
    await installExternalLicense(marker);

    marker.phase = 'activated';
    marker.activatedAt = new Date().toISOString();
    await writeJsonAtomic(paths.pendingMarkerPath, marker);
    return {
      activated:true,
      marker,
      markerPath:paths.pendingMarkerPath,
      backupId:marker.backupId,
      fileName:marker.backupFileName
    };
  } catch (error) {
    try {
      await rollbackActivatedMarker(marker, paths.pendingMarkerPath);
    } catch (rollbackError) {
      throw new Error(`Could not activate staged restore: ${error.message}. Automatic rollback also failed: ${rollbackError.message}`);
    }
    throw new Error(`Could not activate staged restore: ${error.message}`);
  }
}

export async function commitActivatedRestore(transaction, {
  now = new Date(),
  retentionMs = RESTORE_ROLLBACK_RETENTION_MS
} = {}) {
  if (!transaction?.activated || !transaction.marker) return false;
  const marker = transaction.marker;
  marker.phase = 'committed';
  marker.committedAt = now.toISOString();
  marker.rollbackRetainUntil = new Date(now.getTime() + Math.max(0, Number(retentionMs) || 0)).toISOString();
  await writeJsonAtomic(transaction.markerPath, marker);
  await fs.rm(marker.stageDir, { recursive:true, force:true }).catch(() => {});
  return {
    committed:true,
    rollbackRetainUntil:marker.rollbackRetainUntil
  };
}

export async function rollbackActivatedRestore(transaction) {
  if (!transaction?.activated || !transaction.marker) return false;
  await rollbackActivatedMarker(transaction.marker, transaction.markerPath);
  return true;
}

export async function cancelStagedRestore(dataDir) {
  const paths = restoreRuntimePaths(dataDir);
  if (!await pathExists(paths.pendingMarkerPath)) return { cancelled:false, pending:false };
  const marker = validatePendingMarkerPaths(await readJson(paths.pendingMarkerPath), dataDir);
  if (marker.phase !== 'staged') {
    const error = new Error('Restore activation has already started and can no longer be cancelled from the running controller');
    error.statusCode = 409;
    throw error;
  }
  await fs.rm(marker.stageDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(marker.rollbackDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(marker.externalLicenseBackupPath, { force:true }).catch(() => {});
  await fs.rm(paths.pendingMarkerPath, { force:true });
  await removeControlDirIfEmpty(paths.controlDir);
  return { cancelled:true, pending:false, backupId:marker.backupId || null, fileName:marker.backupFileName || null };
}

export async function pendingRestoreStatus(dataDir) {
  const paths = restoreRuntimePaths(dataDir);
  if (!await pathExists(paths.pendingMarkerPath)) return { pending:false };
  const marker = validatePendingMarkerPaths(await readJson(paths.pendingMarkerPath), dataDir);
  if (marker.phase === 'committed') {
    return {
      pending:false,
      recentlyRestored:true,
      phase:'committed',
      committedAt:marker.committedAt || null,
      rollbackRetainUntil:marker.rollbackRetainUntil || null,
      backupId:marker.backupId || null,
      fileName:marker.backupFileName || null
    };
  }
  return {
    pending:true,
    phase:marker.phase || 'unknown',
    stagedAt:marker.stagedAt || null,
    activatedAt:marker.activatedAt || null,
    backupId:marker.backupId || null,
    fileName:marker.backupFileName || null
  };
}
