import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchControlService, validateBatchRequest } from '../src/batch-control.js';
import { PrinterOperationCoordinator } from '../src/concurrency.js';

function makeService({ states, activePreheats = new Set(), operationCoordinator = null } = {}) {
  const printers = new Map(Object.keys(states).map((id) => [id, { id, name:`Printer ${id}` }]));
  const temperatureCalls = [];
  const fanCalls = [];
  const jobCalls = [];
  const preheatCalls = [];

  const chamberPreheat = {
    isActive: (id) => activePreheats.has(id),
    validate: ({ bedTemperature, durationMinutes }) => {
      if (bedTemperature < 30 || bedTemperature > 110) throw new Error('bad preheat temperature');
      if (durationMinutes < 1 || durationMinutes > 120) throw new Error('bad preheat duration');
      return { bedTemperature, durationMinutes };
    },
    start: async (id, params) => { preheatCalls.push(['start', id, params]); activePreheats.add(id); },
    stop: async (id, options) => { preheatCalls.push(['stop', id, options]); activePreheats.delete(id); }
  };

  const service = new BatchControlService({
    fleetState: { getPrinterState: (id) => structuredClone(states[id] || null) },
    chamberPreheat,
    getPrinterFn: async (id) => printers.get(id) || null,
    setTemperaturesFn: async (printer, params) => temperatureCalls.push([printer.id, params]),
    setFansFn: async (printer, params) => fanCalls.push([printer.id, params]),
    setJobStateFn: async (printer, action) => jobCalls.push([printer.id, action]),
    operationCoordinator,
    maxConcurrent: 2
  });

  return { service, chamberPreheat, temperatureCalls, fanCalls, jobCalls, preheatCalls };
}

test('fleet temperature action is no longer supported', () => {
  assert.throws(
    () => validateBatchRequest({ printerIds:['a'], action:'temperature', params:{ bed:60 } }),
    /Unsupported batch action: temperature/
  );
});

test('batch pause only applies to active, non-paused print jobs', async () => {
  const { service, jobCalls } = makeService({
    states: {
      a: { online:true, status:{ status:'printing', fileName:'a.gcode' } },
      b: { online:true, status:{ status:'ready', fileName:null } },
      c: { online:true, status:{ status:'paused', fileName:'c.gcode' } }
    }
  });

  const result = await service.execute({ printerIds:['a','b','c'], action:'pause' });
  assert.deepEqual(jobCalls, [['a','pause']]);
  assert.equal(result.succeeded, 1);
  assert.match(result.results[1].error, /No active print/);
  assert.match(result.results[2].error, /already paused/);
});

test('batch heaters-off cancels preheat ownership then sets both heaters to zero', async () => {
  const activePreheats = new Set(['a']);
  const { service, temperatureCalls, preheatCalls } = makeService({
    activePreheats,
    states: { a: { online:true, status:{ status:'ready' } } }
  });

  const result = await service.execute({ printerIds:['a'], action:'heaters-off' });
  assert.equal(result.succeeded, 1);
  assert.deepEqual(preheatCalls, [['stop','a',{ reason:'batch-heaters-off', turnOff:false }]]);
  assert.deepEqual(temperatureCalls, [['a',{ nozzle:0, bed:0 }]]);
});

test('heaters-off remains a supported fleet safety action', () => {
  assert.deepEqual(
    validateBatchRequest({ printerIds:['a'], action:'heaters-off' }),
    { printerIds:['a'], action:'heaters-off', params:{} }
  );
});


test('batch command reports printer busy when another client operation owns that printer', async () => {
  const coordinator = new PrinterOperationCoordinator();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const active = coordinator.run('a', 'print start', () => gate);

  await new Promise((resolve) => setImmediate(resolve));
  const { service, jobCalls } = makeService({
    operationCoordinator:coordinator,
    states:{ a:{ online:true, status:{ status:'printing', fileName:'part.gcode' } } }
  });

  const result = await service.execute({ printerIds:['a'], action:'pause' });
  assert.equal(result.succeeded, 0);
  assert.equal(jobCalls.length, 0);
  assert.match(result.results[0].error, /Printer busy.*print start in progress/);

  release();
  await active;
});
