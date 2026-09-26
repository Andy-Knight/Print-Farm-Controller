import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('dashboard filament swatches use existing live filament state', () => {
  assert.match(app, /const MAX_DASHBOARD_FILAMENT_SWATCHES = 4/);
  assert.match(app, /function dashboardFilamentSources\(printer\)/);
  assert.match(app, /status\.materialSources/);
  assert.match(app, /Array\.isArray\(status\.tools\)/);
  assert.match(app, /materialSwatchColor\(source\)/);
  assert.match(app, /materialSwatchColor\(filament\)/);
  assert.match(app, /Controller assigned/);
  assert.match(app, /RFID detected/);
  assert.match(app, /Printer reported/);
});

test('dashboard filament swatches are overlaid without changing card height', () => {
  assert.match(app, /updateDashboardPrinterImage\(card, printer\);\s*updateDashboardFilamentOverlay\(card, printer\);/);
  assert.match(app, /dashboard-filament-overlay hidden/);
  assert.match(app, /dashboard-filament-swatch/);
  assert.match(app, /dashboard-filament-more/);
  assert.match(styles, /\.dashboard-filament-overlay\s*\{[\s\S]*position:absolute/);
  assert.match(styles, /\.dashboard-filament-overlay\s*\{[\s\S]*bottom:10px/);
  assert.match(styles, /\.dashboard-filament-swatch\s*\{[\s\S]*width:16px/);
  assert.match(styles, /\.dashboard-filament-swatch\s*\{[\s\S]*height:16px/);
  assert.match(styles, /\.dashboard-filament-swatch\s*\{[\s\S]*border-radius:50%/);
  assert.match(styles, /\.printer-image-slot\s*\{[\s\S]*height:190px/);
});

test('dashboard filament overlay limits crowded multi-source printers', () => {
  assert.match(app, /sources\.slice\(0, MAX_DASHBOARD_FILAMENT_SWATCHES\)/);
  assert.match(app, /sources\.length - visible\.length/);
  assert.match(app, /\+\$\{extra\}/);
  assert.match(app, /more loaded filament source/);
});

test('dashboard filament overlay supports light and dark themes', () => {
  assert.match(styles, /background:rgba\(7,11,15,\.74\)/);
  assert.match(styles, /:root\[data-theme="light"\] \.dashboard-filament-overlay/);
  assert.match(styles, /:root\[data-theme="light"\] \.dashboard-filament-swatch/);
  assert.match(styles, /:root\[data-theme="light"\] \.dashboard-filament-more/);
});
