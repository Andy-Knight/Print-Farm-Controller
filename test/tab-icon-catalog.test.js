import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/tab-navigation.css', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../docs/CONTROLLER_VISUAL_STYLE_GUIDE.md', import.meta.url), 'utf8');
const catalogue = readFileSync(new URL('../docs/assets/controller-tab-icon-catalog.svg', import.meta.url), 'utf8');

test('tab icon catalogue depicts every deployed SVG mask with identical geometry', () => {
  const rules = [...css.matchAll(/\[data-pfc-icon="([^"]+)"\]::before\s*\{([\s\S]*?)\n\}/g)];
  const illustrated = [...catalogue.matchAll(/<svg data-production-icon="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/g)];
  assert.equal(rules.length,17,'verify the documented number when adding/removing tab icons');
  assert.equal(illustrated.length,rules.length,'every deployed tab icon must be shown');
  const artwork = new Map(illustrated.map(([,name,geometry])=>[name,geometry]));
  assert.equal(artwork.size,rules.length,'all production icon labels must be unique');
  for (const [,name,body] of rules) {
    const webkit=body.match(/-webkit-mask-image:url\("data:image\/svg\+xml,([^"]+)"\)/);
    const standard=body.match(/(?:^|\n)\s*mask-image:url\("data:image\/svg\+xml,([^"]+)"\)/);
    assert.ok(webkit && standard,'both mask declarations required for '+name);
    assert.equal(webkit[1],standard[1],name+' has diverging CSS masks');
    const original=decodeURIComponent(standard[1])
      .replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
    assert.equal(artwork.get(name),original,'reference SVG geometry out of date for '+name);
    assert.ok(guide.includes('| '+String.fromCharCode(96)+name+String.fromCharCode(96)+' |'),
      'missing deployed icon usage row: '+name);
  }
});

test('tab icon proposals are documented and separate from deployed glyphs', () => {
  const deployed=[...catalogue.matchAll(/data-production-icon="([^"]+)"/g)].map(x=>x[1]);
  const proposed=[...catalogue.matchAll(/data-proposed-tab-icon="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(proposed.length,12);
  assert.equal(new Set(proposed).size,12);
  for(const name of proposed) {
    assert.ok(!deployed.includes(name),name+' must not be listed as deployed');
    assert.ok(guide.includes('| '+String.fromCharCode(96)+name+String.fromCharCode(96)+' |'),
      'missing proposal description: '+name);
  }
  assert.match(guide,/Management has no .*icon.* field assigned/);
  assert.match(guide,/Preact and the static HTML fallback/);
  assert.match(guide,/assets\/controller-tab-icon-catalog\.svg/);
});
