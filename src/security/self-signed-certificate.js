/**
 * Minimal dependency-free X.509 v3 certificate issuer for a local TLS server.
 * Node exposes key generation/signing and X.509 validation but not certificate
 * issuance. This DER encoder intentionally supports only P-256/ECDSA-SHA256.
 * Never use these certificates as a CA or for signing other identities.
 */
import {generateKeyPairSync, randomBytes, sign, X509Certificate, createPrivateKey} from 'node:crypto';
import {isIP} from 'node:net';

const part = (type, data) => {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let n = bytes.length;
  const octets = [];
  do { octets.unshift(n & 255); n = Math.floor(n / 256); } while (n);
  const len = bytes.length < 128 ? Buffer.from([bytes.length]) :
    Buffer.from([128 | octets.length, ...octets]);
  return Buffer.concat([Buffer.from([type]), len, bytes]);
};
const join = (...parts) => Buffer.concat(parts);
const sequence = (...parts) => part(0x30, join(...parts));
const set = (...parts) => part(0x31, join(...parts));
const integer = (bytes) => {
  let b = Buffer.isBuffer(bytes) ? bytes : Buffer.from([bytes]);
  while (b.length > 1 && b[0] === 0 && b[1] < 128) b = b.subarray(1);
  return part(0x02, b[0] >= 128 ? join(Buffer.from([0]), b) : b);
};
const oid = (value) => {
  const numbers = value.split('.').map(Number);
  if (numbers.length < 2 || numbers[0] > 2 || numbers.some(n => !Number.isSafeInteger(n) || n < 0))
    throw new Error('Invalid certificate OID');
  const codes = [numbers[0] * 40 + numbers[1], ...numbers.slice(2)];
  const bytes = [];
  for (let n of codes) {
    const items = [n & 127]; n = Math.floor(n / 128);
    while (n) { items.unshift((n & 127) | 128); n = Math.floor(n / 128); }
    bytes.push(...items);
  }
  return part(0x06, Buffer.from(bytes));
};
const bitString = (bytes) => part(0x03, join(Buffer.from([0]), bytes));
const octetString = (bytes) => part(0x04, bytes);
const utcDate = (date) => {
  const year = date.getUTCFullYear();
  const str = String(year % 100).padStart(2, '0') +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    String(date.getUTCDate()).padStart(2, '0') +
    String(date.getUTCHours()).padStart(2, '0') +
    String(date.getUTCMinutes()).padStart(2, '0') +
    String(date.getUTCSeconds()).padStart(2, '0') + 'Z';
  return year >= 2050 ? part(0x18, Buffer.from(String(year) + str.slice(2), 'ascii')) :
    part(0x17, Buffer.from(str, 'ascii'));
};
const extension = (name, contents, critical = false) => sequence(
  oid(name), ...(critical ? [part(0x01, Buffer.from([0xff]))] : []), octetString(contents)
);

export function normalizeCertificateNames(input) {
  const names = Array.isArray(input) ? input : String(input || '').split(',');
  const unique = new Set();
  for (const raw of names) {
    const name = String(raw).trim().toLowerCase();
    if (!name || name.length > 253 || /[\u0000-\u0020,;/\\]/.test(name))
      throw new Error('Invalid HTTPS hostname or IP address');
    const ip = isIP(name);
    if (ip === 6) throw new Error('IPv6 SANs are not yet supported; use a DNS name or IPv4 address');
    if (!ip && (!name.split('.').every(label =>
      label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))))
      throw new Error('Invalid HTTPS DNS name: ' + name);
    unique.add(name);
    if (unique.size > 24) throw new Error('Too many HTTPS certificate names (maximum 24)');
  }
  if (!unique.size) throw new Error('At least one HTTPS certificate name is required');
  return [...unique];
}

export function createSelfSignedCertificate({names, now = new Date()} = {}) {
  const hosts = normalizeCertificateNames(names);
  const {publicKey, privateKey} = generateKeyPairSync('ec', {
    namedCurve:'prime256v1',
    publicKeyEncoding:{type:'spki',format:'der'},
    privateKeyEncoding:{type:'pkcs8',format:'pem'}
  });
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  if (serial[0] === 0) serial[0] = 1;
  const signatureAlgorithm = sequence(oid('1.2.840.10045.4.3.2')); // ecdsaWithSHA256
  const commonName = hosts[0].slice(0, 64);
  const subject = sequence(set(sequence(oid('2.5.4.3'),part(0x0c, Buffer.from(commonName, 'utf8')))));
  const san = sequence(...hosts.map(host => {
    if (isIP(host) === 4) return part(0x87, Buffer.from(host.split('.').map(Number)));
    return part(0x82, Buffer.from(host, 'ascii'));
  }));
  const extensions = sequence(
    extension('2.5.29.19', sequence(), true), // CA:FALSE
    extension('2.5.29.15', bitString(Buffer.from([0x80])), true), // digitalSignature
    extension('2.5.29.37', sequence(oid('1.3.6.1.5.5.7.3.1'))), // serverAuth
    extension('2.5.29.17', san) // subjectAlternativeName
  );
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  const until = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  const tbs = sequence(
    part(0xa0, integer(Buffer.from([2]))), integer(serial), signatureAlgorithm,
    subject, sequence(utcDate(from), utcDate(until)), subject, publicKey,
    part(0xa3, extensions)
  );
  const signature = sign('sha256', tbs, createPrivateKey(privateKey));
  const der = sequence(tbs, signatureAlgorithm, bitString(signature));
  const x509 = new X509Certificate(der); // Refuse to save a malformed certificate
  if (!x509.checkPrivateKey(createPrivateKey(privateKey)) || !x509.verify(x509.publicKey))
    throw new Error('Generated HTTPS certificate validation failed');
  for (const host of hosts) {
    if (isIP(host) ? !x509.checkIP(host) : !x509.checkHost(host))
      throw new Error('HTTPS certificate is missing a requested subject alternative name');
  }
  const pem = '-----BEGIN CERTIFICATE-----\n' +
    der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  return {cert:pem,key:privateKey,names:hosts};
}
