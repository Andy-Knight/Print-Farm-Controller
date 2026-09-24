import crypto from 'node:crypto';
import { inspectZipArchive, hashZipEntry } from './backup-archive.js';

export const BACKUP_FORMAT_ID = 'print-farm-controller-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = '.pfcbackup';

export function jsonEntry(name, value) {
  return { name, buffer:Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8') };
}

export function backupFileName({ createdAt = new Date().toISOString(), controllerVersion = 'unknown' } = {}) {
  const stamp = String(createdAt).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const version = String(controllerVersion || 'unknown').replace(/[^0-9A-Za-z._-]/g, '_');
  return `PrintFarmController-${stamp}-v${version}${BACKUP_EXTENSION}`;
}

export function buildManifest({
  backupId = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
  controllerVersion,
  installationId,
  source = 'manual',
  counts = {},
  payloadBytes = 0,
  licenseIncluded = false,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version
} = {}) {
  return {
    format:BACKUP_FORMAT_ID,
    formatVersion:BACKUP_FORMAT_VERSION,
    backupId,
    createdAt,
    sourceControllerVersion:String(controllerVersion || 'unknown'),
    sourcePlatform:{ platform, arch, nodeVersion },
    installationId:String(installationId || ''),
    backupSource:source === 'scheduled' ? 'scheduled' : 'manual',
    counts:{
      printers:Number(counts.printers || 0),
      printLibrary:Number(counts.printLibrary || 0),
      queued:Number(counts.queued || 0),
      history:Number(counts.history || 0)
    },
    licenseIncluded:licenseIncluded === true,
    payloadBytes:Number(payloadBytes || 0),
    queueRestorePolicy:'recovery-hold',
    schemaVersions:{ controllerState:1, printLibrary:1, queue:1 }
  };
}

export async function verifyBackupArchive(filePath) {
  const archive = await inspectZipArchive(filePath);
  const manifestEntry = archive.byName.get('manifest.json');
  const checksumsEntry = archive.byName.get('checksums.json');
  if (!manifestEntry || !checksumsEntry) throw new Error('Backup archive is missing manifest or checksums');
  const manifest = JSON.parse((await archive.read('manifest.json', { maxBytes:1024 * 1024 })).toString('utf8'));
  if (manifest.format !== BACKUP_FORMAT_ID) throw new Error('Backup format identifier is not supported');
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) throw new Error(`Backup format version ${manifest.formatVersion} is not supported`);
  const checksums = JSON.parse((await archive.read('checksums.json', { maxBytes:4 * 1024 * 1024 })).toString('utf8'));
  if (!checksums || checksums.algorithm !== 'sha256' || !checksums.entries
    || typeof checksums.entries !== 'object' || Array.isArray(checksums.entries)) {
    throw new Error('Backup checksum document is invalid');
  }

  const checksumNames = Object.keys(checksums.entries);
  if (checksumNames.includes('checksums.json')) throw new Error('Backup checksum document must not checksum itself');
  const expectedArchiveNames = new Set(['checksums.json', ...checksumNames]);
  if (archive.entries.length !== expectedArchiveNames.size
    || archive.entries.some((entry) => !expectedArchiveNames.has(entry.name))) {
    throw new Error('Backup archive contains an entry that is not covered by the checksum document');
  }

  for (const [name, expected] of Object.entries(checksums.entries)) {
    if (!expected || typeof expected !== 'object'
      || !/^[0-9a-f]{64}$/i.test(String(expected.sha256 || ''))
      || !Number.isSafeInteger(Number(expected.size)) || Number(expected.size) < 0) {
      throw new Error(`Backup checksum entry is invalid: ${name}`);
    }
    const entry = archive.byName.get(name);
    if (!entry) throw new Error(`Backup archive entry is missing: ${name}`);
    const actual = await hashZipEntry(filePath, entry);
    if (actual.size !== Number(expected.size) || actual.sha256 !== String(expected.sha256).toLowerCase()) {
      throw new Error(`Backup checksum mismatch: ${name}`);
    }
  }
  return { manifest, checksums, entryCount:archive.entries.length };
}
