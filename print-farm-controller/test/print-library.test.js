import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('Print Library migrates staged queue files, deduplicates uploads and persists until explicit delete', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-print-library-test-'));
  process.env.DATA_DIR = dir;

  const legacyId = '11111111-1111-4111-8111-111111111111';
  const legacyDir = path.join(dir, 'queue-files', legacyId);
  const legacyName = 'legacy-part.gcode';
  const legacyContent = '; filament_type = PLA\n; nozzle_diameter = 0.4\nT0\nG1 X10\n';
  const legacyHash = crypto.createHash('sha256').update(legacyContent).digest('hex');
  const stagedAt = '2026-09-20T12:00:00.000Z';

  await fs.mkdir(legacyDir, { recursive:true });
  await fs.writeFile(path.join(legacyDir, legacyName), legacyContent);
  await fs.writeFile(path.join(legacyDir, 'metadata.json'), JSON.stringify({
    id:legacyId,
    fileName:legacyName,
    size:Buffer.byteLength(legacyContent),
    sha256:legacyHash,
    stagedAt,
    requirements:{
      fileName:legacyName,
      requiredTools:[0],
      toolCount:1,
      logicalTools:[{ index:0, material:'PLA', color:null, nozzleDiameter:0.4 }],
      usageReliable:true,
      materialMetadata:{ metadataAvailable:true, requiredMaterial:'PLA', materials:['PLA'] },
      source:'gcode-bounded-scan',
      warning:null
    }
  }, null, 2));

  const moduleUrl = pathToFileURL(path.resolve('src/print-library.js'));
  moduleUrl.searchParams.set('case', String(Date.now()));
  const library = await import(moduleUrl.href);

  const migrated = await library.listLibraryFiles();
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].id, legacyId);
  assert.equal(migrated[0].fileName, legacyName);
  assert.equal(migrated[0].addedAt, stagedAt);
  assert.equal(await fs.readFile((await library.getLibraryFile(legacyId)).filePath, 'utf8'), legacyContent);
  await assert.rejects(() => fs.access(path.join(dir, 'queue-files')));
  await fs.access(path.join(dir, 'print-library', legacyId));

  const duplicateSource = path.join(dir, 'duplicate.gcode');
  await fs.writeFile(duplicateSource, legacyContent);
  const duplicate = await library.addLibraryFile(duplicateSource, 'another-name.gcode');
  assert.equal(duplicate.id, legacyId);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await library.listLibraryFiles()).length, 1);

  const secondSource = path.join(dir, 'second.gcode');
  await fs.writeFile(secondSource, '; filament_type = PETG\n; nozzle_diameter = 0.6\nT0\nG1 X20\n');
  const second = await library.addLibraryFile(secondSource, 'second-part.gcode');
  assert.notEqual(second.id, legacyId);
  assert.equal((await library.listLibraryFiles()).length, 2);

  await library.preserveLibraryFiles([], { minAgeMs:0 });
  assert.equal((await library.listLibraryFiles()).length, 2);

  await library.removeLibraryFile(second.id);
  assert.equal((await library.listLibraryFiles()).length, 1);

  await fs.rm(dir, { recursive:true, force:true });
});
