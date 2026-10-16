import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const preact=readFileSync(new URL('../ui/printer-details.jsx',import.meta.url),'utf8');

test('P1P and P1S external-spool controls use the shared compact Set filament design', () => {
  const start=app.indexOf('function bambuExternalFilamentControlMarkup(');
  const end=app.indexOf('function u1FilamentConfigEditState(',start);
  const markup=app.slice(start,end);
  assert.ok(start!==-1 && end>start);
  assert.match(markup,/P1P','P1S/);
  assert.match(markup,/bambu-external-title/);
  assert.match(markup,/data-preact-toolhead-control="bambu-filament"/);
  assert.match(markup,/toolhead-dropdown-pair/);
  assert.match(markup,/<label>Filament type/);
  assert.match(markup,/<label>Colour/);
  assert.match(markup,/class="primary toolhead-action-button" data-bambu-external-save/);
  assert.match(markup,/>Set filament<\/button>/);
  assert.match(css,/\.material-panel \.bambu-external-filament-control select,/);
  assert.match(css,/\.material-panel \.bambu-external-filament-control \.color-family-dropdown,/);
  assert.match(css,/\.material-panel \.bambu-external-filament-control > \.toolhead-designation-editor,/);
  assert.match(preact,/control\.mode==='bambu-filament'/);
});

test('P1P/P1S external spool is editable only when idle; X1C and A1 Mini are unchanged', () => {
  const start=app.indexOf('function bambuExternalFilamentEditState(');
  const end=app.indexOf('function bambuExternalFilamentControlMarkup(',start);
  assert.ok(start>=0 && end>start);
  const getState=runInNewContext(app.slice(start,end)+'\nbambuExternalFilamentEditState',{});
  const printer=(model,status)=>({
    adapterType:'bambu-lab',model,status:{status},
    capabilities:{filamentTypeControl:true,filamentColorControl:true}
  });
  for(const model of ['P1P','P1S']){
    assert.equal(getState(printer(model,'idle')).enabled,true);
    assert.equal(getState(printer(model,'printing')).enabled,false);
    assert.equal(getState(printer(model,'paused')).enabled,false);
  }
  for(const model of ['X1C','A1 Mini'])
    assert.equal(getState(printer(model,'idle')).enabled,false);
});

test('save flow applies P1 external spool state separately and retains AMS slot data', () => {
  const start=app.indexOf('function applyBambuExternalFilamentResult(');
  const end=app.indexOf('const pendingToolheadDesignations',start);
  const apply=runInNewContext(app.slice(start,end)+'\napplyBambuExternalFilamentResult',{
    normalizeColor:(value)=>value,filamentColorFamilyFromHex:()=> 'red'
  });
  const printer={status:{
    materialSources:[
      {kind:'external',material:'PLA',color:'#FFFFFF',active:false},
      {kind:'ams',material:'PETG',color:'#00FF00',active:true}
    ],
    tools:[{filament:{material:'PETG',color:'#00FF00'}}]
  }};
  apply(printer,{material:'ABS',color:'#FF0000'});
  assert.equal(printer.status.materialSources[0].material,'ABS');
  assert.equal(printer.status.materialSources[0].color,'#FF0000');
  assert.equal(printer.status.materialSources[1].material,'PETG');
  assert.equal(printer.status.tools[0].filament.material,'PETG');
});
