import { getHeapStatistics } from 'node:v8';

const DEFAULT_SAMPLE_MS = 60_000;
const DEFAULT_REMINDER_MS = 15 * 60_000;
const DEFAULT_THRESHOLDS = Object.freeze({
  warning:0.25,
  critical:0.50,
  danger:0.75
});

function finiteBytes(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function severityFor(heapUsedBytes, heapLimitBytes, thresholds) {
  if (!heapLimitBytes) return 'normal';
  const ratio = heapUsedBytes / heapLimitBytes;
  if (ratio >= thresholds.danger) return 'danger';
  if (ratio >= thresholds.critical) return 'critical';
  if (ratio >= thresholds.warning) return 'warning';
  return 'normal';
}

function levelFor(state) {
  if (state === 'danger') return 'error';
  if (state === 'critical' || state === 'warning') return 'warn';
  return 'info';
}

function messageFor(state, repeated = false) {
  if (state === 'normal') return 'Controller memory usage recovered';
  const label = state === 'danger' ? 'dangerously high' : state;
  return repeated
    ? `Controller memory usage remains ${label}`
    : `Controller memory usage is ${label}`;
}

export class MemoryMonitor {
  constructor({
    diagnosticFn = null,
    sampleMs = DEFAULT_SAMPLE_MS,
    reminderMs = DEFAULT_REMINDER_MS,
    thresholds = DEFAULT_THRESHOLDS,
    memoryUsageFn = () => process.memoryUsage(),
    heapStatisticsFn = getHeapStatistics,
    nowFn = () => Date.now()
  } = {}) {
    this.diagnosticFn = typeof diagnosticFn === 'function' ? diagnosticFn : null;
    this.sampleMs = Math.max(1_000, Number(sampleMs) || DEFAULT_SAMPLE_MS);
    this.reminderMs = Math.max(this.sampleMs, Number(reminderMs) || DEFAULT_REMINDER_MS);
    this.thresholds = {
      warning:Number(thresholds.warning ?? DEFAULT_THRESHOLDS.warning),
      critical:Number(thresholds.critical ?? DEFAULT_THRESHOLDS.critical),
      danger:Number(thresholds.danger ?? DEFAULT_THRESHOLDS.danger)
    };
    if (!(this.thresholds.warning > 0
      && this.thresholds.warning < this.thresholds.critical
      && this.thresholds.critical < this.thresholds.danger
      && this.thresholds.danger < 1)) {
      throw new Error('Memory monitor thresholds must increase between 0 and 1');
    }
    this.memoryUsageFn = memoryUsageFn;
    this.heapStatisticsFn = heapStatisticsFn;
    this.nowFn = nowFn;
    this.timer = null;
    this.lastState = 'normal';
    this.lastLoggedAt = 0;
    this.latest = null;
  }

  snapshot() {
    const memory = this.memoryUsageFn() || {};
    const heapStats = this.heapStatisticsFn() || {};
    const heapUsedBytes = finiteBytes(memory.heapUsed);
    const heapLimitBytes = finiteBytes(heapStats.heap_size_limit);
    const state = severityFor(heapUsedBytes, heapLimitBytes, this.thresholds);
    return {
      sampledAt:new Date(this.nowFn()).toISOString(),
      state,
      heapUsedBytes,
      heapTotalBytes:finiteBytes(memory.heapTotal),
      heapLimitBytes,
      heapUsedPercent:heapLimitBytes ? Number((heapUsedBytes / heapLimitBytes * 100).toFixed(1)) : null,
      rssBytes:finiteBytes(memory.rss),
      externalBytes:finiteBytes(memory.external),
      arrayBuffersBytes:finiteBytes(memory.arrayBuffers)
    };
  }

  getSnapshot() {
    return this.latest || this.snapshot();
  }

  async log(level, message, snapshot) {
    if (!this.diagnosticFn) return;
    await Promise.resolve(this.diagnosticFn(level, message, snapshot));
  }

  async sample() {
    const snapshot = this.snapshot();
    this.latest = snapshot;
    const now = this.nowFn();
    const stateChanged = snapshot.state !== this.lastState;

    if (snapshot.state === 'normal') {
      if (this.lastState !== 'normal') {
        await this.log('info', messageFor('normal'), snapshot).catch(() => {});
        this.lastLoggedAt = now;
      }
      this.lastState = 'normal';
      return snapshot;
    }

    const reminderDue = !stateChanged && now - this.lastLoggedAt >= this.reminderMs;
    if (stateChanged || reminderDue) {
      await this.log(levelFor(snapshot.state), messageFor(snapshot.state, reminderDue), snapshot).catch(() => {});
      this.lastLoggedAt = now;
    }

    this.lastState = snapshot.state;
    return snapshot;
  }

  start() {
    if (this.timer) return;
    this.sample().catch(() => {});
    this.timer = setInterval(() => this.sample().catch(() => {}), this.sampleMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const memoryMonitorInternals = {
  DEFAULT_SAMPLE_MS,
  DEFAULT_REMINDER_MS,
  DEFAULT_THRESHOLDS,
  severityFor,
  levelFor,
  messageFor
};
