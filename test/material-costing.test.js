import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialCostSnapshot } from '../src/material-costing.js';

test('material costing uses explicit and unique material catalogue matches', async () => {
  const catalogue = [
    { id:'11111111-1111-4111-8111-111111111111', material:'PLA', materialKey:'PLA', brand:'A', product:'PLA', costPerKg:20, currency:'GBP' },
    { id:'22222222-2222-4222-8222-222222222222', material:'PETG', materialKey:'PETG', brand:'B', product:'PETG', costPerKg:30, currency:'GBP' }
  ];
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const snapshot = await buildMaterialCostSnapshot({
    requirements:{
      logicalTools:[
        { index:0, material:'PLA', color:'#000000', filamentGrams:20 },
        { index:1, material:'PETG', color:'#FFFFFF', filamentGrams:5 }
      ]
    },
    filamentAssignments:{ 0:catalogue[0].id }
  }, {
    getFilamentFn:async (id) => byId.get(id) || null,
    listFilamentsFn:async () => catalogue,
    capturedAt:'2026-09-30T10:00:00.000Z'
  });

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.totalGrams, 25);
  assert.equal(snapshot.currency, 'GBP');
  assert.equal(snapshot.totalCost, 0.55);
  assert.equal(snapshot.tools[0].resolution, 'assigned');
  assert.equal(snapshot.tools[0].cost, 0.4);
  assert.equal(snapshot.tools[1].resolution, 'unique-material-match');
  assert.equal(snapshot.tools[1].cost, 0.15);
});

test('material costing refuses to guess between multiple matching catalogue entries', async () => {
  const catalogue = [
    { id:'11111111-1111-4111-8111-111111111111', material:'PLA', materialKey:'PLA', costPerKg:18, currency:'GBP' },
    { id:'33333333-3333-4333-8333-333333333333', material:'PLA', materialKey:'PLA', costPerKg:22, currency:'GBP' }
  ];
  const snapshot = await buildMaterialCostSnapshot({
    requirements:{ logicalTools:[{ index:0, material:'PLA', filamentGrams:10 }] }
  }, {
    getFilamentFn:async () => null,
    listFilamentsFn:async () => catalogue
  });

  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.totalCost, null);
  assert.match(snapshot.tools[0].issue, /Multiple PLA catalogue entries/);
});


test('material costing auto-matches an unambiguous slicer vendor/profile among same-material catalogue entries', async () => {
  const catalogue = [
    { id:'11111111-1111-4111-8111-111111111111', material:'PLA', materialKey:'PLA', brand:'eSUN', product:'PLA+ HS', costPerKg:21.95, currency:'GBP' },
    { id:'33333333-3333-4333-8333-333333333333', material:'PLA', materialKey:'PLA', brand:'Polymaker', product:'PolyLite PLA', costPerKg:24.99, currency:'GBP' }
  ];
  const snapshot = await buildMaterialCostSnapshot({
    requirements:{
      logicalTools:[{
        index:0,
        material:'PLA',
        filamentGrams:73.4,
        filamentPreset:'eSUN PLA+ HS @Snapmaker U1',
        filamentVendor:'eSUN'
      }]
    }
  }, {
    getFilamentFn:async () => null,
    listFilamentsFn:async () => catalogue,
    capturedAt:'2026-09-30T12:00:00.000Z'
  });

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.tools[0].filamentId, catalogue[0].id);
  assert.equal(snapshot.tools[0].resolution, 'slicer-profile-match');
  assert.equal(snapshot.tools[0].filamentPreset, 'eSUN PLA+ HS @Snapmaker U1');
  assert.equal(snapshot.tools[0].filamentVendor, 'eSUN');
  assert.equal(snapshot.totalCost, 1.6111);
});

test('material costing still requires explicit selection when a slicer profile is ambiguous', async () => {
  const catalogue = [
    { id:'11111111-1111-4111-8111-111111111111', material:'PLA', materialKey:'PLA', brand:'eSUN', product:'PLA+ Black', costPerKg:20, currency:'GBP' },
    { id:'33333333-3333-4333-8333-333333333333', material:'PLA', materialKey:'PLA', brand:'eSUN', product:'PLA+ White', costPerKg:22, currency:'GBP' }
  ];
  const snapshot = await buildMaterialCostSnapshot({
    requirements:{
      logicalTools:[{
        index:0,
        material:'PLA',
        filamentGrams:10,
        filamentPreset:'eSUN PLA+ @Snapmaker U1',
        filamentVendor:'eSUN'
      }]
    }
  }, {
    getFilamentFn:async () => null,
    listFilamentsFn:async () => catalogue
  });

  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.totalCost, null);
  assert.match(snapshot.tools[0].issue, /did not identify one unique PLA catalogue entry/);
});
