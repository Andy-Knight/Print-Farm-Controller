import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FRONTEND_RENDERERS,
  collectFrontendRendererStatus,
  initializeFrontendRendererDiagnostics,
  renderFrontendRendererStatus
} from '../public/frontend-renderer-diagnostics.js';

function allPreactFlags() {
  return Object.fromEntries([
    ['__PFC_PREACT_BUNDLE_LOADED__', true],
    ...FRONTEND_RENDERERS.map(({ flag }) => [flag, true])
  ]);
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.classes = new Set();
    this.classList = { add:(name) => this.classes.add(name) };
    this.textContent = '';
    this.className = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
}

function fakeDocument() {
  const root = new FakeElement('div');
  return {
    root,
    createElement:(name) => new FakeElement(name),
    getElementById:(id) => id === 'frontendRendererStatus' ? root : null
  };
}

test('fully initialised Preact reports every renderer active', () => {
  const report = collectFrontendRendererStatus(allPreactFlags());
  assert.equal(report.bundleLoaded, true);
  assert.equal(report.preactCount, FRONTEND_RENDERERS.length);
  assert.equal(report.fallbackCount, 0);
  assert.ok(report.components.every((component) => component.renderer === 'Preact'));
});

test('missing bundle identifies each legacy fallback without crashing', () => {
  const report = collectFrontendRendererStatus({});
  assert.equal(report.bundleLoaded, false);
  assert.equal(report.preactCount, 0);
  assert.equal(report.fallbackCount, FRONTEND_RENDERERS.length);
  assert.ok(report.components.every((component) => component.renderer === 'Legacy fallback'));
});

test('partial Preact initialisation identifies the affected component', () => {
  const flags = allPreactFlags();
  delete flags.__PFC_PREACT_QUEUE__;
  const report = collectFrontendRendererStatus(flags);
  assert.equal(report.preactCount, FRONTEND_RENDERERS.length - 1);
  assert.deepEqual(report.components.filter((component) => !component.active).map((component) => component.label), [
    'Print queue and history'
  ]);
});

test('frontend diagnostics renders a table safely in the legacy DOM', () => {
  const doc = fakeDocument();
  const status = collectFrontendRendererStatus({});
  renderFrontendRendererStatus(doc.root, status, doc);
  const [summary, table] = doc.root.children;
  assert.match(summary.textContent, /Not initialised/);
  assert.equal(summary.classes.has('frontend-renderer-warning'), true);
  assert.equal(table.tagName, 'table');
  assert.equal(table.children[1].children.length, FRONTEND_RENDERERS.length);
  assert.equal(table.children[1].children[0].children[1].textContent, 'Legacy fallback');
});

test('initialisation warns once and recheck updates status without duplicate warnings', () => {
  const doc = fakeDocument();
  const flags = {};
  const warnings = [];
  const refresh = initializeFrontendRendererDiagnostics(flags, doc, { warn:(message) => warnings.push(message) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Legacy JavaScript fallback is active/);
  assert.equal(flags.__PFC_FRONTEND_RENDERER_STATUS__.fallbackCount, FRONTEND_RENDERERS.length);
  Object.assign(flags, allPreactFlags());
  refresh();
  assert.equal(warnings.length, 1);
  assert.equal(flags.__PFC_FRONTEND_RENDERER_STATUS__.fallbackCount, 0);
  assert.match(doc.root.children[0].textContent, /13\/13 components initialised/);
});

test('browser boot and bundle expose renderer health without depending on Preact for diagnostics', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const bundleSource = readFileSync(new URL('../ui/dashboard.jsx', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../scripts/build-frontend.mjs', import.meta.url), 'utf8');

  assert.ok(html.includes('id="frontendRendererStatus"'));
  assert.ok(html.indexOf('src="/dashboard-preact.js"') < html.indexOf('src="/app.js"'));
  assert.match(app, /initializeFrontendRendererDiagnostics\(\)/);
  assert.match(app, /refreshFrontendRendererStatus\(\);/);
  assert.match(bundleSource, /__PFC_PREACT_BUNDLE_LOADED__ = true/);
  assert.match(build, /dashboard-preact\.js/);
});

test('live Preact fleet updates still use the existing state/event bridge', () => {
  const dashboard = readFileSync(new URL('../ui/dashboard.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(dashboard, /addEventListener\('pfc:dashboard-fleet-state'/);
  assert.match(app, /dispatchEvent\(new CustomEvent\('pfc:dashboard-fleet-state'/);
  assert.match(app, /if \(window\.__PFC_PREACT_FLEET__\)/);
  assert.match(app, /else \{\s*const wanted = new Set\(fleet\.map/);
});
