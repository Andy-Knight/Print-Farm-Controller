import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const dashboard=read('ui/dashboard.jsx');
const styles=read('public/dashboard-polish.css');
const base=read('public/design-system.css');
const app=read('public/app.js');
const browser=read('scripts/browser-regression.mjs');

test('dashboard stylesheet loads after design-system and workspace shell without remote assets',()=>{
  const links=['styles.css','design-system.css','shell.css','dashboard-polish.css'];
  const indices=links.map(path=>html.indexOf(`href="/${path}"`));
  assert.ok(indices.every(index=>index>0));
  assert.ok(indices.every((item,i)=>i===0||item>indices[i-1]));
  assert.doesNotMatch(styles,/@import\s+url\(https?:/i);
  assert.match(styles,/--ds-surface/);
  assert.match(styles,/@media \(prefers-reduced-motion:reduce\)/);
});

test('Phase 3 presents clear farm and printer hierarchy with detailed operational metrics',()=>{
  assert.match(dashboard,/class="dashboard-hero ui-page-heading"/);
  assert.match(dashboard,/Farm overview/);
  assert.match(dashboard,/class="dashboard-eyebrow ui-page-eyebrow"/);
  assert.match(dashboard,/class="dashboard-stat-detail"/);
  assert.match(dashboard,/class="dashboard-fleet-heading"/);
  assert.match(dashboard,/data-dashboard-fleet-summary/);
  assert.match(dashboard,/data-dashboard-current-view/);
  assert.match(dashboard,/pfc:dashboard-state/);
  assert.match(dashboard,/pfc:dashboard-fleet-state/);
  assert.match(html,/id="dashboardFleetHeadingRoot"/);
  assert.match(dashboard,/render\(<DashboardFleetHeading \/>, fleetHeadingRoot\)/);
});

test('all four action filters, printer controls, and card/table toggle remain controller-owned',()=>{
  for(const k of ["'all'","'online'","'printing'","'attention'"]){
    assert.ok(dashboard.includes(k));
  }
  for(const action of ['data-dashboard-filter','dashboardGroupFilter','dashboardViewToggle',
    'data-printer-card','data-open','data-card-job-control','data-printer-select',
    'data-move-earlier','data-move-later','data-maintenance-open-printer',
    'data-nozzle','data-bed','data-layer','data-remaining']){
    assert.ok(dashboard.includes(action),'missing established interaction hook: '+action);
  }
  assert.match(dashboard,/dispatchDashboardAction\('view'/);
  assert.match(dashboard,/dispatchDashboardAction\('filter'/);
  assert.match(app,/window\.addEventListener\('pfc:dashboard-action'/);
  assert.match(app,/function applyDashboardFilter\(/);
});

test('visual redesign leaves table geometry and multi-row card image alignment unchanged',()=>{
  assert.match(styles,/\.fleet:not\(\.table-view\) > \.card\.ui-printer-surface/);
  assert.match(styles,/#summary \.summary-card\.ui-stat-card/);
  assert.doesNotMatch(styles,/\.fleet\.table-view \.card\s*\{/);
  assert.doesNotMatch(styles,/\.fleet\.table-view \.printer-image-slot\s*\{/);
  assert.match(base,/@supports \(grid-template-rows:subgrid\)/);
  assert.match(base,/grid-row:span 8/);
  assert.match(base,/\.fleet:not\(\.table-view\) > \.card\.ui-printer-surface > \.printer-image-slot \{ grid-row:2; \}/);
  assert.match(browser,/images must align for wrapped and short names/);
  assert.match(browser,/dashboardPhase3Smoke\(browser,url\)/);
});

test('table status column can display OFFLINE pill and maintenance icon together',()=>{
  const source=read('public/styles.css');
  assert.match(source,/--dashboard-table-columns:[^\n]* 148px /,
    'status grid column needs enough width for icon plus OFFLINE pill');
  assert.match(source,/--dashboard-table-min-width:1556px/);
  const badge=source.slice(source.indexOf('.fleet.table-view .badge {'),
    source.indexOf('.fleet.table-view .maintenance-status-icon-button {'));
  assert.match(badge,/max-width:calc\(100% - 36px\)/);
  assert.doesNotMatch(badge,/max-width:82px/);
  assert.match(browser,/OFFLINE text should fit inside the coloured badge/);
  assert.match(browser,/OFFLINE badge should fit in its table column/);
});

test('printer groups page uses Farm Organisation terminology in its shared page heading',()=>{
  const html=read('public/index.html');
  const section=html.match(/<section id="printerGroupsDialog"[\s\S]*?<div id="printerGroupsWorkspace">/)?.[0] || '';
  assert.match(section,/<div class="eyebrow ui-page-eyebrow">FARM ORGANISATION<\/div>/);
  assert.doesNotMatch(section,/FLEET ORGANISATION/);
  assert.match(section,/<h2 class="ui-page-title">Printer groups<\/h2>/);
});
