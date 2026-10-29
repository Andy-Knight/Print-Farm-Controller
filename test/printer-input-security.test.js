import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {fetchPrinterResponse,readPrinterBytes} from '../src/security/printer-http.js';
import {moonrakerRequest} from '../src/moonraker-api.js';
import {bambuMqttInternals} from '../src/bambu-mqtt.js';
import {bambuFtpsInternals} from '../src/bambu-ftps.js';
import {MoonrakerWebSocket} from '../src/moonraker-websocket.js';
import {CameraManager} from '../src/camera-manager.js';
import {listAllFilesTcp} from '../src/tcp-files.js';

async function listen(t,handler){
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return server.address().port;
}

test('printer redirects never forward API headers or POST credentials',async t=>{
  let received=0;
  const target=await listen(t,(req,res)=>{received++;res.end('{}');});
  for(const status of [301,302,303,307,308]){
    const port=await listen(t,(req,res)=>{res.writeHead(status,{location:`http://127.0.0.1:${target}/capture`});res.end();});
    await assert.rejects(moonrakerRequest({host:'127.0.0.1',httpPort:port,adapterConfig:{apiKey:'private-test-key'}},'/printer/info'));
    await assert.rejects(fetchPrinterResponse(`http://127.0.0.1:${port}/command`,{method:'POST',body:JSON.stringify({checkCode:'private-test-code'})}));
  }
  assert.equal(received,0);
});

test('printer bodies enforce declared and streamed limits, cancel input and have an absolute deadline',async()=>{
  for(const headers of [{},{'content-length':'100'}]){
    let cancelled=false;
    const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9));},cancel(){cancelled=true;}}),{headers});
    await assert.rejects(readPrinterBytes(response,{maxBytes:8}),/size limit/);
    assert.equal(cancelled,true);
  }
  let cancelled=false;
  await assert.rejects(readPrinterBytes(new Response(new ReadableStream({cancel(){cancelled=true;}})),{timeoutMs:20}),/timed out/);
  assert.equal(cancelled,true);
  assert.equal((await readPrinterBytes(new Response('12345678'),{maxBytes:8})).toString(),'12345678');
});

test('oversized MQTT and WebSocket lengths fail before receiving the payload',()=>{
  const state={buffer:Buffer.alloc(0)};
  const header=Buffer.concat([Buffer.from([0x30]),bambuMqttInternals.mqttLength(8*1024*1024+1)]);
  assert.throws(()=>bambuMqttInternals.takePackets(state,header),/size limit/);
  assert.throws(()=>bambuMqttInternals.takePackets({buffer:Buffer.alloc(8*1024*1024)},Buffer.alloc(6)),/size limit/);
  const fragmented={buffer:Buffer.alloc(0)};
  assert.deepEqual(bambuMqttInternals.takePackets(fragmented,Buffer.from([0x30,2,1])),[]);
  assert.equal(bambuMqttInternals.takePackets(fragmented,Buffer.from([2]))[0].payload.length,2);
  const ws=new MoonrakerWebSocket('ws://127.0.0.1/');
  const frame=Buffer.alloc(10);frame[0]=0x81;frame[1]=127;frame.writeBigUInt64BE(BigInt(4*1024*1024+1),2);
  ws.onData(frame);
  assert.equal(ws.closed,true);assert.equal(ws.buffer.length,0);
});

test('an incomplete oversized JPEG is discarded and its upstream is closed',()=>{
  const manager=new CameraManager();
  let destroyed=false;
  const stream={frameBuffer:Buffer.concat([Buffer.from([255,216]),Buffer.alloc(4*1024*1024-2)]),subscribers:new Set(),response:{destroy(){destroyed=true;}},request:null};
  manager.captureFrames('malicious',stream,Buffer.alloc(1));
  assert.equal(stream.frameBuffer.length,0);assert.equal(destroyed,true);
  assert.match(manager.getHealth('malicious').lastError,/size limit/);
});

test('FTPS listings reject oversized or stalled data without retrying another listing',async()=>{
  for(const oversized of [true,false]){
    const client=new bambuFtpsInternals.ImplicitFtpsClient({host:'127.0.0.1',checkCode:'test'},{timeoutMs:20});
    let transfers=0;
    client.transfer=async(command,writer)=>{
      transfers++;
      const socket=new EventEmitter();
      socket.destroy=error=>{socket.emit('error',error);socket.emit('close');};
      const pending=writer(socket);
      if(oversized)socket.emit('data',Buffer.alloc(8*1024*1024+1));
      return pending;
    };
    await assert.rejects(client.list(),oversized?/size limit/:/timed out/);
    assert.equal(transfers,1);
  }
});

test('FTPS control fragments, multiline replies and pending reply queues are bounded',()=>{
  for(const mode of ['fragment','multiline','queue']){
    const client=new bambuFtpsInternals.ImplicitFtpsClient({host:'127.0.0.1',checkCode:'test'});
    let error;
    client.socket={destroy(e){error=e;}};
    if(mode==='fragment')client.acceptControlData('x'.repeat(65537));
    if(mode==='multiline'){
      client.acceptControlData('220-start\r\n');
      while(!error)client.acceptControlData('x'.repeat(60000)+'\r\n');
      assert.equal(client.multilineLines.length,0);
    }
    if(mode==='queue')for(let i=0;i<17;i++)client.acceptControlData('200 reply\r\n');
    assert.match(error.message,/limit/);
    assert.ok(client.buffer.length<=65536);assert.ok(client.responses.length<=16);
  }
});

test('TCP file listings disconnect when the printer sends excessive input',async t=>{
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.on('data',data=>{
      if(data.toString().includes('M601'))socket.write('Control Success\nok\n');
      if(data.toString().includes('M661'))socket.write(Buffer.alloc(8*1024*1024+1,65));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);}));
  await assert.rejects(listAllFilesTcp({host:'127.0.0.1',tcpPort:server.address().port},{settleMs:1000,commandTimeoutMs:5000}),/size limit/);
});
