import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const app=read('public/app.js');
const css=read('public/tab-navigation.css');
const components=read('ui/components.jsx');
const modules={
  details:read('ui/printer-details.jsx'),
  maintenance:read('ui/maintenance.jsx'),
  groups:read('ui/printer-groups.jsx'),
  alerts:read('ui/alerts.jsx'),
  reports:read('ui/reporting.jsx'),
  backup:read('ui/backup-recovery.jsx')
};

test('Phase 4.1 shared tabs are loaded last, local, theme-aware and scoped to tablists',()=>{
  const old=html.indexOf('href="/printer-details-polish.css"');
  const shared=html.indexOf('href="/tab-navigation.css"');
  assert.ok(old>0&&shared>old,'shared stylesheet must supersede printer and legacy styles');
  assert.match(css,/\[data-pfc-tabs\]\[role="tablist"\]/);
  assert.match(css,/\[data-pfc-tabs\] \[role="tab"\]/);
  assert.match(css,/border-bottom:3px solid transparent/);
  assert.match(css,/border-bottom-color:var\(--ds-brand\)/);
  assert.match(css,/background:transparent/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/scrollbar-width:thin/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css,/dashboard-view-toggle|summary-card|\bfleet\b/,
    'only actual tablists receive this navigation treatment');
  assert.match(css,/data:image\/svg\+xml/);
});

test('Preact shares a single UiTab primitive while all pages own their actions and selection',()=>{
  assert.match(components,/export function UiTab\(\{ icon = ''/);
  assert.match(components,/data-pfc-icon=\{icon \|\| undefined\}/);
  for(const [page,source] of Object.entries(modules)){
    assert.ok(source.includes('UiTab'),page+' must use shared tab component');
    assert.ok(source.includes('data-pfc-icon') || source.includes('icon='),page+' must supply icons');
  }
  assert.match(modules.details,/onKeyDown=\{\(event\) => activateFromKeyboard/);
  assert.match(modules.maintenance,/dispatchMaintenanceAction\('view', key\)/);
  assert.match(modules.reports,/dispatchReportingAction\('tab', tab\.key\)/);
  assert.match(modules.alerts,/dispatchAlertsAction\('tab', tab\.key\)/);
  assert.match(modules.backup,/dispatchBackupAction\('tab', key\)/);
  assert.match(modules.groups,/switchTab\('create'\)/);
});

test('Legacy fallback exposes matching icon names on every tabbed page',()=>{
  const icons={
    details:{toolheads:'sliders',camera:'camera',files:'files',temperature:'thermometer',job:'clock',management:'wrench'},
    maintenance:{add:'plus',model:'printer',group:'layers',printers:'wrench'},
    groups:{create:'plus',groups:'layers'},
    reports:{analytics:'chart',filament:'spool'},
    alerts:{history:'clock',destinations:'bell',rules:'sliders'},
    backup:{overview:'database','google-drive':'cloud','one-drive':'cloud',s3:'server',schedule:'calendar',restore:'restore'}
  };
  const attributes={
    details:'data-detail-tab',maintenance:'data-maintenance-view',
    groups:'data-printer-groups-tab',reports:'data-reporting-tab',
    alerts:'data-alerts-tab',backup:'data-backup-tab'
  };
  for(const [page,tabs] of Object.entries(icons)){
    const source=page==='details'?app:html;
    for(const [key,icon] of Object.entries(tabs)){
      const marker=attributes[page]+'="'+key+'"';
      assert.ok(source.includes(marker+' data-pfc-icon="'+icon+'"'),
        page+' '+key+' fallback icon must match the shared design');
      assert.ok(css.includes('[data-pfc-icon="'+icon+'"]::before'),
        page+' '+key+' icon must have a local mask definition');
    }
  }
  assert.equal((html.match(/data-pfc-tabs role="tablist"/g)||[]).length,6,
    'Security & users adds the sixth canonical tablist');
  assert.match(html,/id="authTabUsers"[^>]*role="tab"[^>]*data-pfc-icon="users"/);
  assert.match(html,/id="authTabHttps"[^>]*role="tab"[^>]*data-pfc-icon="server"/);
  assert.match(css,/#usersDialog \[data-pfc-tabs\]/);
  assert.match(css,/\[data-pfc-icon="users"\]::before/);
  assert.match(app,/data-pfc-tabs role="tablist" aria-label="Printer details"/);
});
