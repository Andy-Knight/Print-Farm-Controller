import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  LICENSE_DOCUMENT_FORMAT,
  LICENSE_DOCUMENT_VERSION,
  canonicalizeLicensePayload,
  validateLicensePayload
} from '../../src/licensing/license-file.js';

function argsFrom(argv) {
  const result = { force:false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--force') result.force = true;
    else if (token === '--key-id') result.keyId = argv[++i];
    else if (token === '--private-key') result.privateKey = argv[++i];
    else if (token === '--payload') result.payload = argv[++i];
    else if (token === '--output') result.output = argv[++i];
    else throw new Error(`Unknown option: ${token}`);
  }
  return result;
}

const args = argsFrom(process.argv.slice(2));
if (!args.payload) throw new Error('Use --payload <payload.json>');
const keyId = String(args.keyId || `primary-${new Date().getUTCFullYear()}`).trim();
const privateKeyPath = path.resolve(
  args.privateKey || path.join(os.homedir(), '.print-controller', 'license-keys', `${keyId}.private.pem`)
);
const payloadPath = path.resolve(args.payload);
const outputPath = path.resolve(
  args.output || payloadPath.replace(/\.json$/i, '') + '.license.json'
);

const rawPayload = JSON.parse(await fs.readFile(payloadPath, 'utf8'));
const payload = validateLicensePayload(rawPayload);
const privatePem = await fs.readFile(privateKeyPath, 'utf8');
const privateKey = crypto.createPrivateKey(privatePem);
if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
  throw new Error('Signing key must be an Ed25519 private key');
}

const signature = crypto.sign(
  null,
  Buffer.from(canonicalizeLicensePayload(payload), 'utf8'),
  privateKey
).toString('base64');

const document = {
  format:LICENSE_DOCUMENT_FORMAT,
  version:LICENSE_DOCUMENT_VERSION,
  payload,
  signature:{
    algorithm:'Ed25519',
    keyId,
    value:signature
  }
};

await fs.mkdir(path.dirname(outputPath), { recursive:true });
await fs.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, {
  encoding:'utf8',
  mode:0o644,
  flag:args.force ? 'w' : 'wx'
});

console.log(`Signed licence written to ${outputPath}`);
console.log(`Licence ID: ${payload.licenseId}`);
console.log(`Edition: ${payload.edition}`);
console.log(`Printer limit: ${payload.maxPrinters}`);
console.log(`Signature key: ${keyId}`);
