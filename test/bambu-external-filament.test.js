import test from 'node:test';
import assert from 'node:assert/strict';
import { bambuExternalFilamentCommand, setBambuExternalFilament, BAMBU_EXTERNAL_FILAMENT_PRESETS } from '../src/bambu-external-filament.js';
import { BambuLabAdapter } from '../src/adapters/bambu-lab-adapter.js';
import { createEmulator } from '../emulator/server.js';

test('P1P/P1S external spool has correct MQTT address, generic preset and opaque RGBA colour', () => {
  const command=bambuExternalFilamentCommand({toolIndex:0,material:'PETG',color:'#12ab34'});
  assert.equal(command.print.command,'ams_filament_setting');
  assert.equal(command.print.ams_id,255);
  assert.equal(command.print.slot_id,0);
  assert.equal(command.print.tray_id,254);
  assert.equal(command.print.tray_info_idx,'GFG99');
  assert.equal(command.print.tray_color,'12AB34FF');
  assert.equal(command.print.tray_type,'PETG');
  assert.equal(command.print.nozzle_temp_min,220);
  assert.equal(command.print.nozzle_temp_max,260);
  assert.deepEqual(Object.keys(BAMBU_EXTERNAL_FILAMENT_PRESETS).sort(),
    ['PLA','PLA-CF','PETG','PETG-CF','ABS','ASA','TPU','PVA','PA','PA-CF','PC'].sort());
});

test('changing only colour preserves existing filament variant and nozzle temperatures', () => {
  const command=bambuExternalFilamentCommand({
    toolIndex:0,material:'PLA',color:'#FF0000',
    currentTray:{tray_type:'PLA',tray_info_idx:'GFA01',nozzle_temp_min:'195',nozzle_temp_max:'225'}
  });
  assert.equal(command.print.tray_info_idx,'GFA01');
  assert.equal(command.print.nozzle_temp_min,195);
  assert.equal(command.print.nozzle_temp_max,225);
  const changed=bambuExternalFilamentCommand({
    toolIndex:0,material:'ABS',color:'#0066FF',
    currentTray:{tray_type:'PLA',tray_info_idx:'GFA01',nozzle_temp_min:195,nozzle_temp_max:225}
  });
  assert.equal(changed.print.tray_info_idx,'GFB99');
  assert.equal(changed.print.nozzle_temp_min,240);
  assert.equal(changed.print.nozzle_temp_max,270);
});

test('rejects incorrect tool index, unsupported filament and invalid colours', () => {
  for (const request of [
    {toolIndex:1,material:'PLA',color:'#FFFFFF'},
    {toolIndex:0,material:'NOT-REAL',color:'#FFFFFF'},
    {toolIndex:0,material:'PLA',color:'#FF'},
    {toolIndex:0,material:'PLA',color:'red'}
  ]) assert.throws(()=>bambuExternalFilamentCommand(request));
});

test('write is verified from the external tray even when an AMS tray is active', async () => {
  const printer={model:'P1S'};
  let report={print:{
    gcode_state:'IDLE',tray_now:'0',
    vt_tray:{tray_type:'PLA',tray_color:'FFFFFFFF',tray_info_idx:'GFL99'},
    ams:{ams:[{tray:[{tray_type:'ABS',tray_color:'000000FF'}]}]}
  }};
  let sent=null;
  const result=await setBambuExternalFilament(printer,{toolIndex:0,material:'PETG',color:'#3366CC'},{
    getReport:async()=>report,
    sendCommand:async(_printer,command)=>{
      sent=command;
      report={print:{...report.print,vt_tray:{tray_type:'PETG',tray_color:'3366CCFF'}}};
      return {ok:true};
    },
    sleep:async()=>{}
  });
  assert.equal(sent.print.tray_id,254);
  assert.deepEqual(result,{material:'PETG',color:'#3366CC',verified:true});
  assert.equal(report.print.ams.ams[0].tray[0].tray_type,'ABS');
});

test('write rejects non-idle printers and refuses to claim success without reported confirmation', async () => {
  let sendCalls=0;
  await assert.rejects(setBambuExternalFilament({model:'P1P'},{toolIndex:0,material:'PLA',color:'#FF0000'},{
    getReport:async()=>({print:{gcode_state:'RUNNING'}}),
    sendCommand:async()=>{sendCalls++;},
    sleep:async()=>{}
  }),/idle/);
  assert.equal(sendCalls,0);
  await assert.rejects(setBambuExternalFilament({model:'P1P'},{toolIndex:0,material:'PLA',color:'#FF0000'},{
    getReport:async()=>({print:{gcode_state:'IDLE',vt_tray:{tray_type:'PETG',tray_color:'FFFFFFFF'}}}),
    sendCommand:async()=>{sendCalls++;},
    sleep:async()=>{}
  }),/did not confirm/);
  assert.equal(sendCalls,1);
  await assert.rejects(setBambuExternalFilament({model:'X1C'},{toolIndex:0,material:'PLA',color:'#FF0000'}),/only for P1P\/P1S/);
});

test('P1P and P1S simulator updates the external spool through real TLS MQTT without editing AMS', async () => {
  const emulator=createEmulator({managementPort:0,withDefaults:false});
  await emulator.start();
  try {
    for (const model of ['P1P','P1S']) {
      const virtual=await emulator.addPrinter({profileId:model==='P1P'?'bambu-p1p':'bambu-p1s',
        ports:{mqttPort:0,ftpsPort:0,cameraPort:0}});
      const adapter=new BambuLabAdapter({
        model,host:virtual.host,serialNumber:virtual.serialNumber,
        checkCode:virtual.accessCode,mqttPort:virtual.ports.mqttPort
      });
      assert.equal(adapter.capabilities.filamentTypeControl,true);
      assert.equal(adapter.capabilities.filamentColorControl,true);
      const before=await adapter.getStatus();
      const previousAms=before.materialSources.filter((source)=>source.kind==='ams');
      const updated=await adapter.setFilamentConfig({toolIndex:0,material:'ASA',color:'#FF0000'});
      assert.equal(updated.verified,true);
      const after=await adapter.getStatus();
      assert.equal(after.materialSources.find((source)=>source.kind==='external').material,'ASA');
      assert.equal(after.materialSources.find((source)=>source.kind==='external').color,'#FF0000');
      assert.deepEqual(after.materialSources.filter((source)=>source.kind==='ams'),previousAms);
    }
  } finally {
    await emulator.stop();
  }
});
