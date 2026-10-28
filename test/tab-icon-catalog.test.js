import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../public/tab-navigation.css');
const guide = read('../docs/CONTROLLER_VISUAL_STYLE_GUIDE.md');
const catalogueUrl = new URL('../docs/assets/controller-tab-icon-catalog.svg', import.meta.url);
// GitHub source ZIPs intentionally omit optional documentation artwork.
const catalogue = existsSync(catalogueUrl) ? readFileSync(catalogueUrl, 'utf8') : null;
const artworkOptions = { skip: catalogue === null ? 'Optional docs/assets artwork excluded from source archive' : false };
const rules = [...css.matchAll(/\[data-pfc-icon="([^"]+)"\]::before\s*\{([\s\S]*?)\r?\n\}/g)];
const deployedSection = guide.split('#### Deployed icon inventory and actual tab usage')[1]?.split('**Implementation details:**')[0] || '';
const proposedSection = guide.split('#### Matching ideas for new tab icons (not implemented)')[1]?.split('**Adoption rule:**')[0] || '';
const rowNames = section => [...section.matchAll(/^\| `([^`]+)` \|/gm)]
  .map(match => match[1]).filter(name => name !== 'data-pfc-icon');

test('documented tab inventory matches every deployed CSS mask, including Security & users', () => {
  const names = rules.map(([, name]) => name);
  assert.equal(names.length, 18, 'review the documented count when adding/removing tab masks');
  assert.equal(new Set(names).size, names.length, 'CSS icon IDs must be unique');
  assert.deepEqual(rowNames(deployedSection).sort(), [...names].sort());
  for (const [, name, body] of rules) {
    const webkit = body.match(/-webkit-mask-image:url\("data:image\/svg\+xml,([^"]+)"\)/);
    const standard = body.match(/(?:^|\n)\s*mask-image:url\("data:image\/svg\+xml,([^"]+)"\)/);
    assert.ok(webkit && standard, 'both mask declarations required for ' + name);
    assert.equal(webkit[1], standard[1], name + ' has diverging CSS masks');
  }
  const html = read('../public/index.html');
  assert.match(html, /id="authTabUsers"[^>]*data-pfc-icon="users"/);
  assert.match(html, /id="authTabHttps"[^>]*data-pfc-icon="server"/);
  assert.match(deployedSection, /`users`.*Security & users → Users/);
  assert.match(deployedSection, /`server`.*Security & users → Connection settings/);
  const management = read('../ui/printer-details.jsx').match(/\{ key:'management'[^}]*\}/)?.[0];
  assert.ok(management, 'Management Preact tab must exist');
  assert.doesNotMatch(management, /icon:/);
  assert.match(read('../public/app.js'), /data-detail-tab="management" data-pfc-icon="wrench"/);
  assert.match(guide, /Management has no .*icon.* field assigned/);
  assert.match(guide, /no-bundle fallback in `public\/app.js` does render the wrench/);
});

test('tab icon proposals remain documented separately from deployed glyphs', () => {
  const proposed = rowNames(proposedSection);
  const deployed = new Set(rules.map(([, name]) => name));
  assert.equal(proposed.length, 12);
  assert.equal(new Set(proposed).size, proposed.length);
  for (const name of proposed) assert.ok(!deployed.has(name), name + ' must remain a proposal');
  assert.match(guide, /Preact and the static HTML fallback/);
  assert.match(guide, /assets\/controller-tab-icon-catalog\.svg/);
});

test('tab icon artwork reproduces every deployed CSS mask at both illustrated sizes', artworkOptions, () => {
  const illustrated = [...catalogue.matchAll(/<svg data-production-icon="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/g)];
  assert.deepEqual(illustrated.map(([, name]) => name).sort(), rules.map(([, name]) => name).sort());
  for (const [, name, body] of rules) {
    const encoded = body.match(/(?:^|\n)\s*mask-image:url\("data:image\/svg\+xml,([^"]+)"\)/)[1];
    const geometry = decodeURIComponent(encoded).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const artwork = illustrated.find(([, id]) => id === name);
    assert.equal(artwork[2], geometry, name + ' enlarged artwork differs from CSS');
    const small = catalogue.slice(artwork.index + artwork[0].length).match(/^<svg[^>]*width="17"[^>]*>([\s\S]*?)<\/svg>/);
    assert.equal(small?.[1], geometry, name + ' runtime-size artwork differs from CSS');
  }
});

test('tab icon artwork proposals match the documented proposal inventory', artworkOptions, () => {
  const proposed = [...catalogue.matchAll(/data-proposed-tab-icon="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(proposed.sort(), rowNames(proposedSection).sort());
});
