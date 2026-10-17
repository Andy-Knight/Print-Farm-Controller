import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const preact=readFileSync(new URL('../ui/printer-details.jsx',import.meta.url),'utf8');

test('P1P, P1S and X1C external-spool controls use the shared compact Set filament design', () => {
  const start=app.indexOf('function bambuExternalFilamentControlMarkup(');
  const end=app.indexOf('function u1FilamentConfigEditState(',start);
  const markup=app.slice(start,end);
  assert.ok(start!==-1 && end>start);
  assert.match(markup,/P1P','P1S','X1C/);
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

test('P1P/P1S/X1C external spool is editable only when idle; A1 Mini remains disabled', () => {
  const start=app.indexOf('function bambuExternalFilamentEditState(');
  const end=app.indexOf('function bambuExternalFilamentControlMarkup(',start);
  assert.ok(start>=0 && end>start);
  const getState=runInNewContext(app.slice(start,end)+'\nbambuExternalFilamentEditState',{});
  const printer=(model,status)=>({
    adapterType:'bambu-lab',model,status:{status},
    capabilities:{filamentTypeControl:true,filamentColorControl:true}
  });
  for(const model of ['P1P','P1S','X1C']){
    assert.equal(getState(printer(model,'idle')).enabled,true);
    assert.equal(getState(printer(model,'printing')).enabled,false);
    assert.equal(getState(printer(model,'paused')).enabled,false);
  }
  for(const model of ['A1 Mini'])
    assert.equal(getState(printer(model,'idle')).enabled,false);
});

test('save flow applies Bambu external spool state separately and retains AMS slot data', () => {
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

test('external spool Set filament remains blue when valid and idle, matching other printers', () => {
  assert.match(preact, /<UiButton variant="primary" class="toolhead-action-button" type="submit"/,
    'Preact Set filament buttons use the shared primary theme');
  assert.match(preact, /disabled=\{disabled\|\|!valid\|\|\(!dirty&&control\.mode!=='bambu-filament'\)\}/,
    'the external-spool button must not appear disabled just because current values match');
  assert.match(app, /class="primary toolhead-action-button" data-bambu-external-save/,
    'legacy external-spool button uses the same primary style');
  assert.match(css, /\.primary \{\s*background:linear-gradient\(180deg,#2f86e5,#1769bd\)/,
    'the button inherits the common blue theme, without a Bambu-specific colour');
  assert.doesNotMatch(css, /\.bambu-external-filament-control[^\{]*\{[^}]*background:/,
    'no separate Bambu button background overrides the primary theme');
});


test('X1C Preact and legacy editors expose the existing external spool controls', () => {
  const stateStart=app.indexOf('function bambuExternalFilamentEditState(');
  const markupEnd=app.indexOf('function u1FilamentConfigEditState(',stateStart);
  const markup=app.slice(stateStart,markupEnd);
  assert.match(markup,/P1P','P1S','X1C/);
  assert.match(markup,/data-preact-toolhead-control="bambu-filament"/);
  assert.match(markup,/data-bambu-external-material/);
  assert.match(markup,/data-bambu-external-colour/);
  assert.match(markup,/data-bambu-external-save/);
  assert.match(app,/if\(printer\.adapterType==='bambu-lab' && \['P1P','P1S','X1C'\]\.includes/);
  assert.match(app,/mode:'bambu-filament',toolIndex:0/);
  assert.match(preact,/control\.mode==='bambu-filament'/);
});
