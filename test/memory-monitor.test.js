import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMonitor } from '../src/memory-monitor.js';

const GiB = 1024 ** 3;

function createMonitor({ heapUsed = 0, nowRef = { value:0 }, entries = [], reminderMs = 15 * 60_000 } = {}) {
  const memory = { heapUsed, heapTotal:heapUsed + 64 * 1024 ** 2, rss:heapUsed + 128 * 1024 ** 2, external:12 * 1024 ** 2, arrayBuffers:4 * 1024 ** 2 };
  const monitor = new MemoryMonitor({
    sampleMs:60_000,
    reminderMs,
    memoryUsageFn:() => ({ ...memory }),
    heapStatisticsFn:() => ({ heap_size_limit:4 * GiB }),
    nowFn:() => nowRef.value,
    diagnosticFn:(level, message, meta) => entries.push({ level, message, meta })
  });
  return { monitor, memory, entries, nowRef };
}

test('memory monitor stays silent while heap usage is healthy', async () => {
  const { monitor, entries } = createMonitor({ heapUsed:512 * 1024 ** 2 });
  const snapshot = await monitor.sample();
  assert.equal(snapshot.state, 'normal');
  assert.equal(snapshot.heapUsedPercent, 12.5);
  assert.equal(entries.length, 0);
});

test('memory monitor escalates at 25, 50 and 75 percent of the V8 heap limit', async () => {
  const setup = createMonitor({ heapUsed:GiB });
  await setup.monitor.sample();
  assert.equal(setup.entries.at(-1).level, 'warn');
  assert.equal(setup.entries.at(-1).meta.state, 'warning');

  setup.memory.heapUsed = 2 * GiB;
  setup.nowRef.value += 60_000;
  await setup.monitor.sample();
  assert.equal(setup.entries.at(-1).level, 'warn');
  assert.equal(setup.entries.at(-1).meta.state, 'critical');

  setup.memory.heapUsed = 3 * GiB;
  setup.nowRef.value += 60_000;
  await setup.monitor.sample();
  assert.equal(setup.entries.at(-1).level, 'error');
  assert.equal(setup.entries.at(-1).meta.state, 'danger');
  assert.equal(setup.entries.at(-1).meta.heapUsedPercent, 75);
});

test('memory monitor reminds while elevated and records recovery', async () => {
  const setup = createMonitor({ heapUsed:GiB, reminderMs:120_000 });
  await setup.monitor.sample();
  assert.equal(setup.entries.length, 1);

  setup.nowRef.value += 60_000;
  await setup.monitor.sample();
  assert.equal(setup.entries.length, 1);

  setup.nowRef.value += 60_000;
  await setup.monitor.sample();
  assert.equal(setup.entries.length, 2);
  assert.match(setup.entries.at(-1).message, /remains warning/);

  setup.memory.heapUsed = 256 * 1024 ** 2;
  setup.nowRef.value += 60_000;
  await setup.monitor.sample();
  assert.equal(setup.entries.at(-1).level, 'info');
  assert.equal(setup.entries.at(-1).message, 'Controller memory usage recovered');
  assert.equal(setup.entries.at(-1).meta.state, 'normal');
});

test('memory monitor exposes its most recent sampled snapshot', async () => {
  const setup = createMonitor({ heapUsed:1536 * 1024 ** 2 });
  const sampled = await setup.monitor.sample();
  assert.deepEqual(setup.monitor.getSnapshot(), sampled);
  assert.equal(sampled.heapLimitBytes, 4 * GiB);
  assert.equal(sampled.rssBytes, setup.memory.rss);
});
