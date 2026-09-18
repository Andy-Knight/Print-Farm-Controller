import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  LICENSE_DOCUMENT_FORMAT,
  LICENSE_DOCUMENT_VERSION,
  canonicalizeLicensePayload,
  parseLicenseDocument,
  validateLicensePayload
} from '../src/licensing/license-file.js';
import { verifyLicenseDocument } from '../src/licensing/signature-verifier.js';

function testKeys() {
  return crypto.generateKeyPairSync('ed25519');
}

function payload(overrides = {}) {
  return {
    licenseId:'PC-TEST-0001',
    product:'print-controller',
    customer:'Test Print Farm',
    edition:'pro',
    maxPrinters:10,
    licenseType:'perpetual',
    issuedAt:'2026-09-18',
    expiresAt:null,
    updatesUntil:'2027-09-18',
    features:['fleet.statistics','fleet.history'],
    ...overrides
  };
}

function signedDocument(licensePayload, privateKey, { keyId = 'test-2026' } = {}) {
  const signature = crypto.sign(
    null,
    Buffer.from(canonicalizeLicensePayload(licensePayload), 'utf8'),
    privateKey
  ).toString('base64');

  return {
    format:LICENSE_DOCUMENT_FORMAT,
    version:LICENSE_DOCUMENT_VERSION,
    payload:licensePayload,
    signature:{
      algorithm:'Ed25519',
      keyId,
      value:signature
    }
  };
}

test('canonical payload is independent of object key order', () => {
  const left = { z:3, a:{ y:2, x:1 }, list:[3,2,1] };
  const right = { list:[3,2,1], a:{ x:1, y:2 }, z:3 };
  assert.equal(canonicalizeLicensePayload(left), canonicalizeLicensePayload(right));
});

test('licence parser accepts the versioned signed envelope', () => {
  const { privateKey } = testKeys();
  const document = signedDocument(payload(), privateKey);
  const parsed = parseLicenseDocument(JSON.stringify(document));
  assert.equal(parsed.format, 'print-controller-license');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.signature.algorithm, 'Ed25519');
  assert.equal(parsed.signature.keyId, 'test-2026');
});

test('payload validation rejects development licences and wrong products', () => {
  assert.throws(
    () => validateLicensePayload(payload({ edition:'development' })),
    (error) => error.code === 'LICENSE_INVALID_EDITION'
  );
  assert.throws(
    () => validateLicensePayload(payload({ product:'something-else' })),
    (error) => error.code === 'LICENSE_WRONG_PRODUCT'
  );
});

test('valid Ed25519 signed licence verifies successfully', () => {
  const { publicKey, privateKey } = testKeys();
  const document = signedDocument(payload(), privateKey);
  const result = verifyLicenseDocument(document, {
    publicKey,
    now:new Date('2026-09-18T12:00:00Z')
  });
  assert.equal(result.validSignature, true);
  assert.equal(result.valid, true);
  assert.equal(result.status, 'valid');
  assert.equal(result.payload.edition, 'pro');
  assert.equal(result.payload.maxPrinters, 10);
});

test('tampering with signed licence payload is rejected', () => {
  const { publicKey, privateKey } = testKeys();
  const document = signedDocument(payload(), privateKey);
  document.payload.edition = 'farm';
  document.payload.maxPrinters = 25;

  assert.throws(
    () => verifyLicenseDocument(document, { publicKey }),
    (error) => error.code === 'LICENSE_SIGNATURE_INVALID'
  );
});

test('key IDs allow public key rotation', () => {
  const first = testKeys();
  const second = testKeys();
  const document = signedDocument(payload(), second.privateKey, { keyId:'key-2' });
  const result = verifyLicenseDocument(document, {
    publicKeys:{
      'key-1':first.publicKey,
      'key-2':second.publicKey
    }
  });
  assert.equal(result.valid, true);
  assert.equal(result.keyId, 'key-2');
});

test('expired subscription keeps a valid signature but reports expired status', () => {
  const { publicKey, privateKey } = testKeys();
  const document = signedDocument(payload({
    licenseType:'subscription',
    expiresAt:'2026-09-17'
  }), privateKey);
  const result = verifyLicenseDocument(document, {
    publicKey,
    now:new Date('2026-09-18T12:00:00Z')
  });
  assert.equal(result.validSignature, true);
  assert.equal(result.valid, false);
  assert.equal(result.status, 'expired');
  assert.equal(result.expired, true);
});

test('subscription licence requires an expiry date', () => {
  assert.throws(
    () => validateLicensePayload(payload({ licenseType:'subscription', expiresAt:null })),
    (error) => error.code === 'LICENSE_INVALID_EXPIRY'
  );
});
