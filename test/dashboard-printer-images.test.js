import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

const printerImageKeys = [
  'ad5m-pro',
  'creator-5',
  'creator-5-pro',
  'snapmaker-u1',
  'a1-mini',
  'p1p',
  'p1s',
  'x1c'
];

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
  for (const key of printerImageKeys) {
    assert.match(app, new RegExp(`'${key}'`));
  }
  assert.match(app, /\/assets\/printers\/\$\{escapeHtml\(imageKey\)\}\.webp/);
});

test('each dashboard printer model has a real bundled WebP asset', () => {
  for (const key of printerImageKeys) {
    const asset = new URL(`../public/assets/printers/${key}.webp`, import.meta.url);
    assert.ok(fs.existsSync(asset), `missing ${key}.webp`);
    const data = fs.readFileSync(asset);
    assert.ok(data.length > 1000, `${key}.webp is unexpectedly small`);
    assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(data.subarray(8, 12).toString('ascii'), 'WEBP');
  }
});

test('dashboard printer artwork is theme aware and uses normal contained images', () => {
  assert.match(app, /class="printer-model-image"/);
  assert.match(styles, /\.printer-model-image[\s\S]*object-fit:contain;[\s\S]*object-position:center;/);
  assert.doesNotMatch(styles, /printer-model-sprite/);
  assert.doesNotMatch(app, /printer-models\.webp/);
  assert.match(styles, /\.printer-image-slot[\s\S]*background:linear-gradient\(145deg,#111922,#0b1016\)/);
  assert.match(styles, /:root\[data-theme="light"\] \.printer-image-slot[\s\S]*background:linear-gradient\(145deg,#f7fafc,#e8eff4\)/);
  assert.match(server, /'\.webp': 'image\/webp'/);
});

test('printer details retain the live camera stream and restart controls', () => {
  assert.match(app, /function detailCameraMarkup\(printer\)/);
  assert.match(app, /\/camera\/stream/);
  assert.match(app, /class="detail-camera"/);
  assert.match(app, /data-camera-open/);
  assert.match(app, /Restart camera/);
});
