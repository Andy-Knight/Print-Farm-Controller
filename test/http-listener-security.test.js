import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {guardedHttpListener} from '../src/security/http-listener.js';

test('listener catches invalid authority, synchronous errors and rejected async handlers without exiting',async()=>{
  const server=http.createServer(guardedHttpListener(async(req,res)=>{
    new URL(req.url,'http://'+req.headers.host);
    if(req.url==='/reject')throw new Error('private error details');
    res.end('healthy');
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const request=(path,host)=>new Promise((resolve,reject)=>{
    http.get({host:'127.0.0.1',port:server.address().port,path,headers:{host}},res=>{
      let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));
    }).on('error',reject);
  });
  try {
    assert.equal((await request('/','[')).status,400);
    assert.deepEqual(await request('/reject','localhost'),{status:400,body:'Invalid request'});
    assert.deepEqual(await request('/','localhost'),{status:200,body:'healthy'});
  } finally {await new Promise(resolve=>server.close(resolve));}
});
