import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ReportingService} from '../src/reporting-service.js';
import {LibraryStorageHistory,LIBRARY_HISTORY_FLUSH_MS} from '../src/library-storage-history.js';
import {readLibraryStorageBytes} from '../src/security/library-quota.js';
import {storageReportModel,renderStorageReport} from '../public/library-storage-report.js';

test('storage history is hourly, persistent, bounded and preserved by concurrent print reporting',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-storage-history-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const filePath=path.join(root,'reporting-history.json');const service=new ReportingService({filePath});
  await service.recordLibraryStorage({bytes:20,limit:100,at:'2026-01-01T10:00:00Z'});
  await service.recordLibraryStorage({bytes:30,limit:100,at:'2026-01-01T10:30:00Z'});
  assert.equal((await service.getLibraryStorageHistory()).length,1);
  await Promise.all([
    service.recordLibraryStorage({bytes:10,limit:200,at:'2026-01-01T11:00:00Z'}),
    service.recordTerminalJobs([{id:'job',status:'completed',finishedAt:'2026-01-01T11:00:00Z'}])
  ]);
  const reopened=new ReportingService({filePath});
  await service.flushLibraryStorageHistory({force:true});
  assert.equal((await reopened.getRecords()).length,1);
  const history=await reopened.getLibraryStorageHistory();
  assert.deepEqual(history.map(point=>point.bytes),[30,10]);
  assert.deepEqual(history.map(point=>point.limit),[100,200]);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(filePath,'utf8')),'libraryStorage'),false);
  await reopened.recordLibraryStorage({bytes:50,limit:200,at:'2027-02-01T10:00:00Z'});
  assert.equal((await reopened.getLibraryStorageHistory()).length,1);
  await assert.rejects(reopened.recordLibraryStorage({bytes:-1,limit:200}));
  await assert.rejects(reopened.recordLibraryStorage({bytes:1,limit:0}));
});

test('library observations stay live in memory while disk writes are throttled and retryable',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-storage-batching-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let clock=Date.parse('2026-10-31T00:00:00Z');
  const filePath=path.join(root,'library-storage-history.json');
  const history=new LibraryStorageHistory({filePath,now:()=>clock});await history.init();
  const save=history.save.bind(history);let writes=0;
  history.save=async points=>{writes++;await save(points);};
  const observe=bytes=>history.observe({bytes,limit:1000,at:new Date(clock).toISOString()});
  for(let index=1;index<=100;index++)await observe(index);
  assert.equal(writes,0);assert.equal((await history.getHistory())[0].bytes,100);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath,'utf8')).points,[]);
  assert.equal(await history.flush(),false);
  clock+=LIBRARY_HISTORY_FLUSH_MS;assert.equal(await history.flush(),true);assert.equal(writes,1);
  await observe(101);assert.equal(await history.flush(),false);
  clock+=LIBRARY_HISTORY_FLUSH_MS;
  history.save=async()=>{throw new Error('disk unavailable');};
  await assert.rejects(history.flush(),/disk unavailable/);
  assert.equal(JSON.parse(await fs.readFile(filePath,'utf8')).points[0].bytes,100);
  assert.equal((await history.getHistory())[0].bytes,101);
  history.save=async points=>{writes++;await save(points);};
  assert.equal(await history.flush(),true);assert.equal(writes,2);
  clock+=LIBRARY_HISTORY_FLUSH_MS;await observe(101);
  assert.equal(await history.flush(),false,'unchanged observations do not rewrite the file');
  await observe(102);assert.equal(await history.flush({force:true}),true,'clean shutdown can preserve pending observations');
});

test('existing embedded storage history migrates durably and a separate store remains authoritative',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-storage-migration-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const filePath=path.join(root,'reporting-history.json'),storagePath=path.join(root,'library-storage-history.json');
  const point={at:'2026-10-31T00:00:00.000Z',bytes:10,limit:100};
  await fs.writeFile(filePath,JSON.stringify({version:1,records:[],libraryStorage:[point]}));
  const reports=new ReportingService({filePath});await reports.init();
  assert.deepEqual(JSON.parse(await fs.readFile(storagePath,'utf8')).points,[point]);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(filePath,'utf8')),'libraryStorage'),false);
  await fs.writeFile(filePath,JSON.stringify({version:1,records:[],libraryStorage:[point]}));
  await fs.writeFile(storagePath,JSON.stringify({version:1,points:[]}));
  assert.deepEqual(await new ReportingService({filePath}).getLibraryStorageHistory(),[],'empty restored history must not resurrect legacy data');
  await fs.writeFile(storagePath,JSON.stringify({version:1,points:[{...point,bytes:-1}]}));
  await assert.rejects(new ReportingService({filePath}).init(),/Library storage history is invalid/);
});

test('migration keeps the original field until the separate file is durable and cleanup can retry',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-storage-migration-retry-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const filePath=path.join(root,'reporting-history.json');
  const point={at:'2026-10-31T00:00:00.000Z',bytes:10,limit:100};
  await fs.writeFile(filePath,JSON.stringify({version:1,records:[],libraryStorage:[point]}));
  const reports=new ReportingService({filePath}),save=reports.save.bind(reports);
  reports.save=async()=>{throw new Error('cleanup interrupted');};
  await assert.rejects(reports.init(),/cleanup interrupted/);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath,'utf8')).libraryStorage,[point]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'library-storage-history.json'),'utf8')).points,[point]);
  reports.save=save;await reports.init();
  assert.deepEqual(await reports.getLibraryStorageHistory(),[point]);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(filePath,'utf8')),'libraryStorage'),false);
});

test('physical library measurement includes previews and metadata',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-library-bytes-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'one'));
  await fs.writeFile(path.join(root,'one','part.gcode'),'1234');
  await fs.writeFile(path.join(root,'one','preview.png'),'123');
  await fs.writeFile(path.join(root,'one','metadata.json'),'{}');
  assert.equal(await readLibraryStorageBytes(root),9);
});

test('storage charts use real observations, handle empty/single-owner libraries and escape account names',()=>{
  const report={at:'2026-10-30T12:00:00.000Z',bytes:50,limit:100,
    accounts:[{id:'one',label:'<Alice & Bob>',bytes:40,files:1,limit:80,status:'account'}],history:[]};
  const model=storageReportModel(report);
  assert.equal(model.payload,40);assert.equal(model.percent,50);assert.equal(model.samples.length,1);
  const html=renderStorageReport(report);
  assert.match(html,/&lt;Alice &amp; Bob&gt;/);assert.doesNotMatch(html,/<Alice/);
  assert.match(html,/<circle cx="120" cy="120"/);assert.match(html,/Only one observation/);
  assert.match(html,/Configured maximum: 100 B/);
  assert.match(renderStorageReport({...report,bytes:0,accounts:[]}),/No account storage is in use/);
  const gap=renderStorageReport({...report,history:[{at:'2026-10-28T12:00:00.000Z',bytes:40,limit:100}]});
  assert.match(gap,/d="M[^"H]+M/,'offline gaps are not joined as if measured');
});
