import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.gcode', '.gx', '.3mf', '.gco', '.g']);

export function validateUploadFilename(value) {
  let fileName;
  try {
    fileName = decodeURIComponent(String(value || '')).trim();
  } catch {
    throw new Error('Invalid upload filename encoding');
  }
  if (!fileName) throw new Error('File name is required');
  if (fileName.length > 240) throw new Error('File name is too long');
  if (/[\\/\0\r\n]/.test(fileName)) throw new Error('File name must not contain a path');
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('Choose a .gcode, .gx, .3mf, .gco, or .g file');
  return fileName;
}

export async function stageUploadRequest(readable, rawFileName, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  const fileName = validateUploadFilename(rawFileName);
  const declaredLength = Number(readable.headers?.['content-length'] || 0);
  if (declaredLength && declaredLength > maxBytes) throw new Error(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flashforge-fleet-upload-'));
  const filePath = path.join(directory, fileName);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(new Error(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit`));
      else callback(null, chunk);
    }
  });

  try {
    await pipeline(readable, limiter, createWriteStream(filePath, { flags: 'wx' }));
    if (!bytes) throw new Error('Uploaded file is empty');
    return {
      fileName,
      filePath,
      size: bytes,
      async cleanup() {
        await fs.rm(directory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
