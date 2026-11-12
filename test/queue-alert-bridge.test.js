import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AlertService } from '../src/alert-service.js';
import { QueueAlertBridge } from '../src/queue-alert-bridge.js';

test('queue alert bridge baselines existing intervention state and emits only new transitions', async () => {
  const emitted = [];
  const bridge = new QueueAlertBridge({
    alertService:{
      async emit(alert) {
        emitted.push(structuredClone(alert));
        return { alert, duplicate:false };
      }
    },
    printerLookupFn:(id) => id === 'p1'
      ? { id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' }
      : null
  });

  await bridge.observe({
    jobs:[{ id:'old', status:'needs_review', fileName:'Old.gcode', updatedAt:'2026-10-05T18:00:00.000Z' }],
    bedClearance:[{ printerId:'p1', printerName:'Printer 1', jobId:'old-finished', fileName:'Old part.gcode', finishedAt:'2026-10-05T17:00:00.000Z' }]
  });
  assert.equal(emitted.length, 0);

  await bridge.observe({
    jobs:[
      { id:'old', status:'needs_review', fileName:'Old.gcode', updatedAt:'2026-10-05T18:00:00.000Z' },
      { id:'new', status:'needs_review', fileName:'New.gcode', error:'No compatible printer', updatedAt:'2026-10-05T18:05:00.000Z' }
    ],
    bedClearance:[
      { printerId:'p1', printerName:'Printer 1', jobId:'old-finished', fileName:'Old part.gcode', finishedAt:'2026-10-05T17:00:00.000Z' },
      { printerId:'p2', printerName:'Printer 2', jobId:'finished-2', fileName:'Part 2.gcode', finishedAt:'2026-10-05T18:04:00.000Z' }
    ]
  });

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].type, 'queue.needs_review');
  assert.match(emitted[0].message, /No compatible printer/);
  assert.equal(emitted[1].type, 'queue.bed_clearance');
  assert.equal(emitted[1].printer.id, 'p2');

  await bridge.observe({
    jobs:[
      { id:'old', status:'needs_review', fileName:'Old.gcode', updatedAt:'2026-10-05T18:00:00.000Z' },
      { id:'new', status:'needs_review', fileName:'New.gcode', error:'No compatible printer', updatedAt:'2026-10-05T18:05:00.000Z' }
    ],
    bedClearance:[
      { printerId:'p1', printerName:'Printer 1', jobId:'old-finished', fileName:'Old part.gcode', finishedAt:'2026-10-05T17:00:00.000Z' },
      { printerId:'p2', printerName:'Printer 2', jobId:'finished-2', fileName:'Part 2.gcode', finishedAt:'2026-10-05T18:04:00.000Z' }
    ]
  });
  assert.equal(emitted.length, 2);
});

test('queue alert bridge can notify again if the same job leaves and later re-enters needs review', async () => {
  const emitted = [];
  const bridge = new QueueAlertBridge({
    alertService:{
      async emit(alert) {
        emitted.push(structuredClone(alert));
        return { alert, duplicate:false };
      }
    }
  });

  await bridge.observe({ jobs:[{ id:'j1', status:'queued', fileName:'Part.gcode' }], bedClearance:[] });
  await bridge.observe({ jobs:[{ id:'j1', status:'needs_review', fileName:'Part.gcode', updatedAt:'2026-10-05T18:01:00.000Z' }], bedClearance:[] });
  await bridge.observe({ jobs:[{ id:'j1', status:'queued', fileName:'Part.gcode', updatedAt:'2026-10-05T18:02:00.000Z' }], bedClearance:[] });
  await bridge.observe({ jobs:[{ id:'j1', status:'needs_review', fileName:'Part.gcode', updatedAt:'2026-10-05T18:03:00.000Z' }], bedClearance:[] });

  assert.equal(emitted.length, 2);
  assert.notEqual(emitted[0].id, emitted[1].id);
});

test('clearing a bed acknowledges its pending warning without waiting for emission or touching other alerts', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'pfc-clearance-alert-'));
  t.after(() => rm(dataDir, { recursive:true, force:true }));
  const alerts = new AlertService({ dataDir });
  const gate = Promise.withResolvers();
  const bridge = new QueueAlertBridge({ alertService:{
    async emit(alert) {
      await gate.promise;
      return alerts.emit(alert);
    },
    markRead:id => alerts.markRead(id)
  } });
  const printerId = '43d30703-f42e-4b6b-a61e-b414498601cc';
  await alerts.emit({ id:'older-clearance', type:'queue.bed_clearance', severity:'warning',
    title:'Earlier bed clearance', message:'Earlier print', printer:{ id:printerId } });
  await alerts.emit({ id:'print-failure', type:'print.failed', severity:'critical',
    title:'Print failed', message:'Print failed', printer:{ id:printerId } });
  const clearance = { printerId, jobId:'2b7f15fb-d948-423a-878a-e98d81f2c5cf',
    fileName:`${'long-part-name-'.repeat(13)}.gcode`, finishedAt:'2026-11-12T10:00:00.000Z' };
  await bridge.schedule();
  void bridge.schedule({ bedClearance:[clearance] });
  await bridge.markBedClearanceRead(clearance);
  gate.resolve();
  await bridge.stop();

  const reloaded = new AlertService({ dataDir });
  await reloaded.init();
  const history = reloaded.listHistory();
  const warning = history.find(alert => alert.source?.id === clearance.jobId);
  assert.equal(warning?.type, 'queue.bed_clearance');
  assert.ok(warning.readAt);
  assert.deepEqual(reloaded.listHistory({ unreadOnly:true }).map(alert => alert.id), ['print-failure', 'older-clearance']);
});
