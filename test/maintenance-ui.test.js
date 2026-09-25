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
  assert.match(app, /maintenanceIconMarkup\(printer\)/);
  assert.match(app, /maintenanceIconMarkup\(printer, 'maintenance-status-icon-detail'\)/);
  assert.match(app, /data-maintenance-tracking-summary/);
  assert.match(styles, /\.maintenance-alert-button/);
  assert.match(styles, /\.maintenance-status-icon\[data-state="due_soon"\]/);
  assert.match(styles, /\.maintenance-status-icon\[data-state="due"\]/);
  assert.match(server, /maintenanceService\?\.getPrinterStatus\?\.\(printer\.id\)/);
});

test('maintenance persistent state participates in backup and restore', () => {
  assert.match(backupService, /state\/maintenance\.json/);
  assert.match(restoreService, /'maintenance\.json'/);
  assert.match(restoreService, /state\/maintenance\.json/);
});
