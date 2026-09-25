import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

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

test('virtual printer list detects already configured simulator devices', () => {
  assert.match(app, /function virtualPrinterAlreadyAdded\(/);
  assert.match(app, /printer\.simulated !== true/);
  assert.match(app, /'flashforge-creator5':\['httpPort'\]/);
});
