import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {AccountStore} from '../src/security/account-store.js';
import {ControllerAuth} from '../src/security/http-auth.js';

const ADMIN_PASSWORD='Test admin password 2026!';
const VIEW_PASSWORD='Viewer password 2026!';
const OP_PASSWORD='Operator password 2026!';
const ORIGIN='https://controller.example.test';
const send=(res,status,body)=>{res.status=status;res.body=body;};
function request(method,pathname,{body=null,cookie=null,csrf=null,origin=ORIGIN}={}){
  const headers={host:'controller.example.test',...(origin?{origin}:{})};
  if(cookie)headers.cookie=cookie;
  if(csrf)headers['x-pfc-csrf']=csrf;
  return {req:{method,headers,socket:{remoteAddress:'127.0.0.1'}},
    url:new URL(pathname,ORIGIN),readJson:async()=>body};
}
function response(){
  const res=new EventEmitter();
  res.headers={};
  res.setHeader=(k,v)=>{res.headers[k.toLowerCase()]=v;};
  res.destroyed=false;
  res.destroy=()=>{res.destroyed=true;res.emit('close');};
  return res;
}
async function exercise(auth,method,pathname,params={}){
  const r=request(method,pathname,params),res=response();
  const routed=await auth.route(r.req,res,r.url,{json:send,readJson:r.readJson});
  return {res,routed,req:r.req,url:r.url};
}
async function gate(auth,method,pathname,params={}){
  const r=request(method,pathname,params),res=response();
  const allowed=await auth.authorize(r.req,res,r.url,{json:send});
  return {allowed,res};
}
async function fixture(run){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'pfc-security-http-'));
  try{await run(dataDir);}
  finally{await rm(dataDir,{recursive:true,force:true});}
}
function bearer(res){return res.headers['set-cookie'].split(';')[0];}
async function login(auth,username,password){
  const out=await exercise(auth,'POST','/api/auth/login',{body:{username,password}});
  assert.equal(out.res.status,200,out.res.body?.error);
  return {cookie:bearer(out.res),csrf:out.res.body.csrf};
}
async function initialised(dataDir){
  const store=new AccountStore({dataDir});
  await store.bootstrapAdministrator({username:'owner',password:ADMIN_PASSWORD});
  const auth=new ControllerAuth({dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN}});
  await auth.init();
  const admin=await login(auth,'owner',ADMIN_PASSWORD);
  return {auth,store,admin};
}

test('authentication starts enabled by default, with explicit legacy opt-out and durable enrollment marker',async()=>{
  await fixture(async dataDir=>{
    const defaultAuth=new ControllerAuth({dataDir,env:{},emitEnrollmentCode:()=>{}});
    await defaultAuth.init();
    const initial=(await exercise(defaultAuth,'GET','/api/auth/session')).res.body;
    assert.equal(initial.enabled,true);
    assert.equal(initial.setupRequired,true);
    assert.equal(initial.loginAvailable,true,'HTTP is allowed by default');
    assert.equal(initial.transportSecure,false);
    assert.match(initial.transportWarning,/not protected/);
    assert.equal((await gate(defaultAuth,'GET','/')).allowed,true,
      'browser shell must load so the first admin can enroll');
    assert.equal((await gate(defaultAuth,'GET','/security')).allowed,true,
      'SPA routes must reach the enrollment shell');
    assert.equal((await gate(defaultAuth,'GET','/auth-gate.js')).allowed,true,
      'login/setup JavaScript must load');
    assert.equal((await gate(defaultAuth,'GET','/auth.css')).allowed,true,
      'login/setup stylesheet must load');
    assert.equal((await gate(defaultAuth,'GET','/dashboard-preact.js')).allowed,true,
      'frontend bundles may load without exposing protected API data');
    assert.equal((await gate(defaultAuth,'GET','/simulator/')).res.status,503,
      'simulator access is still protected while enrollment is pending');
    assert.equal((await gate(defaultAuth,'GET','/api/fleet')).res.status,503,
      'no printer data or commands before administrator setup');
    assert.equal((await gate(defaultAuth,'GET','/api/queue')).res.status,503);
    assert.equal((await gate(defaultAuth,'POST','/api/printers/p/print')).res.status,503);
    assert.equal((await gate(defaultAuth,'GET','/api/health')).allowed,true);
    const legacy=new ControllerAuth({dataDir,env:{PFC_AUTH_REQUIRED:'0'},
      emitEnrollmentCode:()=>{}});
    await legacy.init();
    assert.equal((await exercise(legacy,'GET','/api/auth/session')).res.body.enabled,false);
    assert.equal((await gate(legacy,'POST','/api/batch')).allowed,true,
      'legacy access requires an explicit opt-out before enrollment');
    await new AccountStore({dataDir}).bootstrapAdministrator({username:'owner',password:ADMIN_PASSWORD});
    const afterOptOut=new ControllerAuth({dataDir,env:{PFC_AUTH_REQUIRED:'0',PFC_PUBLIC_ORIGIN:ORIGIN}});
    await afterOptOut.init();
    assert.equal(afterOptOut.enabled,true,'persistent marker overrides legacy opt-out');
    assert.equal(afterOptOut.setupRequired,false);
  });
});

test('secure cookies, origin and CSRF checks enforce viewer/operator/admin backend decisions',async()=>{
  await fixture(async dataDir=>{
    const {auth,store,admin}=await initialised(dataDir);
    const session=(await exercise(auth,'GET','/api/auth/session',{cookie:admin.cookie})).res.body;
    assert.equal(session.user.username,'owner');
    assert.equal(session.user.password,undefined,'hash never reaches browser');
    assert.ok(session.permissions.includes('user.manage'));
    const unauthorized=await gate(auth,'GET','/api/fleet');
    assert.equal(unauthorized.allowed,false);
    assert.equal(unauthorized.res.status,401);
    const cookieHeader=(await exercise(auth,'POST','/api/auth/login',{body:{username:'owner',password:ADMIN_PASSWORD}})).res.headers['set-cookie'];
    assert.match(cookieHeader,/HttpOnly/);
    assert.match(cookieHeader,/SameSite=Strict/);
    assert.match(cookieHeader,/Secure/);
    const unknown=await gate(auth,'GET','/api/secret',{cookie:admin.cookie});
    assert.equal(unknown.res.status,404,'administrator cannot access unlisted routes');
    const cross=await gate(auth,'POST','/api/batch',{cookie:admin.cookie,csrf:admin.csrf,origin:'https://evil.example'});
    assert.equal(cross.res.status,403);
    const noCsrf=await gate(auth,'POST','/api/batch',{cookie:admin.cookie});
    assert.equal(noCsrf.res.status,403);
    const permitted=await gate(auth,'POST','/api/batch',{cookie:admin.cookie,csrf:admin.csrf});
    assert.equal(permitted.allowed,true);
    const v=await store.addUser({username:'viewer',password:VIEW_PASSWORD,role:'viewer'});
    const o=await store.addUser({username:'operator',password:OP_PASSWORD,role:'operator'});
    const viewer=await login(auth,v.username,VIEW_PASSWORD);
    const operator=await login(auth,o.username,OP_PASSWORD);
    assert.equal((await gate(auth,'GET','/api/events',{cookie:viewer.cookie})).allowed,true);
    assert.equal((await gate(auth,'GET','/api/printers/p/camera/stream',{cookie:viewer.cookie})).allowed,true);
    assert.equal((await gate(auth,'POST','/api/printers/p/print',{cookie:viewer.cookie,csrf:viewer.csrf})).res.status,403);
    assert.equal((await gate(auth,'POST','/api/batch',{cookie:operator.cookie,csrf:operator.csrf})).allowed,true);
    assert.equal((await gate(auth,'POST','/api/printers',{cookie:operator.cookie,csrf:operator.csrf})).res.status,403);
    assert.equal((await gate(auth,'GET','/api/backup/download/private',{cookie:operator.cookie})).res.status,403);
    assert.equal((await gate(auth,'GET','/api/diagnostics/bundle',{cookie:viewer.cookie})).res.status,403);
    assert.equal((await gate(auth,'GET','/simulator/',{cookie:operator.cookie})).res.status,403);
    assert.equal((await gate(auth,'GET','/simulator/',{cookie:admin.cookie})).allowed,true);
    assert.equal((await exercise(auth,'GET','/api/auth/users',{cookie:operator.cookie})).res.status,403);
    assert.equal((await exercise(auth,'GET','/api/auth/users',{cookie:admin.cookie})).res.body.users.length,3);
    assert.equal((await gate(auth,'GET','/api/health')).allowed,true);
    assert.equal((await exercise(auth,'GET','/api/auth/session',{cookie:viewer.cookie})).res.body.user.role,'viewer');
  });
});

test('disabled user, changed role/password and logout revoke sessions and streams',async()=>{
  await fixture(async dataDir=>{
    const {auth,store,admin}=await initialised(dataDir);
    const v=await store.addUser({username:'camerauser',role:'viewer',password:VIEW_PASSWORD});
    const viewer=await login(auth,'camerauser',VIEW_PASSWORD);
    const r=request('GET','/api/events',{cookie:viewer.cookie}),stream=response();
    assert.equal(await auth.authorize(r.req,stream,r.url,{json:send}),true);
    const update=await exercise(auth,'PATCH','/api/auth/users/'+v.id,{
      cookie:admin.cookie,csrf:admin.csrf,body:{disabled:true}
    });
    assert.equal(update.res.status,200);
    assert.equal(stream.destroyed,true,'open streams close immediately on revocation');
    assert.equal((await gate(auth,'GET','/api/fleet',{cookie:viewer.cookie})).res.status,401);
    assert.equal((await exercise(auth,'GET','/api/auth/session',{cookie:viewer.cookie})).res.body.user,null);
    const ownDemote=await exercise(auth,'PATCH','/api/auth/users/'+(await store.listUsers()).find(u=>u.username==='owner').id,{
      cookie:admin.cookie,csrf:admin.csrf,body:{role:'viewer'}
    });
    assert.equal(ownDemote.res.status,409);
    const oldPassword=await exercise(auth,'POST','/api/auth/password',{cookie:admin.cookie,csrf:admin.csrf,
      body:{currentPassword:'wrong',newPassword:'A different password 2026'}});
    assert.equal(oldPassword.res.status,403);
    const changed=await exercise(auth,'POST','/api/auth/password',{cookie:admin.cookie,csrf:admin.csrf,
      body:{currentPassword:ADMIN_PASSWORD,newPassword:'A different password 2026'}});
    assert.equal(changed.res.status,200);
    assert.equal((await gate(auth,'GET','/api/fleet',{cookie:admin.cookie})).res.status,401);
    const renewed=await login(auth,'owner','A different password 2026');
    assert.equal((await exercise(auth,'POST','/api/auth/activity',{cookie:renewed.cookie,csrf:renewed.csrf})).res.status,200);
    assert.equal((await exercise(auth,'POST','/api/auth/activity',{cookie:renewed.cookie})).res.status,403);
    const logout=await exercise(auth,'POST','/api/auth/logout',{cookie:renewed.cookie,csrf:renewed.csrf});
    assert.equal(logout.res.status,200);
    assert.match(logout.res.headers['set-cookie'],/Max-Age=0/);
    assert.equal((await gate(auth,'GET','/api/fleet',{cookie:renewed.cookie})).res.status,401);
  });
});

test('HTTP login works by default with conspicuous warning, or can be explicitly HTTPS-only',async()=>{
  await fixture(async dataDir=>{
    const store=new AccountStore({dataDir});
    await store.bootstrapAdministrator({username:'owner',password:ADMIN_PASSWORD});
    const http=new ControllerAuth({dataDir,env:{}});
    await http.init();
    const plain=await exercise(http,'POST','/api/auth/login',{
      origin:'http://controller.example.test',body:{username:'owner',password:ADMIN_PASSWORD}
    });
    assert.equal(plain.res.status,200,plain.res.body?.error);
    assert.doesNotMatch(plain.res.headers['set-cookie'],/; Secure/);
    assert.match(plain.res.body.transportWarning,/not protected/);
    const httpsOnly=new ControllerAuth({dataDir,env:{PFC_AUTH_ALLOW_HTTP:'0'}});
    await httpsOnly.init();
    const blocked=await exercise(httpsOnly,'POST','/api/auth/login',{
      origin:'http://controller.example.test',body:{username:'owner',password:ADMIN_PASSWORD}
    });
    assert.equal(blocked.res.status,503);
    const secure=new ControllerAuth({dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN}});
    await secure.init();
    for(let i=0;i<5;i++){
      const attempt=await exercise(secure,'POST','/api/auth/login',{body:{username:'owner',password:'incorrect'}});
      assert.equal(attempt.res.status,401);
      assert.equal(attempt.res.body.error,'Invalid username or password');
    }
    assert.equal((await exercise(secure,'POST','/api/auth/login',{body:{username:'owner',password:ADMIN_PASSWORD}})).res.status,429);
    const newServer=new ControllerAuth({dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN}});
    await newServer.init();
    const session=await login(newServer,'owner',ADMIN_PASSWORD);
    const afterRestart=new ControllerAuth({dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN}});
    await afterRestart.init();
    assert.equal((await gate(afterRestart,'GET','/api/fleet',{cookie:session.cookie})).res.status,401);
  });
});

test('GUI enrollment needs a private code, secure origin, and irrevocably enables RBAC',async()=>{
  await fixture(async dataDir=>{
    let privateLog='';
    const auth=new ControllerAuth({
      dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},
      emitEnrollmentCode:message=>{privateLog+=message;}
    });
    await auth.init();
    const code=privateLog.match(/One-time enrollment code \(private\): ([0-9A-F]{48})/)?.[1];
    assert.ok(code,'setup code must be issued in private startup output');
    const before=(await exercise(auth,'GET','/api/auth/session')).res.body;
    assert.equal(before.enabled,true);
    assert.equal(before.setupRequired,true);
    assert.equal(before.enrollmentAvailable,true);
    assert.equal(JSON.stringify(before).includes(code),false,'never expose setup code over HTTP');
    assert.equal((await gate(auth,'POST','/api/batch')).res.status,503,
      'no API operations permitted pending first administrator enrollment');
    const enrollment={code,username:'firstadmin',password:ADMIN_PASSWORD,displayName:'Farm owner'};
    assert.equal((await exercise(auth,'POST','/api/auth/enroll',{
      body:enrollment,origin:'https://untrusted.example'
    })).res.status,403,'forged origin must not enroll');
    assert.equal((await exercise(auth,'POST','/api/auth/enroll',{
      body:{...enrollment,code:'BAD'}
    })).res.status,403,'missing or incorrect setup code cannot enroll');
    assert.equal((await exercise(auth,'POST','/api/auth/enroll',{
      body:{...enrollment,password:'short'}
    })).res.status,400,'invalid passwords must not activate security');
    const saved=await exercise(auth,'POST','/api/auth/enroll',{body:enrollment});
    assert.equal(saved.res.status,201,saved.res.body?.error);
    assert.equal(auth.enabled,true,'RBAC must begin immediately, without server restart');
    assert.equal((await gate(auth,'GET','/api/events')).res.status,401);
    assert.equal((await gate(auth,'POST','/api/batch')).res.status,401);
    const after=(await exercise(auth,'GET','/api/auth/session')).res.body;
    assert.equal(after.enrollmentAvailable,false);
    assert.equal(after.setupRequired,false);
    assert.equal((await exercise(auth,'POST','/api/auth/enroll',{body:enrollment})).res.status,409,'code cannot be replayed');
    assert.equal((await login(auth,'firstadmin',ADMIN_PASSWORD)).cookie.startsWith('pfc_session='),true);
    const restarted=new ControllerAuth({dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},
      emitEnrollmentCode:()=>{throw Error('must never offer enrollment after activation');}});
    await restarted.init();
    assert.equal((await exercise(restarted,'GET','/api/auth/session')).res.body.enrollmentAvailable,false);
  });
});

test('GUI enrollment works on HTTP by default; explicit HTTPS-only policy and lost-store recovery fail closed',async()=>{
  await fixture(async dataDir=>{
    let output='';
    const auth=new ControllerAuth({dataDir,env:{},
      emitEnrollmentCode:message=>{output=message;}});
    await auth.init();
    const code=output.match(/One-time enrollment code \(private\): ([0-9A-F]{48})/)?.[1];
    assert.ok(code);
    const payload={code,username:'firstadmin',password:ADMIN_PASSWORD};
    const enroll=await exercise(auth,'POST','/api/auth/enroll',{
      origin:'http://controller.example.test',body:payload
    });
    assert.equal(enroll.res.status,201,enroll.res.body?.error);
    assert.equal(auth.enabled,true);
    assert.equal((await gate(auth,'GET','/api/fleet')).res.status,401);
    assert.match((await exercise(auth,'GET','/api/auth/session')).res.body.transportWarning,/not protected/);
  });
  await fixture(async dataDir=>{
    let output='';
    const httpsOnly=new ControllerAuth({dataDir,env:{PFC_AUTH_ALLOW_HTTP:'0'},
      emitEnrollmentCode:message=>{output=message;}});
    await httpsOnly.init();
    const code=output.match(/One-time enrollment code \(private\): ([0-9A-F]{48})/)?.[1];
    assert.ok(code);
    const denied=await exercise(httpsOnly,'POST','/api/auth/enroll',{
      origin:'http://controller.example.test',body:{code,username:'firstadmin',password:ADMIN_PASSWORD}
    });
    assert.equal(denied.res.status,503);
    assert.equal(httpsOnly.enabled,true);
    assert.equal(httpsOnly.setupRequired,true);
  });
  await fixture(async dataDir=>{
    const fs=await import('node:fs/promises');
    await fs.mkdir(path.join(dataDir,'security'),{recursive:true});
    await fs.writeFile(path.join(dataDir,'security','enabled'),'enabled\n');
    const locked=new ControllerAuth({dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},
      emitEnrollmentCode:()=>{throw Error('must not emit fresh code after activation');}});
    await locked.init();
    const state=(await exercise(locked,'GET','/api/auth/session')).res.body;
    assert.equal(state.setupRequired,true);
    assert.equal(state.enrollmentAvailable,false,'lost account data requires offline recovery');
    assert.equal((await gate(locked,'GET','/')).allowed,true,
      'recovery guidance must still be renderable after account loss');
    assert.equal((await gate(locked,'GET','/auth-gate.js')).allowed,true);
    assert.equal((await gate(locked,'GET','/api/fleet')).res.status,503);
    assert.equal((await exercise(locked,'POST','/api/auth/enroll',{body:{
      code:'not valid',username:'usertest',password:ADMIN_PASSWORD
    }})).res.status,409);
  });
});
