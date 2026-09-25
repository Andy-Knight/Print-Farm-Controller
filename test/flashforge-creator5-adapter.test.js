import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATOR5_BED_MAX_C,
  CREATOR5_NOZZLE_MAX_C,
  CREATOR5_TOOL_COUNT,
  creator5MaterialMappings,
  normalizeCreator5Status,
  openCreator5Camera,
  setCreator5Temperatures
} from '../src/creator5-api.js';
import {
  FLASHFORGE_CREATOR5_ADAPTER_TYPE,
  flashForgeCreator5AdapterDefinition,
  prepareFlashForgeCreator5Config
} from '../src/adapters/flashforge-creator5-adapter.js';

test('Creator 5 adapter definition exposes both four-tool models without TCP configuration', () => {
  assert.equal(FLASHFORGE_CREATOR5_ADAPTER_TYPE, 'flashforge-creator5');
  assert.deepEqual(flashForgeCreator5AdapterDefinition.models, ['Creator 5', 'Creator 5 Pro']);
  const modelField = flashForgeCreator5AdapterDefinition.configFields.find((field) => field.name === 'model');
  assert.equal(modelField.type, 'select');
  assert.deepEqual(modelField.options.map((item) => item.value), ['Creator 5','Creator 5 Pro']);
  assert.equal(flashForgeCreator5AdapterDefinition.configFields.some((field) => field.name === 'tcpPort'), false);
  assert.equal(CREATOR5_TOOL_COUNT, 4);
  assert.equal(CREATOR5_NOZZLE_MAX_C, 320);
  assert.equal(CREATOR5_BED_MAX_C, 120);
});

test('Creator 5 configuration validates model and keeps HTTP/camera ports only', () => {
  const config = prepareFlashForgeCreator5Config({
    name:'Creator',
    model:'creator 5',
    host:'http://192.168.1.60/',
    serialNumber:' C5SN ',
    checkCode:' CODE ',
    httpPort:8898,
    cameraPort:8080
  });
  assert.equal(config.model, 'Creator 5');
  assert.equal(config.host, '192.168.1.60');
  assert.equal(config.serialNumber, 'C5SN');
  assert.equal(config.checkCode, 'CODE');
  assert.equal(config.httpPort, 8898);
  assert.equal(config.cameraPort, 8080);
  assert.equal(Object.hasOwn(config, 'tcpPort'), false);
  assert.throws(() => prepareFlashForgeCreator5Config({
    name:'Bad', model:'Creator 4', host:'192.168.1.60', serialNumber:'SN', checkCode:'CODE'
  }), /Model must be Creator 5 or Creator 5 Pro/);
});

test('Creator 5 Pro detail normalizes four toolheads, material slots and chamber', () => {
  const status = normalizeCreator5Status({
    status:'ready',
    name:'C5 Pro',
    firmwareVersion:'1.0.0',
    pid:41,
    model:'Creator 5 Pro',
    nozzleTemps:[31,32,33,34],
    nozzleTargetTemps:[0,0,230,0],
    platTemp:60,
    platTargetTemp:100,
    chamberTemp:44,
    chamberTargetTemp:55,
    currentSlot:3,
    printProgress:0.25,
    matlStationInfo:{
      slotInfos:[
        { slotId:1, materialName:'PLA', materialColor:'#FF0000', hasFilament:true },
        { slotId:2, materialName:'PETG', materialColor:'#00FF00', hasFilament:true },
        { slotId:3, materialName:'ASA', materialColor:'#0000FF', hasFilament:false },
        { slotId:4, materialName:'TPU', materialColor:'#FFFFFF', hasFilament:true }
      ]
    }
  }, { model:'Creator 5 Pro', nozzleDiameter:0.6 });

  assert.equal(status.status, 'idle');
  assert.equal(status.progress, 25);
  assert.equal(status.tools.length, 4);
  assert.deepEqual(status.tools.map((tool) => tool.actual), [31,32,33,34]);
  assert.deepEqual(status.tools.map((tool) => tool.target), [210,220,230,240]);
  assert.equal(status.tools[2].active, true);
  assert.equal(status.activeTool, 2);
  assert.equal(status.materialStation.currentSlot, 2);
  assert.equal(status.tools[2].filament.material, 'ASA');
  assert.equal(status.tools[2].filament.color, '#0000FF');
  assert.equal(status.tools[2].filament.present, false);
  assert.equal(status.tools[0].nozzleDiameter, 0.6);
  assert.equal(status.materials.loadedCount, 3);
  assert.equal(status.bed.target, 100);
  assert.equal(status.chamber.actual, 44);
  assert.equal(status.chamber.target, 55);
});

test('Creator 5 base model does not invent heated chamber values', () => {
  const status = normalizeCreator5Status({
    status:'ready',
    pid:40,
    model:'Creator 5',
    nozzleTemps:[25,25,25,25],
    nozzleTargetTemps:[0,0,0,0],
    chamberTemp:50,
    chamberTargetTemp:60
  }, { model:'Creator 5' });
  assert.equal(status.chamber.actual, null);
  assert.equal(status.chamber.target, null);
  assert.equal(status.filtration.available, false);
});

test('Creator 5 material mappings convert zero-based toolheads to one-based slots', () => {
  const mappings = creator5MaterialMappings({
    toolMap:{ 0:2, 1:0 },
    logicalTools:[
      { index:0, material:'PLA', color:'#2EC4B6' },
      { index:1, material:'PETG', color:'#FF6B35' }
    ],
    physicalTools:[
      { index:0, filament:{ material:'PETG', color:'#FF6B35' } },
      { index:1, filament:{ material:'PLA', color:'#3A86FF' } },
      { index:2, filament:{ material:'PLA', color:'#2EC4B6' } },
      { index:3, filament:{ material:'ASA', color:'#F7C948' } }
    ]
  });
  assert.deepEqual(mappings.map((item) => ({
    toolId:item.toolId,
    slotId:item.slotId,
    materialName:item.materialName,
    toolMaterialColor:item.toolMaterialColor,
    slotMaterialColor:item.slotMaterialColor
  })), [
    { toolId:0, slotId:3, materialName:'PLA', toolMaterialColor:'#2EC4B6', slotMaterialColor:'#2EC4B6' },
    { toolId:1, slotId:1, materialName:'PETG', toolMaterialColor:'#FF6B35', slotMaterialColor:'#FF6B35' }
  ]);
});

test('Creator 5 per-tool temperature control uses four-entry nozzle arrays', async () => {
  const originalFetch = global.fetch;
  let body = null;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return {
      ok:true,
      async json() { return { code:0, message:'success' }; }
    };
  };
  try {
    await setCreator5Temperatures({
      host:'127.0.0.1', httpPort:8898, serialNumber:'SN', checkCode:'CODE', model:'Creator 5 Pro'
    }, { toolIndex:3, nozzle:300, bed:115, chamber:60 });
    assert.equal(body.payload.cmd, 'temperatureCtl_cmd');
    assert.deepEqual(body.payload.args.nozzles, [-200,-200,-200,300]);
    assert.equal(body.payload.args.platform, 115);
    assert.equal(body.payload.args.chamber, 60);
  } finally {
    global.fetch = originalFetch;
  }
});


test('Creator 5 does not confuse the feeding material slot with the active toolhead', () => {
  const status = normalizeCreator5Status({
    status:'printing',
    model:'Creator 5 Pro',
    nozzleTemps:[210,35,35,35],
    nozzleTargetTemps:[220,0,0,0],
    currentSlot:4,
    matlStationInfo:{
      currentSlot:4,
      slotInfos:[
        { slotId:1, materialName:'PLA', materialColor:'#FFFFFF', hasFilament:true },
        { slotId:2, materialName:'PLA', materialColor:'#FF0000', hasFilament:true },
        { slotId:3, materialName:'PLA', materialColor:'#00FF00', hasFilament:true },
        { slotId:4, materialName:'PLA', materialColor:'#0000FF', hasFilament:true }
      ]
    }
  }, { model:'Creator 5 Pro' });

  assert.equal(status.materialStation.currentSlot, 3);
  assert.equal(status.activeTool, 0);
  assert.equal(status.tools[0].active, true);
  assert.equal(status.tools[3].active, false);
});

test('Creator 5 camera activation covers both observed firmware command names', async () => {
  const originalFetch = global.fetch;
  const commands = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    commands.push(body.payload?.cmd || null);
    return {
      ok:true,
      async json() { return { code:0, message:'Success' }; }
    };
  };
  try {
    const url = await openCreator5Camera({
      host:'127.0.0.1',
      httpPort:8898,
      cameraPort:8080,
      serialNumber:'SN',
      checkCode:'CODE'
    }, { warmupMs:0 });
    assert.deepEqual(commands, ['streamCtrl','streamCtrl_cmd']);
    assert.equal(url, 'http://127.0.0.1:8080/?action=stream');
  } finally {
    global.fetch = originalFetch;
  }
});
