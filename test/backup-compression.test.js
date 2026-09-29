import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectZipArchive,
  readZipDirectory,
  writeZipArchive
} from '../src/backup-recovery/backup-archive.js';

test('backup archive deflates compressible entries and stores already-compressed formats', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-backup-compression-'));
  const archivePath = path.join(root, 'compression.pfcbackup');
  try {
    const gcode = Buffer.from(('G1 X10 Y10 E0.25\n').repeat(20_000), 'utf8');
    const pngLike = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(512).fill(0x55)]);

    await writeZipArchive(archivePath, [
      { name:'print-library/11111111-1111-4111-8111-111111111111/part.gcode', buffer:gcode },
      { name:'print-library/11111111-1111-4111-8111-111111111111/preview.png', buffer:pngLike },
      { name:'state/printers.json', buffer:Buffer.from(JSON.stringify([{ id:'printer-1' }])) }
    ]);

    const entries = await readZipDirectory(archivePath);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const gcodeEntry = byName.get('print-library/11111111-1111-4111-8111-111111111111/part.gcode');
    const pngEntry = byName.get('print-library/11111111-1111-4111-8111-111111111111/preview.png');
    const jsonEntry = byName.get('state/printers.json');

    assert.equal(gcodeEntry.compression, 8);
    assert.ok(gcodeEntry.compressedSize < gcodeEntry.size);
    assert.equal(jsonEntry.compression, 8);
    assert.equal(pngEntry.compression, 0);
    assert.equal(pngEntry.compressedSize, pngEntry.size);

    const archive = await inspectZipArchive(archivePath);
    assert.deepEqual(await archive.read(gcodeEntry.name), gcode);
    assert.deepEqual(await archive.read(pngEntry.name), pngLike);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('stored ZIP entries remain readable for backwards compatibility', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-backup-store-compat-'));
  const archivePath = path.join(root, 'stored.pfcbackup');
  try {
    const legacyPayload = Buffer.from('legacy stored backup payload', 'utf8');
    await writeZipArchive(archivePath, [
      { name:'legacy-payload.zip', buffer:legacyPayload }
    ]);

    const archive = await inspectZipArchive(archivePath);
    const entry = archive.byName.get('legacy-payload.zip');
    assert.equal(entry.compression, 0);
    assert.deepEqual(await archive.read('legacy-payload.zip'), legacyPayload);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('corrupted deflate data is rejected during archive read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-backup-deflate-corrupt-'));
  const archivePath = path.join(root, 'corrupt.pfcbackup');
  try {
    const payload = Buffer.from(('G1 X50 Y50 E1.0\n').repeat(10_000), 'utf8');
    await writeZipArchive(archivePath, [{ name:'payload.gcode', buffer:payload }]);

    const archive = await inspectZipArchive(archivePath);
    const entry = archive.byName.get('payload.gcode');
    assert.equal(entry.compression, 8);

    const handle = await fs.open(archivePath, 'r+');
    try {
      const local = Buffer.alloc(30);
      await handle.read(local, 0, local.length, entry.localOffset);
      const start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const offset = start + Math.floor(entry.compressedSize / 2);
      const byte = Buffer.alloc(1);
      await handle.read(byte, 0, 1, offset);
      byte[0] ^= 0xff;
      await handle.write(byte, 0, 1, offset);
    } finally {
      await handle.close();
    }

    const corrupted = await inspectZipArchive(archivePath);
    await assert.rejects(
      () => corrupted.read('payload.gcode'),
      /CRC mismatch|inconsistent uncompressed size|invalid|unexpected|distance|deflate|compressed data/i
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('inflate output cannot exceed the ZIP declared uncompressed size', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-backup-size-guard-'));
  const archivePath = path.join(root, 'size-guard.pfcbackup');
  try {
    const payload = Buffer.from(('M117 Print Farm Controller\n').repeat(5_000), 'utf8');
    await writeZipArchive(archivePath, [{ name:'payload.gcode', buffer:payload }]);

    const file = await fs.readFile(archivePath);
    const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const centralOffset = file.indexOf(centralSignature);
    assert.ok(centralOffset >= 0);
    const declaredSize = file.readUInt32LE(centralOffset + 24);
    assert.ok(declaredSize > 1);
    file.writeUInt32LE(declaredSize - 1, centralOffset + 24);
    await fs.writeFile(archivePath, file);

    const archive = await inspectZipArchive(archivePath);
    await assert.rejects(
      () => archive.read('payload.gcode'),
      /exceeds declared uncompressed size|inconsistent uncompressed size/i
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
