import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFilePreview, previewRank } from '../src/file-preview.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZB1sAAAAASUVORK5CYII=',
  'base64'
);

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, value] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(value);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localData, centralDirectory, eocd]);
}

function gcodeThumbnail(width, height) {
  const base64 = PNG_1X1.toString('base64');
  return [
    `; thumbnail begin ${width}x${height} ${base64.length}`,
    `; ${base64}`,
    '; thumbnail end'
  ].join('\n');
}

test('extractFilePreview selects the largest embedded G-code PNG thumbnail', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-preview-gcode-'));
  try {
    const filePath = path.join(dir, 'part.gcode');
    await fs.writeFile(filePath, [
      gcodeThumbnail(32, 32),
      gcodeThumbnail(256, 256),
      'G28'
    ].join('\n'));

    const preview = await extractFilePreview(filePath);
    assert.ok(preview);
    assert.equal(preview.mimeType, 'image/png');
    assert.equal(preview.width, 256);
    assert.equal(preview.height, 256);
    assert.equal(preview.source, 'gcode-embedded-thumbnail');
    assert.deepEqual(preview.data, PNG_1X1);
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('extractFilePreview uses Orca plate_1 PNG from a 3MF archive', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-preview-3mf-'));
  try {
    const filePath = path.join(dir, 'part.3mf');
    const small = Buffer.concat([PNG_1X1, Buffer.from('small')]);
    await fs.writeFile(filePath, storedZip([
      ['Auxiliaries/.thumbnails/thumbnail_small.png', small],
      ['Metadata/plate_1.png', PNG_1X1],
      ['Metadata/plate_1.gcode', Buffer.from('G28\n')]
    ]));

    const preview = await extractFilePreview(filePath);
    assert.ok(preview);
    assert.equal(preview.mimeType, 'image/png');
    assert.equal(preview.source, '3mf:Metadata/plate_1.png');
    assert.deepEqual(preview.data, PNG_1X1);
    assert.ok(previewRank('Metadata/plate_1.png') > previewRank('Auxiliaries/.thumbnails/thumbnail_small.png'));
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('extractFilePreview returns null when no supported preview is embedded', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-preview-none-'));
  try {
    const filePath = path.join(dir, 'plain.gcode');
    await fs.writeFile(filePath, 'G28\nG1 X10 Y10\n');
    assert.equal(await extractFilePreview(filePath), null);
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});
