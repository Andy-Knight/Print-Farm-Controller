import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const css=read('public/design-system.css');
const html=read('public/index.html');
const components=read('ui/components.jsx');
const dashboard=read('ui/dashboard.jsx');
const regression=read('scripts/browser-regression.mjs');

test('design-system stylesheet loads after legacy CSS and keeps the original theme setting',()=>{
  assert.ok(html.includes('<link rel="stylesheet" href="/styles.css" />'));
  assert.ok(html.includes('<link rel="stylesheet" href="/design-system.css" />'));
  assert.ok(html.indexOf('href="/styles.css"')<html.indexOf('href="/design-system.css"'));
  assert.match(html,/printer-fleet-theme/);
  assert.match(css,/:root\[data-theme="light"\]/);
  assert.match(css,/color-scheme:dark/);
  assert.match(css,/color-scheme:light/);
  for(const token of ['--ds-surface','--ds-text','--ds-border','--ds-brand','--ds-focus',
    '--ds-space-4','--ds-radius-md','--ds-button-height','--ds-shadow-md'])
    assert.ok(css.includes(token),'missing shared token '+token);
  assert.doesNotMatch(css,/@import\s+url\(https?:/i,'no external font or theme stylesheet is permitted');
});

test('shared Preact primitives expose accessible loading, field, panel and feedback contracts',()=>{
  for(const component of ['UiButton','UiSurface','UiSectionHeading','UiEmptyState',
    'UiInlineMessage','UiSelectField','UiSkeleton'])
    assert.match(components,new RegExp('export function '+component+'\\b'));
  assert.match(components,/disabled=\{Boolean\(props\.disabled \|\| busy\)\}/);
  assert.match(components,/aria-busy=\{busy \? 'true' : undefined\}/);
  assert.match(components,/aria-invalid=\{error \? 'true' : undefined\}/);
  assert.match(components,/aria-describedby=\{describedBy\}/);
  assert.match(components,/aria-hidden="true"/);
  assert.match(components,/<UiSurface tone="muted" class="metric ui-metric">/);
});

test('dashboard upgrades visual surfaces without changing controller action or progress hooks',()=>{
  assert.match(dashboard,/ui-stat-card/);
  assert.match(dashboard,/data-tone=\{tone\}/);
  assert.match(dashboard,/const tone = item\.key === 'attention'/);
  assert.match(dashboard,/ui-printer-surface/);
  for(const data of ['data-dashboard-filter','data-printer-card','data-progress-value',
    'data-card-job-control','data-open','data-nozzle','data-bed'])
    assert.ok(dashboard.includes(data),'must retain action/telemetry hook '+data);
  assert.match(css,/\.fleet:not\(\.table-view\) \.card\.ui-printer-surface/);
  assert.match(css,/\.ui-metric\.ui-surface/);
  assert.match(css,/\.summary-card\.ui-stat-card\.active/);
  assert.doesNotMatch(css,/\.fleet\.table-view \.card\.ui-printer-surface\s*\{/,
    'do not override densely aligned table rows');
});

test('motion and visual regression safeguards cover both themes and narrow displays',()=>{
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css,/@media \(max-width:620px\)/);
  assert.match(css,/\.ui-button:focus-visible/);
  assert.match(css,/\.ui-form-field \[aria-invalid="true"\]/);
  assert.match(regression,/async function designSystemSmoke\(/);
  assert.match(regression,/for\(const theme of \['dark','light'\]\)/);
  assert.match(regression,/width:390,height:844/);
  assert.match(regression,/reducedMotion:'reduce'/);
  assert.match(regression,/PFC_VISUAL_CAPTURE_DIR/);
});

test('card-view printer images align on shared CSS subgrid rows without changing table mode',()=>{
  assert.match(css,/@supports \(grid-template-rows:subgrid\)/);
  assert.match(css,/\.fleet:not\(\.table-view\) > \.card\.ui-printer-surface \{/);
  assert.match(css,/grid-row:span 8;/);
  assert.match(css,/grid-template-rows:subgrid;/);
  assert.match(css,/\.fleet:not\(\.table-view\) \{ row-gap:0; \}/,
    'parent fleet subgrid tracks must not insert phantom gaps between hidden sections');
  assert.match(css,/margin-bottom:13px;/,
    'whole printer cards should remain separated on desktop');
  assert.match(css,/margin-bottom:10px;/,
    'whole printer cards should remain separated on mobile');
  const polish=read('public/dashboard-polish.css');
  assert.match(polish,/padding:10px 20px 19px;/,
    'model images need additional clearance above the lower image border');
  for(const [section,row] of [
    ['card-head',1],['printer-image-slot',2],['bed-level-strip',3],
    ['license-strip',4],['preheat-strip',5],['bed-clearance-strip',6],
    ['card-body',7],['card-footer',8]
  ]){
    assert.ok(css.includes(`> .${section} { grid-row:${row}; }`) ||
      (section==='card-footer'&&css.includes('> .card-footer {\n    grid-row:8;')),
      'card section needs stable shared grid row: '+section);
  }
  assert.doesNotMatch(css,/\.fleet\.table-view > \.card\.ui-printer-surface \{/);
  assert.match(regression,/for\(const width of \[1365,1800\]\)/);
  assert.match(regression,/images must align for wrapped and short names/);
});

test('GitHub visual-regression artifacts use a native Node.js 24 action',(t)=>{
  // Packaged Windows/container source installations can omit .github entirely.
  // The CI contract is meaningful only when repository workflow files exist.
  const workflowPath=new URL('../.github/workflows/container-image.yml',import.meta.url);
  if(!existsSync(workflowPath)){
    if(process.env.GITHUB_ACTIONS){
      assert.fail('GitHub Actions checkout must include .github/workflows/container-image.yml');
    }
    t.skip('GitHub workflow metadata is not shipped with this installation');
    return;
  }
  const workflow=readFileSync(workflowPath,'utf8');
  assert.equal((workflow.match(/uses: actions\/upload-artifact@v7/g)||[]).length,2,
    'visual screenshot and failure artifact uploads must use the Node.js 24 action');
  assert.doesNotMatch(workflow,/uses: actions\/upload-artifact@v[1-5](?:\s|$)/m,
    'Node 20 artifact upload actions cause deprecated runtime warnings');
  assert.match(workflow,/PFC_VISUAL_CAPTURE_DIR:/,
    'browser regression should still produce theme review screenshots');
});

test('dashboard summary adopts the Analytics circular icon and genuine-ratio presentation',()=>{
  const skin=read('public/design-system.css');
  const fallback=read('public/app.js');
  assert.match(dashboard,/function DashboardSummarySymbol/);
  for(const icon of ['printer','connected','printing','warning','check'])
    assert.ok(dashboard.includes(`name === '${icon}'`),'missing status symbol '+icon);
  assert.match(dashboard,/dashboard-stat-gauge-neutral/);
  assert.match(dashboard,/dashboard-stat-meter/);
  assert.match(dashboard,/aria-valuenow=\{percent\}/);
  assert.match(dashboard,/configured > 0/);
  assert.match(skin,/conic-gradient\(from -90deg,var\(--dashboard-stat-color\)/);
  assert.match(skin,/\.dashboard-stat-icon svg/);
  // Icon and all text stay in the same horizontal row, never stacked.
  assert.match(skin,/grid-template-columns:72px minmax\(0,1fr\)/);
  assert.match(skin,/grid-column:1; grid-row:1/);
  assert.match(skin,/grid-column:2; grid-row:1/);
  assert.match(skin,/grid-template-columns:52px minmax\(0,1fr\)/);
  const polish=read('public/dashboard-polish.css');
  assert.doesNotMatch(polish,/#summary \.summary-card\.ui-stat-card\s*\{/,
    'late-loaded dashboard polish must not replace the new two-column layout');
  assert.match(polish,/#summary \.summary-card\.ui-stat-card:not\(\.dashboard-summary-kpi\)/);
  assert.match(regression,/dashboard summary text always remains beside its ring/);
  assert.match(skin,/#summary \.dashboard-summary-kpi\[data-tone="working"\]/);
  assert.match(skin,/#summary \.dashboard-summary-kpi\[data-tone="warning"\]/);
  assert.match(skin,/:root\[data-theme="light"\] #summary \.dashboard-summary-kpi/);
  assert.match(fallback,/function dashboardSummaryIconSvg/);
  assert.match(fallback,/gauge\.style\.setProperty\('--dashboard-stat-angle'/);
  assert.match(regression,/Dashboard summary cards match Analytics outline ring styling/);
});
