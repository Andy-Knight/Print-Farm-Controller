import crypto from 'node:crypto';
import {
  canonicalizeLicensePayload,
  evaluateLicenseDates,
  parseLicenseDocument,
  validateLicensePayload
} from './license-file.js';

function licenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolvePublicKey({ publicKey = null, publicKeys = null, keyId = null } = {}) {
  if (publicKey) return publicKey;
  if (publicKeys && typeof publicKeys === 'object') {
    if (!keyId) throw licenceError('LICENSE_KEY_ID_REQUIRED', 'Licence signature does not identify a verification key');
    const resolved = publicKeys[keyId];
    if (resolved) return resolved;
    throw licenceError('LICENSE_UNKNOWN_KEY', `No public verification key is configured for key ID "${keyId}"`);
  }
  throw licenceError('LICENSE_PUBLIC_KEY_MISSING', 'No licence public verification key is configured');
}

function decodeSignature(value) {
  const signature = Buffer.from(value, 'base64');
  if (!signature.length || signature.toString('base64').replace(/=+$/,'') !== value.replace(/=+$/,'')) {
    throw licenceError('LICENSE_INVALID_SIGNATURE', 'Licence signature is not valid base64');
  }
  return signature;
}

export function verifyLicenseDocument(input, {
  publicKey = null,
  publicKeys = null,
  now = new Date()
} = {}) {
  const document = parseLicenseDocument(input);
  const payload = validateLicensePayload(document.payload);
  const verificationKey = resolvePublicKey({
    publicKey,
    publicKeys,
    keyId: document.signature.keyId
  });

  let keyObject;
  try {
    keyObject = crypto.createPublicKey(verificationKey);
  } catch {
    throw licenceError('LICENSE_PUBLIC_KEY_INVALID', 'Configured licence public key is invalid');
  }

  if (keyObject.asymmetricKeyType !== 'ed25519') {
    throw licenceError('LICENSE_PUBLIC_KEY_INVALID', 'Licence public key must be an Ed25519 key');
  }

  const signedBytes = Buffer.from(canonicalizeLicensePayload(document.payload), 'utf8');
  const signature = decodeSignature(document.signature.value);
  const validSignature = crypto.verify(null, signedBytes, keyObject, signature);
  if (!validSignature) {
    throw licenceError('LICENSE_SIGNATURE_INVALID', 'Licence signature verification failed');
  }

  const dates = evaluateLicenseDates(payload, now);
  return {
    valid: !dates.expired,
    validSignature: true,
    status: dates.expired ? 'expired' : 'valid',
    payload,
    keyId: document.signature.keyId,
    ...dates
  };
}
