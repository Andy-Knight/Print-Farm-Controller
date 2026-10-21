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

test('reporting UI is available from the persistent controller navigation with graphical farm analytics', () => {
  assert.match(index, /id="reportsBtn"[^>]*class="sidebar-item"/);
  assert.match(index, /<span>Reports &amp; finance<\/span>/);
  assert.match(index, /<h2 class="ui-page-title">Reports &amp; finance<\/h2>/);
  assert.match(index, /FARM REPORTING/);
  assert.match(index, /aria-label="Reports and finance view"/);
  assert.match(app, /title:'Reports & finance', topbarTitle:'Farm management', subtitle:'Review farm performance, material costs and selling prices'/);
  assert.doesNotMatch(index, /Reports &amp; analytics/);

  assert.match(index, /id="reportingDialog"/);
  assert.match(index, /id="reportingTabAnalytics"/);
  assert.match(index, /id="reportingTabFilament"/);
  assert.match(index, /id="reportingTabPricing"/);
  assert.match(index, /id="reportingPanelPricing"/);
  assert.match(index, /data-reporting-panel="pricing"/);
  assert.match(index, /data-reporting-panel="analytics"/);
  assert.match(index, /data-reporting-panel="filament"/);
  assert.match(index, /class="reporting-tabs maintenance-view-selector"/);
  assert.match(index, /id="reportingRange"/);
  assert.match(index, /id="reportingGroup"/);
  assert.match(index, /id="reportingPrinter"/);
  assert.match(index, /id="reportingTrend"/);
  assert.match(index, /id="reportingPrinters"/);
  assert.match(index, /id="reportingFiles"/);
  assert.match(index, /id="reportingMaterials"/);
  assert.match(index, /src="\/reporting\.js"/);
  assert.match(reportingUi, /reportsBtn\?\.addEventListener/);
  assert.match(reportingUi, /function activateReportingTab/);
  assert.match(reportingUi, /activateReportingTab\('analytics'\)/);
  assert.match(reportingUi, /\['analytics','filament','pricing'\]/);
  assert.match(reportingUi, /loadReportingPricingSettings\(\)/);
  assert.match(reportingUi, /\['ArrowLeft','ArrowRight','Home','End'\]/);
  assert.match(reportingUi, /function lineChartSvg/);
  assert.match(reportingUi, /function renderProblemPrinters/);
  assert.match(reportingUi, /\/api\/reports\?/);
  assert.match(styles, /\.reporting-line-chart/);
  assert.match(styles, /\.reporting-printer-row\.attention/);
  assert.match(styles, /\.reporting-tabs\.maintenance-view-selector/);
  assert.match(styles, /\.reporting-tab-panel\[hidden\]/);
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  const preact = fs.readFileSync(new URL('../ui/reporting.jsx', import.meta.url), 'utf8');
  assert.match(preact, /key:'pricing'/);
  assert.match(preact, /panel:'reportingPanelPricing'/);
  assert.match(preact, /\['analytics','filament','pricing'\]/);
  assert.doesNotMatch(index, /id="libraryPricingSettingsDialog"/);
  new vm.Script(reportingUi);
});

test('reporting backend retains history independently of recent queue history', () => {
  assert.match(server, /new ReportingService/);
  assert.match(server, /recordTerminalJobsFn:recordQueueHistoryAndAlerts/);
  assert.match(server, /const reportingResult = await reportingService\.recordTerminalJobs\(jobs\)/);
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
  assert.match(index, /<select id="reportingCurrency" name="currency" required/);
  assert.match(index, /<option value="GBP" selected>GBP — British Pound \(£\)<\/option>/);
  assert.match(index, /<option value="USD">USD — US Dollar \(\$\)<\/option>/);
  assert.match(index, /<option value="EUR">EUR — Euro \(€\)<\/option>/);
  assert.match(index, /<option value="JPY">JPY — Japanese Yen \(¥\)<\/option>/);
  assert.match(index, /<option value="INR">INR — Indian Rupee \(₹\)<\/option>/);
  assert.match(index, /<option value="BRL">BRL — Brazilian Real \(R\$\)<\/option>/);
  assert.doesNotMatch(index, /<input id="filamentCurrency"/);
  const pricing = fs.readFileSync(new URL('../src/library-pricing.js', import.meta.url), 'utf8');
  assert.match(pricing, /'GBP'.*'USD'.*'EUR'.*'JPY'.*'CNY'.*'CAD'.*'AUD'.*'INR'.*'BRL'/);
  assert.doesNotMatch(index,/id="filamentCurrency"/);
  assert.match(index,/id="reportingCurrency"/);
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
  assert.match(app, /async function updateLibraryMetadata\(fileId, \{[^}]*filamentAssignments = undefined[^}]*sundryCosts = undefined[^}]*\}/);
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

test('attention UI only shows genuine flagged printers and accurately describes insufficient data', () => {
  const section = (start, end) => reportingUi.slice(reportingUi.indexOf(start), reportingUi.indexOf(end));
  const helpers = [
    section('function formatNumber(', 'function formatCurrencyTotals('),
    section('function escapeHtml(', 'async function requestJson('),
    section('function formatReportingDate(', 'function reportingKpiViewModel('),
    section('function reportingFileNameHtml(', 'function renderReport(')
  ];
  const ui = vm.runInNewContext(helpers.join('\n') +
    '\n({ reportingPrintersViewModel, renderProblemPrinters, formatRateTrend, formatPercent, formatPrinterRunTime })');
  const healthy = Array.from({ length:11 }, (_, n) => ({
    printerId:'healthy-'+n, printerName:'Healthy '+n, attempts:9, completed:9,
    failed:0, failureRate:0, failureRateTrend:null, runHours:1.5, attentionReasons:[]
  }));
  const phantom = {
    printerId:null, printerName:'Next available compatible printer', attempts:5,
    completed:0, failed:0, failureRate:0, failureRateTrend:null, runHours:0,
    attentionReasons:['placeholder must not appear']
  };
  const problem = {
    printerId:'p1', printerName:'Problem printer', attempts:5, completed:3, failed:2,
    failureRate:0.4, failureRateTrend:null, runHours:2, runMinutes:120,
    runTimeRecordedCount:1, attentionReasons:['2 failed prints in this period']
  };
  const items = [...healthy, phantom, problem];
  const viewModel = ui.reportingPrintersViewModel(items);
  assert.equal(viewModel.length, 1);
  assert.equal(viewModel[0].name, 'Problem printer');
  const legacy = ui.renderProblemPrinters(items);
  assert.match(legacy, /Problem printer/);
  assert.doesNotMatch(legacy, /Healthy 0|Next available compatible printer/);
  assert.match(ui.renderProblemPrinters(healthy), /No printers currently need attention/);
  assert.match(ui.renderProblemPrinters([]), /No printer activity in this period/);
  assert.equal(ui.formatRateTrend(null), 'Insufficient data');
  assert.equal(ui.formatRateTrend(0), 'No recent change');
  assert.equal(ui.formatPercent(null), '—');
  assert.equal(ui.formatPrinterRunTime({ runMinutes:2, runHours:0.03, runTimeRecordedCount:1 }), '2.0 min run time');
  assert.equal(ui.formatPrinterRunTime({ runHours:0, runTimeRecordedCount:0 }), 'run time unavailable');
  const preact = fs.readFileSync(new URL('../ui/reporting.jsx', import.meta.url), 'utf8');
  assert.match(preact, /No printers currently need attention/);
  assert.match(preact, /hasActivity={state.printerActivity}/);
});

test('analytics mock-up contains the new workbench tables in both renderers', () => {
  for (const id of ['reportingFiles','reportingMaterials','reportingPrinters','reportingFileFailures','reportingTrend']) {
    assert.match(index, new RegExp('id="' + id + '"'));
  }
  assert.match(index, /data-reporting-files-scope="top10"/);
  assert.match(index, /data-reporting-files-scope="all"/);
  assert.match(index, /data-reporting-material-mode="type"/);
  assert.match(index, /data-reporting-material-mode="filament"/);
  assert.match(styles, /\.reporting-analytics-table/);
  assert.match(styles, /\.reporting-table-scroll/);
  assert.match(styles, /\.reporting-analytics-grid/);
  assert.match(reportingUi, /function renderReportFiles/);
  assert.match(reportingUi, /function renderReportMaterials/);
  assert.match(reportingUi, /function renderFileFailures/);
  assert.match(reportingUi, /pfc:reporting-open-library-file/);
  assert.match(app, /pendingReportingLibraryFileId/);
  const preact = fs.readFileSync(new URL('../ui/reporting.jsx', import.meta.url), 'utf8');
  assert.match(preact, /function ReportFiles/);
  assert.match(preact, /function ReportMaterials/);
  assert.match(preact, /function FileFailures/);
  assert.match(preact, /data-reporting-open-file/);
});

test('analytics view models rank real print completions and aggregate materials', () => {
  const helpers = [
    reportingUi.slice(reportingUi.indexOf('function escapeHtml('), reportingUi.indexOf('async function requestJson(')),
    reportingUi.slice(reportingUi.indexOf('function formatNumber('), reportingUi.indexOf('function reportRangeDates(')),
    reportingUi.slice(reportingUi.indexOf('function formatReportingDate('), reportingUi.indexOf('function reportingKpiViewModel(')),
    reportingUi.slice(reportingUi.indexOf('function reportingFileNameHtml('), reportingUi.indexOf('function renderReport('))
  ];
  const ui = vm.runInNewContext([
    "let reportingFilesScope = 'top10';",
    "let reportingFilesSort = { key:'completed', direction:'desc' };",
    "let reportingMaterialMode = 'type';",
    helpers.join('\n'),
    '({ reportingFileRows, reportingMaterialRows, renderReportFiles, renderReportMaterials, renderFileFailures, setScope:(scope)=>reportingFilesScope=scope, setMode:(mode)=>reportingMaterialMode=mode, setSort:(key,direction)=>reportingFilesSort={key,direction} })'
  ].join('\n'));
  const files = Array.from({ length:12 }, (_, index) => ({
    fileName:'File ' + index + '.3mf',
    libraryFileId:'id-' + index,
    previewUrl:'/api/library/id-' + index + '/preview',
    attempts:20-index, completed:20-index, failed:0
  }));
  files[11].failed=2;
  files[11].attempts+=2;
  const top = ui.reportingFileRows(files);
  assert.equal(top.length, 10);
  assert.equal(top[0].rank, 1);
  assert.equal(top[0].completed, 20);
  assert.equal(top[0].popularity, 100);
  const html = ui.renderReportFiles(top);
  assert.match(html, /reporting-analytics-table/);
  assert.match(html, /data-reporting-open-file="id-0"/);
  assert.match(html, /api\/library\/id-0\/preview/);
  ui.setSort('failed','desc');
  assert.equal(ui.reportingFileRows(files)[0].fileName, 'File 11.3mf');
  ui.setScope('all');
  assert.equal(ui.reportingFileRows(files).length, 12);
  ui.setSort('fileName','asc');
  assert.equal(ui.reportingFileRows(files)[0].fileName, 'File 0.3mf');
  const failures = ui.reportingFileRows(files, { failures:true });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failed, 2);
  assert.equal(failures[0].failureRate, '18.2%');
  assert.match(ui.renderFileFailures(failures), /File 11/);
  const materials = [
    { filamentId:'a', label:'ASA Brand 1', material:'ASA', grams:2000, spendByCurrency:{ GBP:12 } },
    { filamentId:'b', label:'ASA Brand 2', material:'ASA', grams:1000, spendByCurrency:{ GBP:6 } },
    { filamentId:'c', label:'PLA Brand', material:'PLA', grams:1000, spendByCurrency:{ GBP:5 } }
  ];
  const byType = ui.reportingMaterialRows(materials);
  assert.equal(byType.rows.length, 2);
  assert.equal(byType.rows[0].label, 'ASA');
  assert.equal(byType.rows[0].kg, '3.00');
  assert.equal(byType.rows[0].percentage, '75.0%');
  assert.equal(byType.totalKg, '4.00');
  assert.match(ui.renderReportMaterials(byType), /Total/);
  ui.setMode('filament');
  const byFilament = ui.reportingMaterialRows(materials);
  assert.equal(byFilament.rows.length, 3);
  assert.equal(byFilament.rows[0].label, 'ASA Brand 1');
  assert.equal(ui.reportingFileRows([{fileName:'cancelled.gcode',completed:0,failed:0,attempts:2}]).length, 0);
});

test('analytics chart is first after KPIs, print file table spans full width and KPI icon colours reflect outcomes', () => {
  const panel = index.slice(index.indexOf('id="reportingPanelAnalytics"'), index.indexOf('id="reportingPanelFilament"'));
  const ids = ['reportingKpis','reportingTrend','reportingFiles','reportingMaterials','reportingPrinters','reportingFileFailures'];
  const positions = ids.map((id) => panel.indexOf('id="' + id + '"'));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(styles, /\.reporting-analytics-files\s*\{\s*grid-column:1\s*\/\s*-1/);
  assert.match(styles, /\.reporting-table-scroll\s*\{[^}]*width:100%;[^}]*max-width:100%;/);
  assert.doesNotMatch(styles, /\.reporting-table-scroll\s*\{[^}]*max-width:365px/);
  assert.match(styles, /\.reporting-analytics-files \.reporting-analytics-table\s*\{[^}]*table-layout:fixed/);
  assert.match(styles, /\.reporting-kpi \.reporting-kpi-icon-positive/);
  assert.match(styles, /\.reporting-kpi \.reporting-kpi-icon-negative/);
  const preact = fs.readFileSync(new URL('../ui/reporting.jsx', import.meta.url), 'utf8');
  assert.match(preact, /reporting-kpi-icon-\$\{item.tone/);
  assert.match(reportingUi, /reporting-kpi-icon-\$\{escapeHtml\(item.tone\)\}/);
  const code = reportingUi.slice(reportingUi.indexOf('function reportingKpiViewModel('), reportingUi.indexOf('function reportingFilamentsViewModel('));
  const renderModel = vm.runInNewContext(code + '\nreportingKpiViewModel', {
    formatNumber:(value)=>String(value ?? 0),
    formatPercent:(value)=>String(value ?? 0) + '%'
  });
  const unsuccessful = renderModel({ totals:{ attempts:11, completed:10, failed:1, completionRate:0.9, failureRate:0.1, runHours:12 } });
  assert.deepEqual(Array.from(unsuccessful, (item)=>item.tone), ['info','positive','negative','info']);
  const noFailures = renderModel({ totals:{ attempts:10, completed:10, failed:0, completionRate:1, failureRate:0, runHours:12 } });
  assert.equal(noFailures[2].tone, 'positive');
  assert.equal(noFailures[2].icon, '✓');
  const idle = renderModel({ totals:{} });
  assert.equal(idle[1].tone, 'info');
});
