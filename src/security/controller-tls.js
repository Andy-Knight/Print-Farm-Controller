/**
 * Browser TLS identity lifecycle. TLS mode is opt-in; HTTP remains the
 * backward-compatible default until an administrator configures HTTPS.
 * Keys are never part of portable controller backups or static assets.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomBytes, X509Certificate, createPrivateKey} from 'node:crypto';
import tls from 'node:tls';
import {createSelfSignedCertificate, normalizeCertificateNames} from './self-signed-certificate.js';

function error(message, statusCode = 400) {
  return Object.assign(new Error(message), {statusCode});
}
function validatePair(cert, key) {
  const x509 = new X509Certificate(cert);
  if (!x509.checkPrivateKey(createPrivateKey(key)))
    throw error('HTTPS certificate and private key do not match');
  tls.createSecureContext({cert,key,minVersion:'TLSv1.2'});
  const now = Date.now();
  if (Date.parse(x509.validTo) <= now || Date.parse(x509.validFrom) > now)
    throw error('HTTPS certificate has expired or is not yet valid');
  return x509;
}
function describe(identity,mode,port) {
  const cert = identity ? new X509Certificate(identity.cert) : null;
  return {
    enabled:mode !== 'off',
    mode, port,
    canRegenerate:mode === 'self-signed',
    certificate:cert ? {
      subject:cert.subject,
      issuer:cert.issuer,
      subjectAltName:cert.subjectAltName || '',
      fingerprint256:cert.fingerprint256,
      validFrom:new Date(cert.validFrom).toISOString(),
      validTo:new Date(cert.validTo).toISOString(),
      daysRemaining:Math.floor((Date.parse(cert.validTo) - Date.now()) / 86400000),
      serialNumber:cert.serialNumber
    } : null
  };
}

export class ControllerTls {
  #directory;
  #mode;
  #port;
  #env;
  #identity = null;
  #rotating = false;
  constructor({dataDir,port = 4242,env = process.env} = {}) {
    if (!dataDir) throw new Error('TLS requires a persistent data directory');
    this.#directory = path.join(dataDir,'tls');
    this.#env = env;
    this.#port = port;
    this.#mode = String(env.PFC_HTTPS_MODE || 'off').trim().toLowerCase();
    if (!['off','self-signed','provided'].includes(this.#mode))
      throw error('PFC_HTTPS_MODE must be off, self-signed or provided');
  }
  get mode() { return this.#mode; }
  get enabled() { return this.#mode !== 'off'; }
  get options() {
    if (!this.#identity) {
      if (this.enabled) throw error('HTTPS certificate is not initialized',503);
      return null;
    }
    return {key:this.#identity.key,cert:this.#identity.cert,minVersion:'TLSv1.2'};
  }
  status() { return describe(this.#identity,this.#mode,this.#port); }
  publicCertificate() {
    if (!this.#identity) throw error('HTTPS is not enabled',409);
    return this.#identity.cert;
  }
  #nameList() {
    // Admin must explicitly list LAN IPs/hostnames. Never silently guess an
    // interface address or issue certificates for arbitrary browser Host input.
    return normalizeCertificateNames(this.#env.PFC_HTTPS_NAMES || 'localhost,127.0.0.1');
  }
  async #loadManaged() {
    const manifestPath = path.join(this.#directory,'current.json');
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(manifestPath,'utf8')); }
    catch (e) {
      if (e.code === 'ENOENT') return null;
      throw new Error('Stored HTTPS certificate configuration is unreadable; recover the TLS directory locally');
    }
    if (manifest?.version !== 1 || !/^[0-9a-f]{32}$/.test(manifest.id))
      throw new Error('Stored HTTPS certificate configuration is invalid; local repair required');
    const root = path.join(this.#directory,'identities',manifest.id);
    const [cert,key] = await Promise.all([
      fs.readFile(path.join(root,'cert.pem'),'utf8'),
      fs.readFile(path.join(root,'key.pem'),'utf8')
    ]);
    validatePair(cert,key);
    return {cert,key,id:manifest.id};
  }
  async init() {
    if (!this.enabled) return null;
    if (this.#mode === 'provided') {
      const certFile = this.#env.PFC_HTTPS_CERT_FILE;
      const keyFile = this.#env.PFC_HTTPS_KEY_FILE;
      if (!certFile || !keyFile)
        throw error('Provided HTTPS mode requires PFC_HTTPS_CERT_FILE and PFC_HTTPS_KEY_FILE');
      const [cert,key] = await Promise.all([fs.readFile(certFile,'utf8'),fs.readFile(keyFile,'utf8')]);
      validatePair(cert,key);
      this.#identity = {cert,key,id:null};
    } else {
      this.#identity = await this.#loadManaged();
      if (!this.#identity) await this.#generateAndActivate(null);
    }
    return this.options;
  }
  async #storeCandidate(candidate) {
    await fs.mkdir(this.#directory,{recursive:true,mode:0o700});
    const parent = path.join(this.#directory,'identities');
    await fs.mkdir(parent,{recursive:true,mode:0o700});
    const id = randomBytes(16).toString('hex');
    const dir = path.join(parent,id);
    await fs.mkdir(dir,{mode:0o700});
    try {
      await fs.writeFile(path.join(dir,'key.pem'),candidate.key,{mode:0o600,flag:'wx'});
      await fs.writeFile(path.join(dir,'cert.pem'),candidate.cert,{mode:0o600,flag:'wx'});
      return { ...candidate,id,dir };
    } catch (e) {
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
      throw e;
    }
  }
  async #writeCurrent(id) {
    const file = path.join(this.#directory,'current.json');
    const staged = path.join(this.#directory,'.current-'+randomBytes(8).toString('hex')+'.tmp');
    try {
      await fs.writeFile(staged,JSON.stringify({version:1,id})+'\n',{mode:0o600,flag:'wx'});
      await fs.rename(staged,file);
    } finally { await fs.rm(staged,{force:true}).catch(()=>{}); }
  }
  async #generateAndActivate(server) {
    if (this.#mode !== 'self-signed') throw error('Only controller-managed self-signed certificates can be regenerated',409);
    if (this.#rotating) throw error('Certificate regeneration already in progress',409);
    this.#rotating = true;
    const previous = this.#identity;
    let candidate = null;
    try {
      candidate = await this.#storeCandidate(createSelfSignedCertificate({names:this.#nameList()}));
      validatePair(candidate.cert,candidate.key);
      // Live Node HTTPS listeners support switching context without dropping
      // current print operations. Existing TLS connections retain old identity.
      if (server) server.setSecureContext({cert:candidate.cert,key:candidate.key,minVersion:'TLSv1.2'});
      try {
        await this.#writeCurrent(candidate.id);
      } catch (e) {
        if (server && previous)
          server.setSecureContext({cert:previous.cert,key:previous.key,minVersion:'TLSv1.2'});
        throw e;
      }
      this.#identity = candidate;
      // Clean up the immediately superseded identity only after activation.
      // No key material is logged or returned to the UI.
      if (previous?.id && previous.id !== candidate.id)
        await fs.rm(path.join(this.#directory,'identities',previous.id),{recursive:true,force:true}).catch(()=>{});
      return this.status();
    } catch (e) {
      if (candidate?.dir && this.#identity?.id !== candidate.id)
        await fs.rm(candidate.dir,{recursive:true,force:true}).catch(()=>{});
      throw e;
    } finally { this.#rotating = false; }
  }
  async regenerate(server) {
    if (!server || typeof server.setSecureContext !== 'function')
      throw error('Controller HTTPS listener is unavailable',503);
    if (!this.#identity) throw error('HTTPS is not initialized',503);
    return this.#generateAndActivate(server);
  }
}
