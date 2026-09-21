import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const MAX_GCODE_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

function imageType(buffer) {
  if (buffer?.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return { mimeType:'image/png', extension:'.png' };
  }
  if (buffer?.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType:'image/jpeg', extension:'.jpg' };
  }
  return null;
}

function gcodeThumbnailCandidates(text) {
  const lines = String(text || '').split(/\r?\n/);
  const candidates = [];
  for (let index = 0; index < lines.length; index++) {
    const begin = lines[index].match(/^\s*;\s*thumbnail(?:_(PNG|JPG|JPEG))?\s+begin\s+(\d+)x(\d+)(?:\s+\d+)?\s*$/i);
    if (!begin) continue;
    const encoded = [];
    let endIndex = index + 1;
    for (; endIndex < lines.length; endIndex++) {
      if (/^\s*;\s*thumbnail(?:_(?:PNG|JPG|JPEG))?\s+end\s*$/i.test(lines[endIndex])) break;
      const payload = lines[endIndex].replace(/^\s*;\s?/, '').trim();
      if (payload) encoded.push(payload);
    }
    if (endIndex >= lines.length || !encoded.length) continue;
    const base64 = encoded.join('');
    if (!/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length > Math.ceil(MAX_PREVIEW_BYTES * 4 / 3) + 16) {
      index = endIndex;
      continue;
    }
    let data;
    try {
      data = Buffer.from(base64, 'base64');
    } catch {
      index = endIndex;
      continue;
    }
    const type = imageType(data);
    if (type && data.length <= MAX_PREVIEW_BYTES) {
      candidates.push({
        data,
        ...type,
        width:Number(begin[2]),
        height:Number(begin[3]),
        source:'gcode-embedded-thumbnail'
      });
    }
    index = endIndex;
  }
  return candidates.sort((left, right) => (right.width * right.height) - (left.width * left.height));
}

async function extractGcodePreview(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const readBytes = Math.min(stat.size, MAX_GCODE_SCAN_BYTES);
    if (!readBytes) return null;
    const buffer = Buffer.alloc(readBytes);
    await handle.read(buffer, 0, readBytes, 0);
    return gcodeThumbnailCandidates(buffer.toString('utf8'))[0] || null;
  } finally {
    await handle.close();
  }
}

async function zipDirectory(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const tailSize = Math.min(stat.size, 65_557);
    if (tailSize < 22) throw new Error('The 3MF ZIP directory was not found');
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, stat.size - tailSize);

    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (tail.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error('The 3MF ZIP directory was not found');

    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (directorySize > MAX_CENTRAL_DIRECTORY_BYTES || directoryOffset + directorySize > stat.size) {
      throw new Error('The 3MF ZIP directory is too large or invalid');
    }

    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);
    const entries = [];
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('The 3MF ZIP directory is invalid');
      }
      const compression = directory.readUInt16LE(offset + 10);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const uncompressedSize = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const localOffset = directory.readUInt32LE(offset + 42);
      const nameEnd = offset + 46 + nameLength;
      if (nameEnd > directory.length) throw new Error('The 3MF ZIP entry is invalid');
      const name = directory.subarray(offset + 46, nameEnd).toString('utf8').replace(/^\/+/, '');
      entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return { handle, entries, keepOpen:true };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readZipEntry(handle, entry) {
  if (entry.uncompressedSize > MAX_PREVIEW_BYTES || entry.compressedSize > MAX_PREVIEW_BYTES) {
    throw new Error('The embedded preview is too large');
  }
  const header = Buffer.alloc(30);
  await handle.read(header, 0, header.length, entry.localOffset);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('The 3MF ZIP entry is invalid');
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = Buffer.alloc(entry.compressedSize);
  await handle.read(compressed, 0, compressed.length, dataOffset);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return inflateRawSync(compressed, { maxOutputLength:MAX_PREVIEW_BYTES });
  throw new Error(`Unsupported 3MF ZIP compression method ${entry.compression}`);
}

function previewRank(name) {
  const normalized = String(name || '').replace(/\\/g, '/');
  if (/^Metadata\/plate_1\.png$/i.test(normalized)) return 1000;
  if (/^Metadata\/thumbnail\.png$/i.test(normalized)) return 950;
  if (/^Auxiliaries\/\.thumbnails\/thumbnail_3mf\.png$/i.test(normalized)) return 900;
  if (/^Auxiliaries\/\.thumbnails\/thumbnail_middle\.png$/i.test(normalized)) return 850;
  if (/^Metadata\/bbl_thumbnail\.png$/i.test(normalized)) return 800;
  if (/^Metadata\/plate_\d+\.png$/i.test(normalized)) {
    const number = Number(normalized.match(/plate_(\d+)\.png/i)?.[1] || 9999);
    return 700 - Math.min(number, 600);
  }
  if (/^Auxiliaries\/\.thumbnails\/thumbnail_small\.png$/i.test(normalized)) return 100;
  return 0;
}

async function extract3mfPreview(filePath) {
  const opened = await zipDirectory(filePath);
  const { handle, entries } = opened;
  try {
    const candidates = entries
      .map((entry) => ({ entry, rank:previewRank(entry.name) }))
      .filter((item) => item.rank > 0)
      .sort((left, right) => right.rank - left.rank);
    for (const { entry } of candidates) {
      try {
        const data = await readZipEntry(handle, entry);
        const type = imageType(data);
        if (type) return { data, ...type, width:null, height:null, source:`3mf:${entry.name}` };
      } catch {
        // Try the next recognised preview rather than failing the whole library entry.
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

export async function extractFilePreview(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  try {
    if (extension === '.3mf') return await extract3mfPreview(filePath);
    if (['.gcode', '.g', '.gco', '.gx'].includes(extension)) return await extractGcodePreview(filePath);
  } catch {
    return null;
  }
  return null;
}

export { imageType, gcodeThumbnailCandidates, previewRank };
