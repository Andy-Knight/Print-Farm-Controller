import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PrintQueueService, printQueueHelpers } from '../src/print-queue.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const at = Date.parse('2026-10-16T12:00:00.000Z');
const queuedAt = (ageMs) => new Date(at - ageMs).toISOString();
const job = (id, priority, ageMs, status = 'queued') => ({
  id, priority, queuedAt:queuedAt(ageMs), status
});

test('queue aging promotes at six-hour boundaries, caps at high, and never promotes terminal jobs', () => {
  const cases = [
    ['low just before 6h', job('a', 'low', SIX_HOURS - 1), 'low', false],
    ['low at 6h', job('a', 'low', SIX_HOURS), 'normal', true],
    ['low before 12h', job('a', 'low', 2 * SIX_HOURS - 1), 'normal', true],
    ['low at 12h', job('a', 'low', 2 * SIX_HOURS), 'high', true],
    ['low at 36h capped', job('a', 'low', 6 * SIX_HOURS), 'high', true],
    ['normal before 6h', job('a', 'normal', SIX_HOURS - 1), 'normal', false],
    ['normal at 6h', job('a', 'normal', SIX_HOURS), 'high', true],
    ['high stays high', job('a', 'high', SIX_HOURS), 'high', false],
    ['review-blocked jobs age', job('a', 'low', 2 * SIX_HOURS, 'needs_review'), 'high', true],
    ['active jobs do not age', job('a', 'low', 2 * SIX_HOURS, 'printing'), 'low', false],
    ['completed jobs do not age', job('a', 'low', 2 * SIX_HOURS, 'completed'), 'low', false],
    ['future timestamps do not age', job('a', 'low', -SIX_HOURS), 'low', false]
  ];
  for (const [label, queued, effective, aged] of cases) {
    const result = printQueueHelpers.priorityInfo(queued, at);
    assert.equal(result.effectivePriority, effective, label);
    assert.equal(result.priorityAged, aged, label);
  }
});

test('scheduler orders by effective priority before saved manual position and does not mutate input jobs', () => {
  const lowAged = job('low-aged', 'low', 2 * SIX_HOURS);
  const high = job('new-high', 'high', 0);
  const normal = job('new-normal', 'normal', 0);
  const positions = new Map([
    [lowAged.id, 0], [high.id, 1], [normal.id, 2]
  ]);
  const original = [normal, high, lowAged];
  const sorted = [...original].sort((a, b) => printQueueHelpers.compareQueuePriority(a, b, positions, at));
  assert.deepEqual(sorted.map((item) => item.id), [
    'low-aged', 'new-high', 'new-normal'
  ], 'an aged low-priority job ties high and keeps its earlier manual position');
  assert.deepEqual(original.map((item) => item.id), [
    'new-normal', 'new-high', 'low-aged'
  ], 'sorting a copy must not change the original array');

  const tie = [job('newer', 'high', 0), job('older', 'high', 0)]
    .sort((a, b) => printQueueHelpers.compareQueuePriority(a, b,
      new Map([['older', 0], ['newer', 1]]), at));
  assert.deepEqual(tie.map((item) => item.id), ['older', 'newer']);
  assert.ok(printQueueHelpers.compareQueuePriority(job('normal', 'normal', 0),
    job('high', 'high', 0), new Map(), at) > 0, 'unaged high outranks normal regardless of missing manual positions');
});

test('fault injection proves scheduler assertions detect an aging threshold regression', () => {
  const source = readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
  const begin = source.indexOf('const PRIORITY_AGING_MS = ');
  const end = source.indexOf('\nfunction normalizeState(', begin);
  assert.ok(begin >= 0 && end > begin, 'production priority implementation located');
  const snippet = source.slice(source.indexOf('const PRIORITIES = ', begin - 450), end);
  const bad = snippet.replace(
    'const PRIORITY_AGING_MS = 6 * 60 * 60 * 1000;',
    'const PRIORITY_AGING_MS = 12 * 60 * 60 * 1000;'
  );
  assert.notEqual(bad, snippet, 'fault injection changed only the isolated threshold');
  const mutatedPriorityInfo = runInNewContext(
    bad + '\npriorityInfo;',
    { Date, Number, Math, String, Set, Object }
  );
  const original = printQueueHelpers.priorityInfo(job('a', 'low', SIX_HOURS), at);
  const mutant = mutatedPriorityInfo(job('a', 'low', SIX_HOURS), at);
  assert.equal(original.effectivePriority, 'normal');
  assert.equal(mutant.effectivePriority, 'low',
    'changing the real threshold would violate the tested six-hour boundary');
});

class TestFleet {
  constructor(states) {
    this.states = new Map(states.map((state) => [state.id, state]));
    this.listeners = new Set();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getFleet());
    return () => this.listeners.delete(listener);
  }
  getFleet() { return [...this.states.values()]; }
  getPrinterState(id) { return this.states.get(id) || null; }
  async refreshNow() {}
  update(id, patch) {
    this.states.set(id, { ...this.states.get(id), ...patch });
    for (const listener of this.listeners) listener(this.getFleet());
  }
}
function persistedJobs(jobs) {
  let stored = structuredClone(jobs);
  return {
    load:async () => structuredClone(stored),
    save:async (next) => { stored = structuredClone(next); }
  };
}
async function until(predicate, label) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  assert.fail('Timed out waiting for ' + label);
}

test('fixed-printer scheduler sends the aged low-priority job before newer high-priority work', async () => {
  // Artificially old queue entries ensure the real dispatch path, not only
  // priorityInfo, honours aging and saved position.
  const jobs = [
    { ...job('aged', 'low', 2 * SIX_HOURS), printerId:'p1', assignmentMode:'fixed', fileName:'aged.gcode', options:{} },
    { ...job('recent', 'high', 0), printerId:'p1', assignmentMode:'fixed', fileName:'recent.gcode', options:{} }
  ];
  const fleet = new TestFleet([{ id:'p1', name:'Printer', online:false, status:null }]);
  const store = persistedJobs(jobs);
  const starts = [];
  const service = new PrintQueueService({
    fleetState:fleet,
    chamberPreheat:{ isActive:() => false, stop:async () => {} },
    loadJobsFn:store.load,
    saveJobsFn:store.save,
    getPrinterFn:async () => ({ id:'p1', name:'Printer', adapterType:'test' }),
    adapterResolver:() => ({
      capabilities:{ printLocalFile:true },
      getStatus:async () => ({ status:'idle', fileName:null }),
      printLocalFile:async (fileName) => { starts.push(fileName); }
    })
  });
  // Align fixture ages with live clock so the background reconcile uses real
  // priority timings, not the fixed 'at' timestamp used in deterministic unit checks.
  const liveAt = Date.now();
  service.setDispatchPaused(true);
  await service.start();
  try {
    service.jobs[0].queuedAt = new Date(liveAt - 2 * SIX_HOURS - 1000).toISOString();
    service.jobs[1].queuedAt = new Date(liveAt - 1000).toISOString();
    fleet.update('p1', { online:true, status:{ status:'idle', fileName:null, progress:0 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(starts, [], 'paused dispatch must never initiate a print');
    service.setDispatchPaused(false);
    await until(() => starts.length === 1, 'first priority-selected print start');
    assert.deepEqual(starts, ['aged.gcode']);
    assert.equal(service.getJob('aged').status, 'starting');
    assert.equal(service.getJob('recent').status, 'queued');
  } finally {
    service.stop();
  }
});

test('higher-ranked review-blocked work prevents a lower-ranked fixed print from bypassing review', async () => {
  const fleet = new TestFleet([{ id:'p1', name:'Printer', online:true, status:{ status:'idle', fileName:null } }]);
  const jobs = [
    { ...job('review', 'high', 0, 'needs_review'), printerId:'p1', assignmentMode:'fixed', fileName:'review.gcode', options:{} },
    { ...job('waiting', 'normal', 0), printerId:'p1', assignmentMode:'fixed', fileName:'waiting.gcode', options:{} }
  ];
  const store = persistedJobs(jobs);
  const starts = [];
  const service = new PrintQueueService({
    fleetState:fleet,
    chamberPreheat:{ isActive:() => false, stop:async () => {} },
    loadJobsFn:store.load, saveJobsFn:store.save,
    getPrinterFn:async () => ({ id:'p1', name:'Printer', adapterType:'test' }),
    adapterResolver:() => ({
      capabilities:{ printLocalFile:true },
      getStatus:async () => ({ status:'idle', fileName:null }),
      printLocalFile:async (filename) => starts.push(filename)
    })
  });
  await service.start();
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(starts, [], 'lower priority may not jump an earlier review hold');
    assert.equal(service.getJob('waiting').status, 'queued');
    assert.equal(service.getJob('review').status, 'needs_review');
  } finally {
    service.stop();
  }
});
