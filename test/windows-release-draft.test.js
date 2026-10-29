import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareWindowsReleaseBundle,installerName} from '../scripts/windows-release-bundle.mjs';
import {createWindowsReleaseDraft,releaseNotes} from '../scripts/draft-windows-release.mjs';

const sha='a'.repeat(40),version='1.2.3';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-windows-release-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'dist','installer'),{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version}));
  await fs.writeFile(path.join(root,'CHANGELOG.md'),'# Changelog\n\n## v1.2.3\n\n- Current fix.\n\n## v1.2.2\n\n- Previous fix.\n');
  const executable=Buffer.alloc(2048);executable.write('MZ');
  await fs.writeFile(path.join(root,'dist','installer',installerName(version)),executable);
  const metadata=await prepareWindowsReleaseBundle({root,sha});
  const env={GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',GITHUB_SHA:sha,GITHUB_REPOSITORY:'test/repository',GH_TOKEN:'synthetic-token'};
  return {root,env,metadata};
}
function api({release=null,tag=null,failStatus=null,badDigest=false}={}){
  const requests=[],assets=[],published={id:123,draft:true,target_commitish:sha,html_url:'https://github.com/test/repository/releases/tag/v1.2.3',assets};
  async function fetchFn(url,options){
    requests.push({url,method:options.method,data:typeof options.body==='string'?JSON.parse(options.body):null});
    assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    if(failStatus)return Response.json({error:'synthetic'},{status:failStatus});
    if(url.includes('/releases/tags/'))return Response.json(release&&!release.draft?release:{},{status:release&&!release.draft?200:404});
    if(url.includes('/releases?'))return Response.json(release?[release]:[]);
    if(url.includes('/git/ref/'))return Response.json(tag||{},{status:tag?200:404});
    if(url.endsWith('/releases')&&options.method==='POST'){Object.assign(published,JSON.parse(options.body));return Response.json(published);}
    if(url.startsWith('https://uploads.github.com/')){
      const chunks=[];for await(const chunk of options.body)chunks.push(chunk);
      const data=Buffer.concat(chunks),name=new URL(url).searchParams.get('name');
      const asset={name,state:'uploaded',size:data.length,digest:'sha256:'+(badDigest?'0'.repeat(64):createHash('sha256').update(data).digest('hex'))};
      assets.push(asset);return Response.json(asset);
    }
    throw new Error('Unexpected request: '+url);
  }
  return {fetchFn,requests,assets,published};
}

test('new version creates an unpublished draft at the exact validated SHA and verifies all uploads',async t=>{
  const f=await fixture(t),mock=api();
  const result=await createWindowsReleaseDraft({...f,fetchFn:mock.fetchFn,log:()=>{}});
  assert.equal(result.skipped,false);assert.equal(mock.published.draft,true);
  assert.equal(mock.published.target_commitish,sha);assert.equal(mock.published.tag_name,'v'+version);
  assert.match(mock.published.body,/Current fix/);assert.doesNotMatch(mock.published.body,/Previous fix/);
  assert.match(mock.published.body,/unsigned/);
  assert.deepEqual(mock.assets.map(asset=>asset.name),[installerName(version),'SHA256SUMS.txt','release-metadata.json']);
  assert.ok(mock.requests.every(request=>!['DELETE','PATCH','PUT'].includes(request.method)),'never publish, replace assets or move tags');
});

test('draft and published releases remain unchanged on repeat runs',async t=>{
  const f=await fixture(t);
  for(const draft of [true,false]){
    const release={id:123,draft,tag_name:'v'+version,assets:[installerName(version),'SHA256SUMS.txt','release-metadata.json'].map(name=>({name,state:'uploaded'}))};
    const mock=api({release});const result=await createWindowsReleaseDraft({...f,fetchFn:mock.fetchFn,log:()=>{}});
    assert.equal(result.skipped,true);assert.equal(mock.requests.filter(request=>request.method!=='GET').length,0);
  }
});

test('partial draft resumes only the same artifact and never replaces a matching existing installer',async t=>{
  const f=await fixture(t),name=installerName(version);
  const release={id:123,tag_name:'v'+version,draft:true,target_commitish:sha,
    body:releaseNotes(await fs.readFile(path.join(f.root,'CHANGELOG.md'),'utf8'),version,sha,f.metadata.installer.sha256),
    assets:[{name,state:'uploaded',size:2048,digest:'sha256:'+f.metadata.installer.sha256}]};
  const mock=api({release});await createWindowsReleaseDraft({...f,fetchFn:mock.fetchFn,log:()=>{}});
  assert.deepEqual(mock.assets.map(asset=>asset.name),['SHA256SUMS.txt','release-metadata.json']);
  release.body='another build';const different=api({release});
  await assert.rejects(createWindowsReleaseDraft({...f,fetchFn:different.fetchFn}),/different source\/build/);
  assert.equal(different.requests.filter(request=>request.method!=='GET').length,0);
});

test('mismatched tags, foreign artifacts, network errors and upload corruption cannot publish a release',async t=>{
  const f=await fixture(t);
  const conflict=api({tag:{object:{type:'commit',sha:'b'.repeat(40)}}});
  await assert.rejects(createWindowsReleaseDraft({...f,fetchFn:conflict.fetchFn}),/tag does not identify/);
  const unavailable=api({failStatus:403});await assert.rejects(createWindowsReleaseDraft({...f,fetchFn:unavailable.fetchFn}),/failed \(403\)/);
  const corrupt=api({badDigest:true});await assert.rejects(createWindowsReleaseDraft({...f,fetchFn:corrupt.fetchFn}),/verification failed/);
  assert.equal(corrupt.published.draft,true);
  const foreign={...f,env:{...f.env,GITHUB_SHA:'b'.repeat(40)}};
  await assert.rejects(createWindowsReleaseDraft({...foreign,fetchFn:()=>assert.fail('no network for foreign artifacts')}),/does not match/);
});

test('PR, tag and feature dispatch contexts cannot use the release writer',async t=>{
  const f=await fixture(t);
  for(const override of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/tags/v1.2.3'},
    {GITHUB_REF:'refs/heads/codex/feature',GITHUB_EVENT_NAME:'workflow_dispatch'}]){
    await assert.rejects(createWindowsReleaseDraft({...f,env:{...f.env,...override},fetchFn:()=>assert.fail('no network')}),/only be created from main/);
  }
});

test('tampered checksums and missing changelog notes fail before any GitHub write',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.root,'dist','installer','SHA256SUMS.txt'),'tampered');
  await assert.rejects(createWindowsReleaseDraft({...f,fetchFn:()=>assert.fail('no network')}),/checksum/);
  assert.throws(()=>releaseNotes('## v1.2.2\n\n- Old','1.2.3',sha,'checksum'),/newest changelog/);
});
