import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('diagnostics is available from the overflow menu instead of the top bar', () => {
  assert.match(html, /id="diagnosticsBtn"[^>]*class="topbar-overflow-item"/);
  assert.match(html, /id="diagnosticsDialog"/);
  assert.match(app, /diagnosticsBtn\?\.addEventListener\('click'/);
  assert.match(app, /topbarOverflow\.open = false/);
  assert.doesNotMatch(html, /class="topbar-actions"[^]*id="diagnosticsBtn"[^]*<details id="topbarOverflow"/);
});

test('diagnostics UI supports log filtering, verbose mode and bundle download', () => {
  assert.match(html, /id="diagnosticsLevel"/);
  assert.match(html, /id="diagnosticsSearch"/);
  assert.match(html, /id="diagnosticsVerboseBtn"/);
  assert.match(html, /id="diagnosticsBundleBtn"/);
  assert.match(app, /\/api\/diagnostics\?/);
  assert.match(app, /\/api\/diagnostics\/verbose/);
  assert.match(app, /\/api\/diagnostics\/bundle/);
  assert.match(styles, /\.diagnostics-dialog/);
  assert.match(styles, /\.diagnostic-entry/);
});

test('server exposes diagnostic status, verbose and bundle endpoints', () => {
  assert.match(server, /url\.pathname === '\/api\/diagnostics'/);
  assert.match(server, /url\.pathname === '\/api\/diagnostics\/verbose'/);
  assert.match(server, /url\.pathname === '\/api\/diagnostics\/bundle'/);
  assert.match(server, /content-type':'application\/zip'/);
});
