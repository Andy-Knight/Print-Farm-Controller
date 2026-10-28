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
    assert.equal(tls.status().port,4243);
    assert.equal(tls.status().httpPort,4242);
    assert.equal(tls.status().httpsPort,4243);
    const prepared=await tls.prepareConfiguration({mode:'self-signed',names:'controller.home,127.0.0.1'});
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
    const keyStat=await fs.stat(keyPath);
    assert.equal(keyStat.isFile(),true);
    assert.match(await fs.readFile(keyPath,'utf8'),/-----BEGIN PRIVATE KEY-----/);
    // Node's Windows fs.stat().mode is not an NTFS ACL representation:
    // fs.writeFile({mode:0o600}) can still stat as 0o666 on Windows.
    // Assert POSIX owner-only permissions where the mode bits are meaningful.
    // NTFS ACL restrictions require separate Windows-specific validation.
    if (process.platform !== 'win32')
      assert.equal(keyStat.mode & 0o777,0o600);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('Apply connection settings leaves an unchanged managed certificate and its fingerprint intact',async()=>{
  const dataDir=await tempDir();
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    const settings={mode:'self-signed',names:'localhost,127.0.0.1'};
    await tls.applyConfiguration(await tls.prepareConfiguration(settings),async()=>{});
    const first=tls.status().certificate.fingerprint256;
    assert.equal(tls.configurationMatches(settings),true);
    assert.equal(tls.configurationMatches({...settings,names:'127.0.0.1,localhost'}),false,
      'reordering hostnames is a real change to the saved configuration');
    assert.throws(()=>tls.configurationMatches({...settings,port:4443}),/fixed/);
    assert.equal(tls.configurationMatches({...settings,names:'example.internal'}),false);
    assert.equal(tls.status().certificate.fingerprint256,first);
    assert.equal((await fs.readdir(path.join(dataDir,'tls','identities'))).length,1);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('migration ignores obsolete saved listener port without rotating the current identity',async()=>{
  const dataDir=await tempDir();
  try{
    const original=new ControllerTls({dataDir});
    await original.init();
    await original.applyConfiguration(
      await original.prepareConfiguration({mode:'self-signed',names:'localhost'}),async()=>{}
    );
    const settingsPath=path.join(dataDir,'tls','settings.json');
    const saved=JSON.parse(await fs.readFile(settingsPath,'utf8'));
    await fs.writeFile(settingsPath,JSON.stringify({...saved,port:4242}));
    const migrated=new ControllerTls({dataDir});
    await migrated.init();
    assert.equal(migrated.status().port,4243);
    assert.equal(migrated.status().certificate.fingerprint256,
      original.status().certificate.fingerprint256);
    assert.throws(()=>migrated.configurationMatches({...saved,port:5555}),/fixed/);
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

test('pasted external PEM pair persists without storing private key in settings or returning it in status',async()=>{
  const dataDir=await tempDir();
  const pair=createSelfSignedCertificate({names:['controller.example.test','127.0.0.1']});
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    const input={mode:'provided',certificatePem:pair.cert,privateKeyPem:pair.key};
    const change=await tls.prepareConfiguration(input);
    await tls.applyConfiguration(change,async()=>{});
    assert.equal(tls.status().canRegenerate,false);
    assert.equal(tls.status().certificateSource,'pasted-pem');
    assert.equal(tls.configurationMatches({mode:'provided'}),true);
    assert.equal(tls.configurationMatches(input),false,'pasted PEM triggers explicit reimport');
    assert.equal(tls.publicCertificate(),pair.cert);
    assert.equal(tls.hostMatchesCertificate('controller.example.test'),true);
    assert.equal(tls.hostMatchesCertificate('different.host.test'),false);
    const dir=path.join(dataDir,'tls');
    const saved=await fs.readFile(path.join(dir,'settings.json'),'utf8');
    assert.doesNotMatch(saved,/BEGIN|PRIVATE KEY|certFile|keyFile/);
    assert.doesNotMatch(JSON.stringify(tls.status()),/BEGIN PRIVATE KEY|certFile|keyFile/);
    const pointer=JSON.parse(await fs.readFile(path.join(dir,'current.json'),'utf8'));
    const keyFile=path.join(dir,'identities',pointer.id,'key.pem');
    assert.equal(await fs.readFile(keyFile,'utf8'),pair.key);
    if(process.platform!=='win32')assert.equal((await fs.stat(keyFile)).mode&0o777,0o600);
    const restart=new ControllerTls({dataDir});
    assert.equal((await restart.init()).cert,pair.cert);
    assert.equal(restart.status().certificateSource,'pasted-pem');
    await assert.rejects(()=>tls.regenerate({setSecureContext(){}}),/Only controller-managed/);
    await assert.rejects(()=>tls.prepareConfiguration({mode:'provided',
      certificatePem:pair.cert,privateKeyPem:'-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----'}),
      /error|invalid|decode|ASN|PEM|header|key|certificate/i);
    assert.equal(tls.publicCertificate(),pair.cert);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('provided PEM validation rejects incomplete, oversized and missing pairs',async()=>{
  const dataDir=await tempDir();
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    for(const input of [
      {mode:'provided'},
      {mode:'provided',certificatePem:'-----BEGIN CERTIFICATE-----'},
      {mode:'provided',privateKeyPem:'-----BEGIN PRIVATE KEY-----'},
      {mode:'provided',certificatePem:'x'.repeat(131073),privateKeyPem:'key'}
    ])await assert.rejects(()=>tls.prepareConfiguration(input),/Paste|large/);
    assert.equal(tls.status().mode,'off');
    assert.equal(tls.configurationMatches({mode:'off'}),true);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('legacy file-path configuration still loads but is not exposed or accepted through GUI',async()=>{
  const dataDir=await tempDir();
  const pair=createSelfSignedCertificate({names:['localhost']});
  const certFile=path.join(dataDir,'legacy-cert.pem'),keyFile=path.join(dataDir,'legacy-key.pem');
  try{
    await fs.mkdir(path.join(dataDir,'tls'),{recursive:true});
    await fs.writeFile(certFile,pair.cert);
    await fs.writeFile(keyFile,pair.key);
    await fs.writeFile(path.join(dataDir,'tls','settings.json'),
      JSON.stringify({version:1,mode:'provided',names:['localhost'],certFile,keyFile}));
    const tls=new ControllerTls({dataDir});
    assert.equal((await tls.init()).cert,pair.cert);
    assert.equal(tls.status().certificateSource,'legacy-mounted-files');
    assert.equal('certFile' in tls.status(),false);
    assert.equal(tls.configurationMatches({mode:'provided',certFile,keyFile}),false);
  }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('GUI can return to HTTP, with persistent mode restored at next startup',async()=>{
  const dataDir=await tempDir();
  try{
    const tls=new ControllerTls({dataDir});
    await tls.init();
    await tls.applyConfiguration(await tls.prepareConfiguration({mode:'self-signed',names:'localhost'}),async()=>{});
    const sequence=[];
    await tls.applyConfiguration(await tls.prepareConfiguration({mode:'off'}),
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
