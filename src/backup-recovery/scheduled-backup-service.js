import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBackupInDirectory } from './backup-service.js';
import { inspectZipArchive } from './backup-archive.js';
import { BACKUP_FORMAT_ID, BACKUP_FORMAT_VERSION } from './backup-format.js';
import { loadBackupSettings, saveBackupSettings } from './backup-settings-store.js';
import { BackupOperationLock } from './backup-operation-lock.js';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function scheduleParts(value) {
  const match = String(value || '02:00').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? { hour:Number(match[1]), minute:Number(match[2]) } : { hour:2, minute:0 };
}

export function nextScheduledBackupAt(settings, from = new Date()) {
  if (!settings?.enabled) return null;
  const { hour, minute } = scheduleParts(settings.scheduleTime);
  const candidate = new Date(from.getTime());
  candidate.setHours(hour, minute, 0, 0);

  if (settings.frequency === 'weekly') {
    const target = Number.isInteger(Number(settings.scheduleWeekday))
      ? Number(settings.scheduleWeekday)
      : 1;
    let days = (target - candidate.getDay() + 7) % 7;
    if (days === 0 && candidate.getTime() <= from.getTime()) days = 7;
    candidate.setDate(candidate.getDate() + days);
  } else if (candidate.getTime() <= from.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

export async function validateBackupDestination(destination) {
  const target = String(destination || '').trim();
  if (!target) throw new Error('Scheduled backup destination is required');

  let stat;
  try {
    stat = await fs.stat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Scheduled backup destination does not exist');
    throw new Error(`Scheduled backup destination is unavailable: ${error.message}`);
  }
  if (!stat.isDirectory()) throw new Error('Scheduled backup destination must be a directory');

  const probe = path.join(target, `.pfc-backup-write-test-${crypto.randomUUID()}.tmp`);
  let handle = null;
  try {
    handle = await fs.open(probe, 'wx', 0o600);
    await handle.writeFile('Print Farm Controller backup write test\n');
    await handle.sync();
  } catch (error) {
    throw new Error(`Scheduled backup destination is not writable: ${error.message}`);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(probe, { force:true }).catch(() => {});
  }
  return { destination:target, writable:true };
}

async function scheduledManifest(filePath) {
  try {
    const archive = await inspectZipArchive(filePath);
    const entry = archive.byName.get('manifest.json');
    if (!entry || entry.size > MAX_MANIFEST_BYTES) return null;
    const manifest = JSON.parse((await archive.read('manifest.json', { maxBytes:MAX_MANIFEST_BYTES })).toString('utf8'));
    if (manifest?.format !== BACKUP_FORMAT_ID || manifest?.formatVersion !== BACKUP_FORMAT_VERSION) return null;
    return manifest;
  } catch {
    return null;
  }
}

export async function pruneScheduledBackups({
  destination,
  installationId,
  retentionCount,
  newestBackupPath = null
} = {}) {
  const keep = Math.max(1, Math.min(365, Number(retentionCount) || 14));
  const directory = String(destination || '').trim();
  if (!directory || !installationId) return { deleted:[], failed:[], eligible:0, kept:0 };

  const entries = await fs.readdir(directory, { withFileTypes:true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.pfcbackup') continue;
    const filePath = path.join(directory, entry.name);
    const manifest = await scheduledManifest(filePath);
    if (!manifest
      || manifest.backupSource !== 'scheduled'
      || String(manifest.installationId || '').toLowerCase() !== String(installationId).toLowerCase()) {
      continue;
    }
    const createdMs = new Date(manifest.createdAt || 0).getTime();
    if (!Number.isFinite(createdMs)) continue;
    candidates.push({ filePath, fileName:entry.name, createdMs });
  }

  candidates.sort((left, right) => right.createdMs - left.createdMs || right.fileName.localeCompare(left.fileName));
  const protectedPath = newestBackupPath ? path.resolve(newestBackupPath) : null;
  const keepPaths = new Set(candidates.slice(0, keep).map((item) => path.resolve(item.filePath)));
  if (protectedPath) keepPaths.add(protectedPath);

  const deleted = [];
  const failed = [];
  for (const candidate of candidates) {
    if (keepPaths.has(path.resolve(candidate.filePath))) continue;
    try {
      await fs.rm(candidate.filePath);
      deleted.push(candidate.fileName);
    } catch (error) {
      failed.push({ fileName:candidate.fileName, error:error?.message || String(error) });
    }
  }
  return {
    deleted,
    failed,
    eligible:candidates.length,
    kept:Math.max(0, candidates.length - deleted.length)
  };
}

export class ScheduledBackupService {
  constructor({
    dataDir,
    applicationDir,
    licensePath,
    controllerVersion = 'unknown',
    operationLock = null,
    diagnosticFn = null,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = {}) {
    if (!dataDir) throw new Error('Scheduled backup service requires a data directory');
    this.dataDir = path.resolve(dataDir);
    this.applicationDir = applicationDir ? path.resolve(applicationDir) : path.dirname(this.dataDir);
    this.licensePath = licensePath ? path.resolve(licensePath) : path.join(this.dataDir, 'license.json');
    this.controllerVersion = String(controllerVersion || 'unknown');
    this.operationLock = operationLock || new BackupOperationLock();
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : null;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timer = null;
    this.nextRunAt = null;
    this.running = false;
    this.started = false;
  }

  async log(level, message, meta = {}) {
    try { await this.diagnostic?.(level, message, meta); } catch {}
  }

  async start() {
    if (this.started) return this.status();
    this.started = true;
    await this.arm();
    return this.status();
  }

  stop() {
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timer = null;
    this.nextRunAt = null;
    this.started = false;
  }

  async arm(from = new Date()) {
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timer = null;
    this.nextRunAt = null;
    const settings = await loadBackupSettings({ dataDir:this.dataDir, create:true });
    const next = nextScheduledBackupAt(settings, from);
    if (!next) return null;
    this.nextRunAt = next.toISOString();
    const delay = Math.max(1_000, next.getTime() - from.getTime());
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.nextRunAt = null;
      this.runScheduledBackup().catch(() => {});
    }, delay);
    this.timer?.unref?.();
    return next;
  }

  async status() {
    const settings = await loadBackupSettings({ dataDir:this.dataDir, create:true });
    if (settings.enabled && !this.nextRunAt && !this.running) {
      const next = nextScheduledBackupAt(settings, new Date());
      this.nextRunAt = next?.toISOString() || null;
    }
    return {
      enabled:settings.enabled === true,
      destination:settings.destination || null,
      frequency:settings.frequency,
      scheduleTime:settings.scheduleTime,
      scheduleWeekday:settings.scheduleWeekday,
      scheduleWeekdayName:WEEKDAY_NAMES[settings.scheduleWeekday] || WEEKDAY_NAMES[1],
      retentionCount:settings.retentionCount,
      nextRunAt:this.nextRunAt,
      running:this.running,
      lastAttemptAt:settings.lastScheduledAttemptAt || null,
      lastSuccess:settings.lastScheduledSuccess || null,
      lastError:settings.lastScheduledError || null,
      lastRetentionResult:settings.lastRetentionResult || null
    };
  }

  async updateSettings(input = {}) {
    const current = await loadBackupSettings({ dataDir:this.dataDir, create:true });
    const requested = {
      ...current,
      enabled:input.enabled === true,
      destination:String(input.destination ?? current.destination ?? '').trim() || null,
      frequency:['daily','weekly'].includes(String(input.frequency || '').toLowerCase())
        ? String(input.frequency).toLowerCase()
        : current.frequency,
      scheduleTime:input.scheduleTime ?? current.scheduleTime,
      scheduleWeekday:input.scheduleWeekday ?? current.scheduleWeekday,
      retentionCount:input.retentionCount ?? current.retentionCount
    };
    if (requested.enabled) await validateBackupDestination(requested.destination);
    const saved = await saveBackupSettings(requested, { dataDir:this.dataDir });
    await this.arm();
    await this.log('info', saved.enabled ? 'Scheduled backups enabled or updated' : 'Scheduled backups disabled', {
      destination:saved.destination || null,
      frequency:saved.frequency,
      scheduleTime:saved.scheduleTime,
      scheduleWeekday:saved.scheduleWeekday,
      retentionCount:saved.retentionCount
    });
    return this.status();
  }

  async testDestination(destination) {
    const result = await validateBackupDestination(destination);
    await this.log('info', 'Scheduled backup destination write test passed', {
      destination:result.destination
    });
    return result;
  }

  async runScheduledBackup({ now = new Date() } = {}) {
    const settings = await loadBackupSettings({ dataDir:this.dataDir, create:true });
    if (!settings.enabled) {
      await this.arm(now);
      return { skipped:true, reason:'disabled' };
    }

    this.running = true;
    this.nextRunAt = null;
    const attemptedAt = now.toISOString();
    let updated = await saveBackupSettings({
      ...settings,
      lastAttemptedBackup:attemptedAt,
      lastScheduledAttemptAt:attemptedAt,
      lastScheduledError:null
    }, { dataDir:this.dataDir });

    try {
      const result = await this.operationLock.run('scheduled', async () => {
        await validateBackupDestination(updated.destination);
        await this.log('info', 'Scheduled backup started', {
          destination:updated.destination,
          attemptedAt
        });
        return createBackupInDirectory({
          destinationDir:updated.destination,
          dataDir:this.dataDir,
          applicationDir:this.applicationDir,
          licensePath:this.licensePath,
          controllerVersion:this.controllerVersion,
          source:'scheduled',
          now
        });
      });

      const success = {
        createdAt:result.manifest.createdAt,
        fileName:result.fileName,
        size:result.size,
        source:'scheduled',
        destination:updated.destination
      };
      updated = await saveBackupSettings({
        ...updated,
        lastSuccessfulBackup:success,
        lastScheduledSuccess:success,
        lastScheduledError:null,
        lastError:null
      }, { dataDir:this.dataDir });

      let retention;
      try {
        retention = await pruneScheduledBackups({
          destination:updated.destination,
          installationId:updated.installationId,
          retentionCount:updated.retentionCount,
          newestBackupPath:result.filePath
        });
        const retentionResult = {
          completedAt:new Date().toISOString(),
          deleted:retention.deleted.length,
          failed:retention.failed.length,
          eligible:retention.eligible,
          kept:retention.kept,
          failures:retention.failed
        };
        updated = await saveBackupSettings({
          ...updated,
          lastRetentionResult:retentionResult
        }, { dataDir:this.dataDir });
        await this.log(retention.failed.length ? 'warn' : 'info', 'Scheduled backup retention completed', retentionResult);
      } catch (error) {
        const retentionResult = {
          completedAt:new Date().toISOString(),
          deleted:0,
          failed:1,
          eligible:null,
          kept:null,
          failures:[{ fileName:null, error:error?.message || String(error) }]
        };
        await saveBackupSettings({ ...updated, lastRetentionResult:retentionResult }, { dataDir:this.dataDir }).catch(() => {});
        await this.log('warn', 'Scheduled backup retention failed after successful backup', {
          error:error?.message || String(error)
        });
      }

      await this.log('info', 'Scheduled backup created and verified', {
        fileName:result.fileName,
        size:result.size,
        createdAt:result.manifest.createdAt,
        destination:updated.destination
      });
      return { success:true, backup:success };
    } catch (error) {
      const message = error?.message || String(error);
      await saveBackupSettings({
        ...updated,
        lastScheduledError:message,
        lastError:message
      }, { dataDir:this.dataDir }).catch(() => {});
      await this.log('warn', 'Scheduled backup failed', {
        destination:updated.destination,
        error:message
      });
      return { success:false, error:message };
    } finally {
      this.running = false;
      await this.arm(new Date(Math.max(Date.now(), now.getTime() + 1000))).catch(() => {});
    }
  }
}

export { WEEKDAY_NAMES };
