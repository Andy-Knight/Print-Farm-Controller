import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const maintenanceUi = fs.readFileSync(new URL('../public/maintenance.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const backupService = fs.readFileSync(new URL('../src/backup-recovery/backup-service.js', import.meta.url), 'utf8');
const restoreService = fs.readFileSync(new URL('../src/backup-recovery/restore-service.js', import.meta.url), 'utf8');

test('maintenance tracking is available from the controller overflow menu', () => {
  assert.match(index, /id="maintenanceBtn"[^>]*>Maintenance<\/button>/);
  assert.match(index, /id="maintenanceDialog"/);
  assert.match(index, /id="maintenanceTaskForm"/);
  assert.match(index, /value="days">Calendar days<\/option>/);
  assert.match(index, /value="print_hours">Observed print hours<\/option>/);
  assert.match(index, /value="print_count">Observed print cycles<\/option>/);
  assert.match(index, /src="\/maintenance\.js"/);
  assert.match(styles, /\.maintenance-dialog/);
  assert.match(styles, /\.maintenance-task\[data-state="due"\]/);
});

test('maintenance window has separate add, model-rule and individual-printer views', () => {
  assert.match(index, /class="maintenance-view-selector"/);
  assert.match(index, /data-maintenance-view="add"[^>]*>Add maintenance tasks<\/button>/);
  assert.match(index, /data-maintenance-view="model"[^>]*>Model-wide maintenance rules<\/button>/);
  assert.match(index, /data-maintenance-view="printers"[^>]*>Individual printers<\/button>/);
  assert.match(index, /id="maintenanceTaskForm"[^>]*data-maintenance-view-panel="add"/);
  assert.match(maintenanceUi, /let activeMaintenanceView = 'printers'/);
  assert.match(maintenanceUi, /function setMaintenanceView\(view\)/);
  assert.match(maintenanceUi, /activeMaintenanceView === 'model'/);
  assert.match(maintenanceUi, /activeMaintenanceView === 'printers'/);
  assert.match(maintenanceUi, /form\?\.classList\.toggle\('hidden', activeMaintenanceView !== 'add'\)/);
  assert.match(maintenanceUi, /viewButton\.addEventListener\('click'/);
  assert.match(maintenanceUi, /setMaintenanceView\('add'\)/);
  assert.match(maintenanceUi, /setMaintenanceView\('printers'\)/);
  assert.match(styles, /\.maintenance-view-selector/);
  assert.match(styles, /\.maintenance-view-button\.active/);
});

test('maintenance UI uses the persistent maintenance API', () => {
  assert.match(maintenanceUi, /api\('\/api\/maintenance'\)/);
  assert.match(maintenanceUi, /\/maintenance\/tasks/);
  assert.match(maintenanceUi, /\/complete/);
  assert.match(maintenanceUi, /data-maintenance-edit/);
  assert.match(maintenanceUi, /data-maintenance-delete/);
  assert.match(maintenanceUi, /controller[ -]observed/i);
  assert.match(server, /url\.pathname === '\/api\/maintenance'/);
  assert.match(server, /maintenanceService\.addTask/);
  assert.match(server, /maintenanceService\.updateTask/);
  assert.match(server, /maintenanceService\.deleteTask/);
  assert.match(server, /maintenanceService\.completeTask/);
});

test('dashboard surfaces live maintenance alerts and filters affected printers', () => {
  assert.match(index, /id="maintenanceAlertBtn"[^>]*maintenance-alert-button hidden/);
  assert.match(index, /id="maintenanceAlertCount"/);
  assert.match(app, /function printerHasMaintenanceAlert\(printer\)/);
  assert.match(app, /filter === 'maintenance'\) return printerHasMaintenanceAlert\(printer\)/);
  assert.match(app, /function renderMaintenanceAlert\(\)/);
  assert.match(app, /maintenanceAlertBtn\.classList\.toggle\('hidden', alerts\.length === 0\)/);
  assert.match(app, /maintenanceAlertBtn\?\.addEventListener\('click'/);
  assert.match(app, /setDashboardFilter\(dashboardFilter === 'maintenance' \? 'all' : 'maintenance'\)/);
  assert.match(app, /maintenanceIconMarkup\(printer, '', true\)/);
  assert.match(app, /maintenanceIconMarkup\(printer, 'maintenance-status-icon-detail'\)/);
  assert.match(app, /data-maintenance-tracking-summary/);
  assert.match(styles, /\.maintenance-alert-button/);
  assert.match(styles, /\.maintenance-status-icon\[data-state="due_soon"\]/);
  assert.match(styles, /\.maintenance-status-icon\[data-state="due"\]/);
  assert.match(server, /maintenanceService\?\.getPrinterStatus\?\.\(printer\.id\)/);
});

test('dashboard maintenance icon is not overwritten by printer state updates', () => {
  assert.match(app, /<div class="badge" data-printer-state><\/div>/);
  assert.match(app, /const badge = card\.querySelector\('\[data-printer-state\]'\)/);
  assert.doesNotMatch(app, /const badge = card\.querySelector\('\[data-state\]'\)/);
  assert.match(app, /data-maintenance-status-icon data-maintenance-open-printer="\$\{escapeHtml\(printer\.id\)\}" data-state="\$\{escapeHtml\(state\)\}"/);
});

test('dashboard spanner opens maintenance focused on the selected printer', () => {
  assert.match(app, /data-maintenance-open-printer="\$\{escapeHtml\(printer\.id\)\}"/);
  assert.match(app, /new CustomEvent\('pfc:open-maintenance'/);
  assert.match(app, /printerId:maintenanceShortcut\.dataset\.maintenanceOpenPrinter/);
  assert.match(maintenanceUi, /data-maintenance-printer-card="\$\{escapeHtml\(printer\.printerId\)\}"/);
  assert.match(maintenanceUi, /async function openForPrinter\(printerId\)/);
  assert.match(maintenanceUi, /assignmentScopeInput\.value = 'printer'/);
  assert.match(maintenanceUi, /printerSelect\.value = id/);
  assert.match(maintenanceUi, /target\.scrollIntoView\(\{ behavior:'smooth', block:'center' \}\)/);
  assert.match(maintenanceUi, /window\.addEventListener\('pfc:open-maintenance'/);
  assert.match(styles, /\.maintenance-status-icon-button/);
  assert.match(styles, /\.maintenance-printer-card-target/);
});

test('printer detail spanner opens maintenance focused on the selected printer', () => {
  const detailIconMatches = app.match(/maintenanceIconMarkup\(printer, 'maintenance-status-icon-detail', true\)/g) || [];
  assert.equal(detailIconMatches.length, 2);
  assert.match(app, /printerDetail\.addEventListener\('click'/);
  assert.match(app, /const maintenanceShortcut = event\.target\.closest\('\[data-maintenance-open-printer\]'\)/);
  assert.match(app, /const printerId = maintenanceShortcut\.dataset\.maintenanceOpenPrinter/);
  assert.match(app, /if \(printerDialog\.open\) printerDialog\.close\(\)/);
  assert.match(app, /new CustomEvent\('pfc:open-maintenance',[\s\S]*detail:\{ printerId \}/);
});

test('maintenance completion is disabled after servicing until the task reaches Due soon', () => {
  assert.match(maintenanceUi, /task\.completionAllowed === false/);
  assert.match(maintenanceUi, /disabled aria-disabled="true"/);
  assert.match(maintenanceUi, /Complete again when Due soon \(80%\)/);
  assert.match(maintenanceUi, /task\.completionReason/);
});

test('maintenance tasks can be assigned to individual printers or inherited by printer model', () => {
  assert.match(index, /id="maintenanceAssignmentScope"/);
  assert.match(index, /value="printer">Individual printer<\/option>/);
  assert.match(index, /value="model">Printer model<\/option>/);
  assert.match(index, /id="maintenanceModel"/);
  assert.match(maintenanceUi, /api\('\/api\/adapters'\)/);
  assert.match(maintenanceUi, /function modelTaskSection\(\)/);
  assert.match(maintenanceUi, /Model-wide maintenance rules/);
  assert.match(maintenanceUi, /Applies to matching printers automatically/);
  assert.match(maintenanceUi, /\/api\/maintenance\/model-tasks/);
  assert.match(maintenanceUi, /data-task-scope="model"/);
  assert.match(maintenanceUi, /Assigned to this printer:/);
  assert.match(server, /maintenanceService\.addModelTask/);
  assert.match(server, /maintenanceService\.updateModelTask/);
  assert.match(server, /maintenanceService\.deleteModelTask/);
  assert.match(styles, /\.maintenance-model-rules/);
  assert.match(styles, /\.maintenance-scope-pill/);
});

test('model-wide maintenance rules can be completed across eligible matching printers', () => {
  assert.match(maintenanceUi, /data-maintenance-complete-model/);
  assert.match(maintenanceUi, /Complete for model/);
  assert.match(maintenanceUi, /completionSummary/);
  assert.match(maintenanceUi, /matching · .*ready/);
  assert.match(maintenanceUi, /not yet Due soon and will be skipped/);
  assert.match(maintenanceUi, /\/api\/maintenance\/model-tasks\/\$\{encodeURIComponent\(taskId\)\}\/complete/);
  assert.match(server, /maintenanceService\.completeModelTask/);
  assert.match(server, /Model-wide maintenance task completed/);
});

test('maintenance persistent state participates in backup and restore', () => {
  assert.match(backupService, /state\/maintenance\.json/);
  assert.match(restoreService, /'maintenance\.json'/);
  assert.match(restoreService, /state\/maintenance\.json/);
});
