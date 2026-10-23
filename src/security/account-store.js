/**
 * Private, dependency-free account storage primitives for a FUTURE controller
 * authentication service. Not connected to the HTTP server yet.
 *
 * Account enrollment/recovery MUST be called through a local privileged flow,
 * never exposed as a public first-run API on the controller LAN.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomBytes, randomUUID, scrypt as callbackScrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(callbackScrypt);
const SCHEMA_VERSION=1;
const HASH_VERSION='scrypt-v1';
const SCRYPT_PARAMETERS=Object.freeze({N:32768,r:8,p:1,maxmem:64*1024*1024});
const KEY_BYTES=32;
const ROLES=new Set(['administrator','operator','viewer']);
const USERNAME=/^[a-z][a-z0-9._-]{2,47}$/;

function normalizeUsername(value) {
  const username=String(value||'').trim().toLowerCase();
  if(!USERNAME.test(username)) throw new Error('Username must be 3–48 characters using letters, numbers, dots, underscores or hyphens');
  return username;
}
function validatePassword(value) {
  if(typeof value!=='string'||value.length<12||value.length>256)
    throw new Error('Password must contain 12–256 characters');
  if(value.includes('\0')) throw new Error('Password cannot contain NUL');
}
function validateRole(role) {
  if(!ROLES.has(role)) throw new Error('Unknown user role');
}
function publicUser(record){
  const {id,username,displayName,role,disabled,createdAt,updatedAt}=record;
  return {id,username,displayName,role,disabled,createdAt,updatedAt};
}
async function derive(password,salt){
  return scrypt(password,Buffer.from(salt,'hex'),KEY_BYTES,SCRYPT_PARAMETERS);
}
async function passwordRecord(password) {
  validatePassword(password);
  const salt=randomBytes(32).toString('hex');
  const hash=(await derive(password,salt)).toString('hex');
  return {version:HASH_VERSION,salt,hash};
}
function validPasswordRecord(entry) {
  return entry && entry.version===HASH_VERSION &&
    typeof entry.salt==='string' && /^[0-9a-f]{64}$/.test(entry.salt) &&
    typeof entry.hash==='string' && /^[0-9a-f]{64}$/.test(entry.hash);
}
function parseStore(text){
  let data;
  try {data=JSON.parse(text);} catch {throw new Error('Authentication account store is unreadable: recovery required');}
  if(data?.version!==SCHEMA_VERSION||!Array.isArray(data.users)||data.users.length===0)
    throw new Error('Authentication account store is invalid: recovery required');
  const names=new Set(),ids=new Set();
  for(const user of data.users){
    if(typeof user.id!=='string'||!user.id||
       typeof user.username!=='string'||!USERNAME.test(user.username)||
       names.has(user.username)||ids.has(user.id)||
       !ROLES.has(user.role)||typeof user.disabled!=='boolean'||
       !validPasswordRecord(user.password))
      throw new Error('Authentication account store contains invalid users: recovery required');
    names.add(user.username);ids.add(user.id);
  }
  if(!data.users.some(u=>u.role==='administrator'&&!u.disabled))
    throw new Error('Authentication account store has no enabled administrator: recovery required');
  return data;
}

export class AccountStore {
  #file;
  #directory;
  #queue=Promise.resolve();
  #now;
  constructor({dataDir,now=()=>new Date()}={}){
    if(!dataDir)throw new Error('dataDir is required');
    this.#directory=path.join(dataDir,'security');
    this.#file=path.join(this.#directory,'users.json');
    this.#now=now;
  }
  get filePath(){return this.#file;}
  #serial(operation){
    const next=this.#queue.then(operation,operation);
    this.#queue=next.catch(()=>{});
    return next;
  }
  async #read(){
    try {return parseStore(await fs.readFile(this.#file,'utf8'));}
    catch(error){
      if(error?.code==='ENOENT') return null;
      throw error;
    }
  }
  async #save(data){
    // Unique temp file + rename: never truncate the active user store.
    const tmp=path.join(this.#directory,`.users-${randomBytes(12).toString('hex')}.tmp`);
    await fs.mkdir(this.#directory,{recursive:true,mode:0o700});
    try{
      await fs.writeFile(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
      await fs.rename(tmp,this.#file);
    }finally{
      await fs.rm(tmp,{force:true}).catch(()=>{});
    }
  }
  async initialized(){return Boolean(await this.#read());}
  async listUsers(){
    const data=await this.#read();
    if(!data) return [];
    return data.users.map(publicUser);
  }
  async bootstrapAdministrator({username,password,displayName}={}){
    return this.#serial(async()=>{
      const login=normalizeUsername(username);
      const credentials=await passwordRecord(password);
      await fs.mkdir(this.#directory,{recursive:true,mode:0o700});
      // Exclusive CREATE also protects against two simultaneously bootstrapping
      // processes. Corrupt stores never silently allow enrolling a new admin.
      const record={
        id:randomUUID(),username:login,displayName:String(displayName||login).slice(0,120),
        role:'administrator',disabled:false,password:credentials,
        createdAt:this.#now().toISOString(),updatedAt:this.#now().toISOString()
      };
      const handle=await fs.open(this.#file,'wx',0o600);
      try{
        await handle.writeFile(JSON.stringify({version:SCHEMA_VERSION,users:[record]},null,2)+'\n');
        await handle.sync();
      }finally{await handle.close();}
      return publicUser(record);
    });
  }
  async authenticate(username,password){
    // Do not reveal existence of a username; perform a dummy hash for absent
    // accounts to reduce obvious timing differences.
    const data=await this.#read();
    if(!data)throw new Error('Authentication has not been initialized');
    const login=String(username||'').trim().toLowerCase();
    const record=data.users.find(u=>u.username===login && !u.disabled);
    const example=data.users[0].password;
    const credentials=record?.password||example;
    const input=typeof password==='string'&&password.length<=256?password:'';
    const actual=await derive(input,credentials.salt);
    const expected=Buffer.from(credentials.hash,'hex');
    const matches=timingSafeEqual(actual,expected);
    return record&&matches?publicUser(record):null;
  }
  async addUser({username,password,displayName,role='viewer'}={}){
    return this.#serial(async()=>{
      const login=normalizeUsername(username);
      validateRole(role);
      const credentials=await passwordRecord(password);
      const data=await this.#read();
      if(!data)throw new Error('Authentication has not been initialized');
      if(data.users.some(u=>u.username===login)) throw new Error('Username already exists');
      const now=this.#now().toISOString();
      const record={
        id:randomUUID(),username:login,displayName:String(displayName||login).slice(0,120),
        role,disabled:false,password:credentials,createdAt:now,updatedAt:now
      };
      data.users.push(record);
      await this.#save(data);
      return publicUser(record);
    });
  }
  async updateUser(id,{role,disabled,displayName,password}={}){
    return this.#serial(async()=>{
      const data=await this.#read();
      if(!data)throw new Error('Authentication has not been initialized');
      const record=data.users.find(u=>u.id===id);
      if(!record)throw new Error('User not found');
      if(role!==undefined){validateRole(role);record.role=role;}
      if(disabled!==undefined){
        if(typeof disabled!=='boolean')throw new Error('disabled must be boolean');
        record.disabled=disabled;
      }
      if(displayName!==undefined)record.displayName=String(displayName).slice(0,120);
      if(password!==undefined)record.password=await passwordRecord(password);
      if(!data.users.some(u=>u.role==='administrator'&&!u.disabled))
        throw new Error('Cannot disable or demote the last enabled administrator');
      record.updatedAt=this.#now().toISOString();
      await this.#save(data);
      return publicUser(record);
    });
  }
}
