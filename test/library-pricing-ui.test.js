import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Print Library add and edit forms expose category, tags, sundries and sale lots',()=>{
  const html=read('public/index.html');
  const app=read('public/app.js');
  for(const name of ['libraryAddCategory','libraryAddTags','libraryAddSundries',
    'libraryAddLotsPerPrint','libraryMetadataCategory','libraryMetadataTags','libraryMetadataSundries',
    'libraryMetadataCostCurrency','libraryMetadataLotsPerPrint']) {
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
  const ids=['reportingTabPricing','reportingPanelPricing','reportingPricingForm','reportingCurrency',
    'reportingProfitPercent','reportingProfitMethod','reportingTaxRate','reportingHourlyCostRate',
    'reportingLabourHourlyRate',
    'reportingPricingStatus','reportingPricingError'];
  for (const id of ids) assert.match(html,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(app,/SundryCurrency/);
  assert.doesNotMatch(html,/name="sundryCurrency"/);
  assert.match(html,/Sundry amounts use the global currency selected in Reports &amp; finance/);
  assert.match(app,/file\.costEstimate\?\.complete && file\.costEstimate\.currency/);
  assert.doesNotMatch(server,/sundryCurrency:body\.sundryCurrency/);
  assert.match(server,/api\/library\/pricing/);
  assert.match(server,/estimateLibrarySalePrice\(file,pricingSettings\)/);
  assert.match(server,/url\.pathname === '\/api\/library\/pricing' && req\.method === 'PUT'/);
  assert.match(server,/sundryCosts:body\.sundryCosts/);
  assert.match(preact,/file\.sale\.price/);
  assert.match(app,/function librarySaleView\(file\)/);
  const reporting=read('public/reporting.js');
  const reportingUi=read('ui/reporting.jsx');
  const layout=read('public/styles.css');
  assert.doesNotMatch(html,/id="libraryPricingSettingsBtn"/);
  assert.doesNotMatch(html,/id="libraryPricingSettingsDialog"/);
  assert.match(html,/data-reporting-tab="pricing"/);
  assert.match(html,/data-reporting-panel="pricing"/);
  assert.match(reporting,/function loadReportingPricingSettings\(\)/);
  assert.match(reporting,/reportingCurrency\.value=reportingCurrencyActive/);
  assert.match(reporting,/currency:reportingCurrency\?\.value \|\| reportingCurrencyActive/);
  assert.doesNotMatch(html,/id="filamentCurrency"/);
  assert.doesNotMatch(reporting,/setFilamentCurrency/);
  assert.match(reporting,/requestJson\('\/api\/library\/pricing'/);
  assert.match(reporting,/taxRate:Number\(reportingTaxRate\?\.value \?\? 0\)/);
  assert.match(reporting,/reportingTaxRate\.value=String\(response\.settings\?\.taxRate \?\? 0\)/);
  assert.match(reporting,/reportingHourlyCostRate\.value=String\(response\.settings\?\.hourlyCostRate \?\? 0\)/);
  assert.match(reporting,/hourlyCostRate:Number\(reportingHourlyCostRate\?\.value \?\? 0\)/);
  assert.match(reporting,/labourHourlyRate:reportingLabourHourlyRate\?\.value === '' \? null/);
  assert.match(reporting,/reportingLabourHourlyRate\.value=String\(response\.settings\?\.labourHourlyRate \?\? ''\)/);
  assert.match(html,/name="taxRate" type="number" min="0" max="100" step="0.01"/);
  assert.match(html,/name="hourlyCostRate" type="number" min="0" max="1000000" step="0.01"/);
  assert.match(html,/name="labourHourlyRate" type="number" min="0" max="1000000" step="0.01"/);
  assert.match(app,/Print time: \$\{money\(sale\.printTimeCost\)\}/);
  assert.match(preact,/file\.sale\.timeCost/);
  assert.match(html,/Prices are shown <strong>including tax<\/strong>/);
  assert.match(reporting,/reportingPricingForm\?\.addEventListener\('submit'/);
  assert.match(reporting,/pfc:library-pricing-updated/);
  assert.match(app,/addEventListener\('pfc:library-pricing-updated'/);
  assert.match(reportingUi, /key:'pricing'/);
  assert.match(layout,/\.reporting-pricing-grid/);
  assert.match(css,/#libraryDialog \.library-sale-price/);
  assert.match(css,/\.library-sundry-row/);
});

test('Labour is entered in minutes, not quantity and unit cost, in both Print Library editors',()=>{
  const app=read('public/app.js');
  const css=read('public/print-library-polish.css');
  const html=read('public/index.html');
  const reporting=read('public/reporting.js');
  assert.match(app,/data-sundry-minutes type="number"/);
  assert.match(app,/data-sundry-labour hidden>Labour minutes/);
  assert.match(app,/field\.hidden=labour/);
  assert.match(app,/minuteInput\.required=labour/);
  assert.match(app,/return \{label:'Labour',minutes\};/);
  assert.match(app,/row\.dataset\.legacyLabour/);
  assert.match(app,/entry\.minutes===undefined/);
  assert.match(app,/labourDetail/);
  assert.match(css,/\.library-sundry-row\.is-labour/);
  assert.match(css,/\.library-sundry-row \[hidden\]/);
  assert.match(html,/id="reportingLabourHourlyRate"/);
  assert.match(html,/id="reportingLabourRateHelp"/);
  assert.match(reporting,/labourHourlyRate:reportingLabourHourlyRate/);
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
  assert.match(css,/#libraryMetadataDialog \.library-pricing-fields label > input/);
});

test('Print Library costing sections use design-system headings without clipped legends',()=>{
  const html=read('public/index.html');
  const css=read('public/print-library-polish.css');
  const design=read('public/design-system.css');
  for (const editor of ['Add','Metadata']) {
    const segment=html.split('<dialog id="library'+editor+'Dialog"')[1]?.split('</dialog>')[0] || '';
    const id='library'+editor+'SundryHeading';
    assert.match(segment,new RegExp('<section class="library-pricing-fields ui-surface ui-surface-muted" aria-labelledby="'+id+'">'));
    assert.match(segment,new RegExp('<h3 id="'+id+'">Sundry costs and sale lots</h3>'));
    assert.doesNotMatch(segment,/<legend>Sundry costs and sale lots<\/legend>/);
    assert.match(segment,/class="library-pricing-config"/);
    assert.match(segment,/class="library-editor-title"/);
  }
  assert.match(html,/class="library-costing-section ui-surface ui-surface-muted"/);
  assert.match(html,/<h3 id="libraryFilamentCostHeading">Filament costing<\/h3>/);
  assert.match(css,/#libraryAddDialog \.library-pricing-head h3/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/#libraryAddDialog \.library-editor-title,#libraryMetadataDialog \.library-editor-title \{/);
  assert.match(css,/color:var\(--ds-brand\);/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(design,/\.ui-section-heading h2,\.ui-section-heading h3/);
  assert.match(design,/\.ui-surface-muted/);
});

test('Sale lots and tax-inclusive Min. sell price have separate aligned sortable columns in Preact and fallback',()=>{
  const html=read('public/index.html');
  const app=read('public/app.js');
  const jsx=read('ui/print-library.jsx');
  const css=read('public/print-library-polish.css');
  const utils=read('public/library-utils.js');
  const header=html.split('id="libraryTableHead"')[1]?.split('</div>')[0] || '';
  const headings=['Select','Preview','File','Printer','Filament &amp; requirements',
    'Estimated cost','Sale lots','Min. sell price','History'];
  for(const label of headings) assert.ok(header.includes(label),'missing table heading: '+label);
  assert.match(header,/data-library-sort="salePrice" data-library-sort-label="minimum sell price per lot" aria-label="Sort by minimum sell price per lot" title="Minimum sell price per lot">Min\. sell price<\/button>/);
  assert.match(app,/button\.dataset\.librarySortLabel \|\| button\.textContent\.trim\(\)/);
  assert.match(html,/<option value="salePrice">Min\. sell price \/ lot<\/option>/);
  for(const sort of ['lots','salePrice']) {
    assert.match(header,new RegExp('data-library-sort="'+sort+'"'));
    assert.match(html,new RegExp('<option value="'+sort+'">'));
  }
  for(const [render,name] of [[app,'fallback'],[jsx,'Preact']]) {
    assert.match(render,/library-cell library-lots-cell/,name+' should have own lots cell');
    assert.match(render,/library-cell library-sale-cell/,name+' should have own selling price cell');
    assert.match(render,/library-sale-price/,name+' should show priced or unavailable state');
    assert.match(render,/class="library-cell-label">Min\. sell price<\/span>/,
      name+' should use the same concise price label as the desktop heading');
    const costCell=render.split('class="library-cell library-cost-cell"')[1]?.split('class="library-cell library-lots-cell"')[0] || '';
    assert.doesNotMatch(costCell,/library-sale-price/,name+' must not embed selling price inside material cost');
  }
  assert.match(app,/sale\.lots>1 \? sale\.perLot : sale\.price/);
  assert.match(jsx,/file\.sale\?\.lots>1 \? file\.sale\.perLot : file\.sale\.price/);
  assert.match(css,/--library-table-cols:[^;]+;/);
  assert.match(css,/"selection preview lots history"/);
  assert.match(css,/"\. sale sale"/);
  assert.match(css,/#libraryDialog \.library-sale-price \{[\s\S]*?background:transparent;/);
  assert.match(utils,/case 'lots':/);
  assert.match(utils,/case 'salePrice':/);
  assert.doesNotMatch(header,/Suggested sell price/);
  assert.match(app,/per sale lot · incl\. tax/);
  assert.match(jsx,/per sale lot · incl\. tax/);
});

test('desktop library workbench uses compact and aligned nine-column tracks',()=>{
  const css=read('public/print-library-polish.css');
  const browser=read('scripts/browser-regression.mjs');
  assert.match(css,/#libraryDialog\.library-dialog \{[\s\S]*?width:min\(1300px,100%\);/);
  const trackRule=css.match(/--library-table-cols:([^;]+);/);
  assert.ok(trackRule,'missing shared desktop track definition');
  assert.equal(trackRule[1].match(/minmax\(/g)?.length,6);
  assert.match(trackRule[1],/70px minmax\(136px,\.82fr\) minmax\(104px,\.68fr\)/);
  assert.equal((css.match(/grid-template-columns:var\(--library-table-cols\)/g)||[]).length,2,
    'header and body must use identical nine-column tracks');
  assert.equal((css.match(/gap:10px;/g)||[]).length>=2,true);
  assert.equal((css.match(/@media\(max-width:1350px\)/g)||[]).length,2,
    'both card styling and scrollbar treatment use the same breakpoint');
  assert.match(browser,/libraryCompactTableSmoke\(page,url\)/);
  assert.match(browser,/sale and history columns must not reserve large empty gaps/);
});

test('Print Library combines search, Add file and selection actions into one accessible toolbar',()=>{
  const html=read('public/index.html');
  const css=read('public/print-library-polish.css');
  const source=html.split('<section id="libraryDialog"')[1]?.split('<div id="libraryTableHead"')[0] || '';
  const toolbar=source.split('<div class="library-toolbar">')[1]?.split('</details>')[0] || '';
  const actions=toolbar.split('<div class="library-action-toolbar"')[1] || '';
  assert.match(toolbar,/id="librarySearchInput"/);
  assert.match(toolbar,/id="libraryUploadBtn"/);
  assert.match(actions,/role="group" aria-label="Actions for the selected library file"/);
  for(const id of ['libraryQueueSelectedBtn','libraryEditSelectedBtn',
    'libraryFavouriteSelectedBtn','libraryDeleteSelectedBtn']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
      'selection action should occur once, inside the combined toolbar: '+id);
    assert.ok(actions.includes('id="'+id+'"'),'missing inline action: '+id);
  }
  assert.match(source,/id="librarySelectionStatus" class="library-selection-status" aria-live="polite"/);
  assert.match(css,/#libraryDialog \.library-toolbar \.library-action-toolbar/);
  assert.match(css,/#libraryDialog \.library-action-buttons \{[\s\S]*?flex-wrap:nowrap;/);
  assert.match(css,/#libraryDialog \.library-toolbar \.library-action-toolbar \{[\s\S]*?flex:1 1 100%;/);
});

test('Sundry items use a five-option dropdown and outlined destructive Remove control',()=>{
  const app=read('public/app.js');
  const css=read('public/print-library-polish.css');
  const html=read('public/index.html');
  assert.match(app,/const LIBRARY_SUNDRY_ITEMS=Object\.freeze\(\[/);
  for(const item of ['Packaging','Postage','Hardware','Labour','Miscellaneous']) {
    assert.match(app,new RegExp("'"+item+"'"));
  }
  assert.match(app,/<select data-sundry-label required/);
  assert.ok(app.includes('data-sundry-cost type="number" min="0" max="1000000" step="0.01" inputmode="decimal"'));
  assert.ok(app.includes('Number(entry.unitCost ?? 0).toFixed(2)'));
  assert.ok(app.includes("costInput?.addEventListener('blur',()=>{"));
  assert.ok(app.includes('Math.round((value+Number.EPSILON)*100)/100).toFixed(2)'));
  assert.doesNotMatch(app,/<input data-sundry-label/);
  assert.match(app,/<option value=""\$\{existing\?'':' selected'\} disabled>Select sundry item/);
  assert.match(app,/previously saved/);
  assert.match(app,/class="danger library-remove-sundry" data-remove-sundry/);
  assert.match(css,/#libraryMetadataDialog \.library-sundry-row > \.library-remove-sundry/);
  assert.match(css,/#libraryAddDialog \.library-sundry-row > \.library-remove-sundry/);
  assert.match(css,/border:1px solid var\(--ds-danger\);/);
  assert.match(css,/background:transparent;/);
  assert.match(css,/\.library-sundry-row input,\.library-sundry-row select/);
  assert.match(app,/if \(remove\) remove\.closest\('\.library-sundry-row'\)\?\.remove\(\)/,
    'removing a line item must not write changes to the server');
  assert.match(html,/id="libraryMetadataForm"/);
  assert.match(html,/id="libraryAddForm"/);
});
