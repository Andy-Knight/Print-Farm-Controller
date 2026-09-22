import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';

function sourceApplicationDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function resolveControllerRuntimePaths({
  env = process.env,
  execPath = process.execPath,
  runningAsSea = isSea()
} = {}) {
  const sourceRoot = runningAsSea ? null : sourceApplicationDir();
  const applicationDir = runningAsSea
    ? path.dirname(path.resolve(execPath))
    : sourceRoot;

  const requestedDataDir = String(env?.DATA_DIR || '').trim();
  const defaultDataDir = path.join(applicationDir, 'data');
  const dataDir = path.resolve(requestedDataDir || defaultDataDir);

  return Object.freeze({
    runningAsSea:Boolean(runningAsSea),
    sourceRoot,
    applicationDir,
    defaultDataDir,
    dataDir,
    customDataDir:requestedDataDir ? dataDir : null,
    publicDir:sourceRoot ? path.join(sourceRoot, 'public') : null,
    packageJsonPath:sourceRoot ? path.join(sourceRoot, 'package.json') : null,
    licensePath:path.join(applicationDir, 'license.json'),
    emulatorSettingsPath:path.join(dataDir, 'emulator-settings.json')
  });
}
