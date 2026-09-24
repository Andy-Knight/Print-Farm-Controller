import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_RESTORE_UPLOAD_BYTES = (4 * 1024 * 1024 * 1024) - 1;

export function validateBackupUploadFilename(value) {
  let fileName;
  try {
    fileName = decodeURIComponent(String(value || '')).trim();
  } catch {
    throw new Error('Invalid backup filename encoding');
  }
  if (!fileName) throw new Error('Backup file name is required');
  if (fileName.length > 240) throw new Error('Backup file name is too long');
  if (/[\\/\0\r\n]/.test(fileName)) throw new Error('Backup file name must not contain a path');
  if (path.extname(fileName).toLowerCase() !== '.pfcbackup') throw new Error('Choose a .pfcbackup file');
  return fileName;
}

export async function stageRestoreUploadRequest(readable, rawFileName, { maxBytes = MAX_RESTORE_UPLOAD_BYTES } = {}) {
  const fileName = validateBackupUploadFilename(rawFileName);
  const declaredLength = Number(readable.headers?.['content-length'] || 0);
  if (declaredLength && declaredLength > maxBytes) throw new Error('Backup file exceeds the supported restore size limit');

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-restore-inspect-'));
  const filePath = path.join(directory, fileName);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(new Error('Backup file exceeds the supported restore size limit'));
      else callback(null, chunk);
    }
  });

  try {
    await pipeline(readable, limiter, createWriteStream(filePath, { flags:'wx', mode:0o600 }));
    if (!bytes) throw new Error('Uploaded backup file is empty');
    return {
      fileName,
      filePath,
      size:bytes,
      async cleanup() {
        await fs.rm(directory, { recursive:true, force:true });
      }
    };
  } catch (error) {
    await fs.rm(directory, { recursive:true, force:true }).catch(() => {});
    throw error;
  }
}
