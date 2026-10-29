import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {ResourceLimitSettings} from '../src/security/resource-limit-settings.js';
import {RESOURCE_LIMIT_FIELDS} from '../src/security/resource-limit-definitions.js';
import {setResourceLimitOverrides,configuredLimit} from '../src/security/resource-limits.js';
import {SessionManager} from '../src/security/session-manager.js';
import {StreamAdmission} from '../src/security/stream-admission.js';
import {stageUploadRequest} from '../src/upload-staging.js';
import {boundedCloudFetch} from '../src/security/cloud-operation-limits.js';

async function fixture(t){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-resource-settings-'));
  t.after(async()=>{setResourceLimitOverrides({});await fs.rm(dataDir,{recursive:true,force:true});});
  return dataDir;
}
const field=(status,key)=>status.fields.find(field=>field.key===key);

test('saved settings survive restart without changing active policy before restart',async t=>{
  const dataDir=await fixture(t),settings=new ResourceLimitSettings({dataDir,env:{}});
  await settings.init();
  const before=settings.status();assert.equal(before.restartRequired,false);
  const saved=await settings.save({PFC_MAX_UPLOADS:1,PFC_LIBRARY_MAX_BYTES:1024**3});
  assert.equal(saved.restartRequired,true);
  assert.equal(field(saved,'PFC_MAX_UPLOADS').active,4);
  assert.equal(field(saved,'PFC_MAX_UPLOADS').saved,1);
  assert.equal(configuredLimit('PFC_MAX_UPLOADS',4,{}),4);
  const restarted=new ResourceLimitSettings({dataDir,env:{}});await restarted.init();
  assert.equal(configuredLimit('PFC_MAX_UPLOADS',4,{}),1);
  assert.equal(restarted.status().restartRequired,false);
  await restarted.save({});assert.equal(restarted.status().restartRequired,true);
  const defaults=new ResourceLimitSettings({dataDir,env:{}});await defaults.init();
  assert.equal(configuredLimit('PFC_MAX_UPLOADS',4,{}),4);
  assert.equal(defaults.status().restartRequired,false);
});

test('environment overrides are locked, retain dormant settings and beat saved values',async t=>{
  const dataDir=await fixture(t),settings=new ResourceLimitSettings({dataDir,env:{}});await settings.init();
  await settings.save({PFC_MAX_UPLOADS:2});
  const hosted=new ResourceLimitSettings({dataDir,env:{PFC_MAX_UPLOADS:'3'}});await hosted.init();
  const entry=field(hosted.status(),'PFC_MAX_UPLOADS');
  assert.equal(entry.active,3);assert.equal(entry.locked,true);assert.equal(entry.source,'environment');
  assert.equal(configuredLimit('PFC_MAX_UPLOADS',4,{PFC_MAX_UPLOADS:'3'}),3);
  await assert.rejects(hosted.save({PFC_MAX_UPLOADS:5}),{statusCode:409});
  await hosted.save({PFC_MAX_SESSIONS:50});
  const document=JSON.parse(await fs.readFile(path.join(dataDir,'security','resource-limits.json'),'utf8'));
  assert.equal(document.overrides.PFC_MAX_UPLOADS,2,'locked host values do not erase dormant GUI policy');
});

test('invalid policy cannot replace saved settings; failed saves do not poison subsequent saves',async t=>{
  const dataDir=await fixture(t),settings=new ResourceLimitSettings({dataDir,env:{}});await settings.init();
  await settings.save({PFC_MAX_UPLOADS:3});
  for(const invalid of [null,[],{UNKNOWN:1},{PFC_MAX_UPLOADS:0},{PFC_MAX_UPLOADS:1.1},
    {PFC_MAX_UPLOADS:'3'},{PFC_CLOUD_OPERATION_TIMEOUT_MS:86400001},{PFC_LIBRARY_MAX_BYTES:Number.MAX_SAFE_INTEGER+1}]){
    await assert.rejects(settings.save(invalid),{statusCode:400});
  }
  assert.equal(field(settings.status(),'PFC_MAX_UPLOADS').saved,3);
  await settings.save({PFC_MAX_UPLOADS:2});
  assert.equal(field(settings.status(),'PFC_MAX_UPLOADS').saved,2);
  assert.deepEqual((await fs.readdir(path.join(dataDir,'security'))),['resource-limits.json']);
});

test('preconstructed upload, session, stream and cloud policies use loaded startup settings',async t=>{
  const dataDir=await fixture(t),sessions=new SessionManager(),streams=new StreamAdmission();
  // This client exists before settings init, as do production cloud clients.
  const cloud=boundedCloudFetch(()=>new Promise(()=>{}));
  const setup=new ResourceLimitSettings({dataDir,env:{}});await setup.init();
  await setup.save({PFC_MAX_UPLOADS:1,PFC_MAX_SESSIONS:1,PFC_MAX_STREAMS_PER_IP:1,PFC_CLOUD_HEADER_TIMEOUT_MS:15});
  const startup=new ResourceLimitSettings({dataDir,env:{}});await startup.init();
  sessions.create('one');assert.throws(()=>sessions.create('two'),{statusCode:429});
  const req={socket:{remoteAddress:'one'},pfcUser:{id:'one'},pfcSessionId:'session'};
  const release=streams.admit(req,new EventEmitter());
  assert.throws(()=>streams.admit({...req,pfcSessionId:'other'},new EventEmitter()),{statusCode:429});release();
  const input=Readable.from(['one']);input.headers={'content-length':'3'};
  const staged=await stageUploadRequest(input,'part.gcode',{checkSpace:async()=>{}});
  try{await assert.rejects(stageUploadRequest(Readable.from(['two']),'part.gcode',{checkSpace:async()=>{}}),{statusCode:429});}
  finally{await staged.cleanup();}
  await assert.rejects(cloud('https://example.invalid'),/headers timed out/);
  assert.equal(field(startup.status(),'PFC_MAX_STREAMS_PER_IP').active,1);
});

test('corrupt settings and invalid environment policies fail closed at startup',async t=>{
  const dataDir=await fixture(t);
  await fs.mkdir(path.join(dataDir,'security'));
  await fs.writeFile(path.join(dataDir,'security','resource-limits.json'),'{broken');
  await assert.rejects(new ResourceLimitSettings({dataDir,env:{}}).init());
  await fs.writeFile(path.join(dataDir,'security','resource-limits.json'),JSON.stringify({version:1,overrides:{PFC_MAX_UPLOADS:-1}}));
  await assert.rejects(new ResourceLimitSettings({dataDir,env:{}}).init(),/positive/);
  await fs.writeFile(path.join(dataDir,'security','resource-limits.json'),JSON.stringify({version:1,overrides:{}}));
  await assert.rejects(new ResourceLimitSettings({dataDir,env:{PFC_CLOUD_IDLE_TIMEOUT_MS:'nope'}}).init(),/positive/);
  assert.equal(RESOURCE_LIMIT_FIELDS.length,22);
});
