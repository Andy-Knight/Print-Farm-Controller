import { promises as fs } from 'node:fs';
import path from 'node:path';
import { printerStorePath } from './store.js';

const FILE_PATH = path.join(path.dirname(printerStorePath), 'file-material-metadata.json');

function fileKey(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^0:\/user\//i, '')
    .replace(/^\/data\//i, '')
    .replace(/^\/+/, '')
    .trim()
    .toLocaleLowerCase();
}

async function readStore() {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  const temp = `${FILE_PATH}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, FILE_PATH);
}

export async function getPrinterFileMaterialMetadata(printerId, fileName) {
  const store = await readStore();
  const entry = store?.[String(printerId || '')]?.[fileKey(fileName)] || null;
  if (!entry) {
    return {
      fileName: String(fileName || ''),
      metadataAvailable: false,
      requiredMaterial: null,
      materials: [],
      source: null,
      warning: 'Material metadata is unavailable for this printer-only file. Files uploaded through Print Farm Controller are inspected and remembered for future checks.'
    };
  }
  return { ...entry, fileName: entry.fileName || String(fileName || '') };
}

export async function savePrinterFileMaterialMetadata(printerId, fileName, metadata = {}) {
  const id = String(printerId || '').trim();
  const key = fileKey(fileName);
  if (!id || !key || !metadata?.metadataAvailable) return null;
  const store = await readStore();
  store[id] ||= {};
  const entry = {
    fileName: String(fileName || ''),
    metadataAvailable: true,
    requiredMaterial: metadata.requiredMaterial || null,
    materials: Array.isArray(metadata.materials) ? [...metadata.materials] : [],
    source: metadata.source || null,
    warning: metadata.warning || null,
    updatedAt: new Date().toISOString()
  };
  store[id][key] = entry;
  await writeStore(store);
  return entry;
}

export async function removePrinterFileMaterialMetadata(printerId) {
  const id = String(printerId || '').trim();
  if (!id) return false;
  const store = await readStore();
  if (!store[id]) return false;
  delete store[id];
  await writeStore(store);
  return true;
}

export const fileMaterialStorePath = FILE_PATH;
