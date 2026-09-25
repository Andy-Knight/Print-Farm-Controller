import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { controllerDataDir, getPrinter } from './store.js';

const ACTIVE_PRINTER_STATES = new Set(['printing', 'working', 'building_from_sd', 'pause', 'paused']);
const HISTORY_LIMIT = 500;
const MAX_SAMPLE_MS = 120_000;

function nowIso(nowMs) {
  return new Date(nowMs).toISOString();
}

function cleanText(value, { required = false, max = 100, label = 'Value', multiline = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  const invalidControl = multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/;
  if (invalidControl.test(text)) throw new Error(`${label} contains invalid characters`);
  return text;
}

function normalizeSchedule(value) {
  const type = String(value?.type || '').trim().toLowerCase();
  if (!['days', 'print_hours', 'print_count'].includes(type)) {
    throw new Error('Maintenance interval type must be days, print hours or print count');
  }
  const interval = Number(value?.interval);
  if (!Number.isFinite(interval) || interval <= 0) throw new Error('Maintenance interval must be greater than zero');
  if (type === 'days' && interval > 3650) throw new Error('Maintenance day interval must be 3650 days or fewer');
  if (type === 'print_hours' && interval > 100000) throw new Error('Maintenance print-hour interval is too large');
  if (type === 'print_count' && (!Number.isInteger(interval) || interval > 1000000)) {
    throw new Error('Maintenance print-count interval must be a whole number');
  }
  return { type, interval };
}

function defaultState() {
  return { version:1, printers:{} };
}

function printerRecord(state, printerId) {
  if (!state.printers[printerId]) {
    state.printers[printerId] = {
      usage:{ printSeconds:0, printCount:0, updatedAt:null },
      tasks:[],
      history:[]
    };
  }
  const record = state.printers[printerId];
  record.usage ||= { printSeconds:0, printCount:0, updatedAt:null };
  record.tasks = Array.isArray(record.tasks) ? record.tasks : [];
  record.history = Array.isArray(record.history) ? record.history : [];
  record.usage.printSeconds = Math.max(0, Number(record.usage.printSeconds || 0));
  record.usage.printCount = Math.max(0, Math.floor(Number(record.usage.printCount || 0)));
  return record;
}

function isPrintActive(printer) {
  if (!printer?.online || !printer?.status) return false;
  const status = String(printer.status.status || '').trim().toLowerCase();
  if (ACTIVE_PRINTER_STATES.has(status)) return true;
  return status === 'heating' && Boolean(printer.status.fileName);
}

function taskStatus(task, usage, nowMs) {
  if (task.enabled === false) return { state:'disabled', progress:0, dueAt:null, remaining:null };
  const schedule = normalizeSchedule(task.schedule);
  let progress = 0;
  let remaining = null;
  let dueAt = null;

  if (schedule.type === 'days') {
    const startedAt = new Date(task.lastCompletedAt || task.createdAt || 0).getTime();
    const intervalMs = schedule.interval * 86400000;
    const elapsed = Math.max(0, nowMs - startedAt);
    progress = intervalMs > 0 ? elapsed / intervalMs : 0;
    remaining = Math.max(0, (intervalMs - elapsed) / 86400000);
    dueAt = new Date(startedAt + intervalMs).toISOString();
  } else if (schedule.type === 'print_hours') {
    const baseline = Number(task.lastCompletedUsage?.printSeconds ?? task.baseline?.printSeconds ?? 0);
    const used = Math.max(0, Number(usage.printSeconds || 0) - baseline);
    const intervalSeconds = schedule.interval * 3600;
    progress = used / intervalSeconds;
    remaining = Math.max(0, intervalSeconds - used) / 3600;
  } else {
    const baseline = Number(task.lastCompletedUsage?.printCount ?? task.baseline?.printCount ?? 0);
    const used = Math.max(0, Number(usage.printCount || 0) - baseline);
    progress = used / schedule.interval;
    remaining = Math.max(0, schedule.interval - used);
  }

  return {
    state:progress >= 1 ? 'due' : progress >= 0.8 ? 'due_soon' : 'current',
    progress:Math.max(0, progress),
    dueAt,
    remaining
  };
}

function publicTask(task, usage, nowMs) {
  return {
    ...structuredClone(task),
    status:taskStatus(task, usage, nowMs)
  };
}

export class MaintenanceService {
  constructor({
    fleetState,
    dataDir = controllerDataDir,
    printerLookup = getPrinter,
    nowFn = () => Date.now(),
    persistDelayMs = 5000
  } = {}) {
    if (!fleetState) throw new Error('fleetState is required');
    this.fleetState = fleetState;
    this.printerLookup = printerLookup;
    this.nowFn = nowFn;
    this.persistDelayMs = persistDelayMs;
    this.filePath = path.join(path.resolve(dataDir), 'maintenance.json');
    this.state = defaultState();
    this.started = false;
    this.initialized = false;
    this.unsubscribe = null;
    this.sessions = new Map();
    this.persistTimer = null;
    this.saveChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive:true });
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!raw || raw.version !== 1 || !raw.printers || typeof raw.printers !== 'object' || Array.isArray(raw.printers)) {
        throw new Error('Maintenance store is invalid');
      }
      this.state = raw;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.state = defaultState();
      await this.persistNow();
    }
    this.initialized = true;
  }

  async start() {
    if (this.started) return;
    await this.init();
    this.started = true;
    this.observeFleet(this.fleetState.getFleet?.() || []);
    this.unsubscribe = this.fleetState.subscribe?.((printers) => this.observeFleet(printers));
  }

  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.started = false;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.initialized) await this.persistNow();
  }

  schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow().catch((error) => console.error('Maintenance store persist failed:', error));
    }, this.persistDelayMs);
    this.persistTimer.unref?.();
  }

  async persistNow() {
    const snapshot = structuredClone(this.state);
    this.saveChain = this.saveChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive:true });
      const temp = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { mode:0o600 });
        await fs.rename(temp, this.filePath);
      } finally {
        await fs.rm(temp, { force:true }).catch(() => {});
      }
    });
    return this.saveChain;
  }

  observeFleet(printers) {
    const nowMs = this.nowFn();
    let changed = false;
    const seen = new Set();

    for (const printer of Array.isArray(printers) ? printers : []) {
      if (!printer?.id) continue;
      seen.add(printer.id);
      const record = printerRecord(this.state, printer.id);
      const active = isPrintActive(printer);
      const session = this.sessions.get(printer.id);

      if (active) {
        if (session?.active) {
          const delta = Math.max(0, Math.min(MAX_SAMPLE_MS, nowMs - session.lastSampleAt));
          if (delta > 0) {
            record.usage.printSeconds += delta / 1000;
            record.usage.updatedAt = nowIso(nowMs);
            changed = true;
          }
        }
        this.sessions.set(printer.id, { active:true, lastSampleAt:nowMs });
        continue;
      }

      if (printer.online && session?.active) {
        const delta = Math.max(0, Math.min(MAX_SAMPLE_MS, nowMs - session.lastSampleAt));
        if (delta > 0) record.usage.printSeconds += delta / 1000;
        record.usage.printCount += 1;
        record.usage.updatedAt = nowIso(nowMs);
        this.sessions.delete(printer.id);
        changed = true;
      } else if (session) {
        session.lastSampleAt = nowMs;
      }
    }

    for (const [printerId, session] of this.sessions) {
      if (!seen.has(printerId)) session.lastSampleAt = nowMs;
    }

    if (changed) this.schedulePersist();
  }

  async assertPrinter(printerId) {
    const printer = await this.printerLookup(printerId);
    if (!printer) {
      const error = new Error('Printer not found');
      error.statusCode = 404;
      throw error;
    }
    return printer;
  }

  getPrinterStatus(printerId) {
    const nowMs = this.nowFn();
    const record = printerRecord(this.state, printerId);
    const tasks = record.tasks.map((task) => publicTask(task, record.usage, nowMs));
    const enabled = tasks.filter((task) => task.enabled !== false);
    const due = enabled.filter((task) => task.status.state === 'due').length;
    const dueSoon = enabled.filter((task) => task.status.state === 'due_soon').length;
    const state = due > 0 ? 'due' : dueSoon > 0 ? 'due_soon' : enabled.length > 0 ? 'current' : 'none';
    return {
      state,
      total:enabled.length,
      due,
      dueSoon
    };
  }

  async getSnapshot(printers = []) {
    const nowMs = this.nowFn();
    const configured = Array.isArray(printers) ? printers : [];
    return {
      generatedAt:nowIso(nowMs),
      printers:configured.map((printer) => {
        const record = printerRecord(this.state, printer.id);
        const tasks = record.tasks.map((task) => publicTask(task, record.usage, nowMs));
        return {
          printerId:printer.id,
          printerName:printer.name,
          manufacturer:printer.manufacturer || null,
          model:printer.model || null,
          usage:{
            printHours:Number((record.usage.printSeconds / 3600).toFixed(2)),
            printSeconds:Number(record.usage.printSeconds.toFixed(1)),
            printCount:record.usage.printCount,
            updatedAt:record.usage.updatedAt || null,
            source:'controller-observed'
          },
          summary:{
            total:tasks.filter((task) => task.enabled !== false).length,
            due:tasks.filter((task) => task.status.state === 'due').length,
            dueSoon:tasks.filter((task) => task.status.state === 'due_soon').length
          },
          tasks,
          history:[...record.history].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
        };
      })
    };
  }

  async addTask(printerId, input = {}) {
    await this.assertPrinter(printerId);
    const record = printerRecord(this.state, printerId);
    const nowMs = this.nowFn();
    const task = {
      id:crypto.randomUUID(),
      name:cleanText(input.name, { required:true, max:100, label:'Maintenance task name' }),
      description:cleanText(input.description, { max:1000, label:'Maintenance task description', multiline:true }),
      schedule:normalizeSchedule(input.schedule),
      enabled:input.enabled !== false,
      createdAt:nowIso(nowMs),
      updatedAt:nowIso(nowMs),
      baseline:{
        printSeconds:Number(record.usage.printSeconds || 0),
        printCount:Number(record.usage.printCount || 0)
      },
      lastCompletedAt:null,
      lastCompletedUsage:null
    };
    record.tasks.push(task);
    await this.persistNow();
    return publicTask(task, record.usage, nowMs);
  }

  async updateTask(printerId, taskId, input = {}) {
    await this.assertPrinter(printerId);
    const record = printerRecord(this.state, printerId);
    const task = record.tasks.find((item) => item.id === taskId);
    if (!task) {
      const error = new Error('Maintenance task not found');
      error.statusCode = 404;
      throw error;
    }
    if (input.name !== undefined) task.name = cleanText(input.name, { required:true, max:100, label:'Maintenance task name' });
    if (input.description !== undefined) task.description = cleanText(input.description, { max:1000, label:'Maintenance task description', multiline:true });
    if (input.schedule !== undefined) task.schedule = normalizeSchedule(input.schedule);
    if (input.enabled !== undefined) task.enabled = input.enabled !== false;
    task.updatedAt = nowIso(this.nowFn());
    await this.persistNow();
    return publicTask(task, record.usage, this.nowFn());
  }

  async deleteTask(printerId, taskId) {
    await this.assertPrinter(printerId);
    const record = printerRecord(this.state, printerId);
    const before = record.tasks.length;
    record.tasks = record.tasks.filter((item) => item.id !== taskId);
    if (record.tasks.length === before) {
      const error = new Error('Maintenance task not found');
      error.statusCode = 404;
      throw error;
    }
    await this.persistNow();
    return true;
  }

  async completeTask(printerId, taskId, notes = '') {
    await this.assertPrinter(printerId);
    const record = printerRecord(this.state, printerId);
    const task = record.tasks.find((item) => item.id === taskId);
    if (!task) {
      const error = new Error('Maintenance task not found');
      error.statusCode = 404;
      throw error;
    }
    const completedAt = nowIso(this.nowFn());
    const usageSnapshot = {
      printSeconds:Number(record.usage.printSeconds || 0),
      printHours:Number((Number(record.usage.printSeconds || 0) / 3600).toFixed(2)),
      printCount:Number(record.usage.printCount || 0)
    };
    const entry = {
      id:crypto.randomUUID(),
      taskId:task.id,
      taskName:task.name,
      completedAt,
      notes:cleanText(notes, { max:1000, label:'Maintenance notes', multiline:true }),
      usageSnapshot
    };
    record.history.unshift(entry);
    record.history = record.history.slice(0, HISTORY_LIMIT);
    task.lastCompletedAt = completedAt;
    task.lastCompletedUsage = {
      printSeconds:usageSnapshot.printSeconds,
      printCount:usageSnapshot.printCount
    };
    task.updatedAt = completedAt;
    await this.persistNow();
    return { task:publicTask(task, record.usage, this.nowFn()), history:structuredClone(entry) };
  }
}

export const maintenanceStoreFileName = 'maintenance.json';
