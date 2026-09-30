import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { printerStorePath } from './store.js';
import { canonicalMaterial } from './file-material-metadata.js';
import { KeyedSerialExecutor } from './concurrency.js';

const CATALOGUE_PATH = path.join(path.dirname(printerStorePath), 'filaments.json');
const EMPTY_STORE = Object.freeze({ version:1, filaments:[] });
const mutations = new KeyedSerialExecutor();
let initialization = null;

function cleanText(value, { required = false, max = 120, label = 'Value' } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text || null;
}

function cleanCurrency(value) {
  const currency = String(value || 'GBP').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code such as GBP');
  return currency;
}

function cleanCost(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Filament cost per kg must be zero or greater');
  return Math.round((number + Number.EPSILON) * 10000) / 10000;
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeEntry(entry = {}) {
  const material = cleanText(entry.material, { required:true, max:80, label:'Filament material' });
  return {
    id:String(entry.id || ''),
    material,
    materialKey:canonicalMaterial(material),
    brand:cleanText(entry.brand, { max:100, label:'Filament brand' }),
    product:cleanText(entry.product, { max:120, label:'Filament product' }),
    colour:cleanText(entry.colour, { max:80, label:'Filament colour' }),
    costPerKg:cleanCost(entry.costPerKg),
    currency:cleanCurrency(entry.currency),
    createdAt:entry.createdAt || null,
    updatedAt:entry.updatedAt || null
  };
}

async function ensureStore() {
  if (!initialization) {
    initialization = (async () => {
      await fs.mkdir(path.dirname(CATALOGUE_PATH), { recursive:true, mode:0o700 });
      try {
        await fs.writeFile(CATALOGUE_PATH, `${JSON.stringify(EMPTY_STORE, null, 2)}\n`, { mode:0o600, flag:'wx' });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
}

async function loadStore() {
  await ensureStore();
  const parsed = JSON.parse(await fs.readFile(CATALOGUE_PATH, 'utf8'));
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.filaments)) throw new Error('Filament catalogue store is invalid');
  return {
    version:1,
    filaments:parsed.filaments.map((entry) => normalizeEntry(entry))
  };
}

async function saveStore(store) {
  const temp = `${CATALOGUE_PATH}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode:0o600 });
    await fs.rename(temp, CATALOGUE_PATH);
  } finally {
    await fs.rm(temp, { force:true }).catch(() => {});
  }
}

export async function listFilaments() {
  const store = await loadStore();
  return store.filaments
    .map((entry) => ({ ...entry }))
    .sort((left, right) =>
      String(left.material).localeCompare(String(right.material))
      || String(left.brand || '').localeCompare(String(right.brand || ''))
      || String(left.product || '').localeCompare(String(right.product || ''))
    );
}

export async function getFilament(id) {
  const cleanId = String(id || '').trim().toLowerCase();
  if (!validId(cleanId)) return null;
  return (await listFilaments()).find((entry) => entry.id.toLowerCase() === cleanId) || null;
}

export async function createFilament(input = {}) {
  return mutations.run('catalogue', async () => {
    const store = await loadStore();
    const timestamp = new Date().toISOString();
    const entry = normalizeEntry({
      ...input,
      id:crypto.randomUUID(),
      createdAt:timestamp,
      updatedAt:timestamp
    });
    store.filaments.push(entry);
    await saveStore(store);
    return { ...entry };
  });
}

export async function updateFilament(id, patch = {}) {
  return mutations.run('catalogue', async () => {
    const cleanId = String(id || '').trim().toLowerCase();
    if (!validId(cleanId)) throw new Error('Filament id is invalid');
    const store = await loadStore();
    const index = store.filaments.findIndex((entry) => entry.id.toLowerCase() === cleanId);
    if (index < 0) throw new Error('Filament not found');
    const current = store.filaments[index];
    const next = normalizeEntry({
      ...current,
      ...(patch.material !== undefined ? { material:patch.material } : {}),
      ...(patch.brand !== undefined ? { brand:patch.brand } : {}),
      ...(patch.product !== undefined ? { product:patch.product } : {}),
      ...(patch.colour !== undefined ? { colour:patch.colour } : {}),
      ...(patch.costPerKg !== undefined ? { costPerKg:patch.costPerKg } : {}),
      ...(patch.currency !== undefined ? { currency:patch.currency } : {}),
      id:current.id,
      createdAt:current.createdAt,
      updatedAt:new Date().toISOString()
    });
    store.filaments[index] = next;
    await saveStore(store);
    return { ...next };
  });
}

export async function removeFilament(id) {
  return mutations.run('catalogue', async () => {
    const cleanId = String(id || '').trim().toLowerCase();
    if (!validId(cleanId)) throw new Error('Filament id is invalid');
    const store = await loadStore();
    const index = store.filaments.findIndex((entry) => entry.id.toLowerCase() === cleanId);
    if (index < 0) return false;
    store.filaments.splice(index, 1);
    await saveStore(store);
    return true;
  });
}

export const filamentCataloguePath = CATALOGUE_PATH;
