import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html = read('public/index.html');
const dashboard = read('ui/dashboard.jsx');
const css = read('public/dashboard-polish.css');
const chromium = read('scripts/browser-regression.mjs');

const routes = {
  licenseDialog:'Licence',
  diagnosticsDialog:'Diagnostics',
  printerGroupsDialog:'Printer groups',
  reportingDialog:'Reports &amp; finance',
  maintenanceDialog:'Maintenance tracking',
  alertsDialog:'Alerts &amp; notifications',
  backupRecoveryDialog:'Backup &amp; recovery',
  libraryDialog:'Print library',
  queueDialog:'Print queue &amp; history'
};

test('all main workspace routes use the same page heading as Dashboard', () => {
  assert.match(dashboard,/class="dashboard-hero ui-page-heading"/);
  assert.match(dashboard,/class="dashboard-hero-copy ui-page-heading-copy"/);
  assert.match(dashboard,/class="dashboard-eyebrow ui-page-eyebrow"/);
  assert.match(dashboard,/<h2 class="ui-page-title">Farm overview<\/h2>/);
  assert.match(dashboard,/<p class="ui-page-description">/);
  for(const [id,title] of Object.entries(routes)){
    const start=html.indexOf(`<section id="${id}"`);
    assert.ok(start>=0,'missing page '+id);
    const head=html.slice(start,start+800);
    assert.match(head,/<div class="dialog-head ui-page-heading(?: [^"]+)?">/);
    assert.match(head,/<div class="ui-page-heading-copy">/);
    assert.match(head,/<div class="eyebrow ui-page-eyebrow">/);
    assert.ok(head.includes(`<h2 class="ui-page-title">${title}</h2>`),
      'heading title or hierarchy changed on '+id);
    assert.match(head,/<div [^>]*class="ui-page-description subtle">/);
  }
  assert.equal((html.match(/class="dialog-head ui-page-heading/g)||[]).length,9,
    'all nine main routes use shared heading; smaller pop-up dialogs remain separate');
});

test('shared visual heading uses a single theme-aware typography specification', () => {
  assert.match(css,/\.ui-page-heading-copy \{ display:grid;gap:5px;/);
  assert.match(css,/\.ui-page-heading \.ui-page-eyebrow,/);
  assert.match(css,/\.ui-page-heading \.ui-page-title,/);
  assert.match(css,/\.ui-page-heading \.ui-page-description,/);
  assert.match(css,/\.route-page \.dialog-head\.ui-page-heading \{/);
  assert.match(css,/border:0;/);
  assert.match(css,/font-size:clamp\(1\.28rem,1\.65vw,1\.72rem\)/);
  assert.match(css,/color:var\(--ds-brand\)/);
  assert.match(css,/color:var\(--ds-text-muted\)/);
  assert.match(chromium,/workspaceHeadingSmoke\(page,url\)/);
});

test('dynamic page descriptions and controls remain intact',()=>{
  for(const id of ['queueSummary','librarySummary','dashboardGroupFilter','queueAddFileBtn',
    'libraryUploadBtn','reportingTabAnalytics','maintenanceDialog','backupStatusGrid'])
    assert.ok(html.includes(`id="${id}"`),'missing controller-owned input/action '+id);
  assert.match(html,/id="queueSummary" class="ui-page-description subtle"/);
  assert.match(html,/id="librarySummary" class="ui-page-description subtle"/);
  assert.doesNotMatch(css,/\.dialog-head(?::not\(\))?\s*\{\s*display:none;/);
});
