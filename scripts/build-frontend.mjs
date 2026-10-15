import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const projectRoot = path.resolve(scriptDir, '..');
export const frontendBundlePath = path.join(projectRoot, 'public', 'dashboard-preact.js');
export const preactLicensePath = path.join(projectRoot, 'public', 'third-party', 'preact-LICENSE.txt');

export async function buildFrontend() {
  await fs.mkdir(path.dirname(preactLicensePath), { recursive:true });
  const preactEntry = require.resolve('preact');
  const installedPreactLicense = path.resolve(path.dirname(preactEntry), '..', 'LICENSE');
  await fs.copyFile(installedPreactLicense, preactLicensePath);

  await build({
    entryPoints:[path.join(projectRoot, 'ui', 'dashboard.jsx')],
    outfile:frontendBundlePath,
    bundle:true,
    platform:'browser',
    target:['es2022'],
    format:'esm',
    jsx:'automatic',
    jsxImportSource:'preact',
    minify:true,
    sourcemap:false,
    legalComments:'eof',
    logLevel:'info'
  });

  return { bundlePath:frontendBundlePath, preactLicensePath };
}

const isEntryPoint = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isEntryPoint) {
  buildFrontend().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
