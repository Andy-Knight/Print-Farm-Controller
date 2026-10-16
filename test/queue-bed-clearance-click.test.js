import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

// The former queue pointerdown/click source-pattern assertions were replaced
// by executable production-handler coverage in queue-bed-clearance-behavior.test.js
// and by Chromium's real bed-clearance POST test in scripts/browser-regression.mjs.
// Retain the separate dashboard-card cancellation contract until a matching
// browser interaction scenario is added.

test('dashboard bed-cleared button is re-enabled when confirmation is cancelled', () => {
  assert.match(app, /confirmBedCleared\(card\.dataset\.printerCard, printer\?\.name\)[\s\S]*\.then\(\(confirmed\) => \{ if \(!confirmed\) bedCleared\.disabled = false; \}\)/);
});
