import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const profiles = fs.readFileSync(new URL('../emulator/profiles.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../emulator/public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../emulator/public/app.js', import.meta.url), 'utf8');

test('CORE One+ simulator uses one profile with selectable 1, 4 and 8 tool configurations', () => {
  assert.equal((profiles.match(/'prusa-core-one-plus':/g) || []).length, 1);
  assert.doesNotMatch(profiles, /prusa-core-one-plus-indx-(?:4|8)/);
  assert.match(profiles, /Standard · 1 tool/);
  assert.match(profiles, /INDX · 4 tools/);
  assert.match(profiles, /INDX · 8 tools/);

  assert.match(index, /id="add-tool-configuration"/);
  assert.match(index, /id="add-tool-count" name="toolCount"/);
  assert.match(index, /class="tool-configuration-select"/);

  assert.match(app, /function updateAddToolConfiguration/);
  assert.match(app, /toolCount:Number\(event\.target\.value\)/);
  assert.match(app, /printer\.toolConfigurations/);
  new vm.Script(app);
});
