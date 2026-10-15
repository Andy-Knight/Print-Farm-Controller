import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Snapmaker U1 filament configuration button uses the shared label and retains its primary styling', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const buttonMarkup = app.split('\n').find((line) => line.includes('data-u1-filament-config-save='));
  assert.ok(buttonMarkup, 'U1 filament configuration button must remain present');
  assert.match(buttonMarkup, /<button type="button" class="primary"/);
  assert.match(buttonMarkup, />Set filament<\/button>/);
  assert.doesNotMatch(buttonMarkup, /Set filament on U1/);
});
