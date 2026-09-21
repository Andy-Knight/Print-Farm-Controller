import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { printerStorePath } from './store.js';
import { validateUploadFilename } from './upload-staging.js';
import { readFilePrintRequirements } from './file-print-requirements.js';

const DATA_ROOT = path.dirname(printerStorePath);
const ROOT = path.join(DATA_ROOT, 'print-library');
const LEGACY_ROOT = path.join(DATA_ROOT, 'queue-files');
const META_FILE = 'metadata.json';

function safeId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid print library file id');
  return id;
}

function normalizeDescription(value) {
  const description = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (description.length > 4000) throw new Error('Print Library description must be 4000 characters or fewer');
  return description;
}

async function writeMetadata(directory, metadata) {
  const target = path.join(directory, META_FILE);
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(metadata, null, 2)}\n`, { mode:0o600 });
  await fs.rename(temp, target);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function migrateLegacyQueueFiles() {
  if (!await exists(LEGACY_ROOT)) return 0;
  await fs.mkdir(ROOT, { recursive:true, mode:0o700 });
  const entries = await fs.readdir(LEGACY_ROOT, { withFileTypes:true }).catch(() => []);
  let migrated = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(LEGACY_ROOT, entry.name);
    const destination = path.join(ROOT, entry.name);
    if (await exists(destination)) {
      await fs.rm(source, { recursive:true, force:true }).catch(() => {});
      continue;
    }
    try {
      await fs.rename(source, destination);
      migrated += 1;
    } catch {
      await fs.cp(source, destination, { recursive:true, errorOnExist:true });
      await fs.rm(source, { recursive:true, force:true });
      migrated += 1;
    }
  }
  const remaining = await fs.readdir(LEGACY_ROOT).catch(() => []);
  if (!remaining.length) await fs.rm(LEGACY_ROOT, { recursive:true, force:true }).catch(() => {});
  return migrated;
}

async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive:true, mode:0o700 });
  await migrateLegacyQueueFiles();
}

function normalizeMetadata(metadata) {
  if (!metadata) return null;
  const addedAt = metadata.addedAt || metadata.stagedAt || null;
  return {
    id: metadata.id,
    fileName: metadata.fileName,
    size: Number(metadata.size || 0),
    sha256: metadata.sha256 || null,
    description: normalizeDescription(metadata.description || ''),
    addedAt,
    updatedAt: metadata.updatedAt || null,
    // Keep stagedAt as a compatibility alias for persisted queue/history records.
    stagedAt: metadata.stagedAt || addedAt,
    requirements: metadata.requirements ? structuredClone(metadata.requirements) : null
  };
}

async function readMetadata(directory, expectedId = null) {
  const metadata = JSON.parse(await fs.readFile(path.join(directory, META_FILE), 'utf8'));
  if (expectedId && metadata.id !== expectedId) throw new Error('Print library metadata is invalid');
  const fileName = validateUploadFilename(metadata.fileName);
  const filePath = path.join(directory, fileName);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Print library file is missing');
  return { ...normalizeMetadata(metadata), filePath };
}

export async function listLibraryFiles() {
  await ensureRoot();
  const entries = await fs.readdir(ROOT, { withFileTypes:true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      files.push(normalizeMetadata(await readMetadata(path.join(ROOT, entry.name), entry.name)));
    } catch {
      // A damaged entry is ignored by listing but remains on disk for manual recovery.
    }
  }
  return files.sort((left, right) => {
    const leftAt = new Date(left.addedAt || 0).getTime();
    const rightAt = new Date(right.addedAt || 0).getTime();
    if (leftAt !== rightAt) return rightAt - leftAt;
    return String(left.fileName || '').localeCompare(String(right.fileName || ''));
  });
}

export async function addLibraryFile(sourcePath, rawFileName, { description = '' } = {}) {
  await ensureRoot();
  const fileName = validateUploadFilename(rawFileName);
  const cleanDescription = normalizeDescription(description);
  const sourceStat = await fs.stat(sourcePath);
  if (!sourceStat.isFile() || !sourceStat.size) throw new Error('Print library file is empty');

  const sourceHash = await sha256File(sourcePath);
  const existing = (await listLibraryFiles()).find((file) => file.sha256 === sourceHash && Number(file.size) === sourceStat.size);
  if (existing) return { ...existing, duplicate:true };

  const id = crypto.randomUUID();
  const directory = path.join(ROOT, id);
  const finalPath = path.join(directory, fileName);
  const tempPath = `${finalPath}.tmp`;
  await fs.mkdir(directory, { recursive:false, mode:0o700 });
  try {
    await pipeline(createReadStream(sourcePath), await fs.open(tempPath, 'wx', 0o600).then((handle) => handle.createWriteStream()));
    await fs.rename(tempPath, finalPath);
    const requirements = await readFilePrintRequirements(finalPath);
    const addedAt = new Date().toISOString();
    const metadata = {
      id,
      fileName,
      size: sourceStat.size,
      sha256: sourceHash,
      description: cleanDescription,
      addedAt,
      updatedAt: null,
      stagedAt: addedAt,
      requirements: { ...requirements, fileName }
    };
    await writeMetadata(directory, metadata);
    return normalizeMetadata(metadata);
  } catch (error) {
    await fs.rm(directory, { recursive:true, force:true }).catch(() => {});
    throw error;
  }
}

export async function getLibraryFile(id) {
  await ensureRoot();
  const normalizedId = safeId(id);
  return readMetadata(path.join(ROOT, normalizedId), normalizedId);
}

export async function updateLibraryFileMetadata(id, { description = '' } = {}) {
  await ensureRoot();
  const normalizedId = safeId(id);
  const directory = path.join(ROOT, normalizedId);
  const metadataPath = path.join(directory, META_FILE);
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (metadata.id !== normalizedId) throw new Error('Print library metadata is invalid');
  metadata.description = normalizeDescription(description);
  metadata.updatedAt = new Date().toISOString();
  await writeMetadata(directory, metadata);
  return normalizeMetadata(metadata);
}

export async function removeLibraryFile(id) {
  await ensureRoot();
  const normalizedId = safeId(id);
  await fs.rm(path.join(ROOT, normalizedId), { recursive:true, force:true });
}

export async function preserveLibraryFiles() {
  // Library files are durable by design. Queue/history cleanup must never prune them.
  await ensureRoot();
  return 0;
}

export const printLibraryPath = ROOT;
export const legacyQueueFilesPath = LEGACY_ROOT;
