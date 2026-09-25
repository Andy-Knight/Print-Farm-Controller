import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('dashboard summary filters keep stable DOM nodes across live fleet refreshes', () => {
  const start = app.indexOf('function renderSummary()');
  const end = app.indexOf('\nfunction applyDashboardFilter()', start);
  assert.ok(start >= 0 && end > start, 'renderSummary function should exist');
  const renderSummary = app.slice(start, end);

  assert.match(renderSummary, /existingButtons/);
  assert.match(renderSummary, /structureValid/);
  assert.match(renderSummary, /button\.classList\.toggle\('active', active\)/);
  assert.match(renderSummary, /count\.textContent = String\(value\)/);

  const innerHtmlAssignments = [...renderSummary.matchAll(/summaryEl\.innerHTML\s*=/g)];
  assert.equal(innerHtmlAssignments.length, 1, 'summary markup should only be rebuilt when its structure is missing or invalid');
  assert.match(renderSummary, /if \(!structureValid\) \{/);
});

test('dashboard filter clicks remain delegated from the stable summary container', () => {
  assert.match(app, /summaryEl\.addEventListener\('click',[\s\S]*?closest\('\[data-dashboard-filter\]'\)[\s\S]*?setDashboardFilter\(filter\.dataset\.dashboardFilter\)/);
});
