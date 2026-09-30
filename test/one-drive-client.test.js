import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OneDriveClient, ONEDRIVE_SCOPE } from '../src/backup-recovery/one-drive-client.js';

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers:{ 'content-type':'application/json', ...headers }
  });
}

test('OneDrive built-in public client uses device authorization without persisting the application client ID', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-onedrive-auth-'));
  let now = Date.parse('2026-09-29T18:00:00.000Z');
  const requests = [];
  try {
    const client = new OneDriveClient({
      dataDir:root,
      clientId:'',
      builtInClientId:'11111111-1111-4111-8111-111111111111',
      nowFn:() => now,
      fetchFn:async (url, options = {}) => {
        const target = String(url);
        requests.push({ target, options });
        if (target.endsWith('/oauth2/v2.0/devicecode')) {
          return jsonResponse({
            device_code:'device-code',
            user_code:'ABCD-EFGH',
            verification_uri:'https://microsoft.com/devicelogin',
            expires_in:900,
            interval:5
          });
        }
        if (target.endsWith('/oauth2/v2.0/token')) {
          return jsonResponse({
            access_token:'access-token',
            refresh_token:'refresh-token',
            expires_in:3600,
            scope:ONEDRIVE_SCOPE
          });
        }
        if (target.startsWith('https://graph.microsoft.com/v1.0/me/drive/special/approot?')) {
          return jsonResponse({
            id:'app-root-1',
            name:'Print Farm Controller',
            webUrl:'https://onedrive.example/apps/pfc',
            folder:{ childCount:0 },
            specialFolder:{ name:'approot' }
          });
        }
        throw new Error(`Unexpected request: ${target}`);
      }
    });

    const before = await client.status();
    assert.equal(before.configured, true);
    assert.equal(before.configurationSource, 'built-in');
    assert.equal(before.builtInConfigured, true);
    assert.equal(before.customConfigured, false);
    assert.equal(before.clientId, null);

    const pending = await client.startDeviceAuthorization();
    assert.equal(pending.authorizationPending, true);
    assert.equal(pending.userCode, 'ABCD-EFGH');
    assert.equal(pending.verificationUrl, 'https://microsoft.com/devicelogin');

    const connected = await client.pollDeviceAuthorization();
    assert.equal(connected.connected, true);
    assert.equal(connected.folderId, 'app-root-1');
    assert.equal(connected.folderName, 'Print Farm Controller');

    const stored = JSON.parse(await fs.readFile(path.join(root, 'integrations', 'one-drive.json'), 'utf8'));
    assert.equal(stored.clientId, null);
    assert.equal(stored.refreshToken, 'refresh-token');
    assert.equal(JSON.stringify(stored).includes('access-token'), false);
    assert.equal(JSON.stringify(stored).includes('11111111-1111-4111-8111-111111111111'), false);

    const deviceRequest = requests.find((item) => item.target.endsWith('/devicecode'));
    assert.match(String(deviceRequest.options.body), /client_id=11111111-1111-4111-8111-111111111111/);
    assert.match(String(deviceRequest.options.body), /offline_access/);
    assert.match(String(deviceRequest.options.body), /Files.ReadWrite.AppFolder/);
    assert.equal(String(deviceRequest.options.body).includes('client_secret'), false);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('OneDrive refresh token rotation is persisted and invalid grants require reconnection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-onedrive-refresh-'));
  let failRefresh = false;
  try {
    const client = new OneDriveClient({
      dataDir:root,
      clientId:'22222222-2222-4222-8222-222222222222',
      fetchFn:async (url) => {
        const target = String(url);
        if (target.endsWith('/oauth2/v2.0/token')) {
          return failRefresh
            ? jsonResponse({ error:'invalid_grant' }, 400)
            : jsonResponse({
                access_token:'rotated-access-token',
                refresh_token:'rotated-refresh-token',
                expires_in:3600
              });
        }
        if (target.startsWith('https://graph.microsoft.com/v1.0/me/drive/special/approot?')) {
          return jsonResponse({ id:'app-root', name:'Print Farm Controller', folder:{} });
        }
        throw new Error(`Unexpected request: ${target}`);
      }
    });
    await client.saveState({
      clientId:'22222222-2222-4222-8222-222222222222',
      refreshToken:'old-refresh-token'
    });

    const connection = await client.testConnection();
    assert.equal(connection.connected, true);
    let stored = JSON.parse(await fs.readFile(path.join(root, 'integrations', 'one-drive.json'), 'utf8'));
    assert.equal(stored.refreshToken, 'rotated-refresh-token');

    client.accessToken = null;
    client.accessTokenExpiresAtMs = 0;
    failRefresh = true;
    await assert.rejects(
      () => client.getAccessToken(),
      (error) => error?.code === 'ONEDRIVE_RECONNECT_REQUIRED' && error?.statusCode === 401
    );
    const status = await client.status();
    assert.equal(status.connected, false);
    assert.equal(status.reconnectRequired, true);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('OneDrive uploads backup plus controller metadata and prunes only this installation scheduled backups', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-onedrive-upload-'));
  const backupPath = path.join(root, 'sample.pfcbackup');
  const deleted = [];
  try {
    await fs.writeFile(backupPath, Buffer.from('verified-backup-payload'));

    const children = [
      { id:'new-1', name:'new-1.pfcbackup', size:10, createdDateTime:'2026-09-29T10:00:00.000Z', file:{} },
      { id:'new-1-meta', name:'new-1.pfcbackup.pfcmeta.json', size:100, file:{} },
      { id:'new-2', name:'new-2.pfcbackup', size:10, createdDateTime:'2026-09-28T10:00:00.000Z', file:{} },
      { id:'new-2-meta', name:'new-2.pfcbackup.pfcmeta.json', size:100, file:{} },
      { id:'old-3', name:'old-3.pfcbackup', size:10, createdDateTime:'2026-09-27T10:00:00.000Z', file:{} },
      { id:'old-3-meta', name:'old-3.pfcbackup.pfcmeta.json', size:100, file:{} },
      { id:'manual', name:'manual.pfcbackup', size:10, createdDateTime:'2026-09-26T10:00:00.000Z', file:{} },
      { id:'manual-meta', name:'manual.pfcbackup.pfcmeta.json', size:100, file:{} },
      { id:'foreign', name:'foreign.pfcbackup', size:10, createdDateTime:'2026-09-25T10:00:00.000Z', file:{} },
      { id:'foreign-meta', name:'foreign.pfcbackup.pfcmeta.json', size:100, file:{} }
    ];
    const metadata = {
      'new-1-meta':{ version:1, pfcBackup:true, backupItemId:'new-1', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'scheduled', createdAt:'2026-09-29T10:00:00.000Z' },
      'new-2-meta':{ version:1, pfcBackup:true, backupItemId:'new-2', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'scheduled', createdAt:'2026-09-28T10:00:00.000Z' },
      'old-3-meta':{ version:1, pfcBackup:true, backupItemId:'old-3', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'scheduled', createdAt:'2026-09-27T10:00:00.000Z' },
      'manual-meta':{ version:1, pfcBackup:true, backupItemId:'manual', installationId:'11111111-1111-4111-8111-111111111111', backupSource:'manual', createdAt:'2026-09-26T10:00:00.000Z' },
      'foreign-meta':{ version:1, pfcBackup:true, backupItemId:'foreign', installationId:'22222222-2222-4222-8222-222222222222', backupSource:'scheduled', createdAt:'2026-09-25T10:00:00.000Z' }
    };

    const client = new OneDriveClient({
      dataDir:root,
      clientId:'client-id',
      fetchFn:async (url, options = {}) => {
        const target = String(url);
        if (target.startsWith('https://graph.microsoft.com/v1.0/me/drive/special/approot?')) {
          return jsonResponse({ id:'app-root', name:'Print Farm Controller', folder:{} });
        }
        if (target.includes('/createUploadSession')) {
          return jsonResponse({ uploadUrl:'https://upload.example/onedrive-session' });
        }
        if (target === 'https://upload.example/onedrive-session') {
          assert.equal(options.headers.authorization, undefined);
          assert.match(String(options.headers['content-range']), /^bytes 0-\d+\/23$/);
          return jsonResponse({
            id:'uploaded-new',
            name:'sample.pfcbackup',
            size:23,
            createdDateTime:'2026-09-29T10:05:00.000Z'
          }, 201);
        }
        if (target.includes('sample.pfcbackup.pfcmeta.json:/content')) {
          const body = JSON.parse(Buffer.from(options.body).toString('utf8'));
          assert.equal(body.backupItemId, 'uploaded-new');
          assert.equal(body.installationId, '11111111-1111-4111-8111-111111111111');
          return jsonResponse({ id:'uploaded-new-meta', name:'sample.pfcbackup.pfcmeta.json' }, 201);
        }
        if (target.startsWith('https://graph.microsoft.com/v1.0/me/drive/special/approot/children?')) {
          return jsonResponse({ value:children });
        }
        const contentMatch = target.match(/\/me\/drive\/items\/([^/]+)\/content$/);
        if (contentMatch && metadata[decodeURIComponent(contentMatch[1])]) {
          return jsonResponse(metadata[decodeURIComponent(contentMatch[1])]);
        }
        const deleteMatch = target.match(/\/me\/drive\/items\/([^/]+)$/);
        if (deleteMatch && options.method === 'DELETE') {
          deleted.push(decodeURIComponent(deleteMatch[1]));
          return new Response(null, { status:204 });
        }
        throw new Error(`Unexpected request: ${target}`);
      }
    });
    await client.saveState({
      clientId:'client-id',
      refreshToken:'refresh-token',
      folderId:'app-root',
      folderName:'Print Farm Controller'
    });
    client.accessToken = 'cached-token';
    client.accessTokenExpiresAtMs = Date.now() + 3_600_000;

    const uploaded = await client.uploadBackup({
      filePath:backupPath,
      fileName:'sample.pfcbackup',
      manifest:{
        backupId:'33333333-3333-4333-8333-333333333333',
        installationId:'11111111-1111-4111-8111-111111111111',
        backupSource:'scheduled',
        createdAt:'2026-09-29T10:05:00.000Z',
        formatVersion:1,
        sourceControllerVersion:'0.34.0'
      }
    });
    assert.equal(uploaded.id, 'uploaded-new');
    assert.equal(uploaded.metadataItemId, 'uploaded-new-meta');

    const retention = await client.pruneScheduledBackups({
      installationId:'11111111-1111-4111-8111-111111111111',
      retentionCount:2,
      newestFileId:'new-1'
    });
    assert.deepEqual(deleted, ['old-3','old-3-meta']);
    assert.equal(retention.deleted.length, 1);
    assert.equal(retention.eligible, 3);
    assert.equal(retention.kept, 2);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('OneDrive restore download only exposes backups paired with valid PFC metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-onedrive-restore-'));
  const backupBytes = Buffer.from('restore-backup-bytes');
  try {
    const client = new OneDriveClient({
      dataDir:root,
      clientId:'client-id',
      fetchFn:async (url) => {
        const target = String(url);
        if (target.startsWith('https://graph.microsoft.com/v1.0/me/drive/special/approot?')) {
          return jsonResponse({ id:'app-root', name:'Print Farm Controller', folder:{} });
        }
        if (target.startsWith('https://graph.microsoft.com/v1.0/me/drive/special/approot/children?')) {
          return jsonResponse({
            value:[
              { id:'restore-1', name:'restore-1.pfcbackup', size:backupBytes.length, createdDateTime:'2026-09-29T11:00:00.000Z', file:{} },
              { id:'restore-meta', name:'restore-1.pfcbackup.pfcmeta.json', size:100, file:{} },
              { id:'orphan', name:'orphan.pfcbackup', size:10, file:{} }
            ]
          });
        }
        if (target === 'https://graph.microsoft.com/v1.0/me/drive/items/restore-meta/content') {
          return jsonResponse({
            version:1,
            pfcBackup:true,
            backupItemId:'restore-1',
            backupFileName:'restore-1.pfcbackup',
            backupSource:'manual',
            createdAt:'2026-09-29T11:00:00.000Z',
            size:backupBytes.length
          });
        }
        if (target === 'https://graph.microsoft.com/v1.0/me/drive/items/restore-1/content') {
          return new Response(backupBytes, { status:200 });
        }
        throw new Error(`Unexpected request: ${target}`);
      }
    });
    await client.saveState({
      clientId:'client-id',
      refreshToken:'refresh-token',
      folderId:'app-root',
      folderName:'Print Farm Controller'
    });
    client.accessToken = 'cached-token';
    client.accessTokenExpiresAtMs = Date.now() + 3_600_000;

    const listed = await client.listBackups();
    assert.deepEqual(listed.map((item) => item.id), ['restore-1']);

    const staged = await client.downloadBackup('restore-1');
    assert.equal(staged.provider, 'one-drive');
    assert.equal(staged.fileName, 'restore-1.pfcbackup');
    assert.deepEqual(await fs.readFile(staged.filePath), backupBytes);
    await staged.cleanup();
    await assert.rejects(() => fs.stat(staged.filePath), /ENOENT/);
    await assert.rejects(() => client.downloadBackup('orphan'), /no longer available/i);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
