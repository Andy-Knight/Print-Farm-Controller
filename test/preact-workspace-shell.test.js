import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html'), app=read('public/app.js');
const styles=read('public/shell.css'), preact=read('ui/workspace-shell.jsx');
const dashboard=read('ui/dashboard.jsx'), browser=read('scripts/browser-regression.mjs');

test('new shell stylesheet layers after Phase 1 tokens without overwriting the original stylesheet',()=>{
  const order=['href="/styles.css"','href="/design-system.css"','href="/shell.css"'];
  assert.ok(order.every(s=>html.includes(s)));
  assert.ok(html.indexOf(order[0])<html.indexOf(order[1])&&html.indexOf(order[1])<html.indexOf(order[2]));
  for(const selector of ['.app-sidebar','.sidebar-nav','.sidebar-section-label','.modern-topbar',
    '.workspace-trail-root','.sidebar-backdrop','.sidebar-quick-add'])
    assert.ok(styles.includes(selector),'missing shell style '+selector);
  assert.match(styles,/:root\[data-theme="light"\]/);
  assert.match(styles,/@media \(max-width:760px\)/);
  assert.match(styles,/@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(styles,/@import\s+url\(https?:/i);
});

test('sidebar retains controller-owned action selectors, routes and accessible nav semantics',()=>{
  for(const selector of ['id="controllerSidebar"','id="sidebarToggle"','id="sidebarBackdrop"',
    'id="addPrinterBtn"','id="batchModeBtn"','id="maintenanceBtn"',
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
  assert.match(app,/pfc:shell-navigate/);
  assert.match(app,/navigateController\(event\?\.detail\?\.route \|\| '\/'\)/);
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
});

test('Preact breadcrumb is a passive subscribed shell island, and legacy breadcrumb is usable',()=>{
  assert.match(html,/id="workspaceTrailRoot"/);
  assert.match(html,/id="workspaceTrailActive"/);
  assert.match(app,/window\.__PFC_SHELL_ROUTE_STATE__ =/);
  assert.match(app,/pfc:shell-route-state/);
  assert.match(preact,/export function initWorkspaceShell/);
  assert.match(preact,/window\.addEventListener\('pfc:shell-route-state'/);
  assert.match(preact,/aria-current="page"/);
  assert.match(preact,/pfc:shell-navigate/);
  assert.match(dashboard,/initWorkspaceShell\(\)/);
  assert.match(browser,/workspaceShellSmoke\(browser,url\)/);
});
