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
  const legacyContent = '; filament_type = PLA\n; nozzle_diameter = 0.4\n; filament used [g] = 14.25\nT0\nG1 X10\n';
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
  assert.equal(migrated[0].preview?.available, false);
  assert.equal(migrated[0].printerTarget, null);
  assert.equal(migrated[0].requirements.logicalTools[0].filamentGrams, 14.25);
  assert.equal(migrated[0].requirements.totalFilamentGrams, 14.25);
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
  const previewPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZB1sAAAAASUVORK5CYII=', 'base64');
  const previewBase64 = previewPng.toString('base64');
  await fs.writeFile(secondSource, [
    '; filament_type = PETG',
    '; nozzle_diameter = 0.6',
    `; thumbnail begin 256x256 ${previewBase64.length}`,
    `; ${previewBase64}`,
    '; thumbnail end',
    'T0',
    'G1 X20'
  ].join('\n'));
  const second = await library.addLibraryFile(secondSource, 'second-part.gcode', {
    description:'Replacement caravan blind clip. Print two.',
    printerTarget:{ adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' }
  });
  assert.notEqual(second.id, legacyId);
  assert.equal(second.description, 'Replacement caravan blind clip. Print two.');
  assert.deepEqual(second.printerTarget, { adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' });
  assert.equal(second.preview?.available, true);
  assert.deepEqual(second.sundryCosts,[]);
  assert.equal(Object.hasOwn(second,'sundryCurrency'),false);
  assert.equal(second.lotsPerPrint,1);
  assert.equal(second.preview?.mimeType, 'image/png');
  const storedPreview = await library.getLibraryPreview(second.id);
  assert.equal(storedPreview?.mimeType, 'image/png');
  assert.deepEqual(await fs.readFile(storedPreview.filePath), previewPng);
  const edited = await library.updateLibraryFileMetadata(second.id, { description:'Updated notes for this part.' });
  assert.equal(edited.description, 'Updated notes for this part.');
  assert.deepEqual(edited.printerTarget, { adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' });
  assert.ok(edited.updatedAt);
  assert.equal((await library.getLibraryFile(second.id)).description, 'Updated notes for this part.');
  const retargeted = await library.updateLibraryFileMetadata(second.id, {
    printerTarget:{ adapterType:'snapmaker-u1', model:'U1' }
  });
  assert.deepEqual(retargeted.printerTarget, { adapterType:'snapmaker-u1', model:'U1' });
  const unrestricted = await library.updateLibraryFileMetadata(second.id, { printerTarget:null });
  assert.equal(unrestricted.printerTarget, null);

  const filamentId = '11111111-1111-4111-8111-111111111111';
  const withFilament = await library.updateLibraryFileMetadata(second.id, {
    filamentAssignments:{ '0':filamentId }
  });
  assert.deepEqual(withFilament.filamentAssignments, { '0':filamentId });
  assert.deepEqual((await library.getLibraryFile(second.id)).filamentAssignments, { '0':filamentId });
  assert.deepEqual(
    (await library.listLibraryFiles()).find((item) => item.id === second.id)?.filamentAssignments,
    { '0':filamentId }
  );
  const organised=await library.updateLibraryFileMetadata(second.id,{
    category:'VW T6 interior',tags:['ASA','Production','ASA'],favourite:true
  });
  assert.equal(organised.category,'VW T6 interior');
  assert.deepEqual(organised.tags,['ASA','Production']);
  assert.equal(organised.favourite,true);
  const persisted=(await library.listLibraryFiles()).find(item=>item.id===second.id);
  assert.equal(persisted.category,'VW T6 interior');
  assert.deepEqual(persisted.tags,['ASA','Production']);
  assert.equal(persisted.favourite,true);
  const priced=await library.updateLibraryFileMetadata(second.id,{
    sundryCosts:[{label:'M4 brass inserts',quantity:4,unitCost:0.12},
      {label:'Packaging',quantity:1,unitCost:0.5}],
    lotsPerPrint:4
  });
  assert.deepEqual(priced.sundryCosts,[{label:'M4 brass inserts',quantity:4,unitCost:0.12},
    {label:'Packaging',quantity:1,unitCost:0.5}]);
  assert.equal(priced.lotsPerPrint,4);
  assert.equal(Object.hasOwn(priced,'sundryCurrency'),false);
  const pricedFromDisk=await library.getLibraryFile(second.id);
  assert.deepEqual(pricedFromDisk.sundryCosts,priced.sundryCosts);
  assert.equal(Object.hasOwn(pricedFromDisk,'sundryCurrency'),false);
  // Old feature-build metadata had a manually chosen sundryCurrency. It
  // cannot dictate a price any more and is stripped on the next file edit.
  const diskMetaPath=path.join(dir,'print-library',second.id,'metadata.json');
  const previousMeta=JSON.parse(await fs.readFile(diskMetaPath,'utf8'));
  previousMeta.sundryCurrency='USD';
  await fs.writeFile(diskMetaPath,JSON.stringify(previousMeta));
  assert.equal(Object.hasOwn(await library.getLibraryFile(second.id),'sundryCurrency'),false);
  await library.updateLibraryFileMetadata(second.id,{lotsPerPrint:4});
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(diskMetaPath,'utf8')),'sundryCurrency'),false);
  assert.equal(pricedFromDisk.lotsPerPrint,4);
  assert.equal((await library.listLibraryFiles()).find(x=>x.id===second.id)?.sundryCosts.length,2);
  await assert.rejects(()=>library.updateLibraryFileMetadata(second.id,{
    sundryCosts:[{label:'Invalid negative',quantity:2,unitCost:-1}]
  }),/Sundry unit cost/);
  await assert.rejects(()=>library.updateLibraryFileMetadata(second.id,{lotsPerPrint:0}),/1 and 999/);
  const cleared=await library.updateLibraryFileMetadata(second.id,{
    category:'',tags:[],favourite:false
  });
  assert.equal(cleared.category,'');
  assert.deepEqual(cleared.tags,[]);
  assert.equal(cleared.favourite,false);
  assert.equal(cleared.lotsPerPrint,4,'Editing ordinary metadata must not reset saved sale lots');
  await assert.rejects(()=>library.updateLibraryFileMetadata(second.id,{tags:['x'.repeat(41)]}),/tag is invalid/);
  await assert.rejects(()=>library.updateLibraryFileMetadata(second.id,{category:'x'.repeat(61)}),/60 characters/);
  await assert.rejects(()=>library.updateLibraryFileMetadata(second.id,{favourite:'true'}),/true or false/);
    await assert.rejects(() => library.updateLibraryFileMetadata(second.id, { description:'x'.repeat(4001) }), /4000 characters/);
  await assert.rejects(
    () => library.updateLibraryFileMetadata(second.id, { printerTarget:{ adapterType:'snapmaker-u1', model:'' } }),
    /requires adapter type and model/
  );
  assert.equal((await library.listLibraryFiles()).length, 2);

  await library.preserveLibraryFiles([], { minAgeMs:0 });
  assert.equal((await library.listLibraryFiles()).length, 2);

  await library.removeLibraryFile(second.id);
  assert.equal((await library.listLibraryFiles()).length, 1);

  await fs.rm(dir, { recursive:true, force:true });
});


test('concurrent identical Print Library uploads deduplicate to one stored file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-print-library-concurrent-'));
  process.env.DATA_DIR = dir;
  const source = path.join(dir, 'same.gcode');
  await fs.writeFile(source, '; filament_type = PLA\n; nozzle_diameter = 0.4\nT0\nG1 X1\n');

  const moduleUrl = pathToFileURL(path.resolve('src/print-library.js'));
  moduleUrl.searchParams.set('concurrent-case', String(Date.now()));
  const library = await import(moduleUrl.href);

  try {
    const [first, second] = await Promise.all([
      library.addLibraryFile(source, 'same-a.gcode'),
      library.addLibraryFile(source, 'same-b.gcode')
    ]);

    assert.equal(first.id, second.id);
    assert.equal((await library.listLibraryFiles()).length, 1);
    assert.equal([first.duplicate, second.duplicate].filter(Boolean).length, 1);
  } finally {
    delete process.env.DATA_DIR;
    await fs.rm(dir, { recursive:true, force:true });
  }
});
