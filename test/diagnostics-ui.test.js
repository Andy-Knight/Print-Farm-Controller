import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const memoryMonitor = fs.readFileSync(new URL('../src/memory-monitor.js', import.meta.url), 'utf8');

test('diagnostics is available from the persistent controller navigation', () => {
  assert.match(html, /id="diagnosticsBtn"[^>]*class="sidebar-item"/);
  assert.match(html, /id="diagnosticsDialog"/);
  assert.match(app, /diagnosticsBtn\?\.addEventListener\('click'/);
  assert.doesNotMatch(html, /id="topbarOverflow"/, 'removed Farm operations overflow must not return');
  assert.match(app, /function navigateController\(routePath\)/);
  });

test('diagnostics UI supports log filtering and bundle download', () => {
  assert.match(html, /id="diagnosticsLevel"/);
  assert.match(html, /id="diagnosticsSearch"/);
  assert.doesNotMatch(html, /diagnosticsVerbose|Verbose diagnostics/);
  assert.match(html, /id="diagnosticsBundleBtn"/);
  assert.match(app, /\/api\/diagnostics\?/);
  assert.doesNotMatch(app, /diagnosticsVerbose|verboseUntil|toggleVerboseDiagnostics/);
  assert.match(app, /\/api\/diagnostics\/bundle/);
  assert.match(styles, /\.diagnostics-dialog/);
  assert.match(styles, /\.diagnostic-entry/);
});

test('server exposes diagnostic status and bundle endpoints', () => {
  assert.match(server, /url\.pathname === '\/api\/diagnostics'/);
  assert.doesNotMatch(server, /\/api\/diagnostics\/verbose/);
  assert.match(server, /diagnosticLogger\.info\('printer-operation', 'Starting printer operation'/);
  assert.match(server, /url\.pathname === '\/api\/diagnostics\/bundle'/);
  assert.match(server, /content-type':'application\/zip'/);
});


test('diagnostics exposes live controller memory usage and bundles the current snapshot', () => {
  assert.match(server, /new MemoryMonitor/);
  assert.match(server, /memoryMonitor\.start\(\)/);
  assert.match(server, /memoryMonitor\.stop\(\)/);
  assert.match(server, /memory:memoryMonitor\.getSnapshot\(\)/);
  assert.match(app, /Heap memory/);
  assert.match(app, /Process RSS/);
  assert.match(app, /heapUsedPercent/);
  assert.match(memoryMonitor, /warning:0\.25/);
  assert.match(memoryMonitor, /critical:0\.50/);
  assert.match(memoryMonitor, /danger:0\.75/);
  assert.match(memoryMonitor, /Controller memory usage recovered/);
});
