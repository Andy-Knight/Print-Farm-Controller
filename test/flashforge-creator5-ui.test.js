import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const adapter = fs.readFileSync(new URL('../src/adapters/flashforge-creator5-adapter.js', import.meta.url), 'utf8');
const registry = fs.readFileSync(new URL('../src/adapters/adapter-registry.js', import.meta.url), 'utf8');

test('Creator 5 models are exposed as a supported adapter with explicit model selection', () => {
  assert.match(registry, /flashForgeCreator5AdapterDefinition/);
  assert.match(adapter, /models:\['Creator 5', 'Creator 5 Pro'\]/);
  assert.match(adapter, /name:'model'[\s\S]*type:'select'/);
  assert.doesNotMatch(adapter, /name:'tcpPort'/);
});

test('Creator 5 printer details expose four-tool setup and Pro chamber controls', () => {
  assert.match(app, /function renderCreator5PrintSetup\(/);
  assert.match(app, /function creator5MappingAssessment\(/);
  assert.match(app, /printer\.adapterType === 'flashforge-creator5'\) renderCreator5PrintSetup/);
  assert.match(app, /Creator 5 uses four independent physical toolheads\/material slots/);
  assert.match(app, /id="chamberInput"/);
  assert.match(app, /data-set-temp="chamber"/);
  assert.match(server, /chamberTemperatureControl/);
  assert.match(server, /Chamber must be \$\{min\}-\$\{max\} C/);
});

test('Creator 5 local-file setup warns when firmware cannot reveal sliced tool requirements', () => {
  assert.match(adapter, /does not expose per-file tool\/material requirements/);
  assert.match(app, /does not expose its sliced tool requirements/);
});
