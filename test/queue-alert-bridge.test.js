import test from 'node:test';
import assert from 'node:assert/strict';
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
