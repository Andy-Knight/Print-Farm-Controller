import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ReportingService} from '../src/reporting-service.js';
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
  assert.equal((await reopened.getRecords()).length,1);
  const history=await reopened.getLibraryStorageHistory();
  assert.deepEqual(history.map(point=>point.bytes),[30,10]);
  assert.deepEqual(history.map(point=>point.limit),[100,200]);
  await reopened.recordLibraryStorage({bytes:50,limit:200,at:'2027-02-01T10:00:00Z'});
  assert.equal((await reopened.getLibraryStorageHistory()).length,1);
  await assert.rejects(reopened.recordLibraryStorage({bytes:-1,limit:200}));
  await assert.rejects(reopened.recordLibraryStorage({bytes:1,limit:0}));
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
