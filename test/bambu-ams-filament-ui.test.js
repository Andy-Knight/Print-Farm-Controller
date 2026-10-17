import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const preact=readFileSync(new URL('../ui/printer-details.jsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');

test('AMS slot editor permits manual non-RFID spools only on idle supported printers',()=>{
  const a=app.indexOf('function bambuAmsFilamentEditState(');
  const b=app.indexOf('function bambuAmsFilamentControlMarkup(',a);
  const fn=runInNewContext(app.slice(a,b)+'\nbambuAmsFilamentEditState',{});
  const printer=(model,status)=>({adapterType:'bambu-lab',model,status:{status},
    capabilities:{filamentTypeControl:true,filamentColorControl:true}});
  const manual={kind:'ams',present:true,rfidState:'manual'};
  for(const model of ['P1P','P1S','X1C']){
    assert.equal(fn(printer(model,'idle'),manual).enabled,true);
    assert.equal(fn(printer(model,'printing'),manual).enabled,false);
    assert.equal(fn(printer(model,'paused'),manual).enabled,false);
    assert.equal(fn(printer(model,'idle'),{...manual,rfidState:'rfid'}).enabled,false);
    assert.equal(fn(printer(model,'idle'),{...manual,rfidState:'unknown'}).enabled,false);
    assert.equal(fn(printer(model,'idle'),{...manual,present:false}).enabled,false);
  }
  assert.equal(fn(printer('A1 Mini','idle'),manual).enabled,false);
});

test('AMS renders per-slot controls in Preact and fallback while reusing theme and dropdown spacing',()=>{
  const a=app.indexOf('function bambuAmsFilamentControlMarkup(');
  const b=app.indexOf('function u1FilamentConfigEditState(',a);
  const markup=app.slice(a,b);
  assert.match(markup,/data-preact-toolhead-control="bambu-ams-filament"/);
  assert.match(markup,/data-tool-index="\$\{source\.protocolIndex\}"/);
  assert.match(markup,/data-bambu-ams-unit|data-ams-unit=/);
  assert.match(markup,/data-bambu-ams-material/);
  assert.match(markup,/data-bambu-ams-colour/);
  assert.match(markup,/class="primary toolhead-action-button" data-bambu-ams-save/);
  assert.match(app,/\$\{bambuAmsFilamentControlMarkup\(printer,source\)\}/);
  assert.match(app,/mode:'bambu-ams-filament',toolIndex:Number\(source\.protocolIndex\)/);
  assert.match(preact,/\['creator5-filament','bambu-filament','bambu-ams-filament'\]/);
  assert.match(styles,/\.ams-source > \.bambu-ams-filament-control/);
  assert.match(styles,/\.material-panel button\.toolhead-action-button/);
});

test('AMS save includes selected unit and slot, preserves other AMS sources and uses printer-side API',()=>{
  assert.match(server,/amsUnitIndex:body\.amsUnitIndex, amsSlotIndex:body\.amsSlotIndex/);
  assert.match(app,/amsUnitIndex:Math\.floor\(toolIndex\/4\),amsSlotIndex:toolIndex%4/);
  assert.match(app,/if\(mode==='bambu-ams-filament'\)applyBambuAmsFilamentResult/);
  assert.match(app,/data-bambu-ams-save/);
  const start=app.indexOf('function applyBambuAmsFilamentResult(');
  const end=app.indexOf('const pendingToolheadDesignations',start);
  const apply=runInNewContext(app.slice(start,end)+'\napplyBambuAmsFilamentResult',{
    normalizeColor:(value)=>value,filamentColorFamilyFromHex:()=> 'red'
  });
  const printer={status:{materialSources:[
    {kind:'ams',unitIndex:0,slotIndex:1,material:'PLA',color:'#FFFFFF',active:false},
    {kind:'ams',unitIndex:1,slotIndex:2,material:'PETG',color:'#000000',active:false},
    {kind:'external',material:'PLA',color:'#00FF00',active:true}
  ],tools:[{filament:{material:'PLA',color:'#00FF00'}}]}};
  apply(printer,{unitIndex:1,slotIndex:2,material:'ASA',color:'#FF0000'});
  assert.equal(printer.status.materialSources[1].material,'ASA');
  assert.equal(printer.status.materialSources[0].material,'PLA');
  assert.equal(printer.status.materialSources[2].material,'PLA');
  assert.equal(printer.status.tools[0].filament.material,'PLA');
  printer.status.materialSources[1].active=true;
  apply(printer,{unitIndex:1,slotIndex:2,material:'ABS',color:'#0066FF'});
  assert.equal(printer.status.tools[0].filament.material,'ABS');
});

test('simulator exposes RFID-managed toggle to validate read-only AMS slot UX',()=>{
  const simulator=readFileSync(new URL('../emulator/public/app.js',import.meta.url),'utf8');
  assert.match(simulator,/data-ams-rfid type="checkbox"/);
  assert.match(simulator,/rfid:slot\.querySelector\('\[data-ams-rfid\]'\)\.checked/);
});
