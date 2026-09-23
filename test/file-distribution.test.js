import test from 'node:test';
import assert from 'node:assert/strict';
import { FileDistributionService, verifyPrinterFile } from '../src/file-distribution.js';
import { PrinterOperationCoordinator } from '../src/concurrency.js';

function makeDistribution(states, { verify = true, operationCoordinator = null } = {}) {
  const uploads = [];
  const prints = [];
  const preheatStops = [];
  const printers = new Map(Object.keys(states).map((id) => [id, { id, name:`Printer ${id}`, host:`10.0.0.${id.charCodeAt(0)}` }]));
  const chamberPreheat = {
    isActive: (id) => id === 'a',
    stop: async (id, options) => preheatStops.push([id, options])
  };
  const service = new FileDistributionService({
    fleetState: { getPrinterState: (id) => structuredClone(states[id] || null) },
    chamberPreheat,
    getPrinterFn: async (id) => printers.get(id) || null,
    uploadFileFn: async (printer, filePath, options) => uploads.push([printer.id, filePath, options]),
    verifyFileFn: async () => verify ? { verified:true, source:'tcp-m661' } : { verified:false, warning:'not visible yet' },
    printLocalFileFn: async (printer, fileName, level) => prints.push([printer.id, fileName, level]),
    operationCoordinator,
    maxConcurrent:1
  });
  return { service, uploads, prints, preheatStops };
}

test('distribution uploads, verifies, then starts only idle online printers', async () => {
  const { service, uploads, prints, preheatStops } = makeDistribution({
    a:{ online:true, status:{ status:'ready', firmwareVersion:'5.1.4' } },
    b:{ online:false, error:'offline', status:null },
    c:{ online:true, status:{ status:'printing', fileName:'busy.gcode', firmwareVersion:'5.1.4' } }
  });
  const result = await service.distribute({
    printerIds:['a','b','c'], filePath:'/tmp/example.gcode', fileName:'example.gcode',
    startPrint:true, levelingBeforePrint:true
  });

  assert.equal(result.requested, 3);
  assert.equal(result.uploaded, 1);
  assert.equal(result.verified, 1);
  assert.equal(result.started, 1);
  assert.equal(result.succeeded, 1);
  assert.deepEqual(uploads.map((x) => x[0]), ['a']);
  assert.deepEqual(prints, [['a','example.gcode',true]]);
  assert.deepEqual(preheatStops, [['a',{ reason:'distribution-print-started', turnOff:false }]]);
  assert.match(result.results[1].error, /offline/);
  assert.match(result.results[2].error, /active print/);
});

test('distribution never auto-starts an upload that cannot be verified', async () => {
  const { service, uploads, prints } = makeDistribution({ a:{ online:true, status:{ status:'ready' } } }, { verify:false });
  const result = await service.distribute({
    printerIds:['a'], filePath:'/tmp/example.gcode', fileName:'example.gcode', startPrint:true
  });
  assert.equal(uploads.length, 1);
  assert.equal(prints.length, 0);
  assert.equal(result.results[0].uploaded, true);
  assert.equal(result.results[0].verified, false);
  assert.match(result.results[0].error, /Print was not started/);
});


test('distribution rejects a file extension unsupported by the selected printer adapter', async () => {
  let uploaded = false;
  const service = new FileDistributionService({
    fleetState:{ getPrinterState:() => ({ online:true, status:{ status:'ready' } }) },
    chamberPreheat:{ isActive:() => false, stop:async () => {} },
    getPrinterFn:async () => ({ id:'u1', name:'U1' }),
    adapterResolver:() => ({
      type:'snapmaker-u1', manufacturer:'Snapmaker',
      capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true },
      uploadExtensions:['.gcode', '.gco', '.g'],
      uploadFile:async () => { uploaded = true; },
      verifyFile:async () => ({ verified:true, source:'moonraker' })
    }),
    fileMetadataReader:async () => null,
    maxConcurrent:1
  });
  const result = await service.distribute({ printerIds:['u1'], filePath:'/tmp/part.3mf', fileName:'part.3mf' });
  assert.equal(uploaded, false);
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].error, /does not support \.3mf uploads/);
});

test('verification matches full-storage names before falling back to recent files', async () => {
  const result = await verifyPrinterFile({ id:'a' }, 'Part One.gcode', {
    listAllFilesFn: async () => ['other.gcode', '/data/part one.GCODE'],
    getRecentFilesFn: async () => { throw new Error('should not be needed'); }
  });
  assert.deepEqual(result, { verified:true, source:'tcp-m661' });
});


test('distribution remembers file material metadata and refuses mismatched unattended start', async () => {
  const states = { a:{ online:true, status:{ status:'ready', firmwareVersion:'5.1.4' } } };
  const saved = [];
  const prints = [];
  const printer = { id:'a', name:'FlashForge', adapterConfig:{ filamentDesignation:'ASA-CF' } };
  const service = new FileDistributionService({
    fleetState:{ getPrinterState:(id) => structuredClone(states[id]) },
    chamberPreheat:{ isActive:() => false, stop:async () => {} },
    getPrinterFn:async () => printer,
    adapterResolver:() => ({
      type:'flashforge-ad5m',
      capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true },
      uploadFile:async () => {},
      verifyFile:async () => ({ verified:true, source:'tcp-m661' }),
      printLocalFile:async () => prints.push('started')
    }),
    fileMetadataReader:async () => ({ metadataAvailable:true, requiredMaterial:'PETG', materials:['PETG'], source:'filament_type' }),
    fileMetadataSaver:async (printerId, fileName, metadata) => saved.push({ printerId, fileName, metadata }),
    maxConcurrent:1
  });
  const result = await service.distribute({ printerIds:['a'], filePath:'/tmp/part.gcode', fileName:'part.gcode', startPrint:true });
  assert.equal(saved.length, 1);
  assert.equal(prints.length, 0);
  assert.equal(result.results[0].verified, true);
  assert.equal(result.results[0].started, false);
  assert.match(result.results[0].error, /Material mismatch/);
});


test('distribution reports busy instead of interleaving with another printer operation', async () => {
  const coordinator = new PrinterOperationCoordinator();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const active = coordinator.run('a', 'bed levelling', () => gate);
  await new Promise((resolve) => setImmediate(resolve));

  const { service, uploads, prints } = makeDistribution(
    { a:{ online:true, status:{ status:'ready' } } },
    { operationCoordinator:coordinator }
  );
  const result = await service.distribute({
    printerIds:['a'],
    filePath:'/tmp/example.gcode',
    fileName:'example.gcode',
    startPrint:true
  });

  assert.equal(result.failed, 1);
  assert.equal(uploads.length, 0);
  assert.equal(prints.length, 0);
  assert.match(result.results[0].error, /Printer busy.*bed levelling in progress/);

  release();
  await active;
});
