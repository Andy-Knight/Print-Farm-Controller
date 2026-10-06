import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('dialogs keep scrollbars inside rounded corners', () => {
  assert.match(styles, /dialog\s*\{[\s\S]*max-height:calc\(100vh - 30px\);[\s\S]*overflow:hidden;[\s\S]*border-radius:18px;/);
  assert.match(styles, /dialog\s*>\s*:first-child\s*\{[\s\S]*max-height:calc\(100vh - 32px\);[\s\S]*overflow:auto;[\s\S]*border-radius:17px;/);
});
