import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { S3BackupClient } from '../src/backup-recovery/s3-backup-client.js';

const enabled = Boolean(
  process.env.PFC_TEST_S3_ENDPOINT
  && process.env.PFC_TEST_S3_BUCKET
  && process.env.PFC_TEST_S3_ACCESS_KEY
  && process.env.PFC_TEST_S3_SECRET_KEY
);

test('S3 client completes backup, list, restore download and retention against MinIO', { skip:!enabled }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-s3-minio-'));
  try {
    const client = new S3BackupClient({ dataDir:root });
    await client.configure({
      endpoint:process.env.PFC_TEST_S3_ENDPOINT,
      bucket:process.env.PFC_TEST_S3_BUCKET,
      region:process.env.PFC_TEST_S3_REGION || 'us-east-1',
      accessKeyId:process.env.PFC_TEST_S3_ACCESS_KEY,
      secretAccessKey:process.env.PFC_TEST_S3_SECRET_KEY,
      prefix:`integration-${Date.now()}/`,
      addressingStyle:'path',
      allowInsecureHttp:true
    });

    const connection = await client.testConnection();
    assert.equal(connection.connected, true);

    const installationId = '11111111-1111-4111-8111-111111111111';
    const files = [];
    for (const [index, source] of [['1','scheduled'],['2','scheduled'],['3','scheduled'],['manual','manual']]) {
      const fileName = `minio-${index}.pfcbackup`;
      const filePath = path.join(root, fileName);
      const payload = Buffer.from(`backup-payload-${index}`);
      await fs.writeFile(filePath, payload);
      const createdAt = new Date(Date.parse('2026-09-29T20:00:00.000Z') + (Number(index) || 4) * 1000).toISOString();
      const uploaded = await client.uploadBackup({
        filePath,
        fileName,
        manifest:{
          backupId:`33333333-3333-4333-8333-33333333333${index === 'manual' ? '4' : index}`,
          installationId,
          backupSource:source,
          createdAt,
          formatVersion:1,
          sourceControllerVersion:'0.35.0'
        }
      });
      files.push({ fileName, uploaded, payload, source });
    }

    let listed = await client.listBackups();
    assert.equal(listed.length, 4);
    assert.equal(listed.filter((item) => item.appProperties.backupSource === 'scheduled').length, 3);
    assert.equal(listed.filter((item) => item.appProperties.backupSource === 'manual').length, 1);

    const restoreTarget = listed.find((item) => item.name === 'minio-3.pfcbackup');
    assert.ok(restoreTarget);
    const downloaded = await client.downloadBackup(restoreTarget.id);
    assert.deepEqual(await fs.readFile(downloaded.filePath), Buffer.from('backup-payload-3'));
    await downloaded.cleanup();

    const retention = await client.pruneScheduledBackups({
      installationId,
      retentionCount:2,
      newestFileId:restoreTarget.id
    });
    assert.equal(retention.deleted.length, 1);
    assert.equal(retention.eligible, 3);
    assert.equal(retention.kept, 2);

    listed = await client.listBackups();
    assert.equal(listed.filter((item) => item.appProperties.backupSource === 'scheduled').length, 2);
    assert.equal(listed.filter((item) => item.appProperties.backupSource === 'manual').length, 1);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
