import {configuredLimit,resourceError} from './resource-limits.js';
/**
 * In-memory, revocable authentication session and login-rate primitives.
 * Sessions are used by the controller HTTP gate when native auth is enabled.
 */
import {createHash,randomBytes} from 'node:crypto';

const digest=token=>createHash('sha256').update(String(token)).digest('hex');
const DEFAULT_IDLE_MS=2*60*60*1000;
const DEFAULT_ABSOLUTE_MS=24*60*60*1000;

export class SessionManager {
  #sessions=new Map();
  #now;
  #idle;
  #absolute;
  #maxSessions;
  #maxPerUser;
  constructor({now=()=>Date.now(),idleMs=DEFAULT_IDLE_MS,absoluteMs=DEFAULT_ABSOLUTE_MS,maxSessions=configuredLimit('PFC_MAX_SESSIONS',1000),maxPerUser=configuredLimit('PFC_MAX_SESSIONS_PER_USER',20)}={}){
    if(!Number.isFinite(idleMs)||idleMs<=0||!Number.isFinite(absoluteMs)||absoluteMs<=0)
      throw new Error('Session timeout must be positive');
    this.#now=now;
    this.#idle=idleMs;
    this.#absolute=absoluteMs;this.#maxSessions=maxSessions;this.#maxPerUser=maxPerUser;
  }
  create(userId){
    if(typeof userId!=='string'||!userId)throw new Error('A real user ID is required');
    this.pruneExpired();
    if(this.#sessions.size>=this.#maxSessions||[...this.#sessions.values()].filter(entry=>entry.userId===userId).length>=this.#maxPerUser)
      throw resourceError('Active session limit reached. Sign out of an existing session before retrying.');
    const token=randomBytes(32).toString('hex');
    const now=this.#now();
    this.#sessions.set(digest(token),{userId,created:now,lastSeen:now});
    return token;
  }
  resolve(token,touch=true){
    if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))return null;
    const key=digest(token),entry=this.#sessions.get(key);
    if(!entry)return null;
    const now=this.#now();
    if(now<entry.lastSeen||now-entry.lastSeen>=this.#idle||now-entry.created>=this.#absolute){
      this.#sessions.delete(key);
      return null;
    }
    if(touch)entry.lastSeen=now;
    return {userId:entry.userId,createdAt:entry.created,
      expiresAt:Math.min(entry.created+this.#absolute,entry.lastSeen+this.#idle)};
  }
  peek(token){return this.resolve(token,false);}
  revoke(token){
    if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))return false;
    return this.#sessions.delete(digest(token));
  }
  revokeUser(userId){
    let removed=0;
    for(const [key,entry] of this.#sessions)
      if(entry.userId===userId){this.#sessions.delete(key);removed++;}
    return removed;
  }
  clear(){this.#sessions.clear();}
  pruneExpired(){
    const now=this.#now();
    for(const [key,entry] of this.#sessions)
      if(now<entry.lastSeen||now-entry.lastSeen>=this.#idle||now-entry.created>=this.#absolute)this.#sessions.delete(key);
  }
  get size(){this.pruneExpired();return this.#sessions.size;}
}

export class LoginAttemptLimiter {
  #entries=new Map();
  #now;
  #maxFailures;
  #windowMs;
  #active=0;
  #byAddress=new Map();
  #byAccount=new Set();
  constructor({now=()=>Date.now(),maxFailures=5,windowMs=15*60*1000}={}){
    if(!Number.isInteger(maxFailures)||maxFailures<1||windowMs<1)
      throw new Error('Invalid login attempt limits');
    this.#now=now;this.#maxFailures=maxFailures;this.#windowMs=windowMs;
  }
  #key(username,remoteAddress){
    // Combine account and source to prevent a single misconfigured proxy
    // bucket locking everyone out; also separately throttle per source IP.
    return [String(username||'').trim().toLowerCase(),String(remoteAddress||'unknown')];
  }
  #check(key){
    const entry=this.#entries.get(key);
    if(!entry)return 0;
    if(this.#now()>=entry.expires){this.#entries.delete(key);return 0;}
    return Math.max(0,entry.count);
  }
  canAttempt(username,address){
    const [name,ip]=this.#key(username,address);
    return this.#check(`name:${name}|ip:${ip}`)<this.#maxFailures &&
      this.#check(`ip:${ip}`)<this.#maxFailures*5;
  }
  async run(username,address,operation){
    const [name,ip]=this.#key(username,address);
    // No waiting queue: reserve bounded expensive work before yielding.
    if (!this.canAttempt(name,ip) || this.#active>=4 || (this.#byAddress.get(ip)||0)>=2 || this.#byAccount.has(name))
      throw Object.assign(new Error('Too many authentication attempts. Try again later.'),{statusCode:429});
    this.#active++;
    this.#byAddress.set(ip,(this.#byAddress.get(ip)||0)+1);
    this.#byAccount.add(name);
    let success=false;
    try {
      const result=await operation();success=Boolean(result);return result;
    } finally {
      this.#active--;
      const count=this.#byAddress.get(ip)-1;
      if(count)this.#byAddress.set(ip,count);else this.#byAddress.delete(ip);
      this.#byAccount.delete(name);
      if(success)this.recordSuccess(name,ip);else this.recordFailure(name,ip);
    }
  }
  recordFailure(username,address){
    const [name,ip]=this.#key(username,address);
    for(const key of [`name:${name}|ip:${ip}`,`ip:${ip}`]){
      const count=this.#check(key)+1;
      this.#entries.set(key,{count,expires:this.#now()+this.#windowMs});
    }
    // Bound the allocation from spoofed account names and source addresses.
    while(this.#entries.size>10000){
      const first=this.#entries.keys().next().value;
      if(first)this.#entries.delete(first);
    }
  }
  recordSuccess(username,address){
    const [name,ip]=this.#key(username,address);
    this.#entries.delete(`name:${name}|ip:${ip}`);
  }
}
