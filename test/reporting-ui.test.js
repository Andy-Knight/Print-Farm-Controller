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
  assert.match(index, /src="\/auth-gate\.js"/);
  assert.match(fs.readFileSync(new URL('../public/auth-gate.js', import.meta.url),'utf8'), /import\('\/reporting\.js'\)/);
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
  assert.equal(top[0].materialText,'—');
  assert.equal(top[0].materialCostText,'—');
  assert.equal(top[0].printTime,'—');
  const html = ui.renderReportFiles(top);
  assert.match(html, /reporting-analytics-table/);
  assert.match(html, /data-reporting-open-file="id-0"/);
  assert.match(html, /api\/library\/id-0\/preview/);
  assert.match(html, /data-reporting-file-sort="materialGrams"/);
  assert.match(html, /data-reporting-file-sort="materialCost"/);
  assert.doesNotMatch(html, /data-reporting-file-sort="runSeconds"/);
  assert.doesNotMatch(html, /data-reporting-file-sort="successRate"/);
  assert.equal((html.match(/<th scope="col"/g) || []).length,6);
  assert.match(html, /Material ↕/);
  assert.doesNotMatch(html, /Popularity/);
  assert.doesNotMatch(html, /of leading file/);
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
  assert.match(ui.renderReportMaterials(byType), /Total filament used/);
  assert.match(ui.renderReportMaterials(byType), /reporting-usage-chart/);
  assert.equal(byType.rows[0].barPercent,100);
  assert.equal(byType.rows[1].barPercent,33.33);
  assert.equal(byType.rows[0].barColour,'var(--ds-brand-strong)');
  ui.setMode('filament');
  const byFilament = ui.reportingMaterialRows(materials);
  assert.equal(byFilament.rows.length, 3);
  assert.equal(byFilament.rows[0].label, 'ASA Brand 1');
  const snapshotMaterials = [
    { filamentId:null, label:'PLA', material:'PLA', grams:250, spendByCurrency:{ GBP:2.5 } },
    { filamentId:'catalogue-pla', label:'PLA', material:'PLA', grams:200, spendByCurrency:{ GBP:2 } },
    { filamentId:'named-pla', label:'eSUN · PLA+ · PLA', material:'PLA', grams:100, spendByCurrency:{ GBP:1 } }
  ];
  const filamentRows = ui.reportingMaterialRows(snapshotMaterials).rows;
  assert.equal(filamentRows.length, 3, 'unidentified and identified records must remain separate');
  assert.equal(filamentRows[0].label, 'PLA (Unidentified filament)');
  assert.match(filamentRows[0].note, /did not identify a specific filament catalogue entry/);
  assert.equal(filamentRows[1].label, 'PLA (Brand\/product not recorded)');
  assert.match(filamentRows[1].note, /catalogue reference/);
  assert.equal(filamentRows[2].label, 'eSUN · PLA+ · PLA');
  assert.equal(filamentRows[2].note, '');
  const materialHtml = ui.renderReportMaterials(ui.reportingMaterialRows(snapshotMaterials));
  assert.match(materialHtml, /PLA \(Unidentified filament\)/);
  assert.match(materialHtml, /title="The print recorded this material type/);
  assert.match(materialHtml, /aria-label="Filament used pie chart in kilograms"/);
  assert.match(materialHtml, /0.25 kg/);
  assert.doesNotMatch(materialHtml, /<table/);
  const coloured=ui.reportingMaterialRows(materials,[
    {id:'a',colour:'#ff0000'},{id:'b',colour:'Green'}, {id:'c',colour:'url(javascript:evil)'}
  ]);
  assert.equal(coloured.rows[0].barColour,'#ff0000');
  assert.equal(coloured.rows[1].barColour,'#4dbd8b');
  assert.equal(coloured.rows[2].barColour,'var(--ds-brand-strong)');
  const coloursHtml=ui.renderReportMaterials(coloured);
  assert.match(coloursHtml,/fill:#ff0000/);
  assert.match(coloursHtml,/background-color:#ff0000/);
  assert.doesNotMatch(coloursHtml,/javascript:evil/,'catalogue colour cannot inject CSS');
  assert.match(materialHtml, /PLA \(Brand\/product not recorded\)/);
  assert.match(materialHtml, /eSUN · PLA\+ · PLA/);
  ui.setMode('type');
  const byMaterial = ui.reportingMaterialRows(snapshotMaterials);
  assert.equal(byMaterial.rows.length, 1);
  assert.equal(byMaterial.rows[0].label, 'PLA');
  assert.equal(byMaterial.rows[0].note, '');
  assert.equal(byMaterial.totalKg, '0.55');
  const preact = fs.readFileSync(new URL('../ui/reporting.jsx', import.meta.url), 'utf8');
  assert.match(preact, /title=\{row.note \|\| row.label\}/);
  assert.equal(ui.reportingFileRows([{fileName:'cancelled.gcode',completed:0,failed:0,attempts:2}]).length, 0);
});

test('analytics chart is first after KPIs, popular files and filament kg graph share a desktop row', () => {
  const panel = index.slice(index.indexOf('id="reportingPanelAnalytics"'), index.indexOf('id="reportingPanelFilament"'));
  const ids = ['reportingKpis','reportingTrend','reportingFiles','reportingMaterials','reportingPrinters','reportingFileFailures'];
  const positions = ids.map((id) => panel.indexOf('id="' + id + '"'));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(styles, /\.reporting-analytics-grid\s*\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.reporting-analytics-files,\.reporting-analytics-materials\s*\{\s*grid-column:auto/);
  assert.match(styles, /\.reporting-analytics-files \.reporting-table-scroll\s*\{\s*overflow:auto/);
  assert.match(styles, /\.reporting-usage-chart\s*\{[^}]*var\(--pfc-table-border\)/);
  assert.match(styles, /\.reporting-usage-track>span\s*\{[^}]*var\(--reporting-usage-colour/);
  assert.match(styles, /#reportingPanelAnalytics\s*\{\s*padding-bottom:32px/);
  assert.match(styles, /@media \(max-width:760px\)\s*\{\s*#reportingPanelAnalytics\s*\{\s*padding-bottom:24px/);
  assert.match(styles, /\.reporting-table-scroll\s*\{[^}]*width:100%;[^}]*max-width:100%;/);
  assert.doesNotMatch(styles, /\.reporting-table-scroll\s*\{[^}]*max-width:365px/);
  assert.match(styles, /\.reporting-analytics-files \.reporting-analytics-table\s*\{[^}]*table-layout:fixed/);
  // Popular-file analytics must use the same controller table theme tokens as
  // the Dashboard/Alerts/Printer Groups, not a separate report-only skin.
  const sharedStyle = styles.slice(styles.indexOf('/* Controller table design system.'),
    styles.indexOf('/* Preact-owned printer name editor:'));
  assert.match(sharedStyle, /#reportingFiles \.reporting-table-scroll/);
  assert.match(sharedStyle, /#reportingFiles \.reporting-analytics-table thead th/);
  assert.match(sharedStyle, /#reportingFiles \.reporting-analytics-table tbody td/);
  assert.match(sharedStyle, /#reportingFiles \.reporting-analytics-table tbody tr:hover > \*/);
  assert.match(sharedStyle, /var\(--pfc-table-divider\)/);
  assert.match(sharedStyle, /var\(--pfc-table-hover\)/);
  assert.match(sharedStyle, /var\(--pfc-table-header-background\)/);
  assert.match(sharedStyle, /var\(--pfc-table-surface\)/);
  assert.match(styles, /\.reporting-kpi \.reporting-kpi-gauge/);
  assert.match(styles, /\.reporting-kpi \.reporting-kpi-meter/);
  assert.match(styles, /\.reporting-kpi \.reporting-kpi-accent/);
  assert.match(styles, /\.reporting-kpis \.reporting-kpi-negative/);
  const preact = fs.readFileSync(new URL('../ui/reporting.jsx', import.meta.url), 'utf8');
  assert.match(preact, /function ReportingKpiSymbol/);
  assert.match(preact, /reporting-kpi-gauge/);
  assert.match(preact, /reporting-kpi-meter/);
  assert.match(reportingUi, /function reportingKpiSvg/);
  assert.match(reportingUi, /reporting-kpi-gauge/);
  const code = reportingUi.slice(reportingUi.indexOf('function reportingPreviousPeriodChange('), reportingUi.indexOf('function reportingFilamentsViewModel('));
  const renderModel = vm.runInNewContext(code + '\nreportingKpiViewModel', {
    formatNumber:(value)=>String(value ?? 0),
    formatPercent:(value)=>String(value ?? 0) + '%'
  });
  const unsuccessful = renderModel({ totals:{ attempts:11, completed:10, failed:1, completionRate:0.9, failureRate:0.1, runHours:12 } });
  assert.deepEqual(Array.from(unsuccessful, (item)=>item.tone), ['info','positive','negative','info','info']);
  const noFailures = renderModel({ totals:{ attempts:10, completed:10, failed:0, completionRate:1, failureRate:0, runHours:12 } });
  assert.equal(noFailures[2].tone, 'negative');
  assert.equal(noFailures[2].icon, '×');
  assert.equal(noFailures[2].iconName, 'cross');
  assert.equal(unsuccessful[2].iconName, 'cross');
  assert.equal(renderModel({totals:{failed:0}})[2].iconName,'cross');
  const idle = renderModel({ totals:{} });
  assert.equal(idle[1].tone, 'info');
  assert.equal(idle[1].progressPercent, null);
  assert.equal(idle[2].progressPercent, null);
  assert.equal(unsuccessful[0].progressPercent, null, 'job count has no percentage target');
  assert.equal(unsuccessful[3].progressPercent, null, 'runtime has no percentage target');
  assert.equal(unsuccessful[4].progressPercent, null, 'filament kg has no percentage target');
  assert.equal(unsuccessful[4].value,'—','unknown historical material use must not masquerade as zero');
  assert.equal(unsuccessful[1].progressPercent, 90);
  assert.equal(unsuccessful[2].progressPercent, 10);
  assert.equal(unsuccessful[2].progressLabel, 'Failure rate');
  assert.equal(noFailures[2].progressPercent, 0);
  assert.equal(noFailures[2].iconName, 'cross');
});

test('single-day print history draws a visible chart marker and a complete date timeline in Preact and fallback', () => {
  const helpers = [
    reportingUi.slice(reportingUi.indexOf('function chartTimelineRows('), reportingUi.indexOf('function reportingBarRowsViewModel(')),
    reportingUi.slice(reportingUi.indexOf('function lineChartSvg('), reportingUi.indexOf('function renderBarRows(')),
    reportingUi.slice(reportingUi.indexOf('function escapeHtml('), reportingUi.indexOf('async function requestJson('))
  ].join('\n');
  const ui = vm.runInNewContext(helpers + '\n({ lineChartViewModel, lineChartSvg })', { Date, Math, Number, Set, Map, Array });
  const range = { from:'2026-10-14T14:00:00.000Z', to:'2026-10-21T14:00:00.000Z' };
  const report = [{date:'2026-10-20',completed:3,failed:0,cancelled:0}];
  const chart = ui.lineChartViewModel(report, range);
  assert.equal(chart.rows.length, 8, 'sparse history should cover every day in the selected period');
  assert.equal(chart.rows.reduce((count, day) => count + day.completed, 0), 3);
  assert.equal(chart.rows.find((day) => day.date === '2026-10-19').completed, 0);
  assert.equal(chart.rows.find((day) => day.date === '2026-10-20').completed, 3);
  assert.equal(chart.points.length, 1);
  assert.equal(chart.points[0].value, 3);
  assert.ok(chart.completedPath.includes(' L '), 'a single recorded day must still produce a visible line');
  assert.equal(chart.grid.map(({label}) => label).join(','), '0,1,2,3',
    'print count labels must be whole and non-duplicated');
  const html = ui.lineChartSvg(report, range);
  assert.match(html, /class="reporting-point completed"/);
  assert.match(html, /2026-10-20: 3 completed/);
  assert.match(html, /class="reporting-point-value completed">3<\/text>/);
  const singleton = ui.lineChartViewModel(report);
  assert.equal(singleton.rows.length, 1);
  assert.equal(singleton.points[0].value, 3, 'even a single plot point must be visible');
  const noHistory = ui.lineChartViewModel([], range);
  assert.equal(noHistory.rows.length, 0);
  assert.match(ui.lineChartSvg([], range), /No completed reporting history/);
  const preact = fs.readFileSync(new URL('../ui/reporting.jsx', import.meta.url), 'utf8');
  assert.match(preact, /chart\.points \|\| \[\]/);
  assert.match(preact, /reporting-point-value/);
  assert.match(styles, /\.reporting-point\.completed/);
  assert.match(reportingUi, /lineChartViewModel\(report\?\.daily \|\| \[\], report\?\.range\)/);
  assert.match(reportingUi, /lineChartSvg\(report\?\.daily \|\| \[\], report\?\.range\)/);
});

test('Option D reporting KPI rings display measured rates but no fictitious count/runtime progress', () => {
  const code = [
    reportingUi.slice(reportingUi.indexOf('function escapeHtml('), reportingUi.indexOf('async function requestJson(')),
    reportingUi.slice(reportingUi.indexOf('function formatNumber('), reportingUi.indexOf('function reportRangeDates(')),
    reportingUi.slice(reportingUi.indexOf('function reportingKpiSvg('), reportingUi.indexOf('function reportingFilamentsViewModel('))
  ].join('\n');
  const view = vm.runInNewContext(code + '\n({ reportingKpiSvg, reportingKpiViewModel })');
  assert.match(view.reportingKpiSvg('jobs'), /<rect/);
  assert.match(view.reportingKpiSvg('clock'), /<circle/);
  assert.match(view.reportingKpiSvg('scale'), /<rect x="3" y="9" width="18" height="12" rx="2.5"\/>/);
  assert.match(view.reportingKpiSvg('scale'), /M8 17a4 4 0 0 1 8 0M12 17l2-2/);
  const rows = view.reportingKpiViewModel({totals:{
    attempts:20,completed:17,failed:2,cancelled:1,runHours:31.5,materialGrams:3850,
    completionRate:.85,failureRate:.10
  }});
  assert.equal(rows.length,5);
  assert.equal(rows[0].progressPercent,null);
  assert.equal(rows[1].progressPercent,85);
  assert.equal(rows[2].progressPercent,10);
  assert.equal(rows[3].progressPercent,null);
  assert.equal(rows[4].progressPercent,null);
  assert.equal(rows[4].label,'Total filament used');
  assert.equal(rows[4].value,'3.85 kg');
  assert.equal(rows[4].detail,'Recorded for completed prints');
  assert.deepEqual(Array.from(rows,item=>item.iconName),['jobs','check','cross','clock','scale']);
  const preact=fs.readFileSync(new URL('../ui/reporting.jsx',import.meta.url),'utf8');
  assert.match(preact,/aria-valuenow=\{progress\}/);
  assert.match(preact,/progress \* 3\.6/);
  assert.match(preact,/reporting-kpi-gauge-neutral/);
  assert.match(preact,/name === 'scale'/);
  assert.match(preact,/d="M4 4h16M7 4v4h10V4"/);
  assert.match(preact,/d="M8 17a4 4 0 0 1 8 0M12 17l2-2"/);
  assert.doesNotMatch(preact.slice(preact.indexOf('function ReportingKpiSymbol'),preact.indexOf('function ReportingKpis(')),/name === 'spool'/);
  assert.doesNotMatch(reportingUi.slice(reportingUi.indexOf('function reportingKpiSvg('),
    reportingUi.indexOf('function reportingPreviousPeriodChange(')),/spool:/);
  assert.match(styles,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(reportingUi,/aria-valuenow="\$\{progress\}"/);
  assert.match(reportingUi,/progress \* 3\.6/);
  assert.match(styles,/conic-gradient\(from -90deg/);
  assert.match(styles,/\.reporting-kpi-positive/);
  assert.match(styles,/\.reporting-kpi-negative/);
  assert.match(styles,/data-theme="light".*reporting-kpi-positive/);
});

test('five Analytics summary headings share the number column beside the icon', () => {
  const preact=fs.readFileSync(new URL('../ui/reporting.jsx',import.meta.url),'utf8');
  const kpiComponent=preact.slice(preact.indexOf('function ReportingKpis('),preact.indexOf('function ReportingTrend('));
  const fallback=reportingUi.slice(reportingUi.indexOf('function renderReport(report)'),
    reportingUi.indexOf('async function loadReportingContext()'));
  assert.match(kpiComponent,/<div class="reporting-kpi-body">\s*<span class="reporting-kpi-label">\{item\.label\}<\/span>\s*<strong>\{item\.value\}<\/strong>/);
  assert.match(fallback,/<div class="reporting-kpi-body">\s*<span class="reporting-kpi-label">\$\{escapeHtml\(item\.label\)\}<\/span>\s*<strong>\$\{escapeHtml\(item\.value\)\}<\/strong>/);
  assert.doesNotMatch(kpiComponent,/<span class="reporting-kpi-label">\{item\.label\}<\/span>\s*<span class=\{`reporting-kpi-gauge/);
  assert.match(styles,/\.reporting-kpis \.reporting-kpi\s*\{[^}]*display:grid/);
  assert.match(styles,/\.reporting-kpi \.reporting-kpi-body\s*\{[^}]*grid-column:2;grid-row:1/);
  assert.match(styles,/\.reporting-kpi \.reporting-kpi-label\s*\{[^}]*white-space:normal/);
  assert.match(styles,/\.reporting-kpi \.reporting-kpi-gauge\s*\{[^}]*grid-row:1\s*\/\s*3/);
  assert.match(styles,/\.reporting-kpi \.reporting-kpi-change\s*\{[^}]*grid-column:2;grid-row:2/);
  assert.match(styles,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles,/@media \(min-width:901px\) and \(max-width:1550px\)[\s\S]*?grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(styles,/\.reporting-kpis \.reporting-kpi:nth-last-child\(-n\+2\)\s*\{\s*grid-column:span 3/);
  assert.match(styles,/@media \(max-width:580px\)[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
});

test('previous-period change graphics show honest equal-window comparisons with appropriate sentiment', () => {
  const source = [
    reportingUi.slice(reportingUi.indexOf('function formatNumber('), reportingUi.indexOf('function reportRangeDates(')),
    reportingUi.slice(reportingUi.indexOf('function reportingPreviousPeriodChange('),
      reportingUi.indexOf('function reportingFilamentsViewModel('))
  ].join('\n');
  const models=vm.runInNewContext(source + '\n({ reportingKpiViewModel, reportingPreviousPeriodChange })', {
    formatNumber:(value,digits=0)=>Number(value).toFixed(digits),
    formatPercent:(value)=>value == null ? '—' : Math.round(Number(value)*100)+'%'
  });
  const report = { totals:{
    attempts:342,completed:325,failed:17,runHours:412.6,materialGrams:15300,
    completionRate:325/342,failureRate:17/342
  },previousTotals:{
    attempts:305,completed:301,failed:22,runHours:350,materialGrams:12400
  }};
  const items=models.reportingKpiViewModel(report);
  assert.deepEqual(Array.from(items,item=>item.change.label),['12.1%','8.0%','22.7%','17.9%','23.4%']);
  assert.deepEqual(Array.from(items,item=>item.change.symbol),['▲','▲','▼','▲','▲']);
  assert.deepEqual(Array.from(items,item=>item.change.tone),['neutral','positive','positive','neutral','neutral']);
  assert.ok(items.every(item=>item.change.caption==='vs previous period'));
  assert.equal(items[1].progressPercent,95);
  assert.equal(items[4].value,'15.30 kg');
  assert.equal(items[4].change.caption,'vs previous period');
  const deteriorated=models.reportingKpiViewModel({
    totals:{ attempts:10,completed:7,failed:3,runHours:7,completionRate:.7,failureRate:.3 },
    previousTotals:{ attempts:10,completed:9,failed:1,runHours:9 }
  });
  assert.equal(deteriorated[0].change.tone,'muted');
  assert.equal(deteriorated[1].change.tone,'negative');
  assert.equal(deteriorated[1].change.symbol,'▼');
  assert.equal(deteriorated[2].change.tone,'negative');
  assert.equal(deteriorated[2].change.symbol,'▲');
  assert.equal(deteriorated[3].change.tone,'neutral');
  assert.equal(deteriorated[4].value,'—');
  assert.equal(deteriorated[4].change.caption,'No previous period data');
  const none=models.reportingKpiViewModel({totals:{attempts:5,completed:5,failed:0,runHours:8}});
  assert.ok(none.every(item=>item.change.caption==='No previous period data'));
  assert.ok(none.every(item=>item.change.symbol===''));
  const zeroBaseline=models.reportingKpiViewModel({
    totals:{ attempts:8,completed:7,failed:1,runHours:3,completionRate:.875,failureRate:.125 },
    previousTotals:{ attempts:2,completed:0,failed:0,runHours:0 }
  });
  assert.equal(zeroBaseline[1].change.label,'From 0');
  assert.equal(zeroBaseline[1].change.tone,'positive');
  assert.equal(zeroBaseline[2].change.label,'From 0');
  assert.equal(zeroBaseline[2].change.tone,'negative');
  assert.equal(zeroBaseline[3].change.label,'From 0');
  assert.equal(zeroBaseline[3].change.tone,'neutral');
  assert.equal(zeroBaseline[4].change.caption,'No previous period data');
  const noPriorJobs=models.reportingKpiViewModel({
    totals:{attempts:7,completed:7,failed:0,runHours:4},
    previousTotals:{attempts:0,completed:0,failed:0,runHours:0}
  });
  assert.ok(noPriorJobs.every(item=>item.change.caption==='No previous period data'));
  const quiet=models.reportingKpiViewModel({
    totals:{attempts:0,completed:0,failed:0,runHours:0},
    previousTotals:{attempts:8,completed:7,failed:1,runHours:9}
  });
  assert.equal(quiet[0].change.label,'100.0%');
  assert.equal(quiet[1].change.tone,'negative');
  assert.equal(quiet[2].change.tone,'positive');
  assert.equal(quiet[4].value,'0.00 kg','no completed prints means no filament consumed');
  const filtered=models.reportingKpiViewModel({
    totals:{attempts:3,completed:2,failed:1,materialGrams:2250},
    previousTotals:{attempts:5,completed:4,materialGrams:1000}
  });
  assert.equal(filtered[4].value,'2.25 kg','summary uses supplied period/filter totals');
  assert.equal(filtered[4].change.label,'125.0%');
  const missing=models.reportingKpiViewModel({
    totals:{attempts:2,completed:2,materialGrams:0},
    previousTotals:{attempts:3,materialGrams:1100}
  });
  assert.equal(missing[4].value,'—','completed jobs without recorded weight are unknown, not zero');
  assert.equal(missing[4].change.caption,'No previous period data');
  const oldUnrecorded=models.reportingKpiViewModel({
    totals:{attempts:4,completed:4,materialGrams:2000},
    previousTotals:{attempts:6,completed:6,materialGrams:0}
  });
  assert.equal(oldUnrecorded[4].value,'2.00 kg');
  assert.equal(oldUnrecorded[4].change.caption,'No previous period data',
    'previous jobs without weight must not imply material grew from zero');
  assert.match(reportingService,/getPreviousPeriodTotals/);
  assert.match(server,/report\.previousTotals = previous\.totals/);
  assert.match(server,/printerIds\s*\}\)/);
  assert.match(reportingUi,/reporting-kpi-change-caption/);
  assert.match(styles,/\.reporting-kpi \.reporting-kpi-change-positive/);
  assert.match(styles,/\.reporting-kpi \.reporting-kpi-change-negative/);
  assert.match(styles,/\.reporting-kpi \.reporting-kpi-change-neutral/);
  assert.match(reportingUi,/vs previous period/);
  const preact=fs.readFileSync(new URL('../ui/reporting.jsx',import.meta.url),'utf8');
  assert.match(preact,/item\.change\?\.symbol/);
  assert.match(preact,/item\.change\?\.caption/);
  assert.match(preact,/item\.change\?\.description/);
});

test('print-file analytics show material, historical cost, and total printer time without redundancy', () => {
  const helpers = [
    reportingUi.slice(reportingUi.indexOf('function escapeHtml('), reportingUi.indexOf('async function requestJson(')),
    reportingUi.slice(reportingUi.indexOf('function formatNumber('), reportingUi.indexOf('function reportRangeDates(')),
    reportingUi.slice(reportingUi.indexOf('function formatReportingDate('), reportingUi.indexOf('function reportingKpiSvg(')),
    reportingUi.slice(reportingUi.indexOf('function reportingFileNameHtml('), reportingUi.indexOf('function renderReportMaterials('))
  ].join('\n');
  const ui=vm.runInNewContext([
    "let reportingFilesScope = 'all';",
    "let reportingFilesSort = { key:'completed', direction:'desc' };",
    helpers,
    '({ reportingFileRows, renderReportFiles, setSort:(key,direction)=>reportingFilesSort={key,direction} })'
  ].join('\n'));
  const files=[
    {fileName:'High usage',completed:3,failed:0,attempts:3,materialGrams:450,
      materialUsageRecordedCount:3,costedPrints:3,spendByCurrency:{GBP:6},
      runSeconds:7200,runTimeEligibleCount:3,runTimeRecordedCount:3},
    {fileName:'Long-running',completed:2,failed:1,attempts:3,materialGrams:120,
      materialUsageRecordedCount:2,costedPrints:2,spendByCurrency:{GBP:2},
      runSeconds:18000,runTimeEligibleCount:3,runTimeRecordedCount:3},
    {fileName:'Euro job',completed:2,failed:0,attempts:2,materialGrams:300,
      materialUsageRecordedCount:2,costedPrints:2,spendByCurrency:{EUR:4},
      runSeconds:10800,runTimeEligibleCount:2,runTimeRecordedCount:2},
    {fileName:'Partial',completed:2,failed:0,attempts:2,materialGrams:50,
      materialUsageRecordedCount:1,costedPrints:1,spendByCurrency:{GBP:1},
      runSeconds:5400,runTimeEligibleCount:2,runTimeRecordedCount:1},
    {fileName:'No historic metadata',completed:1,failed:0,attempts:1,materialGrams:0,
      materialUsageRecordedCount:0,costedPrints:0,spendByCurrency:{},
      runSeconds:0,runTimeEligibleCount:1,runTimeRecordedCount:0},
    {fileName:'Mixed currencies',completed:2,failed:0,attempts:2,materialGrams:70,
      materialUsageRecordedCount:2,costedPrints:2,spendByCurrency:{GBP:1,EUR:2},
      runSeconds:540,runTimeEligibleCount:2,runTimeRecordedCount:2}
  ];
  const rows=ui.reportingFileRows(files);
  const byName=(name)=>rows.find(row=>row.fileName===name);
  assert.equal(byName('High usage').materialText,'0.45 kg');
  assert.equal(byName('High usage').materialCostText,'£6.00');
  assert.equal(byName('High usage').printTime,'2h 0m');
  assert.equal(byName('Long-running').printTime,'5h 0m');
  assert.equal(byName('Partial').materialPartial,true);
  assert.equal(byName('Partial').materialCostPartial,true);
  assert.equal(byName('Partial').printTimePartial,true);
  assert.equal(byName('No historic metadata').materialText,'—');
  assert.equal(byName('No historic metadata').materialCostText,'—');
  assert.equal(byName('No historic metadata').printTime,'—');
  assert.match(byName('Mixed currencies').materialCostText,/£1\.00/);
  assert.match(byName('Mixed currencies').materialCostText,/€2\.00/);
  const html=ui.renderReportFiles(rows);
  assert.match(html, /0\.45 kg/);
  assert.match(html, /£6\.00/);
  assert.doesNotMatch(html, /2h 0m/, 'print time is retained in analytics but not displayed in this table');
  assert.doesNotMatch(html, /<td[^>]*>100\.0%<\/td>/,'success rate is not displayed in this table');
  assert.match(html, /<small>partial<\/small>/);
  assert.match(html, /Sort by historical material cost, grouped by currency/);
  assert.doesNotMatch(html,/Popularity/);
  ui.setSort('materialGrams','desc');
  assert.equal(ui.reportingFileRows(files)[0].fileName,'High usage');
  ui.setSort('runSeconds','desc');
  assert.equal(ui.reportingFileRows(files)[0].fileName,'Long-running');
  ui.setSort('materialCost','desc');
  const costSorted=ui.reportingFileRows(files).map(item=>item.fileName);
  assert.deepEqual(Array.from(costSorted.slice(0,4)),['Euro job','High usage','Long-running','Partial'],
    'sort by historical cost within currency groups, with EUR and GBP kept separate');
  assert.deepEqual(Array.from(costSorted.slice(4)),['Mixed currencies','No historic metadata'],
    'non-comparable prices must not be converted or interleaved with valid prices');
  ui.setSort('materialGrams','asc');
  assert.equal(ui.reportingFileRows(files).at(-1).fileName,'No historic metadata',
    'missing data must remain last regardless of sort direction');
  const preact=fs.readFileSync(new URL('../ui/reporting.jsx',import.meta.url),'utf8');
  assert.match(preact,/file\.materialCostText/);
  assert.match(preact,/file\.materialText/);
  assert.doesNotMatch(preact.slice(preact.indexOf('function ReportFiles('),preact.indexOf('function ReportMaterials(')),
    /file\.printTime|file\.successRate/);
  assert.match(styles,/reporting-file-material/);
  assert.match(styles,/reporting-file-cost/);
  assert.doesNotMatch(html,/reporting-file-resource/);
  assert.match(html,/data-reporting-file-sort="materialGrams"/);
  assert.match(html,/data-reporting-file-sort="materialCost"/);
  const headerCells=(html.match(/<th scope="col"/g)||[]).length;
  const valueCells=(html.match(/<td(?: class=|>)/g)||[]).length;
  assert.equal(headerCells,6,'popular files must display six independent column headings');
  assert.equal(valueCells,rows.length*6,'each row must display six fields, including distinct Material and Cost cells');
  assert.match(html,/<td class="numeric reporting-file-material"/);
  assert.match(html,/<td class="numeric reporting-file-cost"/);
  const material=html.match(/<td class="numeric reporting-file-material"[^>]*>([\s\S]*?)<\/td>/);
  const cost=html.match(/<td class="numeric reporting-file-cost"[^>]*>([\s\S]*?)<\/td>/);
  assert.ok(material && cost,'resource columns must contain data');
  assert.doesNotMatch(material[1],/£6\.00/,'historical cost must not appear below material');
  assert.doesNotMatch(cost[1],/0\.45 kg/,'material weight must not appear within Cost');
  assert.doesNotMatch(styles.slice(styles.indexOf('/* Popular files and filament use the desktop row'),
    styles.indexOf('/* Kilogram-based filament usage chart.')), /reporting-file-time/);
  assert.match(styles,/\.reporting-analytics-files \.reporting-analytics-table\s*\{[^}]*min-width:600px/);
});

test('filament usage is a proportional, token-based kg pie chart in both Preact and fallback renderers', () => {
  assert.match(index, /<h3>Filament used \(kg\)<\/h3>/);
  assert.match(index, /Filament consumed by completed prints, measured in kg\./);
  assert.match(styles,/\.reporting-analytics-files \.reporting-section-head,\s*\.reporting-analytics-materials \.reporting-section-head\s*\{[^}]*align-items:flex-start;flex-wrap:nowrap;/);
  assert.match(styles,/\.reporting-analytics-files \.reporting-section-head \.reporting-segmented,\s*\.reporting-analytics-materials \.reporting-section-head \.reporting-segmented\s*\{[^}]*margin-left:auto/);
  assert.match(styles,/@media \(max-width:760px\)[\s\S]*?\.reporting-analytics-files \.reporting-section-head,\s*\.reporting-analytics-materials \.reporting-section-head\s*\{\s*flex-wrap:wrap;/);
  assert.match(index, /data-reporting-material-mode="filament" aria-pressed="true"/);
  assert.match(reportingUi, /let reportingMaterialMode = 'filament'/);
  assert.match(reportingUi,/function reportingFilamentBarColour\(value\)/);
  assert.match(reportingUi,/function reportingPiePath\(start, end\)/);
  assert.match(reportingUi,/function renderReportMaterials\(materials\)/);
  assert.match(reportingUi,/class="reporting-usage-chart" role="region"/);
  assert.match(reportingUi,/class="reporting-usage-pie"/);
  assert.match(reportingUi,/piePath/);
  assert.match(reportingUi,/pieColour/);
  const preact=fs.readFileSync(new URL('../ui/reporting.jsx',import.meta.url),'utf8');
  assert.match(preact,/function ReportMaterials\(\{ materials \}\)/);
  assert.match(preact,/class="reporting-usage-chart" role="region"/);
  assert.match(preact,/class="reporting-usage-pie"/);
  assert.match(preact,/role="img"/);
  assert.match(preact,/row\.pieColour/);
  assert.match(preact,/row\.piePath/);
  for(const token of ['--pfc-table-border','--pfc-table-radius','--pfc-table-surface',
    '--pfc-table-divider','--pfc-table-hover','--ds-text','--ds-border']){
    assert.ok(styles.includes('var('+token+')'),'kg pie chart must follow controller colour semantics: '+token);
  }
  assert.match(styles,/\.reporting-usage-plot\{display:grid;grid-template-columns:/);
  assert.match(styles,/@media \(max-width:620px\)[\s\S]*?\.reporting-usage-plot\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(fs.readFileSync(new URL('../scripts/browser-regression.mjs',import.meta.url),'utf8'),
    /reporting-usage-pie/);
});

test('pie sectors use recorded gram shares for multiple and single categories', () => {
  ui.setMode('type');
  const mixed=ui.reportingMaterialRows([
    {material:'ASA',grams:3000},{material:'PLA',grams:1000}
  ]);
  assert.equal(mixed.rows.length,2);
  assert.equal(mixed.rows[0].percentage,'75.0%');
  assert.match(mixed.rows[0].piePath,/ A 90 90 0 1 1 /,'75% is a large sector');
  assert.match(mixed.rows[1].piePath,/ A 90 90 0 0 1 /,'25% is a small sector');
  assert.notEqual(mixed.rows[0].pieColour,mixed.rows[1].pieColour,'material categories need distinguishable slices');
  assert.equal((ui.renderReportMaterials(mixed).match(/<path d=/g) || []).length,2);
  const single=ui.reportingMaterialRows([{material:'ASA',grams:1000}]);
  assert.equal(single.rows[0].pieFull,true);
  assert.match(ui.renderReportMaterials(single),/<circle cx="100" cy="100" r="90"/);
  const tiny=ui.reportingMaterialRows([{material:'ASA',grams:999999},{material:'PLA',grams:1}]);
  assert.match(tiny.rows[1].piePath,/^M 100 100 L /);
  assert.doesNotMatch(tiny.rows[1].piePath,/NaN|Infinity/);
  const none=ui.reportingMaterialRows([{material:'PLA',grams:0}]);
  assert.match(ui.renderReportMaterials(none),/No material usage captured/);
  ui.setMode('filament');
});

test('the remaining three Analytics tables preserve the controller table design system', () => {
  const shared=styles.slice(styles.indexOf('/* Controller table design system.'),
    styles.indexOf('/* Toolhead tables use the same header block'));
  for(const id of ['reportingFiles','reportingPrinters','reportingFileFailures']){
    for(const selector of [
      '#' + id + ' .reporting-table-scroll',
      '#' + id + ' .reporting-analytics-table thead th',
      '#' + id + ' .reporting-analytics-table tbody tr:hover > *'
    ]) assert.ok(shared.includes(selector),'Missing shared table selector: '+selector);
  }
  assert.match(shared, /#reportingPrinters \.reporting-analytics-table tbody > tr > :is\(th,td\)/);
  assert.match(shared, /#reportingFileFailures \.reporting-analytics-table tbody td/);
  assert.match(shared, /#reportingPrinters \.reporting-analytics-table tbody tr:last-child > \*/);
  for(const token of ['--pfc-table-header-background','--pfc-table-header-text',
    '--pfc-table-surface','--pfc-table-border','--pfc-table-divider','--pfc-table-hover']){
    assert.ok(shared.includes('var('+token+')'), 'Missing shared table token: '+token);
  }
  const preact=fs.readFileSync(new URL('../ui/reporting.jsx',import.meta.url),'utf8');
  assert.match(preact, /numeric:true, label:<button[^>]*data-reporting-file-sort="materialGrams"/);
  assert.match(preact, /numeric:true, label:<button[^>]*data-reporting-file-sort="materialCost"/);
  assert.match(preact, /class="numeric reporting-file-material"/);
  assert.match(preact, /class="numeric reporting-file-cost"/);
  assert.doesNotMatch(preact, /reporting-file-resource-heading/);
  assert.match(styles, /\.reporting-analytics-files \.reporting-analytics-table td:nth-child\(6\)/);
  assert.doesNotMatch(styles.slice(styles.indexOf('/* Popular files and filament use the desktop row'),
    styles.indexOf('/* Kilogram-based filament usage chart.')),/nth-child\((7|8)\)/);
});

test('analytics table grouping selectors use the standard 42px segmented-choice style', () => {
  for(const label of ['Popular print files list size','Material usage grouping']){
    assert.match(index,new RegExp('class="reporting-segmented" role="group" aria-label="'+label+'"'));
  }
  for(const value of ['top10','all','type','filament']){
    const kind=['top10','all'].includes(value)?'files-scope':'material-mode';
    assert.match(index,new RegExp('data-reporting-'+kind+'="'+value+'" aria-pressed="(true|false)"'));
  }
  assert.match(styles,/\.reporting-segmented button\s*\{[^}]*min-height:var\(--ds-button-height\)/);
  assert.match(styles,/\.reporting-segmented button\.active,[\s\S]*?button\[aria-pressed="true"\]\s*\{[^}]*background:var\(--ds-brand-strong\)/);
  assert.match(styles,/\.reporting-segmented button:focus-visible\s*\{[^}]*outline:2px solid var\(--ds-focus\)/);
  assert.doesNotMatch(styles,/\.reporting-segmented button\s*\{[^}]*min-height:33px/);
  assert.match(reportingUi,/button\.setAttribute\('aria-pressed', String\(active\)\)/);
});
