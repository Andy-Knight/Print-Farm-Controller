import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html'), app=read('public/app.js');
const styles=read('public/shell.css');
const dashboard=read('ui/dashboard.jsx'), browser=read('scripts/browser-regression.mjs');

test('new shell stylesheet layers after Phase 1 tokens without overwriting the original stylesheet',()=>{
  const order=['href="/styles.css"','href="/design-system.css"','href="/shell.css"'];
  assert.ok(order.every(s=>html.includes(s)));
  assert.ok(html.indexOf(order[0])<html.indexOf(order[1])&&html.indexOf(order[1])<html.indexOf(order[2]));
  for(const selector of ['.app-sidebar','.sidebar-nav','.sidebar-section-label','.modern-topbar',
    '.sidebar-backdrop','.sidebar-quick-add'])
    assert.ok(styles.includes(selector),'missing shell style '+selector);
  assert.match(styles,/:root\[data-theme="light"\]/);
  assert.match(styles,/@media \(max-width:760px\)/);
  assert.match(styles,/@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(styles,/@import\s+url\(https?:/i);
});

test('sidebar retains controller-owned action selectors, routes and accessible nav semantics',()=>{
  for(const selector of ['id="controllerSidebar"','id="sidebarToggle"','id="sidebarBackdrop"',
    'id="addPrinterBtn"','id="farmOperationsToggle"','id="maintenanceBtn"',
    'id="queueBtn"','id="libraryBtn"','id="reportsBtn"','id="licenseBtn"',
    'id="sidebarVersion"'.replace('sidebarVersion','controllerVersion')])
    assert.ok(html.includes(selector),'lost navigation/command control '+selector);
  for(const route of ['/','/queue','/library','/maintenance','/groups','/reports',
    '/alerts','/backup','/diagnostics','/licence'])assert.ok(html.includes(`data-route="${route}"`));
  assert.match(html,/aria-controls="controllerSidebar"/);
  assert.match(html,/class="sidebar-quick-add" data-add-printer/);
  assert.match(html,/aria-label="Main navigation"/);
  assert.match(html,/class="sidebar-icon" aria-hidden="true"><svg/);
  assert.match(app,/renderControllerRoute/);
  assert.match(app,/item\.setAttribute\('aria-current','page'\)/);
  assert.match(app,/function navigateController\(routePath\)/);
  assert.match(app,/window\.addEventListener\('popstate'/);

});

test('mobile drawer guards hidden focus, Escape and backdrop interactions',()=>{
  assert.match(app,/sidebarEl\.inert = mobileSidebarQuery\.matches && !visible/);
  assert.match(app,/sidebarBackdrop\?\.addEventListener\('click'/);
  assert.match(app,/mobileSidebarQuery\.addEventListener\('change'/);
  assert.match(app,/event\.key === 'Escape'/);
  assert.match(app,/event\.key !== 'Tab'/);
  assert.match(app,/closeModernSidebar\(\{restoreFocus:true\}\)/);
  assert.match(styles,/body\.sidebar-open \.sidebar-backdrop/);
  assert.match(styles,/body\.sidebar-open \{ overflow:hidden; \}/);
  assert.match(html,/class="workspace-skip-link" href="#workspaceMain"/);
  assert.match(html,/<main id="workspaceMain" tabindex="-1">/);
  assert.match(styles,/\.workspace-skip-link:focus/);
  assert.match(app,/sidebarEl\.setAttribute\('aria-modal','true'\)/);
});

test('the workspace topbar retains route context without breadcrumbs in Preact or fallback',()=>{
  assert.match(html,/id="topbarContextTitle" tabindex="-1">Dashboard<\/strong>/);
  assert.match(html,/id="topbarContextSubtitle">Monitor and manage your print farm<\/span>/);
  assert.match(app,/document\.querySelector\('#topbarContextTitle'\)/);
  assert.match(app,/document\.querySelector\('#topbarContextSubtitle'\)/);
  assert.match(app,/topbarContextTitle\.textContent = route\.topbarTitle \|\| route\.title/);
  assert.match(app,/topbarContextSubtitle\.textContent = route\.subtitle/);
  for(const source of [html,styles,app,dashboard])
    assert.doesNotMatch(source,/workspaceTrail|workspace-trail|initWorkspaceShell|Breadcrumb/i,
      'static and bundled layouts must not reintroduce breadcrumbs');
  assert.doesNotMatch(app,/pfc:shell-route-state|pfc:shell-navigate/);
  assert.doesNotMatch(dashboard,/workspace-shell\.jsx/);
  assert.doesNotMatch(app,/querySelector\('\.topbar-context span'\)/,
    'route subtitles must use a dedicated binding');
  assert.match(browser,/workspaceShellSmoke\(browser,url\)/);
  assert.match(browser,/breadcrumb elements must be absent/);
});

test('Farm Management pages share its topbar title except the named Users & settings page',()=>{
  const workNav=html.split('class="sidebar-section-label">WORKSPACE</span>')[1]
    ?.split('class="sidebar-section-label">FARM MANAGEMENT</span>')[0]||'';
  const manageNav=html.split('class="sidebar-section-label">FARM MANAGEMENT</span>')[1]
    ?.split('</nav>')[0]||'';
  const managementRoutes=['/maintenance','/groups','/reports','/alerts','/backup','/diagnostics','/users'];
  const workspaceRoutes=['/','/queue','/library'];
  const readRoutes=(markup)=>[...markup.matchAll(/class="sidebar-item[^"]*"[^>]*data-route="([^"]+)"/g)]
    .map(([,path])=>path);
  assert.deepEqual(readRoutes(manageNav),managementRoutes);
  assert.deepEqual(readRoutes(workNav),workspaceRoutes);
  for(const route of managementRoutes){
    const line=app.split('\n').find(s=>s.startsWith("  '"+route+"': {"));
    assert.ok(line,'missing route '+route);
    const title=route==='/users'?'Users & settings':'Farm management';
    assert.ok(line.includes("topbarTitle:'"+title+"'"),
      'route must use its expected topbar title: '+route);
  }
  for(const route of [...workspaceRoutes,'/licence']){
    const line=app.split('\n').find(s=>s.startsWith("  '"+route+"': {"));
    assert.ok(line,'missing route '+route);
    assert.ok(!line.includes('topbarTitle:'),
      'Workspace and footer pages should retain individual topbar titles: '+route);
  }
  assert.match(app,/topbarContextSubtitle\.textContent = route\.subtitle/);
  assert.match(browser,/Farm management sections retain their common topbar title/);
});

test('compact topbar and shared page gap follow the same responsive spacing',()=>{
  assert.match(styles,/--shell-topbar-height:64px/);
  assert.match(styles,/\.modern-topbar \{\s*min-height:var\(--shell-topbar-height\);\s*padding:10px 29px;/);
  assert.match(styles,/body > main \{ padding-top:18px; \}/);
  assert.match(styles,/\.modern-topbar \{ min-height:60px;padding:10px 13px;gap:10px; \}/);
  assert.match(styles,/body > main \{ padding-top:16px; \}/);
  assert.match(styles,/\.topbar-context #topbarContextSubtitle/);
  assert.match(browser,/topbar height must stay compact/);
});
