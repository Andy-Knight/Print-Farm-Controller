import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('queue rendering is deferred while a queue control pointer interaction is active', () => {
  assert.match(app, /let queuePointerInteractionActive = false/);
  assert.match(app, /let queueRenderPending = false/);
  assert.match(app, /function beginQueuePointerInteraction\(event\)/);
  assert.match(app, /queueActiveList\?\.addEventListener\('pointerdown', beginQueuePointerInteraction, true\)/);
  assert.match(app, /document\.addEventListener\('pointerup', releaseQueuePointerInteraction, true\)/);
  assert.match(app, /if \(queuePointerInteractionActive\) \{[\s\S]*queueRenderPending = true;[\s\S]*\} else \{[\s\S]*queueActiveList\.innerHTML = nextActiveMarkup/);
  assert.match(app, /if \(queueRenderPending\) renderPrintQueue\(\)/);
});

test('bed-cleared action remains single-shot during live refreshes and recovers after cancellation', () => {
  assert.match(app, /const pendingBedClearanceActions = new Set\(\)/);
  assert.match(app, /pendingBedClearanceActions\.has\(item\.printerId\)/);
  assert.match(app, /Continuing…/);
  assert.match(app, /if \(!item \|\| pendingBedClearanceActions\.has\(item\.printerId\)\) return/);
  assert.match(app, /pendingBedClearanceActions\.add\(item\.printerId\)/);
  assert.match(app, /const confirmed = await confirmBedCleared\(item\.printerId, item\.printerName\)/);
  assert.match(app, /if \(!confirmed\) \{[\s\S]*cleared\.disabled = false;[\s\S]*cleared\.textContent = 'Bed cleared · continue'/);
});

test('dashboard bed-cleared button is re-enabled when confirmation is cancelled', () => {
  assert.match(app, /confirmBedCleared\(card\.dataset\.printerCard, printer\?\.name\)[\s\S]*\.then\(\(confirmed\) => \{ if \(!confirmed\) bedCleared\.disabled = false; \}\)/);
});
