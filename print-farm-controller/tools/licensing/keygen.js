import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const trustedKeysPath = path.join(projectRoot, 'src', 'licensing', 'trusted-public-keys.json');

function argsFrom(argv) {
  const result = { trust:false, force:false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--trust') result.trust = true;
    else if (token === '--force') result.force = true;
    else if (token === '--key-id') result.keyId = argv[++i];
    else if (token === '--output-dir') result.outputDir = argv[++i];
    else throw new Error(`Unknown option: ${token}`);
  }
  return result;
}

async function writeNewFile(filePath, content, { mode, force }) {
  await fs.mkdir(path.dirname(filePath), { recursive:true, mode:0o700 });
  await fs.writeFile(filePath, content, { encoding:'utf8', mode, flag:force ? 'w' : 'wx' });
}

const args = argsFrom(process.argv.slice(2));
const keyId = String(args.keyId || `primary-${new Date().getUTCFullYear()}`).trim();
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(keyId)) {
  throw new Error('key ID must be 3-80 characters using letters, numbers, dot, underscore or hyphen');
}

const outputDir = path.resolve(args.outputDir || path.join(os.homedir(), '.print-controller', 'license-keys'));
const privatePath = path.join(outputDir, `${keyId}.private.pem`);
const publicPath = path.join(outputDir, `${keyId}.public.pem`);

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type:'pkcs8', format:'pem' });
const publicPem = publicKey.export({ type:'spki', format:'pem' });

await writeNewFile(privatePath, privatePem, { mode:0o600, force:args.force });
await writeNewFile(publicPath, publicPem, { mode:0o644, force:args.force });

if (args.trust) {
  const current = JSON.parse(await fs.readFile(trustedKeysPath, 'utf8').catch(() => '{}'));
  if (current[keyId] && !args.force) {
    throw new Error(`Trusted key ID "${keyId}" already exists. Use --force to replace it.`);
  }
  current[keyId] = publicPem;
  await fs.writeFile(trustedKeysPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

console.log(`Created Ed25519 signing key: ${keyId}`);
console.log(`Private key: ${privatePath}`);
console.log(`Public key:  ${publicPath}`);
console.log(args.trust
  ? `Trusted public key registered in ${trustedKeysPath}`
  : 'Public key was not added to the controller. Re-run with --trust when this is the production key.');
console.log('Keep the private key backed up securely and never commit or share it.');
