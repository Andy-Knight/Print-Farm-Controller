import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LICENSE_DOCUMENT_FORMAT,
  LICENSE_DOCUMENT_VERSION,
  canonicalizeLicensePayload
} from '../src/licensing/license-file.js';
import { loadLicenseManager } from '../src/licensing/license-loader.js';

async function tempDir(prefix = 'print-controller-license-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function createSignedDocument(payload, privateKey, keyId = 'test-key') {
  return {
    format:LICENSE_DOCUMENT_FORMAT,
    version:LICENSE_DOCUMENT_VERSION,
    payload,
    signature:{
      algorithm:'Ed25519',
      keyId,
      value:crypto.sign(
        null,
        Buffer.from(canonicalizeLicensePayload(payload), 'utf8'),
        privateKey
      ).toString('base64')
    }
  };
}

function proPayload(overrides = {}) {
  return {
    licenseId:'PC-LOAD-0001',
    product:'print-controller',
    customer:'Loader Test Farm',
    edition:'pro',
    maxPrinters:7,
    licenseType:'perpetual',
    issuedAt:'2026-09-18',
    expiresAt:null,
    updatesUntil:'2027-09-18',
    features:['automation.auto_transfer'],
    ...overrides
  };
}

async function writeSignedLicense(directory, document) {
  await fs.mkdir(directory, { recursive:true });
  await fs.writeFile(path.join(directory, 'license.json'), JSON.stringify(document), 'utf8');
}

test('no installed licence falls back to Community and points at application directory', async () => {
  const appDir = await tempDir();
  const dataDir = await tempDir('print-controller-data-');
  const manager = await loadLicenseManager({ appDir, dataDir, env:{} });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.edition, 'community');
  assert.equal(snapshot.licenseStatus, 'not-installed');
  assert.equal(snapshot.enforcementEnabled, true);
  assert.equal(snapshot.licenseFile, path.join(appDir, 'license.json'));
  assert.match(snapshot.configurationWarning, /no signed licence/i);
});

test('environment edition override remains available for development', async () => {
  const appDir = await tempDir();
  const manager = await loadLicenseManager({
    appDir,
    env:{ PRINT_CONTROLLER_EDITION:'development' }
  });

  assert.equal(manager.edition, 'development');
  assert.equal(manager.enforcementEnabled, false);
  assert.equal(manager.getSnapshot().licenseStatus, 'development-override');
});

test('valid signed licence is loaded from the application directory', async () => {
  const appDir = await tempDir();
  const dataDir = await tempDir('print-controller-data-');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type:'spki', format:'pem' });
  const document = createSignedDocument(proPayload(), privateKey);
  await writeSignedLicense(appDir, document);

  const manager = await loadLicenseManager({
    appDir,
    dataDir,
    env:{},
    trustedPublicKeys:{ 'test-key':publicPem },
    now:new Date('2026-09-18T12:00:00Z')
  });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.edition, 'pro');
  assert.equal(snapshot.maxPrinters, 7);
  assert.equal(snapshot.licenseStatus, 'valid');
  assert.equal(snapshot.licenseId, 'PC-LOAD-0001');
  assert.equal(snapshot.customer, 'Loader Test Farm');
  assert.equal(snapshot.licenseFile, path.join(appDir, 'license.json'));
  assert.equal(snapshot.configurationWarning, null);
  assert.equal(manager.hasFeature('automation.auto_transfer'), true);
  assert.equal(manager.hasFeature('printer.basic_control'), true);
});

test('application-directory licence takes priority over legacy data-directory licence', async () => {
  const appDir = await tempDir();
  const dataDir = await tempDir('print-controller-data-');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type:'spki', format:'pem' });

  await writeSignedLicense(appDir, createSignedDocument(proPayload({
    licenseId:'PC-APP-0001',
    edition:'pro',
    maxPrinters:10
  }), privateKey));
  await writeSignedLicense(dataDir, createSignedDocument(proPayload({
    licenseId:'PC-DATA-0001',
    edition:'farm',
    maxPrinters:25
  }), privateKey));

  const manager = await loadLicenseManager({
    appDir,
    dataDir,
    env:{},
    trustedPublicKeys:{ 'test-key':publicPem }
  });

  assert.equal(manager.edition, 'pro');
  assert.equal(manager.maxPrinters, 10);
  assert.equal(manager.getSnapshot().licenseId, 'PC-APP-0001');
});

test('legacy data-directory licence is accepted temporarily when application licence is absent', async () => {
  const appDir = await tempDir();
  const dataDir = await tempDir('print-controller-data-');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type:'spki', format:'pem' });
  const document = createSignedDocument(proPayload(), privateKey);
  await writeSignedLicense(dataDir, document);

  const manager = await loadLicenseManager({
    appDir,
    dataDir,
    env:{},
    trustedPublicKeys:{ 'test-key':publicPem }
  });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.edition, 'pro');
  assert.equal(snapshot.licenseFile, path.join(dataDir, 'license.json'));
  assert.match(snapshot.configurationWarning, /previous data-directory location/i);
});

test('tampered signed licence fails closed to Community', async () => {
  const appDir = await tempDir();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type:'spki', format:'pem' });
  const document = createSignedDocument(proPayload(), privateKey);
  document.payload.maxPrinters = 500;
  await writeSignedLicense(appDir, document);

  const manager = await loadLicenseManager({
    appDir,
    env:{},
    trustedPublicKeys:{ 'test-key':publicPem }
  });

  assert.equal(manager.edition, 'community');
  assert.equal(manager.getSnapshot().licenseStatus, 'invalid');
});

test('expired subscription fails closed to Community but retains licence identity', async () => {
  const appDir = await tempDir();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type:'spki', format:'pem' });
  const document = createSignedDocument(proPayload({
    licenseType:'subscription',
    expiresAt:'2026-09-17'
  }), privateKey);
  await writeSignedLicense(appDir, document);

  const manager = await loadLicenseManager({
    appDir,
    env:{},
    trustedPublicKeys:{ 'test-key':publicPem },
    now:new Date('2026-09-18T12:00:00Z')
  });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.edition, 'community');
  assert.equal(snapshot.licenseStatus, 'expired');
  assert.equal(snapshot.licenseId, 'PC-LOAD-0001');
  assert.equal(snapshot.customer, 'Loader Test Farm');
});
