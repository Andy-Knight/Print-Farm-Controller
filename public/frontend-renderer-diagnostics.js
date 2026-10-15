// Browser-side renderer health checks remain plain JavaScript so they also work
// when the optional Preact bundle fails to load.
export const FRONTEND_RENDERERS = Object.freeze([
  { label:'Dashboard controls', flag:'__PFC_PREACT_DASHBOARD__' },
  { label:'Printer cards and table', flag:'__PFC_PREACT_FLEET__' },
  { label:'Printer details', flag:'__PFC_PREACT_DETAIL__' },
  { label:'Print queue and history', flag:'__PFC_PREACT_QUEUE__' },
  { label:'Print library', flag:'__PFC_PREACT_LIBRARY__' },
  { label:'Maintenance', flag:'__PFC_PREACT_MAINTENANCE__' },
  { label:'Alerts and notifications', flag:'__PFC_PREACT_ALERTS__' },
  { label:'Reports and analytics', flag:'__PFC_PREACT_REPORTING__' },
  { label:'Backup and recovery', flag:'__PFC_PREACT_BACKUP__' },
  { label:'Printer groups', flag:'__PFC_PREACT_PRINTER_GROUPS__' },
  { label:'Diagnostics', flag:'__PFC_PREACT_DIAGNOSTICS__' },
  { label:'Licence', flag:'__PFC_PREACT_LICENSE__' },
  { label:'Dashboard licence notice', flag:'__PFC_PREACT_LICENSE_NOTICE__' }
]);

export function collectFrontendRendererStatus(globals = globalThis) {
  const components = FRONTEND_RENDERERS.map(({ label, flag }) => ({
    label,
    flag,
    renderer:globals[flag] === true ? 'Preact' : 'Legacy fallback',
    active:globals[flag] === true
  }));
  const preactCount = components.filter((component) => component.active).length;
  return {
    bundleLoaded:globals.__PFC_PREACT_BUNDLE_LOADED__ === true,
    preactCount,
    fallbackCount:components.length - preactCount,
    components
  };
}

export function renderFrontendRendererStatus(container, status, doc = globalThis.document) {
  if (!container || !doc) return;

  const summary = doc.createElement('p');
  summary.className = 'frontend-renderer-summary';
  summary.textContent = `Preact bundle: ${status.bundleLoaded ? 'Loaded' : 'Not initialised'} · ${status.preactCount}/${status.components.length} components initialised`;
  if (status.fallbackCount) summary.classList.add('frontend-renderer-warning');

  const table = doc.createElement('table');
  table.className = 'frontend-renderer-table';
  const head = doc.createElement('thead');
  const heading = doc.createElement('tr');
  for (const label of ['Component', 'Renderer']) {
    const th = doc.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    heading.append(th);
  }
  head.append(heading);
  table.append(head);

  const body = doc.createElement('tbody');
  for (const component of status.components) {
    const row = doc.createElement('tr');
    const name = doc.createElement('td');
    name.textContent = component.label;
    const state = doc.createElement('td');
    state.textContent = component.renderer;
    state.className = component.active ? 'frontend-renderer-active' : 'frontend-renderer-warning';
    row.append(name, state);
    body.append(row);
  }
  table.append(body);
  container.replaceChildren(summary, table);
}

// Call after the optional bundle has had its opportunity to initialise.
// This reports unexpected fallback without making the legacy path unusable.
export function initializeFrontendRendererDiagnostics(globals = globalThis, doc = globals.document, logger = console) {
  const refresh = () => {
    const status = collectFrontendRendererStatus(globals);
    globals.__PFC_FRONTEND_RENDERER_STATUS__ = status;
    renderFrontendRendererStatus(doc?.getElementById('frontendRendererStatus'), status, doc);
    return status;
  };

  const status = refresh();
  if (status.fallbackCount) {
    const fallbackNames = status.components.filter((component) => !component.active).map((component) => component.label);
    logger.warn(`Print Farm Controller: Preact renderer unavailable for ${fallbackNames.join(', ')}. Legacy JavaScript fallback is active; check /dashboard-preact.js and the browser console.`);
  }
  return refresh;
}
