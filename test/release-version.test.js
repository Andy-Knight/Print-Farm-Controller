import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('README, changelog and project context agree with the package release version', () => {
  const pkg = JSON.parse(read('package.json'));
  const readme = read('README.md');
  const changelog = read('CHANGELOG.md');
  const context = read('PROJECT_CONTEXT.md');
  const version = pkg.version;

  assert.match(version, /^\d+\.\d+\.\d+$/, 'package version should be semantic');
  assert.ok(readme.startsWith('# Print Farm Controller v' + version + '\n'), 'README headline must match package version');
  assert.ok(readme.includes('**Current development version: v' + version + '**'), 'README current version must match package version');
  assert.match(changelog, /^# Changelog[\s\S]*?## v(\d+\.\d+\.\d+)/);
  const firstRelease = changelog.match(/^## v(\d+\.\d+\.\d+)/m);
  assert.equal(firstRelease?.[1], version, 'most recent changelog entry must match package version');
  assert.ok(context.includes('- Current controller source version: **' + version + '**'),
    'project handoff current source version must exactly match the package version');
});

test('README documents current capabilities instead of per-version release notes', () => {
  const pkg = JSON.parse(read('package.json'));
  const readme = read('README.md');
  const section = readme.split(/^## Key capabilities\s*$/m)[1]?.split(/^## /m)[0] || '';
  const bullets = section.match(/^- /gm) || [];

  assert.ok(bullets.length >= 5 && bullets.length <= 10,
    'README overview should remain a short, stable list of capabilities');
  const otherVersionReferences = readme
    .replace('# Print Farm Controller v' + pkg.version, '')
    .replace('**Current development version: v' + pkg.version + '**', '');
  assert.doesNotMatch(otherVersionReferences, /\bv\d+\.\d+\.\d+\b/,
    'historical version details belong in CHANGELOG.md, not README.md');
  assert.match(readme, /\[CHANGELOG\.md\]\(CHANGELOG\.md\)/);
});
