import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBackupInDirectory } from './backup-service.js';
import { loadBackupSettings, saveBackupSettings } from './backup-settings-store.js';
import { BackupOperationLock } from './backup-operation-lock.js';

const DEFAULT_DOWNLOAD_TTL_MS = 15 * 60 * 1000;

function backupBusyError() {
  const error = new Error('A backup is already being created');
  error.statusCode = 409;
  return error;
}

export class ManualBackupManager {
  constructor({
    dataDir,
    applicationDir,
    licensePath,
    controllerVersion = 'unknown',
    downloadTtlMs = DEFAULT_DOWNLOAD_TTL_MS,
    operationLock = null,
    googleDriveClient = null,
    s3Client = null
  } = {}) {
    if (!dataDir) throw new Error('Manual backup manager requires a data directory');
    this.dataDir = path.resolve(dataDir);
    this.applicationDir = applicationDir ? path.resolve(applicationDir) : path.dirname(this.dataDir);
    this.licensePath = licensePath ? path.resolve(licensePath) : path.join(this.dataDir, 'license.json');
    this.controllerVersion = String(controllerVersion || 'unknown');
    this.downloadTtlMs = Math.max(60_000, Number(downloadTtlMs) || DEFAULT_DOWNLOAD_TTL_MS);
    this.operationLock = operationLock || new BackupOperationLock();
    this.googleDriveClient = googleDriveClient || null;
    this.s3Client = s3Client || null;
    this.stagingRoot = path.join(this.dataDir, '.backup-staging');
    this.stagingDir = path.join(this.stagingRoot, 'manual');
    this.downloads = new Map();
    this.creating = false;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await fs.mkdir(this.stagingDir, { recursive:true, mode:0o700 });
    const entries = await fs.readdir(this.stagingDir, { withFileTypes:true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      await fs.rm(path.join(this.stagingDir, entry.name), { force:true }).catch(() => {});
    }

    // v0.32 and earlier manual downloads were staged directly under
    // .backup-staging. Remove only legacy files at that root; never recurse
    // into the scheduled/manual subdirectories used by current builds.
    const legacyEntries = await fs.readdir(this.stagingRoot, { withFileTypes:true }).catch(() => []);
    for (const entry of legacyEntries) {
      if (!entry.isFile()) continue;
      await fs.rm(path.join(this.stagingRoot, entry.name), { force:true }).catch(() => {});
    }
    this.initialized = true;
  }

  async cleanupExpired(nowMs = Date.now()) {
    for (const [id, item] of this.downloads) {
      if (item.expiresAtMs > nowMs) continue;
      this.downloads.delete(id);
      await fs.rm(item.filePath, { force:true }).catch(() => {});
    }
  }

  async status() {
    await this.init();
    await this.cleanupExpired();
    const settings = await loadBackupSettings({ dataDir:this.dataDir, create:true });
    return {
      manualBackupInProgress:this.creating,
      lastSuccessfulBackup:settings.lastSuccessfulBackup || null,
      lastAttemptedBackup:settings.lastAttemptedBackup || null,
      lastError:settings.lastError || null,
      schedule:{
        enabled:settings.enabled === true,
        destination:settings.destination || null,
        frequency:settings.frequency || 'daily',
        retentionCount:settings.retentionCount
      },
      pendingDownloads:this.downloads.size
    };
  }

  async create() {
    await this.init();
    if (this.creating) throw backupBusyError();

    return this.operationLock.run('manual', async () => {
      this.creating = true;
      const attemptedAt = new Date().toISOString();
      let settings = await loadBackupSettings({ dataDir:this.dataDir, create:true });
      settings = await saveBackupSettings({
        ...settings,
        lastAttemptedBackup:attemptedAt,
        lastError:null
      }, { dataDir:this.dataDir });

      try {
        await this.cleanupExpired();
        const result = await createBackupInDirectory({
          destinationDir:this.stagingDir,
          dataDir:this.dataDir,
          applicationDir:this.applicationDir,
          licensePath:this.licensePath,
          controllerVersion:this.controllerVersion,
          source:'manual'
        });
        const id = crypto.randomUUID();
        const expiresAtMs = Date.now() + this.downloadTtlMs;
        const item = {
          id,
          filePath:result.filePath,
          fileName:result.fileName,
          size:result.size,
          manifest:result.manifest,
          expiresAtMs
        };
        this.downloads.set(id, item);
        await saveBackupSettings({
          ...settings,
          lastSuccessfulBackup:{
            createdAt:result.manifest.createdAt,
            fileName:result.fileName,
            size:result.size,
            source:'manual'
          },
          lastError:null
        }, { dataDir:this.dataDir });
        return this.publicDownload(item);
      } catch (error) {
        await saveBackupSettings({
          ...settings,
          lastError:error?.message || String(error)
        }, { dataDir:this.dataDir }).catch(() => {});
        throw error;
      } finally {
        this.creating = false;
      }
    });
  }

  publicDownload(item) {
    return {
      id:item.id,
      fileName:item.fileName,
      size:item.size,
      manifest:item.manifest,
      expiresAt:new Date(item.expiresAtMs).toISOString(),
      downloadUrl:`/api/backup/download/${encodeURIComponent(item.id)}`
    };
  }

  async createGoogleDrive() {
    await this.init();
    if (!this.googleDriveClient) {
      const error = new Error('Google Drive backup support is unavailable');
      error.statusCode = 503;
      throw error;
    }
    if (this.creating) throw backupBusyError();

    return this.operationLock.run('manual-google-drive', async () => {
      this.creating = true;
      const attemptedAt = new Date().toISOString();
      let settings = await loadBackupSettings({ dataDir:this.dataDir, create:true });
      settings = await saveBackupSettings({
        ...settings,
        lastAttemptedBackup:attemptedAt,
        lastError:null
      }, { dataDir:this.dataDir });

      let result = null;
      try {
        await this.cleanupExpired();
        await this.googleDriveClient.testConnection();
        result = await createBackupInDirectory({
          destinationDir:this.stagingDir,
          dataDir:this.dataDir,
          applicationDir:this.applicationDir,
          licensePath:this.licensePath,
          controllerVersion:this.controllerVersion,
          source:'manual'
        });
        const uploaded = await this.googleDriveClient.uploadBackup({
          filePath:result.filePath,
          fileName:result.fileName,
          manifest:result.manifest
        });
        const success = {
          createdAt:result.manifest.createdAt,
          fileName:result.fileName,
          size:result.size,
          source:'manual',
          destinationType:'google-drive',
          destination:uploaded.folderName || 'Google Drive',
          driveFileId:uploaded.id || null
        };
        await saveBackupSettings({
          ...settings,
          lastSuccessfulBackup:success,
          lastError:null
        }, { dataDir:this.dataDir });
        return {
          fileName:result.fileName,
          size:result.size,
          manifest:result.manifest,
          destinationType:'google-drive',
          folderName:uploaded.folderName || null,
          driveFileId:uploaded.id || null
        };
      } catch (error) {
        await saveBackupSettings({
          ...settings,
          lastError:error?.message || String(error)
        }, { dataDir:this.dataDir }).catch(() => {});
        throw error;
      } finally {
        if (result?.filePath) await fs.rm(result.filePath, { force:true }).catch(() => {});
        this.creating = false;
      }
    });
  }


  async createS3() {
    await this.init();
    if (!this.s3Client) {
      const error = new Error('S3-compatible backup support is unavailable');
      error.statusCode = 503;
      throw error;
    }
    if (this.creating) throw backupBusyError();

    return this.operationLock.run('manual-s3', async () => {
      this.creating = true;
      const attemptedAt = new Date().toISOString();
      let settings = await loadBackupSettings({ dataDir:this.dataDir, create:true });
      settings = await saveBackupSettings({
        ...settings,
        lastAttemptedBackup:attemptedAt,
        lastError:null
      }, { dataDir:this.dataDir });

      let result = null;
      try {
        await this.cleanupExpired();
        const connection = await this.s3Client.testConnection();
        result = await createBackupInDirectory({
          destinationDir:this.stagingDir,
          dataDir:this.dataDir,
          applicationDir:this.applicationDir,
          licensePath:this.licensePath,
          controllerVersion:this.controllerVersion,
          source:'manual'
        });
        const uploaded = await this.s3Client.uploadBackup({
          filePath:result.filePath,
          fileName:result.fileName,
          manifest:result.manifest
        });
        const success = {
          createdAt:result.manifest.createdAt,
          fileName:result.fileName,
          size:result.size,
          source:'manual',
          destinationType:'s3',
          destination:`${connection.bucket}/${connection.prefix}`,
          s3ObjectKey:uploaded.key || uploaded.id || null
        };
        await saveBackupSettings({
          ...settings,
          lastSuccessfulBackup:success,
          lastError:null
        }, { dataDir:this.dataDir });
        return {
          fileName:result.fileName,
          size:result.size,
          manifest:result.manifest,
          destinationType:'s3',
          bucket:connection.bucket,
          prefix:connection.prefix,
          s3ObjectKey:uploaded.key || uploaded.id || null
        };
      } catch (error) {
        await saveBackupSettings({
          ...settings,
          lastError:error?.message || String(error)
        }, { dataDir:this.dataDir }).catch(() => {});
        throw error;
      } finally {
        if (result?.filePath) await fs.rm(result.filePath, { force:true }).catch(() => {});
        this.creating = false;
      }
    });
  }

  async get(id) {
    await this.cleanupExpired();
    return this.downloads.get(String(id || '')) || null;
  }

  async stream(id, response) {
    const item = await this.get(id);
    if (!item) {
      const error = new Error('Backup download is unavailable or has expired');
      error.statusCode = 404;
      throw error;
    }
    response.writeHead(200, {
      'content-type':'application/vnd.print-farm-controller.backup+zip',
      'content-length':item.size,
      'content-disposition':`attachment; filename="${item.fileName.replace(/["\\\r\n]/g, '_')}"`,
      'cache-control':'no-store'
    });
    try {
      await pipeline(createReadStream(item.filePath), response);
      this.downloads.delete(item.id);
      await fs.rm(item.filePath, { force:true }).catch(() => {});
      return true;
    } catch (error) {
      // Keep the verified staging copy until its expiry so a failed/cancelled
      // download can be retried without rebuilding the backup.
      throw error;
    }
  }
}

export { DEFAULT_DOWNLOAD_TTL_MS };
