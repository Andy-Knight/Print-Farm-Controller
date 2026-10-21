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
  sundryCosts:[{label:'M4 threaded inserts',quantity:4,unitCost:0.25},
    {label:'Packing envelope',quantity:1,unitCost:0.5}],
  lotsPerPrint:4,
  costEstimate:{complete:true,totalCost:6,currency:'GBP'},
  ...overrides
});

test('Global library pricing settings persist and support markup vs margin',async()=>{
  assert.deepEqual(await pricing.getLibraryPricingSettings(),{profitPercent:null,profitMethod:'markup',taxRate:0,hourlyCostRate:0,labourHourlyRate:null});
  const changed=await pricing.saveLibraryPricingSettings({profitPercent:30,profitMethod:'markup'});
  assert.deepEqual(changed,{profitPercent:30,profitMethod:'markup',taxRate:0,hourlyCostRate:0,labourHourlyRate:null});
  assert.deepEqual(await pricing.getLibraryPricingSettings(),changed);
  const margin=await pricing.saveLibraryPricingSettings({profitPercent:30,profitMethod:'margin'});
  assert.deepEqual(await pricing.getLibraryPricingSettings(),margin);
  assert.ok((await fs.stat(pricing.libraryPricingSettingsPath)).isFile());
  assert.equal(path.dirname(pricing.libraryPricingSettingsPath),root);
  // An earlier stored configuration without a tax rate must load as 0%.
  await fs.writeFile(pricing.libraryPricingSettingsPath,
    JSON.stringify({profitPercent:25,profitMethod:'margin'}));
  assert.deepEqual(await pricing.getLibraryPricingSettings(),
    {profitPercent:25,profitMethod:'margin',taxRate:0,hourlyCostRate:0,labourHourlyRate:null});
  const taxed=await pricing.saveLibraryPricingSettings({profitPercent:25,profitMethod:'margin',taxRate:20});
  assert.deepEqual(taxed,{profitPercent:25,profitMethod:'margin',taxRate:20,hourlyCostRate:0,labourHourlyRate:null});
  assert.deepEqual(await pricing.getLibraryPricingSettings(),taxed);
  const hourly=await pricing.saveLibraryPricingSettings({
    profitPercent:25,profitMethod:'margin',taxRate:20,hourlyCostRate:3.75
  });
  assert.equal(hourly.hourlyCostRate,3.75);
  assert.deepEqual(await pricing.getLibraryPricingSettings(),hourly);
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

test('Tax applies after profit and before sale-lot rounding; inclusive print total is lots × rounded per-lot price',()=>{
  const file=sample();
  const markup=pricing.estimateLibrarySalePrice(file,
    {profitPercent:30,profitMethod:'markup',taxRate:20});
  assert.equal(markup.totalCost,7.5);
  assert.equal(markup.taxRate,20);
  assert.equal(markup.sellingPriceExTax,9.76);
  assert.equal(markup.sellingPriceExTaxPerLot,2.44);
  assert.equal(markup.sellingPricePerLot,2.93);
  assert.equal(markup.sellingPrice,11.72);
  assert.equal(markup.taxAmount,1.96);
  assert.equal(markup.sellingPricePerLot*markup.lotsPerPrint,markup.sellingPrice);
  const margin=pricing.estimateLibrarySalePrice(file,
    {profitPercent:25,profitMethod:'margin',taxRate:20});
  assert.equal(margin.sellingPriceExTax,10);
  assert.equal(margin.sellingPricePerLot,3);
  assert.equal(margin.sellingPrice,12);
  assert.equal(margin.taxAmount,2);
  const zero=pricing.estimateLibrarySalePrice(file,
    {profitPercent:30,profitMethod:'markup',taxRate:0});
  assert.equal(zero.sellingPrice,9.76);
  assert.equal(zero.taxAmount,0);
  const yen=pricing.estimateLibrarySalePrice({
    sundryCosts:[],lotsPerPrint:3,costEstimate:{complete:true,totalCost:1000,currency:'JPY'}
  },{profitPercent:20,profitMethod:'markup',taxRate:20});
  assert.equal(yen.sellingPricePerLot,480);
  assert.equal(yen.sellingPrice,1440);
  assert.equal(yen.taxAmount,240);
});

test('Inherit all sundry amounts in the filament estimate currency and withhold incomplete prices',()=>{
  const file=sample();
  const blank=pricing.estimateLibrarySalePrice(file,{profitPercent:null,profitMethod:'markup'});
  assert.equal(blank.complete,false);
  assert.equal(blank.sellingPrice,null);
  assert.match(blank.issue,/global profit percentage/i);
  const unknown=pricing.estimateLibrarySalePrice(sample({costEstimate:{complete:false,totalCost:null,currency:null}}),
    {profitPercent:50,profitMethod:'markup'});
  assert.equal(unknown.complete,false);
  assert.match(unknown.issue,/filament cost is unavailable/i);
  const dollars=pricing.estimateLibrarySalePrice(sample({
    sundryCurrency:'GBP', // legacy user-selected value is ignored
    costEstimate:{complete:true,totalCost:6,currency:'USD'}
  }),{profitPercent:50,profitMethod:'markup'});
  assert.equal(dollars.complete,true);
  assert.equal(dollars.currency,'USD');
  assert.equal(dollars.sundriesCost,1.5);
  assert.equal(dollars.totalCost,7.5);
  assert.equal(dollars.sellingPricePerLot,2.81);
  assert.equal(dollars.sellingPrice,11.24);
  const noSundries=pricing.estimateLibrarySalePrice(sample({sundryCosts:[]}),
    {profitPercent:20,profitMethod:'markup'});
  assert.equal(noSundries.complete,true);
  assert.equal(noSundries.currency,'GBP');
  assert.equal(noSundries.sellingPrice,7.2);
  const missingWithLegacyCurrency=pricing.estimateLibrarySalePrice(sample({
    sundryCurrency:'GBP',costEstimate:{complete:false,totalCost:null,currency:null}
  }),{profitPercent:30,profitMethod:'markup'});
  assert.equal(missingWithLegacyCurrency.currency,null);
  assert.equal(missingWithLegacyCurrency.complete,false);
  assert.equal(missingWithLegacyCurrency.sellingPrice,null);
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
  for (const invalid of [-1,100.01,NaN,true,'invalid',Infinity]) {
    assert.throws(()=>pricing.normalizePricingSettings({profitPercent:20,profitMethod:'markup',taxRate:invalid}),/tax rate/i);
  }
  for (const invalid of [-1,1000000.01,NaN,true,'invalid',Infinity]) {
    assert.throws(()=>pricing.normalizePricingSettings({
      profitPercent:20,profitMethod:'markup',hourlyCostRate:invalid
    }),/hourly print cost rate/i);
  }
});

test('Hourly print costs are included before markup, margin, tax and splitting into sale lots',()=>{
  const file=sample({requirements:{estimatedPrintSeconds:5400}});
  const markup=pricing.estimateLibrarySalePrice(file,
    {profitPercent:20,profitMethod:'markup',hourlyCostRate:4.5,taxRate:20});
  assert.equal(markup.hourlyCostRate,4.5);
  assert.equal(markup.estimatedPrintSeconds,5400);
  assert.equal(markup.printTimeCost,6.75);
  assert.equal(markup.filamentCost,6);
  assert.equal(markup.sundriesCost,1.5);
  assert.equal(markup.totalCost,14.25);
  // Price of each lot is rounded independently, as in the existing Sell price calculation.
  assert.equal(markup.sellingPriceExTax,17.08);
  assert.equal(markup.sellingPricePerLot,5.13);
  assert.equal(markup.sellingPrice,20.52);
  const margin=pricing.estimateLibrarySalePrice(file,
    {profitPercent:25,profitMethod:'margin',hourlyCostRate:4.5,taxRate:0});
  assert.equal(margin.totalCost,14.25);
  assert.equal(margin.sellingPrice,19);
  assert.equal(margin.sellingPricePerLot,4.75);
});

test('Missing slicer time with a nonzero hourly rate prevents a deceptively low price',()=>{
  const withoutRate=pricing.estimateLibrarySalePrice(sample(),
    {profitPercent:20,profitMethod:'markup',hourlyCostRate:0});
  assert.equal(withoutRate.complete,true);
  assert.equal(withoutRate.printTimeCost,0);
  assert.equal(withoutRate.estimatedPrintSeconds,null);
  const withRate=pricing.estimateLibrarySalePrice(sample(),
    {profitPercent:20,profitMethod:'markup',hourlyCostRate:4});
  assert.equal(withRate.complete,false);
  assert.match(withRate.issue,/estimated print time/i);
  assert.equal(withRate.printTimeCost,null);
  assert.equal(withRate.totalCost,null);
  assert.equal(withRate.sellingPrice,null);
  const invalid=pricing.estimateLibrarySalePrice(sample({requirements:{estimatedPrintSeconds:-20}}),
    {profitPercent:20,profitMethod:'markup',hourlyCostRate:4});
  assert.equal(invalid.complete,false);
});

test('Labour minutes inherit the global hourly labour rate and contribute to sundries, markup, tax and sale lots',async()=>{
  assert.deepEqual(pricing.normalizeSundryCosts([{label:'Labour',minutes:30}]),
    [{label:'Labour',minutes:30}]);
  const file=sample({sundryCosts:[
    {label:'Labour',minutes:30},
    {label:'Packaging',quantity:2,unitCost:0.5}
  ]});
  const missing=pricing.estimateLibrarySalePrice(file,{profitPercent:20});
  assert.equal(missing.complete,false);
  assert.equal(missing.sundriesCost,null);
  assert.match(missing.issue,/labour hourly rate/i);
  assert.equal(missing.sellingPrice,null);
  const priced=pricing.estimateLibrarySalePrice(file,{
    profitPercent:20,profitMethod:'markup',taxRate:20,labourHourlyRate:18
  });
  assert.equal(priced.complete,true);
  assert.equal(priced.labourCost,9);
  assert.equal(priced.sundriesCost,10);
  assert.equal(priced.totalCost,16);
  assert.equal(priced.sellingPricePerLot,5.76);
  assert.equal(priced.sellingPrice,23.04);
  assert.equal(priced.labourHourlyRate,18);
  const changed=pricing.estimateLibrarySalePrice(file,{
    profitPercent:20,labourHourlyRate:24
  });
  assert.equal(changed.labourCost,12);
  assert.equal(changed.sundriesCost,13);
  assert.equal(changed.totalCost,19);
  assert.equal(changed.sellingPrice,22.8);
  const noLabour=pricing.estimateLibrarySalePrice(sample(),{profitPercent:20});
  assert.equal(noLabour.complete,true,'old library items need no new rate');
  assert.equal(noLabour.labourCost,0);
  const explicitlyFree=pricing.estimateLibrarySalePrice(file,{
    profitPercent:20,labourHourlyRate:0
  });
  assert.equal(explicitlyFree.complete,true);
  assert.equal(explicitlyFree.labourCost,0);
  const yen=pricing.estimateLibrarySalePrice({
    sundryCosts:[{label:'Labour',minutes:15}],costEstimate:{complete:true,totalCost:1000,currency:'JPY'}
  },{profitPercent:0,labourHourlyRate:1200});
  assert.equal(yen.currency,'JPY');
  assert.equal(yen.labourCost,300);
  assert.equal(yen.sellingPrice,1300);
  const saved=await pricing.saveLibraryPricingSettings({
    profitPercent:20,labourHourlyRate:18.75,hourlyCostRate:3
  });
  assert.equal(saved.labourHourlyRate,18.75);
  assert.equal((await pricing.getLibraryPricingSettings()).labourHourlyRate,18.75);
  const legacySettings=pricing.normalizePricingSettings({profitPercent:20});
  assert.equal(legacySettings.labourHourlyRate,null);
});

test('Legacy Labour quantity/unit cost stays priced until manually converted to minutes',()=>{
  const legacy=sample({sundryCosts:[{label:'Labour',quantity:2,unitCost:4}]});
  const normal=pricing.normalizeSundryCosts(legacy.sundryCosts);
  assert.deepEqual(normal,[{label:'Labour',quantity:2,unitCost:4}]);
  const old=pricing.estimateLibrarySalePrice(legacy,{profitPercent:20});
  assert.equal(old.complete,true);
  assert.equal(old.sundriesCost,8);
  assert.equal(old.totalCost,14);
  const revised=pricing.estimateLibrarySalePrice(legacy,{profitPercent:20,labourHourlyRate:40});
  assert.equal(revised.sundriesCost,8,'a later labour rate must not reprice legacy fixed-cost labour');
  const converted=pricing.estimateLibrarySalePrice(
    sample({sundryCosts:[{label:'Labour',minutes:45}]}),
    {profitPercent:20,labourHourlyRate:40}
  );
  assert.equal(converted.labourCost,30);
  assert.equal(converted.sundriesCost,30);
  for(const minutes of [0,-1,1.5,10001,'oops','',null,true,Infinity]){
    assert.throws(()=>pricing.normalizeSundryCosts([{label:'Labour',minutes}]),/labour minutes/i);
  }
  for(const bad of [-1,'bad',Infinity,1000000.01,true,NaN]){
    assert.throws(()=>pricing.normalizePricingSettings({labourHourlyRate:bad}),/labour hourly rate/i);
  }
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
