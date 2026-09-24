import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DATA_DESCRIPTOR = 0x08074b50;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_VERSION = 20;
const MAX_ZIP32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc, buffer) {
  let c = crc ^ 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function safeArchivePath(value) {
  const name = String(value || '').replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /^[A-Za-z]:\//.test(name)) {
    throw new Error('Backup archive entry path must be relative');
  }
  if (name.includes('\0') || name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Backup archive entry path is invalid');
  }
  return name;
}

function dosTimestamp(date = new Date()) {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const time = ((date.getUTCHours() & 0x1f) << 11)
    | ((date.getUTCMinutes() & 0x3f) << 5)
    | (Math.floor(date.getUTCSeconds() / 2) & 0x1f);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

async function writeAll(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    offset += result.bytesWritten;
  }
  return position + buffer.length;
}

async function sourceIterator(entry) {
  if (entry.buffer != null) {
    const value = Buffer.isBuffer(entry.buffer) ? entry.buffer : Buffer.from(entry.buffer);
    return { size:value.length, iterator:(async function* () { yield value; })() };
  }
  if (!entry.filePath) throw new Error(`Backup archive entry ${entry.name} has no source`);
  const stat = await fs.stat(entry.filePath);
  if (!stat.isFile()) throw new Error(`Backup archive source is not a file: ${entry.filePath}`);
  return { size:stat.size, iterator:createReadStream(entry.filePath) };
}

export async function hashArchiveSource(entry) {
  const source = await sourceIterator(entry);
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of source.iterator) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256:hash.digest('hex'), size };
}

export async function writeZipArchive(destinationPath, entries, { timestamp = new Date() } = {}) {
  const names = new Set();
  const normalized = entries.map((entry) => {
    const name = safeArchivePath(entry.name);
    if (names.has(name)) throw new Error(`Duplicate backup archive entry: ${name}`);
    names.add(name);
    return { ...entry, name };
  });
  if (normalized.length > 0xffff) throw new Error('Backup archive has too many entries for ZIP32');

  await fs.mkdir(path.dirname(path.resolve(destinationPath)), { recursive:true });
  const handle = await fs.open(destinationPath, 'wx', 0o600);
  const central = [];
  let position = 0;
  const { time, day } = dosTimestamp(timestamp);

  try {
    for (const entry of normalized) {
      const nameBuffer = Buffer.from(entry.name, 'utf8');
      const source = await sourceIterator(entry);
      if (source.size > MAX_ZIP32) throw new Error(`Backup entry is too large for ZIP32: ${entry.name}`);
      const localOffset = position;
      if (localOffset > MAX_ZIP32) throw new Error('Backup archive is too large for ZIP32');

      const local = Buffer.alloc(30);
      local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
      local.writeUInt16LE(ZIP_VERSION, 4);
      local.writeUInt16LE(UTF8_FLAG | DATA_DESCRIPTOR_FLAG, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(day, 12);
      local.writeUInt16LE(nameBuffer.length, 26);
      position = await writeAll(handle, local, position);
      position = await writeAll(handle, nameBuffer, position);

      let crc = 0;
      let size = 0;
      for await (const chunk of source.iterator) {
        const buffer = Buffer.from(chunk);
        crc = crc32Update(crc, buffer);
        size += buffer.length;
        if (size > MAX_ZIP32) throw new Error(`Backup entry is too large for ZIP32: ${entry.name}`);
        position = await writeAll(handle, buffer, position);
      }

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      position = await writeAll(handle, descriptor, position);
      central.push({ nameBuffer, crc, size, localOffset });
    }

    const centralOffset = position;
    for (const item of central) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
      record.writeUInt16LE(ZIP_VERSION, 4);
      record.writeUInt16LE(ZIP_VERSION, 6);
      record.writeUInt16LE(UTF8_FLAG | DATA_DESCRIPTOR_FLAG, 8);
      record.writeUInt16LE(0, 10);
      record.writeUInt16LE(time, 12);
      record.writeUInt16LE(day, 14);
      record.writeUInt32LE(item.crc >>> 0, 16);
      record.writeUInt32LE(item.size, 20);
      record.writeUInt32LE(item.size, 24);
      record.writeUInt16LE(item.nameBuffer.length, 28);
      record.writeUInt32LE(item.localOffset, 42);
      position = await writeAll(handle, record, position);
      position = await writeAll(handle, item.nameBuffer, position);
    }
    const centralSize = position - centralOffset;
    if (centralOffset > MAX_ZIP32 || centralSize > MAX_ZIP32) throw new Error('Backup archive is too large for ZIP32');

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    position = await writeAll(handle, end, position);
    await handle.sync();
    return { size:position, entries:central.length };
  } finally {
    await handle.close();
  }
}

export async function readZipDirectory(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const tailSize = Math.min(stat.size, 65_557);
    if (tailSize < 22) throw new Error('Backup archive ZIP directory was not found');
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tail.length, stat.size - tail.length);
    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (tail.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error('Backup archive ZIP directory was not found');
    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (directoryOffset + directorySize > stat.size) throw new Error('Backup archive ZIP directory is invalid');

    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directory.length, directoryOffset);
    const entries = [];
    const names = new Set();
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
        throw new Error('Backup archive ZIP directory is invalid');
      }
      const flags = directory.readUInt16LE(offset + 8);
      const compression = directory.readUInt16LE(offset + 10);
      const crc = directory.readUInt32LE(offset + 16);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const size = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const localOffset = directory.readUInt32LE(offset + 42);
      const nameEnd = offset + 46 + nameLength;
      if (nameEnd > directory.length) throw new Error('Backup archive ZIP entry is invalid');
      const name = safeArchivePath(directory.subarray(offset + 46, nameEnd).toString('utf8'));
      if (names.has(name)) throw new Error(`Duplicate backup archive entry: ${name}`);
      names.add(name);
      if ((flags & 0x0001) !== 0) throw new Error('Encrypted backup ZIP entries are not supported');
      if (compression !== 0) throw new Error(`Unsupported backup ZIP compression method ${compression}`);
      if (compressedSize !== size) throw new Error(`Stored backup ZIP entry has inconsistent size: ${name}`);
      entries.push({ name, flags, compression, crc, compressedSize, size, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

async function zipEntryDataOffset(handle, entry) {
  const header = Buffer.alloc(30);
  const { bytesRead } = await handle.read(header, 0, header.length, entry.localOffset);
  if (bytesRead !== header.length || header.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
    throw new Error('Backup archive local entry is invalid');
  }
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  return entry.localOffset + 30 + nameLength + extraLength;
}

export async function hashZipEntry(filePath, entry) {
  const handle = await fs.open(filePath, 'r');
  try {
    const start = await zipEntryDataOffset(handle, entry);
    const hash = crypto.createHash('sha256');
    let crc = 0;
    let remaining = entry.size;
    let position = start;
    const chunk = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, entry.size)));
    while (remaining > 0) {
      const length = Math.min(chunk.length, remaining);
      const { bytesRead } = await handle.read(chunk, 0, length, position);
      if (!bytesRead) throw new Error(`Backup archive entry is truncated: ${entry.name}`);
      const data = chunk.subarray(0, bytesRead);
      hash.update(data);
      crc = crc32Update(crc, data);
      remaining -= bytesRead;
      position += bytesRead;
    }
    if ((crc >>> 0) !== (entry.crc >>> 0)) throw new Error(`Backup archive CRC mismatch: ${entry.name}`);
    return { sha256:hash.digest('hex'), size:entry.size };
  } finally {
    await handle.close();
  }
}

export async function extractZipEntryToFile(filePath, entry, destinationPath) {
  const source = await fs.open(filePath, 'r');
  let destination = null;
  try {
    const start = await zipEntryDataOffset(source, entry);
    await fs.mkdir(path.dirname(destinationPath), { recursive:true, mode:0o700 });
    destination = await fs.open(destinationPath, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let crc = 0;
    let remaining = entry.size;
    let sourcePosition = start;
    let destinationPosition = 0;
    const chunk = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, entry.size)));
    while (remaining > 0) {
      const length = Math.min(chunk.length, remaining);
      const { bytesRead } = await source.read(chunk, 0, length, sourcePosition);
      if (!bytesRead) throw new Error(`Backup archive entry is truncated: ${entry.name}`);
      const data = chunk.subarray(0, bytesRead);
      hash.update(data);
      crc = crc32Update(crc, data);
      let written = 0;
      while (written < data.length) {
        const result = await destination.write(data, written, data.length - written, destinationPosition + written);
        written += result.bytesWritten;
      }
      remaining -= bytesRead;
      sourcePosition += bytesRead;
      destinationPosition += bytesRead;
    }
    await destination.sync();
    if ((crc >>> 0) !== (entry.crc >>> 0)) throw new Error(`Backup archive CRC mismatch: ${entry.name}`);
    return { sha256:hash.digest('hex'), size:entry.size };
  } catch (error) {
    await fs.rm(destinationPath, { force:true }).catch(() => {});
    throw error;
  } finally {
    await destination?.close().catch(() => {});
    await source.close();
  }
}

export async function readZipEntry(filePath, entry, { maxBytes = 512 * 1024 * 1024 } = {}) {
  if (entry.size > maxBytes) throw new Error(`Backup archive entry exceeds allowed size: ${entry.name}`);
  const handle = await fs.open(filePath, 'r');
  try {
    const start = await zipEntryDataOffset(handle, entry);
    const data = Buffer.alloc(entry.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, start + offset);
      if (!bytesRead) throw new Error(`Backup archive entry is truncated: ${entry.name}`);
      offset += bytesRead;
    }
    const crc = crc32Update(0, data);
    if ((crc >>> 0) !== (entry.crc >>> 0)) throw new Error(`Backup archive CRC mismatch: ${entry.name}`);
    return data;
  } finally {
    await handle.close();
  }
}

export async function inspectZipArchive(filePath) {
  const entries = await readZipDirectory(filePath);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    entries,
    byName,
    async read(name, options) {
      const entry = byName.get(safeArchivePath(name));
      if (!entry) throw new Error(`Backup archive entry is missing: ${name}`);
      return readZipEntry(filePath, entry, options);
    }
  };
}
