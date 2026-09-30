import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const reportingUi = fs.readFileSync(new URL('../public/reporting.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const reportingService = fs.readFileSync(new URL('../src/reporting-service.js', import.meta.url), 'utf8');
const backupService = fs.readFileSync(new URL('../src/backup-recovery/backup-service.js', import.meta.url), 'utf8');
const restoreService = fs.readFileSync(new URL('../src/backup-recovery/restore-service.js', import.meta.url), 'utf8');

test('reporting UI is available from the overflow menu with graphical farm analytics', () => {
  assert.match(index, /id="reportsBtn"[^>]*>Reports &amp; analytics<\/button>/);
  assert.match(index, /id="reportingDialog"/);
  assert.match(index, /id="reportingRange"/);
  assert.match(index, /id="reportingGroup"/);
  assert.match(index, /id="reportingPrinter"/);
  assert.match(index, /id="reportingTrend"/);
  assert.match(index, /id="reportingPrinters"/);
  assert.match(index, /id="reportingFiles"/);
  assert.match(index, /id="reportingMaterials"/);
  assert.match(index, /src="\/reporting\.js"/);
  assert.match(reportingUi, /reportsBtn\?\.addEventListener/);
  assert.match(reportingUi, /function lineChartSvg/);
  assert.match(reportingUi, /function renderProblemPrinters/);
  assert.match(reportingUi, /\/api\/reports\?/);
  assert.match(styles, /\.reporting-line-chart/);
  assert.match(styles, /\.reporting-printer-row\.attention/);
  new vm.Script(reportingUi);
});

test('reporting backend retains history independently of recent queue history', () => {
  assert.match(server, /new ReportingService/);
  assert.match(server, /recordTerminalJobsFn:\(jobs\) => reportingService\.recordTerminalJobs\(jobs\)/);
  assert.match(server, /url\.pathname === '\/api\/reports'/);
  assert.match(reportingService, /class ReportingService/);
  assert.match(reportingService, /recordTerminalJobs/);
  assert.match(reportingService, /attentionReasons/);
  assert.match(reportingService, /failureRate/);
  assert.match(reportingService, /spendByCurrency/);
  assert.doesNotMatch(reportingService, /MAX_HISTORY/);
});

test('filament cost catalogue and Print Library mappings are exposed in the UI', () => {
  assert.match(index, /id="filamentForm"/);
  assert.match(index, /id="filamentCost"/);
  assert.match(index, /<select id="filamentCurrency" required>/);
  assert.match(index, /<option value="GBP" selected>GBP — British Pound \(£\)<\/option>/);
  assert.match(index, /<option value="USD">USD — US Dollar \(\$\)<\/option>/);
  assert.match(index, /<option value="EUR">EUR — Euro \(€\)<\/option>/);
  assert.match(index, /<option value="JPY">JPY — Japanese Yen \(¥\)<\/option>/);
  assert.match(index, /<option value="INR">INR — Indian Rupee \(₹\)<\/option>/);
  assert.match(index, /<option value="BRL">BRL — Brazilian Real \(R\$\)<\/option>/);
  assert.doesNotMatch(index, /<input id="filamentCurrency"/);
  assert.match(reportingUi, /'GBP'.*'USD'.*'EUR'.*'JPY'.*'CNY'.*'CAD'.*'AUD'.*'INR'.*'BRL'/);
  assert.match(index, /id="libraryFilamentAssignments"/);
  assert.match(reportingUi, /\/api\/filaments/);
  assert.match(reportingUi, /Historical print costs already captured will not change/);
  assert.match(app, /loadLibraryFilamentCatalogue/);
  assert.match(app, /renderLibraryFilamentAssignments/);
  assert.match(app, /function libraryFilamentLabel/);
  assert.match(app, /item\.material \|\| 'Filament'/);
  assert.match(app, /item\.brand \|\| null/);
  assert.match(app, /item\.product \|\| null/);
  assert.match(app, /collectLibraryFilamentAssignments/);
  assert.match(app, /filamentAssignments:collectLibraryFilamentAssignments\(\)/);
  assert.match(app, /async function updateLibraryMetadata\(fileId, \{ description = '', printerTarget = null, filamentAssignments = undefined \}/);
  assert.match(app, /\.\.\.\(filamentAssignments !== undefined \? \{ filamentAssignments \} : \{\}\)/);
  assert.match(styles, /\.library-filament-assignment/);
});

test('reporting history and filament catalogue participate in backup and restore', () => {
  assert.match(backupService, /state\/filaments\.json/);
  assert.match(backupService, /state\/reporting-history\.json/);
  assert.match(restoreService, /'filaments\.json'/);
  assert.match(restoreService, /'reporting-history\.json'/);
  assert.match(restoreService, /state\/filaments\.json/);
  assert.match(restoreService, /state\/reporting-history\.json/);
});
