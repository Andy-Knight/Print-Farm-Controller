import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');

test('dependency versions and lockfile align with the approved npm 12 baseline', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.packageManager, 'npm@12.2.0');
  assert.match(pkg.engines.node, /24\.22\.1/);
  assert.equal(pkg.engines.npm, '>=12.2.0 <13');
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].engines, pkg.engines);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.equal(lock.packages['node_modules/' + name]?.version, version);
  }
  assert.deepEqual(pkg.allowScripts, { 'esbuild@0.28.2': true });
});

test('repository dependency rules retain age gate and explicit supply-chain controls', t => {
  const config = read('.npmrc');
  assert.match(config, /^min-release-age=7$/m);
  assert.match(config, /^allow-git=none$/m);
  assert.match(config, /^allow-remote=none$/m);

  // GitHub metadata is not required in distributed source/Windows installations.
  // A CI checkout must include it so this check cannot silently disappear.
  const dependabotPath = new URL('.github/dependabot.yml', root);
  if (!existsSync(dependabotPath)) {
    if (process.env.GITHUB_ACTIONS) {
      assert.fail('GitHub Actions checkout must include .github/dependabot.yml');
    }
    t.diagnostic('Skipping GitHub-only Dependabot config check outside repository checkout');
    return;
  }

  const dependabot = read('.github/dependabot.yml');
  for (const kind of ['npm', 'docker', 'github-actions']) {
    assert.ok(dependabot.includes('package-ecosystem: "' + kind + '"'));
  }
  const dockerUpdates = dependabot.split('package-ecosystem: "docker"')[1]
    ?.split('package-ecosystem: "github-actions"')[0] || '';
  assert.match(dockerUpdates, /dependency-name: "node"\s*\n\s*update-types: \["version-update:semver-major"\]/,
    'Node.js major upgrades must be deliberate while Windows SEA requires Node 24');
});

test('CI and container builds install the committed lock under pinned runtimes', t => {
  const workflowPath = new URL('.github/workflows/container-image.yml', root);
  if (!existsSync(workflowPath)) {
    t.skip('GitHub workflow metadata is not shipped with packaged installations');
    return;
  }
  const ci = read('.github/workflows/container-image.yml');
  const docker = read('Dockerfile');
  assert.equal((ci.match(/node-version: '24\.22\.1'/g) || []).length, 3);
  assert.equal((ci.match(/run: npm ci --include=dev --no-audit --no-fund/g) || []).length, 3);
  assert.match(ci, /npm audit --audit-level=high/);
  assert.match(ci, /^permissions:\n  contents: read\n/m);
  assert.match(ci, /  build:\n    name: Release or manually verify multi-architecture image\n    permissions:\n      contents: read\n      packages: write/);
  const imageVersions = [...docker.matchAll(/^FROM node:(24\\.\\d+\\.\\d+)-bookworm-slim(?: AS builder)?$/gm)].map(m => m[1]);
  assert.equal(imageVersions.length, 2, 'builder and runtime must use patched Node 24');
  assert.equal(imageVersions[0], imageVersions[1], 'both Docker stages must use the same Node version');
  const [major, minor, patch] = imageVersions[0].split('.').map(Number);
  assert.equal(major, 24, 'Windows SEA requires Node 24 for this release');
  assert.ok(minor > 22 || (minor === 22 && patch >= 1), 'Docker Node patch version must not predate the audited baseline');
  assert.match(docker, /COPY package\.json package-lock\.json \.npmrc/);
  assert.match(docker, /npm ci --include=dev --no-audit --no-fund/);
});
