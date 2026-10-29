import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Exercise the REAL queue event handlers, rendering guard and confirmation
// function from app.js. This is a deliberately small DOM/event harness, not a
// claim that Chromium's event timing or Preact rendering is verified.
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function sliceFunction(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, 'Cannot find controller code: ' + startMarker);
  return app.slice(start, end);
}

const controllerLogic = [
  sliceFunction('function updateSidebarCountBadge(', '\nconst queueDialog ='),
  sliceFunction('async function confirmBedCleared(', '\nfunction isPrinterPrinting('),
  sliceFunction('function queueClearanceMarkup(', '\nfunction productionBatchMarkup('),
  sliceFunction('function queueClearanceViewModel(', '\nfunction productionBatchViewModel('),
  sliceFunction('function renderPrintQueue()', '\nasync function refreshPrintQueue()'),
  sliceFunction('function beginQueuePointerInteraction(event)', "\nqueueHistoryList?.addEventListener('click'")
].join('\n\n');

function makeButton(printerId) {
  return {
    dataset:{ bedCleared:printerId },
    textContent:'Bed cleared · continue',
    disabled:false,
    connected:true,
    closest(selector) {
      if (selector === 'button,select,input' || selector === '[data-bed-cleared]') return this;
      return null;
    }
  };
}

function mockEvents() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) { listeners.set(name, listener); },
    dispatch(name, event) { return listeners.get(name)?.(event); }
  };
}

function makeHarness({ preact = false, confirmed = true, request = null, transformController = null } = {}) {
  const events = mockEvents();
  const document = mockEvents();
  const calls = [];
  const alerts = [];
  const published = [];
  const timers = new Map();
  let nextTimer = 0;

  const queue = {
    ...events,
    writes:0,
    button:null,
    markup:'',
    set innerHTML(value) {
      if (this.button) this.button.connected = false;
      this.markup = value;
      this.writes += 1;
      const buttonMarkup = value.match(/<button[^>]*data-bed-cleared="([^"]+)"([^>]*)>([^<]*)<\/button>/);
      this.button = buttonMarkup ? makeButton(buttonMarkup[1]) : null;
      if (this.button) {
        this.button.disabled = /\sdisabled\b/.test(buttonMarkup[2]);
        this.button.textContent = buttonMarkup[3];
      }
    },
    get innerHTML() { return this.markup; },
    click(button) {
      // A normal delegated click cannot reach the parent after the target was
      // removed by a telemetry re-render between pointerdown and pointerup.
      if (!button?.connected) return false;
      this.dispatch('click', { target:button });
      return true;
    }
  };

  const clearance = {
    printerId:'ad5m-1',
    printerName:'AD5M Pro',
    fileName:'part.gcode',
    jobStatus:'completed',
    finishedAt:'2026-10-16T09:00:00Z'
  };
  const originalQueue = { jobs:[], productionBatches:[], bedClearance:[clearance] };
  const sandbox = {
    queueState:originalQueue,
    queueDialog:{},
    queueActiveList:queue,
    queueHistoryList:null,
    queueSummary:{textContent:''},
    queueButtonCount:null,
    clearQueueHistoryBtn:null,
    queuePointerInteractionActive:false,
    queueRenderPending:false,
    queueInteractionReleaseTimer:null,
    pendingBedClearanceActions:new Set(),
    window:{ __PFC_PREACT_QUEUE__:preact },
    document,
    confirm:() => confirmed,
    alert:(message) => alerts.push(message),
    api:async (url, options) => {
      calls.push({url, options});
      return request ? request(url, options) : { queue:{ jobs:[], productionBatches:[], bedClearance:[] } };
    },
    reconcileFleet:() => {},
    showUiToast:() => {},
    queueStatusLabel:(status) => status || '',
    formatQueueTime:() => '',
    escapeHtml:(value) => String(value ?? ''),
    setTimeout:(fn) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout:(id) => timers.delete(id),
    publishPrintQueueUiState:(state) => published.push(state),
    CustomEvent:class {}
  };
  const context = createContext(sandbox);
  runInContext(transformController ? transformController(controllerLogic) : controllerLogic, context,
    { filename:'public/app.js (queue handler execution)' });

  return {
    queue,
    document,
    sandbox,
    calls,
    alerts,
    published,
    render:() => runInContext('renderPrintQueue()', context),
    viewModel:() => runInContext('queueClearanceViewModel(queueState.bedClearance[0])', context),
    get pending() { return sandbox.pendingBedClearanceActions.size; },
    get releasePending() { return sandbox.queueRenderPending; },
    pointerDown(button) { return queue.dispatch('pointerdown', {target:button}); },
    pointerUp(button) { return document.dispatch('pointerup', {target:button}); },
    async dispatchClick(button) {
      // Await the actual async delegated listener rather than an imitation.
      if (!button?.connected) return false;
      await queue.dispatch('click', {target:button});
      return true;
    },
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const fn of callbacks) fn();
    }
  };
}

test('legacy queue retains the pressed bed-clearance button across live updates until the click is delivered', async () => {
  const h = makeHarness();
  h.render();
  const button = h.queue.button;
  assert.ok(button?.connected, 'a real clearance button is rendered');
  assert.match(h.queue.markup, /Bed cleared · continue/);
  const writesBefore = h.queue.writes;

  h.pointerDown(button);
  h.render(); // SSE-driven refresh between pointerdown and pointerup
  h.render(); // repeated SSE events must not disconnect the clicked node
  assert.equal(h.queue.writes, writesBefore);
  assert.equal(h.releasePending, true);
  assert.equal(button.connected, true);

  h.pointerUp(button);
  assert.equal(await h.dispatchClick(button), true);
  assert.equal(h.calls.length, 1, 'one press sends exactly one clearance request');
  assert.equal(h.calls[0].url, '/api/queue/bed-clearance/ad5m-1');
  assert.equal(h.calls[0].options.method, 'POST');
  assert.equal(h.pending, 0, 'success clears pending-action guard');

  h.flushTimers();
  assert.equal(h.releasePending, false);
  assert.equal(h.queue.button, null, 'successful API response removes the cleared interlock');
});

test('Preact queue defers publishing refreshed rows until the original click is delivered', async () => {
  const h = makeHarness({ preact:true });
  h.render();
  assert.equal(h.published.length, 1);

  // In the Preact route, the event handler still comes from app.js. The
  // renderer's published state must not replace pressed rows prematurely.
  const button = makeButton('ad5m-1');
  h.pointerDown(button);
  h.render();
  assert.equal(h.published.length, 1);
  assert.equal(h.releasePending, true);
  h.pointerUp(button);
  assert.equal(await h.dispatchClick(button), true);
  assert.equal(h.calls.length, 1);
  h.flushTimers();
  assert.equal(h.releasePending, false);
  assert.ok(h.published.length >= 2, 'state is published after the interaction');
});

test('cancelled clearance confirmation restores the original button without any API request', async () => {
  const h = makeHarness({ confirmed:false });
  h.render();
  const button = h.queue.button;
  assert.equal(await h.dispatchClick(button), true);
  assert.equal(h.calls.length, 0);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Bed cleared · continue');
  assert.equal(h.pending, 0);
  assert.equal(h.queue.button, button, 'cancel must not rebuild or drop the current action');
});

test('rejected clearance API request restores button and permits a retry', async () => {
  let attempt = 0;
  const h = makeHarness({ request:async () => {
    if (++attempt === 1) throw new Error('network unavailable');
    return { queue:{ jobs:[], productionBatches:[], bedClearance:[] } };
  } });
  h.render();
  const button = h.queue.button;
  await h.dispatchClick(button);
  assert.equal(h.calls.length, 1);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /network unavailable/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Bed cleared · continue');
  assert.equal(h.pending, 0);
  await h.dispatchClick(button);
  assert.equal(h.calls.length, 2, 'retry is accepted after network error');
});

test('rapid duplicate bed-clearance clicks cannot send two requests', async () => {
  let resolveRequest;
  const gate = new Promise((resolve) => { resolveRequest = resolve; });
  const h = makeHarness({ request:() => gate });
  h.render();
  const button = h.queue.button;
  const first = h.queue.dispatch('click', {target:button});
  assert.equal(h.pending, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Continuing…');
  const second = h.queue.dispatch('click', {target:button});
  await second;
  assert.equal(h.calls.length, 1, 'pending-action guard rejects duplicate events');
  resolveRequest({ queue:{ jobs:[], productionBatches:[], bedClearance:[] } });
  await first;
  assert.equal(h.pending, 0);
});

test('a live refresh while waiting for API confirmation retains a disabled/pending clearance action', async () => {
  let resolveRequest;
  const gate = new Promise((resolve) => { resolveRequest = resolve; });
  const h = makeHarness({ request:() => gate });
  h.render();
  const button = h.queue.button;
  const first = h.queue.dispatch('click', {target:button});
  assert.equal(h.pending, 1);
  h.render();
  assert.match(h.queue.markup, /data-bed-cleared="ad5m-1" disabled/);
  assert.match(h.queue.markup, /Continuing…/);
  assert.equal(h.queue.button?.disabled, true, 'refresh renders a disabled action while API is pending');
  assert.equal(h.viewModel().pending, true, 'Preact view model also flags pending action');
  resolveRequest({ queue:{ jobs:[], productionBatches:[], bedClearance:[] } });
  await first;
});


test('fault injection: removing the live-refresh guard really loses the pre-click target', () => {
  const h = makeHarness({transformController:(source) => {
    // Change only the legacy queue rendering guard in the extracted real code,
    // without modifying production files. This confirms why an existence-only
    // regex assertion cannot substitute for the event/DOM-state test above.
    const renderMarkup = source.indexOf('const nextActiveMarkup =');
    assert.ok(renderMarkup >= 0);
    const guard = 'if (queuePointerInteractionActive) {';
    const index = source.indexOf(guard, renderMarkup);
    assert.ok(index > renderMarkup);
    return source.slice(0, index) + source.slice(index).replace(guard, 'if (false) {');
  }});
  h.render();
  const originalButton = h.queue.button;
  h.pointerDown(originalButton);
  h.render(); // Unprotected redraw replaces the targeted button.
  assert.equal(originalButton.connected, false, 'mutant disconnects the clicked node');
  h.pointerUp(originalButton);
  assert.equal(h.queue.click(originalButton), false, 'disconnected button cannot send the delegated click');
  assert.equal(h.calls.length, 0, 'no clearance request reaches the controller');
});
