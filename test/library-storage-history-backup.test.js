import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectLogicalBackupSnapshot} from '../src/backup-recovery/backup-service.js';
import {jsonEntry} from '../src/backup-recovery/backup-format.js';
import {hashArchiveSource,writeZipArchive} from '../src/backup-recovery/backup-archive.js';
import {stageRestoreBackup,activatePendingRestore,rollbackActivatedRestore} from '../src/backup-recovery/restore-service.js';
import {inspectRestoreBackup} from '../src/backup-recovery/restore-inspector.js';

const point={at:'2026-10-31T12:00:00.000Z',bytes:20,limit:100};

async function archiveFixture(root,kind){
  const source=path.join(root,'source');await fs.mkdir(source);
  const snapshot=await collectLogicalBackupSnapshot({dataDir:source,applicationDir:root,
    licensePath:path.join(root,'no-license'),controllerVersion:'0.61.16'});
  const payload=snapshot.entries.filter(entry=>!['manifest.json','checksums.json',
    'state/reporting-history.json','state/library-storage-history.json'].includes(entry.name));
  payload.push(jsonEntry('state/reporting-history.json',{version:1,records:[],...(kind==='legacy'?{libraryStorage:[point]}:{})}));
  if(kind==='new'||kind==='invalid')payload.push(jsonEntry('state/library-storage-history.json',
    {version:1,points:[kind==='invalid'?{...point,bytes:-1}:point]}));
  const checksums={};let payloadBytes=0;
  for(const entry of payload){const hash=await hashArchiveSource(entry);checksums[entry.name]=hash;payloadBytes+=hash.size;}
  const manifest=jsonEntry('manifest.json',{...snapshot.manifest,payloadBytes});
  checksums[manifest.name]=await hashArchiveSource(manifest);
  const archive=path.join(root,'fixture.pfcbackup');
  await writeZipArchive(archive,[manifest,jsonEntry('checksums.json',{algorithm:'sha256',entries:checksums}),...payload]);
  return archive;
}

for(const kind of ['new','legacy','none']){
  test(`${kind} backup restores storage history independently and rollback preserves target history`,async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-storage-restore-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const backup=await archiveFixture(root,kind),dataDir=path.join(root,'target');await fs.mkdir(dataDir);
    const historyPath=path.join(dataDir,'library-storage-history.json');
    const previous={...point,bytes:99};await fs.writeFile(historyPath,JSON.stringify({version:1,points:[previous]}));
    const options={dataDir,licensePath:path.join(dataDir,'license.json'),currentControllerVersion:'0.61.17'};
    await stageRestoreBackup(backup,options);
    const transaction=await activatePendingRestore(options);
    assert.deepEqual(JSON.parse(await fs.readFile(historyPath,'utf8')).points,kind==='none'?[]:[point]);
    assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(path.join(dataDir,'reporting-history.json'),'utf8')),'libraryStorage'),false);
    await rollbackActivatedRestore(transaction);
    assert.deepEqual(JSON.parse(await fs.readFile(historyPath,'utf8')).points,[previous]);
  });
}

test('restore inspection rejects invalid separate history even with valid archive checksums',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-storage-invalid-backup-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const backup=await archiveFixture(root,'invalid');
  await assert.rejects(inspectRestoreBackup(backup,{currentControllerVersion:'0.61.17',targetDataDir:root}),/Library storage history is invalid/);
});
