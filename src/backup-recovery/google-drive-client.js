import crypto from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_DRIVE_FOLDER_NAME = 'Print Farm Controller Backups';

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const BACKUP_MIME = 'application/vnd.print-farm-controller.backup+zip';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

function googleError(message, statusCode = 502, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function cleanString(value) {
  return String(value || '').trim();
}

function escapeDriveQueryLiteral(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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

export class GoogleDriveClient {
  constructor({
    dataDir,
    clientId = process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    fetchFn = globalThis.fetch,
    nowFn = Date.now,
    diagnosticFn = null,
    folderName = GOOGLE_DRIVE_FOLDER_NAME
  } = {}) {
    if (!dataDir) throw new Error('Google Drive client requires a data directory');
    if (typeof fetchFn !== 'function') throw new Error('Google Drive client requires fetch support');
    this.dataDir = path.resolve(dataDir);
    this.clientId = cleanString(clientId);
    this.clientSecret = cleanString(clientSecret);
    this.fetchFn = fetchFn;
    this.nowFn = typeof nowFn === 'function' ? nowFn : Date.now;
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : null;
    this.folderName = cleanString(folderName) || GOOGLE_DRIVE_FOLDER_NAME;
    this.integrationDir = path.join(this.dataDir, 'integrations');
    this.statePath = path.join(this.integrationDir, 'google-drive.json');
    this.pendingAuthorization = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.reconnectRequired = false;
    this.lastError = null;
  }

  async log(level, message, meta = {}) {
    try { await this.diagnostic?.(level, message, meta); } catch {}
  }

  configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  requireConfigured() {
    if (this.configured()) return;
    throw googleError(
      'Google Drive is not configured. Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET using a Google OAuth client of type TVs and Limited Input devices.',
      503,
      'GOOGLE_DRIVE_NOT_CONFIGURED'
    );
  }

  async loadState() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (!parsed || parsed.version !== 1) return null;
      return {
        version:1,
        refreshToken:cleanString(parsed.refreshToken) || null,
        folderId:cleanString(parsed.folderId) || null,
        folderName:cleanString(parsed.folderName) || this.folderName,
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
      refreshToken:cleanString(state?.refreshToken) || null,
      folderId:cleanString(state?.folderId) || null,
      folderName:cleanString(state?.folderName) || this.folderName,
      connectedAt:cleanString(state?.connectedAt) || new Date(this.nowFn()).toISOString()
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
    return {
      configured:this.configured(),
      connected:Boolean(state?.refreshToken) && !this.reconnectRequired,
      reconnectRequired:this.reconnectRequired,
      folderId:state?.folderId || null,
      folderName:state?.folderName || this.folderName,
      authorizationPending:Boolean(pending),
      verificationUrl:pending?.verificationUrl || null,
      userCode:pending?.userCode || null,
      authorizationExpiresAt:pending?.expiresAtMs ? new Date(pending.expiresAtMs).toISOString() : null,
      pollIntervalSeconds:pending?.intervalSeconds || null,
      lastError:this.lastError || null
    };
  }

  async startDeviceAuthorization() {
    this.requireConfigured();
    const body = new URLSearchParams({
      client_id:this.clientId,
      scope:GOOGLE_DRIVE_SCOPE
    });
    const response = await this.fetchFn(DEVICE_CODE_URL, {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw googleError(`Google authorization could not be started: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    }
    const deviceCode = cleanString(payload.device_code);
    const userCode = cleanString(payload.user_code);
    const verificationUrl = cleanString(payload.verification_url || payload.verification_uri);
    const expiresIn = Math.max(60, Number(payload.expires_in) || 1800);
    const intervalSeconds = Math.max(5, Number(payload.interval) || 5);
    if (!deviceCode || !userCode || !verificationUrl) {
      throw googleError('Google authorization returned an incomplete device-code response', 502);
    }
    const now = this.nowFn();
    this.pendingAuthorization = {
      deviceCode,
      userCode,
      verificationUrl,
      expiresAtMs:now + (expiresIn * 1000),
      intervalSeconds,
      nextPollAtMs:now
    };
    this.lastError = null;
    this.reconnectRequired = false;
    await this.log('info', 'Google Drive authorization started');
    return this.status();
  }

  async pollDeviceAuthorization() {
    this.requireConfigured();
    const pending = this.pendingAuthorization;
    if (!pending) return this.status();
    const now = this.nowFn();
    if (now >= pending.expiresAtMs) {
      this.pendingAuthorization = null;
      this.lastError = 'Google authorization expired before it was completed.';
      return this.status();
    }
    if (now < pending.nextPollAtMs) return this.status();

    pending.nextPollAtMs = now + (pending.intervalSeconds * 1000);
    const response = await this.fetchFn(TOKEN_URL, {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        client_id:this.clientId,
        client_secret:this.clientSecret,
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
      if (code === 'access_denied' || code === 'expired_token') {
        this.pendingAuthorization = null;
        this.lastError = code === 'access_denied'
          ? 'Google Drive access was not granted.'
          : 'Google authorization expired before it was completed.';
        return this.status();
      }
      throw googleError(`Google authorization failed: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    }

    const refreshToken = cleanString(payload.refresh_token);
    const accessToken = cleanString(payload.access_token);
    if (!refreshToken || !accessToken) throw googleError('Google authorization did not return the required tokens', 502);
    const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
    this.accessToken = accessToken;
    this.accessTokenExpiresAtMs = now + (expiresIn * 1000);
    this.pendingAuthorization = null;
    this.reconnectRequired = false;
    this.lastError = null;
    await this.saveState({
      refreshToken,
      folderId:null,
      folderName:this.folderName,
      connectedAt:new Date(now).toISOString()
    });
    await this.ensureBackupFolder();
    await this.log('info', 'Google Drive connected');
    return this.status();
  }

  async getAccessToken() {
    this.requireConfigured();
    const now = this.nowFn();
    if (this.accessToken && this.accessTokenExpiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now) return this.accessToken;
    const state = await this.loadState();
    if (!state?.refreshToken) {
      throw googleError('Google Drive is not connected.', 409, 'GOOGLE_DRIVE_NOT_CONNECTED');
    }
    const response = await this.fetchFn(TOKEN_URL, {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        client_id:this.clientId,
        client_secret:this.clientSecret,
        refresh_token:state.refreshToken,
        grant_type:'refresh_token'
      })
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      const code = cleanString(payload.error);
      if (code === 'invalid_grant' || code === 'invalid_client' || response.status === 401) {
        this.accessToken = null;
        this.accessTokenExpiresAtMs = 0;
        this.reconnectRequired = true;
        this.lastError = 'Google Drive authorization is no longer valid. Reconnect Google Drive.';
        throw googleError(this.lastError, 401, 'GOOGLE_DRIVE_RECONNECT_REQUIRED');
      }
      throw googleError(`Google access token refresh failed: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    }
    const accessToken = cleanString(payload.access_token);
    if (!accessToken) throw googleError('Google token refresh returned no access token', 502);
    this.accessToken = accessToken;
    this.accessTokenExpiresAtMs = now + (Math.max(60, Number(payload.expires_in) || 3600) * 1000);
    this.reconnectRequired = false;
    this.lastError = null;
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
    if (!state?.refreshToken) throw googleError('Google Drive is not connected.', 409, 'GOOGLE_DRIVE_NOT_CONNECTED');

    if (state.folderId) {
      const existing = await this.authorizedFetch(`${DRIVE_API}/files/${encodeURIComponent(state.folderId)}?fields=id,name,mimeType,trashed`);
      if (existing.ok) {
        const payload = await responsePayload(existing);
        if (payload?.mimeType === FOLDER_MIME && payload?.trashed !== true) return payload;
      } else if (existing.status !== 404) {
        const payload = await responsePayload(existing);
        throw googleError(`Google Drive backup folder could not be checked: ${responseMessage(payload, `HTTP ${existing.status}`)}`, 502);
      }
    }

    const query = `name = '${escapeDriveQueryLiteral(this.folderName)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const searchUrl = new URL(`${DRIVE_API}/files`);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('spaces', 'drive');
    searchUrl.searchParams.set('fields', 'files(id,name,mimeType,createdTime)');
    searchUrl.searchParams.set('orderBy', 'createdTime');
    const searched = await this.authorizedFetch(searchUrl);
    const searchPayload = await responsePayload(searched);
    if (!searched.ok) {
      throw googleError(`Google Drive backup folder search failed: ${responseMessage(searchPayload, `HTTP ${searched.status}`)}`, 502);
    }
    let folder = Array.isArray(searchPayload.files) ? searchPayload.files[0] : null;
    if (!folder) {
      const created = await this.authorizedFetch(`${DRIVE_API}/files?fields=id,name,mimeType`, {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ name:this.folderName, mimeType:FOLDER_MIME })
      });
      const createdPayload = await responsePayload(created);
      if (!created.ok) {
        throw googleError(`Google Drive backup folder could not be created: ${responseMessage(createdPayload, `HTTP ${created.status}`)}`, 502);
      }
      folder = createdPayload;
    }
    await this.saveState({ ...state, folderId:folder.id, folderName:folder.name || this.folderName });
    return folder;
  }

  async testConnection() {
    const folder = await this.ensureBackupFolder();
    this.lastError = null;
    return { connected:true, folderId:folder.id, folderName:folder.name || this.folderName };
  }

  async uploadBackup({ filePath, fileName, manifest } = {}) {
    if (!filePath || !fileName) throw new Error('Google Drive backup upload requires a file path and name');
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Google Drive backup upload source is not a file');
    const folder = await this.ensureBackupFolder();
    const metadata = {
      name:String(fileName),
      parents:[folder.id],
      appProperties:{
        pfcBackup:'1',
        backupId:cleanString(manifest?.backupId),
        installationId:cleanString(manifest?.installationId),
        backupSource:cleanString(manifest?.backupSource),
        createdAt:cleanString(manifest?.createdAt),
        formatVersion:String(manifest?.formatVersion ?? '')
      }
    };
    const initiateUrl = `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size,createdTime,appProperties`;
    const initiated = await this.authorizedFetch(initiateUrl, {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-upload-content-type':BACKUP_MIME,
        'x-upload-content-length':String(stat.size)
      },
      body:JSON.stringify(metadata)
    });
    if (!initiated.ok) {
      const payload = await responsePayload(initiated);
      throw googleError(`Google Drive upload could not be started: ${responseMessage(payload, `HTTP ${initiated.status}`)}`, 502);
    }
    const uploadUrl = cleanString(initiated.headers.get('location'));
    if (!uploadUrl) throw googleError('Google Drive upload did not return a resumable upload URL', 502);

    const uploaded = await this.authorizedFetch(uploadUrl, {
      method:'PUT',
      headers:{
        'content-type':BACKUP_MIME,
        'content-length':String(stat.size)
      },
      body:createReadStream(filePath),
      duplex:'half'
    });
    const payload = await responsePayload(uploaded);
    if (!uploaded.ok) {
      throw googleError(`Google Drive backup upload failed: ${responseMessage(payload, `HTTP ${uploaded.status}`)}`, 502);
    }
    await this.log('info', 'Backup uploaded to Google Drive', {
      fileName:String(fileName),
      size:stat.size,
      driveFileId:payload.id || null
    });
    return {
      id:payload.id,
      name:payload.name || String(fileName),
      size:Number(payload.size || stat.size),
      createdTime:payload.createdTime || null,
      folderId:folder.id,
      folderName:folder.name || this.folderName
    };
  }

  async listBackups() {
    const folder = await this.ensureBackupFolder();
    const query = `'${escapeDriveQueryLiteral(folder.id)}' in parents and trashed = false`;
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('fields', 'files(id,name,size,createdTime,modifiedTime,appProperties)');
    url.searchParams.set('orderBy', 'createdTime desc');
    url.searchParams.set('pageSize', '1000');
    const response = await this.authorizedFetch(url);
    const payload = await responsePayload(response);
    if (!response.ok) throw googleError(`Google Drive backup list failed: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    return (Array.isArray(payload.files) ? payload.files : [])
      .filter((item) => item?.appProperties?.pfcBackup === '1' && /\.pfcbackup$/i.test(String(item.name || '')))
      .map((item) => ({
        id:String(item.id),
        name:String(item.name || ''),
        size:Number(item.size || 0),
        createdTime:item.createdTime || null,
        modifiedTime:item.modifiedTime || null,
        appProperties:item.appProperties || {}
      }));
  }

  async deleteBackup(fileId) {
    const id = cleanString(fileId);
    if (!id) throw new Error('Google Drive file ID is required');
    const response = await this.authorizedFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}`, { method:'DELETE' });
    if (!response.ok && response.status !== 404) {
      const payload = await responsePayload(response);
      throw googleError(`Google Drive backup deletion failed: ${responseMessage(payload, `HTTP ${response.status}`)}`, 502);
    }
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
        await this.deleteBackup(candidate.id);
        deleted.push(candidate.name);
      } catch (error) {
        failed.push({ fileName:candidate.name, error:error?.message || String(error) });
      }
    }
    return { deleted, failed, eligible:candidates.length, kept:Math.max(0, candidates.length - deleted.length) };
  }

  async disconnect({ revoke = true } = {}) {
    const state = await this.loadState();
    if (revoke && state?.refreshToken && this.configured()) {
      try {
        await this.fetchFn(REVOKE_URL, {
          method:'POST',
          headers:{ 'content-type':'application/x-www-form-urlencoded' },
          body:new URLSearchParams({ token:state.refreshToken })
        });
      } catch {}
    }
    this.pendingAuthorization = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.reconnectRequired = false;
    this.lastError = null;
    await fs.rm(this.statePath, { force:true }).catch(() => {});
    await this.log('info', 'Google Drive disconnected');
    return this.status();
  }
}
