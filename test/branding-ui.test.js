import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('Stacked Layers branding is applied to the controller header', () => {
  assert.match(index, /Stacked Layers — Print Farm Controller/);
  assert.match(index, /class="brand-lockup"/);
  assert.match(index, /class="stacked-layers-mark"/);
  assert.match(index, />STACKED LAYERS<\/div>/);
  assert.match(index, />Print Farm Controller<\/div>/);
  assert.match(styles, /\.brand-lockup/);
  assert.match(styles, /\.stacked-layers-mark/);
  assert.match(styles, /:root\[data-theme="light"\] \.brand-lockup/);
});

test('existing embedded favicon remains present', () => {
  assert.match(index, /<link rel="icon" type="image\/png" sizes="16x16" href="data:image\/png;base64,/);
  assert.match(index, /<link rel="icon" type="image\/png" sizes="32x32" href="data:image\/png;base64,/);
});
