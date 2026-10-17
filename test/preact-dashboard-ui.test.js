import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');

test('Preact dashboard is bundled locally and loaded before the legacy controller UI', async () => {
  const [pkgText, html, source, dockerfile, seaBuild, frontendBuild] = await Promise.all([
    read('package.json'),
    read('public/index.html'),
    read('ui/dashboard.jsx'),
    read('Dockerfile'),
    read('scripts/build-sea-windows.mjs'),
    read('scripts/build-frontend.mjs')
  ]);
  const pkg = JSON.parse(pkgText);

  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'package version must be valid semver');
  assert.equal(pkg.devDependencies?.preact, '11.0.1');
  assert.equal(pkg.allowScripts?.['esbuild@0.28.2'], true);
  assert.match(pkg.scripts?.['build:frontend'] || '', /build-frontend\.mjs/);
  assert.equal(pkg.scripts?.start, 'node src/server.js');
  assert.match(pkg.scripts?.postinstall || '', /build:frontend/);
  assert.match(pkg.scripts?.['build:bundle'] || '', /build:frontend/);

  assert.ok(html.includes('id="dashboardPreactRoot"'));
  assert.ok(html.includes('/dashboard-preact.js'));
  assert.ok(html.indexOf('/dashboard-preact.js') < html.indexOf('/app.js'));

  assert.match(source, /pfc:dashboard-action/);
  assert.match(source, /pfc:dashboard-state/);
  assert.match(source, /id="dashboardViewToggle"/);
  assert.match(source, /id="dashboardGroupFilter"/);
  assert.match(source, /id="summary"/);
  assert.match(source, /function PrinterCard/);
  assert.match(source, /function PrinterFleet/);
  assert.match(source, /pfc:dashboard-fleet-state/);
  assert.match(source, /data-printer-card/);
  assert.match(source, /data-card-job-control/);
  assert.match(source, /data-maintenance-open-printer/);

  assert.match(frontendBuild, /jsxImportSource:'preact'/);
  assert.match(frontendBuild, /bundle:true/);
  assert.match(frontendBuild, /preact-LICENSE\.txt/);
  assert.match(frontendBuild, /copyFile\(installedPreactLicense/);
  assert.match(dockerfile, /COPY ui \.\/ui/);
  assert.match(dockerfile, /COPY --from=builder \/app\/public \.\/public/);
  const dockerInstallIndex = dockerfile.indexOf('RUN npm install --include=dev --no-audit --no-fund');
  assert.ok(dockerInstallIndex > dockerfile.indexOf('COPY scripts ./scripts'));
  assert.ok(dockerInstallIndex > dockerfile.indexOf('COPY public ./public'));
  assert.ok(dockerInstallIndex > dockerfile.indexOf('COPY ui ./ui'));
  assert.match(seaBuild, /buildFrontend/);
});

test('missing optional frontend assets return 404 while extensionless controller routes retain SPA fallback', async () => {
  const server = await read('src/server.js');
  assert.match(server, /!path\.posix\.extname\(url\.pathname\)/);
  assert.match(server, /serveStatic\(res, '\/index\.html'\)/);
});

test('controller bridges live printer presentation into the Preact fleet without replacing command delegation', async () => {
  const app = await read('public/app.js');
  assert.match(app, /function dashboardPrinterViewModel/);
  assert.match(app, /function publishDashboardPrinterState/);
  assert.match(app, /window\.__PFC_PREACT_FLEET__/);
  assert.match(app, /pfc:dashboard-fleet-state/);
  assert.match(app, /fleetEl\.addEventListener\('click'/);
  assert.match(app, /fleetEl\.addEventListener\('change'/);
  assert.match(app, /dashboardTableOrderMap/);
});

test('vanilla dashboard fallback remains in the HTML', async () => {
  const html = await read('public/index.html');
  assert.ok(html.includes('id="dashboardGroupFilterBar"'));
  assert.ok(html.includes('id="dashboardGroupFilter"'));
  assert.ok(html.includes('id="dashboardViewToggle"'));
  assert.ok(html.includes('id="summary"'));
});


test('reusable Preact design system preserves dashboard compatibility hooks', async () => {
  const [components, dashboard, app, styles] = await Promise.all([
    read('ui/components.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js'),
    read('public/styles.css')
  ]);

  for (const component of ['UiButton', 'StatusBadge', 'ProgressBar', 'Metric', 'ToastHost']) {
    assert.match(components, new RegExp(`export function ${component}\\b`));
  }
  assert.match(components, /legacyVariantClass/);
  assert.match(components, /data-printer-state/);
  assert.match(components, /data-progress-bar/);
  assert.match(dashboard, /<StatusBadge/);
  assert.match(dashboard, /<ProgressBar/);
  assert.match(dashboard, /<Metric/);
  assert.match(dashboard, /<ToastHost/);
  assert.match(dashboard, /data-nozzle/);
  assert.match(dashboard, /data-bed/);
  assert.match(dashboard, /data-layer/);
  assert.match(dashboard, /data-remaining/);
  assert.match(app, /function showUiToast/);
  assert.match(app, /pfc:toast/);
  assert.match(styles, /Preact UI design-system layer/);
  assert.match(styles, /\.ui-toast-host/);
  assert.match(styles, /\.ui-status-badge::before/);
});


test('metric backgrounds remain unchanged on printer card hover', async () => {
  const styles = await read('public/styles.css');
  assert.doesNotMatch(styles, /\.fleet:not\(\.table-view\) \.card:hover \.ui-metric\s*\{[\s\S]*?background:/);
});


test('Preact printer-detail chrome preserves six-tab behavior and vanilla fallback', async () => {
  const [detailUi, dashboard, app, styles] = await Promise.all([
    read('ui/printer-details.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js'),
    read('public/styles.css')
  ]);

  assert.match(dashboard, /initPrinterDetailsUi/);
  assert.match(detailUi, /PRINTER_DETAIL_TABS/);
  for (const tab of ['toolheads','camera','files','temperature','job','management']) {
    assert.match(detailUi, new RegExp(`key:'${tab}'`));
  }
  assert.match(detailUi, /PrinterDetailHeader/);
  assert.match(detailUi, /PrinterDetailTabs/);
  assert.match(detailUi, /PrinterDetailActivity/);
  assert.match(detailUi, /function PrinterNameEditor/);
  assert.match(detailUi, /function ToolheadDesignationEditor/);
  assert.match(detailUi, /data-preact-toolhead-editor/);
  assert.match(detailUi, /requestToolheadDesignation/);
  assert.match(detailUi, /data-toolhead-color-option/);
  assert.match(detailUi, /data-toolhead-nozzle/);
  assert.match(detailUi, /pending.current/);
  assert.match(app, /function printerToolheadDisplayTools\(printer\)/);
  assert.match(app, /if \(printer.adapterType !== 'prusa-core-one-plus' \|\| !reported.length\) return reported/);
  assert.match(app, /\[1,4,8\]\.includes\(configured\)/);
  assert.match(app, /byIndex\.get\(index\) \|\| \{ index/);
  assert.match(app, /const tools=printerToolheadDisplayTools\(printer\)/);
  assert.match(app, /const tools = printerToolheadDisplayTools\(printer\)/);
  assert.match(app, /function printerToolheadControlState/);
  assert.match(app, /const ad5mToolheadTable = printer.adapterType === 'flashforge-ad5m'/);
  assert.match(app, /configuredToolCount > 1 \|\| ad5mToolheadTable \|\| coreOneSingleToolheadTable/);
  assert.match(app, /const coreOneSingleToolheadTable = printer.adapterType === 'prusa-core-one-plus'/);
  assert.match(app, /capabilities\.toolNozzleDesignation && tools\.length > 1/);
  assert.match(app, /ad5mToolheadTable && toolPosition === 0/);
  assert.match(app, /flashForgeMaterialDesignationMarkup\(printer, filament\)/);
  assert.match(app, /printer.adapterType === 'flashforge-ad5m' && !ad5mToolheadTable/);
  assert.match(app, /function performToolheadDesignation/);
  assert.match(app, /pendingToolheadDesignations/);
  assert.match(app, /if \(action.type === 'toolhead-designation'\)/);
  assert.match(app, /data-preact-toolhead-control="prusa-filament"/);
  assert.match(app, /data-preact-toolhead-control="controller-filament"/);
  assert.match(app, /data-preact-toolhead-control="tool-nozzle"/);
  assert.match(app, /data-preact-toolhead-control="controller-nozzle"/);
  assert.match(app, /data-preact-toolhead-control="u1-filament"/);
  assert.match(app, /data-preact-toolhead-control="creator5-filament"/);
  assert.match(app, /data-preact-toolhead-control="bambu-filament"/);
  assert.match(app, /u1FilamentConfigEditState\(printer,tool\)/);
  assert.match(app, /creator5FilamentColorOptions\(printer\)/);
  assert.match(app, /\['u1-filament','creator5-filament','bambu-filament','bambu-ams-filament'\]\.includes\(mode\)/);
  assert.match(detailUi, /data-preact-printer-name-editor/);
  assert.match(detailUi, /data-printer-name-reset/);
  assert.match(detailUi, /requestControllerRename/);
  assert.match(detailUi, /current.value === current.base/);
  assert.match(detailUi, /activeRequest.current/);
  assert.match(app, /data-preact-printer-management/);
  assert.match(app, /if \(action.type === 'rename'\)/);
  assert.match(app, /currentPrinterId !== targetId/);
  assert.match(app, /window.__PFC_PREACT_DETAIL__ \? null : printerDetail.querySelector\('\[data-rename\]'\)/);
  assert.match(detailUi, /pfc:printer-detail-action/);
  assert.match(detailUi, /pfc:printer-detail-state/);
  assert.match(app, /function publishPrinterDetailState/);
  assert.match(app, /function activatePrinterDetailTab/);
  assert.match(app, /function printerDetailHeaderMarkup/);
  assert.match(app, /if \(window\.__PFC_PREACT_DETAIL__\) return '<div data-preact-detail-header><\/div>'/);
  assert.match(app, /if \(window\.__PFC_PREACT_DETAIL__\) return '<div data-preact-detail-tabs><\/div>'/);
  assert.match(app, /printerDetailTabsMarkup\(\)/);
  assert.match(styles, /Preact printer-detail chrome/);
  assert.match(styles, /\.printer-detail-preact-tabs/);
  // All Preact Toolheads islands are forms inside table cells, unlike dialog
  // forms. Their padding must explicitly override the global 22px rule.
  assert.match(styles, /form \{ padding:22px; \}/);
  // Nozzle designation wrappers must not push help text lower than the
  // Set filament guidance in the adjacent Toolheads table column.
  assert.match(styles, /\.material-panel \.toolhead-designation-editor > \.field-help\s*\{[^}]*margin-top:-5px;/);
  // AD5M generic designation wrappers add label bottom margins and use a
  // different select spacing than the adjacent nozzle control. Preact must
  // normalise both to align Set filament and Assign in the same table row.
  assert.match(styles, /\.material-panel \.toolhead-designation-editor \.toolhead-dropdown-pair label\s*\{[^}]*margin:0;/);
  assert.match(styles, /\.material-panel \.toolhead-designation-editor \.toolhead-dropdown-pair label\s*\{[^}]*font-size:\.68rem;/);
  assert.match(styles, /\.material-panel \.toolhead-designation-editor \.toolhead-dropdown-pair select\s*\{[^}]*margin-top:4px;/);
  assert.match(styles, /\.material-panel \.toolhead-designation-editor\s*\{[^}]*padding:0;[^}]*margin:0;/);
  // Each Preact form spans the entire legacy two-column wrapper. Otherwise
  // its nested material and colour selects each receive only ~half the width.
  for (const kind of ['u1-filament-config-control','creator5-filament-config-control',
    'prusa-tool-filament-control']) {
    assert.ok(styles.includes(kind + ' > .toolhead-designation-editor'),
      kind + ' must span the full toolhead configuration column');
  }
  assert.match(styles, /grid-column:1 \/ -1;/);
});


test('printer details stay vertically anchored while switching tabs', async () => {
  const styles = await read('public/styles.css');
  assert.match(styles, /\.printer-dialog\s*\{[\s\S]*top:15px;[\s\S]*bottom:auto;[\s\S]*margin:0 auto;/);
});


test('Preact print queue preserves delegated controller actions and fallback rendering', async () => {
  const [queueUi, dashboard, app] = await Promise.all([
    read('ui/print-queue.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js')
  ]);

  assert.match(dashboard, /initPrintQueueUi/);
  assert.match(queueUi, /function QueueJob/);
  assert.match(queueUi, /function ClearanceItem/);
  assert.match(queueUi, /function ProductionBatch/);
  assert.match(queueUi, /data-queue-cancel/);
  assert.match(queueUi, /data-queue-recheck/);
  assert.match(queueUi, /data-queue-up/);
  assert.match(queueUi, /data-queue-down/);
  assert.match(queueUi, /data-queue-priority/);
  assert.match(queueUi, /data-bed-cleared/);
  assert.match(queueUi, /data-production-action/);
  assert.match(queueUi, /data-production-priority-select/);
  assert.match(queueUi, /data-production-quantity/);
  assert.match(queueUi, /data-queue-reprint/);
  assert.match(queueUi, /data-production-reprint/);
  assert.match(queueUi, /defaultValue=\{item\.priority \|\| 'normal'\}/);
  assert.match(queueUi, /defaultValue=\{item\.quantity\}/);
  assert.match(app, /function publishPrintQueueUiState/);
  assert.match(app, /window\.__PFC_PREACT_QUEUE__/);
  assert.match(app, /pfc:queue-ui-state/);
  assert.match(app, /queueActiveList\?\.addEventListener\('click'/);
  assert.match(app, /queueHistoryList\?\.addEventListener\('click'/);
  assert.match(app, /queueActiveList\.innerHTML = nextActiveMarkup/);
  assert.match(app, /queueHistoryList\.innerHTML = productionHistoryMarkup/);
});

test('Preact Print Library preserves delegated actions, search filtering and vanilla fallback', async () => {
  const [libraryUi, dashboard, app] = await Promise.all([
    read('ui/print-library.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js')
  ]);

  assert.match(dashboard, /initPrintLibraryUi/);
  assert.match(libraryUi, /function LibraryFile/);
  assert.match(libraryUi, /function LibraryPreview/);
  assert.match(libraryUi, /function LibraryColours/);
  assert.match(libraryUi, /data-library-preview/);
  assert.match(libraryUi, /data-library-queue/);
  assert.match(libraryUi, /data-library-edit/);
  assert.match(libraryUi, /data-library-delete/);
  assert.match(app, /function libraryFileViewModel/);
  assert.match(app, /function publishPrintLibraryUiState/);
  assert.match(app, /window\.__PFC_PREACT_LIBRARY__/);
  assert.match(app, /pfc:library-ui-state/);
  assert.match(app, /const visible = query \? files\.filter\(\(file\) => librarySearchText\(file\)\.includes\(query\)\) : files/);
  assert.match(app, /librarySearchInput\?\.addEventListener\('input', renderPrintLibrary\)/);
  assert.match(app, /libraryList\?\.addEventListener\('click'/);
  assert.match(app, /libraryList\.innerHTML = visible\.length/);
});

test('Preact Print Library preserves file metadata and delete interlock presentation', async () => {
  const [libraryUi, app] = await Promise.all([
    read('ui/print-library.jsx'),
    read('public/app.js')
  ]);
  assert.match(app, /requirements:libraryRequirementSummary\(file\)/);
  assert.match(app, /colours,/);
  assert.match(app, /previewUrl:String\(file\?\.previewUrl \|\| ''\)/);
  assert.match(app, /deleteDisabled:Number\(usage\.queueReferences \|\| 0\) > 0/);
  assert.match(app, /Clear queue\/history references before deleting this file/);
  assert.match(libraryUi, /disabled=\{file\.deleteDisabled\}/);
  assert.match(libraryUi, /class="library-printer-target"/);
  assert.match(libraryUi, /class="library-file-requirements"/);
  assert.match(libraryUi, /class="library-warning"/);
});


test('queuing from Print Library keeps the library route visible behind the modal', async () => {
  const app = await read('public/app.js');
  const handler = app.match(/const queueButton = event\.target\.closest\('\[data-library-queue\]'\);[\s\S]*?openQueueAddDialog\(file\);[\s\S]*?return;/)?.[0] || '';
  assert.match(handler, /openQueueAddDialog\(file\)/);
  assert.doesNotMatch(handler, /libraryDialog\?\.close\(\)/);
});


test('Preact Maintenance preserves task views and delegated action hooks', async () => {
  const [maintenanceUi, dashboard, maintenance] = await Promise.all([
    read('ui/maintenance.jsx'),
    read('ui/dashboard.jsx'),
    read('public/maintenance.js')
  ]);

  assert.match(dashboard, /initMaintenanceUi/);
  assert.match(maintenanceUi, /function MaintenanceTabs/);
  assert.match(maintenanceUi, /function SharedTaskCard/);
  assert.match(maintenanceUi, /function PrinterCard/);
  assert.match(maintenanceUi, /function MaintenanceHistory/);
  for (const view of ['add','model','group','printers']) {
    assert.match(maintenanceUi, new RegExp(`['"]${view}['"]`));
  }
  assert.match(maintenanceUi, /data-maintenance-complete-model/);
  assert.match(maintenanceUi, /data-maintenance-complete-group/);
  assert.match(maintenanceUi, /data-maintenance-complete/);
  assert.match(maintenanceUi, /data-maintenance-edit/);
  assert.match(maintenanceUi, /data-maintenance-delete/);
  assert.match(maintenanceUi, /data-maintenance-clear-history/);
  assert.match(maintenanceUi, /data-maintenance-printer-card/);
  assert.match(maintenance, /function publishMaintenanceUiState/);
  assert.match(maintenance, /pfc:maintenance-ui-state/);
  assert.match(maintenance, /pfc:maintenance-action/);
  assert.match(maintenance, /window\.__PFC_PREACT_MAINTENANCE__/);
  assert.match(maintenance, /list\?\.addEventListener\('click'/);
});

test('Preact Maintenance keeps assignment form and vanilla list fallback', async () => {
  const maintenance = await read('public/maintenance.js');
  assert.match(maintenance, /form\?\.classList\.toggle\('hidden', activeMaintenanceView !== 'add'\)/);
  assert.match(maintenance, /if \(window\.__PFC_PREACT_MAINTENANCE__\) \{[\s\S]*publishMaintenanceUiState\(\);[\s\S]*return;/);
  assert.match(maintenance, /list\.innerHTML = modelTaskSection\(\)/);
  assert.match(maintenance, /list\.innerHTML = groupTaskSection\(\)/);
  assert.match(maintenance, /list\.innerHTML = printerCardsMarkup\(\)/);
  assert.match(maintenance, /form\?\.addEventListener\('submit'/);
});


test('Preact Alerts preserves tabs, history actions, destinations and rules', async () => {
  const [alertsPreact, dashboard, alerts] = await Promise.all([
    read('ui/alerts.jsx'),
    read('ui/dashboard.jsx'),
    read('public/alerts.js')
  ]);

  assert.match(dashboard, /initAlertsUi/);
  assert.match(alertsPreact, /function AlertsTabs/);
  assert.match(alertsPreact, /function AlertHistoryTable/);
  assert.match(alertsPreact, /function DestinationCards/);
  assert.match(alertsPreact, /function RuleCards/);
  assert.match(alertsPreact, /data-alert-mark-read/);
  assert.match(alertsPreact, /data-alert-destination-test/);
  assert.match(alertsPreact, /data-alert-destination-edit/);
  assert.match(alertsPreact, /data-alert-destination-delete/);
  assert.match(alertsPreact, /data-alert-rule-edit/);
  assert.match(alertsPreact, /data-alert-rule-delete/);
  assert.match(alerts, /function publishAlertsUiState/);
  assert.match(alerts, /pfc:alerts-ui-state/);
  assert.match(alerts, /pfc:alerts-action/);
  assert.match(alerts, /window\.__PFC_PREACT_ALERTS__/);
  assert.match(alerts, /alertsHistory\?\.addEventListener\('click'/);
  assert.match(alerts, /alertDestinationsList\?\.addEventListener\('click'/);
  assert.match(alerts, /alertRulesList\?\.addEventListener\('click'/);
});

test('Preact Alerts keeps severity filtering, forms and vanilla fallbacks', async () => {
  const alerts = await read('public/alerts.js');
  assert.match(alerts, /function filteredAlertHistory/);
  assert.match(alerts, /alertHistorySeverity === 'all'/);
  assert.match(alerts, /alertsSeverityFilter\?\.addEventListener\('change'/);
  assert.match(alerts, /alertDestinationForm\?\.addEventListener\('submit'/);
  assert.match(alerts, /alertRuleForm\?\.addEventListener\('submit'/);
  assert.match(alerts, /if \(window\.__PFC_PREACT_ALERTS__\) \{[\s\S]*publishAlertsUiState\(\)/);
  assert.match(alerts, /alertsHistory\.innerHTML =/);
  assert.match(alerts, /alertDestinationsList\.innerHTML =/);
  assert.match(alerts, /alertRulesList\.innerHTML =/);
  assert.match(alerts, /if \(!window\.__PFC_PREACT_ALERTS__\) \{[\s\S]*tab\.addEventListener\('click'/);
});


test('Preact reporting preserves analytics, chart and filament catalogue presentation', async () => {
  const [reportingPreact, dashboard, reporting] = await Promise.all([
    read('ui/reporting.jsx'),
    read('ui/dashboard.jsx'),
    read('public/reporting.js')
  ]);

  assert.match(dashboard, /initReportingUi/);
  assert.match(reportingPreact, /function ReportingTabs/);
  assert.match(reportingPreact, /function ReportingKpis/);
  assert.match(reportingPreact, /function ReportingTrend/);
  assert.match(reportingPreact, /function ProblemPrinters/);
  assert.match(reportingPreact, /function BarRows/);
  assert.match(reportingPreact, /function FilamentCatalogue/);
  assert.match(reportingPreact, /data-filament-edit/);
  assert.match(reportingPreact, /data-filament-delete/);
  assert.match(reporting, /function lineChartViewModel/);
  assert.match(reporting, /function reportingBarRowsViewModel/);
  assert.match(reporting, /function reportingPrintersViewModel/);
  assert.match(reporting, /function reportingKpiViewModel/);
  assert.match(reporting, /function publishReportingUiState/);
  assert.match(reporting, /pfc:reporting-ui-state/);
  assert.match(reporting, /pfc:reporting-action/);
  assert.match(reporting, /window\.__PFC_PREACT_REPORTING__/);
});

test('Preact reporting keeps filters, filament form actions and vanilla fallbacks', async () => {
  const reporting = await read('public/reporting.js');
  assert.match(reporting, /reportingRefreshBtn\?\.addEventListener\('click', loadReport\)/);
  assert.match(reporting, /reportingRange\?\.addEventListener\('change', loadReport\)/);
  assert.match(reporting, /reportingGroup\?\.addEventListener\('change', loadReport\)/);
  assert.match(reporting, /reportingPrinter\?\.addEventListener\('change', loadReport\)/);
  assert.match(reporting, /filamentForm\?\.addEventListener\('submit'/);
  assert.match(reporting, /filamentList\?\.addEventListener\('click'/);
  assert.match(reporting, /if \(window\.__PFC_PREACT_REPORTING__\) \{[\s\S]*publishReportingUiState\(report\);[\s\S]*return;/);
  assert.match(reporting, /reportingKpis\.innerHTML =/);
  assert.match(reporting, /reportingTrend\.innerHTML = lineChartSvg/);
  assert.match(reporting, /filamentList\.innerHTML = rows\.map/);
  assert.match(reporting, /if \(!window\.__PFC_PREACT_REPORTING__\) \{[\s\S]*tab\.addEventListener\('click'/);
});


test('Preact Backup and Recovery preserves tabs, status and restore inspection presentation', async () => {
  const [backupPreact, dashboard, app] = await Promise.all([
    read('ui/backup-recovery.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js')
  ]);

  assert.match(dashboard, /initBackupRecoveryUi/);
  assert.match(backupPreact, /function BackupTabs/);
  assert.match(backupPreact, /function BackupStatus/);
  assert.match(backupPreact, /function RestoreInspection/);
  for (const tab of ['overview','google-drive','one-drive','s3','schedule','restore']) {
    assert.match(backupPreact, new RegExp(`['"]${tab}['"]`));
  }
  assert.match(app, /function publishBackupRecoveryUiState/);
  assert.match(app, /function backupStatusItemsViewModel/);
  assert.match(app, /function restoreInspectionViewModel/);
  assert.match(app, /pfc:backup-ui-state/);
  assert.match(app, /pfc:backup-ui-action/);
  assert.match(app, /window\.__PFC_PREACT_BACKUP__/);
  assert.match(app, /backupUiInspection = null/);
  assert.match(app, /backupUiInspection = restoreInspectionViewModel\(inspection\)/);
});

test('Preact Backup and Recovery keeps provider, schedule and restore execution controls in app logic', async () => {
  const app = await read('public/app.js');
  assert.match(app, /googleDriveConnectBtn\?\.addEventListener\('click', startGoogleDriveConnection\)/);
  assert.match(app, /oneDriveConnectBtn\?\.addEventListener\('click', startOneDriveConnection\)/);
  assert.match(app, /s3SaveConfigBtn\?\.addEventListener\('click', saveS3Configuration\)/);
  assert.match(app, /backupSaveScheduleBtn\?\.addEventListener\('click', saveScheduledBackupSettings\)/);
  assert.match(app, /restoreInspectBtn\?\.addEventListener\('click', inspectRestoreFile\)/);
  assert.match(app, /restoreStageBtn\?\.addEventListener\('click', stageRestoreFile\)/);
  assert.match(app, /if \(!window\.__PFC_PREACT_BACKUP__\) \{[\s\S]*tab\.addEventListener\('click'/);
  assert.match(app, /backupStatusGrid\.innerHTML =/);
  assert.match(app, /restoreInspectionSummary\.innerHTML =/);
});


test('Preact Printer Groups preserves group cards and delegated actions', async () => {
  const [groupsUi, dashboard, app] = await Promise.all([
    read('ui/printer-groups.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js')
  ]);

  assert.match(dashboard, /initPrinterGroupsUi/);
  assert.match(groupsUi, /function PrinterGroupCard/);
  assert.match(groupsUi, /function PrinterGroupsList/);
  assert.match(groupsUi, /id="printerGroupsTabCreate"/);
  assert.match(groupsUi, /id="printerGroupsTabExisting"/);
  assert.match(groupsUi, /id="printerGroupsCreatePanel"/);
  assert.match(groupsUi, /id="printerGroupsExistingPanel"/);
  assert.match(groupsUi, /const \[createDraft,setCreateDraft\]/);
  assert.match(groupsUi, /const \[editDraft,setEditDraft\]/);
  assert.match(groupsUi, /onTabsKeyDown/);
  assert.match(groupsUi, /if \(!draft\.id\) setTab\('groups'\)/);
  assert.match(groupsUi, /data-printer-group-card/);
  assert.match(groupsUi, /data-printer-group-edit/);
  assert.match(groupsUi, /data-printer-group-delete/);
  assert.match(app, /function printerGroupsViewModel/);
  assert.match(app, /function publishPrinterGroupsUiState/);
  assert.match(app, /pfc:printer-groups-ui-state/);
  assert.match(app, /window\.__PFC_PREACT_PRINTER_GROUPS__/);
  assert.match(app, /printerGroupsList\?\.addEventListener\('click'/);
});

test('Preact Printer Groups keeps the editor, multi-group membership and vanilla fallback', async () => {
  const app = await read('public/app.js');
  assert.match(app, /function renderPrinterGroupMembers/);
  assert.match(app, /function groupsForPrinter/);
  assert.match(app, /const otherNames = otherGroups\.map/);
  assert.match(app, /printer-group-member-groups/);
  assert.match(app, /printerGroupForm\?\.addEventListener\('submit'/);
  assert.match(app, /data-printer-group-member/);
  assert.match(app, /if \(window\.__PFC_PREACT_PRINTER_GROUPS__\) \{[\s\S]*publishPrinterGroupsUiState\(\);[\s\S]*return;/);
  assert.match(app, /printerGroupsList\.innerHTML = groups\.length/);
});


test('Preact Diagnostics preserves status and log presentation', async () => {
  const [diagnosticsUi, dashboard, app] = await Promise.all([
    read('ui/diagnostics.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js')
  ]);

  assert.match(dashboard, /initDiagnosticsUi/);
  assert.match(diagnosticsUi, /function DiagnosticsStatus/);
  assert.match(diagnosticsUi, /function DiagnosticEntry/);
  assert.match(diagnosticsUi, /function DiagnosticsLog/);
  assert.match(diagnosticsUi, /diagnostic-entry/);
  assert.match(diagnosticsUi, /diagnostic-level/);
  assert.match(app, /function diagnosticsStatusViewModel/);
  assert.match(app, /function diagnosticsEntriesViewModel/);
  assert.match(app, /function publishDiagnosticsUiState/);
  assert.match(app, /pfc:diagnostics-ui-state/);
  assert.match(app, /window\.__PFC_PREACT_DIAGNOSTICS__/);
});

test('Preact Diagnostics keeps filters, verbose controls, bundle download and vanilla fallback', async () => {
  const app = await read('public/app.js');
  assert.match(app, /diagnosticsRefreshBtn\?\.addEventListener\('click', loadDiagnostics\)/);
  assert.match(app, /diagnosticsVerboseBtn\?\.addEventListener\('click', toggleVerboseDiagnostics\)/);
  assert.match(app, /diagnosticsBundleBtn\?\.addEventListener\('click', downloadDiagnosticBundle\)/);
  assert.match(app, /diagnosticsLevel\?\.addEventListener\('change', loadDiagnostics\)/);
  assert.match(app, /diagnosticsSearch\?\.addEventListener\('input'/);
  assert.match(app, /if \(!window\.__PFC_PREACT_DIAGNOSTICS__ && diagnosticsStatus\)/);
  assert.match(app, /diagnosticsStatus\.innerHTML =/);
  assert.match(app, /diagnosticsLog\.innerHTML =/);
});


test('Preact Licence preserves status, entitlement details and warnings', async () => {
  const [licenseUi, dashboard, app] = await Promise.all([
    read('ui/license.jsx'),
    read('ui/dashboard.jsx'),
    read('public/app.js')
  ]);

  assert.match(dashboard, /initLicenseUi/);
  assert.match(licenseUi, /function LicenseStatus/);
  assert.match(licenseUi, /function LicenseInfoGrid/);
  assert.match(licenseUi, /function LicenseDetails/);
  assert.match(licenseUi, /data-license-status/);
  assert.match(licenseUi, /license-file-path/);
  assert.match(licenseUi, /license-dialog-warning/);
  assert.match(app, /function licenseViewModel/);
  assert.match(app, /function publishLicenseUiState/);
  assert.match(app, /pfc:license-ui-state/);
  assert.match(app, /window\.__PFC_PREACT_LICENSE__/);
});

test('Preact Licence keeps install, signature verification and vanilla fallback in app logic', async () => {
  const app = await read('public/app.js');
  assert.match(app, /licenseInstallForm\?\.addEventListener\('submit'/);
  assert.match(app, /api\('\/api\/license\/install'/);
  assert.match(app, /Verifying licence signature/);
  assert.match(app, /if \(window\.__PFC_PREACT_LICENSE__\) \{[\s\S]*publishLicenseUiState\(license\)/);
  assert.match(app, /licenseDetails\.innerHTML =/);
  assert.match(app, /submit\.textContent = license\.licenseStatus === 'valid' \? 'Replace licence' : 'Install licence'/);
});


test('Preact dashboard owns the licence-limit notice presentation with vanilla fallback', async () => {
  const [dashboard, app] = await Promise.all([
    read('ui/dashboard.jsx'),
    read('public/app.js')
  ]);

  assert.match(dashboard, /function LicenseNotice/);
  assert.match(dashboard, /pfc:license-notice-state/);
  assert.match(dashboard, /__PFC_PREACT_LICENSE_NOTICE__/);
  assert.match(app, /function licenseNoticeViewModel/);
  assert.match(app, /function publishLicenseNoticeState/);
  assert.match(app, /window\.__PFC_PREACT_LICENSE_NOTICE__/);
  assert.match(app, /licenseNoticeEl\.innerHTML =/);
});

test('dashboard summary headings do not render decorative dots', async () => {
  const [dashboard, styles] = await Promise.all([
    read('ui/dashboard.jsx'),
    read('public/styles.css')
  ]);

  assert.doesNotMatch(dashboard, /summary-card-label[^\n]*<i/);
  assert.doesNotMatch(styles, /summary-card-label i/);
});


test('dashboard summary cards keep labels above counts', async () => {
  const styles = await read('public/styles.css');
  assert.match(styles, /\.summary-card \{[\s\S]*display:block;[\s\S]*text-align:left;/);
  assert.match(styles, /\.summary-card-label \{[\s\S]*display:block;/);
  assert.match(styles, /\.summary-card > b \{[\s\S]*display:block;/);
});


// Direct-route initialization, report loading, and hard refresh across all
// controller routes are exercised in real Chromium by npm run test:browser.
// The previous source-index/regex checks were removed because they could pass
// even when those routes rendered blank or never populated their data.
