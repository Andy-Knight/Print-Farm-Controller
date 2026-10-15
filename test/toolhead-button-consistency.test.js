import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

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

function loadNozzleMarkupFunction(app, startName, nextName) {
  const start = app.indexOf('function ' + startName + '(');
  const end = app.indexOf('function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, `Could not extract ${startName}`);
  const helpers = {
    printerNozzleDiameterOptions:() => [0.4, 0.6],
    nozzleDiameterText:(value) => `${value} mm nozzle`,
    nozzleDiameterSelectMarkup:() => '<select></select>',
    multiToolNozzleHelpText:(value) => value,
    multiToolControlHelpMarkup:(value) => `<small>${value}</small>`,
    escapeHtml:(value) => String(value)
  };
  return runInNewContext(app.slice(start, end) + '\n' + startName, helpers);
}

test('CORE One+ INDX4 and INDX8 show Assign without Clear on every nozzle', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const renderNozzle = loadNozzleMarkupFunction(app, 'toolNozzleDesignationMarkup', 'flashForgeMaterialDesignationMarkup');
  const coreOnePlus = {
    adapterType:'prusa-core-one-plus',
    manufacturer:'Prusa',
    capabilities:{ toolNozzleDesignation:true }
  };
  for (const count of [4, 8]) {
    for (let toolIndex = 0; toolIndex < count; toolIndex++) {
      const html = renderNozzle(coreOnePlus, {index:toolIndex, nozzleDiameter:0.4}, count);
      assert.match(html, new RegExp(`data-tool-nozzle-save="${toolIndex}"\x3eAssign`));
      assert.doesNotMatch(html, /data-tool-nozzle-clear|>Clear<|Clear makes it unknown/);
      assert.match(html, /prusa-tool-nozzle-control/);
    }
  }
  const creator5 = {
    adapterType:'flashforge-creator5',
    manufacturer:'FlashForge',
    capabilities:{toolNozzleDesignation:true}
  };
  const creatorHtml = renderNozzle(creator5, {index:0, nozzleDiameter:0.4}, 4);
  assert.match(creatorHtml, /data-tool-nozzle-clear="0">Clear<\/button>/, 'Creator 5 Clear remains available');
});

test('CORE One+ Standard shows Assign without Clear on the single nozzle designation', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const renderNozzle = loadNozzleMarkupFunction(app, 'flashForgeNozzleDesignationMarkup', 'toolConfigurationMarkup');
  const coreOnePlus = {
    adapterType:'prusa-core-one-plus',
    manufacturer:'Prusa',
    capabilities:{nozzleDesignation:true}
  };
  const coreHtml = renderNozzle(coreOnePlus, {index:0, nozzleDiameter:0.4});
  assert.match(coreHtml, /data-nozzle-designation-save>Assign<\/button>/);
  assert.doesNotMatch(coreHtml, /data-nozzle-designation-clear|>Clear<\/button>/);
  assert.match(coreHtml, /prusa-nozzle-actions/);
  const flashforge = {
    adapterType:'flashforge-ad5m',
    manufacturer:'FlashForge',
    capabilities:{nozzleDesignation:true}
  };
  const flashforgeHtml = renderNozzle(flashforge, {index:0, nozzleDiameter:0.4});
  assert.match(flashforgeHtml, /data-nozzle-designation-clear>Clear<\/button>/, 'FlashForge Clear remains available');
});

test('CORE One+ nozzle controls use the full-width single button style', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.prusa-tool-nozzle-control \.mini-actions,/);
  assert.match(css, /\.prusa-nozzle-actions/);
  assert.match(css, /\.prusa-tool-nozzle-control \.mini-actions > button,/);
  assert.match(css, /\.prusa-nozzle-actions > button \{/);
});
