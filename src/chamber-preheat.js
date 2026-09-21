import { getPrinterAdapter } from './adapters/adapter-registry.js';
import { getPrinter } from './store.js';

export const CHAMBER_PREHEAT_MAX_MINUTES = 120;
export const CHAMBER_PREHEAT_MIN_MINUTES = 1;
export const CHAMBER_PREHEAT_MIN_BED_C = 30;
export const DEFAULT_CHAMBER_PREHEAT_MAX_BED_C = 110;

const ACTIVE_JOB_STATES = new Set(['printing', 'working', 'building_from_sd', 'pause', 'paused']);
const FAULT_STATES = new Set(['error', 'fault', 'failed', 'alarm']);

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function isPrintJobActive(status = {}) {
  const state = String(status.status || '').toLowerCase();
  if (ACTIVE_JOB_STATES.has(state)) return true;
  if (state === 'heating' && status.fileName) return true;
  return false;
}

export function isPrinterFault(status = {}) {
  return FAULT_STATES.has(String(status.status || '').toLowerCase());
}

function publicSession(session, now = Date.now()) {
  if (!session) return { active: false };
  return {
    active: true,
    bedTemperature: session.bedTemperature,
    durationMinutes: session.durationMinutes,
    startedAt: session.startedAt,
    endsAt: session.endsAt,
    remainingSeconds: Math.max(0, Math.ceil((session.endsAtMs - now) / 1000)),
    reassertions: session.reassertions,
    lastReassertedAt: session.lastReassertedAt,
    lastError: session.lastError || null
  };
}

export class ChamberPreheatService {
  constructor({
    fleetState,
    getPrinterFn = getPrinter,
    adapterResolver = getPrinterAdapter,
    getStatusFn = null,
    setTemperaturesFn = null,
    tickIntervalMs = 3000,
    heartbeatMs = 60000,
    offlineGraceMs = 12000,
    overTemperatureC = DEFAULT_CHAMBER_PREHEAT_MAX_BED_C + 5,
    nowFn = () => Date.now()
  } = {}) {
    if (!fleetState) throw new Error('fleetState is required');
    this.fleetState = fleetState;
    this.getPrinter = getPrinterFn;
    this.adapterResolver = adapterResolver;
    this.getStatusOverride = getStatusFn;
    this.setTemperaturesOverride = setTemperaturesFn;
    this.tickIntervalMs = tickIntervalMs;
    this.heartbeatMs = heartbeatMs;
    this.offlineGraceMs = offlineGraceMs;
    this.overTemperatureC = overTemperatureC;
    this.now = nowFn;
    this.sessions = new Map();
    this.timer = null;
  }

  startService() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => console.error('Chamber preheat tick error:', error)), this.tickIntervalMs);
  }

  stopService() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Sessions are memory-only and never resume after controller restart.
    this.sessions.clear();
  }

  async stopAll({ reason = 'controller-shutdown', turnOff = true } = {}) {
    const ids = [...this.sessions.keys()];
    return Promise.all(ids.map((id) => this.stop(id, { reason, turnOff })));
  }

  isActive(id) {
    return this.sessions.has(id);
  }

  get(id) {
    return publicSession(this.sessions.get(id), this.now());
  }

  validate({ bedTemperature, durationMinutes }, { maxBedTemperatureC = DEFAULT_CHAMBER_PREHEAT_MAX_BED_C } = {}) {
    const bed = Number(bedTemperature);
    const duration = Number(durationMinutes);
    if (!Number.isFinite(bed) || bed < CHAMBER_PREHEAT_MIN_BED_C || bed > maxBedTemperatureC) {
      throw new Error(`Chamber preheat bed temperature must be ${CHAMBER_PREHEAT_MIN_BED_C}-${maxBedTemperatureC} C`);
    }
    if (!Number.isFinite(duration) || duration < CHAMBER_PREHEAT_MIN_MINUTES || duration > CHAMBER_PREHEAT_MAX_MINUTES) {
      throw new Error(`Chamber preheat duration must be ${CHAMBER_PREHEAT_MIN_MINUTES}-${CHAMBER_PREHEAT_MAX_MINUTES} minutes`);
    }
    return { bedTemperature: bed, durationMinutes: duration };
  }

  adapterFor(printer) {
    return this.adapterResolver(printer);
  }

  async readStatus(printer, adapter = null) {
    if (this.getStatusOverride) return this.getStatusOverride(printer);
    return (adapter || this.adapterFor(printer)).getStatus();
  }

  async writeTemperatures(printer, values, adapter = null) {
    if (this.setTemperaturesOverride) return this.setTemperaturesOverride(printer, values);
    return (adapter || this.adapterFor(printer)).setTemperatures(values);
  }

  async start(id, options) {
    if (this.sessions.has(id)) throw new Error('Chamber preheat is already active for this printer');
    const printer = await this.getPrinter(id);
    if (!printer) throw new Error('Printer not found');
    const adapter = this.adapterFor(printer);
    if (!adapter.capabilities?.chamberPreheat || !adapter.capabilities?.bedTemperature) {
      throw new Error('Chamber preheat is not supported by this printer');
    }
    const maxBedTemperatureC = Number(adapter.limits?.chamberPreheatBedTemperature?.max ?? adapter.limits?.bedTemperature?.max ?? DEFAULT_CHAMBER_PREHEAT_MAX_BED_C);
    const { bedTemperature, durationMinutes } = this.validate(options, { maxBedTemperatureC });

    const status = await this.readStatus(printer, adapter);
    if (isPrinterFault(status)) throw new Error('Cannot start chamber preheat while the printer reports a fault');
    if (isPrintJobActive(status)) throw new Error('Cannot start chamber preheat while a print job is active');

    let adapterPrepared = false;
    try {
      await adapter.prepareChamberPreheat({ bedTemperature, durationMinutes }, { status });
      adapterPrepared = true;
      await this.writeTemperatures(printer, { bed: bedTemperature }, adapter);
    } catch (error) {
      if (adapterPrepared) {
        try { await adapter.finishChamberPreheat({ reason: 'start-failed' }); } catch {}
      }
      throw error;
    }

    const now = this.now();
    const session = {
      id,
      bedTemperature,
      durationMinutes,
      startedAt: nowIso(now),
      endsAtMs: now + durationMinutes * 60_000,
      endsAt: nowIso(now + durationMinutes * 60_000),
      reassertions: 0,
      lastReassertedAt: nowIso(now),
      lastCommandAtMs: now,
      overTemperatureC: Math.min(this.overTemperatureC, maxBedTemperatureC + 5),
      offlineSinceMs: null,
      lastError: null,
      busy: false
    };
    this.sessions.set(id, session);
    this.publish(id, session);
    return publicSession(session, now);
  }

  async stop(id, { reason = 'manual', turnOff = true } = {}) {
    const session = this.sessions.get(id);
    if (!session) {
      this.fleetState.setChamberPreheat(id, { active: false, reason, endedAt: nowIso(this.now()) });
      return { active: false, reason, warning: null };
    }

    this.sessions.delete(id);
    const warnings = [];
    const releaseToPrint = reason === 'print-started' || reason === 'distribution-print-started';
    const connectionLost = reason === 'connection-lost';
    let printer = null;
    try { printer = await this.getPrinter(id); } catch {}

    if (printer && !releaseToPrint && !connectionLost) {
      try {
        const adapter = this.adapterFor(printer);
        await adapter.finishChamberPreheat({ reason, turnOff });
      } catch (error) {
        warnings.push(`could not stop printer-native chamber circulation: ${error.message}`);
      }
    }

    if (turnOff && printer) {
      try {
        await this.writeTemperatures(printer, { bed: 0 });
      } catch (error) {
        warnings.push(`could not turn the bed off: ${error.message}`);
      }
    }

    const warning = warnings.length ? `Preheat session stopped, but the controller ${warnings.join('; ')}` : null;
    const endedAt = nowIso(this.now());
    this.fleetState.setChamberPreheat(id, {
      active: false,
      reason,
      endedAt,
      warning
    });
    return { active: false, reason, endedAt, warning };
  }

  publish(id, session) {
    this.fleetState.setChamberPreheat(id, publicSession(session, this.now()));
  }

  async tick() {
    await Promise.all([...this.sessions.keys()].map((id) => this.tickSession(id)));
  }

  async tickSession(id) {
    const session = this.sessions.get(id);
    if (!session || session.busy) return;
    session.busy = true;

    try {
      const now = this.now();
      if (now >= session.endsAtMs) {
        await this.stop(id, { reason: 'duration-complete', turnOff: true });
        return;
      }

      const state = this.fleetState.getPrinterState(id);
      if (!state?.online) {
        session.offlineSinceMs ??= now;
        session.lastError = state?.error || 'Printer is offline';
        this.publish(id, session);
        if (now - session.offlineSinceMs >= this.offlineGraceMs) {
          // We cannot reliably deliver an off command while disconnected. End
          // the controller session so it will never auto-resume on reconnect.
          await this.stop(id, { reason: 'connection-lost', turnOff: false });
        }
        return;
      }

      session.offlineSinceMs = null;
      session.lastError = null;
      const status = state.status || {};

      if (isPrinterFault(status)) {
        await this.stop(id, { reason: 'printer-fault', turnOff: true });
        return;
      }
      if (isPrintJobActive(status)) {
        // Do not send bed-off here: the print job owns the heater from now on.
        await this.stop(id, { reason: 'print-started', turnOff: false });
        return;
      }

      const actualBed = Number(status.bed?.actual);
      if (Number.isFinite(actualBed) && actualBed > Number(session.overTemperatureC ?? this.overTemperatureC)) {
        await this.stop(id, { reason: 'over-temperature', turnOff: true });
        return;
      }

      const reportedTarget = Number(status.bed?.target);
      const targetCleared = Number.isFinite(reportedTarget) && reportedTarget < session.bedTemperature - 1;
      const heartbeatDue = now - session.lastCommandAtMs >= this.heartbeatMs;
      if (targetCleared || heartbeatDue) {
        const printer = await this.getPrinter(id);
        if (!printer) {
          await this.stop(id, { reason: 'printer-removed', turnOff: false });
          return;
        }
        try {
          await this.writeTemperatures(printer, { bed: session.bedTemperature });
          session.reassertions += 1;
          session.lastReassertedAt = nowIso(now);
          session.lastCommandAtMs = now;
          session.lastError = null;
        } catch (error) {
          session.lastError = error.message || 'Could not reassert bed temperature';
        }
      }
      this.publish(id, session);
    } finally {
      const latest = this.sessions.get(id);
      if (latest) latest.busy = false;
    }
  }
}
