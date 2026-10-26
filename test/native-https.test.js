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

test('managed certificate has a verified key, server EKU and explicit DNS / IP SANs',()=>{
  const pair=createSelfSignedCertificate({names:['localhost','127.0.0.1','printer.example.internal']});
  const cert=new X509Certificate(pair.cert);
  assert.equal(cert.checkPrivateKey(createPrivateKey(pair.key)),true);
  assert.equal(cert.verify(cert.publicKey),true);
  assert.equal(cert.ca,false);
  assert.equal(cert.checkHost('printer.example.internal'),'printer.example.internal');
  assert.equal(cert.checkIP('127.0.0.1'),'127.0.0.1');
  assert.ok(cert.subjectAltName.includes('DNS:localhost'));
  assert.ok(cert.subjectAltName.includes('IP Address:127.0.0.1'));
  assert.ok(cert.keyUsage?.includes('1.3.6.1.5.5.7.3.1'));
  assert.ok(Date.parse(cert.validTo)>Date.now());
  assert.ok(Date.parse(cert.validFrom)<=Date.now());
  assert.notEqual(createSelfSignedCertificate({names:['localhost']}).cert,pair.cert);
});

test('certificate SAN validation rejects ambiguous, wildcard or unconfigured names',()=>{
  assert.deepEqual(normalizeCertificateNames('LOCALHOST,127.0.0.1,localhost'),['localhost','127.0.0.1']);
  for(const input of ['','*.example.internal','https://localhost','bad/name','bad name','-invalid.local'])
    assert.throws(()=>normalizeCertificateNames(input),/Invalid|At least/);
});

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(),'pfc-tls-test-'));
}

test('managed identity survives restart and regenerates a new key and fingerprint',async()=>{
  const dataDir=await tempDir();
  const env={PFC_HTTPS_MODE:'self-signed',PFC_HTTPS_NAMES:'localhost,127.0.0.1'};
  let server;
  try{
    const manager=new ControllerTls({dataDir,env,port:4242});
    const first=await manager.init();
    const firstFingerprint=manager.status().certificate.fingerprint256;
    const second=new ControllerTls({dataDir,env,port:4242});
    assert.deepEqual(await second.init(),first,'no unexpected rotation on restart');
    server=https.createServer(first,(_req,res)=>res.end('healthy'));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const before=await peerCertificate(server.address().port);
    assert.equal(before.fingerprint256,firstFingerprint);
    const rotated=await manager.regenerate(server);
    assert.notEqual(rotated.certificate.fingerprint256,firstFingerprint);
    const after=await peerCertificate(server.address().port);
    assert.equal(after.fingerprint256,rotated.certificate.fingerprint256);
    assert.deepEqual((await new ControllerTls({dataDir,env}).init()).cert,manager.publicCertificate());
    assert.equal((await fs.stat(path.join(dataDir,'tls','current.json'))).isFile(),true);
    assert.equal((await fs.readdir(path.join(dataDir,'tls','identities'))).length,1);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});

async function peerCertificate(port) {
  return new Promise((resolve,reject)=>{
    const req=https.get({host:'127.0.0.1',port,path:'/',rejectUnauthorized:false,agent:false},
      res=>{
        const certificate=res.socket.getPeerCertificate();
        res.resume();
        res.once('end',()=>resolve(certificate));
      });
    req.once('error',reject);
  });
}

test('invalid stored identity fails closed rather than silently generating a new certificate',async()=>{
  const dataDir=await tempDir();
  const env={PFC_HTTPS_MODE:'self-signed'};
  try{
    const manager=new ControllerTls({dataDir,env});
    await manager.init();
    const current=JSON.parse(await fs.readFile(path.join(dataDir,'tls','current.json'),'utf8'));
    await fs.writeFile(path.join(dataDir,'tls','identities',current.id,'key.pem'),'broken');
    await assert.rejects(()=>new ControllerTls({dataDir,env}).init());
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('provided certificate is never rotated by controller-managed action',async()=>{
  const dataDir=await tempDir();
  const pair=createSelfSignedCertificate({names:['localhost']});
  const certFile=path.join(dataDir,'external.crt');
  const keyFile=path.join(dataDir,'external.key');
  try{
    await fs.writeFile(certFile,pair.cert);
    await fs.writeFile(keyFile,pair.key);
    const manager=new ControllerTls({dataDir,env:{PFC_HTTPS_MODE:'provided',PFC_HTTPS_CERT_FILE:certFile,PFC_HTTPS_KEY_FILE:keyFile}});
    assert.ok((await manager.init()).cert.includes('CERTIFICATE'));
    assert.equal(manager.status().canRegenerate,false);
    await assert.rejects(()=>manager.regenerate({setSecureContext(){}}),/Only controller-managed/);
    assert.equal(await fs.readFile(keyFile,'utf8'),pair.key);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('all certificate endpoints fail closed to non-administrators',()=>{
  for(const [method,uri] of [
    ['GET','/api/tls/status'],
    ['GET','/api/tls/certificate'],
    ['POST','/api/tls/regenerate']
  ]){
    assert.equal(requiredPermission(method,uri),PERMISSIONS.USER_MANAGE);
    assert.equal(isRoleAllowed('administrator',method,uri),true);
    for(const role of [null,'viewer','operator'])
      assert.equal(isRoleAllowed(role,method,uri),false);
    assert.equal(requiredPermission('DELETE',uri),null);
  }
});
