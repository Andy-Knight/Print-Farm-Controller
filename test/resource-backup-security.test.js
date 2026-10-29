import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable,PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {ResourceAdmission,requireFreeSpace,BoundedWorkPool} from '../src/security/resource-limits.js';
import {requireLibraryCapacity} from '../src/security/library-quota.js';
import {StreamAdmission} from '../src/security/stream-admission.js';
import {SessionManager} from '../src/security/session-manager.js';
import {stageUploadRequest} from '../src/upload-staging.js';
import {writeZipArchive,readZipDirectory,readZipEntry} from '../src/backup-recovery/backup-archive.js';
import {verifyBackupArchive,buildManifest,jsonEntry} from '../src/backup-recovery/backup-format.js';
import {boundedCloudFetch} from '../src/security/cloud-operation-limits.js';
import {withOperationBudget,cancelActiveOperations} from '../src/security/operation-budget.js';
import {BackupOperationLock} from '../src/backup-recovery/backup-operation-lock.js';
import {OneDriveClient} from '../src/backup-recovery/one-drive-client.js';
import {GoogleDriveClient} from '../src/backup-recovery/google-drive-client.js';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-resource-security-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const noSpaceCheck=async()=>{};

test('upload capacity is reserved before disk I/O and released after success, failure and timeout',async()=>{
  const admission=new ResourceAdmission({maxActive:2,maxPerUser:1,maxBytes:20});
  const input=Readable.from(['12345678']);input.headers={'content-length':'8'};input.pfcUser={id:'one'};
  const staged=await stageUploadRequest(input,'part.gcode',{admission,maxBytes:10,checkSpace:noSpaceCheck});
  assert.equal(admission.active,1);assert.equal(admission.bytes,8);
  const another=Readable.from(['data']);another.pfcUser={id:'one'};
  let checked=false;
  await assert.rejects(stageUploadRequest(another,'other.gcode',{admission,maxBytes:10,checkSpace:async()=>{checked=true;}}),{statusCode:429});
  assert.equal(checked,false);
  await staged.cleanup();await staged.cleanup();assert.equal(admission.active,0);
  const broken=Readable.from(['too much data for quota']);
  await assert.rejects(stageUploadRequest(broken,'bad.gcode',{admission,maxBytes:10,checkSpace:noSpaceCheck}),/upload limit/);
  assert.equal(admission.bytes,0);
  const stalled=new PassThrough();
  await assert.rejects(stageUploadRequest(stalled,'stalled.gcode',{admission,maxBytes:10,checkSpace:noSpaceCheck,idleTimeoutMs:15}),/deadline/);
  assert.equal(admission.active,0);
  await assert.rejects(stageUploadRequest(Readable.from(['x']),'disk.gcode',{admission,maxBytes:10,checkSpace:async()=>{throw new Error('disk full');}}),/disk full/);
  assert.equal(admission.bytes,0);
});

test('shared byte reservations and free-space margins cannot be exceeded',async()=>{
  const pool=new ResourceAdmission({maxActive:3,maxPerUser:2,maxBytes:10});
  const release=pool.reserve('a',8);
  assert.throws(()=>pool.reserve('b',3),{statusCode:429});
  release();release();assert.equal(pool.bytes,0);
  await assert.rejects(requireFreeSpace('fixture',100,{reservedBytes:200,minFreeBytes:100,statfs:async()=>({bavail:399,bsize:1})}),{statusCode:507});
  await requireFreeSpace('fixture',100,{reservedBytes:200,minFreeBytes:100,statfs:async()=>({bavail:400,bsize:1})});
});

test('file inspection has bounded concurrency and a bounded waiting queue',async()=>{
  const pool=new BoundedWorkPool({concurrency:1,maxWaiting:1});let release;
  const running=pool.run(()=>new Promise(resolve=>{release=resolve;}));
  const waiting=pool.run(async()=>42);
  await assert.rejects(pool.run(async()=>0),{statusCode:503});
  release();await running;assert.equal(await waiting,42);assert.equal(pool.active,0);
});

test('library admission accounts for real stored bytes, user ownership and file count',async t=>{
  const root=await fixture(t),item=path.join(root,'item');await fs.mkdir(item);
  await fs.writeFile(path.join(item,'part.gcode'),'12345');
  await fs.writeFile(path.join(item,'metadata.json'),JSON.stringify({ownerId:'one',size:5}));
  const options={checkSpace:noSpaceCheck,ownerId:'one'};
  await assert.rejects(requireLibraryCapacity(root,1,{...options,maxBytes:5}),{statusCode:507});
  await assert.rejects(requireLibraryCapacity(root,6,{...options,maxPerUserBytes:10}),{statusCode:507});
  await assert.rejects(requireLibraryCapacity(root,1,{...options,maxFiles:1}),{statusCode:507});
  await requireLibraryCapacity(root,1,{...options,maxBytes:1000,maxPerUserBytes:10});
  const empty=await fixture(t);await assert.rejects(requireLibraryCapacity(empty,101,{...options,maxBytes:100}),{statusCode:507});
});

test('session admission sweeps expired sessions before applying global and user quotas',()=>{
  let now=0;
  const sessions=new SessionManager({now:()=>now,idleMs:10,absoluteMs:100,maxSessions:2,maxPerUser:1});
  const old=sessions.create('one');sessions.create('two');
  assert.throws(()=>sessions.create('one'),{statusCode:429});
  assert.throws(()=>sessions.create('three'),{statusCode:429});
  now=11;const fresh=sessions.create('one');assert.notEqual(old,fresh);assert.equal(sessions.resolve(old),null);assert.equal(sessions.size,1);
});

test('camera/event stream quotas release every counter on close and finish',()=>{
  const quota=new StreamAdmission({maxActive:3,maxPerUser:2,maxPerIp:2,maxPerSession:1});
  const request=session=>({socket:{remoteAddress:'ip'},pfcUser:{id:'one'},pfcSessionId:session});
  const first=new EventEmitter();quota.admit(request('a'),first);
  assert.throws(()=>quota.admit(request('a'),new EventEmitter()),{statusCode:429});
  const second=new EventEmitter();quota.admit(request('b'),second);
  assert.throws(()=>quota.admit(request('c'),new EventEmitter()),{statusCode:429});
  first.emit('finish');first.emit('close');
  const third=new EventEmitter();quota.admit(request('c'),third);
  second.emit('close');third.emit('close');assert.equal(quota.pool.active,0);assert.equal(quota.ips.size,0);assert.equal(quota.sessions.size,0);
});

test('ZIP directories and declared expansion are bounded before payload decompression',async t=>{
  const root=await fixture(t),file=path.join(root,'compressed.zip');
  await writeZipArchive(file,[{name:'large.json',buffer:Buffer.alloc(1024*1024,65)}]);
  assert.ok((await fs.stat(file)).size<10000);
  await assert.rejects(readZipDirectory(file,{maxExpandedBytes:1024}),/expansion/);
  await assert.rejects(readZipDirectory(file,{maxDirectoryBytes:10}),/directory exceeds/);
  const sparse=path.join(root,'directory.zip'),handle=await fs.open(sparse,'wx');
  const directorySize=17*1024**2,eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50);eocd.writeUInt16LE(1,10);eocd.writeUInt32LE(directorySize,12);
  await handle.truncate(directorySize+22);await handle.write(eocd,0,22,directorySize);await handle.close();
  await assert.rejects(readZipDirectory(sparse),/directory exceeds/);
});

test('ZIP actual-output work, deadlines and declared entry sizes stay bounded',async t=>{
  const root=await fixture(t),file=path.join(root,'work.zip');
  await writeZipArchive(file,[{name:'data.json',buffer:Buffer.alloc(100,65)}]);
  const [entry]=await readZipDirectory(file,{maxExpandedBytes:100});
  for(let i=0;i<3;i++)assert.equal((await readZipEntry(file,entry)).length,100);
  await assert.rejects(readZipEntry(file,entry),/aggregate output budget/);
  const [short]=await readZipDirectory(file);short.size=1;
  await assert.rejects(readZipEntry(file,short),/exceeds declared/);
  const [expired]=await readZipDirectory(file,{timeoutMs:1});await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(readZipEntry(file,expired),/deadline/);
});

test('backup checksum size declarations are compared before hashing payload entries',async t=>{
  const root=await fixture(t),file=path.join(root,'backup.pfcbackup');
  const payload=Buffer.alloc(1024*1024,65),manifest=jsonEntry('manifest.json',buildManifest({payloadBytes:payload.length}));
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  await writeZipArchive(file,[manifest,{name:'state/data.json',buffer:payload},jsonEntry('checksums.json',{algorithm:'sha256',entries:{
    'manifest.json':{size:manifest.buffer.length,sha256:hash(manifest.buffer)},
    'state/data.json':{size:1,sha256:hash(payload)}
  }})]);
  await assert.rejects(verifyBackupArchive(file),/checksum size mismatch/);
});

test('cloud deadlines reject unresponsive headers even if fetch ignores the abort signal',async()=>{
  const fetch=boundedCloudFetch(()=>new Promise(()=>{}),{headerTimeoutMs:15});
  await assert.rejects(fetch('https://fixture.invalid'),/headers timed out/);
});

test('cloud metadata reads are bounded and cancel oversized sources',async()=>{
  let cancelled=false;
  const fetch=boundedCloudFetch(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9));},cancel(){cancelled=true;}})),{metadataBytes:8});
  const response=await fetch('https://fixture.invalid');
  await assert.rejects(response.text(),/size limit/);assert.equal(cancelled,true);
});

test('trickling cloud transfers meet a total deadline, clean streams and release the backup lock',async()=>{
  let cancelled=false;
  const fetch=boundedCloudFetch(async()=>new Response(new ReadableStream({start(c){this.timer=setInterval(()=>c.enqueue(new Uint8Array([1])),2);},cancel(){clearInterval(this.timer);cancelled=true;}})),{idleTimeoutMs:100});
  const lock=new BackupOperationLock({timeoutMs:25});
  await assert.rejects(lock.run('download',async()=>{const response=await fetch('https://fixture.invalid');return response.text();}),/deadline/);
  assert.equal(cancelled,true);assert.equal(lock.isBusy(),false);
  assert.equal(await lock.run('next',async()=>true),true);
});

test('administrator cancellation aborts an upload and releases operation admission',async()=>{
  const body=new PassThrough(),lock=new BackupOperationLock();
  const fetch=boundedCloudFetch(()=>new Promise(()=>{}));
  const timer=setTimeout(()=>cancelActiveOperations(),15);
  await assert.rejects(lock.run('upload',()=>fetch('https://fixture.invalid',{method:'PUT',body})),/cancelled/);
  clearTimeout(timer);assert.equal(body.destroyed,true);assert.equal(lock.isBusy(),false);
});

test('cloud pagination cannot loop without a page budget',async t=>{
  const root=await fixture(t);let calls=0;
  const client=new OneDriveClient({dataDir:root,fetchFn:async()=>{calls++;return Response.json({value:[],'@odata.nextLink':'https://graph.microsoft.com/v1.0/again'});}});
  client.ensureBackupFolder=async()=>({id:'fixture'});client.getAccessToken=async()=>'synthetic';
  await assert.rejects(client.listChildren(),/page budget/);assert.equal(calls,100);
});

test('an aborted cloud restore removes its partially downloaded file before returning',async t=>{
  const root=await fixture(t),previous={TEMP:process.env.TEMP,TMP:process.env.TMP,TMPDIR:process.env.TMPDIR};
  Object.assign(process.env,{TEMP:root,TMP:root,TMPDIR:root});
  try{
    const client=new GoogleDriveClient({dataDir:path.join(root,'state'),networkOptions:{operationTimeoutMs:100,idleTimeoutMs:1000},fetchFn:async()=>new Response(new ReadableStream({
      start(c){this.timer=setInterval(()=>c.enqueue(new Uint8Array([1])),5);},cancel(){clearInterval(this.timer);}
    }))});
    client.getBackup=async()=>({id:'fixture',name:'fixture.pfcbackup',size:0});client.getAccessToken=async()=>'synthetic';
    await assert.rejects(client.downloadBackup('fixture'),/deadline/);
    assert.deepEqual(await fs.readdir(root),[]);
  }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('malformed repeated thumbnail headers remain bounded in an isolated parser process',async()=>{
  const module=new URL('../src/file-preview.js',import.meta.url).href;
  const code=`import {gcodeThumbnailCandidates} from ${JSON.stringify(module)};console.log(gcodeThumbnailCandidates('; thumbnail begin 10x10\\n'.repeat(50000)).length);`;
  const output=await new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','-e',code],{windowsHide:true,timeout:5000},(error,stdout)=>error?reject(error):resolve(stdout)));
  assert.equal(output.trim(),'0');
});

test('metadata budgets are shared across repeated cloud requests in one operation',async()=>{
  const fetch=boundedCloudFetch(async()=>new Response('123456789'),{metadataBytes:10,aggregateMetadataBytes:16});
  await assert.rejects(withOperationBudget(async()=>{
    await (await fetch('https://fixture.invalid/one')).text();
    await (await fetch('https://fixture.invalid/two')).text();
  }),/aggregate size limit/);
});

test('a cloud response body that never produces data meets the idle deadline',async()=>{
  let cancelled=false;
  const fetch=boundedCloudFetch(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})),{idleTimeoutMs:15});
  await assert.rejects(withOperationBudget(async()=>await (await fetch('https://fixture.invalid')).text(),{timeoutMs:200}),/body stalled/);
  assert.equal(cancelled,true);
});
