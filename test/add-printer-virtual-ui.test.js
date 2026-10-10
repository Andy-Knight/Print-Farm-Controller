import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('Add Printer dialog exposes running virtual printers separately from LAN discovery', () => {
  assert.match(index, /id="virtualPrinterStatus"/);
  assert.match(index, /id="virtualPrinterResults"/);
  assert.match(index, /id="refreshVirtualPrintersBtn"/);
  assert.match(index, /id="openSimulatorBtn"/);
  assert.match(index, /Add a running printer from the integrated simulator without entering connection details manually/);
});

test('virtual printer registration uses simulator-provided controller settings directly', () => {
  assert.match(app, /api\('\/api\/emulator\/status'\)/);
  assert.match(app, /api\('\/api\/emulator\/printers'\)/);
  assert.match(app, /const settings = printer\?\.controllerSettings/);
  assert.match(app, /data-add-virtual-printer/);
  assert.match(app, /api\('\/api\/printers', \{ method:'POST', body:JSON\.stringify\(settings\) \}\)/);
});

test('virtual printer list detects already configured simulator devices by endpoint identity', () => {
  assert.match(app, /function virtualPrinterAlreadyAdded\(/);
  const start = app.indexOf('function virtualPrinterAlreadyAdded');
  const end = app.indexOf('function virtualPrinterPortSummary', start);
  const helper = app.slice(start, end);
  assert.doesNotMatch(helper, /printer\.simulated !== true/);
  assert.match(helper, /'flashforge-creator5':\['httpPort'\]/);
  assert.match(helper, /virtualPrinter\?\.protocol === 'prusalink'/);
  assert.match(helper, /Number\(printer\[name\]\) === Number\(settings\[name\]\)/);
});

test('Scan LAN action keeps its label on one line at the standard button height', () => {
  assert.match(index, /id="scanNetworkBtn"[^>]*class="secondary"[^>]*>Scan LAN<\/button>/);
  assert.match(styles, /#scanNetworkBtn\s*\{[^}]*flex\s*:\s*0 0 auto;[^}]*white-space\s*:\s*nowrap;[^}]*\}/);
  assert.match(styles, /\.primary,\.secondary,\.positive,\.attention,\.danger\s*\{[^}]*height\s*:\s*var\(--button-field-height\);/);
});
