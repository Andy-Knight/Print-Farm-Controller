import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedCloudUrl,fetchMicrosoftDownload} from '../src/security/cloud-http.js';
import {OneDriveClient} from '../src/backup-recovery/one-drive-client.js';
import {GoogleDriveClient} from '../src/backup-recovery/google-drive-client.js';

test('cloud API pagination and upload destinations reject other origins before fetching a token',async()=>{
  for(const Client of [OneDriveClient,GoogleDriveClient]){
    let tokenReads=0;
    const context={getAccessToken(){tokenReads++;throw new Error('must not run');}};
    for(const url of ['http://www.googleapis.com/path','https://evil.example/page','https://graph.microsoft.com.evil.example/page','https://user:secret@graph.microsoft.com/path'])
      await assert.rejects(Client.prototype.authorizedFetch.call(context,url));
    assert.equal(tokenReads,0);
  }
  for(const value of ['http://test.up.1drv.com/a','https://test.up.1drv.com:444/a','https://1drv.com.evil.example/a','https://127.0.0.1/a'])
    assert.throws(()=>trustedCloudUrl(value,{domains:['1drv.com','sharepoint.com']}));
});

test('OneDrive content redirects strip bearer credentials and validate each provider destination',async()=>{
  const calls=[];
  const context={getAccessToken:async()=>'synthetic-secret',fetchFn:async(url,options)=>{
    calls.push({url,options});
    if(url.startsWith('https://graph.microsoft.com/'))return new Response(null,{status:302,headers:{location:'https://tenant.sharepoint.com/download'}});
    return new Response('backup');
  }};
  assert.equal(await (await OneDriveClient.prototype.authorizedFetch.call(context,'https://graph.microsoft.com/v1.0/me/drive/items/id/content')).text(),'backup');
  assert.equal(calls.length,2);
  assert.equal(calls[0].options.headers.get('authorization'),'Bearer synthetic-secret');
  assert.deepEqual(calls[1].options,{redirect:'manual'});
  await assert.rejects(fetchMicrosoftDownload(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/steal'}}),'https://tenant.sharepoint.com/download'),/approved/);
  let redirects=0;
  await assert.rejects(fetchMicrosoftDownload(async()=>{redirects++;return new Response(null,{status:302,headers:{location:'/again'}});},'https://test.up.1drv.com/download'),/limit/);
  assert.equal(redirects,4);
});

test('OneDrive non-content redirects cannot replay a mutation body',async()=>{
  let calls=0;
  const context={getAccessToken:async()=>'synthetic-secret',fetchFn:async()=>{calls++;return new Response(null,{status:307,headers:{location:'https://tenant.sharepoint.com/capture'}});}};
  await assert.rejects(OneDriveClient.prototype.authorizedFetch.call(context,'https://graph.microsoft.com/v1.0/me/drive/root',{method:'POST',body:'private data'}),/redirect/);
  assert.equal(calls,1);
});
