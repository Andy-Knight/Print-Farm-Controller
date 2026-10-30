import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryAccountPresentation} from '../src/library-accounts.js';
import {librarySortAndFilter} from '../public/library-utils.js';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('library identity projection distinguishes legacy/deleted users and limits account usage disclosure',()=>{
  const accounts=[{id:'one',displayName:'Alice',password:'never return',role:'administrator'},{id:'two',displayName:'Bob',disabled:true}];
  const files=[{id:'first',uploadedById:'one',ownerId:'two'},{id:'legacy',uploadedById:null,ownerId:null},{id:'orphan',uploadedById:'gone',ownerId:'gone'}];
  const usage=new Map([['one',{bytes:10,files:1}],['gone',{bytes:20,files:1}],['local',{bytes:30,files:1}]]);
  const viewer=libraryAccountPresentation({files,usage,accounts,currentUser:{id:'one',role:'viewer'}});
  assert.equal(viewer.files[0].uploader.label,'Alice');assert.equal(viewer.files[0].quotaOwner.label,'Bob');
  assert.equal(viewer.files[1].uploader.status,'legacy');assert.equal(viewer.files[2].uploader.status,'deleted');
  assert.equal(viewer.storage.mine.bytes,10);assert.equal(viewer.storage.accounts,null);assert.equal(viewer.ownershipAccounts,null);
  assert.doesNotMatch(JSON.stringify(viewer),/password|never return|administrator/);
  const admin=libraryAccountPresentation({files,usage,accounts,currentUser:{id:'one',role:'administrator'}});
  assert.equal(admin.storage.accounts.length,4);assert.equal(admin.storage.accounts.find(row=>row.status==='legacy').limit,null);
  assert.deepEqual(admin.ownershipAccounts,[{id:'one',label:'Alice'}]);
  assert.equal(librarySortAndFilter(viewer.files,{uploader:'mine',currentUserId:'one'}).length,1);
  assert.equal(librarySortAndFilter(viewer.files,{uploader:'legacy'})[0].id,'legacy');
  assert.equal(librarySortAndFilter(viewer.files,{uploader:'deleted'})[0].id,'orphan');
  assert.equal(librarySortAndFilter(viewer.files,{query:'Alice'})[0].id,'first');
  assert.equal(librarySortAndFilter(viewer.files,{sort:'uploader',direction:'asc'})[0].id,'first');
});

test('quota transfers preserve original upload attribution, enforce capacity and retain bounded audit history',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-library-ownership-'));
  const previousDir=process.env.DATA_DIR,previousLimit=process.env.PFC_LIBRARY_MAX_USER_BYTES;
  process.env.DATA_DIR=root;process.env.PFC_LIBRARY_MAX_USER_BYTES='5';
  t.after(async()=>{if(previousDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previousDir;if(previousLimit===undefined)delete process.env.PFC_LIBRARY_MAX_USER_BYTES;else process.env.PFC_LIBRARY_MAX_USER_BYTES=previousLimit;await fs.rm(root,{recursive:true,force:true});});
  const library=await import('../src/print-library.js');
  async function add(content,ownerId){const source=path.join(root,'upload.gcode');await fs.writeFile(source,content);return library.addLibraryFile(source,'part.gcode',{ownerId});}
  const first=await add(';a\n','one');await add(';b\n','two');
  await assert.rejects(library.reassignLibraryOwner(first.id,'two','admin'),{statusCode:507});
  assert.equal((await library.libraryOwnershipHistory(first.id)).length,0);
  process.env.PFC_LIBRARY_MAX_USER_BYTES='10';
  const moved=await library.reassignLibraryOwner(first.id,'two','admin');
  assert.equal(moved.ownerId,'two');assert.equal(moved.uploadedById,'one');
  await library.updateLibraryFileMetadata(first.id,{description:'Edited'});
  assert.equal((await library.getLibraryFile(first.id)).uploadedById,'one');
  await library.reassignLibraryOwner(first.id,'two','admin');
  const history=await library.libraryOwnershipHistory(first.id);
  assert.equal(history.length,1);assert.deepEqual({actorId:history[0].actorId,from:history[0].from,to:history[0].to},{actorId:'admin',from:'one',to:'two'});
  const legacy=await add(';l\n','local');
  const metadataPath=path.join(root,'print-library',legacy.id,'metadata.json');
  const metadata=JSON.parse(await fs.readFile(metadataPath,'utf8'));delete metadata.uploadedById;await fs.writeFile(metadataPath,JSON.stringify(metadata));
  assert.equal((await library.reassignLibraryOwner(legacy.id,'two','admin')).uploadedById,null);
  assert.equal((await library.libraryOwnershipInventory()).usage.get('two').bytes,9);
  assert.equal((await add(';a\n','three')).uploadedById,'one','dedup does not change attribution');
  const firstMetadataPath=path.join(root,'print-library',first.id,'metadata.json');
  const firstMetadata=JSON.parse(await fs.readFile(firstMetadataPath,'utf8'));
  firstMetadata.ownershipHistory=Array.from({length:105},(_,index)=>({at:new Date(index*1000).toISOString(),actorId:'older',from:'one',to:'two'}));
  await fs.writeFile(firstMetadataPath,JSON.stringify(firstMetadata));
  await library.reassignLibraryOwner(first.id,'one','admin');
  const bounded=await library.libraryOwnershipHistory(first.id);
  assert.equal(bounded.length,100);assert.equal(bounded.at(-1).actorId,'admin');
  const {createBackupArchive}=await import('../src/backup-recovery/backup-service.js');
  const {stageRestoreBackup,activatePendingRestore,commitActivatedRestore}=await import('../src/backup-recovery/restore-service.js');
  const backup=path.join(root,'ownership.pfcbackup'),target=path.join(root,'target');
  await createBackupArchive({destinationPath:backup,dataDir:root,applicationDir:root,licensePath:path.join(root,'no-license.json'),controllerVersion:'0.61.13'});
  await fs.mkdir(target);const licensePath=path.join(target,'license.json');
  await stageRestoreBackup(backup,{dataDir:target,licensePath,currentControllerVersion:'0.61.13'});
  const transaction=await activatePendingRestore({dataDir:target,licensePath});await commitActivatedRestore(transaction);
  const restored=JSON.parse(await fs.readFile(path.join(target,'print-library',first.id,'metadata.json'),'utf8'));
  assert.equal(restored.uploadedById,'one');assert.equal(restored.ownerId,'one');assert.deepEqual(restored.ownershipHistory,bounded);
  // Pause a real metadata read after it sees the old owner. A later preview
  // cache write must not restore that stale owner or discard its audit record.
  const uncached=JSON.parse(await fs.readFile(firstMetadataPath,'utf8'));uncached.preview=null;
  await fs.writeFile(firstMetadataPath,JSON.stringify(uncached));
  const originalRead=fs.readFile;let firstRead=true,releaseRead,readStarted;
  const held=new Promise(resolve=>{releaseRead=resolve;}),started=new Promise(resolve=>{readStarted=resolve;});
  fs.readFile=async(...args)=>{
    const result=await originalRead(...args);
    if(firstRead&&String(args[0])===firstMetadataPath){firstRead=false;readStarted();await held;}
    return result;
  };
  try{
    const reading=library.getLibraryFile(first.id);await started;
    await library.reassignLibraryOwner(first.id,'two','race-admin');releaseRead();
    assert.equal((await reading).ownerId,'two');
  }finally{releaseRead();fs.readFile=originalRead;}
  assert.equal((await library.getLibraryFile(first.id)).ownerId,'two');
  assert.equal((await library.libraryOwnershipHistory(first.id)).at(-1).actorId,'race-admin');
});
