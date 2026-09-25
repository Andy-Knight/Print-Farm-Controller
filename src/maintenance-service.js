import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { controllerDataDir, getPrinter } from './store.js';

const ACTIVE_PRINTER_STATES = new Set(['printing', 'working', 'building_from_sd', 'pause', 'paused']);
const HISTORY_LIMIT = 500;
const MAX_SAMPLE_MS = 120_000;
const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400];
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replaceFileWithRetry(source, destination) {
  let retry = 0;
  while (true) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      const canRetry = TRANSIENT_RENAME_ERRORS.has(error?.code)
        && retry < WINDOWS_RENAME_RETRY_DELAYS_MS.length;
      if (!canRetry) throw error;
      await delay(WINDOWS_RENAME_RETRY_DELAYS_MS[retry]);
      retry += 1;
    }
  }
}

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

function normalizeModelTarget(value) {
  const adapterType = cleanText(value?.adapterType, { required:true, max:80, label:'Printer adapter type' });
  const model = cleanText(value?.model, { required:true, max:100, label:'Printer model' });
  return { adapterType, model };
}

function defaultState() {
  return { version:1, modelTasks:[], printers:{} };
}

function printerRecord(state, printerId) {
  if (!state.printers[printerId]) {
    state.printers[printerId] = {
      usage:{ printSeconds:0, printCount:0, updatedAt:null },
      tasks:[],
      modelTaskState:{},
      history:[]
    };
  }
  const record = state.printers[printerId];
  record.usage ||= { printSeconds:0, printCount:0, updatedAt:null };
  record.tasks = Array.isArray(record.tasks) ? record.tasks : [];
  record.modelTaskState = record.modelTaskState && typeof record.modelTaskState === 'object' && !Array.isArray(record.modelTaskState)
    ? record.modelTaskState
    : {};
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

function matchesModel(printer, target) {
  return String(printer?.adapterType || '').trim().toLowerCase() === String(target?.adapterType || '').trim().toLowerCase()
    && String(printer?.model || '').trim().toLowerCase() === String(target?.model || '').trim().toLowerCase();
}

function taskStatus(task, usage, nowMs) {
  if (task.enabled === false) return { state:'disabled', progress:0, dueAt:null, remaining:null };
  const schedule = normalizeSchedule(task.schedule);
  let progress = 0;
  let remaining = null;
  let dueAt = null;

  if (schedule.type === 'days') {
    const startedAt = new Date(task.lastCompletedAt || task.assignedAt || task.createdAt || 0).getTime();
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

function completionAvailability(task, status) {
  if (task.enabled === false) {
    return {
      allowed:false,
      reason:'Enable this maintenance task before completing it'
    };
  }
  if (!task.lastCompletedAt) {
    return {
      allowed:true,
      reason:null
    };
  }
  if (status.state === 'due_soon' || status.state === 'due') {
    return {
      allowed:true,
      reason:null
    };
  }
  return {
    allowed:false,
    reason:'This task can be completed again when it reaches Due soon (80% of its interval)'
  };
}

function publicTask(task, usage, nowMs) {
  const status = taskStatus(task, usage, nowMs);
  const completion = completionAvailability(task, status);
  return {
    ...structuredClone(task),
    status,
    completionAllowed:completion.allowed,
    completionReason:completion.reason
  };
}

function modelTaskState(record, task, nowMs) {
  let state = record.modelTaskState[task.id];
  if (!state) {
    state = {
      assignedAt:nowIso(nowMs),
      baseline:{
        printSeconds:Number(record.usage.printSeconds || 0),
        printCount:Number(record.usage.printCount || 0)
      },
      lastCompletedAt:null,
      lastCompletedUsage:null
    };
    record.modelTaskState[task.id] = state;
    return { state, created:true };
  }
  state.baseline ||= {
    printSeconds:Number(record.usage.printSeconds || 0),
    printCount:Number(record.usage.printCount || 0)
  };
  state.assignedAt ||= task.createdAt || nowIso(nowMs);
  if (!Object.hasOwn(state, 'lastCompletedAt')) state.lastCompletedAt = null;
  if (!Object.hasOwn(state, 'lastCompletedUsage')) state.lastCompletedUsage = null;
  return { state, created:false };
}

function effectiveModelTask(task, record, nowMs) {
  const { state, created } = modelTaskState(record, task, nowMs);
  return {
    task:{
      ...task,
      assignedAt:state.assignedAt,
      baseline:structuredClone(state.baseline),
      lastCompletedAt:state.lastCompletedAt,
      lastCompletedUsage:state.lastCompletedUsage ? structuredClone(state.lastCompletedUsage) : null,
      assignment:{ scope:'model', ...structuredClone(task.target) },
      inherited:true
    },
    created
  };
}

function localTask(task, printerId) {
  return {
    ...task,
    assignment:{ scope:'printer', printerId },
    inherited:false
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
      raw.modelTasks = Array.isArray(raw.modelTasks) ? raw.modelTasks : [];
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
    const previousSave = this.saveChain.catch(() => {});
    this.saveChain = previousSave.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive:true });
      const temp = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { mode:0o600 });
        await replaceFileWithRetry(temp, this.filePath);
      } finally {
        await fs.rm(temp, { force:true }).catch(() => {});
      }
    });
    return this.saveChain;
  }

  configuredFleet() {
    return Array.isArray(this.fleetState.getFleet?.()) ? this.fleetState.getFleet() : [];
  }

  observeFleet(printers) {
    const nowMs = this.nowFn();
    let changed = false;
    const seen = new Set();

    for (const printer of Array.isArray(printers) ? printers : []) {
      if (!printer?.id) continue;
      seen.add(printer.id);
      const record = printerRecord(this.state, printer.id);

      for (const task of this.state.modelTasks || []) {
        if (!matchesModel(printer, task.target)) continue;
        if (modelTaskState(record, task, nowMs).created) changed = true;
      }

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

  resolvePrinterReference(printerOrId) {
    if (printerOrId && typeof printerOrId === 'object') return printerOrId;
    const printerId = String(printerOrId || '');
    return this.configuredFleet().find((printer) => String(printer.id) === printerId) || { id:printerId };
  }

  effectiveTasks(printer, nowMs = this.nowFn()) {
    if (!printer?.id) return [];
    const record = printerRecord(this.state, printer.id);
    let changed = false;
    const local = record.tasks.map((task) => publicTask(localTask(task, printer.id), record.usage, nowMs));
    const inherited = (this.state.modelTasks || [])
      .filter((task) => matchesModel(printer, task.target))
      .map((task) => {
        const effective = effectiveModelTask(task, record, nowMs);
        if (effective.created) changed = true;
        return publicTask(effective.task, record.usage, nowMs);
      });
    if (changed) this.schedulePersist();
    return [...local, ...inherited];
  }

  getPrinterStatus(printerOrId) {
    const printer = this.resolvePrinterReference(printerOrId);
    const tasks = this.effectiveTasks(printer, this.nowFn());
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
    const printerSnapshots = configured.map((printer) => {
      const record = printerRecord(this.state, printer.id);
      const tasks = this.effectiveTasks(printer, nowMs);
      return {
        printerId:printer.id,
        printerName:printer.name,
        adapterType:printer.adapterType || null,
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
    });

    const modelTasks = (this.state.modelTasks || []).map((task) => {
      const matchingPrinters = printerSnapshots.filter((printer) =>
        String(printer.adapterType || '').toLowerCase() === String(task.target?.adapterType || '').toLowerCase()
        && String(printer.model || '').toLowerCase() === String(task.target?.model || '').toLowerCase()
      );
      const effective = matchingPrinters
        .map((printer) => printer.tasks.find((candidate) =>
          candidate.id === task.id && candidate.assignment?.scope === 'model'
        ))
        .filter(Boolean);
      const eligible = effective.filter((candidate) => candidate.completionAllowed === true).length;
      return {
        ...structuredClone(task),
        assignment:{ scope:'model', ...structuredClone(task.target) },
        completionSummary:{
          matching:matchingPrinters.length,
          eligible,
          locked:Math.max(0, matchingPrinters.length - eligible)
        }
      };
    });

    return {
      generatedAt:nowIso(nowMs),
      modelTasks,
      printers:printerSnapshots
    };
  }

  taskDefinition(input, nowMs) {
    return {
      id:crypto.randomUUID(),
      name:cleanText(input.name, { required:true, max:100, label:'Maintenance task name' }),
      description:cleanText(input.description, { max:1000, label:'Maintenance task description', multiline:true }),
      schedule:normalizeSchedule(input.schedule),
      enabled:input.enabled !== false,
      createdAt:nowIso(nowMs),
      updatedAt:nowIso(nowMs)
    };
  }

  async addTask(printerId, input = {}) {
    await this.assertPrinter(printerId);
    const record = printerRecord(this.state, printerId);
    const nowMs = this.nowFn();
    const task = {
      ...this.taskDefinition(input, nowMs),
      baseline:{
        printSeconds:Number(record.usage.printSeconds || 0),
        printCount:Number(record.usage.printCount || 0)
      },
      lastCompletedAt:null,
      lastCompletedUsage:null
    };
    record.tasks.push(task);
    await this.persistNow();
    return publicTask(localTask(task, printerId), record.usage, nowMs);
  }

  async addModelTask(target, input = {}) {
    const nowMs = this.nowFn();
    const task = {
      ...this.taskDefinition(input, nowMs),
      target:normalizeModelTarget(target)
    };
    this.state.modelTasks ||= [];
    this.state.modelTasks.push(task);

    for (const printer of this.configuredFleet()) {
      if (!matchesModel(printer, task.target)) continue;
      const record = printerRecord(this.state, printer.id);
      modelTaskState(record, task, nowMs);
    }

    await this.persistNow();
    return {
      ...structuredClone(task),
      assignment:{ scope:'model', ...structuredClone(task.target) }
    };
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
    return publicTask(localTask(task, printerId), record.usage, this.nowFn());
  }

  async updateModelTask(taskId, input = {}, target = undefined) {
    this.state.modelTasks ||= [];
    const task = this.state.modelTasks.find((item) => item.id === taskId);
    if (!task) {
      const error = new Error('Model maintenance task not found');
      error.statusCode = 404;
      throw error;
    }

    let targetChanged = false;
    if (target !== undefined) {
      const normalized = normalizeModelTarget(target);
      targetChanged = !matchesModel({ adapterType:task.target?.adapterType, model:task.target?.model }, normalized);
      task.target = normalized;
    }
    if (input.name !== undefined) task.name = cleanText(input.name, { required:true, max:100, label:'Maintenance task name' });
    if (input.description !== undefined) task.description = cleanText(input.description, { max:1000, label:'Maintenance task description', multiline:true });
    if (input.schedule !== undefined) task.schedule = normalizeSchedule(input.schedule);
    if (input.enabled !== undefined) task.enabled = input.enabled !== false;
    task.updatedAt = nowIso(this.nowFn());

    if (targetChanged) {
      for (const record of Object.values(this.state.printers)) {
        if (record?.modelTaskState) delete record.modelTaskState[task.id];
      }
      const nowMs = this.nowFn();
      for (const printer of this.configuredFleet()) {
        if (!matchesModel(printer, task.target)) continue;
        modelTaskState(printerRecord(this.state, printer.id), task, nowMs);
      }
    }

    await this.persistNow();
    return {
      ...structuredClone(task),
      assignment:{ scope:'model', ...structuredClone(task.target) }
    };
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

  async deleteModelTask(taskId) {
    this.state.modelTasks ||= [];
    const before = this.state.modelTasks.length;
    this.state.modelTasks = this.state.modelTasks.filter((item) => item.id !== taskId);
    if (this.state.modelTasks.length === before) {
      const error = new Error('Model maintenance task not found');
      error.statusCode = 404;
      throw error;
    }
    for (const record of Object.values(this.state.printers)) {
      if (record?.modelTaskState) delete record.modelTaskState[taskId];
    }
    await this.persistNow();
    return true;
  }

  async clearHistory(printerId) {
    await this.assertPrinter(printerId);
    const record = printerRecord(this.state, printerId);
    const cleared = record.history.length;
    record.history = [];
    if (cleared > 0) await this.persistNow();
    return { cleared };
  }

  async completeModelTask(taskId, notes = '') {
    this.state.modelTasks ||= [];
    const task = this.state.modelTasks.find((item) => item.id === taskId);
    if (!task) {
      const error = new Error('Model maintenance task not found');
      error.statusCode = 404;
      throw error;
    }

    const cleanNotes = cleanText(notes, { max:1000, label:'Maintenance notes', multiline:true });
    const nowMs = this.nowFn();
    const completedAt = nowIso(nowMs);
    const matching = this.configuredFleet().filter((printer) => matchesModel(printer, task.target));
    const completed = [];
    const skipped = [];

    for (const printer of matching) {
      const record = printerRecord(this.state, printer.id);
      const effective = effectiveModelTask(task, record, nowMs).task;
      const status = taskStatus(effective, record.usage, nowMs);
      const completion = completionAvailability(effective, status);
      if (!completion.allowed) {
        skipped.push({
          printerId:printer.id,
          printerName:printer.name || printer.id,
          reason:completion.reason || 'Maintenance task cannot be completed yet'
        });
        continue;
      }

      const usageSnapshot = {
        printSeconds:Number(record.usage.printSeconds || 0),
        printHours:Number((Number(record.usage.printSeconds || 0) / 3600).toFixed(2)),
        printCount:Number(record.usage.printCount || 0)
      };
      const entry = {
        id:crypto.randomUUID(),
        taskId:task.id,
        taskName:task.name,
        assignment:{ scope:'model', ...structuredClone(task.target) },
        completedAt,
        notes:cleanNotes,
        usageSnapshot
      };
      record.history.unshift(entry);
      record.history = record.history.slice(0, HISTORY_LIMIT);

      const perPrinter = modelTaskState(record, task, nowMs).state;
      perPrinter.lastCompletedAt = completedAt;
      perPrinter.lastCompletedUsage = {
        printSeconds:usageSnapshot.printSeconds,
        printCount:usageSnapshot.printCount
      };

      completed.push({
        printerId:printer.id,
        printerName:printer.name || printer.id,
        history:structuredClone(entry)
      });
    }

    if (completed.length) await this.persistNow();
    return {
      task:{
        ...structuredClone(task),
        assignment:{ scope:'model', ...structuredClone(task.target) }
      },
      summary:{
        matching:matching.length,
        completed:completed.length,
        skipped:skipped.length
      },
      completed,
      skipped
    };
  }

  async completeTask(printerId, taskId, notes = '') {
    const printer = await this.assertPrinter(printerId);
    const record = printerRecord(this.state, printerId);
    const local = record.tasks.find((item) => item.id === taskId);
    const model = local
      ? null
      : (this.state.modelTasks || []).find((item) => item.id === taskId && matchesModel(printer, item.target));
    if (!local && !model) {
      const error = new Error('Maintenance task not found for this printer');
      error.statusCode = 404;
      throw error;
    }

    const nowMs = this.nowFn();
    const effectiveForCompletion = local
      ? localTask(local, printerId)
      : effectiveModelTask(model, record, nowMs).task;
    const statusForCompletion = taskStatus(effectiveForCompletion, record.usage, nowMs);
    const completion = completionAvailability(effectiveForCompletion, statusForCompletion);
    if (!completion.allowed) {
      const error = new Error(completion.reason || 'Maintenance task cannot be completed yet');
      error.statusCode = 409;
      throw error;
    }

    const completedAt = nowIso(nowMs);
    const usageSnapshot = {
      printSeconds:Number(record.usage.printSeconds || 0),
      printHours:Number((Number(record.usage.printSeconds || 0) / 3600).toFixed(2)),
      printCount:Number(record.usage.printCount || 0)
    };
    const assignment = model
      ? { scope:'model', ...structuredClone(model.target) }
      : { scope:'printer', printerId };
    const taskName = (local || model).name;
    const entry = {
      id:crypto.randomUUID(),
      taskId,
      taskName,
      assignment,
      completedAt,
      notes:cleanText(notes, { max:1000, label:'Maintenance notes', multiline:true }),
      usageSnapshot
    };
    record.history.unshift(entry);
    record.history = record.history.slice(0, HISTORY_LIMIT);

    let resultTask;
    if (local) {
      local.lastCompletedAt = completedAt;
      local.lastCompletedUsage = {
        printSeconds:usageSnapshot.printSeconds,
        printCount:usageSnapshot.printCount
      };
      local.updatedAt = completedAt;
      resultTask = publicTask(localTask(local, printerId), record.usage, this.nowFn());
    } else {
      const perPrinter = modelTaskState(record, model, this.nowFn()).state;
      perPrinter.lastCompletedAt = completedAt;
      perPrinter.lastCompletedUsage = {
        printSeconds:usageSnapshot.printSeconds,
        printCount:usageSnapshot.printCount
      };
      const effective = effectiveModelTask(model, record, this.nowFn()).task;
      resultTask = publicTask(effective, record.usage, this.nowFn());
    }

    await this.persistNow();
    return { task:resultTask, history:structuredClone(entry) };
  }
}

export const maintenanceStoreFileName = 'maintenance.json';
