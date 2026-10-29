import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/shell.css', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

const helperStart = app.indexOf('function updateSidebarCountBadge(');
const helperEnd = app.indexOf('\n}', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'sidebar count formatter must exist');
const setCount = vm.runInNewContext(
  app.slice(helperStart, helperEnd + 2) + '\nupdateSidebarCountBadge'
);

function counter() {
  const classes = new Set(['hidden']);
  return {
    textContent: '',
    title: '',
    classList: {
      toggle(name, yes) { if (yes) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
}

test('navigation uses one shared 48x24 fixed-size tabular-numeral badge for both counters', () => {
  for (const id of ['queueButtonCount', 'libraryButtonCount']) {
    assert.match(index,new RegExp('id="'+id+'" class="queue-button-count hidden"'));
  }
  const selector='.sidebar-nav .sidebar-item > .queue-button-count {';
  assert.ok(shell.includes(selector),'badge sizing belongs to the shell stylesheet');
  const css=shell.split(selector)[1]?.split('}')[0] || '';
  assert.match(css,/display:inline-grid;/);
  assert.match(css,/place-items:center;/);
  assert.match(css,/flex:0 0 48px;/);
  assert.match(css,/width:48px;/);
  assert.match(css,/min-width:48px;/);
  assert.match(css,/max-width:48px;/);
  assert.match(css,/height:24px;/);
  assert.match(css,/padding:0;/);
  assert.match(css,/margin-left:auto;/);
  assert.match(css,/font-variant-numeric:tabular-nums;/);
  assert.match(css,/border-radius:var\(--ds-radius-pill,999px\)/);
  assert.match(styles,/\.queue-button-count\s*\{[^}]*background:#dbe5ed/,
    'retain the established neutral pill colour');
});

test('sidebar badge values 1–999 fit in the same pill, zero hides, and 999+ preserves the exact count', () => {
  const queue=counter();
  const library=counter();
  for (const value of [1,7,19,125,999]) {
    setCount(queue,value,'outstanding queue items');
    setCount(library,value,'print library files');
    assert.equal(queue.textContent,String(value));
    assert.equal(library.textContent,String(value));
    assert.equal(queue.classList.contains('hidden'),false);
    assert.equal(library.classList.contains('hidden'),false);
    assert.equal(queue.title,'');
    assert.equal(library.title,'');
  }
  setCount(queue,0,'outstanding queue items');
  assert.equal(queue.classList.contains('hidden'),true);
  setCount(queue,1000,'outstanding queue items');
  setCount(library,1502,'print library files');
  assert.equal(queue.textContent,'999+');
  assert.equal(library.textContent,'999+');
  assert.equal(queue.title,'1000 outstanding queue items');
  assert.equal(library.title,'1502 print library files');
  assert.equal(queue.classList.contains('hidden'),false);
  setCount(null,999,'ignored');
  assert.match(app,/updateSidebarCountBadge\(queueButtonCount, outstanding, 'outstanding queue items'\)/);
  assert.match(app,/updateSidebarCountBadge\(libraryButtonCount, files\.length, 'print library files'\)/);
});
