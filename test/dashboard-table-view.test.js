import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('dashboard exposes a card/table view switch with a tabular printer header', () => {
  assert.match(html, /id="dashboardViewToggle"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.match(html, /id="fleetViewport"/);
  assert.match(html, /id="fleetTableHeader" class="fleet-table-header hidden"/);
  for (const heading of ['Printer', 'Status', 'Current job', 'Progress', 'Nozzle', 'Bed', 'Layer', 'Remaining', 'Filament', 'Last seen', 'Actions']) {
    assert.match(html, new RegExp(`<span>${heading}<\\/span>`));
  }
});

test('dashboard view preference persists in browser local storage', () => {
  assert.match(app, /const DASHBOARD_VIEW_STORAGE_KEY = 'printer-fleet-dashboard-view'/);
  assert.match(app, /function savedDashboardViewMode\(\)/);
  assert.match(app, /localStorage\.getItem\(DASHBOARD_VIEW_STORAGE_KEY\)/);
  assert.match(app, /function applyDashboardViewMode\(mode, \{ persist = false \} = \{\}\)/);
  assert.match(app, /localStorage\.setItem\(DASHBOARD_VIEW_STORAGE_KEY, dashboardViewMode\)/);
  assert.match(app, /applyDashboardViewMode\(savedDashboardViewMode\(\) \|\| 'cards'\)/);
  assert.match(app, /dashboardViewToggle\?\.addEventListener\('click'/);
});

test('table mode reuses live printer cards as compact rows without model artwork', () => {
  assert.match(styles, /\.fleet-viewport\.table-view\s*\{[\s\S]*--dashboard-table-columns/);
  assert.match(styles, /\.fleet-table-header\s*\{[\s\S]*grid-template-columns:var\(--dashboard-table-columns\)/);
  assert.match(styles, /\.fleet\.table-view \.card\s*\{[\s\S]*grid-template-columns:var\(--dashboard-table-columns\)/);
  assert.match(styles, /\.fleet\.table-view \.printer-model-image,[\s\S]*\.printer-model-fallback \{ display:none; \}/);
  assert.match(styles, /\.fleet\.table-view \.dashboard-filament-overlay\s*\{[\s\S]*position:static/);
  assert.match(styles, /\.fleet\.table-view \.card-footer-actions\s*\{[\s\S]*grid-column:11/);
});

test('table header follows existing dashboard filtering and empty-result state', () => {
  const start = app.indexOf('function applyDashboardFilter()');
  const end = app.indexOf('\nfunction setDashboardFilter', start);
  assert.ok(start >= 0 && end > start, 'applyDashboardFilter should exist');
  const block = app.slice(start, end);
  assert.match(block, /visible \+= 1/);
  assert.match(block, /fleetTableHeader\?\.classList\.toggle\('hidden', dashboardViewMode !== 'table' \|\| visible === 0\)/);
});


test('table presentation matches alerts header styling and aligns status/control elements', () => {
  assert.match(styles, /\.fleet-table-header\s*\{[\s\S]*background:#151e25;[\s\S]*color:#fff;[\s\S]*font-weight:800;[\s\S]*letter-spacing:\.04em;/);
  assert.doesNotMatch(styles, /:root\[data-theme="light"\] \.fleet-table-header\s*\{/);
  assert.match(styles, /\.fleet\.table-view \.badge\s*\{[\s\S]*align-self:center;/);
  assert.match(styles, /\.fleet\.table-view \.maintenance-status-icon-button\s*\{[\s\S]*align-self:center;[\s\S]*padding:0;/);
  assert.match(styles, /\.dashboard-controls\s*\{[\s\S]*display:grid;[\s\S]*grid-template-columns:auto minmax\(210px,320px\) auto auto;[\s\S]*align-items:center;/);
  assert.match(styles, /\.dashboard-group-filter,\s*\.dashboard-view-control\s*\{[\s\S]*display:contents;/);
  assert.match(styles, /\.dashboard-view-toggle\s*\{[\s\S]*height:var\(--dropdown-field-height\);[\s\S]*min-height:var\(--dropdown-field-height\);/);
});


test('table metric and filament columns inherit the normal row background in light mode', () => {
  assert.match(styles, /:root\[data-theme="light"\] \.fleet\.table-view \.metric,[\s\S]*:root\[data-theme="light"\] \.fleet\.table-view \.printer-image-slot\s*\{[\s\S]*background:transparent;/);
});


test('printer group and dashboard view controls share the same labelled 42px alignment', () => {
  assert.match(html, /class="dashboard-view-control"[\s\S]*class="dashboard-view-label">Dashboard view<[\s\S]*id="dashboardViewToggle"/);
  assert.match(styles, /\.dashboard-controls\s*\{[\s\S]*grid-template-columns:auto minmax\(210px,320px\) auto auto;[\s\S]*align-items:center;/);
  assert.match(styles, /\.dashboard-group-filter,\s*\.dashboard-view-control\s*\{[\s\S]*display:contents;/);
  assert.match(styles, /\.dashboard-group-filter label,\s*\.dashboard-view-label\s*\{[\s\S]*line-height:1;/);
  assert.match(styles, /\.dashboard-group-filter select\s*\{[\s\S]*height:var\(--dropdown-field-height\);/);
  assert.match(styles, /\.dashboard-view-toggle\s*\{[\s\S]*height:var\(--dropdown-field-height\);[\s\S]*margin:0;/);
});


test('table filament swatches have no surrounding background treatment in light mode', () => {
  assert.match(styles, /:root\[data-theme="light"\] \.fleet\.table-view \.dashboard-filament-overlay\s*\{[\s\S]*background:transparent;[\s\S]*border-color:transparent;[\s\S]*box-shadow:none;/);
});
