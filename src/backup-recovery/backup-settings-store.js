import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveControllerRuntimePaths } from '../runtime-paths.js';

export const DEFAULT_BACKUP_RETENTION = 14;

export function backupSettingsPath(dataDir = resolveControllerRuntimePaths().dataDir) {
  return path.join(path.resolve(dataDir), 'backup-settings.json');
}

export function normalizeBackupSettings(value = {}) {
  const installationId = String(value.installationId || '').trim();
  const validInstallationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)
    ? installationId.toLowerCase()
    : crypto.randomUUID();
  const retention = Number(value.retentionCount);
  return {
    installationId:validInstallationId,
    enabled:value.enabled === true,
    destination:String(value.destination || '').trim() || null,
    frequency:['daily','weekly'].includes(String(value.frequency || '').trim().toLowerCase())
      ? String(value.frequency).trim().toLowerCase()
      : 'daily',
    retentionCount:Number.isInteger(retention) && retention >= 1 && retention <= 365
      ? retention
      : DEFAULT_BACKUP_RETENTION,
    lastSuccessfulBackup:value.lastSuccessfulBackup || null,
    lastAttemptedBackup:value.lastAttemptedBackup || null,
    lastError:value.lastError ? String(value.lastError) : null
  };
}

export async function loadBackupSettings({ dataDir = resolveControllerRuntimePaths().dataDir, create = true } = {}) {
  const filePath = backupSettingsPath(dataDir);
  let parsed = {};
  let existed = true;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    existed = false;
  }
  const normalized = normalizeBackupSettings(parsed);
  if (create && (!existed || JSON.stringify(parsed) !== JSON.stringify(normalized))) {
    await saveBackupSettings(normalized, { dataDir });
  }
  return normalized;
}

export async function saveBackupSettings(settings, { dataDir = resolveControllerRuntimePaths().dataDir } = {}) {
  const normalized = normalizeBackupSettings(settings);
  const filePath = backupSettingsPath(dataDir);
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive:true, mode:0o700 });
  try {
    await fs.writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, { mode:0o600 });
    await fs.rename(temp, filePath);
  } finally {
    await fs.rm(temp, { force:true }).catch(() => {});
  }
  return normalized;
}
