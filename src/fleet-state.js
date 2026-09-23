import { getPrinterAdapter } from './adapters/adapter-registry.js';
import { getPrinter, listPrinters, publicPrinter } from './store.js';

const nowIso = () => new Date().toISOString();

export class FleetStateService {
  constructor({ pollIntervalMs = 2500, tickIntervalMs = 250, maxConcurrent = 4, adapterResolver = getPrinterAdapter, diagnosticFn = null } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.tickIntervalMs = tickIntervalMs;
    this.maxConcurrent = maxConcurrent;
    this.adapterResolver = adapterResolver;
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : null;
    this.states = new Map();
    this.subscribers = new Set();
    this.timer = null;
    this.running = 0;
    this.publishTimer = null;
  }

  async start() {
    await this.syncRegistry();
    this.timer = setInterval(() => this.tick().catch((error) => console.error('Fleet poll error:', error)), this.tickIntervalMs);
    await this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.timer = null;
    this.publishTimer = null;
  }

  async syncRegistry() {
    const printers = await listPrinters();
    const ids = new Set(printers.map((p) => p.id));
    for (const id of this.states.keys()) {
      if (!ids.has(id)) this.states.delete(id);
    }

    const base = Date.now();
    const spacing = printers.length ? Math.max(100, Math.floor(this.pollIntervalMs / printers.length)) : 0;
    printers.forEach((printer, index) => {
      const existing = this.states.get(printer.id);
      let capabilities = existing?.capabilities || {};
      let limits = existing?.limits || {};
      let uploadExtensions = existing?.uploadExtensions || [];
      try {
        const adapter = this.adapterResolver(printer);
        capabilities = adapter.capabilities;
        limits = adapter.limits;
        uploadExtensions = [...(adapter.uploadExtensions || [])];
      } catch {}
      this.states.set(printer.id, {
        ...(existing || {}),
        ...publicPrinter(printer),
        capabilities,
        limits,
        uploadExtensions,
        online: existing?.online ?? false,
        status: existing?.status ?? null,
        cameraAvailable: existing?.cameraAvailable ?? true,
        cameraHealth: existing?.cameraHealth || { state: 'idle', subscribers: 0, connectedAt: null, lastFrameAt: null, lastError: null, source: null },
        chamberPreheat: existing?.chamberPreheat || { active: false },
        error: existing?.error || null,
        lastSeen: existing?.lastSeen || null,
        lastAttempt: existing?.lastAttempt || null,
        latencyMs: existing?.latencyMs ?? null,
        consecutiveFailures: existing?.consecutiveFailures || 0,
        polling: false,
        nextPollAt: existing?.nextPollAt ?? (base + index * spacing)
      });
    });
    this.schedulePublish();
  }

  getFleet() {
    return [...this.states.values()]
      .map(({ polling, nextPollAt, ...state }) => ({ ...state }))
      .sort((a, b) => {
        const aHasOrder = a.dashboardOrder !== null && a.dashboardOrder !== undefined && Number.isFinite(Number(a.dashboardOrder));
        const bHasOrder = b.dashboardOrder !== null && b.dashboardOrder !== undefined && Number.isFinite(Number(b.dashboardOrder));
        const aOrder = aHasOrder ? Number(a.dashboardOrder) : 0;
        const bOrder = bHasOrder ? Number(b.dashboardOrder) : 0;
        if (aHasOrder && bHasOrder) return aOrder - bOrder;
        if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.getFleet());
    return () => this.subscribers.delete(callback);
  }

  schedulePublish() {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      const snapshot = this.getFleet();
      for (const callback of this.subscribers) {
        try { callback(snapshot); } catch {}
      }
    }, 40);
  }

  async tick() {
    const due = [...this.states.values()]
      .filter((state) => !state.polling && state.nextPollAt <= Date.now())
      .sort((a, b) => a.nextPollAt - b.nextPollAt);

    while (due.length && this.running < this.maxConcurrent) {
      const state = due.shift();
      this.poll(state.id).catch(() => {});
    }
  }

  async poll(id) {
    const state = this.states.get(id);
    if (!state || state.polling) return;
    state.polling = true;
    state.lastAttempt = nowIso();
    this.running += 1;
    const started = Date.now();
    const wasOnline = state.online === true;

    try {
      const printer = await getPrinter(id);
      if (!printer) {
        this.states.delete(id);
        return;
      }
      const adapter = this.adapterResolver(printer);
      const status = await adapter.getStatus();
      state.capabilities = adapter.capabilities;
      state.limits = adapter.limits;
      state.uploadExtensions = [...(adapter.uploadExtensions || [])];
      state.online = true;
      state.status = status;
      state.cameraAvailable = Boolean(adapter.capabilities?.camera && (status.cameraAvailable || printer.cameraPort));
      state.error = null;
      state.lastSeen = nowIso();
      state.latencyMs = Date.now() - started;
      state.consecutiveFailures = 0;
      if (!wasOnline) {
        Promise.resolve(this.diagnostic?.('info', 'Printer connected', {
          printerId:state.id,
          printerName:state.name,
          adapterType:state.adapterType,
          host:state.host,
          latencyMs:state.latencyMs
        })).catch(() => {});
      }
    } catch (error) {
      state.online = false;
      state.error = error.message || 'Printer did not respond';
      state.latencyMs = Date.now() - started;
      state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
      if (wasOnline || state.consecutiveFailures === 1) {
        Promise.resolve(this.diagnostic?.('warn', 'Printer connection failed', {
          printerId:state.id,
          printerName:state.name,
          adapterType:state.adapterType,
          host:state.host,
          error:state.error,
          consecutiveFailures:state.consecutiveFailures
        })).catch(() => {});
      }
    } finally {
      const backoff = state.online ? this.pollIntervalMs : Math.min(15000, this.pollIntervalMs * Math.max(1, state.consecutiveFailures));
      state.nextPollAt = Date.now() + backoff;
      state.polling = false;
      this.running -= 1;
      this.schedulePublish();
    }
  }


  getPrinterState(id) {
    const state = this.states.get(id);
    if (!state) return null;
    const { polling, nextPollAt, ...publicState } = state;
    return { ...publicState };
  }

  setChamberPreheat(id, preheat) {
    const state = this.states.get(id);
    if (!state) return;
    state.chamberPreheat = { ...(preheat || { active: false }) };
    this.schedulePublish();
  }

  setCameraHealth(id, health) {
    const state = this.states.get(id);
    if (!state) return;
    state.cameraHealth = { ...health };
    this.schedulePublish();
  }

  async refreshNow(id) {
    const state = this.states.get(id);
    if (!state) {
      await this.syncRegistry();
      return;
    }
    state.nextPollAt = Date.now();
    await this.tick();
  }
}
