import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectZipArchive } from './backup-archive.js';
import { BACKUP_FORMAT_VERSION, verifyBackupArchive } from './backup-format.js';

const CURRENT_SCHEMA_VERSION = 1;
const TERMINAL_QUEUE_STATES = new Set(['completed', 'failed', 'cancelled']);
const MAX_STATE_JSON_BYTES = 64 * 1024 * 1024;
const MAX_LIBRARY_METADATA_BYTES = 4 * 1024 * 1024;
const MIN_STAGING_MARGIN_BYTES = 64 * 1024 * 1024;

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseVersion(value, label) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error(`${label} is not a supported semantic version`);
  return {
    text,
    parts:[Number(match[1]), Number(match[2]), Number(match[3])]
  };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] - right.parts[index];
  }
  return 0;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function safeLibraryFileName(value) {
  const fileName = String(value || '').trim();
  if (!fileName || fileName.length > 240 || fileName.includes('\\') || fileName.includes('/')
    || fileName.includes('\0') || fileName === '.' || fileName === '..' || fileName.includes('..')) {
    throw new Error('Backup contains an invalid Print Library file name');
  }
  return fileName;
}

async function readJsonEntry(archive, name, maxBytes = MAX_STATE_JSON_BYTES) {
  let buffer;
  try {
    buffer = await archive.read(name, { maxBytes });
  } catch (error) {
    if (/is missing/.test(String(error?.message || ''))) throw new Error(`Backup is missing required state: ${name}`);
    throw error;
  }
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error(`Backup contains invalid JSON: ${name}`);
  }
}

function validateSchemaVersions(manifest) {
  if (!plainObject(manifest.schemaVersions)) throw new Error('Backup schema version information is missing');
  for (const key of ['controllerState', 'printLibrary', 'queue']) {
    const version = Number(manifest.schemaVersions[key]);
    if (!Number.isInteger(version) || version !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`Backup ${key} schema version ${manifest.schemaVersions[key]} is not supported`);
    }
  }
}

async function validateFreeSpace(targetDataDir, payloadBytes) {
  if (!targetDataDir || typeof fs.statfs !== 'function') return null;
  try {
    const stats = await fs.statfs(path.resolve(targetDataDir));
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(available) || available <= 0) return null;
    const margin = Math.max(MIN_STAGING_MARGIN_BYTES, Math.ceil(payloadBytes * 0.1));
    const required = payloadBytes + margin;
    if (available < required) {
      throw new Error(`Not enough free space to stage this restore. At least ${required} bytes are required`);
    }
    return { availableBytes:available, requiredBytes:required };
  } catch (error) {
    if (/Not enough free space/.test(String(error?.message || ''))) throw error;
    return null;
  }
}

export async function inspectRestoreBackup(filePath, {
  currentControllerVersion,
  targetDataDir = null,
  originalFileName = null
} = {}) {
  const verification = await verifyBackupArchive(filePath);
  const { manifest, checksums } = verification;
  const archive = await inspectZipArchive(filePath);

  if (!validUuid(manifest.backupId)) throw new Error('Backup ID is invalid');
  if (!validUuid(manifest.installationId)) throw new Error('Backup installation ID is invalid');
  const createdAt = new Date(manifest.createdAt);
  if (Number.isNaN(createdAt.getTime())) throw new Error('Backup creation time is invalid');
  if (!['manual', 'scheduled'].includes(manifest.backupSource)) throw new Error('Backup source type is invalid');
  if (manifest.queueRestorePolicy !== 'recovery-hold') throw new Error('Backup queue restore policy is not supported');
  validateSchemaVersions(manifest);

  const sourceVersion = parseVersion(manifest.sourceControllerVersion, 'Backup source controller version');
  const currentVersion = parseVersion(currentControllerVersion, 'Current controller version');
  const versionComparison = compareVersions(sourceVersion, currentVersion);
  if (versionComparison > 0) {
    throw new Error(`Backup was created by newer Print Farm Controller v${sourceVersion.text}; this controller is v${currentVersion.text}`);
  }

  const checksumPayloadBytes = Object.entries(checksums.entries)
    .filter(([name]) => name !== 'manifest.json')
    .reduce((sum, [, entry]) => sum + Number(entry.size || 0), 0);
  if (!Number.isSafeInteger(Number(manifest.payloadBytes)) || Number(manifest.payloadBytes) < 0
    || Number(manifest.payloadBytes) !== checksumPayloadBytes) {
    throw new Error('Backup payload size does not match the manifest');
  }

  const printers = await readJsonEntry(archive, 'state/printers.json');
  const jobs = await readJsonEntry(archive, 'state/print-jobs.json');
  const fileMaterials = await readJsonEntry(archive, 'state/file-material-metadata.json');
  const backupSettings = await readJsonEntry(archive, 'state/backup-settings.json');
  if (!Array.isArray(printers)) throw new Error('Backup printer store is invalid');
  if (!Array.isArray(jobs)) throw new Error('Backup queue/history store is invalid');
  if (!plainObject(fileMaterials)) throw new Error('Backup file-material metadata store is invalid');
  if (!plainObject(backupSettings)) throw new Error('Backup settings store is invalid');
  if (!validUuid(backupSettings.installationId) || backupSettings.installationId !== manifest.installationId) {
    throw new Error('Backup installation ID does not match backup settings');
  }

  let maintenance = null;
  if (archive.byName.has('state/maintenance.json')) {
    maintenance = await readJsonEntry(archive, 'state/maintenance.json');
    if (!plainObject(maintenance) || maintenance.version !== 1 || !plainObject(maintenance.printers)) {
      throw new Error('Backup maintenance store is invalid');
    }
  }

  let printerGroups = null;
  const printerGroupIds = new Set();
  if (archive.byName.has('state/printer-groups.json')) {
    printerGroups = await readJsonEntry(archive, 'state/printer-groups.json');
    if (!plainObject(printerGroups) || printerGroups.version !== 1 || !Array.isArray(printerGroups.groups)) {
      throw new Error('Backup printer group store is invalid');
    }
    const configuredPrinterIds = new Set(printers.map((printer) => String(printer?.id || '')).filter(Boolean));
    const groupIds = new Set();
    const groupNames = new Set();
    const groupedPrinters = new Set();
    for (const group of printerGroups.groups) {
      const groupId = String(group?.id || '').trim();
      const groupName = String(group?.name || '').trim();
      if (!groupId || !groupName || !Array.isArray(group?.printerIds)) throw new Error('Backup printer group definition is invalid');
      if (groupIds.has(groupId) || groupNames.has(groupName.toLowerCase())) throw new Error('Backup contains duplicate printer groups');
      groupIds.add(groupId);
      printerGroupIds.add(groupId);
      groupNames.add(groupName.toLowerCase());
      for (const printerIdValue of group.printerIds) {
        const printerId = String(printerIdValue || '').trim();
        if (!printerId || !configuredPrinterIds.has(printerId)) throw new Error('Backup printer group references a printer that is not configured');
        if (groupedPrinters.has(printerId)) throw new Error('Backup assigns a printer to more than one printer group');
        groupedPrinters.add(printerId);
      }
    }
  }

  if (maintenance && Array.isArray(maintenance.groupTasks)) {
    for (const task of maintenance.groupTasks) {
      const groupId = String(task?.target?.groupId || '').trim();
      if (!groupId || !printerGroupIds.has(groupId)) {
        throw new Error('Backup group maintenance task references a missing printer group');
      }
    }
  }

    if (archive.byName.has('state/emulator-settings.json')) {
    const emulatorSettings = await readJsonEntry(archive, 'state/emulator-settings.json');
    if (!plainObject(emulatorSettings)) throw new Error('Backup emulator settings are invalid');
  }

  const licensePresent = archive.byName.has('state/license.json');
  if (licensePresent !== (manifest.licenseIncluded === true)) {
    throw new Error('Backup licence presence does not match the manifest');
  }
  if (licensePresent) {
    const license = await readJsonEntry(archive, 'state/license.json', 4 * 1024 * 1024);
    if (!plainObject(license)) throw new Error('Backup licence document is invalid');
  }

  const libraryIds = new Set();
  const allowedLibraryEntries = new Set();
  const metadataEntries = archive.entries
    .map((entry) => entry.name)
    .filter((name) => /^print-library\/[0-9a-f-]{36}\/metadata\.json$/i.test(name));

  for (const metadataPath of metadataEntries) {
    const match = metadataPath.match(/^print-library\/([0-9a-f-]{36})\/metadata\.json$/i);
    const libraryId = match?.[1]?.toLowerCase();
    if (!libraryId || !validUuid(libraryId)) throw new Error(`Backup contains an invalid Print Library ID: ${metadataPath}`);
    if (libraryIds.has(libraryId)) throw new Error(`Backup contains duplicate Print Library ID: ${libraryId}`);
    libraryIds.add(libraryId);

    const metadata = await readJsonEntry(archive, metadataPath, MAX_LIBRARY_METADATA_BYTES);
    if (!plainObject(metadata) || String(metadata.id || '').toLowerCase() !== libraryId) {
      throw new Error(`Backup Print Library metadata does not match its directory: ${libraryId}`);
    }
    const fileName = safeLibraryFileName(metadata.fileName);
    const filePath = `print-library/${libraryId}/${fileName}`;
    const fileEntry = archive.byName.get(filePath);
    if (!fileEntry) throw new Error(`Backup Print Library payload is missing: ${libraryId}/${fileName}`);
    if (!Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) !== fileEntry.size) {
      throw new Error(`Backup Print Library file size does not match metadata: ${fileName}`);
    }
    if (!/^[0-9a-f]{64}$/i.test(String(metadata.sha256 || ''))) {
      throw new Error(`Backup Print Library SHA-256 is invalid: ${fileName}`);
    }
    const payloadChecksum = checksums.entries[filePath];
    if (!payloadChecksum || String(payloadChecksum.sha256).toLowerCase() !== String(metadata.sha256).toLowerCase()) {
      throw new Error(`Backup Print Library SHA-256 does not match metadata: ${fileName}`);
    }

    allowedLibraryEntries.add(metadataPath);
    allowedLibraryEntries.add(filePath);
    if (metadata.preview?.available === true) {
      const previewName = metadata.preview.mimeType === 'image/jpeg' ? 'preview.jpg'
        : metadata.preview.mimeType === 'image/png' ? 'preview.png'
          : null;
      if (!previewName) throw new Error(`Backup Print Library preview metadata is invalid: ${fileName}`);
      const previewPath = `print-library/${libraryId}/${previewName}`;
      if (!archive.byName.has(previewPath)) throw new Error(`Backup Print Library preview is missing: ${fileName}`);
      allowedLibraryEntries.add(previewPath);
    }
  }

  for (const entry of archive.entries) {
    if (entry.name.startsWith('print-library/') && !allowedLibraryEntries.has(entry.name)) {
      throw new Error(`Backup contains an unexpected Print Library entry: ${entry.name}`);
    }
  }

  for (const job of jobs) {
    const referencedId = String(job?.stagedFile?.id || '').trim().toLowerCase();
    if (referencedId && !libraryIds.has(referencedId)) {
      throw new Error(`Backup queue job ${job?.id || 'unknown'} references missing Print Library file ${referencedId}`);
    }
    const groupId = String(job?.groupId || '').trim();
    if (groupId && !printerGroupIds.has(groupId)) {
      throw new Error(`Backup queue job ${job?.id || 'unknown'} references missing printer group ${groupId}`);
    }
  }

  const unfinishedJobs = jobs.filter((job) => !TERMINAL_QUEUE_STATES.has(String(job?.status || '').toLowerCase())).length;
  const historyJobs = jobs.length - unfinishedJobs;
  const manifestCounts = plainObject(manifest.counts) ? manifest.counts : {};
  const expectedCounts = {
    printers:printers.length,
    printLibrary:libraryIds.size,
    queued:unfinishedJobs,
    history:historyJobs
  };
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (!Number.isSafeInteger(Number(manifestCounts[key])) || Number(manifestCounts[key]) !== value) {
      throw new Error(`Backup manifest ${key} count does not match its contents`);
    }
  }

  const stagingSpace = await validateFreeSpace(targetDataDir, Number(manifest.payloadBytes));
  const warnings = [];
  const migrationsRequired = [];
  if (versionComparison < 0) {
    migrationsRequired.push({
      type:'controller-version',
      from:sourceVersion.text,
      to:currentVersion.text
    });
    warnings.push(`Backup was created by Print Farm Controller v${sourceVersion.text}; restore will migrate it for v${currentVersion.text}.`);
  }
  if (unfinishedJobs > 0) {
    warnings.push(`${unfinishedJobs} unfinished queue job${unfinishedJobs === 1 ? '' : 's'} will be placed on recovery hold and will not auto-start after restore.`);
  }
  if (backupSettings.enabled === true) {
    warnings.push('Scheduled backups were enabled in this backup; the schedule will be restored disabled until explicitly re-enabled.');
  }
  if (licensePresent) {
    warnings.push('The signed licence is included and will be revalidated normally after restore.');
  }

  const stat = await fs.stat(filePath);
  return {
    valid:true,
    fileName:String(originalFileName || path.basename(filePath)),
    archiveBytes:stat.size,
    backupId:manifest.backupId,
    installationId:manifest.installationId,
    createdAt:manifest.createdAt,
    sourceControllerVersion:sourceVersion.text,
    currentControllerVersion:currentVersion.text,
    formatVersion:BACKUP_FORMAT_VERSION,
    backupSource:manifest.backupSource,
    payloadBytes:Number(manifest.payloadBytes),
    counts:expectedCounts,
    licenseIncluded:licensePresent,
    queueRestorePolicy:manifest.queueRestorePolicy,
    migrationsRequired,
    warnings,
    stagingSpace
  };
}

export const restoreInspectionPolicy = Object.freeze({
  schemaVersion:CURRENT_SCHEMA_VERSION,
  maxStateJsonBytes:MAX_STATE_JSON_BYTES,
  maxLibraryMetadataBytes:MAX_LIBRARY_METADATA_BYTES
});
