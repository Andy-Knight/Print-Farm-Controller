import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {createSelfSignedCertificate,normalizeCertificateNames} from '../src/security/self-signed-certificate.js';
import {ControllerTls} from '../src/security/controller-tls.js';
import {requiredPermission,isRoleAllowed,PERMISSIONS} from '../src/security/authorization-policy.js';

const tempDir=()=>fs.mkdtemp(path.join(os.tmpdir(),'pfc-tls-gui-'));
const request=(port)=>new Promise((resolve,reject)=>{
  const req=https.get({host:'127.0.0.1',port,path:'/',rejectUnauthorized:false,agent:false},res=>{
    const cert=res.socket.getPeerCertificate();
    res.resume();res.once('end',()=>resolve(cert));
  });
  req.once('error',reject);
});

test('issued identities have valid key, server-only EKU, DNS names and real IP SANs',()=>{
  const pair=createSelfSignedCertificate({names:['localhost','127.0.0.1','controller.home']});
  const cert=new X509Certificate(pair.cert);
  assert.equal(cert.checkPrivateKey(createPrivateKey(pair.key)),true);
  assert.equal(cert.verify(cert.publicKey),true);
  assert.equal(cert.ca,false);
  assert.equal(cert.checkHost('controller.home'),'controller.home');
  assert.equal(cert.checkIP('127.0.0.1'),'127.0.0.1');
  assert.match(cert.subjectAltName,/DNS:localhost/);
  assert.match(cert.subjectAltName,/IP Address:127.0.0.1/);
  assert.ok(cert.keyUsage?.includes('1.3.6.1.5.5.7.3.1'));
  assert.ok(Date.parse(cert.validTo)>Date.now());
  assert.notEqual(createSelfSignedCertificate({names:['localhost']}).cert,pair.cert);
});

test('invalid, wildcard or ambiguous SAN input is rejected',()=>{
  assert.deepEqual(normalizeCertificateNames('LOCALHOST,127.0.0.1,localhost'),['localhost','127.0.0.1']);
  for(const input of ['','*.home','https://host','bad/name','bad name','-invalid.home'])
    assert.throws(()=>normalizeCertificateNames(input),/Invalid|At least/);
});

test('new installations start HTTP; GUI selection persists managed TLS across restarts',async()=>{
  const dataDir=await tempDir();
  try{
    const tls=new ControllerTls({dataDir,port:4242,env:{PFC_HTTPS_MODE:'self-signed'}});
    assert.equal(await tls.init(),null,'environment variables do not enable HTTPS');
    assert.equal(tls.status().mode,'off');
    assert.equal(tls.status().port,4242);
    const prepared=await tls.prepareConfiguration({mode:'self-signed',names:'controller.home,127.0.0.1',port:4242});
    assert.equal(prepared.settings.mode,'self-signed');
    assert.ok(prepared.candidate.cert.includes('CERTIFICATE'));
    const switched=[];
    await tls.applyConfiguration(prepared,async next=>switched.push(next));
    assert.equal(switched.length,1);
    assert.equal(switched[0].secure,true);
    assert.equal(tls.mode,'self-signed');
    const fingerprint=tls.status().certificate.fingerprint256;
    const persisted=new ControllerTls({dataDir});
    assert.equal((await persisted.init()).cert,tls.publicCertificate());
    assert.equal(persisted.status().certificate.fingerprint256,fingerprint);
    const pointer=JSON.parse(await fs.readFile(path.join(dataDir,'tls','current.json'),'utf8'));
    const keyPath=path.join(dataDir,'tls','identities',pointer.id,'key.pem');
    assert.equal((await fs.stat(keyPath)).mode & 0o777,0o600);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('changing certificate hostnames rotates identity, and failure keeps original identity',async()=>{
  const dataDir=await tempDir();
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    await tls.applyConfiguration(
      await tls.prepareConfiguration({mode:'self-signed',names:'localhost,127.0.0.1'}),
      async()=>{}
    );
    const original=tls.status().certificate.fingerprint256;
    const failing=await tls.prepareConfiguration({mode:'self-signed',names:'new.home'});
    await assert.rejects(()=>tls.applyConfiguration(failing,async()=>{throw new Error('simulated bind error');}),
      /simulated bind error/);
    assert.equal(tls.status().certificate.fingerprint256,original);
    assert.equal((await new ControllerTls({dataDir}).init()).cert,tls.publicCertificate());
    const success=await tls.prepareConfiguration({mode:'self-signed',names:'new.home'});
    await tls.applyConfiguration(success,async()=>{});
    assert.notEqual(tls.status().certificate.fingerprint256,original);
    assert.equal(tls.status().certificate.subjectAltName,'DNS:new.home');
    assert.equal((await fs.readdir(path.join(dataDir,'tls','identities'))).length,1);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('regeneration hot-reloads the real HTTPS server and preserves the new identity',async()=>{
  const dataDir=await tempDir();
  let server=null;
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    await tls.applyConfiguration(
      await tls.prepareConfiguration({mode:'self-signed',names:'127.0.0.1,localhost'}),
      async()=>{}
    );
    server=https.createServer(tls.options,(_req,res)=>res.end('ok'));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const first=await request(server.address().port);
    const newStatus=await tls.regenerate(server);
    const second=await request(server.address().port);
    assert.equal(second.fingerprint256,newStatus.certificate.fingerprint256);
    assert.notEqual(first.fingerprint256,second.fingerprint256);
    const persisted=new ControllerTls({dataDir});
    assert.equal((await persisted.init()).cert,tls.publicCertificate());
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});

test('existing damaged TLS identity fails closed instead of returning to anonymous HTTP',async()=>{
  const dataDir=await tempDir();
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    await tls.applyConfiguration(
      await tls.prepareConfiguration({mode:'self-signed',names:'localhost'}),
      async()=>{}
    );
    const pointer=JSON.parse(await fs.readFile(path.join(dataDir,'tls','current.json'),'utf8'));
    await fs.writeFile(path.join(dataDir,'tls','identities',pointer.id,'key.pem'),'broken');
    await assert.rejects(()=>new ControllerTls({dataDir}).init());
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('provided certificates are selected through controller file paths, never overwritten',async()=>{
  const dataDir=await tempDir();
  const pair=createSelfSignedCertificate({names:['localhost']});
  const certFile=path.join(dataDir,'external.crt'),keyFile=path.join(dataDir,'external.key');
  try{
    await fs.writeFile(certFile,pair.cert);await fs.writeFile(keyFile,pair.key);
    const tls=new ControllerTls({dataDir});
    assert.equal(await tls.init(),null);
    const choice=await tls.prepareConfiguration({mode:'provided',certFile,keyFile,port:4242});
    await tls.applyConfiguration(choice,async()=>{});
    assert.equal(tls.status().canRegenerate,false);
    assert.equal(tls.status().certFile,certFile);
    await assert.rejects(()=>tls.regenerate({setSecureContext(){}}),/Only controller-managed/);
    assert.equal(await fs.readFile(keyFile,'utf8'),pair.key);
    assert.equal((await new ControllerTls({dataDir}).init()).cert,pair.cert);
    await assert.rejects(()=>tls.prepareConfiguration({mode:'provided',certFile,keyFile:'/missing/private.key'}),
      /ENOENT/);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('GUI can return to HTTP, with persistent mode restored at next startup',async()=>{
  const dataDir=await tempDir();
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    await tls.applyConfiguration(await tls.prepareConfiguration({mode:'self-signed',names:'localhost'}),async()=>{});
    const sequence=[];
    await tls.applyConfiguration(await tls.prepareConfiguration({mode:'off',port:4242}),
      async({secure})=>sequence.push(secure));
    assert.deepEqual(sequence,[false]);
    assert.equal(tls.status().mode,'off');
    assert.equal(await new ControllerTls({dataDir}).init(),null);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('TLS setup and rotation APIs are server-enforced administrator-only routes',()=>{
  for(const [method,uri] of [
    ['GET','/api/tls/status'],['GET','/api/tls/certificate'],
    ['POST','/api/tls/configure'],['POST','/api/tls/regenerate']
  ]){
    assert.equal(requiredPermission(method,uri),PERMISSIONS.USER_MANAGE);
    assert.equal(isRoleAllowed('administrator',method,uri),true);
    for(const role of [null,'viewer','operator'])
      assert.equal(isRoleAllowed(role,method,uri),false);
    assert.equal(requiredPermission('DELETE',uri),null);
  }
});
