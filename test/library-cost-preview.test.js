import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateLibraryFileCosts } from '../src/library-cost-preview.js';

const PLA_ID='11111111-1111-4111-8111-111111111111';
const PLA2_ID='22222222-2222-4222-8222-222222222222';
const PETG_ID='33333333-3333-4333-8333-333333333333';
const material=(id,type,price,currency='GBP',brand='Test Brand')=>({
  id,material:type,materialKey:type,brand,product:type,costPerKg:price,currency
});
const file=(id,logicalTools,filamentAssignments={})=>({
  id,fileName:id+'.3mf',description:'Do not mutate',
  requirements:{ logicalTools },filamentAssignments
});
const tool=(index,material,filamentGrams)=>({index,material,filamentGrams});

test('library cost estimates reuse live catalogue prices and weight, reading catalogue once',async()=>{
  const filaments=[material(PLA_ID,'PLA',20),material(PETG_ID,'PETG',30)];
  const files=[
    file('multi',[tool(0,'PLA',20),tool(1,'PETG',5)],{'0':PLA_ID}),
    file('single',[tool(0,'PLA',10)]),
    file('free',[tool(0,'PLA',0)])
  ];
  const original=structuredClone(files);
  let reads=0;
  const estimate=await estimateLibraryFileCosts(files,{
    listFilamentsFn:async()=>{reads++; return filaments;}
  });
  assert.equal(reads,1);
  assert.equal(estimate[0].costEstimate.totalCost,0.55);
  assert.equal(estimate[0].costEstimate.currency,'GBP');
  assert.equal(estimate[0].costEstimate.grams,25);
  assert.equal(estimate[0].costEstimate.complete,true);
  assert.equal(estimate[1].costEstimate.totalCost,0.2);
  assert.equal(estimate[2].costEstimate.totalCost,0);
  assert.equal(estimate[2].costEstimate.complete,true);
  assert.deepEqual(files,original,'must not mutate persisted library file metadata');
  assert.equal(estimate[0].description,'Do not mutate','preserve library response fields');
});

test('library never displays partial or invented costs for missing usage, unmatched materials or mixed currency',async()=>{
  const entries=[
    material(PLA_ID,'PLA',20),
    material(PLA2_ID,'PLA',30),
    material(PETG_ID,'PETG',30,'USD')
  ];
  const cases=[
    file('no-sliced-metadata',[]),
    file('missing-usage',[tool(0,'PLA',null)],{'0':PLA_ID}),
    file('ambiguous-profile',[tool(0,'PLA',15)]),
    file('missing-assigned-filament',[tool(0,'PLA',10)],{'0':'44444444-4444-4444-8444-444444444444'}),
    file('mixed-currencies',[tool(0,'PLA',10),tool(1,'PETG',10)],{'0':PLA_ID,'1':PETG_ID}),
    file('partial',[tool(0,'PLA',10),tool(1,'ABS',20)],{'0':PLA_ID})
  ];
  const results=await estimateLibraryFileCosts(cases,{listFilamentsFn:async()=>entries});
  for(const x of results){
    assert.equal(x.costEstimate.complete,false,x.id);
    assert.equal(x.costEstimate.totalCost,null,x.id);
    assert.equal(x.costEstimate.currency,null,x.id);
    assert.ok(x.costEstimate.issue,x.id);
  }
  assert.match(results[1].costEstimate.issue,/weight/i);
  assert.match(results[2].costEstimate.issue,/Multiple PLA/i);
  assert.match(results[3].costEstimate.issue,/no longer exists/);
  assert.match(results[4].costEstimate.issue,/different currencies/i);
  assert.match(results[5].costEstimate.issue,/ABS/);
});

test('changing catalogue prices updates library estimates without rewriting historical snapshots',async()=>{
  const fileInfo=file('current-cost',[tool(0,'PLA',25)]);
  const historical=Object.freeze({ totalCost:0.5, currency:'GBP', capturedAt:'2026-09-19' });
  let price=20;
  const deps={ listFilamentsFn:async()=>[material(PLA_ID,'PLA',price)] };
  const old=(await estimateLibraryFileCosts([fileInfo],deps))[0].costEstimate;
  price=40;
  const current=(await estimateLibraryFileCosts([fileInfo],deps))[0].costEstimate;
  assert.equal(old.totalCost,0.5);
  assert.equal(current.totalCost,1);
  assert.equal(historical.totalCost,0.5);
  assert.equal(fileInfo.costEstimate,undefined);
});

test('Print Library API and both UI renderers expose a clearly-labelled per-print estimate',()=>{
  const root=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const server=root('src/server.js');
  const app=root('public/app.js');
  const preact=root('ui/print-library.jsx');
  const css=root('public/print-library-polish.css');
  const html=root('public/index.html');
  assert.match(server,/await estimateLibraryFileCosts\(filesWithUsage\)/);
  assert.match(server,/const filesWithUsage = \(await listLibraryFiles\(\)\)/);
  assert.match(app,/function libraryCostView\(file\)/);
  assert.match(app,/NumberFormat\('en-GB'/);
  assert.match(app,/costEstimate/);
  assert.match(app,/data-library-cost/);
  assert.match(app,/cost,\n    selected:/);
  assert.match(preact,/<LibraryCost cost=\{file\.cost\} \/>/);
  assert.match(preact,/Estimated material cost \/ print/);
  assert.match(css,/#libraryDialog \.library-print-cost/);
  assert.match(css,/var\(--ds-surface-muted\)/);
  assert.ok(html.indexOf('/print-library-polish.css')>html.indexOf('/tab-navigation.css'));
});
