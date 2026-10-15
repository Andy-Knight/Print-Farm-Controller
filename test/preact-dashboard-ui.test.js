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

test('vanilla dashboard fallback remains in the HTML', async () => {
  const html = await read('public/index.html');
  assert.ok(html.includes('id="dashboardGroupFilterBar"'));
  assert.ok(html.includes('id="dashboardGroupFilter"'));
  assert.ok(html.includes('id="dashboardViewToggle"'));
  assert.ok(html.includes('id="summary"'));
});
