import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emulatorPublicAssetKey,
  publicAssetKey,
  readRuntimeAsset,
  readRuntimeAssetSync,
  readRuntimeTextAsset,
  runtimeAssetKeys
} from '../src/runtime-assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('runtime asset helpers read source assets during development', async () => {
  const index = await readRuntimeTextAsset({
    key:publicAssetKey('index.html'),
    filePath:path.join(root, 'public', 'index.html')
  });
  assert.match(index, /Print Farm Controller/);

  const simulatorApp = await readRuntimeAsset({
    key:emulatorPublicAssetKey('app.js'),
    filePath:path.join(root, 'emulator', 'public', 'app.js')
  });
  assert.ok(Buffer.isBuffer(simulatorApp));
  assert.ok(simulatorApp.length > 100);

  const frame = readRuntimeAssetSync({
    key:runtimeAssetKeys.emulatorTestFrame,
    filePath:path.join(root, 'emulator', 'assets', 'test-frame.jpg')
  });
  assert.ok(Buffer.isBuffer(frame));
  assert.ok(frame.length > 100);
});

test('trusted production public keys use the same logical asset key in source and SEA builds', async () => {
  const raw = await readRuntimeTextAsset({
    key:runtimeAssetKeys.trustedPublicKeys,
    filePath:path.join(root, 'src', 'licensing', 'trusted-public-keys.json')
  });
  const keys = JSON.parse(raw);
  assert.equal(typeof keys['primary-2026'], 'string');
  assert.match(keys['primary-2026'], /BEGIN PUBLIC KEY/);
});
