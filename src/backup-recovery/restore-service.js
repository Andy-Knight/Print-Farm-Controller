import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectZipArchive, extractZipEntryToFile } from './backup-archive.js';
import { inspectRestoreBackup } from './restore-inspector.js';

const TERMINAL_STATES = new Set(['completed','failed','cancelled']);
const PRINT_MAY_HAVE_STARTED_STATES = new Set(['starting','printing']);
const RESERVED_EXTERNAL_LICENSE = '.pfc-restore-external-license.json';

function restoreBaseName(dataDir) {
  return path.basename(path.resolve(dataDir)).replace(/[^0-9A-Za-z._-]/g, '_') || 'data';
}

export function restoreRuntimePaths(dataDir) {
  const resolved = path.resolve(dataDir);
  const parent = path.dirname(resolved);
  const base = restoreBaseName(resolved);
  return {
    dataDir:resolved,
    parentDir:parent,
    pendingMarkerPath:path.join(parent, `.pfc-${base}-restore-pending.json`)
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

function licenseInsideData(dataDir, licensePath) {
  const relative = path.relative(path.resolve(dataDir), path.resolve(licensePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
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
    if (automatic) {
      job.printerId = null;
      job.printerName = 'Next available compatible printer';
    }
    if (job.bedClearanceRequired === true || PRINT_MAY_HAVE_STARTED_STATES.has(originalStatus)) {
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

async function extractLibrary(archive, stageDir) {
  for (const entry of archive.entries) {
    if (!entry.name.startsWith('print-library/')) continue;
    const relative = entry.name.split('/');
    const destination = path.join(stageDir, ...relative);
    await extractZipEntryToFile(archive.filePath, entry, destination);
  }
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
  if (await pathExists(paths.pendingMarkerPath)) {
    const error = new Error('A restore is already staged and waiting for controller restart');
    error.statusCode = 409;
    throw error;
  }

  const inspection = await inspectRestoreBackup(filePath, {
    currentControllerVersion,
    targetDataDir:dataDir,
    originalFileName
  });
  const archive = await inspectZipArchive(filePath);
  // Expose the source path only inside this server-side object; it is never
  // copied into the backup or marker.
  archive.filePath = filePath;

  const id = crypto.randomUUID();
  const stageDir = path.join(paths.parentDir, `.pfc-${restoreBaseName(dataDir)}-restore-stage-${id}`);
  const rollbackDir = path.join(paths.parentDir, `.pfc-${restoreBaseName(dataDir)}-restore-rollback-${id}`);
  const externalLicenseBackupPath = path.join(paths.parentDir, `.pfc-${restoreBaseName(dataDir)}-license-rollback-${id}.json`);
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
        const destination = path.join(stageDir, insideLicenseRelative);
        await extractZipEntryToFile(filePath, archive.byName.get('state/license.json'), destination);
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

    // Verify the staged logical relationships after transformation, not just
    // the source archive.
    const stagedPrinters = JSON.parse(await fs.readFile(path.join(stageDir, 'printers.json'), 'utf8'));
    const stagedJobs = JSON.parse(await fs.readFile(path.join(stageDir, 'print-jobs.json'), 'utf8'));
    if (!Array.isArray(stagedPrinters) || !Array.isArray(stagedJobs)) throw new Error('Staged restore state is invalid');
    const unsafe = stagedJobs.some((job) => !TERMINAL_STATES.has(String(job?.status || '').toLowerCase())
      && (job.restoreRecoveryHold !== true || job.status !== 'needs_review'));
    if (unsafe) throw new Error('Staged restore contains unfinished queue work without a recovery hold');

    const marker = {
      format:'print-farm-controller-pending-restore',
      version:1,
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
      liveDataExisted:null,
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
      productionBatchesPaused:true,
      pendingMarkerPath:paths.pendingMarkerPath
    };
  } catch (error) {
    await fs.rm(stageDir, { recursive:true, force:true }).catch(() => {});
    await fs.rm(rollbackDir, { recursive:true, force:true }).catch(() => {});
    await fs.rm(externalLicenseBackupPath, { force:true }).catch(() => {});
    throw error;
  }
}

async function restoreExternalLicense(marker, newDataDir) {
  if (marker.externalLicenseMode === 'inside-data') return;
  const licensePath = path.resolve(marker.licensePath);
  const existed = await pathExists(licensePath);
  marker.externalLicenseExisted = existed;
  if (existed) {
    await fs.copyFile(licensePath, marker.externalLicenseBackupPath);
  }
  if (marker.externalLicenseMode === 'restore') {
    const source = path.join(newDataDir, RESERVED_EXTERNAL_LICENSE);
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

async function rollbackExternalLicense(marker) {
  if (marker.externalLicenseMode === 'inside-data') return;
  const licensePath = path.resolve(marker.licensePath);
  if (marker.externalLicenseExisted === true && await pathExists(marker.externalLicenseBackupPath)) {
    const temp = `${licensePath}.${crypto.randomUUID()}.tmp`;
    await fs.copyFile(marker.externalLicenseBackupPath, temp);
    await fs.rename(temp, licensePath);
  } else if (marker.externalLicenseExisted === false) {
    await fs.rm(licensePath, { force:true }).catch(() => {});
  }
}

async function rollbackActivatedMarker(marker, markerPath) {
  const dataDir = path.resolve(marker.dataDir);
  const rollbackDir = path.resolve(marker.rollbackDir);
  await fs.rm(dataDir, { recursive:true, force:true }).catch(() => {});
  if (marker.liveDataExisted === true && await pathExists(rollbackDir)) {
    await fs.rename(rollbackDir, dataDir);
  } else {
    await fs.rm(rollbackDir, { recursive:true, force:true }).catch(() => {});
  }
  await rollbackExternalLicense(marker).catch(() => {});
  await fs.rm(marker.externalLicenseBackupPath, { force:true }).catch(() => {});
  await fs.rm(marker.stageDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(markerPath, { force:true }).catch(() => {});
}

export async function activatePendingRestore({ dataDir, licensePath } = {}) {
  const paths = restoreRuntimePaths(dataDir);
  if (!await pathExists(paths.pendingMarkerPath)) return null;
  const marker = await readJson(paths.pendingMarkerPath);
  if (marker.format !== 'print-farm-controller-pending-restore' || marker.version !== 1) {
    throw new Error('Pending restore marker is invalid');
  }
  if (path.resolve(marker.dataDir) !== path.resolve(dataDir) || path.resolve(marker.licensePath) !== path.resolve(licensePath)) {
    throw new Error('Pending restore marker does not match this controller installation');
  }

  if (marker.phase === 'activated') {
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

  marker.liveDataExisted = await pathExists(dataDir);
  marker.externalLicenseExisted = marker.externalLicenseMode === 'inside-data'
    ? null
    : await pathExists(licensePath);

  try {
    await fs.rm(marker.rollbackDir, { recursive:true, force:true }).catch(() => {});
    if (marker.liveDataExisted) await fs.rename(dataDir, marker.rollbackDir);
    await fs.rename(marker.stageDir, dataDir);
    await restoreExternalLicense(marker, dataDir);
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
    const currentExists = await pathExists(dataDir);
    if (currentExists) await fs.rm(dataDir, { recursive:true, force:true }).catch(() => {});
    if (marker.liveDataExisted && await pathExists(marker.rollbackDir)) {
      await fs.rename(marker.rollbackDir, dataDir).catch(() => {});
    }
    await rollbackExternalLicense(marker).catch(() => {});
    throw new Error(`Could not activate staged restore: ${error.message}`);
  }
}

export async function commitActivatedRestore(transaction) {
  if (!transaction?.activated || !transaction.marker) return false;
  const marker = transaction.marker;
  await fs.rm(marker.rollbackDir, { recursive:true, force:true }).catch(() => {});
  await fs.rm(marker.externalLicenseBackupPath, { force:true }).catch(() => {});
  await fs.rm(transaction.markerPath, { force:true }).catch(() => {});
  return true;
}

export async function rollbackActivatedRestore(transaction) {
  if (!transaction?.activated || !transaction.marker) return false;
  await rollbackActivatedMarker(transaction.marker, transaction.markerPath);
  return true;
}

export async function pendingRestoreStatus(dataDir) {
  const paths = restoreRuntimePaths(dataDir);
  if (!await pathExists(paths.pendingMarkerPath)) return { pending:false };
  const marker = await readJson(paths.pendingMarkerPath);
  return {
    pending:true,
    phase:marker.phase || 'unknown',
    stagedAt:marker.stagedAt || null,
    activatedAt:marker.activatedAt || null,
    backupId:marker.backupId || null,
    fileName:marker.backupFileName || null
  };
}
