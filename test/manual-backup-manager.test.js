import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { ManualBackupManager } from '../src/backup-recovery/manual-backup-manager.js';
import { verifyBackupArchive } from '../src/backup-recovery/backup-format.js';

test('manual backup manager creates a verified one-time streamed download', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-manual-backup-'));
  const dataDir = path.join(root, 'data');
  try {
    await fs.mkdir(dataDir, { recursive:true });
    await fs.writeFile(path.join(dataDir, 'printers.json'), JSON.stringify([{ id:'printer-1', name:'Test printer' }]));
    const manager = new ManualBackupManager({
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'missing-license.json'),
      controllerVersion:'0.23.0'
    });

    const created = await manager.create();
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.match(created.fileName, /\.pfcbackup$/);
    assert.equal(created.manifest.counts.printers, 1);
    assert.match(created.downloadUrl, /^\/api\/backup\/download\//);

    const pending = await manager.get(created.id);
    assert.ok(pending);
    assert.ok((await fs.stat(pending.filePath)).isFile());

    const response = new PassThrough();
    const chunks = [];
    let statusCode = null;
    let headers = null;
    response.writeHead = (status, values) => {
      statusCode = status;
      headers = values;
      return response;
    };
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    await manager.stream(created.id, response);
    assert.equal(statusCode, 200);
    assert.match(headers['content-type'], /print-farm-controller\.backup/);
    assert.match(headers['content-disposition'], /\.pfcbackup/);
    assert.equal(await manager.get(created.id), null);
    await assert.rejects(() => fs.stat(pending.filePath), /ENOENT/);

    const downloaded = path.join(root, 'downloaded.pfcbackup');
    await fs.writeFile(downloaded, Buffer.concat(chunks));
    const verified = await verifyBackupArchive(downloaded);
    assert.equal(verified.manifest.sourceControllerVersion, '0.23.0');

    const status = await manager.status();
    assert.equal(status.lastSuccessfulBackup.fileName, created.fileName);
    assert.equal(status.lastError, null);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('manual backup manager removes stale staging files and blocks concurrent creation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-manual-backup-clean-'));
  const dataDir = path.join(root, 'data');
  const stagingDir = path.join(dataDir, '.backup-staging');
  try {
    await fs.mkdir(stagingDir, { recursive:true });
    const stale = path.join(stagingDir, 'stale.pfcbackup');
    await fs.writeFile(stale, 'stale');
    const manager = new ManualBackupManager({
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'none'),
      controllerVersion:'0.23.0'
    });
    await manager.init();
    await assert.rejects(() => fs.stat(stale), /ENOENT/);

    manager.creating = true;
    await assert.rejects(
      () => manager.create(),
      (error) => error?.statusCode === 409 && /already being created/i.test(error.message)
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
