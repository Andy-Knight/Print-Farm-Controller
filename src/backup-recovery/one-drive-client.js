import crypto from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const ONEDRIVE_SCOPE = 'offline_access Files.ReadWrite.AppFolder';
export const ONEDRIVE_TENANT = 'common';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const LOGIN_BASE = 'https://login.microsoftonline.com';
const BACKUP_MIME = 'application/vnd.print-farm-controller.backup+zip';
const METADATA_SUFFIX = '.pfcmeta.json';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024; // 10 MiB = 32 * 320 KiB

function oneDriveError(message, statusCode = 502, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function cleanString(value) {
  return String(value || '').trim();
}

function safeBackupFileName(value) {
  const fileName = cleanString(value);
  if (!fileName || fileName.length > 240 || /[\\/\0\r\n]/.test(fileName) || !/\.pfcbackup$/i.test(fileName)) {
    throw oneDriveError('OneDrive backup has an invalid file name.', 400, 'ONEDRIVE_BACKUP_INVALID_NAME');
  }
  return fileName;
}

function graphPathName(value) {
  return encodeURIComponent(String(value || ''));
}

function metadataFileName(fileName) {
  return `${safeBackupFileName(fileName)}${METADATA_SUFFIX}`;
}

function readableStreamToNode(stream) {
  return Readable.fromWeb(stream);
}

async function responsePayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw:text }; }
}

function responseMessage(payload, fallback) {
  return cleanString(payload?.error_description)
    || cleanString(payload?.error?.message)
    || cleanString(payload?.error)
    || cleanString(payload?.raw)
    || fallback;
}

function tokenEndpoint(tenant) {
  return `${LOGIN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

function deviceCodeEndpoint(tenant) {
  return `${LOGIN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/devicecode`;
}

export class OneDriveClient {
  constructor({
    dataDir,
    clientId = process.env.ONEDRIVE_CLIENT_ID || process.env.MICROSOFT_ONEDRIVE_CLIENT_ID,
    builtInClientId = '',
    tenant = ONEDRIVE_TENANT,
    fetchFn = globalThis.fetch,
    nowFn = Date.now,
    diagnosticFn = null
  } = {}) {
    if (!dataDir) throw new Error('OneDrive client requires a data directory');
    if (typeof fetchFn !== 'function') throw new Error('OneDrive client requires fetch support');
    this.dataDir = path.resolve(dataDir);
    this.environmentClientId = cleanString(clientId);
    this.builtInClientId = cleanString(builtInClientId);
    this.tenant = cleanString(tenant) || ONEDRIVE_TENANT;
    this.fetchFn = fetchFn;
    this.nowFn = typeof nowFn === 'function' ? nowFn : Date.now;
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : null;
    this.integrationDir = path.join(this.dataDir, 'integrations');
    this.statePath = path.join(this.integrationDir, 'one-drive.json');
    this.pendingAuthorization = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.reconnectRequired = false;
    this.lastError = null;
  }

  async log(level, message, meta = {}) {
    try { await this.diagnostic?.(level, message, meta); } catch {}
  }

  credentialsForState(state) {
    const savedClientId = cleanString(state?.clientId);
    if (savedClientId) return { clientId:savedClientId, source:'ui' };
    if (this.environmentClientId) return { clientId:this.environmentClientId, source:'environment' };
    if (this.builtInClientId) return { clientId:this.builtInClientId, source:'built-in' };
    return { clientId:'', source:'none' };
  }

  async requireConfigured(state = null) {
    const loaded = state || await this.loadState();
    const credentials = this.credentialsForState(loaded);
    if (credentials.clientId) return { state:loaded, ...credentials };
    throw oneDriveError(
      'OneDrive is not configured. Enter a Microsoft application client ID in Backup & recovery.',
      503,
      'ONEDRIVE_NOT_CONFIGURED'
    );
  }

  async loadState() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (!parsed || parsed.version !== 1) return null;
      return {
        version:1,
        clientId:cleanString(parsed.clientId) || null,
        refreshToken:cleanString(parsed.refreshToken) || null,
        folderId:cleanString(parsed.folderId) || null,
        folderName:cleanString(parsed.folderName) || null,
        connectedAt:cleanString(parsed.connectedAt) || null
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async saveState(state) {
    await fs.mkdir(this.integrationDir, { recursive:true, mode:0o700 });
    const tempPath = `${this.statePath}.${crypto.randomUUID()}.tmp`;
    const value = {
      version:1,
      clientId:cleanString(state?.clientId) || null,
      refreshToken:cleanString(state?.refreshToken) || null,
      folderId:cleanString(state?.folderId) || null,
      folderName:cleanString(state?.folderName) || null,
      connectedAt:cleanString(state?.connectedAt) || null
    };
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode:0o600 });
      await fs.rename(tempPath, this.statePath);
    } finally {
      await fs.rm(tempPath, { force:true }).catch(() => {});
    }
    return value;
  }

  async status() {
    const state = await this.loadState();
    const pending = this.pendingAuthorization;
    const credentials = this.credentialsForState(state);
    const configured = Boolean(credentials.clientId);
    const customConfigured = Boolean(cleanString(state?.clientId));
    const environmentConfigured = Boolean(this.environmentClientId);
    const builtInConfigured = Boolean(this.builtInClientId);
    return {
      configured,
      configurationSource:credentials.source,
      customConfigured,
      customClientId:customConfigured ? cleanString(state?.clientId) : null,
      clientId:customConfigured ? cleanString(state?.clientId) : null,
      environmentConfigured,
      builtInConfigured,
      defaultConfigurationAvailable:environmentConfigured || builtInConfigured,
      connected:configured && Boolean(state?.refreshToken) && !this.reconnectRequired && !pending,
      reconnectRequired:this.reconnectRequired,
      folderId:state?.folderId || null,
      folderName:state?.folderName || null,
      authorizationPending:Boolean(pending),
      verificationUrl:pending?.verificationUrl || null,
      userCode:pending?.userCode || null,
      authorizationExpiresAt:pending?.expiresAtMs ? new Date(pending.expiresAtMs).toISOString() : null,
      pollIntervalSeconds:pending?.intervalSeconds || null,
      lastError:this.lastError || null
    };
  }

  async configure({ clientId } = {}) {
    const current = await this.loadState();
    const currentCredentials = this.credentialsForState(current);
    const nextClientId = cleanString(clientId);
    if (!nextClientId) {
      throw oneDriveError('Microsoft application client ID is required.', 400, 'ONEDRIVE_CLIENT_ID_REQUIRED');
    }
    if (nextClientId.length > 512) {
      throw oneDriveError('Microsoft application client ID is too long.', 400, 'ONEDRIVE_CLIENT_ID_INVALID');
    }

    const changed = nextClientId !== currentCredentials.clientId;
    this.pendingAuthorization = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.reconnectRequired = false;
    this.lastError = null;

    await this.saveState({
      ...current,
      clientId:nextClientId,
      refreshToken:changed ? null : current?.refreshToken,
      folderId:changed ? null : current?.folderId,
      folderName:changed ? null : current?.folderName,
      connectedAt:changed ? null : current?.connectedAt
    });
    await this.log('info', changed ? 'OneDrive OAuth configuration updated' : 'OneDrive OAuth configuration saved');
    return this.status();
  }

  async startDeviceAuthorization() {
    const credentials = await this.requireConfigured();
    const response = await this.fetchFn(deviceCodeEndpoint(this.tenant), {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        client_id:credentials.clientId,
        scope:ONEDRIVE_SCOPE
      })
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw oneDriveError(`Microsoft authorization could not be started: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    }

    const deviceCode = cleanString(payload.device_code);
    const userCode = cleanString(payload.user_code);
    const verificationUrl = cleanString(payload.verification_uri || payload.verification_url);
    const expiresIn = Math.max(60, Number(payload.expires_in) || 900);
    const intervalSeconds = Math.max(5, Number(payload.interval) || 5);
    if (!deviceCode || !userCode || !verificationUrl) {
      throw oneDriveError('Microsoft authorization returned an incomplete device-code response', 502);
    }

    const now = this.nowFn();
    this.pendingAuthorization = {
      deviceCode,
      userCode,
      verificationUrl,
      clientId:credentials.clientId,
      expiresAtMs:now + (expiresIn * 1000),
      intervalSeconds,
      nextPollAtMs:now
    };
    this.lastError = null;
    await this.log('info', 'OneDrive authorization started');
    return this.status();
  }

  async pollDeviceAuthorization() {
    const pending = this.pendingAuthorization;
    if (!pending) return this.status();

    const now = this.nowFn();
    if (now >= pending.expiresAtMs) {
      this.pendingAuthorization = null;
      this.lastError = 'Microsoft authorization expired before it was completed.';
      return this.status();
    }
    if (now < pending.nextPollAtMs) return this.status();

    pending.nextPollAtMs = now + (pending.intervalSeconds * 1000);
    const response = await this.fetchFn(tokenEndpoint(this.tenant), {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        client_id:pending.clientId,
        device_code:pending.deviceCode,
        grant_type:'urn:ietf:params:oauth:grant-type:device_code'
      })
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      const code = cleanString(payload.error);
      if (code === 'authorization_pending') return this.status();
      if (code === 'slow_down') {
        pending.intervalSeconds += 5;
        return this.status();
      }
      if (code === 'authorization_declined' || code === 'access_denied' || code === 'expired_token') {
        this.pendingAuthorization = null;
        this.lastError = code === 'expired_token'
          ? 'Microsoft authorization expired before it was completed.'
          : 'OneDrive access was not granted.';
        return this.status();
      }
      throw oneDriveError(`Microsoft authorization failed: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    }

    const refreshToken = cleanString(payload.refresh_token);
    const accessToken = cleanString(payload.access_token);
    if (!refreshToken || !accessToken) {
      throw oneDriveError('Microsoft authorization did not return the required tokens', 502);
    }

    const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
    this.accessToken = accessToken;
    this.accessTokenExpiresAtMs = now + (expiresIn * 1000);
    this.pendingAuthorization = null;
    this.reconnectRequired = false;
    this.lastError = null;

    const state = await this.loadState();
    await this.saveState({
      ...state,
      refreshToken,
      folderId:null,
      folderName:null,
      connectedAt:new Date(now).toISOString()
    });
    await this.ensureBackupFolder();
    await this.log('info', 'OneDrive connected');
    return this.status();
  }

  async getAccessToken() {
    const now = this.nowFn();
    if (this.accessToken && this.accessTokenExpiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now) return this.accessToken;

    const state = await this.loadState();
    const credentials = await this.requireConfigured(state);
    if (!state?.refreshToken) {
      throw oneDriveError('OneDrive is not connected.', 409, 'ONEDRIVE_NOT_CONNECTED');
    }

    const response = await this.fetchFn(tokenEndpoint(this.tenant), {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        client_id:credentials.clientId,
        refresh_token:state.refreshToken,
        grant_type:'refresh_token',
        scope:ONEDRIVE_SCOPE
      })
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      const code = cleanString(payload.error);
      if (code === 'invalid_grant' || code === 'invalid_client' || response.status === 401) {
        this.accessToken = null;
        this.accessTokenExpiresAtMs = 0;
        this.reconnectRequired = true;
        this.lastError = 'OneDrive authorization is no longer valid. Reconnect OneDrive.';
        throw oneDriveError(this.lastError, 401, 'ONEDRIVE_RECONNECT_REQUIRED');
      }
      throw oneDriveError(`Microsoft access token refresh failed: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    }

    const accessToken = cleanString(payload.access_token);
    if (!accessToken) throw oneDriveError('Microsoft token refresh returned no access token', 502);
    this.accessToken = accessToken;
    this.accessTokenExpiresAtMs = now + (Math.max(60, Number(payload.expires_in) || 3600) * 1000);
    this.reconnectRequired = false;
    this.lastError = null;

    const replacementRefreshToken = cleanString(payload.refresh_token);
    if (replacementRefreshToken && replacementRefreshToken !== state.refreshToken) {
      await this.saveState({ ...state, refreshToken:replacementRefreshToken });
    }
    return accessToken;
  }

  async authorizedFetch(url, options = {}) {
    const token = await this.getAccessToken();
    const headers = new Headers(options.headers || {});
    headers.set('authorization', `Bearer ${token}`);
    return this.fetchFn(url, { ...options, headers });
  }

  async ensureBackupFolder() {
    const state = await this.loadState();
    if (!state?.refreshToken) throw oneDriveError('OneDrive is not connected.', 409, 'ONEDRIVE_NOT_CONNECTED');

    const response = await this.authorizedFetch(`${GRAPH_API}/me/drive/special/approot?$select=id,name,webUrl,folder,specialFolder`);
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw oneDriveError(
        `OneDrive app folder could not be opened: ${responseMessage(payload, `HTTP ${response.status}`)}`,
        response.status === 403 ? 403 : 502,
        'ONEDRIVE_APP_FOLDER_UNAVAILABLE'
      );
    }
    if (!payload?.id || !payload?.folder) {
      throw oneDriveError('Microsoft Graph did not return a valid OneDrive app folder.', 502);
    }

    if (payload.id !== state.folderId || payload.name !== state.folderName) {
      const latestState = await this.loadState();
      await this.saveState({
        ...latestState,
        folderId:String(payload.id),
        folderName:cleanString(payload.name) || 'Print Farm Controller'
      });
    }
    return payload;
  }

  async testConnection() {
    const folder = await this.ensureBackupFolder();
    this.lastError = null;
    return {
      connected:true,
      folderId:String(folder.id),
      folderName:cleanString(folder.name) || 'Print Farm Controller',
      webUrl:cleanString(folder.webUrl) || null
    };
  }

  async createUploadSession(fileName) {
    const safeName = safeBackupFileName(fileName);
    const response = await this.authorizedFetch(
      `${GRAPH_API}/me/drive/special/approot:/${graphPathName(safeName)}:/createUploadSession`,
      {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({
          item:{
            '@microsoft.graph.conflictBehavior':'fail',
            name:safeName
          }
        })
      }
    );
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw oneDriveError(
        `OneDrive upload could not be started: ${responseMessage(payload, `HTTP ${response.status}`)}`,
        response.status === 409 ? 409 : 502,
        'ONEDRIVE_UPLOAD_SESSION_FAILED'
      );
    }
    const uploadUrl = cleanString(payload.uploadUrl);
    if (!uploadUrl) throw oneDriveError('OneDrive upload did not return an upload URL.', 502);
    return uploadUrl;
  }

  async uploadLargeFile(filePath, fileName, size) {
    const uploadUrl = await this.createUploadSession(fileName);
    let offset = 0;
    let finalItem = null;

    while (offset < size) {
      const end = Math.min(size - 1, offset + UPLOAD_CHUNK_BYTES - 1);
      const length = end - offset + 1;
      const response = await this.fetchFn(uploadUrl, {
        method:'PUT',
        headers:{
          'content-length':String(length),
          'content-range':`bytes ${offset}-${end}/${size}`
        },
        body:createReadStream(filePath, { start:offset, end }),
        duplex:'half'
      });
      const payload = await responsePayload(response);
      if (response.status === 202) {
        offset = end + 1;
        continue;
      }
      if (!response.ok) {
        throw oneDriveError(
          `OneDrive backup upload failed: ${responseMessage(payload, `HTTP ${response.status}`)}`,
          502,
          'ONEDRIVE_UPLOAD_FAILED'
        );
      }
      finalItem = payload;
      offset = end + 1;
    }

    if (!finalItem?.id) throw oneDriveError('OneDrive upload completed without file metadata.', 502);
    return finalItem;
  }

  async uploadMetadata(sidecarName, metadata) {
    const response = await this.authorizedFetch(
      `${GRAPH_API}/me/drive/special/approot:/${graphPathName(sidecarName)}:/content`,
      {
        method:'PUT',
        headers:{ 'content-type':'application/json; charset=utf-8' },
        body:Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
      }
    );
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw oneDriveError(
        `OneDrive backup metadata upload failed: ${responseMessage(payload, `HTTP ${response.status}`)}`,
        502,
        'ONEDRIVE_METADATA_UPLOAD_FAILED'
      );
    }
    return payload;
  }

  async uploadBackup({ filePath, fileName, manifest } = {}) {
    if (!filePath || !fileName) throw new Error('OneDrive backup upload requires a file path and name');
    const safeName = safeBackupFileName(fileName);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('OneDrive backup upload source is not a file');
    await this.ensureBackupFolder();

    let uploaded = null;
    let sidecar = null;
    try {
      uploaded = await this.uploadLargeFile(filePath, safeName, stat.size);
      const metadata = {
        version:1,
        pfcBackup:true,
        backupItemId:String(uploaded.id),
        backupFileName:safeName,
        backupId:cleanString(manifest?.backupId),
        installationId:cleanString(manifest?.installationId),
        backupSource:cleanString(manifest?.backupSource),
        createdAt:cleanString(manifest?.createdAt),
        formatVersion:Number(manifest?.formatVersion) || null,
        controllerVersion:cleanString(manifest?.sourceControllerVersion),
        size:stat.size
      };
      sidecar = await this.uploadMetadata(metadataFileName(safeName), metadata);
    } catch (error) {
      if (uploaded?.id) await this.deleteDriveItem(uploaded.id).catch(() => {});
      if (sidecar?.id) await this.deleteDriveItem(sidecar.id).catch(() => {});
      throw error;
    }

    const state = await this.loadState();
    await this.log('info', 'Backup uploaded to OneDrive', {
      fileName:safeName,
      size:stat.size,
      oneDriveFileId:uploaded.id || null
    });
    return {
      id:String(uploaded.id),
      name:uploaded.name || safeName,
      size:Number(uploaded.size || stat.size),
      createdTime:uploaded.createdDateTime || null,
      metadataItemId:sidecar?.id ? String(sidecar.id) : null,
      folderId:state?.folderId || null,
      folderName:state?.folderName || 'Print Farm Controller'
    };
  }

  async listChildren() {
    await this.ensureBackupFolder();
    let next = `${GRAPH_API}/me/drive/special/approot/children?$select=id,name,size,createdDateTime,lastModifiedDateTime,file&$top=200`;
    const items = [];
    while (next) {
      const response = await this.authorizedFetch(next);
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw oneDriveError(
          `OneDrive backup list failed: ${responseMessage(payload, `HTTP ${response.status}`)}`,
          502,
          'ONEDRIVE_LIST_FAILED'
        );
      }
      if (Array.isArray(payload.value)) items.push(...payload.value);
      next = cleanString(payload['@odata.nextLink']) || null;
    }
    return items;
  }

  async readMetadataItem(item) {
    try {
      const response = await this.authorizedFetch(`${GRAPH_API}/me/drive/items/${encodeURIComponent(item.id)}/content`);
      if (!response.ok) return null;
      const payload = await responsePayload(response);
      if (!payload || payload.version !== 1 || payload.pfcBackup !== true) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async listBackups() {
    const children = await this.listChildren();
    const backupItems = new Map(
      children
        .filter((item) => item?.file && /\.pfcbackup$/i.test(String(item.name || '')))
        .map((item) => [String(item.id), item])
    );
    const sidecars = children.filter((item) => item?.file && String(item.name || '').endsWith(METADATA_SUFFIX));
    const result = [];

    for (const sidecar of sidecars) {
      const metadata = await this.readMetadataItem(sidecar);
      const backupId = cleanString(metadata?.backupItemId);
      const backup = backupItems.get(backupId);
      if (!backup || !metadata) continue;
      try {
        if (safeBackupFileName(backup.name) !== backup.name) continue;
      } catch {
        continue;
      }
      result.push({
        id:String(backup.id),
        name:String(backup.name),
        size:Number(backup.size || metadata.size || 0),
        createdTime:backup.createdDateTime || metadata.createdAt || null,
        modifiedTime:backup.lastModifiedDateTime || null,
        metadataItemId:String(sidecar.id),
        appProperties:{
          pfcBackup:'1',
          backupId:cleanString(metadata.backupId),
          installationId:cleanString(metadata.installationId),
          backupSource:cleanString(metadata.backupSource),
          createdAt:cleanString(metadata.createdAt),
          formatVersion:String(metadata.formatVersion ?? ''),
          controllerVersion:cleanString(metadata.controllerVersion)
        }
      });
    }

    result.sort((left, right) => {
      const leftTime = new Date(left.appProperties?.createdAt || left.createdTime || 0).getTime();
      const rightTime = new Date(right.appProperties?.createdAt || right.createdTime || 0).getTime();
      return rightTime - leftTime || right.name.localeCompare(left.name);
    });
    return result;
  }

  async getBackup(fileId) {
    const id = cleanString(fileId);
    if (!id) throw oneDriveError('OneDrive backup file ID is required.', 400, 'ONEDRIVE_FILE_ID_REQUIRED');
    const backups = await this.listBackups();
    const backup = backups.find((item) => item.id === id);
    if (!backup) {
      throw oneDriveError(
        'The selected OneDrive backup is no longer available in the Print Farm Controller app folder.',
        404,
        'ONEDRIVE_BACKUP_NOT_FOUND'
      );
    }
    return backup;
  }

  async downloadBackup(fileId, { maxBytes = (4 * 1024 * 1024 * 1024) - 1 } = {}) {
    const backup = await this.getBackup(fileId);
    if (backup.size && backup.size > maxBytes) {
      throw oneDriveError('OneDrive backup exceeds the supported restore size limit.', 413, 'ONEDRIVE_BACKUP_TOO_LARGE');
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-onedrive-restore-'));
    const safeName = safeBackupFileName(backup.name);
    const filePath = path.join(directory, safeName);
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new Error('OneDrive backup exceeds the supported restore size limit.'));
        else callback(null, chunk);
      }
    });

    try {
      const response = await this.authorizedFetch(
        `${GRAPH_API}/me/drive/items/${encodeURIComponent(backup.id)}/content`
      );
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw oneDriveError(
          `OneDrive backup download failed: ${responseMessage(payload, `HTTP ${response.status}`)}`,
          502,
          'ONEDRIVE_DOWNLOAD_FAILED'
        );
      }
      if (!response.body) throw oneDriveError('OneDrive backup download returned no data.', 502, 'ONEDRIVE_DOWNLOAD_FAILED');

      await pipeline(
        readableStreamToNode(response.body),
        limiter,
        createWriteStream(filePath, { flags:'wx', mode:0o600 })
      );
      if (!bytes) throw oneDriveError('OneDrive backup is empty.', 400, 'ONEDRIVE_BACKUP_EMPTY');
      if (backup.size && bytes !== backup.size) {
        throw oneDriveError('OneDrive backup download size did not match the file metadata.', 502, 'ONEDRIVE_DOWNLOAD_SIZE_MISMATCH');
      }

      await this.log('info', 'OneDrive backup downloaded for restore', {
        fileName:backup.name,
        size:bytes,
        oneDriveFileId:backup.id
      });
      return {
        provider:'one-drive',
        fileId:backup.id,
        fileName:backup.name,
        filePath,
        size:bytes,
        metadata:backup,
        async cleanup() {
          await fs.rm(directory, { recursive:true, force:true });
        }
      };
    } catch (error) {
      await fs.rm(directory, { recursive:true, force:true }).catch(() => {});
      throw error;
    }
  }

  async deleteDriveItem(itemId) {
    const id = cleanString(itemId);
    if (!id) return false;
    const response = await this.authorizedFetch(`${GRAPH_API}/me/drive/items/${encodeURIComponent(id)}`, { method:'DELETE' });
    if (!response.ok && response.status !== 404) {
      const payload = await responsePayload(response);
      throw oneDriveError(
        `OneDrive item deletion failed: ${responseMessage(payload, `HTTP ${response.status}`)}`,
        502,
        'ONEDRIVE_DELETE_FAILED'
      );
    }
    return true;
  }

  async deleteBackup(fileId) {
    const backup = await this.getBackup(fileId);
    await this.deleteDriveItem(backup.id);
    if (backup.metadataItemId) await this.deleteDriveItem(backup.metadataItemId).catch(() => {});
    return true;
  }

  async pruneScheduledBackups({ installationId, retentionCount, newestFileId = null } = {}) {
    const keep = Math.max(1, Math.min(365, Number(retentionCount) || 14));
    const installation = cleanString(installationId).toLowerCase();
    if (!installation) return { deleted:[], failed:[], eligible:0, kept:0 };

    const all = await this.listBackups();
    const candidates = all.filter((item) => {
      const props = item.appProperties || {};
      return cleanString(props.installationId).toLowerCase() === installation
        && cleanString(props.backupSource) === 'scheduled';
    }).sort((left, right) => {
      const leftTime = new Date(left.appProperties?.createdAt || left.createdTime || 0).getTime();
      const rightTime = new Date(right.appProperties?.createdAt || right.createdTime || 0).getTime();
      return rightTime - leftTime || right.name.localeCompare(left.name);
    });

    const keepIds = new Set(candidates.slice(0, keep).map((item) => item.id));
    if (newestFileId) keepIds.add(String(newestFileId));
    const deleted = [];
    const failed = [];

    for (const candidate of candidates) {
      if (keepIds.has(candidate.id)) continue;
      try {
        await this.deleteDriveItem(candidate.id);
        if (candidate.metadataItemId) await this.deleteDriveItem(candidate.metadataItemId).catch(() => {});
        deleted.push(candidate.name);
      } catch (error) {
        failed.push({ fileName:candidate.name, error:error?.message || String(error) });
      }
    }
    return { deleted, failed, eligible:candidates.length, kept:Math.max(0, candidates.length - deleted.length) };
  }

  async resetConfiguration() {
    const current = await this.loadState();
    if (!cleanString(current?.clientId)) return this.status();

    this.pendingAuthorization = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.reconnectRequired = false;
    this.lastError = null;
    await this.saveState({
      ...current,
      clientId:null,
      refreshToken:null,
      folderId:null,
      folderName:null,
      connectedAt:null
    });
    await this.log('info', 'OneDrive custom OAuth configuration cleared');
    return this.status();
  }

  async disconnect() {
    const state = await this.loadState();
    this.pendingAuthorization = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.reconnectRequired = false;
    this.lastError = null;
    if (state) {
      await this.saveState({
        ...state,
        refreshToken:null,
        folderId:null,
        folderName:null,
        connectedAt:null
      });
    }
    await this.log('info', 'OneDrive disconnected');
    return this.status();
  }
}

export { METADATA_SUFFIX, UPLOAD_CHUNK_BYTES };
