import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_CHUNK_BYTES = 256 * 1024;

export function canonicalMaterial(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  return text.replace(/[^A-Z0-9]/g, '') || null;
}

export function materialsEquivalent(a, b) {
  const left = canonicalMaterial(a);
  const right = canonicalMaterial(b);
  return Boolean(left && right && left === right);
}

function cleanMaterial(value) {
  let text = String(value || '').trim();
  text = text.replace(/^['"]|['"]$/g, '').trim();
  if (!text || /^(?:none|null|unknown|n\/?a)$/i.test(text)) return null;
  return text;
}

function splitMaterialList(value) {
  return String(value || '')
    .split(/[;,]/)
    .map(cleanMaterial)
    .filter(Boolean);
}

export function parseGcodeMaterialMetadata(text = '') {
  const sourceText = String(text || '');
  const explicit = [];
  const generic = [];

  for (const match of sourceText.matchAll(/^\s*;?\s*(?:right_extruder_material|extruder_material)\s*[:=]\s*([^\r\n]+)/gim)) {
    const value = cleanMaterial(match[1]);
    if (value) explicit.push(value);
  }

  for (const match of sourceText.matchAll(/^\s*;?\s*filament_type\s*[:=]\s*([^\r\n]+)/gim)) {
    generic.push(...splitMaterialList(match[1]));
  }

  const values = explicit.length ? explicit : generic;
  const materials = [];
  const seen = new Set();
  for (const value of values) {
    const key = canonicalMaterial(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    materials.push(value);
  }

  if (!materials.length) {
    return {
      metadataAvailable: false,
      requiredMaterial: null,
      materials: [],
      source: null,
      warning: 'No reliable filament-type metadata was found in the G-code.'
    };
  }

  if (materials.length > 1) {
    return {
      metadataAvailable: true,
      requiredMaterial: null,
      materials,
      source: explicit.length ? 'right_extruder_material' : 'filament_type',
      warning: `The file declares multiple filament types (${materials.join(', ')}), so a single FlashForge material requirement cannot be inferred safely.`
    };
  }

  return {
    metadataAvailable: true,
    requiredMaterial: materials[0],
    materials,
    source: explicit.length ? 'right_extruder_material' : 'filament_type',
    warning: null
  };
}

export async function readFileMaterialMetadata(filePath, { maxChunkBytes = MAX_CHUNK_BYTES } = {}) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (!['.gcode', '.gx', '.g'].includes(extension)) {
    return {
      metadataAvailable: false,
      requiredMaterial: null,
      materials: [],
      source: null,
      warning: extension === '.3mf'
        ? 'FlashForge 3MF material metadata is not currently inspected by the controller.'
        : 'Material metadata is unavailable for this file type.'
    };
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const headSize = Math.min(stat.size, maxChunkBytes);
    const tailSize = Math.min(Math.max(0, stat.size - headSize), maxChunkBytes);
    const head = Buffer.alloc(headSize);
    if (headSize) await handle.read(head, 0, headSize, 0);
    let tail = Buffer.alloc(0);
    if (tailSize) {
      tail = Buffer.alloc(tailSize);
      await handle.read(tail, 0, tailSize, Math.max(0, stat.size - tailSize));
    }
    const combined = `${head.toString('utf8')}\n${tail.toString('utf8')}`;
    return parseGcodeMaterialMetadata(combined);
  } finally {
    await handle.close();
  }
}

export function assessMaterialCompatibility(designatedMaterial, metadata = {}) {
  const designated = cleanMaterial(designatedMaterial);
  const required = cleanMaterial(metadata?.requiredMaterial);
  if (!designated || !required) {
    return {
      comparable: false,
      mismatch: false,
      designatedMaterial: designated,
      requiredMaterial: required
    };
  }
  return {
    comparable: true,
    mismatch: !materialsEquivalent(designated, required),
    designatedMaterial: designated,
    requiredMaterial: required
  };
}
