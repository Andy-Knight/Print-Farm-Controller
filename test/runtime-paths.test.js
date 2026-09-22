import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveControllerRuntimePaths } from '../src/runtime-paths.js';

test('runtime paths resolve source checkout locations during development', () => {
  const expectedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const paths = resolveControllerRuntimePaths({
    env:{},
    runningAsSea:false
  });

  assert.equal(paths.runningAsSea, false);
  assert.equal(paths.applicationDir, expectedRoot);
  assert.equal(paths.sourceRoot, expectedRoot);
  assert.equal(paths.defaultDataDir, path.join(expectedRoot, 'data'));
  assert.equal(paths.dataDir, path.join(expectedRoot, 'data'));
  assert.equal(paths.publicDir, path.join(expectedRoot, 'public'));
  assert.equal(paths.emulatorPublicDir, path.join(expectedRoot, 'emulator', 'public'));
  assert.equal(paths.emulatorAssetsDir, path.join(expectedRoot, 'emulator', 'assets'));
  assert.equal(paths.trustedPublicKeysPath, path.join(expectedRoot, 'src', 'licensing', 'trusted-public-keys.json'));
  assert.equal(paths.packageJsonPath, path.join(expectedRoot, 'package.json'));
  assert.equal(paths.licensePath, path.join(expectedRoot, 'license.json'));
  assert.equal(paths.emulatorSettingsPath, path.join(expectedRoot, 'data', 'emulator-settings.json'));
});

test('runtime paths resolve application-local storage beside a packaged executable', () => {
  const installDir = path.join(os.tmpdir(), 'Print Farm Controller packaged path test');
  const executable = path.join(installDir, process.platform === 'win32' ? 'PrintFarmController.exe' : 'print-farm-controller');
  const paths = resolveControllerRuntimePaths({
    env:{},
    execPath:executable,
    runningAsSea:true
  });

  assert.equal(paths.runningAsSea, true);
  assert.equal(paths.sourceRoot, null);
  assert.equal(paths.applicationDir, installDir);
  assert.equal(paths.defaultDataDir, path.join(installDir, 'data'));
  assert.equal(paths.dataDir, path.join(installDir, 'data'));
  assert.equal(paths.publicDir, path.join(installDir, 'public'));
  assert.equal(paths.emulatorPublicDir, path.join(installDir, 'emulator', 'public'));
  assert.equal(paths.emulatorAssetsDir, path.join(installDir, 'emulator', 'assets'));
  assert.equal(paths.trustedPublicKeysPath, path.join(installDir, 'trusted-public-keys.json'));
  assert.equal(paths.packageJsonPath, null);
  assert.equal(paths.licensePath, path.join(installDir, 'license.json'));
  assert.equal(paths.emulatorSettingsPath, path.join(installDir, 'data', 'emulator-settings.json'));
});

test('DATA_DIR override remains supported through central runtime paths', () => {
  const requested = path.join(os.tmpdir(), 'pfc-custom-runtime-data');
  const paths = resolveControllerRuntimePaths({
    env:{ DATA_DIR:requested },
    runningAsSea:true,
    execPath:path.join(os.tmpdir(), 'pfc-install', 'print-farm-controller')
  });

  assert.equal(paths.dataDir, path.resolve(requested));
  assert.equal(paths.customDataDir, path.resolve(requested));
  assert.equal(paths.emulatorSettingsPath, path.join(path.resolve(requested), 'emulator-settings.json'));
});
