import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountStore} from '../src/security/account-store.js';
import {SessionManager,LoginAttemptLimiter} from '../src/security/session-manager.js';

async function freshStore(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-auth-store-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return {dir,store:new AccountStore({dataDir:dir})};
}

test('admin enrollment requires explicit credentials and creates restricted salted hashes',async t=>{
  const {store}=await freshStore(t);
  assert.equal(await store.initialized(),false);
  assert.deepEqual(await store.listUsers(),[]);
  await assert.rejects(store.bootstrapAdministrator({username:'admin',password:'short'}),/12/);
  const admin=await store.bootstrapAdministrator({
    username:'SiteAdmin',password:'a-long-unique-password-for-testing'
  });
  assert.equal(admin.username,'siteadmin');
  assert.equal(admin.role,'administrator');
  assert.equal(admin.password,undefined);
  assert.equal(await store.initialized(),true);
  const raw=await fs.readFile(store.filePath,'utf8');
  assert.ok(!raw.includes('a-long-unique-password-for-testing'));
  const json=JSON.parse(raw);
  assert.equal(json.version,1);
  assert.equal(json.users[0].password.version,'scrypt-v1');
  assert.equal(json.users[0].password.salt.length,64);
  assert.equal(json.users[0].password.hash.length,64);
  if(process.platform!=='win32'){
    const stat=await fs.stat(store.filePath);
    assert.equal(stat.mode&0o077,0,'no group/other access to credential store');
  }
  await assert.rejects(store.bootstrapAdministrator({username:'different',password:'another-long-test-password'}),{code:'EEXIST'});
  assert.equal((await store.authenticate('SITEADMIN','a-long-unique-password-for-testing')).id,admin.id);
  assert.equal(await store.authenticate('siteadmin','wrong-password-long-enough'),null);
  assert.equal(await store.authenticate('nonexistent','wrong-password-long-enough'),null);
});

test('user additions, roles and disablement persist and protect the last active admin',async t=>{
  const {dir,store}=await freshStore(t);
  const admin=await store.bootstrapAdministrator({username:'owner',password:'correct-password-number-one'});
  const operator=await store.addUser({
    username:'operator',password:'correct-password-number-two',role:'operator'
  });
  assert.equal(operator.role,'operator');
  assert.equal((await store.authenticate('operator','correct-password-number-two')).username,'operator');
  const viewer=await store.addUser({
    username:'viewer',password:'correct-password-number-three',role:'viewer'
  });
  assert.equal(viewer.role,'viewer');
  await assert.rejects(store.addUser({
    username:'operator',password:'correct-password-number-two'
  }),/already exists/);
  await assert.rejects(store.addUser({
    username:'unknown',password:'correct-password-number-four',role:'owner'
  }),/Unknown user role/);
  await assert.rejects(store.updateUser(admin.id,{disabled:true}),/last enabled administrator/);
  await assert.rejects(store.updateUser(admin.id,{role:'viewer'}),/last enabled administrator/);
  const updated=await store.updateUser(operator.id,{disabled:true});
  assert.equal(updated.disabled,true);
  assert.equal(await store.authenticate('operator','correct-password-number-two'),null);
  await store.updateUser(operator.id,{disabled:false,password:'new-correct-password-number-two',role:'administrator'});
  await store.updateUser(admin.id,{role:'viewer'});
  assert.equal((await store.authenticate('operator','new-correct-password-number-two')).role,'administrator');
  assert.equal(await store.authenticate('operator','correct-password-number-two'),null);
  const reloaded=new AccountStore({dataDir:dir});
  assert.equal((await reloaded.listUsers()).length,3);
  assert.equal((await reloaded.authenticate('owner','correct-password-number-one')).role,'viewer');
});

test('account file corruption fails closed and cannot trigger a new admin bootstrap',async t=>{
  const {store}=await freshStore(t);
  await store.bootstrapAdministrator({username:'owner',password:'correct-password-number-one'});
  await fs.writeFile(store.filePath,'corrupt-json');
  await assert.rejects(store.listUsers(),/unreadable/);
  await assert.rejects(store.authenticate('owner','correct-password-number-one'),/unreadable/);
  await assert.rejects(store.bootstrapAdministrator({
    username:'owner',password:'correct-password-number-two'
  }),{code:'EEXIST'});
});

test('random sessions expire, revoke and never store plaintext token keys',()=>{
  let now=10000;
  const manager=new SessionManager({now:()=>now,idleMs:1000,absoluteMs:4000});
  const token=manager.create('user-1');
  assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal(manager.resolve('not-a-token'),null);
  assert.equal(manager.resolve(token).userId,'user-1');
  now+=500;
  assert.equal(manager.resolve(token).userId,'user-1');
  now+=999;
  assert.equal(manager.resolve(token).userId,'user-1');
  now+=1000;
  assert.equal(manager.resolve(token),null,'idle timeout invalidates session');
  const token2=manager.create('user-2');
  assert.equal(manager.resolve(token2).userId,'user-2');
  assert.equal(manager.revokeUser('user-2'),1);
  assert.equal(manager.resolve(token2),null);
  const token3=manager.create('user-3');
  assert.equal(manager.revoke(token3),true);
  assert.equal(manager.resolve(token3),null);
  const token4=manager.create('user-4');
  now+=4000;
  assert.equal(manager.resolve(token4),null,'absolute expiry invalidates session even with accesses');
});

test('login limiter blocks repeated incorrect attempts and clears after cooldown',()=>{
  let now=0;
  const limiter=new LoginAttemptLimiter({now:()=>now,maxFailures:3,windowMs:1000});
  for(let i=0;i<3;i++)limiter.recordFailure('alice','127.0.0.1');
  assert.equal(limiter.canAttempt('alice','127.0.0.1'),false);
  assert.equal(limiter.canAttempt('bob','127.0.0.1'),true);
  assert.equal(limiter.canAttempt('alice','127.0.0.2'),true);
  now+=1001;
  assert.equal(limiter.canAttempt('alice','127.0.0.1'),true);
  limiter.recordFailure('alice','127.0.0.1');
  limiter.recordSuccess('alice','127.0.0.1');
  assert.equal(limiter.canAttempt('alice','127.0.0.1'),true);
});
