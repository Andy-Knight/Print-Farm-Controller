import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bundleScript = fs.readFileSync(new URL('../scripts/build-controller-bundle.mjs', import.meta.url), 'utf8');
const seaScript = fs.readFileSync(new URL('../scripts/build-sea-windows.mjs', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const licenceLoader = fs.readFileSync(new URL('../src/licensing/license-loader.js', import.meta.url), 'utf8');
const runtimeAssets = fs.readFileSync(new URL('../src/runtime-assets.js', import.meta.url), 'utf8');
const emulatorServer = fs.readFileSync(new URL('../emulator/server.js', import.meta.url), 'utf8');
const emulatorProtocols = fs.readFileSync(new URL('../emulator/protocols.js', import.meta.url), 'utf8');
const installerScript = fs.readFileSync(new URL('../installer/windows/PrintFarmController.iss', import.meta.url), 'utf8');
const installerBuildScript = fs.readFileSync(new URL('../scripts/build-installer-windows.mjs', import.meta.url), 'utf8');
const signingScript = fs.readFileSync(new URL('../scripts/sign-windows.mjs', import.meta.url), 'utf8');
const releaseScript = fs.readFileSync(new URL('../scripts/build-windows-release.mjs', import.meta.url), 'utf8');

test('production packaging scripts use Node 24, esbuild and Node SEA', () => {
  assert.equal(pkg.engines.node, '>=24');
  assert.equal(pkg.devDependencies.esbuild, '0.28.2');
  assert.equal(pkg.devDependencies.postject, '1.0.0-alpha.6');
  assert.equal(pkg.scripts['build:bundle'], 'node scripts/build-controller-bundle.mjs');
  assert.equal(pkg.scripts['build:sea:windows'], 'node scripts/build-sea-windows.mjs');
  assert.equal(pkg.scripts['build:installer:windows'], 'npm run build:sea:windows && node scripts/build-installer-windows.mjs');
  assert.equal(pkg.scripts['sign:windows'], 'node scripts/sign-windows.mjs');
  assert.equal(pkg.scripts['release:windows'], 'node scripts/build-windows-release.mjs');
  assert.match(bundleScript, /format:'cjs'/);
  assert.match(bundleScript, /target:'node24'/);
  assert.match(bundleScript, /__PFC_VERSION__/);
  assert.match(seaScript, /--experimental-sea-config/);
  assert.match(seaScript, /NODE_SEA_BLOB/);
  assert.match(seaScript, /NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2/);
});

test('hardened Windows build embeds controller, simulator and trusted-key assets', () => {
  assert.match(seaScript, /PrintFarmController\.exe/);
  assert.match(seaScript, /assets:await embeddedAssets\(\)/);
  assert.match(seaScript, /addAssetTree\(assets, path\.join\(projectRoot, 'public'\), 'public'\)/);
  assert.match(seaScript, /'emulator\/public'/);
  assert.match(seaScript, /'emulator\/assets'/);
  assert.match(seaScript, /assets\['licensing\/trusted-public-keys\.json'\]/);
  assert.match(seaScript, /dist', 'windows-x64'/);
  assert.doesNotMatch(seaScript, /copyPortableAssets/);
  assert.doesNotMatch(seaScript, /BUILD-INFO\.txt/);
});

test('controller bundle has no top-level startup await and embeds the application version', () => {
  assert.match(server, /const bundledVersion = typeof __PFC_VERSION__ === 'string'/);
  assert.match(server, /let licenseManager = null/);
  assert.match(server, /async function startController\(\)/);
  assert.match(server, /startController\(\)\.catch/);
  assert.doesNotMatch(server, /const packageInfo = PACKAGE_PATH \? JSON\.parse\(await/);
});

test('packaged runtime reads UI, simulator and licence trust data through SEA assets', () => {
  assert.match(runtimeAssets, /getAsset/);
  assert.match(runtimeAssets, /trustedPublicKeys:'licensing\/trusted-public-keys\.json'/);
  assert.match(server, /publicAssetKey/);
  assert.match(server, /readRuntimeAsset/);
  assert.match(emulatorServer, /emulatorPublicAssetKey/);
  assert.match(emulatorServer, /readRuntimeAsset/);
  assert.match(emulatorProtocols, /runtimeAssetKeys\.emulatorTestFrame/);
  assert.match(emulatorProtocols, /runtimeAssetKeys\.emulatorBambuKey/);
  assert.match(emulatorProtocols, /runtimeAssetKeys\.emulatorBambuCert/);
  assert.match(licenceLoader, /readRuntimeTextAsset/);
  assert.match(licenceLoader, /runtimeAssetKeys\.trustedPublicKeys/);
  assert.doesNotMatch(licenceLoader, /new URL\('\.\/trusted-public-keys\.json', import\.meta\.url\)/);
});


test('Windows installer protects program files and grants modify access only to persistent data', () => {
  assert.match(installerScript, /DefaultDirName=\{autopf\}\\Print Farm Controller/);
  assert.match(installerScript, /PrivilegesRequired=admin/);
  assert.match(installerScript, /Name: "\{app\}\\data"; Permissions: users-modify/);
  assert.match(installerScript, /Source: "\.\.\\\.\.\\dist\\windows-x64\\\{#MyAppExeName\}"/);
  assert.doesNotMatch(installerScript, /Permissions: users-modify.*MyAppExeName/);
  assert.match(installerBuildScript, /Inno Setup 6/);
  assert.match(installerBuildScript, /PrintFarmController-Setup-v/);
});

test('Windows release signing occurs after SEA injection and before installer compilation', () => {
  assert.match(signingScript, /'sign'/);
  assert.match(signingScript, /'\/fd', 'SHA256'/);
  assert.match(signingScript, /'\/tr', timestampUrl/);
  assert.match(signingScript, /'verify', '\/pa', '\/v'/);
  assert.match(signingScript, /PFC_SIGN_CERT_SHA1/);
  assert.match(signingScript, /PFC_SIGN_PFX/);
  const seaBuild = releaseScript.indexOf("build-sea-windows.mjs");
  const exeSign = releaseScript.indexOf("sign-windows.mjs', [portableExe]");
  const installerBuild = releaseScript.indexOf("build-installer-windows.mjs");
  const installerSign = releaseScript.indexOf("sign-windows.mjs', [installerExe]");
  assert.ok(seaBuild >= 0 && exeSign > seaBuild && installerBuild > exeSign && installerSign > installerBuild);
});
