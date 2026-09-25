import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChamberPreheatService,
  isPrintJobActive
} from '../src/chamber-preheat.js';
import { BED_MAX_C, setTemperatures } from '../src/printer-api.js';

function makeFleetState(initial) {
  let state = structuredClone(initial);
  const publications = [];
  return {
    getPrinterState() { return structuredClone(state); },
    setState(next) { state = structuredClone(next); },
    setChamberPreheat(_id, preheat) { publications.push(structuredClone(preheat)); },
    publications
  };
}

const idleStatus = {
  status: 'ready',
  fileName: null,
  bed: { actual: 25, target: 0 }
};

test('chamber preheat reasserts a bed target cleared by idle firmware and turns off at timeout', async () => {
  let now = Date.parse('2026-09-09T14:00:00Z');
  const fleetState = makeFleetState({ online:true, status: idleStatus, error:null });
  const calls = [];
  const service = new ChamberPreheatService({
    fleetState,
    getPrinterFn: async () => ({ id:'p1', host:'printer' }),
    getStatusFn: async () => idleStatus,
    setTemperaturesFn: async (_printer, temps) => { calls.push(temps); },
    nowFn: () => now,
    heartbeatMs: 60_000
  });

  const session = await service.start('p1', { bedTemperature: 90, durationMinutes: 1 });
  assert.equal(session.active, true);
  assert.deepEqual(calls, [{ bed:90 }]);

  now += 3_000;
  await service.tickSession('p1');
  assert.deepEqual(calls, [{ bed:90 }, { bed:90 }]);
  assert.equal(service.get('p1').reassertions, 1);

  now += 58_000;
  await service.tickSession('p1');
  assert.equal(service.get('p1').active, false);
  assert.deepEqual(calls.at(-1), { bed:0 });
  assert.equal(fleetState.publications.at(-1).reason, 'duration-complete');
});

test('chamber preheat relinquishes the bed without turning it off when a print starts', async () => {
  let now = Date.parse('2026-09-09T14:00:00Z');
  const fleetState = makeFleetState({ online:true, status: { ...idleStatus, bed:{ actual:40, target:90 } }, error:null });
  const calls = [];
  const service = new ChamberPreheatService({
    fleetState,
    getPrinterFn: async () => ({ id:'p1' }),
    getStatusFn: async () => idleStatus,
    setTemperaturesFn: async (_printer, temps) => { calls.push(temps); },
    nowFn: () => now
  });

  await service.start('p1', { bedTemperature: 90, durationMinutes: 45 });
  fleetState.setState({
    online:true,
    status:{ status:'heating', fileName:'part.gcode', bed:{ actual:50, target:60 } },
    error:null
  });
  now += 3_000;
  await service.tickSession('p1');

  assert.equal(service.get('p1').active, false);
  assert.deepEqual(calls, [{ bed:90 }]);
  assert.equal(fleetState.publications.at(-1).reason, 'print-started');
  assert.equal(isPrintJobActive({ status:'heating', fileName:'part.gcode' }), true);
  assert.equal(isPrintJobActive({ status:'heating', fileName:null }), false);
});

test('controller accepts 110 C bed commands and rejects values above the firmware limit', async () => {
  assert.equal(BED_MAX_C, 110);
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok:true, json: async () => ({ code:0 }) };
  };

  try {
    const printer = { host:'127.0.0.1', serialNumber:'SN', checkCode:'CODE' };
    await setTemperatures(printer, { bed:110 });
    assert.equal(requests[0].payload.args.platform, 110);
    await assert.rejects(() => setTemperatures(printer, { bed:111 }), /Bed must be 0-110 C/);
  } finally {
    global.fetch = originalFetch;
  }
});


test('chamber preheat invokes adapter native lifecycle hooks and preserves them when a print takes ownership', async () => {
  let now = Date.parse('2026-09-10T10:00:00Z');
  const fleetState = makeFleetState({
    online:true,
    status:{ ...idleStatus, filtration:{ available:true } },
    error:null
  });
  const calls = [];
  const printer = { id:'u1', host:'u1' };
  const adapter = {
    capabilities:{ chamberPreheat:true, bedTemperature:true },
    limits:{ bedTemperature:{ max:100 }, chamberPreheatBedTemperature:{ min:30, max:100 } },
    async getStatus() { return { ...idleStatus, filtration:{ available:true } }; },
    async setTemperatures(values) { calls.push(['temp', values]); },
    async prepareChamberPreheat(options, context) { calls.push(['prepare', options, context.status.filtration.available]); },
    async finishChamberPreheat(options) { calls.push(['finish', options.reason]); }
  };
  const service = new ChamberPreheatService({
    fleetState,
    getPrinterFn: async () => printer,
    adapterResolver: () => adapter,
    nowFn: () => now
  });

  await service.start('u1', { bedTemperature:100, durationMinutes:30 });
  assert.deepEqual(calls.slice(0, 2), [
    ['prepare', { bedTemperature:100, durationMinutes:30 }, true],
    ['temp', { bed:100 }]
  ]);

  fleetState.setState({
    online:true,
    status:{ status:'printing', fileName:'part.gcode', bed:{ actual:55, target:70 } },
    error:null
  });
  now += 3000;
  await service.tickSession('u1');
  assert.equal(service.get('u1').active, false);
  assert.equal(calls.some((entry) => entry[0] === 'finish'), false);
});

test('manual chamber preheat stop invokes adapter cleanup and turns the bed off', async () => {
  const fleetState = makeFleetState({ online:true, status:{ ...idleStatus, filtration:{ available:true } }, error:null });
  const calls = [];
  const adapter = {
    capabilities:{ chamberPreheat:true, bedTemperature:true },
    limits:{ bedTemperature:{ max:100 }, chamberPreheatBedTemperature:{ min:30, max:100 } },
    async getStatus() { return { ...idleStatus, filtration:{ available:true } }; },
    async setTemperatures(values) { calls.push(['temp', values]); },
    async prepareChamberPreheat() { calls.push(['prepare']); },
    async finishChamberPreheat(options) { calls.push(['finish', options.reason]); }
  };
  const service = new ChamberPreheatService({
    fleetState,
    getPrinterFn: async () => ({ id:'u1' }),
    adapterResolver: () => adapter
  });
  await service.start('u1', { bedTemperature:90, durationMinutes:20 });
  await service.stop('u1', { reason:'manual', turnOff:true });
  assert.deepEqual(calls, [
    ['prepare'],
    ['temp', { bed:90 }],
    ['finish', 'manual'],
    ['temp', { bed:0 }]
  ]);
});


test('native heated-chamber preheat holds the chamber target without heating the bed', async () => {
  let now = Date.parse('2026-09-25T20:30:00Z');
  const idle = {
    status:'ready',
    fileName:null,
    bed:{ actual:25, target:0 },
    chamber:{ actual:30, target:0 }
  };
  const fleetState = makeFleetState({ online:true, status:idle, error:null });
  const calls = [];
  const adapter = {
    capabilities:{
      chamberPreheat:true,
      chamberTemperatureControl:true,
      bedTemperature:true
    },
    limits:{
      bedTemperature:{ min:0, max:120 },
      chamberTemperature:{ min:0, max:65 },
      chamberPreheatChamberTemperature:{ min:30, max:65 },
      chamberPreheatMinutes:{ min:1, max:120 }
    },
    async getStatus() { return idle; },
    async setTemperatures(values) { calls.push(values); },
    async prepareChamberPreheat() {},
    async finishChamberPreheat() {}
  };
  const service = new ChamberPreheatService({
    fleetState,
    getPrinterFn:async () => ({ id:'creator5-pro' }),
    adapterResolver:() => adapter,
    nowFn:() => now,
    heartbeatMs:60_000
  });

  const session = await service.start('creator5-pro', {
    chamberTemperature:55,
    durationMinutes:45
  });
  assert.equal(session.heatSource, 'chamber');
  assert.equal(session.chamberTemperature, 55);
  assert.equal(session.bedTemperature, undefined);
  assert.deepEqual(calls, [{ chamber:55 }]);

  fleetState.setState({
    online:true,
    status:{ ...idle, chamber:{ actual:42, target:0 } },
    error:null
  });
  now += 3_000;
  await service.tickSession('creator5-pro');
  assert.deepEqual(calls, [{ chamber:55 }, { chamber:55 }]);
  assert.equal(service.get('creator5-pro').reassertions, 1);

  await service.stop('creator5-pro', { reason:'manual', turnOff:true });
  assert.deepEqual(calls.at(-1), { chamber:0 });
});

test('native heated-chamber preheat enforces the model chamber target limit', async () => {
  const fleetState = makeFleetState({
    online:true,
    status:{ status:'ready', fileName:null, bed:{ actual:25, target:0 }, chamber:{ actual:25, target:0 } },
    error:null
  });
  const adapter = {
    capabilities:{ chamberPreheat:true, chamberTemperatureControl:true, bedTemperature:true },
    limits:{
      chamberTemperature:{ min:0, max:65 },
      chamberPreheatChamberTemperature:{ min:30, max:65 }
    },
    async getStatus() { return fleetState.getPrinterState('creator5-pro').status; },
    async setTemperatures() {},
    async prepareChamberPreheat() {},
    async finishChamberPreheat() {}
  };
  const service = new ChamberPreheatService({
    fleetState,
    getPrinterFn:async () => ({ id:'creator5-pro' }),
    adapterResolver:() => adapter
  });

  await assert.rejects(
    () => service.start('creator5-pro', { chamberTemperature:66, durationMinutes:30 }),
    /Chamber preheat temperature must be 30-65 C/
  );
});
