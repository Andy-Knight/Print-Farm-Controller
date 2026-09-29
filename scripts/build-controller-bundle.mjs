import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDir, '..');
export const buildDir = path.join(projectRoot, 'build');
export const controllerBundlePath = path.join(buildDir, 'controller.cjs');

export async function buildControllerBundle() {
  const packageInfo = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const googleClientId = String(process.env.PFC_GOOGLE_CLIENT_ID || '').trim();
  const googleClientSecret = String(process.env.PFC_GOOGLE_CLIENT_SECRET || '').trim();
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error('PFC_GOOGLE_CLIENT_ID and PFC_GOOGLE_CLIENT_SECRET must either both be set or both be empty');
  }
  await fs.mkdir(buildDir, { recursive: true });

  await build({
    entryPoints:[path.join(projectRoot, 'src', 'server.js')],
    outfile:controllerBundlePath,
    bundle:true,
    platform:'node',
    target:'node24',
    format:'cjs',
    minify:false,
    sourcemap:false,
    legalComments:'none',
    define:{
      __PFC_VERSION__:JSON.stringify(String(packageInfo.version || 'unknown')),
      __PFC_GOOGLE_CLIENT_ID__:JSON.stringify(googleClientId),
      __PFC_GOOGLE_CLIENT_SECRET__:JSON.stringify(googleClientSecret)
    },
    logLevel:'info'
  });

  return {
    version:String(packageInfo.version || 'unknown'),
    bundlePath:controllerBundlePath,
    builtInGoogleOAuth:Boolean(googleClientId && googleClientSecret)
  };
}

const isEntryPoint = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isEntryPoint) {
  buildControllerBundle().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
