import {ResourceAdmission,configuredLimit,resourceError} from './resource-limits.js';

export class StreamAdmission {
  constructor({maxActive=()=>configuredLimit('PFC_MAX_STREAMS',128),maxPerUser=()=>configuredLimit('PFC_MAX_STREAMS_PER_USER',16),maxPerIp=()=>configuredLimit('PFC_MAX_STREAMS_PER_IP',32),maxPerSession=()=>configuredLimit('PFC_MAX_STREAMS_PER_SESSION',8)}={}){
    this.pool=new ResourceAdmission({maxActive,maxPerUser});this.ips=new Map();this.sessions=new Map();
    this.maxPerIp=maxPerIp;this.maxPerSession=maxPerSession;
  }
  admit(req,res){
    const ip=req.socket?.remoteAddress||'unknown',session=req.pfcSessionId||`legacy:${ip}`;
    const perIp=typeof this.maxPerIp==='function'?this.maxPerIp():this.maxPerIp;
    const perSession=typeof this.maxPerSession==='function'?this.maxPerSession():this.maxPerSession;
    if((this.ips.get(ip)||0)>=perIp||(this.sessions.get(session)||0)>=perSession)
      throw resourceError('Too many active camera/event streams. Close another view and retry.');
    const release=this.pool.reserve(req.pfcUser?.id||`legacy:${ip}`);
    this.ips.set(ip,(this.ips.get(ip)||0)+1);this.sessions.set(session,(this.sessions.get(session)||0)+1);
    let released=false;
    const done=()=>{
      if(released)return;released=true;release();
      for(const [map,key] of [[this.ips,ip],[this.sessions,session]]){const count=map.get(key)-1;if(count)map.set(key,count);else map.delete(key);}
      res.off('close',done);res.off('finish',done);
    };
    res.once('close',done);res.once('finish',done);
    if(res.destroyed||res.writableEnded)done();
    return done;
  }
}
