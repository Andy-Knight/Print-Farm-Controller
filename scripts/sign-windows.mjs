import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

async function existingFile(candidate) {
  if (!candidate) return null;
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function findSignTool() {
  const configured = await existingFile(process.env.SIGNTOOL_PATH);
  if (configured) return configured;

  const where = spawnSync('where.exe', ['signtool.exe'], { encoding:'utf8', windowsHide:true });
  if (where.status === 0) {
    const first = String(where.stdout || '').split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    const found = await existingFile(first);
    if (found) return found;
  }

  throw new Error(
    'signtool.exe was not found. Run from a Windows SDK/Visual Studio developer environment or set SIGNTOOL_PATH.'
  );
}

function signingIdentityArgs() {
  const thumbprint = String(process.env.PFC_SIGN_CERT_SHA1 || '').replace(/\s+/g, '');
  const pfx = String(process.env.PFC_SIGN_PFX || '').trim();

  if (thumbprint) return ['/sha1', thumbprint];
  if (pfx) {
    const args = ['/f', path.resolve(pfx)];
    const password = process.env.PFC_SIGN_PFX_PASSWORD;
    if (password) args.push('/p', password);
    return args;
  }

  throw new Error(
    'Configure PFC_SIGN_CERT_SHA1 for a certificate in the Windows certificate store, or PFC_SIGN_PFX for a PFX file.'
  );
}

if (process.platform !== 'win32') {
  throw new Error('Windows Authenticode signing must run on Windows.');
}

const targets = process.argv.slice(2).map((target) => path.resolve(target));
if (!targets.length) {
  throw new Error('Provide at least one executable to sign.');
}
for (const target of targets) await fs.access(target);

const timestampUrl = String(process.env.PFC_TIMESTAMP_URL || '').trim();
if (!timestampUrl) {
  throw new Error('Set PFC_TIMESTAMP_URL to the RFC 3161 timestamp service supplied/recommended by your code-signing provider.');
}

const signTool = await findSignTool();
const identity = signingIdentityArgs();

for (const target of targets) {
  const signArgs = [
    'sign',
    '/fd', 'SHA256',
    ...identity,
    '/tr', timestampUrl,
    '/td', 'SHA256',
    target
  ];
  const sign = spawnSync(signTool, signArgs, { stdio:'inherit', windowsHide:true });
  if (sign.error) throw sign.error;
  if (sign.status !== 0) throw new Error(`signtool sign failed for ${target} with code ${sign.status}`);

  const verify = spawnSync(signTool, ['verify', '/pa', '/v', target], {
    stdio:'inherit',
    windowsHide:true
  });
  if (verify.error) throw verify.error;
  if (verify.status !== 0) throw new Error(`signtool verification failed for ${target} with code ${verify.status}`);

  console.log(`Signed and verified: ${target}`);
}
