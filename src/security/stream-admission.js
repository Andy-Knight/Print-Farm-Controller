import {ResourceAdmission,configuredLimit,resourceError} from './resource-limits.js';

export class StreamAdmission {
  constructor({maxActive=configuredLimit('PFC_MAX_STREAMS',128),maxPerUser=configuredLimit('PFC_MAX_STREAMS_PER_USER',16),maxPerIp=32,maxPerSession=8}={}){
    this.pool=new ResourceAdmission({maxActive,maxPerUser});this.ips=new Map();this.sessions=new Map();
    this.maxPerIp=maxPerIp;this.maxPerSession=maxPerSession;
  }
  admit(req,res){
    const ip=req.socket?.remoteAddress||'unknown',session=req.pfcSessionId||`legacy:${ip}`;
    if((this.ips.get(ip)||0)>=this.maxPerIp||(this.sessions.get(session)||0)>=this.maxPerSession)
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
