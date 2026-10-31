import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {AccountStore} from '../src/security/account-store.js';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const password='A secure integration test 2026!';
async function freePort(){
  const s=net.createServer();
  s.listen(0,'127.0.0.1');await once(s,'listening');
  const port=s.address().port;
  await new Promise(resolve=>s.close(resolve));return port;
}
async function waitHealth(base,child){
  for(let i=0;i<120;i++){
    if(child.exitCode!==null||child.signalCode!==null)throw Error('Controller exited before ready');
    try{
      const res=await fetch(base+'/api/health',{signal:AbortSignal.timeout(600)});
      if(res.ok)return res;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,120));
  }
  throw Error('Controller did not become healthy');
}
test('real HTTP dispatcher enforces login, CSRF and RBAC before controller actions', {timeout:40000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-live-auth-'));
  const dataDir=path.join(directory,'data'),logDir=path.join(directory,'logs');
  let child;
  try{
    const accounts=new AccountStore({dataDir});
    await accounts.bootstrapAdministrator({username:'controlleradmin',password});
    await accounts.addUser({username:'readuser',password,role:'viewer'});
    await accounts.addUser({username:'operatoruser',password,role:'operator'});
    await fs.writeFile(path.join(dataDir,'alerts.json'),JSON.stringify({version:1,rules:[],history:[],destinations:[{id:'synthetic-hook',name:'Operations',provider:'webhook',config:{url:'https://example.invalid/SECRET_URL',authorization:'SECRET_AUTH'}}]}));
    const port=await freePort(),base='http://127.0.0.1:'+port;
    child=spawn(process.execPath,['src/server.js'],{
      cwd,env:{...process.env,DATA_DIR:dataDir,LOG_DIR:logDir,
        HOST:'127.0.0.1',PORT:String(port),PFC_AUTH_REQUIRED:'1',
        PFC_AUTH_ALLOW_HTTP:'1',PFC_PUBLIC_ORIGIN:base,PFC_MAX_STREAMS:'2',PFC_MAX_STREAMS_PER_USER:'2'},
      stdio:['ignore','pipe','pipe']
    });
    let stderr='';
    child.stdout.on('data',chunk=>{stderr+=chunk.toString().slice(-500);});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString().slice(-500);});
    const status=await waitHealth(base,child);
    const health=await status.json();
    assert.equal(health.ok,true);assert.equal(health.license,undefined);
    assert.equal((await fetch(base+'/api/fleet')).status,401);
    assert.equal((await fetch(base+'/api/events')).status,401);
    assert.equal((await fetch(base+'/api/printers/a/print',{method:'POST'})).status,401);
    const signIn=async username=>{
      const res=await fetch(base+'/api/auth/login',{
        method:'POST',headers:{origin:base,'content-type':'application/json'},
        body:JSON.stringify({username,password})});
      assert.equal(res.status,200,username+': '+res.status);
      const data=await res.json();
      return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:data.csrf};
    };
    const viewer=await signIn('readuser'),operator=await signIn('operatoruser'),admin=await signIn('controlleradmin');
    const call=(method,url,identity,{csrf=true,origin=true,body=null}={})=>fetch(base+url,{
      method,headers:{
        cookie:identity.cookie,...(origin?{origin:typeof origin==='string'?origin:base}:{}),
        ...(csrf?{'x-pfc-csrf':identity.csrf}:{}),
        ...(body?{'content-type':'application/json'}:{})
      },...(body?{body:JSON.stringify(body)}:{})
    });
    const userRecords=await accounts.listUsers();
    const adminId=userRecords.find(user=>user.username==='controlleradmin').id;
    const operatorId=userRecords.find(user=>user.username==='operatoruser').id;
    const upload=identity=>fetch(base+'/api/library',{method:'POST',headers:{cookie:identity.cookie,origin:base,'x-pfc-csrf':identity.csrf,'x-file-name':'ownership.gcode','content-type':'application/octet-stream'},body:'; ownership fixture\nG1 X1\n'});
    const firstUpload=await upload(operator);assert.equal(firstUpload.status,201);
    const libraryId=(await firstUpload.json()).file.id;
    const initialLibrary=await (await call('GET','/api/library',viewer)).json();
    assert.equal((await call('POST','/api/emulator/status',admin,{csrf:false,body:{enabled:false}})).status,403);
    assert.equal((await call('POST','/api/emulator/status',admin,{origin:'https://other.invalid',body:{enabled:false}})).status,403);
    for(const identity of [viewer,operator])assert.equal((await call('GET','/api/reports/library',identity)).status,403);
    const ownStorage=await (await call('GET','/api/library/storage',operator)).json();
    assert.ok(ownStorage.mine.bytes>0);assert.deepEqual(Object.keys(ownStorage),['mine']);
    const storageReport=await (await call('GET','/api/reports/library',admin)).json();
    assert.ok(storageReport.bytes>ownStorage.mine.bytes,'global measurement includes metadata');
    assert.ok(storageReport.limit>0);assert.ok(storageReport.history.length>0);
    assert.equal(storageReport.accounts.find(row=>row.id===operatorId).bytes,ownStorage.mine.bytes);
    assert.equal(initialLibrary.files[0].uploader.id,operatorId);
    assert.equal(initialLibrary.files[0].uploader.label,'operatoruser');
    assert.equal(initialLibrary.storage.accounts,null);assert.equal(initialLibrary.ownershipAccounts,null);
    for(const identity of [viewer,operator]){
      assert.equal((await call('GET',`/api/library/${libraryId}/ownership`,identity)).status,403);
      assert.equal((await call('PUT',`/api/library/${libraryId}/ownership`,identity,{body:{ownerId:adminId}})).status,403);
    }
    assert.equal((await call('PUT',`/api/library/${libraryId}/ownership`,admin,{csrf:false,body:{ownerId:adminId}})).status,403);
    assert.equal((await call('PUT',`/api/library/${libraryId}/ownership`,admin,{body:{ownerId:'unknown'}})).status,400);
    assert.equal((await call('PATCH',`/api/library/${libraryId}`,operator,{body:{ownerId:adminId,uploadedById:adminId,description:'Edited'}})).status,200);
    const afterEdit=await (await call('GET','/api/library',operator)).json();
    assert.equal(afterEdit.files[0].ownerId,operatorId);assert.equal(afterEdit.storage.mine.files,1);
    const transferred=await call('PUT',`/api/library/${libraryId}/ownership`,admin,{body:{ownerId:adminId}});
    assert.equal(transferred.status,200);
    const afterTransfer=await (await call('GET','/api/library',admin)).json();
    assert.equal(afterTransfer.files[0].ownerId,adminId);assert.equal(afterTransfer.files[0].uploader.id,operatorId);
    assert.equal(afterTransfer.storage.mine.files,1);
    assert.equal((await (await call('GET','/api/library',operator)).json()).storage.mine.files,0);
    const duplicate=await upload(admin);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).file.uploadedById,operatorId);
    const history=await (await call('GET',`/api/library/${libraryId}/ownership`,admin)).json();
    assert.equal(history.history.length,1);assert.equal(history.history[0].actorId,adminId);assert.equal(history.history[0].from,operatorId);assert.equal(history.history[0].to,adminId);
    const queued=await call('POST','/api/queue',admin,{body:{assignmentMode:'automatic',libraryFileId:libraryId}});
    assert.equal(queued.status,201);const linkedJob=(await queued.json()).job;
    assert.equal((await call('DELETE',`/api/library/${libraryId}`,admin)).status,409,'pending work blocks deletion');
    assert.equal((await call('DELETE',`/api/queue/${linkedJob.id}`,admin)).status,200);
    for(const identity of [viewer,operator])assert.equal((await call('DELETE',`/api/library/${libraryId}`,identity)).status,403);
    assert.equal((await call('DELETE',`/api/library/${libraryId}`,admin,{csrf:false})).status,403);
    const deleted=await call('DELETE',`/api/library/${libraryId}`,admin);
    assert.equal(deleted.status,200);assert.equal((await deleted.json()).historyRemoved.recent,1);
    assert.equal((await (await call('GET','/api/library',admin)).json()).files.some(file=>file.id===libraryId),false);
    assert.equal((await (await call('GET','/api/queue',admin)).json()).jobs.some(job=>job.id===linkedJob.id),false);
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir,'reporting-history.json'),'utf8')).records.some(job=>job.libraryFileId===libraryId),false);
    assert.equal((await call('GET','/api/queue',viewer)).status,200);
    for (const identity of [viewer,operator]) {
      const alerts=await (await call('GET','/api/alerts',identity)).json();
      assert.equal(alerts.alerts.destinations[0].name,'Operations');
      assert.doesNotMatch(JSON.stringify(alerts),/SECRET_|example.invalid/);
    }
    assert.match(JSON.stringify(await (await call('GET','/api/alerts',admin)).json()),/SECRET_URL/);
    assert.equal((await call('POST','/api/printers/a/print',viewer)).status,403);
    assert.equal((await call('POST','/api/batch',viewer)).status,403);
    assert.equal((await call('GET','/api/backup/download/file',viewer)).status,403);
    assert.equal((await call('GET','/api/diagnostics',viewer)).status,403);
    assert.equal((await call('POST','/api/printers',operator)).status,403);
    assert.equal((await call('GET','/api/backup/status',operator)).status,403);
    assert.equal((await call('GET','/api/emulator/status',operator)).status,403);
    assert.equal((await call('GET','/api/emulator/status',admin)).status,200);
    assert.equal((await call('GET','/api/auth/users',viewer)).status,403);
    assert.equal((await call('GET','/api/auth/users',admin)).status,200);
    for(const identity of [viewer,operator]){
      assert.equal((await call('GET','/api/settings/resource-limits',identity)).status,403);
      assert.equal((await call('PUT','/api/settings/resource-limits',identity,{body:{overrides:{}}})).status,403);
    }
    assert.equal((await call('PUT','/api/settings/resource-limits',admin,{csrf:false,body:{overrides:{}}})).status,403);
    assert.equal((await call('PUT','/api/settings/resource-limits',admin,{origin:false,body:{overrides:{}}})).status,403);
    const limits=await (await call('GET','/api/settings/resource-limits',admin)).json();
    assert.equal(limits.limits.fields.find(field=>field.key==='PFC_MAX_STREAMS').locked,true);
    assert.equal((await call('PUT','/api/settings/resource-limits',admin,{body:{overrides:{PFC_MAX_STREAMS:3}}})).status,409);
    assert.equal((await call('PUT','/api/settings/resource-limits',admin,{body:{overrides:{PFC_MAX_SESSIONS:0}}})).status,400);
    const saved=await call('PUT','/api/settings/resource-limits',admin,{body:{overrides:{PFC_MAX_SESSIONS_PER_USER:21}}});
    assert.equal(saved.status,200);assert.equal((await saved.json()).limits.restartRequired,true);
    assert.equal((await call('GET','/api/undocumented',admin)).status,404);
    assert.equal((await call('POST','/api/batch',admin,{csrf:false})).status,403);
    assert.equal((await call('POST','/api/batch',admin,{origin:false})).status,403);
    for(const identity of [viewer,operator])assert.equal((await call('POST','/api/backup/cancel',identity)).status,403);
    assert.equal((await call('POST','/api/backup/cancel',admin,{csrf:false})).status,403);
    const cancellation=await call('POST','/api/backup/cancel',admin);
    assert.equal(cancellation.status,200);assert.equal((await cancellation.json()).cancelled,0);
    const streams=[await call('GET','/api/events',viewer),await call('GET','/api/events',viewer)];
    try{
      assert.ok(streams.every(response=>response.status===200));
      const excess=await call('GET','/api/events',viewer);assert.equal(excess.status,429);await excess.text();
      assert.equal((await fetch(base+'/healthz')).status,200,'stream exhaustion leaves health responsive');
      await streams[0].body.cancel();
      let replacement;
      for(let attempt=0;attempt<40;attempt++){
        replacement=await call('GET','/api/events',viewer);
        if(replacement.status===200)break;
        await replacement.text();await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(replacement.status,200);await replacement.body.cancel();
    }finally{for(const response of streams)await response.body?.cancel().catch(()=>{});}
    assert.equal((await call('POST','/api/auth/logout',viewer)).status,200);
    assert.equal((await call('GET','/api/queue',viewer)).status,401);
    const historyPath=path.join(dataDir,'library-storage-history.json');
    assert.deepEqual(JSON.parse(await fs.readFile(historyPath,'utf8')).points,[],
      'live upload/transfer reporting must not force immediate history writes');
    // Windows TerminateProcess does not deliver a catchable SIGTERM. Exercise
    // the real graceful signal path on the Linux CI/container platform.
    if(process.platform!=='win32'){
      const exited=once(child,'exit');child.kill('SIGTERM');await exited;
      assert.ok(JSON.parse(await fs.readFile(historyPath,'utf8')).points.length>0,
        'clean controller shutdown persists pending storage observations');
    }
  }finally{
    if(child&&child.exitCode===null){
      const exit=once(child,'exit');
      child.kill('SIGTERM');
      await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,3000))]);
      if(child.exitCode===null)child.kill('SIGKILL');
    }
    await fs.rm(directory,{recursive:true,force:true});
  }
});


test('fresh HTTP deployment renders setup GUI while APIs are locked, then enables sign-in', {timeout:40000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-live-onboarding-'));
  const dataDir=path.join(directory,'data'),logDir=path.join(directory,'logs');
  let child;
  try{
    const port=await freePort(),base='http://127.0.0.1:'+port;
    let privateStartupLogs='';
    child=spawn(process.execPath,['src/server.js'],{
      cwd,env:{...process.env,DATA_DIR:dataDir,LOG_DIR:logDir,
        HOST:'127.0.0.1',PORT:String(port),PFC_AUTH_REQUIRED:'1',
        PFC_AUTH_ALLOW_HTTP:'1',PFC_PUBLIC_ORIGIN:base},
      stdio:['ignore','pipe','pipe']
    });
    child.stdout.on('data',data=>{privateStartupLogs+=String(data);});
    child.stderr.on('data',data=>{privateStartupLogs+=String(data);});
    await waitHealth(base,child);
    for(const route of ['/','/users','/index.html']){
      const shell=await fetch(base+route);
      assert.equal(shell.status,200,'setup shell must remain accessible on '+route);
      const markup=await shell.text();
      assert.match(markup,/id="authSetupForm"/);
      assert.match(shell.headers.get('content-type')||'',/html/);
    }
    for(const resource of ['/auth-gate.js','/auth.css']){
      const res=await fetch(base+resource);
      assert.equal(res.status,200,resource+' must remain accessible');
    }
    const pre=(await (await fetch(base+'/api/auth/session')).json());
    assert.equal(pre.enabled,true);
    assert.equal(pre.setupRequired,true);
    assert.equal(pre.enrollmentAvailable,true);
    assert.equal(pre.loginAvailable,true);
    assert.equal((await fetch(base+'/api/fleet')).status,503);
    assert.equal((await fetch(base+'/simulator/')).status,503);
    assert.equal((await fetch(base+'/api/queue')).status,503);
    const code=privateStartupLogs.match(/One-time enrollment code \(private\): ([0-9A-F]{48})/)?.[1];
    assert.ok(code,'private setup code must be printed before HTTP startup');
    assert.equal((await (await fetch(base+'/')).text()).includes(code),false);
    const enroll=await fetch(base+'/api/auth/enroll',{
      method:'POST',headers:{origin:base,'content-type':'application/json'},
      body:JSON.stringify({code,username:'firstadmin',password,displayName:'Owner'})
    });
    assert.equal(enroll.status,201,await enroll.text());
    assert.equal((await fetch(base+'/api/fleet')).status,401);
    assert.equal((await fetch(base+'/')).status,200);
    const login=await fetch(base+'/api/auth/login',{
      method:'POST',headers:{origin:base,'content-type':'application/json'},
      body:JSON.stringify({username:'firstadmin',password})
    });
    assert.equal(login.status,200);
    assert.ok(login.headers.get('set-cookie')?.includes('pfc_session='));
  }finally{
    if(child&&child.exitCode===null){
      const exit=once(child,'exit');
      child.kill('SIGTERM');
      await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,3000))]);
      if(child.exitCode===null)child.kill('SIGKILL');
    }
    await fs.rm(directory,{recursive:true,force:true});
  }
});
