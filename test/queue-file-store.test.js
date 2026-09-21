import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function storedZipEntry(name, content) {
  const fileName = Buffer.from(name);
  const body = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);
  const localRecord = Buffer.concat([local, fileName, body]);
  const centralRecord = Buffer.concat([central, fileName]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}

async function loadStoreInTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-queue-files-test-'));
  process.env.DATA_DIR = dir;
  const moduleUrl = pathToFileURL(path.resolve('src/queue-file-store.js'));
  moduleUrl.searchParams.set('case', `${Date.now()}-${Math.random()}`);
  const mod = await import(moduleUrl.href);
  return { dir, ...mod };
}

test('queue file compatibility API stores library-backed hash, requirements and exact bytes', async () => {
  const { dir, stageQueueFile, getQueueFile, removeQueueFile, pruneQueueFiles } = await loadStoreInTempDir();
  const source = path.join(dir, 'source.gcode');
  const content = '; filament_type = PLA\n; filament_colour = #FF0000\n; nozzle_diameter = 0.4\nT0\nG1 X10\n';
  await fs.writeFile(source, content);
  const staged = await stageQueueFile(source, 'gearbox-cover.gcode');
  assert.equal(staged.fileName, 'gearbox-cover.gcode');
  assert.equal(staged.size, Buffer.byteLength(content));
  assert.match(staged.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(staged.requirements.requiredTools, [0]);
  assert.equal(staged.requirements.logicalTools[0].material, 'PLA');
  assert.equal(staged.requirements.logicalTools[0].color, '#FF0000');
  assert.equal(staged.requirements.logicalTools[0].nozzleDiameter, 0.4);

  const resolved = await getQueueFile(staged.id);
  assert.equal(await fs.readFile(resolved.filePath, 'utf8'), content);
  await removeQueueFile(staged.id);
  await assert.rejects(() => getQueueFile(staged.id));

  const orphan = await stageQueueFile(source, 'orphan.gcode');
  await pruneQueueFiles([], { minAgeMs:0 });
  const preserved = await getQueueFile(orphan.id);
  assert.equal(preserved.fileName, 'orphan.gcode');
  await fs.rm(dir, { recursive:true, force:true });
});

test('library-backed queue staging reads multi-filament requirements from embedded 3MF plate G-code', async () => {
  const { dir, stageQueueFile } = await loadStoreInTempDir();
  const source = path.join(dir, 'two-colour.3mf');
  const gcode = '; filament_type = PLA;PETG\n; filament_colour = #FF0000;#00FF00\n; nozzle_diameter = 0.4;0.4\n; filament used [g] = 2.5;3.5\nT0\nT1\n';
  await fs.writeFile(source, storedZipEntry('Metadata/plate_1.gcode', gcode));
  const staged = await stageQueueFile(source, 'two-colour.3mf');
  assert.equal(staged.requirements.source, '3mf-embedded-gcode');
  assert.deepEqual(staged.requirements.requiredTools, [0,1]);
  assert.equal(staged.requirements.logicalTools[0].material, 'PLA');
  assert.equal(staged.requirements.logicalTools[1].material, 'PETG');
  assert.equal(staged.requirements.logicalTools[1].color, '#00FF00');
  await fs.rm(dir, { recursive:true, force:true });
});
