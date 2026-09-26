import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('dashboard uses static printer model artwork instead of live camera snapshots', () => {
  assert.match(app, /data-printer-image-slot/);
  assert.match(app, /function dashboardPrinterImageKey\(printer\)/);
  assert.match(app, /function updateDashboardPrinterImage\(card, printer\)/);
  assert.match(app, /updateDashboardPrinterImage\(card, printer\)/);
  assert.doesNotMatch(app, /\/camera\/snapshot/);
  assert.doesNotMatch(app, /data-camera-slot/);
  assert.doesNotMatch(app, /cameraSnapshotRefreshMs/);
});

test('dashboard has artwork mappings for every currently supported printer model', () => {
  for (const key of [
    'ad5m-pro',
    'creator-5',
    'creator-5-pro',
    'snapmaker-u1',
    'a1-mini',
    'p1p',
    'p1s',
    'x1c'
  ]) {
    assert.match(app, new RegExp(`'${key}'`));
    assert.match(styles, new RegExp(`\\.printer-model-${key}\\b`));
  }
});

test('dashboard printer artwork is theme aware and bundled as a WebP asset', () => {
  assert.match(styles, /printer-models\.webp/);
  assert.match(styles, /\.printer-image-slot[\s\S]*background:linear-gradient\(145deg,#111922,#0b1016\)/);
  assert.match(styles, /:root\[data-theme="light"\] \.printer-image-slot[\s\S]*background:linear-gradient\(145deg,#f7fafc,#e8eff4\)/);
  assert.match(server, /'\.webp': 'image\/webp'/);
  assert.ok(fs.existsSync(new URL('../public/assets/printers/printer-models.webp', import.meta.url)));
});

test('printer details retain the live camera stream and restart controls', () => {
  assert.match(app, /function detailCameraMarkup\(printer\)/);
  assert.match(app, /\/camera\/stream/);
  assert.match(app, /class="detail-camera"/);
  assert.match(app, /data-camera-open/);
  assert.match(app, /Restart camera/);
});
