import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveControllerRuntimePaths } from '../runtime-paths.js';
import { loadBackupSettings } from './backup-settings-store.js';
import { hashArchiveSource, writeZipArchive } from './backup-archive.js';
import {
  BACKUP_EXTENSION,
  backupFileName,
  buildManifest,
  jsonEntry,
  verifyBackupArchive
} from './backup-format.js';

const TERMINAL_QUEUE_STATES = new Set(['completed','failed','cancelled']);

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

function safeLibraryFileName(value) {
  const fileName = String(value || '').trim();
  if (!fileName || path.basename(fileName) !== fileName || fileName.includes('..')) {
    throw new Error('Print Library metadata contains an invalid file name');
  }
  return fileName;
}

async function existingFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function collectLibraryEntries(dataDir) {
  const root = path.join(dataDir, 'print-library');
  const directories = await fs.readdir(root, { withFileTypes:true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const entries = [];
  let count = 0;
  for (const directory of directories) {
    if (!directory.isDirectory() || !/^[0-9a-f-]{36}$/i.test(directory.name)) continue;
    const base = path.join(root, directory.name);
    const metadataPath = path.join(base, 'metadata.json');
    const metadata = await readJsonFile(metadataPath, null);
    if (!metadata) continue;
    if (String(metadata.id || '').toLowerCase() !== directory.name.toLowerCase()) {
      throw new Error(`Print Library metadata id mismatch: ${directory.name}`);
    }
    const fileName = safeLibraryFileName(metadata.fileName);
    const sourcePath = path.join(base, fileName);
    if (!await existingFile(sourcePath)) throw new Error(`Print Library file is missing: ${directory.name}/${fileName}`);
    const prefix = `print-library/${directory.name}`;
    entries.push(jsonEntry(`${prefix}/metadata.json`, metadata));
    entries.push({ name:`${prefix}/${fileName}`, filePath:sourcePath });
    const previewName = metadata.preview?.available
      ? (metadata.preview.mimeType === 'image/jpeg' ? 'preview.jpg' : 'preview.png')
      : null;
    if (previewName) {
      const previewPath = path.join(base, previewName);
      if (await existingFile(previewPath)) entries.push({ name:`${prefix}/${previewName}`, filePath:previewPath });
    }
    count += 1;
  }
  return { entries, count };
}

export async function collectLogicalBackupSnapshot({
  dataDir = resolveControllerRuntimePaths().dataDir,
  applicationDir = resolveControllerRuntimePaths().applicationDir,
  licensePath = resolveControllerRuntimePaths().licensePath,
  controllerVersion = 'unknown',
  source = 'manual',
  now = new Date()
} = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  const settings = await loadBackupSettings({ dataDir:resolvedDataDir, create:true });
  const printers = await readJsonFile(path.join(resolvedDataDir, 'printers.json'), []);
  const jobs = await readJsonFile(path.join(resolvedDataDir, 'print-jobs.json'), []);
  const fileMaterials = await readJsonFile(path.join(resolvedDataDir, 'file-material-metadata.json'), {});
  const emulatorSettings = await readJsonFile(path.join(resolvedDataDir, 'emulator-settings.json'), null);
  const maintenance = await readJsonFile(path.join(resolvedDataDir, 'maintenance.json'), { version:1, printers:{} });
  const library = await collectLibraryEntries(resolvedDataDir);

  if (!Array.isArray(printers)) throw new Error('Printer store is invalid');
  if (!Array.isArray(jobs)) throw new Error('Print queue store is invalid');
  if (!fileMaterials || typeof fileMaterials !== 'object' || Array.isArray(fileMaterials)) throw new Error('File material metadata store is invalid');
  if (!maintenance || maintenance.version !== 1 || !maintenance.printers || typeof maintenance.printers !== 'object' || Array.isArray(maintenance.printers)) throw new Error('Maintenance store is invalid');

  const payload = [
    jsonEntry('state/printers.json', printers),
    jsonEntry('state/print-jobs.json', jobs),
    jsonEntry('state/file-material-metadata.json', fileMaterials),
    jsonEntry('state/backup-settings.json', settings),
    jsonEntry('state/maintenance.json', maintenance),
    ...library.entries
  ];
  if (emulatorSettings && typeof emulatorSettings === 'object') payload.push(jsonEntry('state/emulator-settings.json', emulatorSettings));

  let licenseIncluded = false;
  const licenseStat = await existingFile(licensePath);
  if (licenseStat) {
    payload.push({ name:'state/license.json', filePath:licensePath });
    licenseIncluded = true;
  }

  const checksums = {};
  let payloadBytes = 0;
  for (const entry of payload) {
    const value = await hashArchiveSource(entry);
    checksums[entry.name] = value;
    payloadBytes += value.size;
  }

  const queued = jobs.filter((job) => !TERMINAL_QUEUE_STATES.has(String(job?.status || '').toLowerCase())).length;
  const history = jobs.length - queued;
  const manifest = buildManifest({
    createdAt:now.toISOString(),
    controllerVersion,
    installationId:settings.installationId,
    source,
    counts:{ printers:printers.length, printLibrary:library.count, queued, history },
    payloadBytes,
    licenseIncluded
  });
  const manifestEntry = jsonEntry('manifest.json', manifest);
  checksums['manifest.json'] = await hashArchiveSource(manifestEntry);
  const checksumEntry = jsonEntry('checksums.json', { algorithm:'sha256', entries:checksums });

  return {
    manifest,
    entries:[manifestEntry, checksumEntry, ...payload],
    applicationDir:path.resolve(applicationDir),
    dataDir:resolvedDataDir
  };
}

export async function createBackupArchive({
  destinationPath,
  dataDir,
  applicationDir,
  licensePath,
  controllerVersion = 'unknown',
  source = 'manual',
  now = new Date()
} = {}) {
  if (!destinationPath) throw new Error('Backup destination path is required');
  const finalPath = path.resolve(String(destinationPath).endsWith(BACKUP_EXTENSION)
    ? destinationPath
    : `${destinationPath}${BACKUP_EXTENSION}`);
  const tempPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  const snapshot = await collectLogicalBackupSnapshot({
    dataDir, applicationDir, licensePath, controllerVersion, source, now
  });

  try {
    await writeZipArchive(tempPath, snapshot.entries, { timestamp:now });
    const verification = await verifyBackupArchive(tempPath);
    await fs.rename(tempPath, finalPath);
    return {
      filePath:finalPath,
      fileName:path.basename(finalPath),
      manifest:verification.manifest,
      entryCount:verification.entryCount,
      size:(await fs.stat(finalPath)).size
    };
  } finally {
    await fs.rm(tempPath, { force:true }).catch(() => {});
  }
}

export async function createBackupInDirectory({
  destinationDir,
  controllerVersion = 'unknown',
  now = new Date(),
  ...options
} = {}) {
  if (!destinationDir) throw new Error('Backup destination directory is required');
  const fileName = backupFileName({ createdAt:now.toISOString(), controllerVersion });
  return createBackupArchive({
    ...options,
    controllerVersion,
    now,
    destinationPath:path.join(destinationDir, fileName)
  });
}
