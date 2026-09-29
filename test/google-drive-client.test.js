import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleDriveClient, GOOGLE_DRIVE_SCOPE } from '../src/backup-recovery/google-drive-client.js';

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers:{ 'content-type':'application/json', ...headers }
  });
}

test('Google Drive UI configuration persists OAuth client credentials without persisting access tokens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-google-drive-auth-'));
  let now = Date.parse('2026-09-29T10:00:00.000Z');
  const requests = [];
  try {
    const fetchFn = async (url, options = {}) => {
      const target = String(url);
      requests.push({ target, options });
      if (target.endsWith('/device/code')) {
        return jsonResponse({
          device_code:'device-secret',
          user_code:'ABCD-EFGH',
          verification_url:'https://www.google.com/device',
          expires_in:1800,
          interval:5
        });
      }
      if (target.endsWith('/token')) {
        return jsonResponse({
          access_token:'short-lived-access-token',
          refresh_token:'long-lived-refresh-token',
          expires_in:3600,
          token_type:'Bearer',
          scope:GOOGLE_DRIVE_SCOPE
        });
      }
      if (target.startsWith('https://www.googleapis.com/drive/v3/files?') && target.includes('orderBy=createdTime')) {
        return jsonResponse({ files:[] });
      }
      if (target === 'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType') {
        return jsonResponse({
          id:'folder-123',
          name:'Print Farm Controller Backups',
          mimeType:'application/vnd.google-apps.folder'
        });
      }
      throw new Error(`Unexpected request: ${target}`);
    };

    const client = new GoogleDriveClient({
      dataDir:root,
      clientId:'',
      clientSecret:'',
      fetchFn,
      nowFn:() => now
    });

    const initial = await client.status();
    assert.equal(initial.configured, false);
    assert.equal(initial.clientSecretConfigured, false);

    const configured = await client.configure({
      clientId:'client-id.apps.googleusercontent.com',
      clientSecret:'client-secret'
    });
    assert.equal(configured.configured, true);
    assert.equal(configured.configurationSource, 'ui');
    assert.equal(configured.clientId, 'client-id.apps.googleusercontent.com');
    assert.equal(configured.clientSecretConfigured, true);
    assert.equal(Object.hasOwn(configured, 'clientSecret'), false);

    const configuredState = JSON.parse(await fs.readFile(path.join(root, 'integrations', 'google-drive.json'), 'utf8'));
    assert.equal(configuredState.clientId, 'client-id.apps.googleusercontent.com');
    assert.equal(configuredState.clientSecret, 'client-secret');

    const started = await client.startDeviceAuthorization();
    assert.equal(started.authorizationPending, true);
    assert.equal(started.userCode, 'ABCD-EFGH');
    assert.equal(started.verificationUrl, 'https://www.google.com/device');

    const connected = await client.pollDeviceAuthorization();
    assert.equal(connected.connected, true);
    assert.equal(connected.authorizationPending, false);
    assert.equal(connected.folderId, 'folder-123');

    const stored = JSON.parse(await fs.readFile(path.join(root, 'integrations', 'google-drive.json'), 'utf8'));
    assert.equal(stored.refreshToken, 'long-lived-refresh-token');
    assert.equal(stored.folderId, 'folder-123');
    assert.equal(stored.clientId, 'client-id.apps.googleusercontent.com');
    assert.equal(stored.clientSecret, 'client-secret');
    assert.equal(JSON.stringify(stored).includes('short-lived-access-token'), false);

    const deviceRequest = requests.find((item) => item.target.endsWith('/device/code'));
    assert.match(String(deviceRequest.options.body), /client_id=client-id\.apps\.googleusercontent\.com/);
    assert.match(String(deviceRequest.options.body), /scope=https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fdrive\.file/);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('Google Drive refresh failure marks the integration as requiring reconnection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-google-drive-refresh-'));
  try {
    const client = new GoogleDriveClient({
      dataDir:root,
      clientId:'client-id',
      clientSecret:'client-secret',
      fetchFn:async (url) => {
        if (String(url).endsWith('/token')) return jsonResponse({ error:'invalid_grant' }, 400);
        if (String(url).endsWith('/device/code')) {
          return jsonResponse({
            device_code:'replacement-device-code',
            user_code:'WXYZ-1234',
            verification_url:'https://www.google.com/device',
            expires_in:1800,
            interval:5
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }
    });
    await client.saveState({
      refreshToken:'expired-refresh-token',
      folderId:'folder-1',
      folderName:'Print Farm Controller Backups'
    });

    await assert.rejects(
      () => client.testConnection(),
      (error) => error?.code === 'GOOGLE_DRIVE_RECONNECT_REQUIRED' && error?.statusCode === 401
    );
    const status = await client.status();
    assert.equal(status.connected, false);
    assert.equal(status.reconnectRequired, true);
    assert.match(status.lastError, /Reconnect Google Drive/i);

    const reconnecting = await client.startDeviceAuthorization();
    assert.equal(reconnecting.authorizationPending, true);
    assert.equal(reconnecting.connected, false);
    assert.equal(reconnecting.reconnectRequired, true);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('Google Drive uploads verified backup files and prunes only older scheduled backups for this installation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-google-drive-upload-'));
  const backupPath = path.join(root, 'sample.pfcbackup');
  const deleted = [];
  try {
    await fs.writeFile(backupPath, Buffer.from('verified-backup-payload'));
    const client = new GoogleDriveClient({
      dataDir:root,
      clientId:'client-id',
      clientSecret:'client-secret',
      fetchFn:async (url, options = {}) => {
        const target = String(url);
        if (target.includes('/drive/v3/files/folder-1?')) {
          return jsonResponse({
            id:'folder-1',
            name:'Print Farm Controller Backups',
            mimeType:'application/vnd.google-apps.folder',
            trashed:false
          });
        }
        if (target.includes('/upload/drive/v3/files?uploadType=resumable')) {
          const metadata = JSON.parse(String(options.body));
          assert.equal(metadata.name, 'sample.pfcbackup');
          assert.equal(metadata.parents[0], 'folder-1');
          assert.equal(metadata.appProperties.installationId, '11111111-1111-4111-8111-111111111111');
          return new Response('', { status:200, headers:{ location:'https://upload.example/session-1' } });
        }
        if (target === 'https://upload.example/session-1') {
          return jsonResponse({
            id:'drive-backup-new',
            name:'sample.pfcbackup',
            size:'23',
            createdTime:'2026-09-29T10:05:00.000Z'
          });
        }
        if (target.startsWith('https://www.googleapis.com/drive/v3/files?') && target.includes('orderBy=createdTime+desc')) {
          return jsonResponse({
            files:[
              {
                id:'new-1', name:'new-1.pfcbackup', size:'10', createdTime:'2026-09-29T10:00:00.000Z',
                appProperties:{ pfcBackup:'1', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'scheduled', createdAt:'2026-09-29T10:00:00.000Z' }
              },
              {
                id:'new-2', name:'new-2.pfcbackup', size:'10', createdTime:'2026-09-28T10:00:00.000Z',
                appProperties:{ pfcBackup:'1', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'scheduled', createdAt:'2026-09-28T10:00:00.000Z' }
              },
              {
                id:'old-3', name:'old-3.pfcbackup', size:'10', createdTime:'2026-09-27T10:00:00.000Z',
                appProperties:{ pfcBackup:'1', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'scheduled', createdAt:'2026-09-27T10:00:00.000Z' }
              },
              {
                id:'manual', name:'manual.pfcbackup', size:'10', createdTime:'2026-09-26T10:00:00.000Z',
                appProperties:{ pfcBackup:'1', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'manual', createdAt:'2026-09-26T10:00:00.000Z' }
              },
              {
                id:'foreign', name:'foreign.pfcbackup', size:'10', createdTime:'2026-09-25T10:00:00.000Z',
                appProperties:{ pfcBackup:'1', installationId:'22222222-2222-4222-8222-222222222222', backupSource:'scheduled', createdAt:'2026-09-25T10:00:00.000Z' }
              }
            ]
          });
        }
        if (target.startsWith('https://www.googleapis.com/drive/v3/files/old-3') && options.method === 'DELETE') {
          deleted.push('old-3');
          return new Response(null, { status:204 });
        }
        throw new Error(`Unexpected request: ${target}`);
      }
    });

    await client.saveState({
      refreshToken:'refresh-token',
      folderId:'folder-1',
      folderName:'Print Farm Controller Backups'
    });
    client.accessToken = 'cached-access-token';
    client.accessTokenExpiresAtMs = Date.now() + 3_600_000;

    const uploaded = await client.uploadBackup({
      filePath:backupPath,
      fileName:'sample.pfcbackup',
      manifest:{
        backupId:'33333333-3333-4333-8333-333333333333',
        installationId:'11111111-1111-4111-8111-111111111111',
        backupSource:'scheduled',
        createdAt:'2026-09-29T10:05:00.000Z',
        formatVersion:1
      }
    });
    assert.equal(uploaded.id, 'drive-backup-new');

    const retention = await client.pruneScheduledBackups({
      installationId:'11111111-1111-4111-8111-111111111111',
      retentionCount:2,
      newestFileId:'new-1'
    });
    assert.deepEqual(deleted, ['old-3']);
    assert.equal(retention.deleted.length, 1);
    assert.equal(retention.eligible, 3);
    assert.equal(retention.kept, 2);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});


test('Google Drive disconnect preserves UI OAuth configuration while removing account authorization', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-google-drive-disconnect-'));
  try {
    const client = new GoogleDriveClient({
      dataDir:root,
      clientId:'',
      clientSecret:'',
      fetchFn:async (url) => {
        if (String(url).endsWith('/revoke')) return new Response('', { status:200 });
        throw new Error(`Unexpected request: ${url}`);
      }
    });
    await client.configure({
      clientId:'saved-client-id.apps.googleusercontent.com',
      clientSecret:'saved-client-secret'
    });
    await client.saveState({
      ...(await client.loadState()),
      refreshToken:'refresh-token',
      folderId:'folder-1',
      connectedAt:'2026-09-29T10:00:00.000Z'
    });

    const status = await client.disconnect();
    assert.equal(status.configured, true);
    assert.equal(status.connected, false);
    assert.equal(status.clientId, 'saved-client-id.apps.googleusercontent.com');
    assert.equal(status.clientSecretConfigured, true);

    const stored = JSON.parse(await fs.readFile(path.join(root, 'integrations', 'google-drive.json'), 'utf8'));
    assert.equal(stored.clientId, 'saved-client-id.apps.googleusercontent.com');
    assert.equal(stored.clientSecret, 'saved-client-secret');
    assert.equal(stored.refreshToken, null);
    assert.equal(stored.folderId, null);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});


test('Google Drive restore download only accepts controller backups and streams them to temporary staging', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-google-drive-restore-'));
  try {
    const payload = Buffer.from('restore-backup-bytes');
    const client = new GoogleDriveClient({
      dataDir:root,
      clientId:'client-id',
      clientSecret:'client-secret',
      fetchFn:async (url) => {
        const target = String(url);
        if (target.includes('/drive/v3/files/folder-1?')) {
          return jsonResponse({
            id:'folder-1',
            name:'Print Farm Controller Backups',
            mimeType:'application/vnd.google-apps.folder',
            trashed:false
          });
        }
        if (target.startsWith('https://www.googleapis.com/drive/v3/files?') && target.includes('orderBy=createdTime+desc')) {
          return jsonResponse({
            files:[{
              id:'restore-1',
              name:'restore-1.pfcbackup',
              size:String(payload.length),
              createdTime:'2026-09-29T11:00:00.000Z',
              appProperties:{ pfcBackup:'1', backupSource:'manual' }
            }]
          });
        }
        if (target === 'https://www.googleapis.com/drive/v3/files/restore-1?alt=media') {
          return new Response(payload, { status:200 });
        }
        throw new Error(`Unexpected request: ${target}`);
      }
    });
    await client.saveState({
      clientId:'client-id',
      clientSecret:'client-secret',
      refreshToken:'refresh-token',
      folderId:'folder-1',
      folderName:'Print Farm Controller Backups'
    });
    client.accessToken = 'cached-token';
    client.accessTokenExpiresAtMs = Date.now() + 3600000;

    const staged = await client.downloadBackup('restore-1');
    assert.equal(staged.fileName, 'restore-1.pfcbackup');
    assert.deepEqual(await fs.readFile(staged.filePath), payload);
    await staged.cleanup();
    await assert.rejects(() => fs.stat(staged.filePath), /ENOENT/);

    await assert.rejects(() => client.downloadBackup('missing'), /no longer available/i);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
