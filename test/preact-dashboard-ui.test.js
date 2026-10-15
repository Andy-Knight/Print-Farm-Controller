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

  assert.equal(pkg.version, '0.47.0');
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
