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

test('repository dependency rules retain age gate and explicit supply-chain controls', () => {
  const config = read('.npmrc');
  assert.match(config, /^min-release-age=7$/m);
  assert.match(config, /^allow-git=none$/m);
  assert.match(config, /^allow-remote=none$/m);
  const dependabot = read('.github/dependabot.yml');
  for (const kind of ['npm', 'docker', 'github-actions']) {
    assert.ok(dependabot.includes('package-ecosystem: "' + kind + '"'));
  }
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
  assert.equal((docker.match(/FROM node:24\.22\.1-bookworm-slim/g) || []).length, 2);
  assert.match(docker, /COPY package\.json package-lock\.json \.npmrc/);
  assert.match(docker, /npm ci --include=dev --no-audit --no-fund/);
});
