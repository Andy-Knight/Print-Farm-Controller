import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const queue = fs.readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
const backupService = fs.readFileSync(new URL('../src/backup-recovery/backup-service.js', import.meta.url), 'utf8');
const restoreService = fs.readFileSync(new URL('../src/backup-recovery/restore-service.js', import.meta.url), 'utf8');

test('printer groups are manageable from the persistent controller navigation', () => {
  assert.match(index, /id="printerGroupsBtn"[^>]*class="sidebar-item"/);
  assert.match(index, /id="printerGroupsDialog"/);
  assert.match(index, /id="printerGroupForm"/);
  assert.match(index, /id="printerGroupMembers"/);
  assert.match(app, /api\('\/api\/printer-groups'\)/);
  assert.match(app, /data-printer-group-member/);
  assert.match(app, /data-printer-group-edit/);
  assert.match(app, /data-printer-group-delete/);
  assert.match(server, /new PrinterGroupService/);
  assert.match(server, /url\.pathname === '\/api\/printer-groups'/);
  assert.match(server, /printerGroups\.create/);
  assert.match(server, /printerGroups\.update/);
  assert.match(server, /printerGroups\.delete/);
  assert.match(styles, /\.printer-groups-dialog/);
  assert.match(styles, /\.printer-group-member/);
});

test('printer group editor supports printers belonging to multiple groups', () => {
  assert.match(index, /A printer can belong to any number of groups/);
  assert.match(index, /does not remove it from any other groups/);
  assert.match(app, /function groupsForPrinter/);
  assert.match(app, /Also in/);
  assert.doesNotMatch(app, /selecting will move it/);
});

test('group membership is a scrollable and accessible table in Preact and fallback modes', () => {
  const preact = fs.readFileSync(new URL('../ui/printer-groups.jsx', import.meta.url), 'utf8');
  assert.match(styles, /\.printer-group-members \{[\s\S]*max-height:340px;[\s\S]*overflow:auto;/);
  assert.match(styles, /\.printer-group-members-table th \{[\s\S]*position:sticky;[\s\S]*top:0;/);
  assert.match(styles, /\.printer-group-member-checkbox \{[\s\S]*width:16px;[\s\S]*height:16px;/);
  assert.match(index, /id="printerGroupMembers"[^>]*role="region"/);
  assert.match(app, /printerGroupMembers\.innerHTML = `<table class="printer-group-members-table"/);
  assert.match(preact, /<table class="printer-group-members-table">/);
  assert.match(preact, /id="printerGroupMemberSearch"/);
  assert.match(preact, /data-printer-group-select-visible/);
  assert.match(preact, /data-printer-group-clear-visible/);
  assert.match(preact, /otherGroupsByPrinter/);
});

test('dashboard printers can be filtered by custom printer group', () => {
  assert.match(index, /id="dashboardGroupFilterBar"/);
  assert.match(index, /id="dashboardGroupFilter"/);
  assert.match(index, />All printers<\/option>/);
  assert.match(app, /let dashboardGroupId = ''/);
  assert.match(app, /function populateDashboardGroupFilterOptions\(\)/);
  assert.match(app, /function matchesDashboardGroup\(printer, groupId = dashboardGroupId\)/);
  assert.match(app, /function dashboardScopedFleet\(\)/);
  assert.match(app, /matchesDashboardGroup\(printer\) && matchesDashboardFilter\(printer\)/);
  assert.match(app, /dashboardGroupFilter\?\.addEventListener\('change'/);
  assert.match(app, /function resetDashboardFilters\(\)/);
  assert.match(app, /const scopedFleet = dashboardScopedFleet\(\)/);
  assert.match(styles, /\.dashboard-group-filter/);
  assert.match(styles, /\.dashboard-group-filter select/);
});

test('automatic fleet queue can be restricted to a selected printer group', () => {
  assert.match(index, /id="queueAddGroup"[^>]*name="groupId"/);
  assert.match(index, /Any configured printer/);
  assert.match(app, /populateQueueGroupOptions/);
  assert.match(app, /const groupId = String\(data\.get\('groupId'\)/);
  assert.match(app, /queueLibraryFile\(queueAddLibraryFile\.id, options, quantity, priority, groupId\)/);
  assert.match(server, /groupId: body\.groupId \|\| null/);
  assert.match(queue, /getPrinterGroupFn/);
  assert.match(queue, /groupId:requestedGroup\?\.id \|\| null/);
  assert.match(queue, /code:restrictedGroup \? 'printer_group' : 'printer_group_missing'/);
  assert.match(queue, /Not a member of printer group/);
  assert.match(app, /Printer group: \$\{job\.groupName \|\| job\.groupId\}/);
});

test('printer group state participates in backup and restore', () => {
  assert.match(backupService, /state\/printer-groups\.json/);
  assert.match(restoreService, /'printer-groups\.json'/);
  assert.match(restoreService, /state\/printer-groups\.json/);
  assert.match(restoreService, /\{ version:1, groups:\[\] \}/);
});
