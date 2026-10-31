import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PrintQueueService} from '../src/print-queue.js';
import {ReportingService} from '../src/reporting-service.js';
import {deleteLibraryFileAndHistory} from '../src/library-deletion.js';

const fileId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job=(id,libraryId=fileId,patch={})=>({id,status:'completed',fileName:'same-name.gcode',
  stagedFile:{id:libraryId,fileName:'same-name.gcode'},finishedAt:'2026-10-31T12:00:00.000Z',...patch});
async function fixture(t,jobs){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-library-delete-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const reporting=new ReportingService({filePath:path.join(root,'reporting-history.json')});await reporting.init();
  let persisted=structuredClone(jobs),deleted=false;
  const queue=new PrintQueueService({fleetState:{getFleet:()=>[],getPrinterState:()=>null},
    chamberPreheat:{isActive:()=>false},saveJobsFn:async records=>{persisted=structuredClone(records);},
    recordTerminalJobsFn:records=>reporting.recordTerminalJobs(records)});
  queue.jobs=structuredClone(jobs);await reporting.recordTerminalJobs(jobs);
  const options={queue,reporting,getFile:async()=>({id:fileId}),removeFile:async()=>{deleted=true;}};
  return {root,reporting,queue,options,persisted:()=>persisted,deleted:()=>deleted};
}

test('deleting a library file removes only its recent and archived print records, including older history',async t=>{
  const f=await fixture(t,[job('done'),job('failed',fileId,{status:'failed'}),job('cancelled',fileId,{status:'cancelled'}),job('other',otherId)]);
  await f.reporting.recordTerminalJobs([job('older-archived')]);
  const removed=await deleteLibraryFileAndHistory(fileId.toUpperCase(),f.options);
  assert.deepEqual(removed,{recent:3,reporting:4});assert.equal(f.deleted(),true);
  assert.deepEqual(f.queue.jobs.map(row=>row.id),['other']);assert.deepEqual(f.persisted().map(row=>row.id),['other']);
  const reopened=new ReportingService({filePath:path.join(f.root,'reporting-history.json')});
  assert.deepEqual((await reopened.getRecords()).map(row=>row.id),['other'],'same filename on a different library ID survives');
});

test('active work, pending review, bed clearance and active production siblings prevent all cleanup',async t=>{
  for(const jobs of [
    [job('queued',fileId,{status:'queued'})],
    [job('printing',fileId,{status:'printing'})],
    [job('review',fileId,{status:'needs_review'})],
    [job('uncleared',fileId,{bedClearanceRequired:true,bedClearedAt:null})],
    [job('production',fileId,{productionBatchId:'batch'}),job('sibling',otherId,{productionBatchId:'batch',status:'queued'})]
  ]){
    const f=await fixture(t,jobs),before=await f.reporting.getRecords();
    await assert.rejects(deleteLibraryFileAndHistory(fileId,f.options),{statusCode:409});
    assert.equal(f.deleted(),false);assert.deepEqual(f.queue.jobs,jobs);
    assert.deepEqual(await f.reporting.getRecords(),before);
  }
});

test('a delayed older reporting callback cannot resurrect history after library deletion',async t=>{
  const f=await fixture(t,[job('old')]);let release,entered;
  const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  let first=true;
  f.queue.recordTerminalJobs=async records=>{
    if(first){first=false;entered();await held;}
    await f.reporting.recordTerminalJobs(records);
  };
  const older=f.queue.persistAndNotify();await started;
  const deleting=deleteLibraryFileAndHistory(fileId,f.options);await Promise.resolve();
  release();await Promise.all([older,deleting]);
  assert.deepEqual(await f.reporting.getRecords(),[]);assert.equal(f.deleted(),true);
});

test('cleanup failure keeps the file and a failed file removal can be retried safely',async t=>{
  const queueFailure=await fixture(t,[job('one')]);
  queueFailure.queue.saveJobs=async()=>{throw new Error('disk unavailable');};
  await assert.rejects(deleteLibraryFileAndHistory(fileId,queueFailure.options),/disk unavailable/);
  assert.equal(queueFailure.deleted(),false);assert.equal(queueFailure.queue.jobs.length,1);
  assert.equal((await queueFailure.reporting.getRecords()).length,1);
  const reportFailure=await fixture(t,[job('two')]);
  reportFailure.reporting.save=async()=>{throw new Error('report store unavailable');};
  await assert.rejects(deleteLibraryFileAndHistory(fileId,reportFailure.options),/file was kept/);
  assert.equal(reportFailure.deleted(),false);
  const retry=await fixture(t,[job('three')]);
  await assert.rejects(deleteLibraryFileAndHistory(fileId,{...retry.options,removeFile:async()=>{throw new Error('locked');}}),/Retry the deletion/);
  assert.equal(retry.deleted(),false);assert.deepEqual(await retry.reporting.getRecords(),[]);
  assert.deepEqual(await deleteLibraryFileAndHistory(fileId,retry.options),{recent:0,reporting:0});
  assert.equal(retry.deleted(),true);
});

test('slow notification delivery does not block durable history deletion',async t=>{
  const f=await fixture(t,[job('old')]);let release,entered;
  const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  let first=true;
  f.queue.afterPersist=async()=>{if(first){first=false;entered();await held;}};
  const notifying=f.queue.persistAndNotify();await started;
  try{
    await deleteLibraryFileAndHistory(fileId,f.options);
    assert.equal(f.deleted(),true);assert.deepEqual(await f.reporting.getRecords(),[]);
  }finally{release();await notifying;}
  assert.deepEqual(await f.reporting.getRecords(),[]);
});
