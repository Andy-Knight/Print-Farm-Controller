/**
 * In-memory, revocable authentication session and login-rate primitives.
 * NOT yet connected to production HTTP; no cookies/login routes are issued.
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
  constructor({now=()=>Date.now(),idleMs=DEFAULT_IDLE_MS,absoluteMs=DEFAULT_ABSOLUTE_MS}={}){
    if(!Number.isFinite(idleMs)||idleMs<=0||!Number.isFinite(absoluteMs)||absoluteMs<=0)
      throw new Error('Session timeout must be positive');
    this.#now=now;
    this.#idle=idleMs;
    this.#absolute=absoluteMs;
  }
  create(userId){
    if(typeof userId!=='string'||!userId)throw new Error('A real user ID is required');
    const token=randomBytes(32).toString('hex');
    const now=this.#now();
    this.#sessions.set(digest(token),{userId,created:now,lastSeen:now});
    return token;
  }
  resolve(token){
    if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))return null;
    const key=digest(token),entry=this.#sessions.get(key);
    if(!entry)return null;
    const now=this.#now();
    if(now<entry.lastSeen||now-entry.lastSeen>=this.#idle||now-entry.created>=this.#absolute){
      this.#sessions.delete(key);
      return null;
    }
    entry.lastSeen=now;
    return {userId:entry.userId,createdAt:entry.created,
      expiresAt:Math.min(entry.created+this.#absolute,now+this.#idle)};
  }
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
  get size(){return this.#sessions.size;}
}

export class LoginAttemptLimiter {
  #entries=new Map();
  #now;
  #maxFailures;
  #windowMs;
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
  recordFailure(username,address){
    const [name,ip]=this.#key(username,address);
    for(const key of [`name:${name}|ip:${ip}`,`ip:${ip}`]){
      const count=this.#check(key)+1;
      this.#entries.set(key,{count,expires:this.#now()+this.#windowMs});
    }
    // Bound the allocation from spoofed account names and source addresses.
    if(this.#entries.size>10000){
      const first=this.#entries.keys().next().value;
      if(first)this.#entries.delete(first);
    }
  }
  recordSuccess(username,address){
    const [name,ip]=this.#key(username,address);
    this.#entries.delete(`name:${name}|ip:${ip}`);
  }
}
