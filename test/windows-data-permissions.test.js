import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {secureWindowsDataDirectories} from '../src/security/windows-data-permissions.js';
import {AccountStore} from '../src/security/account-store.js';

const windows={skip:process.platform!=='win32',timeout:30000};
const psHome=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0');
function powershell(script,input={}) {
  script='[Console]::InputEncoding=New-Object Text.UTF8Encoding($false);[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);\n'+script;
  return new Promise((resolve,reject)=>{
    const child=execFile(path.join(psHome,'powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,timeout:20000,env:{...process.env,PSModulePath:path.join(psHome,'Modules')}},(error,stdout,stderr)=>error?reject(new Error(stderr)):resolve(JSON.parse(stdout)));
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-windows-acl-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}
async function acl(file){
  return powershell(`$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
    $a=Get-Acl -LiteralPath $r.file
    @{owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;protected=$a.AreAccessRulesProtected;
      current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
      admin=(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
      rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object {
        @{sid=$_.IdentityReference.Value;type=$_.AccessControlType.ToString();rights=[int]$_.FileSystemRights}
      })}|ConvertTo-Json -Depth 5 -Compress`,{file});
}
function assertPrivate(value,{protectedAcl=true}={}){
  const allowed=[...new Set([value.current,'S-1-5-18','S-1-5-32-544'])].sort();
  // New files from an elevated token may have Administrators as their default
  // owner. Their inherited DACL must still grant access to exactly these SIDs.
  const owners=!protectedAcl&&value.admin?[value.current,'S-1-5-32-544']:[value.current];
  assert.ok(owners.includes(value.owner),`Unexpected Windows owner: ${value.owner}`);
  if(protectedAcl)assert.equal(value.protected,true);
  assert.deepEqual(value.rules.map(rule=>rule.sid).sort(),allowed);
  for(const rule of value.rules){assert.equal(rule.type,'Allow');assert.equal(rule.rights&2032127,2032127);}
}

test('Windows migration removes inherited and explicit broad grants from existing data and logs',windows,async t=>{
  const root=await fixture(t),dataDir=path.join(root,'données-打印'),logDir=path.join(root,'logs');
  const secret=path.join(dataDir,'security','users.json');
  await fs.mkdir(path.dirname(secret),{recursive:true});await fs.mkdir(logDir);
  await fs.writeFile(secret,'synthetic existing account');
  await powershell(`$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
    foreach($p in @($r.dataDir,$r.secret)){
      $a=Get-Acl -LiteralPath $p
      $world=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
      $rule=New-Object Security.AccessControl.FileSystemAccessRule($world,'Modify','Allow')
      $a.AddAccessRule($rule);Set-Acl -LiteralPath $p -AclObject $a
    };'true'`,{dataDir,secret});
  await secureWindowsDataDirectories({dataDir,logDir});
  for(const file of [dataDir,logDir,path.dirname(secret),secret])assertPrivate(await acl(file));
  assert.equal(await fs.readFile(secret,'utf8'),'synthetic existing account');
  const temp=path.join(dataDir,'next.tmp'),target=path.join(dataDir,'state.json');
  await fs.writeFile(temp,'new state');await fs.rename(temp,target);
  assertPrivate(await acl(target),{protectedAcl:false});
  await secureWindowsDataDirectories({dataDir,logDir,force:true});
  assertPrivate(await acl(target));
});

test('Windows account creation and atomic account updates inherit private access',windows,async t=>{
  const root=await fixture(t);
  const store=new AccountStore({dataDir:path.join(root,'data')});
  await store.bootstrapAdministrator({username:'owner',password:'Synthetic owner password 2026!'});
  const [user]=await store.listUsers();
  await store.updateUser(user.id,{displayName:'Changed'});
  assertPrivate(await acl(store.filePath),{protectedAcl:false});
  assert.equal((await store.listUsers())[0].displayName,'Changed');
});

test('Windows ACL protection rejects linked storage without changing the outside target',windows,async t=>{
  for(const type of ['root-junction','child-junction','hardlink']){
    const root=await fixture(t),outside=path.join(root,'outside'),dataDir=path.join(root,'data');
    await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret'),'outside fixture');
    if(type==='root-junction')await fs.symlink(outside,dataDir,'junction');
    else{
      await fs.mkdir(dataDir);
      if(type==='child-junction')await fs.symlink(outside,path.join(dataDir,'link'),'junction');
      else await fs.link(path.join(outside,'secret'),path.join(dataDir,'linked-file'));
    }
    const before=await acl(path.join(outside,'secret'));
    await assert.rejects(secureWindowsDataDirectories({dataDir}),/linked|reparse/i);
    assert.deepEqual(await acl(path.join(outside,'secret')),before);
    assert.equal(await fs.readFile(path.join(outside,'secret'),'utf8'),'outside fixture');
  }
});

test('Windows protection refuses an application root and remote shares before reading credentials',windows,async()=>{
  const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
  await assert.rejects(secureWindowsDataDirectories({dataDir:sourceRoot}),/root\/ancestor/);
  await assert.rejects(secureWindowsDataDirectories({dataDir:'\\\\invalid-host\\share\\data'}),/dedicated local/);
});

test('elevated installer repair selects a single owner, repairs legacy files and rejects group owners',windows,async t=>{
  const identity=await powershell(`$i=[Security.Principal.WindowsIdentity]::GetCurrent()
    @{sid=$i.User.Value;admin=(New-Object Security.Principal.WindowsPrincipal($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}|ConvertTo-Json -Compress`);
  if(!identity.admin){
    assert.ok(!process.env.GITHUB_ACTIONS,'Windows CI must validate elevated installer owner reassignment');
    t.skip('Installer owner reassignment requires an elevated Windows validation runner');return;
  }
  const root=await fixture(t),dataDir=path.join(root,'data'),logDir=path.join(root,'logs');
  const record=path.join(root,'controller-owner.sid');
  const helper=fileURLToPath(new URL('../src/security/windows-data-permissions.ps1',import.meta.url));
  await fs.mkdir(dataDir);await fs.writeFile(path.join(dataDir,'existing.json'),'synthetic state');
  const invoke=account=>powershell(`$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
    & $r.helper -Repair -DataDir $r.dataDir -LogDir $r.logDir -ApplicationDir $r.root -OwnerRecord $r.record -Account $r.account`,
    {helper,dataDir,logDir,root,record,account});
  await assert.rejects(invoke('S-1-5-32-545'),/individual Windows user/);
  assert.equal((await invoke('S-1-5-18')).ownerSid,'S-1-5-18');
  assert.equal(await fs.readFile(record,'utf8'),'S-1-5-18');
  assert.equal((await acl(path.join(dataDir,'existing.json'))).owner,'S-1-5-18');
  await assert.rejects(powershell(`$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
    & $r.helper -DataDir $r.dataDir -LogDir $r.logDir -ApplicationDir $r.root -OwnerRecord $r.record`,
    {helper,dataDir,logDir,root,record}),/owning Windows account/);
  assert.equal((await invoke(identity.sid)).ownerSid,identity.sid);
  assertPrivate(await acl(path.join(dataDir,'existing.json')));
  assert.equal(await fs.readFile(path.join(dataDir,'existing.json'),'utf8'),'synthetic state');
});
