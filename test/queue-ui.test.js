import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('Queue file action keeps its label on one line at the standard button height', () => {
  assert.match(index, /id="queueAddFileBtn"[^>]*class="primary"[^>]*>\+ Queue file<\/button>/);
  assert.match(styles, /#queueAddFileBtn\s*\{[^}]*flex\s*:\s*0 0 auto;[^}]*white-space\s*:\s*nowrap;[^}]*\}/);
  assert.match(styles, /\.primary,\.secondary,\.danger\s*\{[^}]*height\s*:\s*var\(--button-field-height\);/);
});
