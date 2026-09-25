import { flashForgeAd5mAdapterDefinition, FLASHFORGE_AD5M_ADAPTER_TYPE } from './flashforge-ad5m-adapter.js';
import { flashForgeCreator5AdapterDefinition, FLASHFORGE_CREATOR5_ADAPTER_TYPE } from './flashforge-creator5-adapter.js';
import { snapmakerU1AdapterDefinition, SNAPMAKER_U1_ADAPTER_TYPE } from './snapmaker-u1-adapter.js';
import { bambuLabAdapterDefinition, BAMBU_LAB_ADAPTER_TYPE } from './bambu-lab-adapter.js';

const registry = new Map();

export function registerPrinterAdapter(definition) {
  if (!definition?.type || typeof definition.create !== 'function') {
    throw new Error('Adapter definition requires type and create(printer)');
  }
  registry.set(String(definition.type), Object.freeze({ ...definition }));
}

export function preparePrinterConfig(input = {}) {
  const type = String(input.adapterType || FLASHFORGE_AD5M_ADAPTER_TYPE);
  const definition = getAdapterDefinition(type);
  if (!definition) throw new Error(`No printer adapter is registered for ${type}`);
  if (typeof definition.prepareConfig === 'function') return definition.prepareConfig({ ...input, adapterType: type });
  const name = String(input.name || '').trim();
  const host = String(input.host || '').trim();
  if (!name || !host) throw new Error('name and host are required');
  return { ...input, name, host, adapterType: type, manufacturer: input.manufacturer || definition.manufacturer || 'Unknown', model: input.model || 'Unknown' };
}

export function getAdapterDefinition(type) {
  return registry.get(String(type || '')) || null;
}

export function listAdapterDefinitions() {
  return [...registry.values()].map(({ create, discover, prepareConfig, ...definition }) => ({ ...definition, discovery: typeof discover === 'function' }));
}

export async function discoverSupportedPrinters() {
  const discoverers = [...registry.values()].filter((definition) => typeof definition.discover === 'function');
  const groups = await Promise.all(discoverers.map(async (definition) => {
    try {
      const items = await definition.discover();
      return (items || []).map((item) => ({ ...item, adapterType: item.adapterType || definition.type, manufacturer: item.manufacturer || definition.manufacturer }));
    } catch (error) {
      console.warn(`Discovery failed for ${definition.type}: ${error.message}`);
      return [];
    }
  }));
  const seen = new Set();
  const printers = [];
  for (const printer of groups.flat()) {
    const key = `${printer.adapterType || ''}:${printer.host || ''}:${printer.serialNumber || printer.httpPort || printer.commandPort || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    printers.push(printer);
  }
  return printers.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export function normalizeAdapterType(printer = {}) {
  return String(printer.adapterType || FLASHFORGE_AD5M_ADAPTER_TYPE);
}

export function getPrinterAdapter(printer) {
  if (!printer) throw new Error('printer is required');
  const type = normalizeAdapterType(printer);
  const definition = getAdapterDefinition(type);
  if (!definition) throw new Error(`No printer adapter is registered for ${type}`);
  return definition.create({ ...printer, adapterType: type });
}

registerPrinterAdapter(flashForgeAd5mAdapterDefinition);
registerPrinterAdapter(flashForgeCreator5AdapterDefinition);
registerPrinterAdapter(snapmakerU1AdapterDefinition);
registerPrinterAdapter(bambuLabAdapterDefinition);

export { FLASHFORGE_AD5M_ADAPTER_TYPE, FLASHFORGE_CREATOR5_ADAPTER_TYPE, SNAPMAKER_U1_ADAPTER_TYPE, BAMBU_LAB_ADAPTER_TYPE };
