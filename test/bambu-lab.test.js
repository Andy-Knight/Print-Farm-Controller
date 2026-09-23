import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBambuStatus, bambuAdapterInternals } from '../src/adapters/bambu-lab-adapter.js';
import { bambuCameraInternals } from '../src/bambu-camera.js';

test('normalizes Bambu P1 telemetry and external-spool material metadata', () => {
  const status = normalizeBambuStatus({ print: {
    gcode_state:'RUNNING',
    subtask_name:'bracket.3mf',
    mc_percent:42,
    mc_remaining_time:17,
    layer_num:84,
    total_layer_num:200,
    nozzle_temper:214.5,
    nozzle_target_temper:215,
    nozzle_diameter:'0.4',
    bed_temper:64.2,
    bed_target_temper:65,
    chamber_temper:37,
    cooling_fan_speed:'6',
    big_fan2_speed:'9',
    vt_tray:{ tray_type:'PETG', tray_color:'3366CCFF', tray_info_idx:'GFG99' }
  } }, { model:'P1S', adapterConfig:{} });

  assert.equal(status.status, 'printing');
  assert.equal(status.fileName, 'bracket.3mf');
  assert.equal(status.progress, 42);
  assert.equal(status.remainingSeconds, 1020);
  assert.equal(status.tools[0].nozzleDiameter, 0.4);
  assert.equal(status.tools[0].filament.material, 'PETG');
  assert.equal(status.tools[0].filament.color, '#3366CC');
  assert.equal(status.coolingFan, 40);
  assert.equal(status.chamberFan, 60);
});

test('active AMS tray takes precedence over configured external-spool metadata', () => {
  const status = normalizeBambuStatus({ print:{
    gcode_state:'IDLE',
    tray_now:'1',
    vt_tray:{ tray_type:'PLA', tray_color:'FFFFFFFF' },
    ams:{ ams:[{ tray:[
      { id:'0', tray_type:'ABS', tray_color:'FF0000FF' },
      { id:'1', tray_type:'ASA', tray_color:'112233FF' }
    ] }] }
  } }, { model:'P1S' });
  assert.equal(status.tools[0].filament.material, 'ASA');
  assert.equal(status.tools[0].filament.color, '#112233');
  assert.equal(status.amsAttached, true);
  assert.equal(status.materialSources.length, 3);
  assert.equal(status.materialSources.find((source) => source.active).label, 'AMS 1 · Slot 2');
  assert.equal(status.materialSources.find((source) => source.kind === 'external').protocolIndex, 254);
});

test('normalizes terminal Bambu states without letting retained filenames imply busy', () => {
  const completed = normalizeBambuStatus({ print:{ gcode_state:'FINISH', subtask_name:'retained.3mf', mc_percent:100 } }, { model:'P1P' });
  const cancelled = normalizeBambuStatus({ print:{ gcode_state:'FAILED', subtask_name:'retained.3mf', print_error:0 } }, { model:'P1P' });
  const failed = normalizeBambuStatus({ print:{ gcode_state:'FAILED', print_error:123 } }, { model:'P1P' });
  assert.equal(completed.status, 'completed');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(failed.status, 'failed');
});

test('normalizes X1C model telemetry without advertising the unsupported RTSPS camera', () => {
  const status = normalizeBambuStatus({ print:{
    gcode_state:'IDLE', nozzle_diameter:'0.4', chamber_temper:41,
    vt_tray:{ tray_type:'PA-CF', tray_color:'222222FF' }
  } }, { model:'X1C', adapterConfig:{} });
  assert.equal(status.model, 'X1C');
  assert.equal(status.chamber.actual, 41);
  assert.equal(status.lidarAvailable, true);
  assert.equal(status.cameraAvailable, false);
  assert.equal(status.tools[0].filament.material, 'PA-CF');
});

test('normalizes A1 Mini telemetry for TLS/JPEG camera and AMS Lite material sources', () => {
  const status = normalizeBambuStatus({ print:{
    gcode_state:'IDLE',
    nozzle_diameter:'0.4',
    bed_temper:25,
    tray_now:'0',
    ams:{ ams:[{ id:'0', tray:[
      { id:'0', tray_exist_bits:'1', tray_type:'PLA', tray_color:'00AAFFFF' },
      { id:'1', tray_exist_bits:'0', tray_type:'', tray_color:'' }
    ] }] }
  } }, { model:'A1-MINI', adapterConfig:{} });
  assert.equal(status.model, 'A1 Mini');
  assert.equal(status.status, 'idle');
  assert.equal(status.cameraAvailable, true);
  assert.equal(status.lidarAvailable, false);
  assert.equal(status.amsAttached, true);
  assert.equal(status.materialSources.find((source) => source.active).material, 'PLA');
  assert.equal(status.materialSources.find((source) => source.active).color, '#00AAFF');
});

test('builds Bambu project and raw G-code print commands', () => {
  const project = bambuAdapterInternals.printCommand('part.3mf', {
    levelingBeforePrint:false, flowCalibrationBeforePrint:true, timeLapseBeforePrint:true,
    materialMap:{ 0:2, 1:0 }, usedLogicalTools:[0,1]
  });
  assert.equal(project.print.command, 'project_file');
  assert.equal(project.print.url, 'file:///sdcard/part.3mf');
  assert.equal(project.print.bed_leveling, false);
  assert.equal(project.print.flow_cali, true);
  assert.equal(project.print.timelapse, true);
  assert.equal(project.print.use_ams, true);
  assert.deepEqual(project.print.ams_mapping, [2,0]);
  const external = bambuAdapterInternals.printCommand('single.3mf', { materialMap:{ 0:254 }, usedLogicalTools:[0] });
  assert.equal(external.print.use_ams, false);
  assert.deepEqual(external.print.ams_mapping, [254]);
  const gcode = bambuAdapterInternals.printCommand('part.gcode');
  assert.equal(gcode.print.command, 'gcode_file');
  assert.equal(gcode.print.param, 'part.gcode');
});

test('Bambu camera authentication packet carries the LAN credentials', () => {
  const packet = bambuCameraInternals.authPacket('12345678');
  assert.equal(packet.length, 80);
  assert.equal(packet.readUInt32LE(0), 0x40);
  assert.equal(packet.readUInt32LE(4), 0x3000);
  assert.equal(packet.subarray(16, 48).toString().replace(/\0.*$/, ''), 'bblp');
  assert.equal(packet.subarray(48, 80).toString().replace(/\0.*$/, ''), '12345678');
});
