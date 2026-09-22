import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { getAsset, isSea } from 'node:sea';

export const runtimeAssetKeys = Object.freeze({
  trustedPublicKeys:'licensing/trusted-public-keys.json',
  emulatorTestFrame:'emulator/assets/test-frame.jpg',
  emulatorBambuKey:'emulator/assets/bambu-simulator-key.pem',
  emulatorBambuCert:'emulator/assets/bambu-simulator-cert.pem'
});

export function publicAssetKey(relativePath) {
  return path.posix.join('public', String(relativePath || '').replaceAll('\\', '/'));
}

export function emulatorPublicAssetKey(relativePath) {
  return path.posix.join('emulator/public', String(relativePath || '').replaceAll('\\', '/'));
}

export async function readRuntimeAsset({ key, filePath = null } = {}) {
  if (!key) throw new Error('Runtime asset key is required');
  if (isSea()) return Buffer.from(getAsset(key));
  if (!filePath) throw new Error(`Source path is required for runtime asset ${key}`);
  return fs.readFile(filePath);
}

export function readRuntimeAssetSync({ key, filePath = null } = {}) {
  if (!key) throw new Error('Runtime asset key is required');
  if (isSea()) return Buffer.from(getAsset(key));
  if (!filePath) throw new Error(`Source path is required for runtime asset ${key}`);
  return readFileSync(filePath);
}

export async function readRuntimeTextAsset({ key, filePath = null, encoding = 'utf8' } = {}) {
  if (!key) throw new Error('Runtime asset key is required');
  if (isSea()) return getAsset(key, encoding);
  if (!filePath) throw new Error(`Source path is required for runtime asset ${key}`);
  return fs.readFile(filePath, encoding);
}
