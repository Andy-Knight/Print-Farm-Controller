import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQueueCompatibility, queueCompatibilityHelpers } from '../src/queue-compatibility.js';


test('completed Snapmaker status ignores Moonraker stale filename during compatibility checks', () => {
  const staleCompletedStatus = { status:'idle', fileName:'previous-print.gcode', progress:100 };
  assert.equal(queueCompatibilityHelpers.isBusy(staleCompletedStatus), false);
  assert.equal(queueCompatibilityHelpers.isBusy({ ...staleCompletedStatus, status:'complete' }), false);
  assert.equal(queueCompatibilityHelpers.isBusy({ ...staleCompletedStatus, status:'printing' }), true);
});

test('FlashForge CANCEL state ignores retained filename after operator-safe terminal handling', () => {
  const staleCancelledStatus = { status:'CANCEL', fileName:'cancelled-print.gcode', progress:42 };
  assert.equal(queueCompatibilityHelpers.isBusy(staleCancelledStatus), false);
  assert.equal(queueCompatibilityHelpers.isBusy({ ...staleCancelledStatus, status:'cancelled' }), false);
  assert.equal(queueCompatibilityHelpers.isBusy({ ...staleCancelledStatus, status:'printing' }), true);
});

const stagedJob = {
  stagedFile:{ id:'x', requirements:{
    requiredTools:[0,1], toolCount:2, usageReliable:true,
    logicalTools:[
      { index:0, material:'PLA', color:'#FF0000', nozzleDiameter:0.4 },
      { index:1, material:'PETG', color:'#00FF00', nozzleDiameter:0.6 }
    ]
  } }
};

test('printer target allows only the designated printer model', () => {
  const targetedJob = {
    fileName:'targeted.gcode',
    printerTarget:{ adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' },
    requirements:{ requiredTools:[], toolCount:0 }
  };
  const matching = evaluateQueueCompatibility({
    job:targetedJob,
    printer:{ id:'ff-pro', name:'AD5M Pro', adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' },
    state:{ online:true, status:{ status:'idle' } },
    adapter:{ type:'flashforge-ad5m', model:'Adventurer 5M Pro', capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode'] }
  });
  assert.equal(matching.category, 'ready');

  const wrongModel = evaluateQueueCompatibility({
    job:targetedJob,
    printer:{ id:'u1', name:'U1', adapterType:'snapmaker-u1', model:'U1' },
    state:{ online:true, status:{ status:'idle' } },
    adapter:{ type:'snapmaker-u1', model:'U1', capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode'] }
  });
  assert.equal(wrongModel.category, 'incompatible');
  assert.ok(wrongModel.reasons.some((reason) => reason.code === 'printer_target_mismatch'));
  assert.ok(wrongModel.reasons.some((reason) => /Adventurer 5M Pro/.test(reason.text)));
});

test('files without a printer target remain unrestricted by model', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'general.gcode', requirements:{ requiredTools:[], toolCount:0 } },
    printer:{ id:'u1', name:'U1', adapterType:'snapmaker-u1', model:'U1' },
    state:{ online:true, status:{ status:'idle' } },
    adapter:{ type:'snapmaker-u1', model:'U1', capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode'] }
  });
  assert.equal(result.category, 'ready');
});

test('U1 compatibility produces a logical-to-physical mapping from loaded tool state', () => {
  const result = evaluateQueueCompatibility({
    job:stagedJob,
    printer:{ id:'u1', name:'U1-01' },
    state:{ id:'u1', name:'U1-01', online:true, status:{ status:'idle', fileName:null, tools:[
      { index:0, nozzleDiameter:0.6, filament:{ present:true, material:'PETG', color:'#00FF00' } },
      { index:2, nozzleDiameter:0.4, filament:{ present:true, material:'PLA', color:'#FF0000' } }
    ] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true, printToolMapping:true }, limits:{ toolCount:4 } }
  });
  assert.equal(result.category, 'ready');
  assert.deepEqual(result.toolMap, { '0':2, '1':0 });
});

test('single-tool printer is incompatible with a two-tool file', () => {
  const result = evaluateQueueCompatibility({
    job:stagedJob,
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, filament:{ material:'PLA' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true, printToolMapping:false }, limits:{} }
  });
  assert.equal(result.category, 'incompatible');
  assert.match(result.reasons[0].text, /requires 2 tools/);
});

test('Bambu AMS compatibility maps file filaments to loaded slots without treating them as nozzles', () => {
  const bambuJob = { fileName:'two-colour.3mf', stagedFile:{ requirements:{
    requiredTools:[0,1], toolCount:2, usageReliable:true,
    logicalTools:[
      { index:0, material:'PLA', color:'#FF0000', nozzleDiameter:0.4 },
      { index:1, material:'PETG', color:'#00FF00', nozzleDiameter:0.4 }
    ]
  } } };
  const result = evaluateQueueCompatibility({
    job:bambuJob,
    printer:{ id:'p1s', name:'P1S' },
    state:{ id:'p1s', name:'P1S', online:true, status:{ status:'idle', tools:[{ index:0, nozzleDiameter:0.4 }], materialSources:[
      { id:'ams-0-0', protocolIndex:0, label:'AMS 1 · Slot 1', present:true, material:'PETG', color:'#00FF00' },
      { id:'ams-0-2', protocolIndex:2, label:'AMS 1 · Slot 3', present:true, material:'PLA', color:'#FF0000' },
      { id:'external', protocolIndex:254, label:'External spool', present:true, material:'PLA', color:'#FFFFFF' }
    ] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true, materialSlotMapping:true }, limits:{ toolCount:1 }, uploadExtensions:['.3mf','.gcode'] }
  });
  assert.equal(result.category, 'ready');
  assert.deepEqual(result.materialMap, { '0':2, '1':0 });
});

test('Bambu AMS compatibility blocks a missing required filament', () => {
  const bambuJob = { fileName:'two-colour.3mf', stagedFile:{ requirements:{
    requiredTools:[0,1], toolCount:2, usageReliable:true,
    logicalTools:[{ index:0, material:'PLA', color:'#FF0000' }, { index:1, material:'PETG', color:'#00FF00' }]
  } } };
  const result = evaluateQueueCompatibility({
    job:bambuJob,
    printer:{ id:'p1p', name:'P1P' },
    state:{ online:true, status:{ status:'idle', tools:[{ index:0, nozzleDiameter:0.4 }], materialSources:[
      { id:'ams-0-0', protocolIndex:0, label:'AMS 1 · Slot 1', present:true, material:'PLA', color:'#FF0000' }
    ] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true, materialSlotMapping:true }, limits:{ toolCount:1 }, uploadExtensions:['.3mf'] }
  });
  assert.equal(result.category, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.code === 'material_slot_not_loaded'));
});

test('compatible printer can be temporarily blocked by bed clearance', () => {
  const result = evaluateQueueCompatibility({
    job:{ stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA' }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, filament:{ material:'PLA' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{} },
    bedClearanceRequired:true
  });
  assert.equal(result.category, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.code === 'bed_not_cleared'));
});

test('compatible printer is blocked while another client operation is in progress', () => {
  const result = evaluateQueueCompatibility({
    job:{ stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA' }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, filament:{ material:'PLA' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{} },
    operationBusy:{ label:'bed levelling' }
  });
  assert.equal(result.category, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.code === 'operation_busy'));
  assert.ok(result.reasons.some((reason) => /bed levelling in progress/.test(reason.text)));
});

test('automatic compatibility does not guess a required nozzle size when printer cannot report it', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'part.gcode', stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA', nozzleDiameter:0.6 }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, filament:{ material:'PLA' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode','.gx','.3mf'] }
  });
  assert.equal(result.category, 'needs_review');
  assert.ok(result.reasons.some((reason) => reason.code === 'nozzle_unknown'));
});

test('FlashForge controller nozzle designation satisfies an explicit staged-file nozzle requirement', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'part.gcode', stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA', nozzleDiameter:0.6 }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, nozzleDiameter:0.6, nozzleDiameterSource:'manual', filament:{ material:'PLA' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode','.gx','.3mf'] }
  });
  assert.equal(result.category, 'ready');
  assert.equal(result.reasons.length, 0);
});

test('FlashForge controller nozzle designation blocks an explicit nozzle mismatch', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'part.gcode', stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA', nozzleDiameter:0.6 }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, nozzleDiameter:0.4, nozzleDiameterSource:'manual', filament:{ material:'PLA' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode','.gx','.3mf'] }
  });
  assert.equal(result.category, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.code === 'nozzle_mismatch'));
});


test('colour families allow different shades of the same named colour', () => {
  assert.equal(queueCompatibilityHelpers.colorFamily('#FF0000'), 'red');
  assert.equal(queueCompatibilityHelpers.colorFamily('#D91E18'), 'red');
  assert.equal(queueCompatibilityHelpers.colorFamily('#A80000'), 'red');
  assert.equal(queueCompatibilityHelpers.colorFamily('#FF5050'), 'red');
  assert.equal(queueCompatibilityHelpers.colorsCompatible('#FF0000', '#D91E18'), true);
  assert.equal(queueCompatibilityHelpers.colorsCompatible('#FF0000', '#FF6600'), false);
  assert.equal(queueCompatibilityHelpers.colorsCompatible('#FF0000', '#0000FF'), false);
  assert.equal(queueCompatibilityHelpers.colorFamily('#FFC0CB'), 'pink');
});

test('FlashForge controller accepts a different shade from the same colour family', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'part.gcode', stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA', color:'#FF0000' }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, filament:{ material:'PLA', color:'#D91E18', colorSource:'manual' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode','.gx','.3mf'] }
  });
  assert.equal(result.category, 'ready');
  assert.equal(result.reasons.length, 0);
});

test('FlashForge controller still blocks colours from a different family', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'part.gcode', stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA', color:'#FF0000' }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, filament:{ material:'PLA', color:'#FF6600', colorSource:'manual' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode','.gx','.3mf'] }
  });
  assert.equal(result.category, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.code === 'color_mismatch'));
  assert.ok(result.reasons.some((reason) => /orange/.test(reason.text) && /red/.test(reason.text)));
});

test('U1 mapping prefers the closest shade when multiple same-family tools are valid', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'red-part.gcode', stagedFile:{ requirements:{
      requiredTools:[0], toolCount:1, usageReliable:true,
      logicalTools:[{ index:0, material:'PLA', color:'#FF0000', nozzleDiameter:0.4 }]
    } } },
    printer:{ id:'u1', name:'U1' },
    state:{ id:'u1', name:'U1', online:true, status:{ status:'idle', tools:[
      { index:0, nozzleDiameter:0.4, filament:{ present:true, material:'PLA', color:'#A80000' } },
      { index:1, nozzleDiameter:0.4, filament:{ present:true, material:'PLA', color:'#F02020' } }
    ] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true, printToolMapping:true }, limits:{ toolCount:4 }, uploadExtensions:['.gcode'] }
  });
  assert.equal(result.category, 'ready');
  assert.deepEqual(result.toolMap, { '0':1 });
  assert.ok(queueCompatibilityHelpers.colorDistance('#FF0000', '#F02020') < queueCompatibilityHelpers.colorDistance('#FF0000', '#A80000'));
});

test('Bambu AMS mapping accepts same-family shade differences', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'red-part.3mf', stagedFile:{ requirements:{
      requiredTools:[0], toolCount:1, usageReliable:true,
      logicalTools:[{ index:0, material:'PLA', color:'#FF0000', nozzleDiameter:0.4 }]
    } } },
    printer:{ id:'p1s', name:'P1S' },
    state:{ id:'p1s', name:'P1S', online:true, status:{ status:'idle', tools:[{ index:0, nozzleDiameter:0.4 }], materialSources:[
      { id:'ams-0-0', protocolIndex:0, label:'AMS 1 · Slot 1', present:true, material:'PLA', color:'#D91E18' }
    ] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true, materialSlotMapping:true }, limits:{ toolCount:1 }, uploadExtensions:['.3mf'] }
  });
  assert.equal(result.category, 'ready');
  assert.deepEqual(result.materialMap, { '0':0 });
});

test('FlashForge controller filament colour blocks an explicit staged-file colour mismatch', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'part.gcode', stagedFile:{ requirements:{ requiredTools:[0], toolCount:1, usageReliable:true, logicalTools:[{ index:0, material:'PLA', color:'#FF0000' }] } } },
    printer:{ id:'ff', name:'AD5M' },
    state:{ id:'ff', name:'AD5M', online:true, status:{ status:'idle', tools:[{ index:0, filament:{ material:'PLA', color:'#0000FF', colorSource:'manual' } }] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode','.gx','.3mf'] }
  });
  assert.equal(result.category, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.code === 'color_mismatch'));
});

test('automatic compatibility rejects file types unsupported by a printer adapter', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'project.3mf', stagedFile:{ requirements:{ requiredTools:[], toolCount:0, logicalTools:[] } } },
    printer:{ id:'u1', name:'U1' },
    state:{ id:'u1', name:'U1', online:true, status:{ status:'idle', tools:[] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true }, limits:{}, uploadExtensions:['.gcode'] }
  });
  assert.equal(result.category, 'incompatible');
  assert.ok(result.reasons.some((reason) => reason.code === 'unsupported_file_type'));
});

test('tool mapping uses constrained matching instead of greedy physical-head order', () => {
  const result = evaluateQueueCompatibility({
    job:{ fileName:'multi.gcode', stagedFile:{ requirements:{
      requiredTools:[0,1], toolCount:2, usageReliable:true,
      logicalTools:[
        { index:0, material:'PLA' },
        { index:1, material:'PLA', nozzleDiameter:0.6 }
      ]
    } } },
    printer:{ id:'u1', name:'U1' },
    state:{ id:'u1', name:'U1', online:true, status:{ status:'idle', tools:[
      { index:0, nozzleDiameter:0.6, filament:{ present:true, material:'PLA' } },
      { index:1, nozzleDiameter:0.4, filament:{ present:true, material:'PLA' } }
    ] } },
    adapter:{ capabilities:{ fileUpload:true, localFiles:true, printLocalFile:true, printToolMapping:true }, limits:{ toolCount:4 }, uploadExtensions:['.gcode'] }
  });
  assert.equal(result.category, 'ready');
  assert.deepEqual(result.toolMap, { '0':1, '1':0 });
});
