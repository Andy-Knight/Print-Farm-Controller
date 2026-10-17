import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.match(dashboard,/data-tone=\{item\.tone\}/);
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
