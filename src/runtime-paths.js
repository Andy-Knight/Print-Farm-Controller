import path from 'node:path';
import { isSea } from 'node:sea';

function sourceApplicationDir() {
  const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (entryPoint) return path.resolve(path.dirname(entryPoint), '..');
  return path.resolve(process.cwd());
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
  const requestedLogDir = String(env?.LOG_DIR || '').trim();
  const defaultDataDir = path.join(applicationDir, 'data');
  const defaultLogDir = path.join(applicationDir, 'logs');
  const dataDir = path.resolve(requestedDataDir || defaultDataDir);
  const logDir = path.resolve(requestedLogDir || defaultLogDir);
  const licensePath = path.join(dataDir, 'license.json');
  const applicationLicensePath = path.join(applicationDir, 'license.json');

  return Object.freeze({
    runningAsSea:Boolean(runningAsSea),
    sourceRoot,
    applicationDir,
    defaultDataDir,
    defaultLogDir,
    dataDir,
    logDir,
    customDataDir:requestedDataDir ? dataDir : null,
    customLogDir:requestedLogDir ? logDir : null,
    publicDir:sourceRoot ? path.join(sourceRoot, 'public') : null,
    emulatorPublicDir:sourceRoot ? path.join(sourceRoot, 'emulator', 'public') : null,
    emulatorAssetsDir:sourceRoot ? path.join(sourceRoot, 'emulator', 'assets') : null,
    trustedPublicKeysPath:sourceRoot ? path.join(sourceRoot, 'src', 'licensing', 'trusted-public-keys.json') : null,
    packageJsonPath:sourceRoot ? path.join(sourceRoot, 'package.json') : null,
    licensePath,
    legacyApplicationLicensePath:path.resolve(applicationLicensePath) === path.resolve(licensePath)
      ? null
      : applicationLicensePath,
    emulatorSettingsPath:path.join(dataDir, 'emulator-settings.json')
  });
}
