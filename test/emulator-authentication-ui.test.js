import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../emulator/public/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('async function controllerSession('),source.indexOf('function endpointLines('));
function simulatorRequest(integrated,session={enabled:true,user:{role:'administrator'},csrf:'current-session-token'}){
  const calls=[];
  const request=vm.runInNewContext(helpers+'\nrequest',{
    integrated,URL,Headers,location:{href:'https://controller.example/simulator/',origin:'https://controller.example'},
    fetch:async(url,options)=>{calls.push({url,options});return Response.json(url==='/api/auth/session'?session:{ok:true});}
  });
  return {request,calls};
}

test('integrated simulator attaches a current CSRF token to every management mutation',async()=>{
  const {request,calls}=simulatorRequest(true);
  for(const method of ['POST','PUT','PATCH','DELETE']){
    await request('/api/emulator/status',{method,headers:new Headers({'x-test':'preserved'}),body:'{}'});
    const sent=calls.at(-1);assert.equal(sent.options.headers.get('x-pfc-csrf'),'current-session-token');
    assert.equal(sent.options.headers.get('x-test'),'preserved');assert.equal(sent.options.credentials,'same-origin');
  }
  assert.equal(calls.filter(call=>call.url==='/api/auth/session').length,4);
  await request('/api/emulator/status');assert.equal(calls.at(-1).options.headers.has('x-pfc-csrf'),false);
  await assert.rejects(request('https://other.example/api/emulator/status',{method:'POST'}),/controller origin/);
});

test('standalone and legacy simulators continue working without native account tokens',async()=>{
  const standalone=simulatorRequest(false);await standalone.request('/api/printers',{method:'POST',body:'{}'});
  assert.equal(standalone.calls.length,1);assert.equal(standalone.calls[0].options.headers.has('x-pfc-csrf'),false);
  const legacy=simulatorRequest(true,{enabled:false,user:null,csrf:null});
  await legacy.request('/api/emulator/status',{method:'POST',body:'{}'});
  assert.equal(legacy.calls.at(-1).options.headers.has('x-pfc-csrf'),false);
});

test('an expired simulator session blocks the mutation before it is submitted',async()=>{
  const {request,calls}=simulatorRequest(true,{enabled:true,user:null,csrf:null});
  await assert.rejects(request('/api/emulator/status',{method:'POST',body:'{}'}),/session has expired/);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/auth/session');
});
