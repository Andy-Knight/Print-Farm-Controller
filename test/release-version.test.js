import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

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
