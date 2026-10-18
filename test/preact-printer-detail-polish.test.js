import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const css=read('public/printer-details-polish.css');
const html=read('public/index.html');
const jsx=read('ui/printer-details.jsx');
const app=read('public/app.js');

test('Phase 4 stylesheet loads after the shared SaaS design system and dashboard polish',()=>{
  const styles=[
    '/styles.css','/design-system.css','/shell.css',
    '/dashboard-polish.css','/printer-details-polish.css'
  ];
  let previous=-1;
  for(const style of styles){
    const index=html.indexOf('href="'+style+'"');
    assert.ok(index>previous,style+' must load in established order');
    previous=index;
  }
  assert.match(css,/#printerDialog\.printer-dialog\s*\{/);
  assert.match(css,/#printerDialog \[data-preact-detail-header\] > \.dialog-head/);
  assert.match(css,/var\(--ds-surface\)/);
  assert.match(css,/var\(--ds-brand\)/);
  assert.match(css,/@media\(max-width:960px\)/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css,/--toolhead-dropdown-width\s*:/,
    'preserve existing printer-specific editor geometry');
});

test('Preact Printer Details retains live title, maintenance, status and controls',()=>{
  assert.match(jsx,/data-detail-name/);
  assert.match(jsx,/data-maintenance-open-printer/);
  assert.match(jsx,/<StatusBadge state=\{detail.stateClass\}/);
  assert.match(jsx,/data-detail-close/);
  assert.match(jsx,/data-detail-health/);
  assert.match(jsx,/printer-detail-model/);
  assert.match(jsx,/printer-detail-host/);
  assert.match(jsx,/id=\{'printer-detail-tab-' \+ tab.key\}/);
  assert.match(jsx,/aria-controls=\{tab.controls\}/);
  assert.match(jsx,/onKeyDown=\{\(event\) => activateFromKeyboard/);
  assert.match(jsx,/requestToolheadDesignation/);
  assert.match(jsx,/current.value === current.base/);
});

test('Legacy and Preact tab interfaces share the same panel associations',()=>{
  const ids=[
    ['toolheads','Toolheads'],['camera','Camera'],['files','Files'],
    ['temperature','Temperature'],['job','Job'],['management','Management']
  ];
  for(const [key,suffix] of ids){
    assert.ok(app.includes('data-detail-tab="'+key+'" aria-controls="detailTab'+suffix+'" id="printer-detail-tab-'+key+'"'));
    assert.ok(app.includes('id="detailTab'+suffix+'" class="printer-detail-tab-panel" role="tabpanel" aria-labelledby="printer-detail-tab-'+key+'"'));
  }
  assert.match(app,/model:String\(printerModelLabel\(printer\)/);
  assert.match(app,/data-detail-state/);
  assert.match(app,/activatePrinterDetailTab\(/);
  assert.match(app,/data-preact-printer-management/);
  assert.match(app,/data-preact-toolhead-control/);
});
