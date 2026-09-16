import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  normalizeMoonrakerStatus,
  getMoonrakerPrintSetup,
  getMoonrakerStatus,
  orderMoonrakerFilesByHistory,
  setMoonrakerTemperatures,
  setMoonrakerFans,
  setMoonrakerFiltration,
  setMoonrakerFilamentType,
  setMoonrakerFilamentColor,
  startMoonrakerChamberPreheat,
  stopMoonrakerChamberPreheat,
  levelMoonrakerBed,
  calibrateMoonrakerToolOffsets,
  printMoonrakerFile,
  uploadMoonrakerFile,
  isSnapmakerU1ObjectList
} from '../src/moonraker-api.js';
import { localDiscoveryCandidates, probeSnapmakerU1 } from '../src/moonraker-discovery.js';
import { getPrinterAdapter, preparePrinterConfig, SNAPMAKER_U1_ADAPTER_TYPE } from '../src/adapters/adapter-registry.js';

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('normalizes Snapmaker U1 Moonraker status with four toolheads and cavity temperature', () => {
  const status = normalizeMoonrakerStatus({
    webhooks: { state:'ready' },
    print_stats: { state:'printing', filename:'four-colour.gcode', print_duration:120, info:{ current_layer:12, total_layer:100 } },
    virtual_sdcard: { progress:0.25 },
    heater_bed: { temperature:61.5, target:60 },
    extruder: { temperature:30, target:0, nozzle_diameter:0.4, nozzle_volume_type:'standard', extruder_offset:[0,0,0] },
    extruder1: { temperature:31, target:0, nozzle_diameter:0.4, nozzle_volume_type:'standard', extruder_offset:[10.25,0.10,-0.02] },
    extruder2: { temperature:218.4, target:220, nozzle_diameter:0.6, nozzle_volume_type:'high_flow', extruder_offset:[20.50,-0.05,0.03] },
    extruder3: { temperature:32, target:0, nozzle_diameter:0.8, nozzle_volume_type:'standard', extruder_offset:[30.75,0,0.01] },
    toolhead: { extruder:'extruder2' },
    'temperature_sensor cavity': { temperature:38.25 },
    'fan_generic cavity_fan': { speed:0.42 },
    purifier: {
      power_detected:true,
      inner_fan:{ speed:0.75 },
      exhaust_fan:{ speed:0.25 },
      inner_fan_rpm:1860
    },
    filament_detect: {
      info: [
        { VENDOR:'Snapmaker', MANUFACTURER:'Snapmaker', MAIN_TYPE:'PLA', SUB_TYPE:'Basic', ARGB_COLOR:0xFF112233 },
        { VENDOR:'NONE', MANUFACTURER:'NONE', MAIN_TYPE:'NONE', SUB_TYPE:'NONE', ARGB_COLOR:0 },
        { VENDOR:'Snapmaker', MANUFACTURER:'Snapmaker', MAIN_TYPE:'PETG', SUB_TYPE:'NONE', ARGB_COLOR:0xFFABCDEF },
        { VENDOR:'NONE', MANUFACTURER:'NONE', MAIN_TYPE:'NONE', SUB_TYPE:'NONE', ARGB_COLOR:0 }
      ],
      state:[0,0,1,0]
    },
    'filament_motion_sensor e0_filament': { enabled:true, filament_detected:true },
    'filament_motion_sensor e1_filament': { enabled:true, filament_detected:false },
    'filament_motion_sensor e2_filament': { enabled:true, filament_detected:true },
    'filament_motion_sensor e3_filament': { enabled:true, filament_detected:true },
    extruder_offset_calibration: {
      calibration_step:'extruder2_calibration_done', bed_plate_check:true, is_prehoming:true,
      extruder_last_xyz_result:[100,100,5], extruder1_last_xyz_result:[110,100,5.1],
      extruder2_last_xyz_result:[120,100,5.2], extruder3_last_xyz_result:null,
      extruder_nozzle_clean:true, extruder1_nozzle_clean:true, extruder2_nozzle_clean:true, extruder3_nozzle_clean:false
    }
  }, { hostname:'snapmaker-u1', software_version:'U1-1.2.3' });

  assert.equal(status.status, 'printing');
  assert.equal(status.activeTool, 2);
  assert.equal(status.tools.length, 4);
  assert.equal(status.nozzle.actual, 218.4);
  assert.equal(status.tools[2].active, true);
  assert.equal(status.tools[0].nozzleDiameter, 0.4);
  assert.equal(status.tools[2].nozzleDiameter, 0.6);
  assert.equal(status.tools[2].nozzleVolumeType, 'high_flow');
  assert.deepEqual(status.tools[1].offset, [10.25,0.10,-0.02]);
  assert.equal(status.toolOffsetCalibration.available, true);
  assert.equal(status.toolOffsetCalibration.state, 'extruder2_calibration_done');
  assert.equal(status.toolOffsetCalibration.bedPlateCheck, true);
  assert.deepEqual(status.toolOffsetCalibration.tools[2].result, [120,100,5.2]);
  assert.equal(status.bed.target, 60);
  assert.equal(status.chamber.actual, 38.25);
  assert.equal(status.chamberFan, 42);
  assert.equal(status.filtration.available, true);
  assert.equal(status.filtration.internal, 75);
  assert.equal(status.filtration.external, 25);
  assert.equal(status.filtration.internalRpm, 1860);
  assert.equal(status.materials.available, true);
  assert.equal(status.materials.loadedCount, 3);
  assert.equal(status.materials.metadataCount, 2);
  assert.equal(status.tools[0].filament.present, true);
  assert.equal(status.tools[0].filament.material, 'PLA');
  assert.equal(status.tools[0].filament.materialVariant, 'Basic');
  assert.equal(status.tools[0].filament.color, '#112233');
  assert.equal(status.tools[1].filament.present, false);
  assert.equal(status.tools[1].filament.metadataAvailable, false);
  assert.equal(status.tools[2].filament.detecting, true);
  assert.equal(status.tools[2].filament.color, '#ABCDEF');
  assert.equal(status.progress, 25);
  assert.equal(status.currentLayer, 12);
  assert.equal(status.totalLayers, 100);
  assert.equal(status.remainingSeconds, 360);
});

test('U1 material normalization separates filament presence from RFID metadata', () => {
  const status = normalizeMoonrakerStatus({
    webhooks:{ state:'ready' },
    print_stats:{ state:'standby' },
    heater_bed:{ temperature:25, target:0 },
    extruder:{}, extruder1:{}, extruder2:{}, extruder3:{},
    toolhead:{ extruder:'extruder' },
    filament_detect:{
      info:[
        { VENDOR:'NONE', MANUFACTURER:'NONE', MAIN_TYPE:'NONE', SUB_TYPE:'NONE', ARGB_COLOR:0 },
        {}, {}, {}
      ],
      state:[0,0,0,0]
    },
    'filament_motion_sensor e0_filament':{ enabled:true, filament_detected:true },
    'filament_motion_sensor e1_filament':{ enabled:true, filament_detected:false },
    'filament_motion_sensor e2_filament':{ enabled:false, filament_detected:true }
  });
  assert.equal(status.tools[0].filament.present, true);
  assert.equal(status.tools[0].filament.metadataAvailable, false);
  assert.equal(status.tools[0].filament.material, null);
  assert.equal(status.tools[1].filament.present, false);
  assert.equal(status.tools[2].filament.present, null);
  assert.equal(status.tools[2].filament.sensorEnabled, false);
  assert.equal(status.tools[3].filament.present, null);
  assert.equal(status.materials.loadedCount, 1);
});

test('U1 material normalization prefers manual print-task assignments over RFID metadata', () => {
  const status = normalizeMoonrakerStatus({
    webhooks:{ state:'ready' },
    print_stats:{ state:'standby' },
    heater_bed:{ temperature:25, target:0 },
    extruder:{}, extruder1:{}, extruder2:{}, extruder3:{},
    toolhead:{ extruder:'extruder' },
    filament_detect:{
      info:[
        { VENDOR:'Snapmaker', MANUFACTURER:'Snapmaker', MAIN_TYPE:'PLA', SUB_TYPE:'Basic', ARGB_COLOR:0xFF112233 },
        { VENDOR:'Snapmaker', MANUFACTURER:'Snapmaker', MAIN_TYPE:'PLA', SUB_TYPE:'Matte', ARGB_COLOR:0xFF445566 },
        { VENDOR:'Snapmaker', MANUFACTURER:'Snapmaker', MAIN_TYPE:'ABS', SUB_TYPE:'NONE', ARGB_COLOR:0xFF778899 },
        {}
      ],
      state:[0,0,0,0]
    },
    print_task_config:{
      filament_vendor:['Generic Brand','Snapmaker','NONE','NONE'],
      filament_type:['PETG','PLA','NONE','NONE'],
      filament_sub_type:['CF','Matte','NONE','NONE'],
      filament_color_rgba:['CC2200FF','445566FF','FFFFFFFF','FFFFFFFF'],
      filament_official:[false,true,false,false],
      filament_exist:[true,true,true,false],
      filament_edit:[true,false,true,false],
      time_lapse_camera:true,
      auto_replenish_filament:false,
      replenish_ignore_color:false,
      filament_entangle_detect:true,
      filament_entangle_sen:'high'
    },
    'filament_motion_sensor e0_filament':{ enabled:true, filament_detected:true },
    'filament_motion_sensor e1_filament':{ enabled:true, filament_detected:true },
    'filament_motion_sensor e2_filament':{ enabled:true, filament_detected:true },
    'filament_motion_sensor e3_filament':{ enabled:true, filament_detected:false }
  });

  const t0 = status.tools[0].filament;
  assert.equal(t0.present, true);
  assert.equal(t0.material, 'PETG');
  assert.equal(t0.materialVariant, 'CF');
  assert.equal(t0.vendor, 'Generic Brand');
  assert.equal(t0.color, '#CC2200');
  assert.equal(t0.materialSource, 'manual');
  assert.equal(t0.manuallyAssigned, true);
  assert.equal(t0.rfidMetadataAvailable, true);
  assert.equal(t0.editable, true);
  assert.equal(t0.colorEditable, true);

  const t1 = status.tools[1].filament;
  assert.equal(t1.material, 'PLA');
  assert.equal(t1.color, '#445566');
  assert.equal(t1.materialSource, 'rfid');
  assert.equal(t1.officialFilament, true);
  assert.equal(t1.editable, false);
  assert.equal(t1.colorEditable, false);

  // With no meaningful manual assignment, raw RFID remains the fallback.
  const t2 = status.tools[2].filament;
  assert.equal(t2.material, 'ABS');
  assert.equal(t2.color, '#778899');
  assert.equal(t2.materialSource, 'rfid');
  assert.deepEqual(status.printPreferences, {
    timeLapseCamera:true,
    autoReplenishFilament:false,
    replenishIgnoreColor:false,
    filamentEntangleDetect:true,
    filamentEntangleSensitivity:'high'
  });
});

test('U1 adapter exposes Moonraker capabilities and printer-specific thermal limits', () => {
  const config = preparePrinterConfig({ adapterType:SNAPMAKER_U1_ADAPTER_TYPE, name:'U1', host:'http://192.168.1.44:7125/', httpPort:7125 });
  assert.equal(config.host, '192.168.1.44');
  assert.equal(config.httpPort, 7125);
  const adapter = getPrinterAdapter({ id:'u1', ...config });
  assert.equal(adapter.manufacturer, 'Snapmaker');
  assert.equal(adapter.model, 'U1');
  assert.equal(adapter.capabilities.toolTemperatures, true);
  assert.equal(adapter.capabilities.fileUpload, true);
  assert.equal(adapter.capabilities.chamberTemperatureSensor, true);
  assert.equal(adapter.capabilities.chamberFan, true);
  assert.equal(adapter.capabilities.filtration, true);
  assert.equal(adapter.capabilities.bedLeveling, true);
  assert.equal(adapter.capabilities.levelBeforePrint, true);
  assert.equal(adapter.capabilities.chamberPreheat, true);
  assert.equal(adapter.capabilities.materialStatus, true);
  assert.equal(adapter.capabilities.filamentTypeControl, true);
  assert.equal(adapter.capabilities.filamentColorControl, true);
  assert.equal(adapter.capabilities.timeLapseBeforePrint, true);
  assert.equal(adapter.capabilities.autoFilamentReplenishment, true);
  assert.equal(adapter.capabilities.filamentEntanglementDetection, true);
  assert.equal(adapter.capabilities.toolheadNozzleStatus, true);
  assert.equal(adapter.capabilities.toolheadOffsetCalibration, true);
  assert.equal(adapter.limits.toolCount, 4);
  assert.equal(adapter.limits.nozzleTemperature.max, 300);
  assert.equal(adapter.limits.bedTemperature.max, 100);
  assert.equal(adapter.limits.filtrationSpeed.max, 100);
  assert.equal(adapter.limits.chamberPreheatBedTemperature.max, 100);
  assert.equal(adapter.limits.chamberPreheatCirculationFan.default, 60);
});

test('U1 material query is optional and cannot take core status polling offline', async () => {
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/printer/info') {
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:{ hostname:'U1', software_version:'test' } }));
      return;
    }
    if (url.pathname === '/printer/objects/query' && url.search.includes('filament_detect')) {
      res.writeHead(400, { 'content-type':'application/json' });
      res.end(JSON.stringify({ error:{ message:'Unknown object filament_detect' } }));
      return;
    }
    if (url.pathname === '/printer/objects/query') {
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:{ status:{
        webhooks:{ state:'ready' }, print_stats:{ state:'standby' }, virtual_sdcard:{ progress:0 }, display_status:{ progress:0 },
        heater_bed:{ temperature:24, target:0 }, extruder:{ temperature:25, target:0 }, extruder1:{}, extruder2:{}, extruder3:{},
        toolhead:{ extruder:'extruder' }, 'temperature_sensor cavity':{ temperature:26 }, 'fan_generic cavity_fan':{ speed:0 }, purifier:{ power_detected:false }
      } } }));
      return;
    }
    res.writeHead(404); res.end();
  });
  try {
    const status = await getMoonrakerStatus({ host:'127.0.0.1', httpPort:port, adapterConfig:{} });
    assert.equal(status.status, 'idle');
    assert.equal(status.bed.actual, 24);
    assert.equal(status.materials.available, false);
  } finally {
    await close(server);
  }
});

test('orders Moonraker files by last printed history before remaining files', () => {
  const ordered = orderMoonrakerFilesByHistory([
    { path:'alpha.gcode', modified:5 },
    { path:'zeta.gcode', modified:20 },
    { path:'fixture.gcode', modified:10 }
  ], [
    { filename:'fixture.gcode' },
    { filename:'alpha.gcode' }
  ]);
  assert.deepEqual(ordered.map((item) => item.path), ['fixture.gcode', 'alpha.gcode', 'zeta.gcode']);
});


test('U1 manual filament colour uses the touchscreen-native command and verifies printer read-back', async () => {
  const scripts = [];
  let reportedColor = '112233FF';
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/printer/objects/query') {
      const wantsPrintStats = url.search.includes('print_stats');
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:{ status:{
        ...(wantsPrintStats ? { print_stats:{ state:'standby' } } : {}),
        print_task_config:{
          filament_exist:[true,false,false,false],
          filament_edit:[true,false,false,false],
          filament_official:[false,false,false,false],
          filament_type:['PETG','NONE','NONE','NONE'],
          filament_color_rgba:[reportedColor,'FFFFFFFF','FFFFFFFF','FFFFFFFF']
        }
      } } }));
      return;
    }
    if (url.pathname === '/printer/gcode/script') {
      scripts.push(url.searchParams.get('script'));
      reportedColor = 'A1B2C3FF';
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:'ok' }));
      return;
    }
    res.writeHead(404); res.end();
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    const result = await setMoonrakerFilamentColor(printer, { toolIndex:0, color:'#A1B2C3' });
    assert.equal(scripts[0], "SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER='0' FILAMENT_COLOR_RGBA='A1B2C3FF' SAVE='1'");
    assert.deepEqual(result, { toolIndex:0, color:'#A1B2C3', rgba:'A1B2C3FF', verified:true });
  } finally {
    await close(server);
  }
});

test('U1 third-party filament type uses the native generic profile command and verifies printer read-back', async () => {
  const scripts = [];
  let reportedMaterial = 'PLA';
  let reportedVendor = 'generic';
  let reportedSubtype = 'generic';
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/printer/objects/query') {
      const wantsPrintStats = url.search.includes('print_stats');
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:{ status:{
        ...(wantsPrintStats ? { print_stats:{ state:'standby' } } : {}),
        print_task_config:{
          filament_exist:[true,false,false,false],
          filament_edit:[true,false,false,false],
          filament_official:[false,false,false,false],
          filament_vendor:[reportedVendor,'NONE','NONE','NONE'],
          filament_type:[reportedMaterial,'NONE','NONE','NONE'],
          filament_sub_type:[reportedSubtype,'NONE','NONE','NONE'],
          filament_color_rgba:['112233FF','FFFFFFFF','FFFFFFFF','FFFFFFFF']
        }
      } } }));
      return;
    }
    if (url.pathname === '/printer/gcode/script') {
      scripts.push(url.searchParams.get('script'));
      reportedMaterial = 'PETG-CF';
      reportedVendor = 'generic';
      reportedSubtype = 'generic';
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:'ok' }));
      return;
    }
    res.writeHead(404); res.end();
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    const result = await setMoonrakerFilamentType(printer, { toolIndex:0, material:'petg-cf' });
    assert.equal(scripts[0], "SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER='0' VENDOR='generic' FILAMENT_TYPE='PETG-CF' FILAMENT_SUBTYPE='generic' SAVE='1'");
    assert.deepEqual(result, { toolIndex:0, material:'PETG-CF', vendor:'generic', subtype:'generic', verified:true });
  } finally {
    await close(server);
  }
});

test('U1 filament type write rejects unsupported, busy, empty, and RFID-locked changes', async () => {
  let state = 'printing';
  let exists = true;
  let official = false;
  let editable = true;
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/printer/objects/query') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:{ status:{
      print_stats:{ state },
      print_task_config:{
        filament_exist:[exists,false,false,false],
        filament_edit:[editable,false,false,false],
        filament_official:[official,false,false,false]
      }
    } } }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await assert.rejects(() => setMoonrakerFilamentType(printer, { toolIndex:0, material:'UNKNOWN' }), /Unsupported U1 filament type/);
    await assert.rejects(() => setMoonrakerFilamentType(printer, { toolIndex:0, material:'PLA' }), /only be changed while the printer is idle/);
    state = 'standby'; exists = false;
    await assert.rejects(() => setMoonrakerFilamentType(printer, { toolIndex:0, material:'PLA' }), /No filament is loaded/);
    exists = true; official = true; editable = false;
    await assert.rejects(() => setMoonrakerFilamentType(printer, { toolIndex:0, material:'PLA' }), /locked by its official Snapmaker RFID filament/);
  } finally {
    await close(server);
  }
});

test('U1 filament colour write refuses busy, empty, and RFID-locked toolheads', async () => {
  let state = 'printing';
  let exists = true;
  let official = false;
  let editable = true;
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/printer/objects/query') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:{ status:{
      print_stats:{ state },
      print_task_config:{
        filament_exist:[exists,false,false,false],
        filament_edit:[editable,false,false,false],
        filament_official:[official,false,false,false],
        filament_type:['PLA','NONE','NONE','NONE'],
        filament_color_rgba:['112233FF','FFFFFFFF','FFFFFFFF','FFFFFFFF']
      }
    } } }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await assert.rejects(() => setMoonrakerFilamentColor(printer, { toolIndex:0, color:'#334455' }), /only be changed while the printer is idle/);
    state = 'standby'; exists = false;
    await assert.rejects(() => setMoonrakerFilamentColor(printer, { toolIndex:0, color:'#334455' }), /No filament is loaded/);
    exists = true; official = true; editable = false;
    await assert.rejects(() => setMoonrakerFilamentColor(printer, { toolIndex:0, color:'#334455' }), /locked by its official Snapmaker RFID filament/);
  } finally {
    await close(server);
  }
});

test('tool-specific and all-tool U1 temperature commands use native Klipper heater names', async () => {
  const scripts = [];
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/printer/gcode/script') scripts.push(url.searchParams.get('script'));
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:'ok' }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await setMoonrakerTemperatures(printer, { toolIndex:3, nozzle:245, bed:80 });
    await setMoonrakerTemperatures(printer, { nozzle:0, allTools:true });
    assert.match(scripts[0], /HEATER=heater_bed TARGET=80/);
    assert.match(scripts[0], /HEATER=extruder3 TARGET=245/);
    assert.match(scripts[1], /HEATER=extruder TARGET=0/);
    assert.match(scripts[1], /HEATER=extruder1 TARGET=0/);
    assert.match(scripts[1], /HEATER=extruder2 TARGET=0/);
    assert.match(scripts[1], /HEATER=extruder3 TARGET=0/);
  } finally {
    await close(server);
  }
});



test('U1 native chamber preheat uses purifier preheat mode and clean idle shutdown', async () => {
  const scripts = [];
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/printer/gcode/script') scripts.push(url.searchParams.get('script'));
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:'ok' }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await startMoonrakerChamberPreheat(printer);
    await stopMoonrakerChamberPreheat(printer);
    assert.equal(scripts[0], 'SET_PURIFIER_MODE MODE=2 DESIRE_TEMP=0 FAN_SPEED=0.6 DELAY_OFF=0');
    assert.equal(scripts[1], 'SET_PURIFIER_MODE MODE=0 EXHAUST_FAN_DELAY_OFF=0 INNER_FAN_DELAY_OFF=0');
  } finally {
    await close(server);
  }
});

test('U1 chamber fan and purifier controls use stock Klipper commands', async () => {
  const scripts = [];
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/printer/gcode/script') scripts.push(url.searchParams.get('script'));
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:'ok' }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await setMoonrakerFans(printer, { chamberFan:35 });
    await setMoonrakerFiltration(printer, { internal:65, external:20 });
    assert.equal(scripts[0], 'SET_FAN_SPEED FAN=cavity_fan SPEED=0.35');
    assert.match(scripts[1], /SET_PURIFIER FAN=inner SPEED=0\.65 DELAY_OFF=0/);
    assert.match(scripts[1], /SET_PURIFIER FAN=exhaust SPEED=0\.2 DELAY_OFF=0/);
    await assert.rejects(() => setMoonrakerFans(printer, { chamberFan:101 }), /0-100%/);
    await assert.rejects(() => setMoonrakerFiltration(printer, { internal:101 }), /0-100%/);
  } finally {
    await close(server);
  }
});

test('U1 print start sets the native per-print bed-level preference before starting', async () => {
  const requests = [];
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path:url.pathname, script:url.searchParams.get('script'), filename:url.searchParams.get('filename') });
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:'ok' }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await printMoonrakerFile(printer, 'level-me.gcode', true);
    assert.equal(requests[0].path, '/printer/gcode/script');
    assert.equal(requests[0].script, 'SET_PRINT_PREFERENCES BED_LEVEL=1 FLOW_CALIBRATE=0');
    assert.equal(requests[1].path, '/printer/print/start');
    assert.equal(requests[1].filename, 'level-me.gcode');

    requests.length = 0;
    await printMoonrakerFile(printer, 'skip-level.gcode', false);
    assert.equal(requests[0].script, 'SET_PRINT_PREFERENCES BED_LEVEL=0 FLOW_CALIBRATE=0');
    assert.equal(requests[1].filename, 'skip-level.gcode');
  } finally {
    await close(server);
  }
});

test('U1 print setup uses Moonraker referenced tools, colors, materials and weights', async () => {
  const gcode = '; filament_colour = #FF0000;#00FF00;#0000FF\nT0\nT2\n';
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/server/files/metadata') {
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:{
        size:Buffer.byteLength(gcode), slicer:'Snapmaker Orca', slicer_version:'2.3.5',
        referenced_tools:[0,2], filament_colors:['#FF0000','#00FF00','#0000FF'],
        filament_type:'PLA;PETG;ABS', filament_weights:[12.5,0,7.25], nozzle_diameter:[0.4,0.4,0.6]
      } }));
      return;
    }
    if (url.pathname === '/server/files/gcodes/multi.gcode') {
      res.writeHead(206, { 'content-type':'text/plain' });
      res.end(gcode);
      return;
    }
    res.writeHead(404); res.end();
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    const setup = await getMoonrakerPrintSetup(printer, 'multi.gcode');
    assert.deepEqual(setup.referencedTools, [0,2]);
    assert.equal(setup.logicalTools.length, 2);
    assert.deepEqual(setup.logicalTools[0], { index:0, color:'#FF0000', material:'PLA', name:null, weightGrams:12.5, nozzleDiameter:0.4 });
    assert.deepEqual(setup.logicalTools[1], { index:2, color:'#0000FF', material:'ABS', name:null, weightGrams:7.25, nozzleDiameter:0.6 });
    assert.equal(setup.usageReliable, true);
    assert.equal(setup.source, 'moonraker-metadata');
  } finally {
    await close(server);
  }
});

test('U1 print start applies logical tool mapping, used heads and flow calibration before start', async () => {
  const requests = [];
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path:url.pathname, script:url.searchParams.get('script'), filename:url.searchParams.get('filename') });
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:'ok' }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await printMoonrakerFile(printer, 'mapped.gcode', {
      levelingBeforePrint:true,
      flowCalibrationBeforePrint:true,
      usedLogicalTools:[0,2],
      toolMap:{ 0:3, 2:1 }
    });
    assert.equal(requests[0].path, '/printer/gcode/script');
    assert.equal(requests[0].script, [
      'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=3',
      'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=2 MAP_EXTRUDER=1',
      'SET_PRINT_USED_EXTRUDERS EXTRUDERS=3,1',
      'SET_PRINT_PREFERENCES BED_LEVEL=1 FLOW_CALIBRATE=1'
    ].join('\n'));
    assert.equal(requests[1].path, '/printer/print/start');
    assert.equal(requests[1].filename, 'mapped.gcode');
    await assert.rejects(() => printMoonrakerFile(printer, 'bad.gcode', {
      usedLogicalTools:[0,1], toolMap:{ 0:0 }
    }), /No physical U1 tool mapping supplied for logical T1/);
  } finally {
    await close(server);
  }
});

test('U1 print start applies native timelapse, replenishment and entanglement preferences', async () => {
  const requests = [];
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path:url.pathname, script:url.searchParams.get('script'), filename:url.searchParams.get('filename') });
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ result:'ok' }));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await printMoonrakerFile(printer, 'safe.gcode', {
      levelingBeforePrint:true,
      flowCalibrationBeforePrint:false,
      timeLapseBeforePrint:true,
      autoReplenishFilament:true,
      filamentEntangleDetect:true,
      filamentEntangleSensitivity:'high'
    });
    assert.equal(requests[0].script, 'SET_PRINT_PREFERENCES BED_LEVEL=1 FLOW_CALIBRATE=0 TIME_LAPSE_CAMERA=1 AUTO_REPLENISH_FILAMENT=1 FILAMENT_ENTANGLE_DETECT=1 FILAMENT_ENTANGLE_SEN=high');
    assert.equal(requests[1].filename, 'safe.gcode');
    await assert.rejects(() => printMoonrakerFile(printer, 'bad-sensitivity.gcode', {
      filamentEntangleDetect:true, filamentEntangleSensitivity:'extreme'
    }), /sensitivity must be low, medium, or high/);
  } finally {
    await close(server);
  }
});

test('U1 bed levelling uses the stock heated mesh macro and refuses an active print', async () => {
  const scripts = [];
  let state = 'standby';
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body;
    if (url.pathname === '/printer/objects/query') {
      body = { result:{ status:{ webhooks:{ state:'ready' }, print_stats:{ state }, virtual_sdcard:{ progress:0 }, display_status:{ progress:0 }, heater_bed:{ temperature:25, target:0 }, extruder:{}, extruder1:{}, extruder2:{}, extruder3:{}, toolhead:{ extruder:'extruder' }, 'temperature_sensor cavity':{ temperature:25 }, 'fan_generic cavity_fan':{ speed:0 }, purifier:{ power_detected:false } } } };
    } else if (url.pathname === '/printer/info') {
      body = { result:{ hostname:'U1', software_version:'test' } };
    } else if (url.pathname === '/printer/gcode/script') {
      scripts.push(url.searchParams.get('script'));
      body = { result:'ok' };
    } else {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(body));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await levelMoonrakerBed(printer);
    assert.equal(scripts[0], 'AUTO_BED_MESH_CALIBRATE');
    state = 'printing';
    await assert.rejects(() => levelMoonrakerBed(printer), /only be started while the U1 is idle/);
  } finally {
    await close(server);
  }
});

test('U1 XYZ toolhead calibration uses the stock staged calibration commands', async () => {
  const scripts = [];
  let printState = 'standby';
  let calibrationStep = 'ready';
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body;
    if (url.pathname === '/printer/objects/query') {
      body = { result:{ status:{
        webhooks:{ state:'ready' }, print_stats:{ state:printState }, virtual_sdcard:{ progress:0 }, display_status:{ progress:0 },
        heater_bed:{ temperature:25, target:0 }, extruder:{ nozzle_diameter:0.4, extruder_offset:[0,0,0] },
        extruder1:{ nozzle_diameter:0.4, extruder_offset:[10,0,0] }, extruder2:{ nozzle_diameter:0.4, extruder_offset:[20,0,0] }, extruder3:{ nozzle_diameter:0.4, extruder_offset:[30,0,0] },
        toolhead:{ extruder:'extruder' }, 'temperature_sensor cavity':{ temperature:25 }, 'fan_generic cavity_fan':{ speed:0 }, purifier:{ power_detected:false },
        extruder_offset_calibration:{
          calibration_step:calibrationStep, bed_plate_check:false, is_prehoming:true,
          extruder_nozzle_clean:calibrationStep === 'extruder_nozzle_clean',
          extruder1_nozzle_clean:calibrationStep === 'extruder1_nozzle_clean',
          extruder2_nozzle_clean:calibrationStep === 'extruder2_nozzle_clean',
          extruder3_nozzle_clean:calibrationStep === 'extruder3_nozzle_clean'
        }
      } } };
    } else if (url.pathname === '/printer/info') {
      body = { result:{ hostname:'U1', software_version:'test' } };
    } else if (url.pathname === '/printer/gcode/script') {
      scripts.push(url.searchParams.get('script'));
      body = { result:'ok' };
    } else {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(body));
  });
  const printer = { host:'127.0.0.1', httpPort:port, adapterConfig:{} };
  try {
    await calibrateMoonrakerToolOffsets(printer, { action:'start' });
    calibrationStep = 'extruder_nozzle_clean';
    await calibrateMoonrakerToolOffsets(printer, { action:'advance-cleaning', toolIndex:0 });
    calibrationStep = 'extruder3_nozzle_clean';
    await calibrateMoonrakerToolOffsets(printer, { action:'advance-cleaning', toolIndex:3 });
    await calibrateMoonrakerToolOffsets(printer, { action:'check-plate' });
    await calibrateMoonrakerToolOffsets(printer, { action:'calibrate-tool', toolIndex:2 });
    await calibrateMoonrakerToolOffsets(printer, { action:'save' });
    await calibrateMoonrakerToolOffsets(printer, { action:'exit' });
    assert.equal(scripts[0], [
      'EXTRUDER_OFFSET_ACTION_PRESTART',
      'EXTRUDER_OFFSET_ACTION_PREHOMING',
      'EXTRUDER_OFFSET_ACTION_HEAT TOOL_ID=T0',
      'EXTRUDER_OFFSET_ACTION_AUTO_CLEAN TOOL_ID=T0',
      'EXTRUDER_OFFSET_ACTION_MANUAL_CLEAN TOOL_ID=T0'
    ].join('\n'));
    assert.equal(scripts[1], [
      'EXTRUDER_OFFSET_ACTION_WAIT_COOL TOOL_ID=T0 TEMP=140',
      'EXTRUDER_OFFSET_ACTION_HEAT TOOL_ID=T1',
      'EXTRUDER_OFFSET_ACTION_AUTO_CLEAN TOOL_ID=T1',
      'EXTRUDER_OFFSET_ACTION_MANUAL_CLEAN TOOL_ID=T1'
    ].join('\n'));
    assert.equal(scripts[2], 'EXTRUDER_OFFSET_ACTION_WAIT_COOL TOOL_ID=T3 TEMP=140');
    assert.equal(scripts[3], 'EXTRUDER_OFFSET_ACTION_DETECT_PLATE PRESENCE=0');
    assert.equal(scripts[4], 'EXTRUDER_OFFSET_ACTION_PROBE_CALIBRATE TOOL_ID=T2');
    assert.equal(scripts[5], 'EXTRUDER_OFFSET_ACTION_SAVE_RESULT FORCE_SAVE=0');
    assert.equal(scripts[6], 'EXTRUDER_OFFSET_ACTION_EXIT');
    await assert.rejects(() => calibrateMoonrakerToolOffsets(printer, { action:'calibrate-tool', toolIndex:4 }), /Tool index must be 0-3/);
    printState = 'printing';
    await assert.rejects(() => calibrateMoonrakerToolOffsets(printer, { action:'start' }), /only run while the printer is idle/);
  } finally {
    await close(server);
  }
});


test('Moonraker upload streams multipart G-code with checksum verification field', async () => {
  let received = Buffer.alloc(0);
  let contentType = '';
  const { server, port } = await listen((req, res) => {
    contentType = String(req.headers['content-type'] || '');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ result:{ item:{ path:'u1-test.gcode', root:'gcodes' } } }));
    });
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'u1-upload-test-'));
  const filePath = path.join(dir, 'u1-test.gcode');
  await fs.writeFile(filePath, 'G28\nG1 X10 Y10\n');
  try {
    const result = await uploadMoonrakerFile({ host:'127.0.0.1', httpPort:port, adapterConfig:{} }, filePath);
    assert.equal(result.item.path, 'u1-test.gcode');
    assert.match(contentType, /multipart\/form-data; boundary=/);
    const text = received.toString('utf8');
    assert.match(text, /name="root"/);
    assert.match(text, /gcodes/);
    assert.match(text, /name="checksum"/);
    assert.match(text, /filename="u1-test.gcode"/);
    assert.match(text, /G28/);
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
    await close(server);
  }
});

test('Snapmaker U1 discovery recognises four tools plus Snapmaker-specific printer objects', async () => {
  assert.equal(isSnapmakerU1ObjectList(['extruder','extruder1','extruder2','extruder3','print_task_config']), true);
  assert.equal(isSnapmakerU1ObjectList(['extruder','extruder1','extruder2','extruder3']), false);

  const { server, port } = await listen((req, res) => {
    let body;
    if (req.url === '/server/info') body = { result:{ moonraker_version:'u1-moonraker' } };
    else if (req.url === '/printer/objects/list') body = { result:{ objects:['extruder','extruder1','extruder2','extruder3','print_task_config','temperature_sensor cavity'] } };
    else if (req.url === '/printer/info') body = { result:{ hostname:'Snapmaker-U1', software_version:'U1-test' } };
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify(body));
  });
  try {
    const result = await probeSnapmakerU1('127.0.0.1', { ports:[port], timeoutMs:500 });
    assert.equal(result.adapterType, 'snapmaker-u1');
    assert.equal(result.model, 'U1');
    assert.equal(result.name, 'Snapmaker-U1');
    assert.equal(result.httpPort, port);
  } finally {
    await close(server);
  }
});

test('U1 subnet discovery stays bounded to the local /24', () => {
  const candidates = localDiscoveryCandidates({
    Ethernet: [{ family:'IPv4', internal:false, address:'192.168.50.10' }],
    Loopback: [{ family:'IPv4', internal:true, address:'127.0.0.1' }]
  });
  assert.equal(candidates.length, 253);
  assert.ok(candidates.includes('192.168.50.1'));
  assert.ok(candidates.includes('192.168.50.254'));
  assert.ok(!candidates.includes('192.168.50.10'));
});
