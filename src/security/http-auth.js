/**
 * Native HTTP authentication boundary. Only this service decides whether a
 * request may enter the controller router; frontend visibility is advisory.
 * Initial enrollment requires a private, one-time controller-startup code.
 * Recovery deliberately remains offline; no default LAN administrator exists.
 */
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {AccountStore} from './account-store.js';
import {SessionManager, LoginAttemptLimiter} from './session-manager.js';
import {requiredPermission, roleHasPermission, PERMISSIONS} from './authorization-policy.js';

const COOKIE='pfc_session';
const MUTATIONS=new Set(['POST','PUT','PATCH','DELETE']);
const csrfFor=(token)=>createHash('sha256').update('pfc-csrf-v1:'+token).digest('hex');
const bad=(res,json,status,message)=>{json(res,status,{error:message});return true;};
const cookieToken=(req)=>{
  const cookies=String(req.headers.cookie||'').split(';');
  const cookie=cookies.map(part=>part.trim()).find(part=>part.startsWith(COOKIE+'='));
  const token=cookie?.slice(COOKIE.length+1)||'';
  return /^[a-f0-9]{64}$/.test(token)?token:null;
};
const equals=(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
};
const safeBody=(input,allowed)=>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Invalid request'),{statusCode:400});
  for(const key of Object.keys(input))if(!allowed.includes(key))
    throw Object.assign(new Error('Unexpected field'),{statusCode:400});
  return input;
};
const jsonError=(error)=>({
  status:([400,401,403,404,409,429,503].includes(error?.statusCode)?error.statusCode:400),
  error:error?.statusCode===500?'Request failed':String(error?.message||'Invalid request')
});

export class ControllerAuth {
  #accounts;
  #sessions=new SessionManager();
  #limiter=new LoginAttemptLimiter();
  #streams=new Map();
  #legacyInFlight=new Set();
  #enabled=true;
  #setupRequired=false;
  #secure=false;
  #allowHttp=false;
  #origin=null;
  #enrollmentCode=null;
  #enrollmentAvailable=false;
  #enrolling=false;
  #emitEnrollmentCode;
  constructor({dataDir,env=process.env,emitEnrollmentCode=message=>process.stdout.write(message)}={}){
    this.#emitEnrollmentCode=emitEnrollmentCode;
    this.#accounts=new AccountStore({dataDir});
    const configured=String(env.PFC_PUBLIC_ORIGIN||'').trim();
    if(configured){
      const origin=new URL(configured);
      if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||
         origin.pathname!=='/'||origin.search||origin.hash)
        throw new Error('PFC_PUBLIC_ORIGIN must be an exact http(s) origin');
      this.#origin=origin.origin;
      this.#secure=origin.protocol==='https:';
    }
    // Password entry requires HTTPS unless the host explicitly opts into
    // legacy plaintext operation. Authentication remains enabled independently.
    this.#allowHttp=env.PFC_AUTH_ALLOW_HTTP==='1';
    this.#enabled=env.PFC_AUTH_REQUIRED!=='0';
  }
  get enabled(){return this.#enabled;}
  get setupRequired(){return this.#setupRequired;}
  get secure(){return this.#secure;}
  /**
   * Browser transport changes only after the underlying listener is swapped.
   * Existing HTTP-issued sessions must never carry over into HTTPS: a stolen
   * HTTP cookie may otherwise be replayed as a privileged Secure session.
   */
  setNativeTransportSecure(enabled,{revokeSessions=true,forceRevoke=false}={}){
    if(enabled&&this.#origin&&new URL(this.#origin).protocol!=='https:')
      throw new Error('An existing HTTP PFC_PUBLIC_ORIGIN conflicts with native HTTPS; clear this legacy proxy setting');
    const next=Boolean(enabled)||Boolean(this.#origin?.startsWith('https://'));
    if(this.#secure===next&&!forceRevoke)return;
    this.#secure=next;
    if(revokeSessions){
      this.#sessions.clear();
      for(const streams of this.#streams.values())
        for(const res of streams)if(!res.destroyed)res.destroy();
      this.#streams.clear();
    }
  }
  async init(){
    const dataDir=path.dirname(path.dirname(this.#accounts.filePath));
    const marker=path.join(dataDir,'security','enabled');
    const exists=async p=>fs.access(p).then(()=>true,error=>{
      if(error.code==='ENOENT')return false;
      throw error;
    });
    // A durable marker disallows browser re-enrollment even if the user store is lost.
    const marked=await exists(marker);
    const stored=await exists(this.#accounts.filePath);
    this.#enabled=this.#enabled||marked||stored;
    this.#setupRequired=this.#enabled&&!(await this.#accounts.initialized());
    this.#enrollmentAvailable=!marked&&!stored;
    if(!this.#enrollmentAvailable){
      this.#enrollmentCode=null;
    }else if(!this.#enrollmentCode){
      this.#enrollmentCode=randomBytes(24).toString('hex').toUpperCase();
      // Called before the diagnostic logger captures console output. Do not
      // include this private code in controller diagnostics or any HTTP response.
      this.#emitEnrollmentCode(
        '\n=== PRINT FARM CONTROLLER: FIRST ADMINISTRATOR ENROLLMENT ===\n'
        +'Open the first administrator setup screen in the controller.\n'
        +'One-time enrollment code (private): '+this.#enrollmentCode+'\n'
        +'Read this from your protected container/host startup console only.\n'
        +'This code is invalidated by enrollment or a controller restart.\n\n'
      );
    }
  }
  #authenticate(req,username,password){
    return this.#limiter.run(username,req.socket?.remoteAddress||'unknown',
      ()=>this.#accounts.authenticate(username,password));
  }
  #cookie(res,token){
    res.setHeader('set-cookie',COOKIE+'='+token+'; Path=/; HttpOnly; SameSite=Strict'+
      (this.#secure?'; Secure':'')+'; Max-Age='+(token?86400:0));
  }
  #expectedOrigin(req){
    return this.#origin||(this.#secure?'https://':'http://')+String(req.headers.host||'');
  }
  #originAllowed(req){
    const origin=String(req.headers.origin||'');
    // No CORS. Even login requests require a browser Origin to prevent login CSRF.
    return Boolean(origin)&&origin===this.#expectedOrigin(req)&&
      !['cross-site','same-site'].includes(String(req.headers['sec-fetch-site']||''));
  }
  async #identity(req){
    const token=cookieToken(req);
    if(!token)return null;
    // Passive page polling, downloads, SSE and the identity heartbeat must not
    // extend idle sessions. Only authorized human activity/changes renew TTL.
    const session=this.#sessions.peek(token);
    if(!session)return null;
    const user=await this.#accounts.getUser(session.userId);
    if(!user||user.disabled){
      this.#sessions.revoke(token);
      return null;
    }
    return {token,user,csrf:csrfFor(token)};
  }
  #mutationAllowed(req,identity){
    return this.#originAllowed(req)&&equals(String(req.headers['x-pfc-csrf']||''),identity.csrf);
  }
  #closeStreams(userId){
    const streams=this.#streams.get(userId);
    for(const res of streams||[])if(!res.destroyed)res.destroy();
    this.#streams.delete(userId);
  }
  #revokeUser(userId){
    this.#sessions.revokeUser(userId);
    this.#closeStreams(userId);
  }
  #track(res,userId,token){
    let streams=this.#streams.get(userId);
    if(!streams){streams=new Set();this.#streams.set(userId,streams);}
    streams.add(res);
    // An open SSE/camera stream cannot outlive session expiry or revocation.
    const expiry=setInterval(()=>{
      if(!this.#sessions.peek(token)&&!res.destroyed)res.destroy();
    },15000);
    expiry.unref?.();
    res.once('close',()=>{
      clearInterval(expiry);
      streams.delete(res);
      if(streams.size===0)this.#streams.delete(userId);
    });
  }
  #status(identity){
    return {
      enabled:this.#enabled,setupRequired:this.#setupRequired,
      enrollmentAvailable:this.#enrollmentAvailable,
      user:identity?.user||null,csrf:identity?.csrf||null,
      permissions:identity?Object.values(PERMISSIONS).filter(p=>roleHasPermission(identity.user.role,p)):[],
      transportSecure:this.#secure,
      loginAvailable:this.#secure||this.#allowHttp,
      transportWarning:!this.#secure
        ?'Password and session traffic over HTTP is not protected from LAN interception. Configure HTTPS before production use.'
        :null
    };
  }
  /**
   * Auth namespace is handled before ordinary API dispatch. Enrollment
   * requires the one-time private code; there is no open registration.
   * @returns true if this service handled the path.
   */
  async route(req,res,url,{json,readJson}){
    if(!url.pathname.startsWith('/api/auth/'))return false;
    const method=req.method,pathname=url.pathname;
    if(method==='GET'&&pathname==='/api/auth/session'){
      const identity=this.#enabled&&!this.#setupRequired?await this.#identity(req):null;
      json(res,200,this.#status(identity));
      return true;
    }
    if(method==='POST'&&pathname==='/api/auth/enroll'){
      if(!this.#enrollmentAvailable||!this.#enrollmentCode)
        return bad(res,json,409,'Enrollment is unavailable; use local recovery if accounts were lost');
      if(this.#enrolling)return bad(res,json,409,'Enrollment is already in progress');
      if(!this.#originAllowed(req))return bad(res,json,403,'Origin verification failed');
      if(!this.#secure&&!this.#allowHttp)
        return bad(res,json,503,'HTTP enrollment disabled: configure HTTPS or explicitly permit HTTP');
      const address=req.socket?.remoteAddress||'unknown';
      if(!this.#limiter.canAttempt('first-admin-enrollment',address))
        return bad(res,json,429,'Too many enrollment attempts. Try again later.');
      let data;
      try{data=safeBody(await readJson(req),['code','username','password','displayName']);}
      catch(error){const e=jsonError(error);return bad(res,json,e.status,e.error);}
      if(!equals(String(data.code||'').trim().toUpperCase(),this.#enrollmentCode)){
        this.#limiter.recordFailure('first-admin-enrollment',address);
        return bad(res,json,403,'Invalid enrollment code');
      }
      this.#enrolling=true;
      try{
        await this.#accounts.bootstrapAdministrator({
          username:data.username,password:data.password,displayName:data.displayName
        });
        this.#enrollmentCode=null;
        this.#enrollmentAvailable=false;
        this.#enabled=true;
        this.#setupRequired=false;
        // Drop responses/streams created before access control was enabled.
        // Otherwise unauthenticated SSE/camera clients could stay connected.
        for(const response of this.#legacyInFlight)response.destroy?.();
        this.#legacyInFlight.clear();
        this.#limiter.recordSuccess('first-admin-enrollment',address);
        json(res,201,{ok:true,signInRequired:true});
      }catch(error){
        // bootstrapAdministrator writes the durable security marker BEFORE
        // writing the account file. A partial failure must never leave legacy
        // unauthenticated access available.
        await this.init();
        const e=jsonError(error);
        return bad(res,json,e.status,e.error);
      }finally{this.#enrolling=false;}
      return true;
    }
    if(!this.#enabled)return bad(res,json,404,'Authentication is not enabled');
    if(this.#setupRequired)return bad(res,json,503,'Administrator account recovery required');
    if(method==='POST'&&pathname==='/api/auth/login'){
      if(!this.#originAllowed(req))return bad(res,json,403,'Origin verification failed');
      if(!this.#secure&&!this.#allowHttp)
        return bad(res,json,503,'HTTP login disabled: configure HTTPS or explicitly permit HTTP');
      let data;
      try{data=safeBody(await readJson(req),['username','password']);}
      catch(error){const e=jsonError(error);return bad(res,json,e.status,e.error);}
      const username=String(data.username||'').slice(0,100);
      const address=req.socket?.remoteAddress||'unknown';
      if(!this.#limiter.canAttempt(username,address))
        return bad(res,json,429,'Too many login attempts. Try again later.');
      let user;
      try {user=await this.#authenticate(req,username,data.password);}
      catch(error){if(error.statusCode===429)return bad(res,json,429,error.message);throw error;}
      if(!user){
        return bad(res,json,401,'Invalid username or password');
      }
      const token=this.#sessions.create(user.id);
      this.#cookie(res,token);
      json(res,200,this.#status({user,csrf:csrfFor(token)}));
      return true;
    }
    const identity=await this.#identity(req);
    if(!identity)return bad(res,json,401,'Authentication required');
    if(MUTATIONS.has(method)&&!this.#mutationAllowed(req,identity))
      return bad(res,json,403,'Origin or CSRF verification failed');
    if(MUTATIONS.has(method))this.#sessions.resolve(identity.token);
    if(method==='POST'&&pathname==='/api/auth/activity'){
      json(res,200,{ok:true});return true;
    }
    if(method==='POST'&&pathname==='/api/auth/logout'){
      this.#sessions.revoke(identity.token);
      this.#closeStreams(identity.user.id);
      this.#cookie(res,'');
      json(res,200,{ok:true});
      return true;
    }
    if(method==='POST'&&pathname==='/api/auth/password'){
      try{
        const data=safeBody(await readJson(req),['currentPassword','newPassword']);
        if(!await this.#authenticate(req,identity.user.username,data.currentPassword))
          return bad(res,json,403,'Current password is incorrect');
        await this.#accounts.updateUser(identity.user.id,{password:data.newPassword});
        this.#revokeUser(identity.user.id);
        this.#cookie(res,'');
        json(res,200,{ok:true,reauthenticate:true});
      }catch(error){const e=jsonError(error);return bad(res,json,e.status,e.error);}
      return true;
    }
    if(!roleHasPermission(identity.user.role,PERMISSIONS.USER_MANAGE))
      return bad(res,json,403,'Administrator permission required');
    if(method==='GET'&&pathname==='/api/auth/users'){
      json(res,200,{users:await this.#accounts.listUsers()});
      return true;
    }
    if(method==='POST'&&pathname==='/api/auth/users'){
      try{
        const data=safeBody(await readJson(req),['username','password','role','displayName']);
        const user=await this.#accounts.addUser(data);
        json(res,201,{user});
      }catch(error){const e=jsonError(error);return bad(res,json,e.status,e.error);}
      return true;
    }
    const edit=pathname.match(/^\/api\/auth\/users\/([a-z0-9-]+)$/);
    if(method==='PATCH'&&edit){
      try{
        const data=safeBody(await readJson(req),['role','disabled','displayName','password']);
        if(edit[1]===identity.user.id&&
          ((data.role!==undefined&&data.role!=='administrator')||data.disabled===true))
          return bad(res,json,409,'You cannot disable or demote your current account');
        const user=await this.#accounts.updateUser(edit[1],data);
        this.#revokeUser(user.id);
        if(user.id===identity.user.id)this.#cookie(res,'');
        json(res,200,{user,reauthenticate:user.id===identity.user.id});
      }catch(error){const e=jsonError(error);return bad(res,json,e.status,e.error);}
      return true;
    }
    if(method==='DELETE'&&edit){
      if(edit[1]===identity.user.id)
        return bad(res,json,409,'You cannot delete your current account');
      try{
        const user=await this.#accounts.deleteUser(edit[1]);
        this.#revokeUser(user.id);
        json(res,200,{ok:true,user});
      }catch(error){const e=jsonError(error);return bad(res,json,e.status,e.error);}
      return true;
    }
    return bad(res,json,404,'Authentication route not found');
  }
  /**
   * Certificate endpoints stay administrator-only even when an installation
   * explicitly opted into legacy unauthenticated mode. Requiring the current
   * password also limits damage from an unattended unlocked admin session.
   */
  async assertAdministrator(req, password = null) {
    const identity=await this.#identity(req);
    if(!this.#enabled||this.#setupRequired||identity?.user?.role!=='administrator')
      throw Object.assign(new Error('Administrator sign-in required'),{statusCode:403});
    if(MUTATIONS.has(req.method)&&!this.#mutationAllowed(req,identity))
      throw Object.assign(new Error('Origin or CSRF verification failed'),{statusCode:403});
    if(password!==null){
      const username=identity.user.username;
      const address=req.socket?.remoteAddress||'unknown';
      if(typeof password!=='string'||!this.#limiter.canAttempt(username,address))
        throw Object.assign(new Error('Reauthentication unavailable. Try again later.'),{statusCode:429});
      if(!await this.#authenticate(req,username,password)){
        throw Object.assign(new Error('Current password is incorrect'),{statusCode:403});
      }
    }
    return identity.user;
  }
  /** Refuse all unknown controller API actions even to administrators. */
  async authorize(req,res,url,{json}){
    if(!this.#enabled){
      // Only explicitly configured legacy mode remains usable without login.
      // In-flight responses close immediately upon later enrollment.
      if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/simulator')){
        this.#legacyInFlight.add(res);
        res.once('close',()=>this.#legacyInFlight.delete(res));
      }
      return true;
    }
    const api=url.pathname.startsWith('/api/');
    const simulator=url.pathname==='/simulator'||url.pathname.startsWith('/simulator/');
    // The login / first-administrator setup screen and its CSS/JS must remain
    // reachable before an account exists. Block protected APIs and simulator
    // access, not the public application shell and static assets.
    if(!api&&!simulator)return true;
    if(this.#setupRequired&&!(req.method==='GET'&&url.pathname==='/api/health')){
      bad(res,json,503,'Local administrator setup required');return false;
    }
    const permission=simulator?PERMISSIONS.SIMULATOR_MANAGE:requiredPermission(req.method,url.pathname);
    if(permission==='public')return true;
    const identity=await this.#identity(req);
    if(!identity){bad(res,json,401,'Authentication required');return false;}
    if(!permission){bad(res,json,404,'API route not found');return false;}
    if(!roleHasPermission(identity.user.role,permission)){
      bad(res,json,403,'Insufficient permission');return false;
    }
    if(MUTATIONS.has(req.method)&&!this.#mutationAllowed(req,identity)){
      bad(res,json,403,'Origin or CSRF verification failed');return false;
    }
    req.pfcUser=identity.user;
    if(MUTATIONS.has(req.method))this.#sessions.resolve(identity.token);
    if(url.pathname==='/api/events'||url.pathname.endsWith('/camera/stream'))
      this.#track(res,identity.user.id,identity.token);
    return true;
  }
}
