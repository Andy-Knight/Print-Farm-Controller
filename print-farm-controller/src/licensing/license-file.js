import { getEditionDefinition } from './entitlements.js';

export const LICENSE_DOCUMENT_FORMAT = 'print-controller-license';
export const LICENSE_DOCUMENT_VERSION = 1;
export const LICENSE_SIGNATURE_ALGORITHM = 'Ed25519';

function licenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw licenceError('LICENSE_INVALID_JSON', 'Licence document must contain valid JSON data');
  }
}

function parseDate(value, fieldName, { nullable = true } = {}) {
  if (value == null && nullable) return null;
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw licenceError('LICENSE_INVALID_DATE', `${fieldName} must use YYYY-MM-DD format`);
  }
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    throw licenceError('LICENSE_INVALID_DATE', `${fieldName} is not a valid calendar date`);
  }
  return text;
}

function normalizeFeatures(features) {
  if (features == null) return null;
  if (!Array.isArray(features)) {
    throw licenceError('LICENSE_INVALID_FEATURES', 'features must be an array when supplied');
  }
  const normalized = features.map((feature) => String(feature || '').trim());
  if (normalized.some((feature) => !feature || feature.length > 120)) {
    throw licenceError('LICENSE_INVALID_FEATURES', 'features contains an invalid feature name');
  }
  return [...new Set(normalized)].sort();
}

export function canonicalizeJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw licenceError('LICENSE_INVALID_NUMBER', 'Licence JSON cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  if (!isPlainObject(value)) throw licenceError('LICENSE_INVALID_VALUE', 'Licence JSON contains an unsupported value type');

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`;
}

export function canonicalizeLicensePayload(payload) {
  if (!isPlainObject(payload)) {
    throw licenceError('LICENSE_INVALID_PAYLOAD', 'Licence payload must be a JSON object');
  }
  return canonicalizeJson(payload);
}

export function parseLicenseDocument(input) {
  let parsed;
  if (Buffer.isBuffer(input)) input = input.toString('utf8');

  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw licenceError('LICENSE_INVALID_JSON', 'Licence file is not valid JSON');
    }
  } else if (isPlainObject(input)) {
    parsed = cloneJson(input);
  } else {
    throw licenceError('LICENSE_INVALID_DOCUMENT', 'Licence document must be JSON text, a Buffer, or an object');
  }

  if (!isPlainObject(parsed)) {
    throw licenceError('LICENSE_INVALID_DOCUMENT', 'Licence document must be a JSON object');
  }
  if (parsed.format !== LICENSE_DOCUMENT_FORMAT) {
    throw licenceError('LICENSE_INVALID_FORMAT', `Licence format must be "${LICENSE_DOCUMENT_FORMAT}"`);
  }
  if (Number(parsed.version) !== LICENSE_DOCUMENT_VERSION) {
    throw licenceError('LICENSE_UNSUPPORTED_VERSION', `Unsupported licence document version: ${parsed.version}`);
  }
  if (!isPlainObject(parsed.payload)) {
    throw licenceError('LICENSE_INVALID_PAYLOAD', 'Licence document is missing its payload');
  }
  if (!isPlainObject(parsed.signature)) {
    throw licenceError('LICENSE_INVALID_SIGNATURE', 'Licence document is missing its signature');
  }

  const algorithm = String(parsed.signature.algorithm || '').trim();
  if (algorithm !== LICENSE_SIGNATURE_ALGORITHM) {
    throw licenceError('LICENSE_UNSUPPORTED_SIGNATURE', `Licence signature algorithm must be ${LICENSE_SIGNATURE_ALGORITHM}`);
  }
  const value = String(parsed.signature.value || '').trim();
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw licenceError('LICENSE_INVALID_SIGNATURE', 'Licence signature is not valid base64');
  }

  return {
    format: parsed.format,
    version: LICENSE_DOCUMENT_VERSION,
    payload: parsed.payload,
    signature: {
      algorithm,
      keyId: String(parsed.signature.keyId || '').trim() || null,
      value
    }
  };
}

export function validateLicensePayload(payload) {
  if (!isPlainObject(payload)) {
    throw licenceError('LICENSE_INVALID_PAYLOAD', 'Licence payload must be a JSON object');
  }

  const product = String(payload.product || '').trim();
  if (product !== 'print-controller') {
    throw licenceError('LICENSE_WRONG_PRODUCT', 'Licence is not for Print Controller');
  }

  const licenseId = String(payload.licenseId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$/.test(licenseId)) {
    throw licenceError('LICENSE_INVALID_ID', 'Licence ID is missing or invalid');
  }

  const customer = String(payload.customer || '').trim();
  if (!customer || customer.length > 160) {
    throw licenceError('LICENSE_INVALID_CUSTOMER', 'Licence customer is missing or too long');
  }

  const edition = String(payload.edition || '').trim().toLowerCase();
  const editionDefinition = getEditionDefinition(edition);
  if (!editionDefinition || edition === 'development') {
    throw licenceError('LICENSE_INVALID_EDITION', 'Signed licences must use Community, Pro, or Farm edition');
  }

  const maxPrinters = Number(payload.maxPrinters);
  if (!Number.isInteger(maxPrinters) || maxPrinters < 1 || maxPrinters > 10_000) {
    throw licenceError('LICENSE_INVALID_PRINTER_LIMIT', 'maxPrinters must be a whole number from 1 to 10000');
  }

  const licenseType = String(payload.licenseType || '').trim().toLowerCase();
  if (!['perpetual', 'subscription'].includes(licenseType)) {
    throw licenceError('LICENSE_INVALID_TYPE', 'licenseType must be perpetual or subscription');
  }

  const issuedAt = parseDate(payload.issuedAt, 'issuedAt', { nullable: false });
  const expiresAt = parseDate(payload.expiresAt, 'expiresAt');
  const updatesUntil = parseDate(payload.updatesUntil, 'updatesUntil');
  if (licenseType === 'subscription' && !expiresAt) {
    throw licenceError('LICENSE_INVALID_EXPIRY', 'Subscription licences require expiresAt');
  }

  const features = normalizeFeatures(payload.features);

  return {
    ...cloneJson(payload),
    licenseId,
    product,
    customer,
    edition,
    maxPrinters,
    licenseType,
    issuedAt,
    expiresAt,
    updatesUntil,
    ...(features ? { features } : {})
  };
}

function endOfUtcDate(dateText) {
  return Date.parse(`${dateText}T23:59:59.999Z`);
}

export function evaluateLicenseDates(payload, now = new Date()) {
  const validated = validateLicensePayload(payload);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw licenceError('LICENSE_INVALID_NOW', 'Could not evaluate licence dates');

  const nowMs = current.getTime();
  return {
    expired: Boolean(validated.expiresAt && nowMs > endOfUtcDate(validated.expiresAt)),
    updatesExpired: Boolean(validated.updatesUntil && nowMs > endOfUtcDate(validated.updatesUntil)),
    expiresAt: validated.expiresAt,
    updatesUntil: validated.updatesUntil
  };
}
