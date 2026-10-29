import {promises as fs} from 'node:fs';

export function resourceError(message,statusCode=429){return Object.assign(new Error(message),{statusCode});}
export function configuredLimit(name,fallback,env=process.env){
  if(env[name]===undefined||env[name]==='')return fallback;
  const value=Number(env[name]);
  if(!Number.isSafeInteger(value)||value<1||(name.endsWith('_MS')&&value>24*60*60*1000))throw new Error(`${name} must be a positive safe integer`);
  return value;
}

/** Synchronous reservations: no unbounded queue while work waits for disk/network. */
export class ResourceAdmission {
  constructor({maxActive=4,maxPerUser=2,maxBytes=1024**3}={}){
    this.maxActive=maxActive;this.maxPerUser=maxPerUser;this.maxBytes=maxBytes;
    this.active=0;this.bytes=0;this.users=new Map();
  }
  reserve(user='local',bytes=0){
    user=String(user||'local');
    if(!Number.isSafeInteger(bytes)||bytes<0)throw resourceError('Invalid resource reservation',400);
    if(this.active>=this.maxActive||(this.users.get(user)||0)>=this.maxPerUser||this.bytes+bytes>this.maxBytes)
      throw resourceError('Controller resource capacity reached. Retry after active work finishes.');
    this.active++;this.bytes+=bytes;this.users.set(user,(this.users.get(user)||0)+1);
    let released=false;
    return ()=>{
      if(released)return;released=true;
      this.active--;this.bytes-=bytes;
      const count=this.users.get(user)-1;
      if(count)this.users.set(user,count);else this.users.delete(user);
    };
  }
}

export async function requireFreeSpace(directory,bytes,{reservedBytes=0,minFreeBytes=configuredLimit('PFC_MIN_FREE_DISK_BYTES',512*1024**2),statfs=fs.statfs}={}){
  const stats=await statfs(directory);
  const available=Number(stats.bavail)*Number(stats.bsize);
  if(!Number.isFinite(available)||available<bytes+reservedBytes+minFreeBytes)
    throw resourceError('Insufficient free disk space; controller reserve must remain available.',507);
}

export class BoundedWorkPool {
  constructor({concurrency=2,maxWaiting=16}={}){this.concurrency=concurrency;this.maxWaiting=maxWaiting;this.active=0;this.waiting=[];}
  async run(callback){
    if(this.active>=this.concurrency){
      if(this.waiting.length>=this.maxWaiting)throw resourceError('File inspection is busy. Retry later.',503);
      await new Promise(resolve=>this.waiting.push(resolve));
    }else this.active++;
    try{return await callback();}
    finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  }
}

export const fileInspectionPool=new BoundedWorkPool();
