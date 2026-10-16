import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  LICENSE_DOCUMENT_FORMAT, LICENSE_DOCUMENT_VERSION,
  canonicalizeLicensePayload, evaluateLicenseDates,
  parseLicenseDocument, validateLicensePayload
} from '../src/licensing/license-file.js';
import { verifyLicenseDocument } from '../src/licensing/signature-verifier.js';
import { loadLicenseManager } from '../src/licensing/license-loader.js';

const at = new Date('2026-10-16T10:00:00Z');

function payload(overrides = {}) {
  return {
    licenseId:'PC-AUDIT-001',
    product:'print-controller',
    customer:'Audit Test Farm',
    edition:'pro',
    maxPrinters:5,
    licenseType:'perpetual',
    issuedAt:'2026-09-18',
    expiresAt:null,
    updatesUntil:'2027-09-18',
    features:['automation.auto_transfer'],
    ...overrides
  };
}
function signingKeys() {
  const keys = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey:keys.privateKey,
    publicKey:keys.publicKey.export({type:'spki', format:'pem'})
  };
}
function signed(p, privateKey, keyId = 'audit-key') {
  return {
    format:LICENSE_DOCUMENT_FORMAT,
    version:LICENSE_DOCUMENT_VERSION,
    payload:p,
    signature:{
      algorithm:'Ed25519',
      keyId,
      value:crypto.sign(null, Buffer.from(canonicalizeLicensePayload(p), 'utf8'), privateKey).toString('base64')
    }
  };
}
async function withInstall(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-licence-audit-'));
  const dataDir = path.join(root, 'data');
  try {
    await fs.mkdir(dataDir, {recursive:true});
    return await callback({
      root, dataDir,
      write:async (document) => fs.writeFile(path.join(dataDir, 'license.json'), JSON.stringify(document)),
      load:(keys, env = {}) => loadLicenseManager({
        appDir:root, dataDir, trustedPublicKeys:keys, env, now:at
      })
    });
  } finally {
    await fs.rm(root, {recursive:true, force:true});
  }
}

test('a signed licence applies its precise printer cap and excludes simulator printers from slots', async () => {
  await withInstall(async ({write, load}) => {
    const keys = signingKeys();
    await write(signed(payload(), keys.privateKey));
    const manager = await load({'audit-key':keys.publicKey});
    assert.equal(manager.edition, 'pro');
    assert.equal(manager.maxPrinters, 5);
    assert.equal(manager.getSnapshot().licenseStatus, 'valid');
    assert.equal(manager.hasFeature('automation.auto_transfer'), true);
    assert.equal(manager.canAddPrinter(4), true);
    assert.equal(manager.canAddPrinter(5), false);
    assert.throws(() => manager.requirePrinterCapacity(5), (error) => error.code === 'LICENSE_PRINTER_LIMIT');
    const fleet = [
      ...Array.from({length:6}, (_, i) => ({id:'p'+i, licenseSlotActive:i<5})),
      {id:'sim1', simulated:true}, {id:'sim2', simulated:true}
    ];
    const access = manager.resolvePrinterAccess(fleet);
    assert.equal(access.configuredPhysicalPrinters, 6);
    assert.equal(access.activePhysicalPrinters, 5);
    assert.equal(access.simulatedPrinters, 2);
    assert.equal(access.overLimit, true);
    assert.equal(access.selectionRequired, false);
    assert.equal(access.printers.find((p) => p.id === 'p5')?.licenseActive, false);
    assert.ok(access.printers.filter((p) => p.simulated).every((p) => p.licenseActive));
  });
});

test('tampering with each privilege-bearing field fails closed to Community in the installed licence loader', async () => {
  await withInstall(async ({write, load}) => {
    const keys = signingKeys();
    const original = signed(payload(), keys.privateKey);
    const trusted = {'audit-key':keys.publicKey};
    const mutations = [
      ['edition', (p) => { p.edition = 'farm'; }],
      ['printer cap', (p) => { p.maxPrinters = 25; }],
      ['features', (p) => { p.features.push('fleet.admin'); }],
      ['licence type', (p) => { p.licenseType = 'subscription'; p.expiresAt = '2028-01-01'; }],
      ['expiry/update date', (p) => { p.updatesUntil = '2035-01-01'; }]
    ];
    for (const [name, mutate] of mutations) {
      const changed = structuredClone(original);
      mutate(changed.payload);
      await write(changed);
      assert.throws(
        () => verifyLicenseDocument(changed, {publicKeys:trusted, now:at}),
        (error) => error.code === 'LICENSE_SIGNATURE_INVALID',
        name
      );
      const manager = await load(trusted, {
        PRINT_CONTROLLER_EDITION:'development',
        PRINT_CONTROLLER_LICENSE_PUBLIC_KEY_FILE:'/this/key/is/not/trusted'
      });
      const snapshot = manager.getSnapshot();
      assert.equal(snapshot.edition, 'community', name);
      assert.equal(snapshot.licenseStatus, 'invalid', name);
      assert.equal(snapshot.enforcementEnabled, true, name);
      assert.equal(snapshot.maxPrinters, 3, name);
      assert.equal(manager.hasFeature('automation.auto_transfer'), false, name);
      assert.equal(manager.canAddPrinter(3), false, name);
    }
  });
});

test('unknown key IDs and signatures from an untrusted Ed25519 signer cannot elevate Community', async () => {
  await withInstall(async ({write, load}) => {
    const trusted = signingKeys();
    const rogue = signingKeys();
    const trustedMap = {'trusted':trusted.publicKey};
    for (const document of [
      signed(payload(), rogue.privateKey, 'rogue'),
      signed(payload(), rogue.privateKey, 'trusted')
    ]) {
      await write(document);
      const manager = await load(trustedMap);
      const status = manager.getSnapshot();
      assert.equal(status.edition, 'community');
      assert.equal(status.enforcementEnabled, true);
      assert.equal(status.licenseStatus, 'invalid');
    }
    await write(signed(payload(), trusted.privateKey, 'trusted'));
    assert.equal((await load(trustedMap)).edition, 'pro', 'valid signature still works after negative cases');
  });
});

test('an expired signed subscription keeps identity but disables paid privileges and remains capped', async () => {
  await withInstall(async ({write, load}) => {
    const keys = signingKeys();
    await write(signed(payload({
      licenseType:'subscription', expiresAt:'2026-10-15'
    }), keys.privateKey));
    const snapshot = (await load({'audit-key':keys.publicKey})).getSnapshot();
    assert.equal(snapshot.edition, 'community');
    assert.equal(snapshot.licenseStatus, 'expired');
    assert.equal(snapshot.licenseId, 'PC-AUDIT-001');
    assert.equal(snapshot.maxPrinters, 3);
    assert.equal(snapshot.enforcementEnabled, true);
  });
});

test('fault injection: bypassing Ed25519 verification lets a tampered payload through', () => {
  const keys = signingKeys();
  const original = signed(payload(), keys.privateKey);
  const altered = structuredClone(original);
  altered.payload.maxPrinters = 25;
  const trusted = {'audit-key':keys.publicKey};
  assert.throws(() => verifyLicenseDocument(altered, {publicKeys:trusted, now:at}),
    (error) => error.code === 'LICENSE_SIGNATURE_INVALID');

  const source = readFileSync(new URL('../src/licensing/signature-verifier.js', import.meta.url), 'utf8');
  const start = source.indexOf('function licenceError(');
  assert.ok(start >= 0, 'production verifier implementation located');
  const liveCode = source.slice(start).replace('export function verifyLicenseDocument', 'function verifyLicenseDocument');
  const badCode = liveCode.replace(
    'const validSignature = crypto.verify(null, signedBytes, keyObject, signature);',
    'const validSignature = true;'
  );
  assert.notEqual(badCode, liveCode, 'fault injection must affect actual crypto signature check');
  const unsafeVerify = runInNewContext(badCode + '\nverifyLicenseDocument;', {
    crypto, Buffer, canonicalizeLicensePayload, evaluateLicenseDates,
    parseLicenseDocument, validateLicensePayload, String, Error, Date, Object
  });
  const bypassed = unsafeVerify(altered, {publicKeys:trusted, now:at});
  assert.equal(bypassed.valid, true);
  assert.equal(bypassed.payload.maxPrinters, 25,
    'the mutated verifier would grant the tampered 25-printer entitlement');
});
