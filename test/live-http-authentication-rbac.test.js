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
    const port=await freePort(),base='http://127.0.0.1:'+port;
    child=spawn(process.execPath,['src/server.js'],{
      cwd,env:{...process.env,DATA_DIR:dataDir,LOG_DIR:logDir,
        HOST:'127.0.0.1',PORT:String(port),PFC_AUTH_REQUIRED:'1',
        PFC_AUTH_ALLOW_HTTP:'1',PFC_PUBLIC_ORIGIN:base},
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
        cookie:identity.cookie,...(origin?{origin:base}:{}),
        ...(csrf?{'x-pfc-csrf':identity.csrf}:{}),
        ...(body?{'content-type':'application/json'}:{})
      },...(body?{body:JSON.stringify(body)}:{})
    });
    assert.equal((await call('GET','/api/queue',viewer)).status,200);
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
    assert.equal((await call('GET','/api/undocumented',admin)).status,404);
    assert.equal((await call('POST','/api/batch',admin,{csrf:false})).status,403);
    assert.equal((await call('POST','/api/batch',admin,{origin:false})).status,403);
    assert.equal((await call('POST','/api/auth/logout',viewer)).status,200);
    assert.equal((await call('GET','/api/queue',viewer)).status,401);
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
