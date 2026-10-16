import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('Snapmaker U1 filament configuration button uses the shared label and retains its primary styling', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const buttonMarkup = app.split('\n').find((line) => line.includes('data-u1-filament-config-save='));
  assert.ok(buttonMarkup, 'U1 filament configuration button must remain present');
  assert.match(buttonMarkup, /<button type="button" class="primary toolhead-action-button"/);
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
  assert.match(markup, /<button type="button" class="primary toolhead-action-button" data-prusa-tool-material-save=/);
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
  assert.match(css, /\.prusa-tool-filament-control > button \{ grid-column:1 \/ -1; height:var\(--button-field-height\)/);
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
    escapeHtml:(value) => String(value),
    filamentColorFamilyOption:() => null,
    filamentTypeSelectMarkup:() => '<select></select>',
    colorFamilyDropdownMarkup:() => '<details></details>'
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
      assert.match(html, new RegExp(`<button type="button" class="primary toolhead-action-button" data-tool-nozzle-save="${toolIndex}">Assign`));
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
  assert.match(creatorHtml, /class="primary toolhead-action-button" data-tool-nozzle-save="0">Assign<\/button>/, 'Creator 5 nozzle Assign matches U1 primary blue');
  assert.doesNotMatch(creatorHtml, /data-tool-nozzle-clear|>Clear<\/button>|Clear makes it unknown/, 'Creator 5 does not offer nozzle Clear');
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
  assert.match(coreHtml, /class="primary toolhead-action-button" data-nozzle-designation-save>Assign<\/button>/);
  assert.doesNotMatch(coreHtml, /data-nozzle-designation-clear|>Clear<\/button>/);
  assert.match(coreHtml, /prusa-nozzle-actions/);
  const flashforge = {
    adapterType:'flashforge-ad5m',
    manufacturer:'FlashForge',
    capabilities:{nozzleDesignation:true}
  };
  const flashforgeHtml = renderNozzle(flashforge, {index:0, nozzleDiameter:0.4});
  assert.match(flashforgeHtml, /class="primary toolhead-action-button" data-nozzle-designation-save>Assign<\/button>/, 'AD5M nozzle button matches U1 primary blue');
  assert.doesNotMatch(flashforgeHtml, /data-nozzle-designation-clear|>Clear<\/button>/, 'AD5M nozzle Clear must be hidden');
});

test('CORE One+ nozzle controls use a single compact action', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.prusa-tool-nozzle-control \.mini-actions,/);
  assert.match(css, /\.prusa-nozzle-actions/);
  assert.match(css, /\.material-panel button\.toolhead-action-button \{/);
});

test('AD5M and AD5M Pro have only Assign buttons for material and nozzle size', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const renderMaterial = loadNozzleMarkupFunction(app, 'flashForgeMaterialDesignationMarkup', 'flashForgeNozzleDesignationMarkup');
  const renderNozzle = loadNozzleMarkupFunction(app, 'flashForgeNozzleDesignationMarkup', 'toolConfigurationMarkup');
  for (const model of ['Adventurer 5M', 'Adventurer 5M Pro']) {
    const printer = {
      adapterType:'flashforge-ad5m',
      manufacturer:'FlashForge',
      model,
      capabilities:{materialDesignation:true, nozzleDesignation:true}
    };
    const materialHtml = renderMaterial(printer, {material:'PLA', materialSource:'manual'});
    assert.match(materialHtml, /class="primary toolhead-action-button" data-material-designation-save>Set filament<\/button>/);
    assert.match(materialHtml, /ad5m-material-actions/);
    assert.doesNotMatch(materialHtml, /data-material-designation-clear|Clear designation|Use printer value/);
    assert.equal((materialHtml.match(/<button\b/g) || []).length, 1, `${model} should have one material action`);

    const nozzleHtml = renderNozzle(printer, {index:0, nozzleDiameter:0.4});
    assert.match(nozzleHtml, /class="primary toolhead-action-button" data-nozzle-designation-save>Assign<\/button>/);
    assert.match(nozzleHtml, /ad5m-nozzle-actions/);
    assert.doesNotMatch(nozzleHtml, /data-nozzle-designation-clear|>Clear<\/button>/);
    assert.equal((nozzleHtml.match(/<button\b/g) || []).length, 1, `${model} should have one nozzle action`);
  }
});

test('AD5M and Creator 5 designation actions use the compact shared size', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.ad5m-material-actions,/);
  assert.match(css, /\.ad5m-nozzle-actions \{/);
  assert.match(css, /\.material-panel button\.toolhead-action-button \{/);
  assert.match(css, /\.creator5-tool-nozzle-control \.mini-actions/);
});

test('Creator 5 and Creator 5 Pro show Set filament for every toolhead, including disabled controls', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function creator5FilamentConfigControlMarkup(');
  const end = app.indexOf('function prusaToolMaterialDesignationMarkup(', start);
  assert.ok(start !== -1 && end > start, 'Creator 5 filament markup function must exist');
  const source = app.slice(start, end);
  const stubs = {
    creator5FilamentMaterialOptions:() => ['PLA', 'PETG'],
    normalizeColor:() => '#ff0000',
    creator5FilamentColorDropdownMarkup:() => '<details></details>',
    multiToolControlHelpMarkup:() => '<small></small>',
    multiToolFilamentHelpText:() => 'help',
    escapeHtml:(value) => String(value)
  };
  const render = runInNewContext(source + '\ncreator5FilamentConfigControlMarkup', stubs);
  for (const model of ['Creator 5', 'Creator 5 Pro']) {
    for (const [state, disabled] of [['idle', false], ['printing', true]]) {
      const printer = {
        adapterType:'flashforge-creator5',
        model,
        capabilities:{filamentTypeControl:true, filamentColorControl:true},
        status:{status:state}
      };
      for (let index = 0; index < 4; index++) {
        const html = render(printer, {index, filament:{material:'PLA', color:'#ff0000'}});
        assert.match(html, new RegExp(`<button type="button" class="primary toolhead-action-button" data-creator5-filament-config-save="${index}"${disabled ? ' disabled' : ''}>Set filament<\\/button>`));
        assert.doesNotMatch(html, /Set on printer/);
        assert.equal((html.match(/<button\b/g) || []).length, 1, 'exactly one filament action per toolhead');
      }
    }
  }
});

test('Creator 5 and Creator 5 Pro nozzle assignment uses a compact primary action and has no Clear', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const renderNozzle = loadNozzleMarkupFunction(app, 'toolNozzleDesignationMarkup', 'flashForgeMaterialDesignationMarkup');
  for (const model of ['Creator 5', 'Creator 5 Pro']) {
    const printer = {
      adapterType:'flashforge-creator5',
      model,
      capabilities:{toolNozzleDesignation:true}
    };
    for (let index = 0; index < 4; index++) {
      const html = renderNozzle(printer, {index, nozzleDiameter:0.4}, 4);
      assert.match(html, new RegExp(`class="primary toolhead-action-button" data-tool-nozzle-save="${index}">Assign<\\/button>`));
      assert.doesNotMatch(html, /data-tool-nozzle-clear|>Clear<\/button>|Clear makes it unknown/);
      assert.match(html, /creator5-tool-nozzle-control/);
      assert.equal((html.match(/<button\b/g) || []).length, 1);
    }
  }
  assert.match(css, /\.creator5-tool-nozzle-control \.mini-actions \{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.material-panel button\.toolhead-action-button \{/);
});

test('All filament Set and nozzle Assign buttons share a compact fixed size instead of stretching to their columns', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const selectors = [
    'u1-filament-config-save',
    'creator5-filament-config-save',
    'prusa-tool-material-save',
    'material-designation-save',
    'tool-nozzle-save',
    'nozzle-designation-save'
  ];
  for (const selector of selectors) {
    const buttonLine = app.split('\n').find((line) => line.includes('data-' + selector) && line.includes('<button'));
    assert.ok(buttonLine, `${selector} must render a button`);
    assert.match(buttonLine, /toolhead-action-button/, `${selector} should share the compact button style`);
  }
  const start = css.indexOf('.material-panel button.toolhead-action-button {');
  const end = css.indexOf('}', start);
  assert.ok(start >= 0 && end > start, 'Shared toolhead action CSS rule exists');
  const rule = css.slice(start, end);
  assert.match(rule, /width:152px;/);
  assert.match(rule, /max-width:100%;/);
  assert.match(rule, /height:var\(--button-field-height\);/);
  assert.match(rule, /min-height:var\(--button-field-height\);/);
  assert.match(rule, /justify-self:start;/);
  assert.doesNotMatch(rule, /(?:^|\s)width:100%;/);
  assert.doesNotMatch(css, /\.prusa-tool-filament-control > button \{[^}]*width:100%/);
  assert.doesNotMatch(css, /\.creator5-tool-nozzle-control \.mini-actions > button \{[^}]*width:100%/);
  assert.doesNotMatch(css, /\.ad5m-(?:material|nozzle)-actions > button \{[^}]*width:100%/);
});

test('All printer toolhead filament type, colour and nozzle dropdowns share one width', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const start = css.indexOf('.material-panel {\n  --toolhead-dropdown-width:160px;');
  const end = css.indexOf('/* Use one compact, consistent type/colour field pair', start);
  assert.ok(start >= 0 && end > start, 'shared dropdown width declaration exists');
  const rule = css.slice(start, end + 2);
  const controls = [
    '.material-panel .u1-filament-config-control select',
    '.material-panel .creator5-filament-config-control select',
    '.material-panel .prusa-tool-filament-control select',
    '.material-panel .material-designation-fields select',
    '.material-panel .nozzle-designation-control select',
    '.material-panel .u1-filament-config-control .color-family-dropdown',
    '.material-panel .creator5-filament-config-control .creator5-color-dropdown',
    '.material-panel .prusa-tool-filament-control .color-family-dropdown',
    '.material-panel .material-designation-fields .color-family-dropdown'
  ];
  for (const selector of controls) {
    assert.ok(rule.includes(selector), `Missing shared sizing rule for ${selector}`);
  }
  assert.match(rule, /width:var\(--toolhead-dropdown-width\);/);
  assert.match(rule, /max-width:100%;/);
  assert.match(rule, /min-width:0;/);
  assert.ok(start > css.indexOf('.material-tool-nozzle .nozzle-designation-control select'),
    'shared width needs to override older column-filling nozzle widths');
});

test('All printer families keep the material and colour selectors adjacent with the same 8px gap', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const configFns = [
    ['u1FilamentConfigControlMarkup', 'creator5FilamentMaterialOptions', 'data-u1-filament-config-save'],
    ['creator5FilamentConfigControlMarkup', 'prusaToolMaterialDesignationMarkup', 'data-creator5-filament-config-save'],
    ['prusaToolMaterialDesignationMarkup', 'printerNozzleDiameterOptions', 'data-prusa-tool-material-save'],
    ['flashForgeMaterialDesignationMarkup', 'flashForgeNozzleDesignationMarkup', 'data-material-designation-save']
  ];
  for (const [name, nextName, action] of configFns) {
    const start = app.indexOf('function ' + name + '(');
    const end = app.indexOf('function ' + nextName + '(', start);
    assert.ok(start >= 0 && end > start, name + ' renderer must exist');
    const markup = app.slice(start, end);
    const pair = markup.indexOf('toolhead-dropdown-pair');
    const button = markup.indexOf(action);
    assert.ok(pair !== -1 && button > pair, name + ' must group selectors before the shared Set filament button');
    assert.match(markup, /<label>Filament type|<label>Controller material type/, name + ' keeps type selector');
    assert.match(markup, /<label>Colour|<label>Controller colour family/, name + ' keeps colour selector');
  }
  assert.match(css, /--toolhead-dropdown-gap:8px;/);
  const start = css.indexOf('.material-panel .toolhead-dropdown-pair {');
  const end = css.indexOf('\n}', start);
  assert.ok(start !== -1 && end > start, 'Shared paired-field CSS should exist');
  const rule = css.slice(start, end + 2);
  assert.match(rule, /grid-column:1 \/ -1;/);
  assert.match(rule, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(rule, /column-gap:var\(--toolhead-dropdown-gap\);/);
  assert.match(rule, /max-width:calc\(var\(--toolhead-dropdown-width\) \+ var\(--toolhead-dropdown-width\) \+ var\(--toolhead-dropdown-gap\)\);/);
  assert.match(css, /@media \(max-width:520px\) \{\s*\.material-panel \.toolhead-dropdown-pair \{\s*grid-template-columns:minmax\(0,1fr\);/);
});

test('AD5M and AD5M Pro nozzle dropdown appears beneath its heading, including while offline', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const renderNozzle = loadNozzleMarkupFunction(app, 'flashForgeNozzleDesignationMarkup', 'toolConfigurationMarkup');
  for (const model of ['Adventurer 5M', 'Adventurer 5M Pro']) {
    for (const online of [false, true]) {
      const printer = {
        adapterType:'flashforge-ad5m',
        manufacturer:'FlashForge',
        model,
        online,
        capabilities:{nozzleDesignation:true}
      };
      const html = renderNozzle(printer, {index:0, nozzleDiameter:0.4});
      assert.match(html, /<label>Controller nozzle designation\s*<select><\/select>\s*<\/label>/);
      assert.match(html, /data-nozzle-designation-save>Assign<\/button>/);
    }
  }
  assert.match(css, /\.material-panel \.nozzle-designation-control > label \{ display:block; \}/);
  assert.match(css, /\.material-panel \.nozzle-designation-control > label > select \{\s*display:block;\s*margin-top:6px;/);
  assert.match(css, /\.material-panel \.nozzle-designation-control select,[\s\S]*width:var\(--toolhead-dropdown-width\);/);
});
