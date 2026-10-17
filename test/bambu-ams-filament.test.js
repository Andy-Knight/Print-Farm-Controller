import test from 'node:test';
import assert from 'node:assert/strict';
import { bambuAmsRfidState, bambuAmsSlotPresent, findBambuAmsSlot,
  bambuAmsFilamentCommand, setBambuAmsFilament } from '../src/bambu-ams-filament.js';
import { BambuLabAdapter, normalizeBambuMaterialSources } from '../src/adapters/bambu-lab-adapter.js';
import { createEmulator } from '../emulator/server.js';

const tray=(id,tag_uid='0000000000000000',type='PLA',color='FFFFFFFF')=>({
  id:String(id),tray_exist_bits:'1',tag_uid,tray_type:type,tray_color:color
});
const report=(slot=tray(2),gcode_state='IDLE')=>({print:{
  gcode_state,ams:{ams:[{id:'0',tray:[]},{id:'1',tray:[slot]}]},
  vt_tray:{tray_type:'PETG',tray_color:'3366CCFF'}
}});

test('RFID state fails closed if tag missing/unknown and identifies nonzero tags and spool UUIDs',()=>{
  assert.equal(bambuAmsRfidState({tag_uid:'0000000000000000'}),'manual');
  assert.equal(bambuAmsRfidState({tag_uid:'0',tray_uuid:'00000000000000000000000000000000'}),'manual');
  assert.equal(bambuAmsRfidState({tag_uid:'0102030405060708'}),'rfid');
  assert.equal(bambuAmsRfidState({tag_uid:'0',tray_uuid:'0123456789abcdef'}),'rfid');
  assert.equal(bambuAmsRfidState({}),'unknown');
  assert.equal(bambuAmsRfidState({tag_uid:'NOT-AVAILABLE'}),'unknown');
});

test('slot presence is based on printer occupancy flags, including unknown third-party material',()=>{
  const print={ams:{tray_exist_bits:'0020'}};
  const unknown={id:'1',tag_uid:'0',tray_type:'',tray_color:''};
  assert.equal(bambuAmsSlotPresent(print,1,1,unknown),true);
  assert.equal(bambuAmsSlotPresent(print,0,1,unknown),false);
  assert.equal(bambuAmsSlotPresent(print,1,1,{...unknown,tray_exist_bits:'0'}),false);
  assert.equal(findBambuAmsSlot({ams:{ams:[{id:'0',tray:[]},{id:'1',tray:[unknown]}],tray_exist_bits:'0020'}},1,1).rfidState,'manual');
});

test('builds physical AMS MQTT addressing and retains existing material variant when changing colour',()=>{
  const cmd=bambuAmsFilamentCommand({unitIndex:2,slotIndex:3,material:'PLA',color:'#CC2299',
    currentTray:{tray_type:'PLA',tray_info_idx:'GFA01',nozzle_temp_min:'195',nozzle_temp_max:'235'}});
  assert.equal(cmd.print.command,'ams_filament_setting');
  assert.equal(cmd.print.ams_id,2);
  assert.equal(cmd.print.tray_id,3);
  assert.equal(cmd.print.slot_id,3);
  assert.equal(cmd.print.tray_color,'CC2299FF');
  assert.equal(cmd.print.tray_info_idx,'GFA01');
  assert.equal(cmd.print.nozzle_temp_min,195);
  assert.equal(cmd.print.nozzle_temp_max,235);
  for(const ids of [[-1,0],[4,0],[0,4],[0,-1],[0,1.5]]) {
    assert.throws(()=>bambuAmsFilamentCommand({unitIndex:ids[0],slotIndex:ids[1],material:'PLA',color:'#000000'}));
  }
});

test('writer refuses empty, RFID, unknown UID, printing and unsupported models without MQTT writes',async()=>{
  let writes=0;
  const sendCommand=async()=>{writes++;};
  const sleep=async()=>{};
  const request={toolIndex:0,unitIndex:1,slotIndex:2,material:'PLA',color:'#112233'};
  for(const [status,expression] of [
    [report(tray(2),'RUNNING'),/idle/],
    [report(tray(2,'12345678')),/RFID-managed/],
    [report({...tray(2),tray_exist_bits:'0'}),/empty/],
    [report((({tag_uid,...rest})=>rest)(tray(2))),/RFID status/]
  ]){
    await assert.rejects(setBambuAmsFilament({model:'X1C'},request,{
      getReport:async()=>status,sendCommand,sleep
    }),expression);
  }
  await assert.rejects(setBambuAmsFilament({model:'Unsupported'},request,{getReport:async()=>report(),sendCommand,sleep}),/only for/);
  await assert.rejects(setBambuAmsFilament({model:'P1S'},{...request,unitIndex:99},{getReport:async()=>report(),sendCommand,sleep}),/valid AMS unit/);
  assert.equal(writes,0);
});

test('verified AMS write targets selected unit and preserves unrelated slots and external spool',async()=>{
  let status=report();
  let command;
  const result=await setBambuAmsFilament({model:'P1S'},{toolIndex:0,unitIndex:1,slotIndex:2,material:'ASA',color:'#11AA22'},{
    getReport:async()=>status,
    sendCommand:async(_printer,payload)=>{
      command=payload;
      status=report({...tray(2),tray_type:'ASA',tray_color:'11AA22FF'});
    },
    sleep:async()=>{}
  });
  assert.deepEqual(result,{unitIndex:1,slotIndex:2,material:'ASA',color:'#11AA22',verified:true});
  assert.equal(command.print.ams_id,1);
  assert.equal(command.print.tray_id,2);
  assert.equal(status.print.vt_tray.tray_type,'PETG');
});

test('writer does not report success merely because MQTT accepted a command',async()=>{
  await assert.rejects(setBambuAmsFilament({model:'P1P'},
    {unitIndex:1,slotIndex:2,material:'PETG',color:'#0066FF'},{
    getReport:async()=>report(),sendCommand:async()=>({ok:true}),sleep:async()=>{}
  }),/did not confirm/);
});

test('normalization marks RFID and unreported-tag AMS slots as read-only',()=>{
  const status=normalizeBambuMaterialSources({ams:{ams:[{id:'0',tray:[
    tray(0,'0000000000000000'),
    tray(1,'0102030405060708'),
    {id:'2',tray_type:'PLA',tray_color:'123456FF',tray_exist_bits:'1'}
  ]}]}});
  assert.deepEqual(status.filter(s=>s.kind==='ams').map(s=>[s.slotIndex,s.rfidState,s.editable]),
    [[0,'manual',true],[1,'rfid',false],[2,'unknown',false]]);
});

test('P1P, P1S and X1C virtual TLS MQTT AMS writes preserve RFID, other slots and external spool',async()=>{
  const emulator=createEmulator({managementPort:0,withDefaults:false});
  await emulator.start();
  try {
    for(const model of ['P1P','P1S','X1C']){
      const virtual=await emulator.addPrinter({profileId:`bambu-${model.toLowerCase()}`,
        ports:{mqttPort:0,ftpsPort:0,cameraPort:0}});
      const internal=emulator.printers.get(virtual.id);
      internal.configure({amsUnits:2,amsSlots:[
        {unitIndex:1,slotIndex:2,present:true,material:'PLA',color:'#FFFFFF',rfid:false},
        {unitIndex:0,slotIndex:1,present:true,material:'PETG',color:'#000000',rfid:true}
      ]});
      const adapter=new BambuLabAdapter({model,host:virtual.host,serialNumber:virtual.serialNumber,
        checkCode:virtual.checkCode,mqttPort:virtual.ports.mqttPort});
      const before=await adapter.getStatus();
      const ext=before.materialSources.find(s=>s.kind==='external');
      const rfid=before.materialSources.find(s=>s.id==='ams-0-1');
      assert.equal(rfid.rfidState,'rfid');
      const outcome=await adapter.setFilamentConfig({toolIndex:0,amsUnitIndex:1,amsSlotIndex:2,
        material:'ASA',color:'#CC3399'});
      assert.equal(outcome.verified,true);
      const after=await adapter.getStatus();
      assert.equal(after.materialSources.find(s=>s.id==='ams-1-2').material,'ASA');
      assert.equal(after.materialSources.find(s=>s.id==='ams-1-2').color,'#CC3399');
      assert.deepEqual(after.materialSources.find(s=>s.id==='ams-0-1'),rfid);
      assert.deepEqual(after.materialSources.find(s=>s.kind==='external'),ext);
      await assert.rejects(adapter.setFilamentConfig({toolIndex:0,amsUnitIndex:0,amsSlotIndex:1,
        material:'ABS',color:'#FF0000'}),/RFID-managed/);
      internal.configure({status:'printing'});
      await assert.rejects(adapter.setFilamentConfig({toolIndex:0,amsUnitIndex:1,amsSlotIndex:2,
        material:'PETG',color:'#000000'}),/idle/);
    }
  }finally{await emulator.stop();}
});
