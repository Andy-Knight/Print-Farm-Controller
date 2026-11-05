import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const printerMapsFile = 'printer-maps.json';
export const emptyPrinterMaps = { version:1, maps:[] };
const itemTypes = new Set(['label', 'zone', 'bench', 'rack', 'wall', 'door', 'aisle', 'rectangle', 'line']);

function mapError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeLayout(input) {
  const { name, placements, items = [], columns = 50, rows = 50, compactPrinters = false } = input || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
    throw mapError('Enter a map name of up to 80 characters.');
  }
  if (!Array.isArray(placements)) throw mapError('Expected a list of printer placements.');
  if (![columns, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 200)
      || typeof compactPrinters !== 'boolean') throw mapError('Invalid map size or printer tile setting.');
  const maxX = columns * 20;
  const maxY = rows * 20;
  const ids = new Set();
  const positions = placements.map(placement => {
    const { printerId, x, y } = placement || {};
    if (typeof printerId !== 'string' || !printerId || ids.has(printerId)
        || ![x, y].every(value => Number.isInteger(value) && value >= 0) || x > maxX || y > maxY) {
      throw mapError('Invalid or duplicate printer placement.');
    }
    ids.add(printerId);
    return { printerId, x, y };
  });
  if (!Array.isArray(items) || items.length > 200) throw mapError('A map can contain up to 200 layout items.');
  const itemIds = new Set();
  const layoutItems = items.map(item => {
    const { id, type, label = '', x, y, width, height } = item || {};
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(id) || itemIds.has(id)
        || !itemTypes.has(type)
        || typeof label !== 'string' || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)
        || ![x, y, width, height].every(Number.isInteger)
        || x < 0 || y < 0 || width < 20 || height < 20 || x + width > maxX || y + height > maxY) {
      throw mapError('Invalid or duplicate map layout item.');
    }
    itemIds.add(id);
    const normalized = { id, type, label:label.trim(), x, y, width, height };
    if (type === 'wall' || type === 'line') {
      const axis = item.axis ?? (height > width ? 'vertical' : 'horizontal');
      if (axis !== 'vertical' && axis !== 'horizontal') throw mapError('Invalid wall or line orientation.');
      normalized.axis = axis;
      if (axis === 'vertical') {
        normalized.width = Math.min(40, maxX);
        normalized.x = Math.min(x, maxX - normalized.width);
      } else {
        normalized.height = Math.min(40, maxY);
        normalized.y = Math.min(y, maxY - normalized.height);
      }
    }
    if (type === 'door') {
      const { rotation = height > width ? 90 : 0, mirrored = false } = item;
      if (![0, 90, 180, 270].includes(rotation) || typeof mirrored !== 'boolean') {
        throw mapError('Invalid door orientation.');
      }
      Object.assign(normalized, { rotation, mirrored });
    }
    return normalized;
  });
  return { name:name.trim(), columns, rows, compactPrinters, placements:positions, items:layoutItems };
}

export function normalizePrinterMaps(store) {
  if (store?.version !== 1 || !Array.isArray(store.maps)) throw mapError('Printer map store is invalid.');
  const mapIds = new Set();
  const names = new Set();
  const printerIds = new Set();
  const maps = store.maps.map(map => {
    const layout = normalizeLayout(map);
    const nameKey = layout.name.toLowerCase();
    if (typeof map.id !== 'string' || !map.id || mapIds.has(map.id) || names.has(nameKey)
        || !Number.isSafeInteger(map.revision) || map.revision < 1) {
      throw mapError('Printer map store contains an invalid map.');
    }
    mapIds.add(map.id);
    names.add(nameKey);
    for (const { printerId } of layout.placements) {
      if (printerIds.has(printerId)) throw mapError('A printer appears on more than one map.');
      printerIds.add(printerId);
    }
    return { id:map.id, ...layout, revision:map.revision };
  });
  return { version:1, maps };
}

export async function readPrinterMaps(dataDir) {
  try {
    return normalizePrinterMaps(JSON.parse(await fs.readFile(path.join(dataDir, printerMapsFile), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(emptyPrinterMaps);
    throw error;
  }
}

// The controller serializes map writes and printer registry mutations together.
export async function savePrinterMap(dataDir, { id, input, printerIds, remove = false }) {
  const store = await readPrinterMaps(dataDir);
  const index = id ? store.maps.findIndex(map => map.id === id) : -1;
  const previous = store.maps[index];
  if (id && !previous) throw mapError('This map no longer exists.', 404);
  if (previous && previous.revision !== input?.revision) {
    throw mapError('This map changed. Reopen it to load the latest saved layout.', 409);
  }
  if (remove) {
    store.maps.splice(index, 1);
  } else {
    const layout = normalizeLayout({
      columns:previous?.columns, rows:previous?.rows, compactPrinters:previous?.compactPrinters,
      ...input, items:input?.items === undefined ? previous?.items : input.items
    });
    const otherMaps = store.maps.filter(map => map.id !== id);
    if (otherMaps.some(map => map.name.toLowerCase() === layout.name.toLowerCase())) {
      throw mapError('A map already uses that name.', 409);
    }
    const placed = new Set(otherMaps.flatMap(map => map.placements.map(item => item.printerId)));
    const previousIds = new Set(previous?.placements.map(item => item.printerId));
    const placements = [];
    for (const position of layout.placements) {
      const { printerId } = position;
      if (!printerIds.has(printerId) && previousIds.has(printerId)) continue;
      if (!printerIds.has(printerId)) throw mapError('A printer was removed. Reopen the map and try again.', 409);
      if (placed.has(printerId)) throw mapError('A printer is already on another map. Reopen the map and try again.', 409);
      placements.push(position);
    }
    const next = { id:id || randomUUID(), ...layout, placements, revision:(previous?.revision || 0) + 1 };
    if (previous) store.maps[index] = next;
    else store.maps.push(next);
  }
  const file = path.join(dataDir, printerMapsFile);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode:0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force:true }).catch(() => {});
  }
  return store;
}
