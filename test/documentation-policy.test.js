import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const fileUrl = path => new URL(path, root);
const read = path => readFileSync(fileUrl(path), 'utf8');

test('all canonical documentation and agent instruction files exist', () => {
  const paths = [
    'AGENTS.md', 'README.md', 'CHANGELOG.md', 'PROJECT_CONTEXT.md',
    'docs/DOCUMENTATION_POLICY.md',
    'docs/CONTROLLER_VISUAL_STYLE_GUIDE.md', 'docs/DESIGN_SYSTEM.md'
  ];
  for (const path of paths) assert.ok(existsSync(fileUrl(path)), path + ' must exist');

  const agent = read('AGENTS.md');
  for (const path of [
    'PROJECT_CONTEXT.md', 'docs/DOCUMENTATION_POLICY.md',
    'docs/CONTROLLER_VISUAL_STYLE_GUIDE.md',
    'README.md', 'CHANGELOG.md'
  ]) assert.ok(agent.includes(path), 'AGENTS.md must link to ' + path);
  assert.match(agent, /Start of every task/i);
  assert.match(read('docs/DOCUMENTATION_POLICY.md'), /ChatGPT Project/i);
});

test('GitHub ZIP/source archives retain the source and docs that npm test requires', () => {
  const attrs = read('.gitattributes');
  const excluded = attrs.split(/\r?\n/)
    .map(line => line.replace(/#.*/, '').trim())
    .filter(line => /(?:^|\s)export-ignore(?:\s|$)/.test(line))
    .map(line => line.split(/\s+/)[0]);
  assert.deepEqual(excluded, ['/docs/assets/'],
    'do not exclude project policy, docs, .npmrc or CI files used by local tests from GitHub ZIP');
  assert.ok(!excluded.includes('/docs/'));
});

test('README is an evergreen concise overview and not a release history', () => {
  const pkg = JSON.parse(read('package.json'));
  const readme = read('README.md');
  const section = readme.split(/^## Key capabilities\s*$/m)[1]?.split(/^## /m)[0] || '';
  const bullets = section.match(/^- /gm) || [];
  assert.ok(bullets.length >= 5 && bullets.length <= 10,
    'README should have 5–10 enduring product capability highlights');
  assert.match(readme, /\[CHANGELOG\.md\]\(CHANGELOG\.md\)/);
  assert.match(readme, /\[AGENTS\.md\]\(AGENTS\.md\)/);
  assert.match(readme, /\[Documentation policy\]\(docs\/DOCUMENTATION_POLICY\.md\)/);
  const aside = readme
    .replace('# Print Farm Controller v' + pkg.version, '')
    .replace('**Current development version: v' + pkg.version + '**', '');
  assert.doesNotMatch(aside, /\bv\d+\.\d+\.\d+\b/,
    'README may display current version but historical releases belong in CHANGELOG.md');
  assert.doesNotMatch(readme, /^## (Changelog|Release (?:notes|history)|Version history)\b/im);
});

test('CHANGELOG owns releases and PROJECT_CONTEXT remains a live handoff', () => {
  const pkg = JSON.parse(read('package.json'));
  const changelog = read('CHANGELOG.md');
  const context = read('PROJECT_CONTEXT.md');
  assert.match(changelog, /^# Changelog\b/m);
  const entries = [...changelog.matchAll(/^## v(\d+\.\d+\.\d+)\s*$/gm)];
  assert.ok(entries.length >= 2, 'CHANGELOG retains the version history');
  assert.equal(entries[0][1], pkg.version, 'latest CHANGELOG entry matches package.json');

  assert.ok(context.includes('- Current controller source version: **' + pkg.version + '**'));
  assert.match(context, /AGENTS\.md/);
  assert.match(context, /docs\/DOCUMENTATION_POLICY\.md/);
  const work = context.split(/^## Current work\s*$/m)[1]?.split(/^## /m)[0] || '';
  assert.ok(work.length > 0 && work.length < 2500,
    'current work should be a short, actively maintained handoff rather than a release diary');
  assert.doesNotMatch(work, /^\*\*v\d+\.\d+\.\d+/gm);
});

test('visual style has one canonical owner', () => {
  const policy = read('docs/DOCUMENTATION_POLICY.md');
  const guide = read('docs/CONTROLLER_VISUAL_STYLE_GUIDE.md');
  assert.match(policy, /docs\/CONTROLLER_VISUAL_STYLE_GUIDE\.md/);
  assert.match(policy, /docs\/DESIGN_SYSTEM\.md/);
  assert.match(guide, /Shared table standard/i);
  assert.match(guide, /Icon system/i);
});
