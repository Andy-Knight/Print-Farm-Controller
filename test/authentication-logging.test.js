import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountStore} from '../src/security/account-store.js';
import {ControllerAuth} from '../src/security/http-auth.js';
import {DiagnosticLogger} from '../src/diagnostic-logger.js';
import {SessionManager} from '../src/security/session-manager.js';

const ORIGIN='https://controller.example.test';
const PASSWORD='Synthetic password never logged 2026!';
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-auth-logging-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new AccountStore({dataDir:dir});
  const user=await store.bootstrapAdministrator({username:'owner',password:PASSWORD});
  return {dir,store,user};
}
async function request(auth,{path='/api/auth/login',method='POST',body={username:'owner',password:PASSWORD},
  origin=ORIGIN,cookie='',csrf='',readJson=async()=>body}={}){
  const req={method,socket:{remoteAddress:'127.0.0.1'},headers:{host:'controller.example.test',origin,
    cookie,'x-pfc-csrf':csrf,'x-forwarded-for':'192.0.2.99','authorization':'DO_NOT_LOG_AUTH_HEADER'}};
  const res={headers:{},setHeader(name,value){this.headers[name]=value;}};
  const routed=await auth.route(req,res,new URL(path,ORIGIN),{
    json:(_res,status,data)=>{res.status=status;res.body=data;},readJson
  });
  assert.equal(routed,true);return res;
}

test('persistent authentication events record outcomes and peer identity without credentials or tokens',async t=>{
  const {dir,store,user}=await fixture(t);
  const disabled=await store.addUser({username:'disableduser',password:PASSWORD});
  await store.updateUser(disabled.id,{disabled:true});
  const logger=new DiagnosticLogger({logDir:path.join(dir,'logs'),version:'test'});
  await logger.init();
  const auth=new ControllerAuth({dataDir:dir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},
    diagnosticFn:(level,message,meta)=>logger[level]('authentication',message,meta)});
  await auth.init();
  for(const username of ['owner','unknownuser','disableduser']){
    const result=await request(auth,{body:{username,password:'Wrong password not logged'}});
    assert.equal(result.status,401);assert.equal(result.body.error,'Invalid username or password');
  }
  const session=await request(auth,{body:{username:' OWNER ',password:PASSWORD}});
  assert.equal(session.status,200);
  const cookie=session.headers['set-cookie'].split(';')[0],csrf=session.body.csrf;
  await request(auth,{method:'GET',path:'/api/auth/session',cookie});
  const rejected=await request(auth,{path:'/api/auth/logout',cookie,csrf:'BAD_CSRF_NOT_LOGGED'});
  assert.equal(rejected.status,403);
  assert.equal((await request(auth,{path:'/api/auth/logout',cookie,csrf})).status,200);
  assert.equal((await request(auth,{path:'/api/auth/logout',cookie,csrf})).status,401);
  for(let i=0;i<5;i++)assert.equal((await request(auth,{body:{username:'rate-target',password:'wrong'}})).status,401);
  assert.equal((await request(auth,{body:{username:'rate-target',password:'wrong'}})).status,429);
  const entries=(await logger.recent({limit:100})).filter(e=>e.subsystem==='authentication');
  assert.equal(entries.length,13,'passive session polling does not produce an event');
  const login=entries.find(e=>e.meta.event==='login'&&e.meta.outcome==='success');
  assert.equal(login.level,'INFO');
  assert.deepEqual(login.meta,{event:'login',outcome:'success',reason:'authenticated',statusCode:200,
    username:'owner',userId:user.id,role:'administrator',sourceAddress:'127.0.0.1'});
  assert.ok(entries.some(e=>e.level==='INFO'&&e.meta.event==='logout'&&e.meta.outcome==='success'));
  assert.ok(entries.some(e=>e.level==='WARN'&&e.meta.outcome==='throttled'&&e.meta.statusCode===429));
  for(const entry of entries){
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
    if(entry.meta.reason==='invalid_credentials'){
      assert.equal(entry.meta.userId,null);assert.equal(entry.meta.role,null);
    }
  }
  const persisted=await fs.readFile(path.join(dir,'logs','controller.log'),'utf8');
  const bundle=(await logger.createBundle()).toString('utf8');
  for(const secret of [PASSWORD,'Wrong password not logged',cookie.split('=')[1],csrf,'BAD_CSRF_NOT_LOGGED','DO_NOT_LOG_AUTH_HEADER','192.0.2.99']){
    assert.ok(!persisted.includes(secret));assert.ok(!bundle.includes(secret));
  }
});

test('login policy rejections omit unparsed bodies and bound attempted usernames',async t=>{
  const {dir}=await fixture(t),events=[];
  const diagnosticFn=(level,message,meta)=>events.push({level,message,meta});
  const auth=new ControllerAuth({dataDir:dir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},diagnosticFn});
  await auth.init();
  const unexpectedRead=()=>{throw new Error('request body must not be read');};
  assert.equal((await request(auth,{origin:'https://other.invalid',readJson:unexpectedRead})).status,403);
  const insecure=new ControllerAuth({dataDir:dir,env:{},diagnosticFn});await insecure.init();
  assert.equal((await request(insecure,{origin:'http://controller.example.test',readJson:unexpectedRead})).status,503);
  assert.equal((await request(auth,{body:{username:'owner',password:PASSWORD,unexpected:'SECRET_EXTRA_FIELD'}})).status,400);
  assert.equal((await request(auth,{body:{username:'\n'+('x'.repeat(300)),password:'wrong'}})).status,401);
  assert.deepEqual(events.slice(0,3).map(e=>e.meta.reason),['origin_rejected','insecure_transport','invalid_request']);
  for(const event of events.slice(0,3))assert.equal(event.meta.username,null);
  assert.ok(events[3].meta.username.length<=100);
  assert.doesNotMatch(events[3].meta.username,/[\x00-\x1f\x7f]/);
  assert.ok(!JSON.stringify(events).includes('SECRET_EXTRA_FIELD'));
});

test('logging failures do not prevent login, rejected credentials or logout',async t=>{
  const {dir}=await fixture(t);
  const auth=new ControllerAuth({dataDir:dir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},diagnosticFn:async()=>{throw new Error('log disk unavailable');}});
  await auth.init();
  assert.equal((await request(auth,{body:{username:'owner',password:'wrong'}})).status,401);
  const session=await request(auth);assert.equal(session.status,200);
  const cookie=session.headers['set-cookie'].split(';')[0];
  assert.equal((await request(auth,{path:'/api/auth/logout',cookie,csrf:session.body.csrf})).status,200);
  assert.equal((await request(auth,{path:'/api/auth/logout',cookie,csrf:session.body.csrf})).status,401);
});

test('disabled and setup-required authentication records rejections without exposing enrollment codes',async t=>{
  const {dir}=await fixture(t),events=[],startup=[];
  const dataDir=path.join(dir,'fresh-controller');
  const options={dataDir,diagnosticFn:(level,message,meta)=>events.push({level,message,meta}),
    emitEnrollmentCode:message=>startup.push(message)};
  const legacy=new ControllerAuth({...options,env:{PFC_AUTH_REQUIRED:'0'}});await legacy.init();
  assert.equal(events.length,0,'emitting an enrollment code does not log it');
  for(const path of ['/api/auth/login','/api/auth/logout'])
    assert.equal((await request(legacy,{path})).status,404);
  const setup=new ControllerAuth({...options,env:{PFC_PUBLIC_ORIGIN:ORIGIN}});await setup.init();
  for(const path of ['/api/auth/login','/api/auth/logout'])
    assert.equal((await request(setup,{path})).status,503);
  assert.deepEqual(events.map(e=>e.meta.reason),['authentication_disabled','authentication_disabled','setup_required','setup_required']);
  for(const message of startup){
    const code=message.match(/One-time enrollment code \(private\): ([0-9A-F]{48})/)[1];
    assert.ok(!JSON.stringify(events).includes(code));
  }
});

test('logging is bounded during a rejection flood and reports suppressed events when it drains',async t=>{
  const {dir}=await fixture(t),events=[];
  let release;const blocked=new Promise(resolve=>{release=resolve;});
  const auth=new ControllerAuth({dataDir:dir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},
    diagnosticFn:(level,message,meta)=>{events.push({level,message,meta});return blocked;}});
  await auth.init();
  const attempts=Array.from({length:70},()=>request(auth,{origin:'https://other.invalid'}));
  try{assert.equal(events.length,32);}finally{release();}
  for(const result of await Promise.all(attempts))assert.equal(result.status,403);
  assert.deepEqual(events.at(-1).meta,{event:'authentication_log_overflow',outcome:'suppressed',count:38});
});

test('shared authentication admission rejection produces a throttled login event',async t=>{
  const {dir}=await fixture(t),events=[];
  const auth=new ControllerAuth({dataDir:dir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},
    diagnosticFn:(level,message,meta)=>events.push({level,message,meta})});
  await auth.init();
  const original=AccountStore.prototype.authenticate;
  let release,calls=0;const blocked=new Promise(resolve=>{release=resolve;});
  AccountStore.prototype.authenticate=()=>{calls++;return blocked;};
  try{
    const first=request(auth);
    while(!calls)await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await request(auth)).status,429);
    assert.equal(events.at(-1).meta.outcome,'throttled');
    assert.equal(events.at(-1).meta.reason,'rate_limited');
    release(null);assert.equal((await first).status,401);
  }finally{release?.(null);AccountStore.prototype.authenticate=original;}
});

test('session capacity rejection retains verified identity and unexpected login errors omit exception details',async t=>{
  const {dir,user}=await fixture(t),events=[];
  const auth=new ControllerAuth({dataDir:dir,env:{PFC_PUBLIC_ORIGIN:ORIGIN},
    diagnosticFn:(level,message,meta)=>events.push({level,message,meta})});
  await auth.init();
  const create=SessionManager.prototype.create;
  SessionManager.prototype.create=()=>{throw Object.assign(new Error('Session capacity reached'),{statusCode:429});};
  try{
    assert.equal((await request(auth)).status,429);
    assert.equal(events.at(-1).meta.reason,'session_limit');
    assert.equal(events.at(-1).meta.userId,user.id);
  }finally{SessionManager.prototype.create=create;}
  const authenticate=AccountStore.prototype.authenticate;
  AccountStore.prototype.authenticate=()=>{throw new Error('SECRET_EXCEPTION_DETAIL');};
  try{
    await assert.rejects(request(auth),/SECRET_EXCEPTION_DETAIL/);
    assert.equal(events.at(-1).level,'error');
    assert.equal(events.at(-1).meta.outcome,'error');
    assert.equal(events.at(-1).meta.reason,'authentication_error');
    assert.ok(!JSON.stringify(events).includes('SECRET_EXCEPTION_DETAIL'));
  }finally{AccountStore.prototype.authenticate=authenticate;}
});
