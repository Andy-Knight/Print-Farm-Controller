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
  const ids=['libraryPricingSettingsBtn','libraryPricingSettingsDialog','libraryPricingSettingsForm',
    'libraryProfitPercent','libraryProfitMethod'];
  for (const id of ids) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(app,/api\/library\/pricing/);
  assert.match(server,/estimateLibrarySalePrice\(file,pricingSettings\)/);
  assert.match(server,/url\.pathname === '\/api\/library\/pricing' && req\.method === 'PUT'/);
  assert.match(server,/sundryCosts:body\.sundryCosts/);
  assert.match(preact,/file\.sale\?\.price/);
  assert.match(app,/function librarySaleView\(file\)/);
  assert.match(css,/#libraryDialog \.library-sale-price/);
  assert.match(css,/\.library-sundry-row/);
});
