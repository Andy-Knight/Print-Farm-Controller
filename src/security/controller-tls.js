/**
 * Controller-owned HTTPS configuration. The installation always begins with
 * plain HTTP when no persistent TLS settings exist. Administrators configure
 * TLS from the GUI; no HTTPS environment variables or external tools needed.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomBytes, X509Certificate, createPrivateKey} from 'node:crypto';
import tls from 'node:tls';
import {createSelfSignedCertificate, normalizeCertificateNames} from './self-signed-certificate.js';

const DEFAULT_NAMES=['localhost','127.0.0.1'];
const MODES=new Set(['off','self-signed','provided']);
function fail(message,statusCode=400){return Object.assign(new Error(message),{statusCode});}
function validatePair(cert,key) {
  const x509=new X509Certificate(cert);
  if(!x509.checkPrivateKey(createPrivateKey(key)))
    throw fail('HTTPS certificate and private key do not match');
  tls.createSecureContext({cert,key,minVersion:'TLSv1.2'});
  const now=Date.now();
  if(Date.parse(x509.validTo)<=now||Date.parse(x509.validFrom)>now)
    throw fail('HTTPS certificate is expired or not yet valid');
  return x509;
}
function settingsFor(input,{httpPort}){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw fail('HTTPS settings must be an object');
  const mode=String(input.mode||'off');
  if(!MODES.has(mode))throw fail('Invalid HTTPS mode');
  const requestedPort=input.port===undefined ? httpPort : Number(input.port);
  const port=mode==='off'?httpPort:requestedPort;
  if(!Number.isInteger(port)||port<1||port>65535)
    throw fail('Port must be an integer between 1 and 65535');
  const names=normalizeCertificateNames(input.names||DEFAULT_NAMES);
  const certFile=String(input.certFile||'').trim();
  const keyFile=String(input.keyFile||'').trim();
  if(mode==='provided'&&(!path.isAbsolute(certFile)||!path.isAbsolute(keyFile)||certFile===keyFile))
    throw fail('Supplied certificate and key require two different absolute file paths on the controller');
  if(certFile.length>2048||keyFile.length>2048)
    throw fail('HTTPS certificate paths are too long');
  return {version:1,mode,port,names,certFile:mode==='provided'?certFile:'',keyFile:mode==='provided'?keyFile:''};
}
function publicStatus(settings,identity,{busy=false,lastError=null}={}) {
  const certificate=identity?new X509Certificate(identity.cert):null;
  return {
    enabled:settings.mode!=='off',mode:settings.mode,port:settings.port,
    names:settings.names,certFile:settings.certFile,keyFile:settings.keyFile,
    canRegenerate:settings.mode==='self-signed',busy,lastError,
    certificate:certificate?{
      subject:certificate.subject,issuer:certificate.issuer,
      subjectAltName:certificate.subjectAltName||'',
      fingerprint256:certificate.fingerprint256,
      serialNumber:certificate.serialNumber,
      validFrom:new Date(certificate.validFrom).toISOString(),
      validTo:new Date(certificate.validTo).toISOString(),
      daysRemaining:Math.floor((Date.parse(certificate.validTo)-Date.now())/86400000)
    }:null
  };
}
async function writeAtomic(file,contents) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=path.join(path.dirname(file),'.tls-'+randomBytes(10).toString('hex')+'.tmp');
  try{
    await fs.writeFile(tmp,contents,{mode:0o600,flag:'wx'});
    await fs.rename(tmp,file);
  }finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
}

export class ControllerTls {
  #directory;
  #httpPort;
  #settings;
  #identity=null;
  #busy=false;
  #lastError=null;
  constructor({dataDir,port=4242}={}){
    if(!dataDir)throw new Error('TLS requires a persistent data directory');
    this.#directory=path.join(dataDir,'tls');
    this.#httpPort=port;
    this.#settings=settingsFor({mode:'off'},{httpPort:port});
  }
  get enabled(){return this.#settings.mode!=='off';}
  get mode(){return this.#settings.mode;}
  get port(){return this.#settings.port;}
  get options(){
    if(!this.enabled)return null;
    if(!this.#identity)throw fail('HTTPS certificate is not initialized',503);
    return {cert:this.#identity.cert,key:this.#identity.key,minVersion:'TLSv1.2'};
  }
  status(){return publicStatus(this.#settings,this.enabled?this.#identity:null,{busy:this.#busy,lastError:this.#lastError});}
  publicCertificate(){
    if(!this.enabled||!this.#identity)throw fail('HTTPS is not enabled',409);
    return this.#identity.cert;
  }
  async #readManaged(){
    const manifest=JSON.parse(await fs.readFile(path.join(this.#directory,'current.json'),'utf8'));
    if(manifest?.version!==1||!/^[a-f0-9]{32}$/.test(manifest.id))
      throw new Error('Stored TLS identity pointer is invalid; local repair required');
    const root=path.join(this.#directory,'identities',manifest.id);
    const [cert,key]=await Promise.all([
      fs.readFile(path.join(root,'cert.pem'),'utf8'),
      fs.readFile(path.join(root,'key.pem'),'utf8')
    ]);
    validatePair(cert,key);
    return {cert,key,id:manifest.id,dir:root};
  }
  async #readProvided(settings){
    const [cert,key]=await Promise.all([
      fs.readFile(settings.certFile,'utf8'),
      fs.readFile(settings.keyFile,'utf8')
    ]);
    validatePair(cert,key);
    return {cert,key,id:null};
  }
  async init(){
    const file=path.join(this.#directory,'settings.json');
    let input;
    try{input=JSON.parse(await fs.readFile(file,'utf8'));}
    catch(e){
      if(e.code!=='ENOENT')throw new Error('Persistent HTTPS settings are unreadable; local repair required');
      input={mode:'off'};
    }
    if(input.version!==undefined&&input.version!==1)
      throw new Error('Unsupported HTTPS settings format');
    this.#settings=settingsFor(input,{httpPort:this.#httpPort});
    if(this.#settings.mode==='self-signed'){
      // Never silently replace a corrupted identity. Only a new GUI setup
      // creates a key; existing installations must keep their identity.
      this.#identity=await this.#readManaged();
    }else if(this.#settings.mode==='provided'){
      this.#identity=await this.#readProvided(this.#settings);
    }else this.#identity=null;
    return this.options;
  }
  async #storeCandidate(pair){
    await fs.mkdir(this.#directory,{recursive:true,mode:0o700});
    const base=path.join(this.#directory,'identities');
    await fs.mkdir(base,{recursive:true,mode:0o700});
    const id=randomBytes(16).toString('hex');
    const dir=path.join(base,id);
    await fs.mkdir(dir,{mode:0o700});
    try{
      await fs.writeFile(path.join(dir,'key.pem'),pair.key,{flag:'wx',mode:0o600});
      await fs.writeFile(path.join(dir,'cert.pem'),pair.cert,{flag:'wx',mode:0o600});
      validatePair(pair.cert,pair.key);
      return {cert:pair.cert,key:pair.key,id,dir};
    }catch(e){
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
      throw e;
    }
  }
  async #writePointer(id){
    await writeAtomic(path.join(this.#directory,'current.json'),JSON.stringify({version:1,id})+'\n');
  }
  async #writeSettings(settings){
    await writeAtomic(path.join(this.#directory,'settings.json'),JSON.stringify(settings,null,2)+'\n');
  }
  /**
   * Prepare an administrator-requested GUI change *before* replying to the
   * HTTP request. The HTTP->HTTPS listener swap runs after response delivery.
   */
  async prepareConfiguration(input){
    if(this.#busy)throw fail('An HTTPS configuration change is already in progress',409);
    this.#busy=true;
    this.#lastError=null;
    let candidate=null;
    try{
      const settings=settingsFor(input,{httpPort:this.#httpPort});
      if(settings.mode==='self-signed'){
        const unchanged=this.#settings.mode==='self-signed'
          &&JSON.stringify(settings.names)===JSON.stringify(this.#settings.names);
        candidate=unchanged?this.#identity:
          await this.#storeCandidate(createSelfSignedCertificate({names:settings.names}));
      }else if(settings.mode==='provided'){
        candidate=await this.#readProvided(settings);
      }
      return {settings,candidate,previous:this.#settings,previousIdentity:this.#identity};
    }catch(e){
      if(candidate?.dir)await fs.rm(candidate.dir,{recursive:true,force:true}).catch(()=>{});
      this.#busy=false;
      throw e;
    }
  }
  async cancelPreparedConfiguration(prepared){
    if(!this.#busy)return;
    // The HTTP client disconnected before receiving confirmation. Do not
    // change listeners or leave a permanently locked configuration service.
    if(prepared?.candidate?.dir&&prepared.candidate!==this.#identity)
      await fs.rm(prepared.candidate.dir,{recursive:true,force:true}).catch(()=>{});
    this.#busy=false;
  }
  /**
   * Called after the GUI receives 202: swap the actual listener and roll back
   * disk settings + identity pointer if any stage fails.
   */
  async applyConfiguration(prepared,activate){
    if(!this.#busy)throw fail('No HTTPS configuration is prepared',409);
    const {settings,candidate,previous,previousIdentity}=prepared;
    let switched=false;
    let pointerUpdated=false;
    try{
      const nextOptions=settings.mode==='off'?null:{
        cert:candidate.cert,key:candidate.key,minVersion:'TLSv1.2'
      };
      await activate({options:nextOptions,port:settings.port,secure:settings.mode!=='off'});
      switched=true;
      if(settings.mode==='self-signed'&&candidate.id!==previousIdentity?.id){
        await this.#writePointer(candidate.id);
        pointerUpdated=true;
      }
      await this.#writeSettings(settings);
      this.#settings=settings;
      this.#identity=candidate;
      this.#lastError=null;
      if(previousIdentity?.dir &&previousIdentity.id!==candidate?.id)
        await fs.rm(previousIdentity.dir,{recursive:true,force:true}).catch(()=>{});
      return this.status();
    }catch(e){
      // Listener and configuration must both remain usable on any failure.
      if(switched){
        const oldOptions=previous.mode==='off'?null:{
          cert:previousIdentity.cert,key:previousIdentity.key,minVersion:'TLSv1.2'
        };
        try{await activate({options:oldOptions,port:previous.port,secure:previous.mode!=='off'});}
        catch(rollbackError){this.#lastError='HTTPS activation and listener rollback both failed; local recovery required';}
      }
      if(pointerUpdated&&previousIdentity?.id)
        await this.#writePointer(previousIdentity.id).catch(()=>{});
      if(pointerUpdated&&!previousIdentity?.id)
        await fs.rm(path.join(this.#directory,'current.json'),{force:true}).catch(()=>{});
      await this.#writeSettings(previous).catch(()=>{});
      if(!this.#lastError)this.#lastError='HTTPS configuration could not be applied: '+e.message;
      throw e;
    }finally{
      if(candidate?.dir&&this.#settings!==settings)
        await fs.rm(candidate.dir,{recursive:true,force:true}).catch(()=>{});
      this.#busy=false;
    }
  }
  async regenerate(server){
    if(this.#busy)throw fail('An HTTPS configuration change is already in progress',409);
    if(this.mode!=='self-signed'||!this.#identity)
      throw fail('Only controller-managed self-signed certificates can be regenerated',409);
    if(!server||typeof server.setSecureContext!=='function')
      throw fail('Controller HTTPS listener is unavailable',503);
    this.#busy=true;
    const previous=this.#identity;
    let candidate=null;
    try{
      candidate=await this.#storeCandidate(createSelfSignedCertificate({names:this.#settings.names}));
      server.setSecureContext({cert:candidate.cert,key:candidate.key,minVersion:'TLSv1.2'});
      try{await this.#writePointer(candidate.id);}
      catch(e){
        server.setSecureContext({cert:previous.cert,key:previous.key,minVersion:'TLSv1.2'});
        throw e;
      }
      this.#identity=candidate;
      if(previous.dir)await fs.rm(previous.dir,{recursive:true,force:true}).catch(()=>{});
      return this.status();
    }catch(e){
      if(candidate?.dir&&this.#identity!==candidate)
        await fs.rm(candidate.dir,{recursive:true,force:true}).catch(()=>{});
      throw e;
    }finally{this.#busy=false;}
  }
}
