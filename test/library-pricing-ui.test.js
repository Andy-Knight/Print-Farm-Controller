import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Print Library add and edit forms expose category, tags, sundries and sale lots',()=>{
  const html=read('public/index.html');
  const app=read('public/app.js');
  for(const name of ['libraryAddCategory','libraryAddTags','libraryAddSundryCurrency','libraryAddSundries',
    'libraryAddLotsPerPrint','libraryMetadataCategory','libraryMetadataTags','libraryMetadataSundries',
    'libraryMetadataSundryCurrency','libraryMetadataLotsPerPrint']) {
    assert.match(html,new RegExp('id="'+name+'"'),name+' should be in form');
    assert.match(app,new RegExp(name),name+' must be wired in controller');
  }
  assert.match(app,/sundryCosts:collectLibrarySundries\(libraryAddSundries\)/);
  assert.match(app,/sundryCosts:collectLibrarySundries\(libraryMetadataSundries\)/);
  assert.match(app,/renderLibrarySundries\(libraryMetadataSundries,file\.sundryCosts \|\| \[\]\)/);
  assert.match(app,/if \(stored && !stored\.duplicate\)/);
  assert.match(app,/Existing details were kept/);
});

test('Selling-price settings and Preact/fallback sale view use the same server estimate',()=>{
  const html=read('public/index.html'),app=read('public/app.js');
  const preact=read('ui/print-library.jsx');
  const server=read('src/server.js'),css=read('public/print-library-polish.css');
  const ids=['reportingTabPricing','reportingPanelPricing','reportingPricingForm',
    'reportingProfitPercent','reportingProfitMethod','reportingPricingStatus','reportingPricingError'];
  for (const id of ids) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(app,/api\/library\/pricing/);
  assert.match(server,/estimateLibrarySalePrice\(file,pricingSettings\)/);
  assert.match(server,/url\.pathname === '\/api\/library\/pricing' && req\.method === 'PUT'/);
  assert.match(server,/sundryCosts:body\.sundryCosts/);
  assert.match(preact,/file\.sale\?\.price/);
  assert.match(app,/function librarySaleView\(file\)/);
  const reporting=read('public/reporting.js');
  const reportingUi=read('ui/reporting.jsx');
  const layout=read('public/styles.css');
  assert.doesNotMatch(html,/id="libraryPricingSettingsBtn"/);
  assert.doesNotMatch(html,/id="libraryPricingSettingsDialog"/);
  assert.match(html,/data-reporting-tab="pricing"/);
  assert.match(html,/data-reporting-panel="pricing"/);
  assert.match(reporting,/function loadReportingPricingSettings\(\)/);
  assert.match(reporting,/requestJson\('\/api\/library\/pricing'/);
  assert.match(reporting,/reportingPricingForm\?\.addEventListener\('submit'/);
  assert.match(reporting,/pfc:library-pricing-updated/);
  assert.match(app,/addEventListener\('pfc:library-pricing-updated'/);
  assert.match(reportingUi, /key:'pricing'/);
  assert.match(layout,/\.reporting-pricing-grid/);
  assert.match(css,/#libraryDialog \.library-sale-price/);
  assert.match(css,/\.library-sundry-row/);
});

test('Add and Edit details use a scrolling body and fixed action header/footer',()=>{
  const html=read('public/index.html');
  const css=read('public/print-library-polish.css');
  for (const name of ['libraryAdd','libraryMetadata']) {
    const section=html.split('<dialog id="'+name+'Dialog"')[1]?.split('</dialog>')[0] || '';
    assert.match(section,/<div class="dialog-head">/);
    assert.match(section,/<div class="library-editor-body"[^>]*>/);
    assert.match(section,/<div class="library-editor-footer">/);
    const header=section.indexOf('class="dialog-head"');
    const body=section.indexOf('class="library-editor-body"');
    const footer=section.indexOf('class="library-editor-footer"');
    const actions=section.indexOf('class="actions"');
    assert.ok(header<body && body<footer && footer<actions,
      name+' form header, fields and fixed footer should be in that order');
  }
  assert.match(css,/#libraryAddDialog > form,#libraryMetadataDialog > form \{/);
  assert.match(css,/#libraryAddDialog \.library-editor-body,#libraryMetadataDialog \.library-editor-body \{/);
  assert.match(css,/#libraryAddDialog \.library-editor-footer,#libraryMetadataDialog \.library-editor-footer \{/);
  assert.match(css,/overflow-y:auto;/);
  assert.match(css,/#libraryAddDialog \.library-pricing-fields label,#libraryMetadataDialog \.library-pricing-fields label \{[\s\S]*?flex-direction:column;/);
  assert.match(css,/#libraryAddDialog \.library-pricing-fields label > select/);
  assert.match(css,/#libraryMetadataDialog \.library-pricing-fields label > input/);
});
