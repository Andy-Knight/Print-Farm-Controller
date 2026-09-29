import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  S3BackupClient,
  canonicalQuery,
  parseListObjectsV2
} from '../src/backup-recovery/s3-backup-client.js';

test('S3 configuration persists credentials without returning the secret', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-s3-config-'));
  try {
    const client = new S3BackupClient({ dataDir:root, fetchFn:async () => new Response(null, { status:200 }) });

    await assert.rejects(
      () => client.configure({
        endpoint:'http://127.0.0.1:9000',
        bucket:'pfc-backups',
        region:'us-east-1',
        accessKeyId:'pfc-access',
        secretAccessKey:'pfc-secret'
      }),
      (error) => error?.code === 'S3_INSECURE_HTTP_NOT_ALLOWED'
    );

    const status = await client.configure({
      endpoint:'http://127.0.0.1:9000',
      bucket:'pfc-backups',
      region:'us-east-1',
      accessKeyId:'pfc-access',
      secretAccessKey:'pfc-secret',
      prefix:'farm-a',
      addressingStyle:'path',
      allowInsecureHttp:true
    });

    assert.equal(status.configured, true);
    assert.equal(status.connected, true);
    assert.equal(status.endpoint, 'http://127.0.0.1:9000');
    assert.equal(status.bucket, 'pfc-backups');
    assert.equal(status.prefix, 'farm-a/');
    assert.equal(status.accessKeyId, 'pfc-access');
    assert.equal(status.secretAccessKeyConfigured, true);
    assert.equal(Object.hasOwn(status, 'secretAccessKey'), false);

    const stored = JSON.parse(await fs.readFile(path.join(root, 'integrations', 's3.json'), 'utf8'));
    assert.equal(stored.accessKeyId, 'pfc-access');
    assert.equal(stored.secretAccessKey, 'pfc-secret');
    assert.equal(stored.allowInsecureHttp, true);

    const resaved = await client.configure({
      endpoint:'http://127.0.0.1:9000',
      bucket:'pfc-backups',
      region:'us-east-1',
      accessKeyId:'pfc-access',
      secretAccessKey:'',
      prefix:'farm-b/',
      addressingStyle:'path',
      allowInsecureHttp:true
    });
    assert.equal(resaved.prefix, 'farm-b/');
    const after = JSON.parse(await fs.readFile(path.join(root, 'integrations', 's3.json'), 'utf8'));
    assert.equal(after.secretAccessKey, 'pfc-secret');

    await assert.rejects(
      () => client.configure({
        endpoint:'http://127.0.0.1:9000',
        bucket:'pfc-backups',
        region:'us-east-1',
        accessKeyId:'changed-access-key',
        secretAccessKey:'',
        prefix:'farm-b/',
        allowInsecureHttp:true
      }),
      (error) => error?.code === 'S3_SECRET_KEY_REQUIRED'
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('S3 requests use Signature Version 4 and canonical path-style addressing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-s3-signing-'));
  const requests = [];
  try {
    const client = new S3BackupClient({
      dataDir:root,
      nowFn:() => new Date('2026-09-29T20:00:00.000Z'),
      fetchFn:async (url, options = {}) => {
        requests.push({ url:String(url), options });
        return new Response(null, { status:200 });
      }
    });
    await client.configure({
      endpoint:'https://s3.example.test',
      bucket:'farm-backups',
      region:'eu-west-2',
      accessKeyId:'TESTACCESSKEY',
      secretAccessKey:'test-secret-key',
      prefix:'pfc/site one/',
      addressingStyle:'path'
    });

    const result = await client.testConnection();
    assert.equal(result.connected, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://s3.example.test/farm-backups/');
    const headers = requests[0].options.headers;
    assert.equal(headers.get('x-amz-date'), '20260929T200000Z');
    assert.equal(headers.get('x-amz-content-sha256'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.match(headers.get('authorization'), /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEY\/20260929\/eu-west-2\/s3\/aws4_request,/);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('S3 canonical query sorting and ListObjectsV2 parsing handle encoded keys', () => {
  assert.equal(
    canonicalQuery([['prefix','pfc/site one/'],['list-type','2'],['encoding-type','url']]),
    'encoding-type=url&list-type=2&prefix=pfc%2Fsite%20one%2F'
  );

  const parsed = parseListObjectsV2(`<?xml version="1.0" encoding="UTF-8"?>
    <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <IsTruncated>true</IsTruncated>
      <Contents>
        <Key>pfc%2Fsite%20one%2Fbackup.pfcbackup</Key>
        <LastModified>2026-09-29T20:00:00.000Z</LastModified>
        <ETag>&quot;abc123&quot;</ETag>
        <Size>42</Size>
      </Contents>
      <NextContinuationToken>next&amp;token</NextContinuationToken>
    </ListBucketResult>`);

  assert.equal(parsed.isTruncated, true);
  assert.equal(parsed.nextContinuationToken, 'next&token');
  assert.deepEqual(parsed.objects, [{
    key:'pfc/site one/backup.pfcbackup',
    size:42,
    lastModified:'2026-09-29T20:00:00.000Z',
    etag:'abc123'
  }]);
});
