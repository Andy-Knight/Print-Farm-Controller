import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'pfc-library-pricing-'));
process.env.DATA_DIR=root;
const pricing=await import('../src/library-pricing.js');
after(async()=>{await fs.rm(root,{recursive:true,force:true});});

const sample=(overrides={})=>({
  sundryCurrency:'GBP',
  sundryCosts:[{label:'M4 threaded inserts',quantity:4,unitCost:0.25},
    {label:'Packing envelope',quantity:1,unitCost:0.5}],
  lotsPerPrint:4,
  costEstimate:{complete:true,totalCost:6,currency:'GBP'},
  ...overrides
});

test('Global library pricing settings persist and support markup vs margin',async()=>{
  assert.deepEqual(await pricing.getLibraryPricingSettings(),{profitPercent:null,profitMethod:'markup'});
  const changed=await pricing.saveLibraryPricingSettings({profitPercent:30,profitMethod:'markup'});
  assert.deepEqual(changed,{profitPercent:30,profitMethod:'markup'});
  assert.deepEqual(await pricing.getLibraryPricingSettings(),changed);
  const margin=await pricing.saveLibraryPricingSettings({profitPercent:30,profitMethod:'margin'});
  assert.deepEqual(await pricing.getLibraryPricingSettings(),margin);
  assert.ok((await fs.stat(pricing.libraryPricingSettingsPath)).isFile());
  assert.equal(path.dirname(pricing.libraryPricingSettingsPath),root);
});

test('Total sundries and selling price are computed per sliced print, then divided into sale lots',()=>{
  const file=sample();
  const markup=pricing.estimateLibrarySalePrice(file,{profitPercent:30,profitMethod:'markup'});
  assert.equal(markup.sundriesCost,1.5);
  assert.equal(markup.filamentCost,6);
  assert.equal(markup.totalCost,7.5);
  assert.equal(markup.sellingPrice,9.76,'four lots at £2.44 must total £9.76 after cent rounding');
  assert.equal(markup.lotsPerPrint,4);
  assert.equal(markup.sellingPricePerLot,2.44);
  assert.equal(markup.profitMethod,'markup');

  const margin=pricing.estimateLibrarySalePrice(file,{profitPercent:25,profitMethod:'margin'});
  assert.equal(margin.sellingPrice,10);
  assert.equal(margin.sellingPricePerLot,2.5);
  assert.equal(margin.complete,true);
  assert.equal(margin.currency,'GBP');
});

test('Never derive a misleading sales price with unknown filament, missing markup or mixed currencies',()=>{
  const file=sample();
  const blank=pricing.estimateLibrarySalePrice(file,{profitPercent:null,profitMethod:'markup'});
  assert.equal(blank.complete,false);
  assert.equal(blank.sellingPrice,null);
  assert.match(blank.issue,/global profit percentage/i);
  const unknown=pricing.estimateLibrarySalePrice(sample({costEstimate:{complete:false,totalCost:null,currency:null}}),
    {profitPercent:50,profitMethod:'markup'});
  assert.equal(unknown.complete,false);
  assert.match(unknown.issue,/filament cost is unavailable/i);
  const mixed=pricing.estimateLibrarySalePrice(sample({sundryCurrency:'USD'}),
    {profitPercent:50,profitMethod:'markup'});
  assert.equal(mixed.complete,false);
  assert.match(mixed.issue,/currency USD.*GBP/i);
  const noSundries=pricing.estimateLibrarySalePrice(sample({sundryCosts:[],sundryCurrency:'USD'}),
    {profitPercent:20,profitMethod:'markup'});
  assert.equal(noSundries.complete,true);
  assert.equal(noSundries.currency,'GBP');
  assert.equal(noSundries.sellingPrice,7.2);
  const yen=pricing.estimateLibrarySalePrice({
    sundryCosts:[],lotsPerPrint:3,costEstimate:{complete:true,totalCost:1000,currency:'JPY'}
  },{profitPercent:20,profitMethod:'markup'});
  assert.equal(yen.sellingPricePerLot,400);
  assert.equal(yen.sellingPrice,1200);
});

test('Legacy library files default safely to one lot and zero sundries',()=>{
  const legacy=pricing.estimateLibrarySalePrice({costEstimate:{complete:true,totalCost:5,currency:'GBP'}},
    {profitPercent:20,profitMethod:'markup'});
  assert.equal(legacy.complete,true);
  assert.equal(legacy.lotsPerPrint,1);
  assert.equal(legacy.sundriesCost,0);
  assert.equal(legacy.sellingPrice,6);
});

test('Invalid sundries, lot counts and profit margins fail closed',()=>{
  const badSundry=(entry)=>pricing.normalizeSundryCosts([entry]);
  assert.throws(()=>badSundry({label:'Screws',quantity:1,unitCost:-0.2}),/unit cost/i);
  assert.throws(()=>badSundry({label:'Screws',quantity:0,unitCost:0.2}),/quantity/i);
  assert.throws(()=>badSundry({label:'',quantity:2,unitCost:0.2}),/description/i);
  assert.throws(()=>badSundry({label:'Bolts',quantity:2,unitCost:'oops'}),/unit cost/i);
  assert.throws(()=>pricing.normalizeSundryCosts(Array.from({length:31},()=>({label:'a',quantity:1,unitCost:1}))),/30/);
  assert.throws(()=>pricing.normalizeSaleLots(0),/between 1 and 999/);
  assert.throws(()=>pricing.normalizeSaleLots(2.5),/between 1 and 999/);
  assert.throws(()=>pricing.normalizePricingSettings({profitPercent:100,profitMethod:'margin'}),/below 100/);
  assert.throws(()=>pricing.normalizePricingSettings({profitPercent:-1,profitMethod:'markup'}),/non-negative/);
  assert.throws(()=>pricing.normalizePricingSettings({profitPercent:20,profitMethod:'unknown'}),/profit method/i);
  assert.throws(()=>pricing.normalizeSundryCurrency('USD<script>'),/supported filament catalogue currencies/);
});

test('Clearing saved profit percentage prevents presenting a stale sales price',async()=>{
  await pricing.saveLibraryPricingSettings({profitPercent:22,profitMethod:'markup'});
  const before=pricing.estimateLibrarySalePrice(sample(),await pricing.getLibraryPricingSettings());
  assert.equal(before.complete,true);
  await pricing.saveLibraryPricingSettings({profitPercent:null,profitMethod:'markup'});
  const afterClear=pricing.estimateLibrarySalePrice(sample(),await pricing.getLibraryPricingSettings());
  assert.equal(afterClear.complete,false);
  assert.equal(afterClear.sellingPrice,null);
});
