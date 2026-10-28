import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const dashboard = read('ui/dashboard.jsx');
const polish = read('public/dashboard-polish.css');
const browser = read('scripts/browser-regression.mjs');

test('Farm operations is a dashboard switch, not a sidebar or overflow menu item', () => {
  assert.doesNotMatch(html, /id="batchModeBtn"|id="batchModeMenuBtn"|id="topbarOverflow"/);
  assert.match(html, /id="farmOperationsToggle"[^>]+role="switch"[^>]+aria-checked="false"/);
  assert.match(html, /id="farmOperationsToggle"[^>]+aria-controls="batchToolbar"/);
  assert.match(html, /class="dashboard-view-control dashboard-operations-control"/);
  assert.match(html, /id="batchToolbar" class="batch-toolbar hidden"/);
  assert.match(dashboard, /id="farmOperationsToggle"/);
  assert.match(dashboard, /dispatchDashboardAction\('operations', !state\.farmOperationsEnabled\)/);
  assert.match(dashboard, /disabled=\{state\.farmOperationsBusy\}/);
});

test('switch and bulk controls share controller state in Preact and fallback', () => {
  assert.match(app, /function setSelectionMode\(enabled\)/);
  assert.match(app, /if \(!selectionMode\) \{\s*selectedPrinterIds\.clear\(\)/);
  assert.match(app, /farmOperationsEnabled:selectionMode/);
  assert.match(app, /farmOperationsBusy:batchBusy/);
  assert.match(app, /action\.type === 'operations' && activeRoute === '\/' && !batchBusy/);
  assert.match(app, /if \(routePath !== '\/' && selectionMode\) setSelectionMode\(false\)/);
  assert.match(app, /farmOperationsToggle\?\.addEventListener\('click'/);
  assert.match(app, /farmOperationsToggle\.setAttribute\('aria-checked', String\(selectionMode\)\)/);
  assert.match(app, /farmOperationsToggle\.disabled = batchBusy/);
  assert.doesNotMatch(app, /batchModeBtn|batchModeMenuBtn|topbarOverflow/);
});

test('switch uses the agreed visual geometry, mobile layout, and Chromium interactions', () => {
  assert.match(html, /dashboard-view-toggle dashboard-operations-toggle/);
  assert.match(polish, /#dashboardPreactRoot > \.dashboard-controls/);
  assert.match(polish, /dashboard-operations-toggle \.dashboard-view-toggle-label/);
  assert.match(browser, /const operations=page\.locator\('#farmOperationsToggle'\)/);
  assert.match(browser, /Farm operations switch stays visible on mobile/);
});
