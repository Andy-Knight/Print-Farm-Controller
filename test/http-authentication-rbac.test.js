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

test('opt-in and durable enrollment marker: setup gates commands, liveness still responds',async()=>{
  await fixture(async dataDir=>{
    const legacy=new ControllerAuth({dataDir,env:{}});
    await legacy.init();
    assert.equal((await exercise(legacy,'GET','/api/auth/session')).res.body.enabled,false);
    assert.equal((await gate(legacy,'POST','/api/batch')).allowed,true,'legacy mode intentionally unchanged');
    const locked=new ControllerAuth({dataDir,env:{PFC_AUTH_REQUIRED:'1'}});
    await locked.init();
    const state=(await exercise(locked,'GET','/api/auth/session')).res.body;
    assert.equal(state.setupRequired,true);
    const fleet=await gate(locked,'GET','/api/fleet');
    assert.equal(fleet.allowed,false);
    assert.equal(fleet.res.status,503);
    assert.equal((await gate(locked,'GET','/api/health')).allowed,true);
    await new AccountStore({dataDir}).bootstrapAdministrator({username:'owner',password:ADMIN_PASSWORD});
    const automatic=new ControllerAuth({dataDir,env:{PFC_PUBLIC_ORIGIN:ORIGIN}});
    await automatic.init();
    assert.equal(automatic.enabled,true,'marker permanently enables auth after CLI enrollment');
    assert.equal(automatic.setupRequired,false);
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

test('HTTP login is rejected by default; invalid logins use generic errors and throttle',async()=>{
  await fixture(async dataDir=>{
    const store=new AccountStore({dataDir});
    await store.bootstrapAdministrator({username:'owner',password:ADMIN_PASSWORD});
    const insecure=new ControllerAuth({dataDir,env:{}});
    await insecure.init();
    const noTls=await exercise(insecure,'POST','/api/auth/login',{
      origin:'http://controller.example.test',body:{username:'owner',password:ADMIN_PASSWORD}
    });
    assert.equal(noTls.res.status,503);
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
