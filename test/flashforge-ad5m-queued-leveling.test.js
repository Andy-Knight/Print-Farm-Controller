import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PrintQueueService } from '../src/print-queue.js';
import { getPrinterAdapter } from '../src/adapters/adapter-registry.js';

async function awaitCondition(predicate, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for the queued FlashForge print request');
}

test('queued AD5M Pro start passes the checked bed-levelling option to firmware /printGcode', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      method:req.method,
      path:req.url,
      body:JSON.parse(Buffer.concat(chunks).toString('utf8'))
    });
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ code:0, message:'Success' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const printer = {
    id:'ad5mpro-test', adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro',
    name:'AD5M Pro', host:'127.0.0.1', httpPort:server.address().port,
    serialNumber:'TEST-SERIAL', checkCode:'TEST-CODE'
  };
  const idleStatus = { status:'idle', fileName:null, progress:0 };
  const adapter = getPrinterAdapter(printer);
  adapter.getStatus = async () => idleStatus; // Keep the queue preflight local; use the real HTTP print implementation.
  const fleetState = {
    subscribe(callback) { callback(this.getFleet()); return () => {}; },
    getFleet() { return [{ id:printer.id, name:printer.name, online:true, status:idleStatus }]; },
    getPrinterState(id) { return id === printer.id ? this.getFleet()[0] : null; },
    async refreshNow() {}
  };
  let storedJobs = [];
  const queue = new PrintQueueService({
    fleetState,
    chamberPreheat:{ isActive:() => false, stop:async () => {} },
    getPrinterFn:async (id) => id === printer.id ? printer : null,
    adapterResolver:() => adapter,
    loadJobsFn:async () => structuredClone(storedJobs),
    saveJobsFn:async (jobs) => { storedJobs = structuredClone(jobs); },
    getFileMaterialMetadataFn:async () => null,
    buildMaterialCostSnapshotFn:null
  });

  try {
    assert.equal(adapter.capabilities.bedLeveling, true);
    assert.equal(adapter.capabilities.levelBeforePrint, true);
    await queue.start();
    for (const { description, options, enabled } of [
      { description:'checked', options:{ levelingBeforePrint:true }, enabled:true },
      { description:'unchecked', options:{ levelingBeforePrint:false }, enabled:false },
      { description:'default', options:{}, enabled:true }
    ]) {
      const index = requests.length;
      const job = await queue.add({
        printerId:printer.id,
        fileName:`queue-${description}.gcode`,
        options
      });
      await awaitCondition(() => requests.length === index + 1);
      assert.equal(queue.getJob(job.id).options.levelingBeforePrint, enabled);
      const sent = requests[index];
      assert.equal(sent.method,'POST');
      assert.equal(sent.path,'/printGcode');
      assert.equal(sent.body.serialNumber,printer.serialNumber);
      assert.equal(sent.body.checkCode,printer.checkCode);
      assert.equal(sent.body.fileName,`queue-${description}.gcode`);
      assert.equal(sent.body.levelingBeforePrint,enabled,
        `Queued AD5M Pro ${description} checkbox was not forwarded to printer firmware`);
      assert.equal(queue.getJob(job.id).status,'starting');
    }
    assert.equal(requests.length,3);
  } finally {
    queue.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});
