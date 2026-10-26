import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {AccountStore} from '../src/security/account-store.js';

const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const password='GUI HTTPS transition integration 2026!';
async function freePort(){
  const s=net.createServer();
  s.listen(0,'127.0.0.1');await once(s,'listening');
  const port=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return port;
}
async function stop(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const ended=once(child,'exit');
  child.kill('SIGTERM');
  await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,2500))]);
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
}
function secureRequest(base,url,{method='GET',body,identity,origin,csrf=true}={}){
  return new Promise((resolve,reject)=>{
    const target=new URL(url,base);
    const agent=target.protocol==='https:'?https:http;
    const headers={};
    if(body)headers['content-type']='application/json';
    if(origin)headers.origin=origin;
    if(identity){
      headers.cookie=identity.cookie;
      if(csrf)headers['x-pfc-csrf']=identity.csrf;
    }
    const req=agent.request(target,{
      method,headers,agent:false,...(target.protocol==='https:'?{rejectUnauthorized:false}:{})
    },res=>{
      const data=[];
      res.on('data',chunk=>data.push(chunk));
      res.once('end',()=>{
        const text=Buffer.concat(data).toString('utf8');
        let result=null;try{result=JSON.parse(text);}catch{}
        resolve({status:res.statusCode,headers:res.headers,body:result,text});
      });
    });
    req.setTimeout(3000,()=>req.destroy(new Error('request timeout')));
    req.once('error',reject);
    req.end(body?JSON.stringify(body):undefined);
  });
}
async function pollHealthy(base,child){
  for(let i=0;i<100;i++){
    if(child.exitCode!==null||child.signalCode!==null)
      throw Error('Controller process exited');
    try{
      const result=await secureRequest(base,'/api/health');
      if(result.status===200)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('Controller did not become ready at '+base);
}
function startController({dataDir,logDir,port,logs}){
  const child=spawn(process.execPath,['src/server.js'],{
    cwd,env:{...process.env,DATA_DIR:dataDir,LOG_DIR:logDir,
      HOST:'127.0.0.1',PORT:String(port),PFC_AUTH_REQUIRED:'1',
      PFC_PUBLIC_ORIGIN:''},stdio:['ignore','pipe','pipe']
  });
  for(const source of [child.stdout,child.stderr])
    source.on('data',chunk=>logs.push(chunk.toString()));
  return child;
}
async function login(base){
  const response=await secureRequest(base,'/api/auth/login',{
    method:'POST',origin:base,
    body:{username:'guiadmin',password}
  });
  assert.equal(response.status,200,'login: '+response.text);
  return {cookie:response.headers['set-cookie'][0].split(';')[0],csrf:response.body.csrf};
}

test('real controller starts HTTP, switches to GUI-managed HTTPS and retains it after restart',
  {timeout:85000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-live-gui-https-'));
  const dataDir=path.join(directory,'data'),logDir=path.join(directory,'logs');
  const logs=[];
  let child=null;
  try{
    await new AccountStore({dataDir}).bootstrapAdministrator({username:'guiadmin',password});
    const port=await freePort();
    const plain='http://127.0.0.1:'+port;
    const secure='https://127.0.0.1:'+port;
    child=startController({dataDir,logDir,port,logs});
    await pollHealthy(plain,child);
    assert.equal((await secureRequest(plain,'/api/auth/session')).body.transportSecure,false);
    const admin=await login(plain);
    assert.equal((await secureRequest(plain,'/api/tls/status',{identity:admin})).body.tls.mode,'off');
    const settings={mode:'self-signed',names:'127.0.0.1,localhost',port,password,confirm:'APPLY'};
    assert.equal((await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,csrf:false,body:settings
    })).status,403,'Origin and CSRF must protect native HTTPS setup');
    assert.equal((await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,body:{...settings,password:'wrong'}
    })).status,403,'admin password required for HTTPS setup');
    const accepted=await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,body:settings
    });
    assert.equal(accepted.status,202,accepted.text);
    assert.equal(accepted.body.mode,'self-signed');
    await pollHealthy(secure,child);
    const session=await secureRequest(secure,'/api/auth/session',{identity:admin});
    assert.equal(session.body.transportSecure,true);
    assert.equal(session.body.user,null,'HTTP-era sessions revoked on HTTPS transition');
    const secureAdmin=await login(secure);
    const loginResponse=await secureRequest(secure,'/api/auth/login',{
      method:'POST',origin:secure,body:{username:'guiadmin',password}
    });
    assert.match(loginResponse.headers['set-cookie'][0],/; Secure/);
    const status=await secureRequest(secure,'/api/tls/status',{identity:secureAdmin});
    assert.equal(status.status,200);
    assert.equal(status.body.tls.mode,'self-signed');
    assert.match(status.body.tls.certificate.subjectAltName,/IP Address:127\.0\.0\.1/);
    assert.doesNotMatch(JSON.stringify(status.body),/BEGIN PRIVATE KEY/);
    const certificate=await secureRequest(secure,'/api/tls/certificate',{identity:secureAdmin});
    assert.match(certificate.text,/BEGIN CERTIFICATE/);
    const oldFingerprint=status.body.tls.certificate.fingerprint256;
    const regenerated=await secureRequest(secure,'/api/tls/regenerate',{
      method:'POST',identity:secureAdmin,origin:secure,
      body:{password,confirm:'REGENERATE'}
    });
    assert.equal(regenerated.status,200,regenerated.text);
    assert.notEqual(regenerated.body.tls.certificate.fingerprint256,oldFingerprint);
    await stop(child);
    child=startController({dataDir,logDir,port,logs});
    await pollHealthy(secure,child);
    assert.equal((await secureRequest(secure,'/api/auth/session')).body.transportSecure,true);
    // A failed plain HTTP connection is not a bypass around TLS/RBAC.
    await assert.rejects(()=>secureRequest(plain,'/api/auth/session'));
    const adminRestart=await login(secure);
    const persisted=await secureRequest(secure,'/api/tls/status',{identity:adminRestart});
    assert.equal(persisted.body.tls.certificate.fingerprint256,
      regenerated.body.tls.certificate.fingerprint256);
  }finally{
    await stop(child);
    await fs.rm(directory,{recursive:true,force:true});
  }
});
