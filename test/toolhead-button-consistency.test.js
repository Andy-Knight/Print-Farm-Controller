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

test('Prusa CORE One+ applies filament type and colour together using the U1-style Set filament button', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function prusaToolMaterialDesignationMarkup(');
  const end = app.indexOf('\nfunction printerNozzleDiameterOptions(', start);
  assert.ok(start !== -1 && end > start, 'Prusa filament control renderer is present');
  const markup = app.slice(start, end);

  assert.match(markup, /<label>Filament type/);
  assert.match(markup, /<label>Colour family/);
  assert.match(markup, /data-prusa-tool-material-input/);
  assert.match(markup, /data-prusa-tool-color-family-input/);
  assert.match(markup, /<button type="button" class="primary" data-prusa-tool-material-save=/);
  assert.match(markup, />Set filament<\/button>/);
  assert.doesNotMatch(markup, /Assign T\$\{tool\.index\}/);
  assert.doesNotMatch(markup, /Clear assignment|Reset filament assignment|prusa-filament-reset|data-prusa-tool-material-clear/);
  assert.equal((markup.match(/<button\b/g) || []).length, 1, 'only one filament action per toolhead');
  assert.match(markup, /not on the Prusa printer/);
  assert.equal((markup.match(/data-prusa-tool-material-save=/g) || []).length, 1);
});

test('CORE One+ saves material and colour in one controller designation request without a clear handler', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf("printerDetail.querySelectorAll('[data-prusa-tool-material-save]')");
  const end = app.indexOf("printerDetail.querySelectorAll('[data-tool-nozzle-save]')", start);
  assert.ok(start !== -1 && end > start, 'Prusa designation handlers are present');
  const handlers = app.slice(start, end);

  assert.match(handlers, /const toolIndex = Number\(button\.dataset\.prusaToolMaterialSave\)/);
  assert.match(handlers, /if \(!material\).*Choose a filament type/);
  assert.match(handlers, /if \(!colorOption\).*Choose a filament colour family/);
  assert.match(handlers, /method:'POST'/);
  assert.match(handlers, /body:JSON\.stringify\(\{ toolIndex, material, colorFamily, color:colorOption\.representative \}\)/);
  assert.doesNotMatch(handlers, /data-prusa-tool-material-clear|prusaToolMaterialClear|method:'DELETE'/);
});

test('CORE One+ primary filament button matches U1 dimensions without reset controls', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.u1-filament-config-control button \{ grid-column:1 \/ -1; height:var\(--button-field-height\)/);
  assert.match(css, /\.prusa-tool-filament-control > button \{ grid-column:1 \/ -1; width:100%; height:var\(--button-field-height\)/);
  assert.doesNotMatch(css, /prusa-filament-reset/);
  assert.doesNotMatch(css, /\.prusa-tool-filament-control \.mini-actions \{/);
});
