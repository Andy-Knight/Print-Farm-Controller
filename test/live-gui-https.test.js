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
import {createSelfSignedCertificate} from '../src/security/self-signed-certificate.js';

const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const password='GUI HTTPS transition integration 2026!';
async function freePort(){
  // Test-only HTTP PORT uses its immediately succeeding HTTPS port. Ensure
  // both are free before exercising the two production listener roles.
  for(let attempt=0;attempt<30;attempt++){
    const first=net.createServer();
    first.listen(0,'127.0.0.1');await once(first,'listening');
    const port=first.address().port;
    if(port>=65535){await new Promise(resolve=>first.close(resolve));continue;}
    const second=net.createServer();
    try{
      await new Promise((resolve,reject)=>{
        second.once('error',reject);
        second.listen(port+1,'127.0.0.1',resolve);
      });
      await new Promise(resolve=>second.close(resolve));
      await new Promise(resolve=>first.close(resolve));
      return port;
    }catch{
      if(second.listening)await new Promise(resolve=>second.close(resolve));
      await new Promise(resolve=>first.close(resolve));
    }
  }
  throw Error('Unable to reserve an adjacent HTTP/HTTPS port pair');
}
async function stop(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const ended=once(child,'exit');
  child.kill('SIGTERM');
  await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,2500))]);
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
}
function secureRequest(base,url,{method='GET',body,identity,origin,csrf=true,hostHeader}={}){
  return new Promise((resolve,reject)=>{
    const target=new URL(url,base);
    const agent=target.protocol==='https:'?https:http;
    const headers={};
    if(body)headers['content-type']='application/json';
    if(origin)headers.origin=origin;
    if(hostHeader)headers.host=hostHeader;
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
async function pollHealthy(base,child,logs=[]){
  for(let i=0;i<100;i++){
    if(child.exitCode!==null||child.signalCode!==null)
      throw Error('Controller process exited: '+logs.join('').slice(-2000));
    try{
      const result=await secureRequest(base,'/api/health');
      if(result.status===200)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('Controller did not become ready at '+base+': '+logs.join('').slice(-2000));
}
function startController({dataDir,logDir,port,logs,secureDefault=false}){
  const child=spawn(process.execPath,['src/server.js'],{
    cwd,env:{...process.env,DATA_DIR:dataDir,LOG_DIR:logDir,
      HOST:'127.0.0.1',PORT:String(port),PFC_AUTH_REQUIRED:'1',
      PFC_PUBLIC_ORIGIN:'',PFC_AUTH_ALLOW_HTTP:secureDefault?'0':'1',PFC_TLS_NAMES:'localhost,127.0.0.1'},stdio:['ignore','pipe','pipe']
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

/**
 * The HTTPS listener becomes reachable *before* the durable TLS settings
 * write finishes. A healthy HTTPS socket is not proof that the requested
 * mode has committed yet (especially on Windows). Wait for the configured
 * mode and busy=false rather than inspecting an intermediate "off" status.
 *
 * Reauthenticate during the transition because swapping HTTPS listeners
 * intentionally revokes sessions, including a login made during the swap.
 */
async function waitForCommittedTlsMode(base,expectedMode,child,logs){
  let lastStatus=null,lastError=null;
  for(let attempt=0;attempt<100;attempt++){
    if(child.exitCode!==null||child.signalCode!==null)
      throw Error('Controller exited during HTTPS change: '+logs.join('').slice(-2000));
    try{
      const identity=await login(base);
      const status=await secureRequest(base,'/api/tls/status',{identity});
      lastStatus=status;
      if(status.status===200&&status.body?.tls?.lastError)
        throw Error('Controller HTTPS change failed: '+status.body.tls.lastError);
      if(status.status===200&&status.body?.tls?.mode===expectedMode
          &&status.body.tls.busy===false&&status.body.tls.certificate)
        return {identity,status};
    }catch(error){
      if(/Controller HTTPS change failed:/.test(error.message))throw error;
      lastError=error;
    }
    await new Promise(resolve=>setTimeout(resolve,120));
  }
  throw Error('Timed out waiting for committed HTTPS mode '+expectedMode+
    '. Last status: '+JSON.stringify(lastStatus?.body?.tls||lastStatus||null)+
    '; last error: '+(lastError?.message||'none')+
    '; controller logs: '+logs.join('').slice(-1600));
}

test('real controller starts HTTP, switches to GUI-managed HTTPS and retains it after restart',
  {timeout:85000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-live-gui-https-'));
  const dataDir=path.join(directory,'data'),logDir=path.join(directory,'logs');
  const logs=[];
  let child=null,blocker=null;
  try{
    await new AccountStore({dataDir}).bootstrapAdministrator({username:'guiadmin',password});
    const port=await freePort();
    const plain='http://127.0.0.1:'+port;
    const secure='https://127.0.0.1:'+(port+1);
    child=startController({dataDir,logDir,port,logs});
    await pollHealthy(plain,child,logs);
    assert.equal((await secureRequest(plain,'/api/auth/session')).body.transportSecure,false);
    const admin=await login(plain);
    assert.equal((await secureRequest(plain,'/api/tls/status',{identity:admin})).body.tls.mode,'off');
    const settings={mode:'self-signed',names:'127.0.0.1,localhost',password,confirm:'APPLY'};
    assert.equal((await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,
      body:{mode:'provided',certificatePem:'test-cert',privateKeyPem:'test-key',password,confirm:'APPLY'}
    })).status,403,'private key imports are disallowed before enabling HTTPS');
    assert.equal((await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,csrf:false,body:settings
    })).status,403,'Origin and CSRF must protect native HTTPS setup');
    assert.equal((await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,body:{...settings,password:'wrong'}
    })).status,403,'admin password required for HTTPS setup');
    const attemptedOverride=await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,
      body:{...settings,port:port+12}
    });
    assert.equal(attemptedOverride.status,400,
      'clients must not override immutable HTTPS ports even with admin credentials');
    // An occupied HTTPS port must never take down the already listening
    // HTTP endpoint or persist a broken certificate.
    blocker=net.createServer();
    await new Promise(resolve=>blocker.listen(port+1,'127.0.0.1',resolve));
    const occupied=await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,body:settings
    });
    assert.equal(occupied.status,202);
    let recovered=null;
    for(let attempt=0;attempt<80;attempt++){
      try{
        const probe=await secureRequest(plain,'/api/tls/status',{identity:admin});
        if(probe.body?.tls?.lastError){recovered=probe.body.tls;break;}
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    assert.ok(recovered?.lastError,'occupied immutable HTTPS port must be reported');
    assert.equal(recovered.mode,'off','failed HTTPS bind must leave HTTP enabled');
    assert.equal((await secureRequest(plain,'/healthz')).status,200);
    assert.equal((await secureRequest(plain,'/api/auth/session')).status,200);
    await new Promise(resolve=>blocker.close(resolve));blocker=null;
    for(const missing of [undefined,null,'']){
      const bypass=await secureRequest(plain,'/api/tls/configure',{
        method:'POST',origin:plain,identity:admin,body:{...settings,password:missing}
      });
      assert.equal(bypass.status,403,'HTTPS setup must demand current password even when omitted');
    }
    const accepted=await secureRequest(plain,'/api/tls/configure',{
      method:'POST',origin:plain,identity:admin,body:settings
    });
    assert.equal(accepted.status,202,accepted.text);
    assert.equal(accepted.body.mode,'self-signed');
    await pollHealthy(secure,child,logs);
    const {identity:secureAdmin,status}=await waitForCommittedTlsMode(
      secure,'self-signed',child,logs);
    assert.equal((await secureRequest(plain,'/healthz')).status,200,
      'Docker and K3s health checks use the permanent HTTP port');
    const redirect=await secureRequest(plain,'/printer-details?test=one');
    assert.equal(redirect.status,302);
    assert.equal(redirect.headers.location,secure+'/printer-details?test=one');
    const metalLbRedirect=await secureRequest(plain,'/library?view=table',{
      hostHeader:'127.0.0.1'
    });
    assert.equal(metalLbRedirect.status,302);
    assert.equal(metalLbRedirect.headers.location,'https://127.0.0.1/library?view=table',
      'browser on external port 80 must redirect to standard HTTPS port 443');
    assert.equal((await secureRequest(plain,'/',{hostHeader:'example.attacker.test'})).status,421,
      'an untrusted Host cannot cause an open redirect');
    assert.equal((await secureRequest(plain,'/healthz',{hostHeader:'example.attacker.test'})).status,200,
      'minimal health check is independent of browser host and TLS trust');
    assert.equal((await secureRequest(plain,'/api/health')).status,302,
      'HTTP API GET requests are never served in cleartext');
    assert.equal((await secureRequest(plain,'/api/auth/login',{
      method:'POST',origin:plain,body:{username:'guiadmin',password}
    })).status,403,'HTTP credentials must never be accepted after HTTPS activation');
    const session=await secureRequest(secure,'/api/auth/session',{identity:admin});
    assert.equal(session.body.transportSecure,true);
    assert.equal(session.body.user,null,'HTTP-era sessions revoked on HTTPS transition');
    const loginResponse=await secureRequest(secure,'/api/auth/login',{
      method:'POST',origin:secure,body:{username:'guiadmin',password}
    });
    assert.match(loginResponse.headers['set-cookie'][0],/; Secure/);
    assert.equal(status.status,200);
    assert.equal(status.body.tls.mode,'self-signed');
    assert.match(status.body.tls.certificate.subjectAltName,/IP Address:127\.0\.0\.1/);
    assert.doesNotMatch(JSON.stringify(status.body),/BEGIN PRIVATE KEY/);
    const certificate=await secureRequest(secure,'/api/tls/certificate',{identity:secureAdmin});
    assert.match(certificate.text,/BEGIN CERTIFICATE/);
    const oldFingerprint=status.body.tls.certificate.fingerprint256;
    const unchanged=await secureRequest(secure,'/api/tls/configure',{
      method:'POST',identity:secureAdmin,origin:secure,body:settings
    });
    assert.equal(unchanged.status,200,unchanged.text);
    assert.equal(unchanged.body.unchanged,true,'reapplying saved settings is a no-op');
    const unchangedStatus=await secureRequest(secure,'/api/tls/status',{identity:secureAdmin});
    assert.equal(unchangedStatus.body.tls.certificate.fingerprint256,oldFingerprint);
    assert.equal((await secureRequest(secure,'/api/auth/session',{identity:secureAdmin}))
      .body.user.username,'guiadmin','no-op must not revoke the active session');
    for(const missing of [undefined,null,'']){
      const response=await secureRequest(secure,'/api/tls/regenerate',{
        method:'POST',identity:secureAdmin,origin:secure,
        body:{password:missing,confirm:'REGENERATE'}
      });
      assert.equal(response.status,403,'regeneration requires administrator reauthentication');
    }
    const regenerated=await secureRequest(secure,'/api/tls/regenerate',{
      method:'POST',identity:secureAdmin,origin:secure,
      body:{password,confirm:'REGENERATE'}
    });
    assert.equal(regenerated.status,200,regenerated.text);
    assert.notEqual(regenerated.body.tls.certificate.fingerprint256,oldFingerprint);
    // Supply a real matching PEM pair over the already-active TLS listener.
    const supplied=createSelfSignedCertificate({names:['127.0.0.1','localhost']});
    const badPair=createSelfSignedCertificate({names:['localhost']});
    const importSettings={mode:'provided',certificatePem:supplied.cert,
      privateKeyPem:supplied.key,password,confirm:'APPLY'};
    assert.equal((await secureRequest(secure,'/api/tls/configure',{
      method:'POST',identity:secureAdmin,origin:secure,
      body:{...importSettings,privateKeyPem:badPair.key}
    })).status,400,'mismatched keys must be rejected before activation');
    const imported=await secureRequest(secure,'/api/tls/configure',{
      method:'POST',identity:secureAdmin,origin:secure,body:importSettings
    });
    assert.equal(imported.status,202,imported.text);
    assert.doesNotMatch(JSON.stringify(imported.body),/BEGIN CERTIFICATE|PRIVATE KEY/);
    // Configuration changes are acknowledged before the TLS context swaps;
    // poll the durable mode instead of assuming a fixed sleep is sufficient.
    const {identity:importedAdmin,status:importedStatus}=await waitForCommittedTlsMode(
      secure,'provided',child,logs);
    assert.equal(importedStatus.body.tls.mode,'provided');
    assert.equal(importedStatus.body.tls.canRegenerate,false);
    assert.equal(importedStatus.body.tls.certificateSource,'pasted-pem');
    const suppliedFingerprint=importedStatus.body.tls.certificate.fingerprint256;
    assert.notEqual(suppliedFingerprint,regenerated.body.tls.certificate.fingerprint256);
    assert.doesNotMatch(JSON.stringify(importedStatus.body),/BEGIN PRIVATE KEY|certFile|keyFile/);
    assert.equal((await secureRequest(secure,'/api/tls/regenerate',{
      method:'POST',identity:importedAdmin,origin:secure,
      body:{password,confirm:'REGENERATE'}
    })).status,409,'self-signed regeneration not permitted for imported identity');
    const kept=await secureRequest(secure,'/api/tls/configure',{
      method:'POST',identity:importedAdmin,origin:secure,
      body:{mode:'provided',password,confirm:'APPLY'}
    });
    assert.equal(kept.status,200,'blank PEM fields preserve the imported identity');
    assert.equal(kept.body.unchanged,true);
    await stop(child);
    child=startController({dataDir,logDir,port,logs});
    await pollHealthy(secure,child,logs);
    assert.equal((await secureRequest(secure,'/api/auth/session')).body.transportSecure,true);
    // Plain HTTP remains bound but only redirects or rejects requests.
    assert.equal((await secureRequest(plain,'/api/auth/session')).status,302);
    assert.equal((await secureRequest(plain,'/healthz')).status,200);
    const adminRestart=await login(secure);
    const persisted=await secureRequest(secure,'/api/tls/status',{identity:adminRestart});
    assert.equal(persisted.body.tls.certificate.fingerprint256,
      suppliedFingerprint);
  }finally{
    if(blocker?.listening)await new Promise(resolve=>blocker.close(resolve));
    await stop(child);
    await fs.rm(directory,{recursive:true,force:true});
  }
});

test('secure default enrolls over HTTPS, rejects plaintext actions and survives malformed requests and restart', {timeout:40000}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-secure-default-'));
  const dataDir=path.join(root,'data'), logDir=path.join(root,'logs');
  const port=await freePort(), plain='http://127.0.0.1:'+port, secure='https://127.0.0.1:'+(port+1);
  const logs=[];
  let child;
  try {
    child=startController({dataDir,logDir,port,logs,secureDefault:true});
    await pollHealthy(secure,child,logs);
    const code=logs.join('').match(/One-time enrollment code \(private\): ([0-9A-F]{48})/)?.[1];
    assert.ok(code);
    assert.equal((await secureRequest(plain,'/api/auth/enroll',{method:'POST',origin:plain,body:{code,username:'guiadmin',password}})).status,403);
    assert.equal((await secureRequest(secure,'/api/auth/session',{hostHeader:'['})).status,400);
    assert.equal((await secureRequest(secure,'/api/health')).status,200);
    assert.equal((await secureRequest(secure,'/api/auth/enroll',{method:'POST',origin:secure,body:{code,username:'guiadmin',password}})).status,201);
    const identity=await login(secure);
    const signedIn=await secureRequest(secure,'/api/auth/login',{method:'POST',origin:secure,body:{username:'guiadmin',password}});
    assert.match(signedIn.headers['set-cookie'][0],/; Secure/);
    assert.equal((await secureRequest(secure,'/api/tls/configure',{method:'POST',origin:secure,identity,body:{mode:'off',password,confirm:'APPLY'}})).status,403);
    const fingerprint=(await secureRequest(secure,'/api/tls/status',{identity})).body.tls.certificate.fingerprint256;
    await stop(child);
    child=startController({dataDir,logDir,port,logs,secureDefault:true});
    await pollHealthy(secure,child,logs);
    const next=await login(secure);
    assert.equal((await secureRequest(secure,'/api/tls/status',{identity:next})).body.tls.certificate.fingerprint256,fingerprint);
  } finally {await stop(child);await fs.rm(root,{recursive:true,force:true});}
});
