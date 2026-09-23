import crypto from 'node:crypto';
import path from 'node:path';
import { getPrinter } from './store.js';
import { getPrinterAdapter } from './adapters/adapter-registry.js';
import { loadPrintJobs, savePrintJobs } from './queue-store.js';
import { getPrinterFileMaterialMetadata, savePrinterFileMaterialMetadata } from './file-material-store.js';
import { getQueueFile } from './queue-file-store.js';
import { evaluateQueueCompatibility } from './queue-compatibility.js';
import { assessMaterialCompatibility } from './file-material-metadata.js';
import { PRINTER_OPERATION_TYPES } from './printer-operation-policy.js';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_PRINTER_STATES = new Set(['printing', 'working', 'building_from_sd', 'pause', 'paused']);
const IDLE_PRINTER_STATES = new Set(['idle', 'ready', 'standby', 'complete', 'completed', 'cancel', 'cancelled', 'canceled', 'stopped']);
const CANCELLED_PRINTER_STATES = new Set(['cancel', 'cancelled', 'canceled', 'stopped']);
const ACTIVE_QUEUE_STATES = new Set(['uploading', 'preflight', 'starting', 'printing']);
const ERROR_PRINTER_STATES = new Set(['error', 'failed']);
const START_TIMEOUT_MS = 60_000;
const MIN_ACTIVE_MS = 1_500;
const MAX_HISTORY = 250;
const PRIORITIES = new Set(['low', 'normal', 'high']);
const PRIORITY_WEIGHT = { low:0, normal:1, high:2 };
const PRIORITY_BY_WEIGHT = ['low', 'normal', 'high'];
const PRIORITY_AGING_MS = 6 * 60 * 60 * 1000;

const nowIso = () => new Date().toISOString();
const nowMs = () => Date.now();

function normalizePriority(value) {
  const priority = String(value || '').trim().toLowerCase();
  return PRIORITIES.has(priority) ? priority : 'normal';
}

function requirePriority(value) {
  const priority = String(value || '').trim().toLowerCase();
  if (!PRIORITIES.has(priority)) throw new Error('Priority must be High, Normal or Low');
  return priority;
}

function priorityInfo(job, atMs = nowMs()) {
  const priority = normalizePriority(job?.priority);
  const queuedAt = new Date(job?.queuedAt || atMs).getTime();
  const waiting = job?.status === 'queued' || job?.status === 'needs_review';
  const ageBoost = waiting && Number.isFinite(queuedAt)
    ? Math.max(0, Math.floor((atMs - queuedAt) / PRIORITY_AGING_MS))
    : 0;
  const effectiveWeight = Math.min(PRIORITY_WEIGHT.high, PRIORITY_WEIGHT[priority] + ageBoost);
  return {
    priority,
    effectivePriority:PRIORITY_BY_WEIGHT[effectiveWeight],
    priorityAged:effectiveWeight > PRIORITY_WEIGHT[priority]
  };
}

function compareQueuePriority(left, right, positions, atMs = nowMs()) {
  const leftInfo = priorityInfo(left, atMs);
  const rightInfo = priorityInfo(right, atMs);
  const weightDifference = PRIORITY_WEIGHT[rightInfo.effectivePriority] - PRIORITY_WEIGHT[leftInfo.effectivePriority];
  if (weightDifference) return weightDifference;
  return (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER);
}

function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

function basename(value) {
  return path.posix.basename(String(value || '').replace(/\\/g, '/')).toLowerCase();
}

function printIsActive(status = {}) {
  const state = normalizeState(status.status);
  if (ACTIVE_PRINTER_STATES.has(state)) return true;
  // Heating without a filename may be chamber preheat or manual heating.
  if (state === 'heating') return Boolean(status.fileName);
  return false;
}

function printerCanStart(status = {}) {
  const state = normalizeState(status.status);
  // Moonraker and FlashForge may retain the previous filename after a print
  // completes or is cancelled. An explicit terminal/idle state is authoritative;
  // cancellation safety is enforced independently by the clearance interlock.
  if (IDLE_PRINTER_STATES.has(state)) return true;
  if (status.fileName || printIsActive(status)) return false;
  return state === '';
}

function cancellationFingerprint(status = {}) {
  const state = normalizeState(status.status);
  if (!CANCELLED_PRINTER_STATES.has(state)) return null;
  return `${state}|${basename(status.fileName || '')}`;
}

function matchesFile(status = {}, fileName) {
  if (!status.fileName || !fileName) return false;
  return basename(status.fileName) === basename(fileName);
}

function publicJob(job) {
  const stagedFile = job.stagedFile ? {
    id: job.stagedFile.id,
    fileName: job.stagedFile.fileName,
    size: Number(job.stagedFile.size || 0),
    sha256: job.stagedFile.sha256 || null,
    stagedAt: job.stagedFile.stagedAt || null
  } : null;
  return {
    id: job.id,
    productionBatchId: job.productionBatchId || null,
    productionSequence: Number.isInteger(Number(job.productionSequence)) && Number(job.productionSequence) > 0 ? Number(job.productionSequence) : null,
    productionQuantity: Number.isInteger(Number(job.productionQuantity)) && Number(job.productionQuantity) > 0 ? Number(job.productionQuantity) : null,
    productionPaused: job.productionPaused === true,
    ...priorityInfo(job),
    assignmentMode: job.assignmentMode === 'automatic' ? 'automatic' : 'fixed',
    printerId: job.printerId || null,
    printerName: job.printerName || null,
    fileName: job.fileName,
    stagedFile,
    requirements: job.requirements ? structuredClone(job.requirements) : null,
    compatibility: job.compatibility ? structuredClone(job.compatibility) : null,
    selectionReason: job.selectionReason || null,
    status: job.status,
    options: { ...(job.options || {}) },
    queuedAt: job.queuedAt,
    startRequestedAt: job.startRequestedAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    updatedAt: job.updatedAt,
    error: job.error || null,
    maxProgress: Number(job.maxProgress || 0),
    lastPrinterState: job.lastPrinterState || null,
    bedClearanceRequired: job.bedClearanceRequired === true,
    bedClearedAt: job.bedClearedAt || null,
    fileMaterial: job.fileMaterial ? { ...job.fileMaterial, materials: Array.isArray(job.fileMaterial.materials) ? [...job.fileMaterial.materials] : [] } : null
  };
}

function sanitizeOptions(options = {}) {
  const result = {
    levelingBeforePrint: options.levelingBeforePrint !== false,
    flowCalibrationBeforePrint: options.flowCalibrationBeforePrint === true,
    toolMap: options.toolMap && typeof options.toolMap === 'object' ? { ...options.toolMap } : null,
    materialMap: options.materialMap && typeof options.materialMap === 'object' ? { ...options.materialMap } : null,
    usedLogicalTools: Array.isArray(options.usedLogicalTools) ? options.usedLogicalTools.map(Number).filter(Number.isFinite) : []
  };
  for (const key of ['timeLapseBeforePrint', 'autoReplenishFilament', 'filamentEntangleDetect']) {
    if (typeof options[key] === 'boolean') result[key] = options[key];
  }
  if (options.filamentEntangleSensitivity != null) result.filamentEntangleSensitivity = String(options.filamentEntangleSensitivity);
  return result;
}

function normalizedColor(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : null;
}

function normalizedMaterial(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9+_-]/g, '') || null;
}

function buildToolSnapshot(state, toolMap) {
  if (!toolMap || typeof toolMap !== 'object') return [];
  const tools = Array.isArray(state?.status?.tools) ? state.status.tools : [];
  return Object.entries(toolMap).map(([logicalIndex, physicalIndex]) => {
    const physical = tools.find((tool) => Number(tool.index) === Number(physicalIndex));
    if (!physical) return { logicalIndex:Number(logicalIndex), physicalIndex:Number(physicalIndex), missing:true };
    const filament = physical.filament || {};
    return {
      logicalIndex:Number(logicalIndex),
      physicalIndex:Number(physicalIndex),
      present: typeof filament.present === 'boolean' ? filament.present : null,
      color: normalizedColor(filament.color),
      material: normalizedMaterial(filament.material),
      nozzleDiameter: Number.isFinite(Number(physical.nozzleDiameter)) ? Number(physical.nozzleDiameter) : null
    };
  });
}

function checkToolSnapshot(snapshot, status) {
  if (!Array.isArray(snapshot) || !snapshot.length) return [];
  const tools = Array.isArray(status?.tools) ? status.tools : [];
  const problems = [];
  for (const expected of snapshot) {
    const tool = tools.find((item) => Number(item.index) === Number(expected.physicalIndex));
    if (!tool) {
      problems.push(`Physical T${expected.physicalIndex} is no longer reporting status`);
      continue;
    }
    const filament = tool.filament || {};
    if (expected.present === true && filament.present === false) problems.push(`Physical T${expected.physicalIndex} no longer has filament loaded`);
    const currentColor = normalizedColor(filament.color);
    if (expected.color && currentColor !== expected.color) problems.push(`Physical T${expected.physicalIndex} filament colour changed`);
    const currentMaterial = normalizedMaterial(filament.material);
    if (expected.material && currentMaterial !== expected.material) problems.push(`Physical T${expected.physicalIndex} material changed`);
    const currentNozzle = Number(tool.nozzleDiameter);
    if (expected.nozzleDiameter != null && (!Number.isFinite(currentNozzle) || Math.abs(currentNozzle - expected.nozzleDiameter) >= 0.001)) {
      problems.push(`Physical T${expected.physicalIndex} nozzle changed from ${expected.nozzleDiameter.toFixed(1)} mm`);
    }
  }
  return [...new Set(problems)];
}


function cloneProductionRun(template, sequence, quantity, paused = template.productionPaused === true) {
  const timestamp = nowIso();
  return {
    ...structuredClone(template),
    id: crypto.randomUUID(),
    printerId: null,
    printerName: 'Next available compatible printer',
    productionSequence: sequence,
    productionQuantity: quantity,
    productionPaused: paused,
    compatibility: null,
    selectionReason: null,
    options: { ...sanitizeOptions(template.options), toolMap:null, materialMap:null, usedLogicalTools:[] },
    toolSnapshot: [],
    status: 'queued',
    queuedAt: timestamp,
    startRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: timestamp,
    error: null,
    maxProgress: 0,
    lastPrinterState: null,
    bedClearanceRequired: false,
    bedClearedAt: null
  };
}


export class PrintQueueService {
  constructor({
    fleetState,
    chamberPreheat,
    getPrinterFn = getPrinter,
    adapterResolver = getPrinterAdapter,
    loadJobsFn = loadPrintJobs,
    saveJobsFn = savePrintJobs,
    getFileMaterialMetadataFn = getPrinterFileMaterialMetadata,
    saveFileMaterialMetadataFn = savePrinterFileMaterialMetadata,
    getQueueFileFn = getQueueFile,
    printerAllowedFn = null,
    operationCoordinator = null,
    onChange = null,
    diagnosticFn = null,
    startTimeoutMs = START_TIMEOUT_MS,
    minActiveMs = MIN_ACTIVE_MS
  } = {}) {
    if (!fleetState) throw new Error('fleetState is required');
    if (!chamberPreheat) throw new Error('chamberPreheat is required');
    this.fleetState = fleetState;
    this.chamberPreheat = chamberPreheat;
    this.getPrinter = getPrinterFn;
    this.adapterResolver = adapterResolver;
    this.loadJobs = loadJobsFn;
    this.saveJobs = saveJobsFn;
    this.getFileMaterialMetadata = getFileMaterialMetadataFn;
    this.saveFileMaterialMetadata = saveFileMaterialMetadataFn;
    this.getQueueFile = getQueueFileFn;
    this.printerAllowed = typeof printerAllowedFn === 'function' ? printerAllowedFn : () => true;
    this.operationCoordinator = operationCoordinator;
    this.onChange = onChange;
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : null;
    this.diagnosticJobs = new Map();
    this.startTimeoutMs = startTimeoutMs;
    this.minActiveMs = minActiveMs;
    this.jobs = [];
    this.unsubscribe = null;
    this.processing = false;
    this.pendingReconcile = false;
    this.startingPrinters = new Set();
    // FlashForge can hold CANCEL and the old filename indefinitely. Remember
    // operator acknowledgement for that exact terminal report until the printer
    // leaves the cancelled state.
    this.cancelledStateAcknowledgements = new Map();
    // Track any live print seen by the controller, including prints started
    // directly from the printer detail UI or outside the persistent queue.
    // When an observed print leaves an active state, require an explicit bed
    // clearance acknowledgement before an automatic queued job can start.
    this.observedActivePrints = new Map();
    this.untrackedBedClearance = new Map();
    this.saveChain = Promise.resolve();
  }

  async start() {
    this.jobs = (await this.loadJobs()).map((job) => {
      const assignmentMode = job.assignmentMode === 'automatic' ? 'automatic' : 'fixed';
      const interruptedAutomatic = assignmentMode === 'automatic' && ['uploading', 'preflight'].includes(job.status);
      return {
        ...job,
        assignmentMode,
        priority:normalizePriority(job.priority),
        selectionReason:job.selectionReason || null,
        ...(interruptedAutomatic ? { status:'queued', printerId:null, printerName:'Next available compatible printer', error:'Controller restarted before automatic assignment completed; job returned to the queue.' } : {}),
        productionPaused: job.productionPaused === true,
        productionSequence: Number.isInteger(Number(job.productionSequence)) && Number(job.productionSequence) > 0 ? Number(job.productionSequence) : null,
        productionQuantity: Number.isInteger(Number(job.productionQuantity)) && Number(job.productionQuantity) > 0 ? Number(job.productionQuantity) : null,
        options: sanitizeOptions(job.options || {}),
        bedClearanceRequired: job.bedClearanceRequired === true,
        bedClearedAt: job.bedClearedAt || null
      };
    });
    this.diagnosticJobs = new Map(this.jobs.map((job) => [job.id, {
      status:job.status,
      printerId:job.printerId || null,
      error:job.error || null,
      selectionReason:job.selectionReason || null
    }]));
    this.unsubscribe = this.fleetState.subscribe(() => this.scheduleReconcile());
    this.notify();
    this.scheduleReconcile();
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getSnapshot() {
    const positions = new Map(this.jobs.map((job, index) => [job.id, index]));
    const orderedQueued = this.jobs
      .filter((job) => job.status === 'queued')
      .sort((left, right) => compareQueuePriority(left, right, positions));
    let queuedIndex = 0;
    const orderedJobs = this.jobs.map((job) => job.status === 'queued' ? orderedQueued[queuedIndex++] : job);
    const jobs = orderedJobs.map((job) => {
      const currentName = this.fleetState.getPrinterState(job.printerId)?.name;
      return publicJob(currentName ? { ...job, printerName: currentName } : job);
    });
    const bedClearance = this.getBedClearance();
    return {
      jobs,
      queued: jobs.filter((job) => job.status === 'queued').length,
      active: jobs.filter((job) => ACTIVE_QUEUE_STATES.has(job.status)).length,
      history: jobs.filter((job) => TERMINAL_STATES.has(job.status)).length,
      needsReview: jobs.filter((job) => job.status === 'needs_review').length,
      awaitingClearance: bedClearance.length,
      bedClearance,
      productionBatches: this.getProductionBatches()
    };
  }

  getProductionBatches() {
    const groups = new Map();
    for (const job of this.jobs) {
      if (!job.productionBatchId) continue;
      if (!groups.has(job.productionBatchId)) groups.set(job.productionBatchId, []);
      groups.get(job.productionBatchId).push(job);
    }
    return [...groups.entries()].map(([id, batchJobs]) => {
      const runs = [...batchJobs].sort((a, b) => Number(a.productionSequence || 0) - Number(b.productionSequence || 0));
      const queued = runs.filter((job) => job.status === 'queued').length;
      const needsReview = runs.filter((job) => job.status === 'needs_review').length;
      const completed = runs.filter((job) => job.status === 'completed').length;
      const failed = runs.filter((job) => job.status === 'failed').length;
      const cancelled = runs.filter((job) => job.status === 'cancelled').length;
      const active = runs.filter((job) => ACTIVE_QUEUE_STATES.has(job.status)).length;
      const cancelable = runs.filter((job) => ['queued', 'needs_review', 'uploading', 'preflight'].includes(job.status)).length;
      const quantity = Math.max(runs.length, ...runs.map((job) => Number(job.productionQuantity || 0)));
      const finished = runs.every((job) => TERMINAL_STATES.has(job.status));
      const paused = !finished && runs.some((job) => job.productionPaused === true && !TERMINAL_STATES.has(job.status));
      return {
        id,
        fileName: runs[0]?.fileName || 'Production job',
        priority:normalizePriority(runs[0]?.priority),
        effectivePriority:priorityInfo(runs.find((job) => job.status === 'queued' || job.status === 'needs_review') || runs[0]).effectivePriority,
        quantity,
        completed,
        active,
        queued,
        needsReview,
        failed,
        cancelled,
        remaining: queued + needsReview,
        cancelable,
        paused,
        finished,
        stagedFile: runs[0]?.stagedFile ? { ...runs[0].stagedFile } : null,
        queuedAt: runs.map((job) => job.queuedAt).filter(Boolean).sort()[0] || null,
        updatedAt: runs.map((job) => job.updatedAt).filter(Boolean).sort().at(-1) || null,
        runs: runs.map((job) => ({
          id: job.id,
          sequence: Number(job.productionSequence || 0),
          status: job.status,
          printerId: job.printerId || null,
          printerName: this.fleetState.getPrinterState(job.printerId)?.name || job.printerName || null,
          progress: Number(job.maxProgress || 0),
          error: job.error || null,
          bedClearanceRequired: job.bedClearanceRequired === true && !job.bedClearedAt
        }))
      };
    }).sort((a, b) => new Date(a.queuedAt || 0).getTime() - new Date(b.queuedAt || 0).getTime());
  }

  getProductionJobs(batchId) {
    const id = String(batchId || '').trim();
    const jobs = this.jobs.filter((job) => job.productionBatchId === id);
    if (!jobs.length) throw new Error('Production batch not found');
    return jobs;
  }

  async pauseProduction(batchId) {
    const jobs = this.getProductionJobs(batchId);
    let changed = false;
    for (const job of jobs) {
      if (TERMINAL_STATES.has(job.status)) continue;
      if (!job.productionPaused) changed = true;
      job.productionPaused = true;
      job.updatedAt = nowIso();
    }
    if (changed) await this.persistAndNotify();
    return this.getProductionBatches().find((batch) => batch.id === batchId);
  }

  async resumeProduction(batchId) {
    const jobs = this.getProductionJobs(batchId);
    let changed = false;
    for (const job of jobs) {
      if (TERMINAL_STATES.has(job.status)) continue;
      if (job.productionPaused) changed = true;
      job.productionPaused = false;
      job.updatedAt = nowIso();
    }
    if (changed) await this.persistAndNotify();
    this.scheduleReconcile();
    return this.getProductionBatches().find((batch) => batch.id === batchId);
  }

  async cancelProduction(batchId) {
    const jobs = this.getProductionJobs(batchId);
    let cancelled = 0;
    for (const job of jobs) {
      if (!['queued', 'needs_review', 'uploading', 'preflight'].includes(job.status)) continue;
      this.markTerminal(job, 'cancelled', null, { requireBedClearance:false });
      job.productionPaused = false;
      cancelled++;
    }
    if (cancelled) await this.persistAndNotify();
    return { cancelled, batch:this.getProductionBatches().find((batch) => batch.id === batchId) };
  }

  async reprintProduction(batchId) {
    const jobs = this.getProductionJobs(batchId);
    if (!jobs.every((job) => TERMINAL_STATES.has(job.status))) {
      throw new Error('Production batch must be finished before it can be reprinted');
    }
    const source = [...jobs].sort((a, b) => Number(a.productionSequence || 0) - Number(b.productionSequence || 0))[0];
    const stagedFileId = source?.stagedFile?.id || null;
    if (!stagedFileId) throw new Error('Production batch no longer has a staged controller file');
    const quantity = Math.max(jobs.length, ...jobs.map((job) => Number(job.productionQuantity || 0)));
    const options = { ...sanitizeOptions(source.options), toolMap:null, materialMap:null, usedLogicalTools:[] };
    return this.add({
      assignmentMode:'automatic',
      fileName:source.fileName,
      stagedFileId,
      quantity,
      priority:source.priority,
      options
    });
  }

  async setProductionQuantity(batchId, quantity) {
    const target = Number(quantity);
    if (!Number.isInteger(target) || target < 1 || target > 999) throw new Error('Production quantity must be a whole number from 1 to 999');
    let jobs = this.getProductionJobs(batchId);
    const nonRemovable = jobs.filter((job) => !['queued', 'needs_review'].includes(job.status)).length;
    if (target < nonRemovable) {
      throw new Error(`Production quantity cannot be below ${nonRemovable} because those copies are already preparing, started, or finished`);
    }

    if (target < jobs.length) {
      const removeCount = jobs.length - target;
      const removable = jobs
        .filter((job) => ['queued', 'needs_review'].includes(job.status))
        .sort((a, b) => Number(b.productionSequence || 0) - Number(a.productionSequence || 0));
      if (removable.length < removeCount) throw new Error('Not enough waiting copies remain to reduce the production quantity');
      const removeIds = new Set(removable.slice(0, removeCount).map((job) => job.id));
      this.jobs = this.jobs.filter((job) => !removeIds.has(job.id));
      jobs = this.getProductionJobs(batchId);
    } else if (target > jobs.length) {
      const template = jobs[0];
      const paused = jobs.some((job) => job.productionPaused === true && !TERMINAL_STATES.has(job.status));
      let sequence = Math.max(...jobs.map((job) => Number(job.productionSequence || 0)));
      for (let i = jobs.length; i < target; i++) {
        this.jobs.push(cloneProductionRun(template, ++sequence, target, paused));
      }
      jobs = this.getProductionJobs(batchId);
    }

    for (const job of jobs) {
      job.productionQuantity = target;
      job.updatedAt = nowIso();
    }
    await this.persistAndNotify();
    this.scheduleReconcile();
    return this.getProductionBatches().find((batch) => batch.id === batchId);
  }

  cancelledStateNeedsClearance(printerId) {
    const state = this.fleetState.getPrinterState(printerId);
    const fingerprint = cancellationFingerprint(state?.status || {});
    return fingerprint && this.cancelledStateAcknowledgements.get(printerId) !== fingerprint
      ? fingerprint
      : null;
  }

  getBedClearance() {
    const pending = new Map();
    for (const job of this.jobs) {
      if (!job.bedClearanceRequired || job.bedClearedAt) continue;
      const existing = pending.get(job.printerId);
      if (!existing || new Date(job.finishedAt || job.updatedAt || 0).getTime() > new Date(existing.finishedAt || existing.updatedAt || 0).getTime()) {
        pending.set(job.printerId, {
          printerId:job.printerId,
          printerName:this.fleetState.getPrinterState(job.printerId)?.name || job.printerName,
          jobId:job.id,
          fileName:job.fileName,
          jobStatus:job.status,
          finishedAt:job.finishedAt || job.updatedAt || null
        });
      }
    }
    for (const [printerId, clearance] of this.untrackedBedClearance) {
      if (pending.has(printerId)) continue;
      const state = this.fleetState.getPrinterState(printerId);
      pending.set(printerId, {
        printerId,
        printerName:state?.name || clearance.printerName || 'Printer',
        jobId:null,
        fileName:clearance.fileName || 'Completed print',
        jobStatus:clearance.jobStatus || 'completed',
        finishedAt:clearance.finishedAt || null
      });
    }
    for (const state of this.fleetState.getFleet()) {
      if (pending.has(state.id) || !this.cancelledStateNeedsClearance(state.id)) continue;
      pending.set(state.id, {
        printerId:state.id,
        printerName:state.name,
        jobId:null,
        fileName:state.status?.fileName || 'Cancelled print',
        jobStatus:'cancelled',
        finishedAt:null
      });
    }
    return [...pending.values()];
  }

  requiresBedClearance(printerId) {
    return this.jobs.some((job) => job.printerId === printerId && job.bedClearanceRequired === true && !job.bedClearedAt)
      || this.untrackedBedClearance.has(printerId)
      || Boolean(this.cancelledStateNeedsClearance(printerId));
  }

  async clearBed(printerId) {
    const pending = this.jobs.filter((job) => job.printerId === printerId && job.bedClearanceRequired === true && !job.bedClearedAt);
    const cancellation = this.cancelledStateNeedsClearance(printerId);
    const untracked = this.untrackedBedClearance.get(printerId) || null;
    if (!pending.length && !cancellation && !untracked) throw new Error('This printer is not waiting for bed clearance');
    const clearedAt = nowIso();
    for (const job of pending) {
      job.bedClearedAt = clearedAt;
      job.updatedAt = clearedAt;
    }
    if (cancellation) this.cancelledStateAcknowledgements.set(printerId, cancellation);
    if (untracked) this.untrackedBedClearance.delete(printerId);
    if (pending.length) await this.persistAndNotify();
    else this.notify();
    this.scheduleReconcile();
    return { printerId, clearedAt, clearedJobs: pending.map((job) => job.id), clearedObservedPrint: Boolean(untracked) };
  }

  getJob(id) {
    const job = this.jobs.find((item) => item.id === id);
    return job ? publicJob(job) : null;
  }

  async add({ printerId, fileName, options = {}, assignmentMode = 'fixed', stagedFileId = null, quantity = 1, priority = 'normal' } = {}) {
    const mode = assignmentMode === 'automatic' ? 'automatic' : 'fixed';
    const requestedQuantity = Number(quantity ?? 1);
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 999) throw new Error('Production quantity must be a whole number from 1 to 999');
    if (requestedQuantity > 1 && mode !== 'automatic') throw new Error('Production quantities greater than one require Next available compatible printer scheduling');
    const productionBatchId = requestedQuantity > 1 ? crypto.randomUUID() : null;
    let stagedFile = null;
    if (stagedFileId) stagedFile = await this.getQueueFile(stagedFileId);
    if (mode === 'automatic' && !stagedFile) throw new Error('Automatic queue jobs require a staged controller file');

    const cleanFileName = String(stagedFile?.fileName || fileName || '').trim();
    if (!cleanFileName) throw new Error('fileName is required');
    let printer = null;
    let adapter = null;
    let liveState = null;
    let toolSnapshot = [];
    let fileMaterial = stagedFile?.requirements?.materialMetadata || null;

    if (mode === 'fixed') {
      printer = await this.getPrinter(String(printerId || ''));
      if (!printer) throw new Error('Printer not found');
      if (!this.printerAllowed(printer.id)) throw new Error('Printer is inactive because it does not currently have a licence slot');
      adapter = this.adapterResolver(printer);
      if (!adapter.capabilities?.printLocalFile) throw new Error('Printing local files is not supported by this printer');
      liveState = this.fleetState.getPrinterState(printer.id);
      if (adapter.capabilities?.printToolMapping) {
        if (!liveState?.online || !Array.isArray(liveState.status?.tools) || !liveState.status.tools.length) {
          throw new Error('Live U1 toolhead status is required before queueing a mapped print');
        }
        const requiredLogical = Array.isArray(options.usedLogicalTools) ? options.usedLogicalTools.map(Number).filter(Number.isFinite) : [];
        for (const logicalIndex of requiredLogical) {
          if (options.toolMap?.[logicalIndex] === undefined && options.toolMap?.[String(logicalIndex)] === undefined) {
            throw new Error(`Queued U1 print is missing a physical head mapping for file T${logicalIndex}`);
          }
        }
      }
      if (adapter.capabilities?.materialSlotMapping) {
        if (!liveState?.online || !Array.isArray(liveState.status?.materialSources)) throw new Error('Live Bambu AMS status is required before queueing a mapped print');
        const requiredLogical = Array.isArray(options.usedLogicalTools) ? options.usedLogicalTools.map(Number).filter(Number.isFinite) : [];
        for (const logicalIndex of requiredLogical) {
          if (options.materialMap?.[logicalIndex] === undefined && options.materialMap?.[String(logicalIndex)] === undefined) {
            throw new Error(`Queued Bambu print is missing an AMS/external-spool mapping for file T${logicalIndex}`);
          }
        }
      }
      toolSnapshot = adapter.capabilities?.printToolMapping ? buildToolSnapshot(liveState, options.toolMap) : [];
      if (!fileMaterial) {
        try { fileMaterial = await this.getFileMaterialMetadata(printer.id, cleanFileName); } catch { fileMaterial = null; }
      }
    }

    const job = {
      id: crypto.randomUUID(),
      productionBatchId,
      productionSequence: productionBatchId ? 1 : null,
      productionQuantity: productionBatchId ? requestedQuantity : null,
      productionPaused: false,
      priority:requirePriority(priority),
      assignmentMode: mode,
      printerId: mode === 'fixed' ? printer.id : null,
      printerName: mode === 'fixed' ? printer.name : 'Next available compatible printer',
      fileName: cleanFileName,
      stagedFile: stagedFile ? {
        id: stagedFile.id,
        fileName: stagedFile.fileName,
        size: stagedFile.size,
        sha256: stagedFile.sha256,
        stagedAt: stagedFile.stagedAt
      } : null,
      requirements: stagedFile?.requirements ? structuredClone(stagedFile.requirements) : null,
      compatibility: null,
      selectionReason: null,
      options: sanitizeOptions(options),
      toolSnapshot,
      fileMaterial,
      status: 'queued',
      queuedAt: nowIso(),
      startRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: nowIso(),
      error: null,
      maxProgress: 0,
      lastPrinterState: null,
      bedClearanceRequired: false,
      bedClearedAt: null
    };
    this.jobs.push(job);
    if (productionBatchId) {
      for (let sequence = 2; sequence <= requestedQuantity; sequence++) {
        this.jobs.push(cloneProductionRun(job, sequence, requestedQuantity, false));
      }
    }
    await this.persistAndNotify();
    this.scheduleReconcile();
    return publicJob(job);
  }

  async reprint(id) {
    const source = this.jobs.find((job) => job.id === id);
    if (!source) throw new Error('Print history item not found');
    return this.add({
      assignmentMode: source.assignmentMode || 'fixed',
      printerId: source.assignmentMode === 'automatic' ? null : source.printerId,
      fileName: source.fileName,
      stagedFileId: source.stagedFile?.id || null,
      priority:source.priority,
      options: source.options
    });
  }

  async setPriority(id, priority) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Queued print not found');
    if (!['queued', 'needs_review'].includes(job.status)) throw new Error('Priority can only be changed while a print is waiting');
    job.priority = requirePriority(priority);
    job.updatedAt = nowIso();
    await this.persistAndNotify();
    this.scheduleReconcile();
    return publicJob(job);
  }

  async setProductionPriority(batchId, priority) {
    const jobs = this.getProductionJobs(batchId);
    const nextPriority = requirePriority(priority);
    let changed = false;
    for (const job of jobs) {
      if (TERMINAL_STATES.has(job.status)) continue;
      if (job.priority !== nextPriority) changed = true;
      job.priority = nextPriority;
      job.updatedAt = nowIso();
    }
    if (changed) await this.persistAndNotify();
    this.scheduleReconcile();
    return this.getProductionBatches().find((batch) => batch.id === batchId);
  }

  async recheck(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Queued print not found');
    if (job.status !== 'needs_review') throw new Error('This queued print is not waiting for review');
    if (job.assignmentMode === 'automatic') {
      job.status = 'queued';
      job.printerId = null;
      job.printerName = 'Next available compatible printer';
      job.error = null;
      job.updatedAt = nowIso();
      await this.persistAndNotify();
      this.scheduleReconcile();
      return publicJob(job);
    }
    const printer = await this.getPrinter(job.printerId);
    if (!printer) throw new Error('Printer not found');
    let metadata = job.fileMaterial || null;
    try {
      metadata = await this.getFileMaterialMetadata(job.printerId, job.fileName) || metadata;
    } catch {}
    job.fileMaterial = metadata;
    const materialCheck = assessMaterialCompatibility(printer.adapterConfig?.filamentDesignation, metadata || {});
    if (materialCheck.mismatch) {
      job.error = `Needs review: file requires ${materialCheck.requiredMaterial}, but this printer is manually designated ${materialCheck.designatedMaterial}. Change the designation or cancel the queued job.`;
      job.updatedAt = nowIso();
      await this.persistAndNotify();
      return publicJob(job);
    }
    job.status = 'queued';
    job.error = null;
    job.updatedAt = nowIso();
    await this.persistAndNotify();
    this.scheduleReconcile();
    return publicJob(job);
  }

  async cancel(id, options = {}) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Queued print not found');
    if (TERMINAL_STATES.has(job.status)) return publicJob(job);

    const printerOperationInFlight = Boolean(
      job.printerId
      && (this.startingPrinters.has(job.printerId) || ACTIVE_QUEUE_STATES.has(job.status))
    );
    if (this.operationCoordinator && printerOperationInFlight) {
      return this.operationCoordinator.run(
        job.printerId,
        'queued print cancel',
        () => this.cancelUnlocked(id, options),
        { operationType:PRINTER_OPERATION_TYPES.PRINT_CANCEL }
      );
    }
    return this.cancelUnlocked(id, options);
  }

  async cancelUnlocked(id, { cancelPrinter = true } = {}) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) throw new Error('Queued print not found');
    if (TERMINAL_STATES.has(job.status)) return publicJob(job);

    const mayHavePrintOnBed = job.status === 'starting' || job.status === 'printing';
    if (cancelPrinter && mayHavePrintOnBed) {
      const printer = await this.getPrinter(job.printerId);
      if (!printer) throw new Error('Printer not found');
      const adapter = this.adapterResolver(printer);
      if (!adapter.capabilities?.jobControl) throw new Error('Job control is not supported by this printer');
      await adapter.setJobState('cancel');
    }

    this.markTerminal(job, 'cancelled', null, { requireBedClearance: mayHavePrintOnBed });
    await this.persistAndNotify();
    this.scheduleReconcile();
    return publicJob(job);
  }

  async noteExternalCancel(printerId) {
    const job = this.jobs.find((item) => item.printerId === printerId && (item.status === 'starting' || item.status === 'printing'));
    if (!job) return null;
    this.markTerminal(job, 'cancelled', null, { requireBedClearance: true });
    await this.persistAndNotify();
    return publicJob(job);
  }

  async clearHistory() {
    const before = this.jobs.length;
    const activeProductionIds = new Set(this.jobs.filter((job) => job.productionBatchId && !TERMINAL_STATES.has(job.status)).map((job) => job.productionBatchId));
    this.jobs = this.jobs.filter((job) => !TERMINAL_STATES.has(job.status) || (job.bedClearanceRequired === true && !job.bedClearedAt) || activeProductionIds.has(job.productionBatchId));
    if (this.jobs.length !== before) {
      await this.persistAndNotify();
    }
    return before - this.jobs.length;
  }

  async reorder(jobIds) {
    const queued = this.jobs.filter((job) => job.status === 'queued');
    const requested = Array.isArray(jobIds) ? [...new Set(jobIds.map(String))] : [];
    if (requested.length !== queued.length || requested.some((id) => !queued.some((job) => job.id === id))) {
      throw new Error('Queue order must include every queued job exactly once');
    }
    const positions = new Map(requested.map((id, index) => [id, index]));
    const queuedSorted = [...queued].sort((a, b) => positions.get(a.id) - positions.get(b.id));
    let queueIndex = 0;
    this.jobs = this.jobs.map((job) => job.status === 'queued' ? queuedSorted[queueIndex++] : job);
    await this.persistAndNotify();
    this.scheduleReconcile();
    return this.getSnapshot();
  }

  scheduleReconcile() {
    if (this.processing) {
      this.pendingReconcile = true;
      return;
    }
    queueMicrotask(() => this.reconcile().catch((error) => console.error('Print queue reconcile error:', error)));
  }

  async reconcile() {
    if (this.processing) {
      this.pendingReconcile = true;
      return;
    }
    this.processing = true;
    let changed = false;
    try {
      const fleet = new Map(this.fleetState.getFleet().map((state) => [state.id, state]));
      for (const [printerId, acknowledged] of this.cancelledStateAcknowledgements) {
        if (cancellationFingerprint(fleet.get(printerId)?.status || {}) !== acknowledged) {
          this.cancelledStateAcknowledgements.delete(printerId);
        }
      }
      for (const job of this.jobs) {
        if (job.status !== 'starting' && job.status !== 'printing') continue;
        const state = fleet.get(job.printerId);
        if (!state?.online || !state.status) continue;
        const printerStatus = state.status;
        const stateName = normalizeState(printerStatus.status);
        job.lastPrinterState = stateName || null;
        const progress = Number(printerStatus.progress || 0);

        if (job.status === 'starting') {
          // Do not associate retained filename/progress telemetry with the new
          // job until the printer reports an active print state. This is
          // especially important when reprinting the same filename.
          const active = printIsActive(printerStatus);
          if (active && (!printerStatus.fileName || matchesFile(printerStatus, job.fileName))) {
            job.status = 'printing';
            job.startedAt = job.startedAt || nowIso();
            job.maxProgress = Number.isFinite(progress) && progress >= 0 && progress < 100 ? progress : 0;
            job.updatedAt = nowIso();
            changed = true;
          } else if (job.startRequestedAt && nowMs() - new Date(job.startRequestedAt).getTime() > this.startTimeoutMs) {
            this.markTerminal(job, 'failed', 'Printer did not report the queued print starting', { requireBedClearance: true });
            changed = true;
          }
          continue;
        }

        if (Number.isFinite(progress)) job.maxProgress = Math.max(Number(job.maxProgress || 0), progress);

        if (['cancel', 'cancelled', 'canceled', 'stopped'].includes(stateName)) {
          this.markTerminal(job, 'cancelled', null, { requireBedClearance: true });
          changed = true;
          continue;
        }
        if (ERROR_PRINTER_STATES.has(stateName)) {
          this.markTerminal(job, 'failed', `Printer reported ${stateName}`, { requireBedClearance: true });
          changed = true;
          continue;
        }
        if (printIsActive(printerStatus) && printerStatus.fileName && !matchesFile(printerStatus, job.fileName)) {
          this.markTerminal(job, 'completed', null, { requireBedClearance: true });
          changed = true;
          continue;
        }
        const startedMs = new Date(job.startedAt || job.startRequestedAt || 0).getTime();
        if (!printIsActive(printerStatus) && nowMs() - startedMs >= this.minActiveMs) {
          this.markTerminal(job, 'completed', null, { requireBedClearance: true });
          changed = true;
        }
      }

      // Observe print transitions independently of persistent queue jobs. This
      // protects automatic scheduling after prints started directly from the
      // controller or at the printer itself: once such a print finishes, the
      // build plate must be acknowledged clear before another queued job starts.
      for (const state of fleet.values()) {
        if (!state?.online || !state.status) continue;
        const active = printIsActive(state.status);
        const observed = this.observedActivePrints.get(state.id);

        if (active) {
          this.observedActivePrints.set(state.id, {
            printerName:state.name || observed?.printerName || 'Printer',
            fileName:state.status.fileName || observed?.fileName || 'Active print',
            startedAt:observed?.startedAt || nowIso()
          });
          continue;
        }

        if (!observed) continue;
        this.observedActivePrints.delete(state.id);

        // A persistent queue job already creates its own durable clearance
        // record. Only create a transient printer-level interlock when the
        // completed print was not represented by one of those jobs.
        const queuedClearance = this.jobs.some((job) =>
          job.printerId === state.id
          && job.bedClearanceRequired === true
          && !job.bedClearedAt
        );
        if (queuedClearance) continue;

        const stateName = normalizeState(state.status.status);
        const jobStatus = CANCELLED_PRINTER_STATES.has(stateName)
          ? 'cancelled'
          : ERROR_PRINTER_STATES.has(stateName) ? 'failed' : 'completed';
        this.untrackedBedClearance.set(state.id, {
          printerName:state.name || observed.printerName || 'Printer',
          fileName:observed.fileName || state.status.fileName || 'Completed print',
          jobStatus,
          finishedAt:nowIso()
        });
        changed = true;
      }

      // Priority is evaluated before manual queue order. Every six hours a
      // waiting job gains one effective priority level so lower-priority work
      // cannot be starved indefinitely.
      const queuePositions = new Map(this.jobs.map((job, index) => [job.id, index]));
      const automaticJobs = this.jobs
        .filter((job) => job.status === 'queued' && job.assignmentMode === 'automatic' && job.productionPaused !== true)
        .sort((left, right) => compareQueuePriority(left, right, queuePositions));
      for (const job of automaticJobs) {
        const evaluation = await this.refreshAutomaticCompatibility(job, fleet, this.jobs.indexOf(job));
        changed = evaluation.changed || changed;
        const candidate = evaluation.results.find((item) => item.ready);
        if (candidate) this.startAutomaticJob(job, candidate).catch((error) => console.error('Automatic queued print start failed:', error));
      }

      // Fixed-printer jobs use the same priority policy independently for each
      // printer. A review-blocked job only blocks work ranked behind it.
      for (const state of fleet.values()) {
        if (!this.printerAllowed(state.id)) continue;
        if (!state.online || !state.status) continue;
        if (this.startingPrinters.has(state.id)) continue;
        if (this.requiresBedClearance(state.id)) continue;
        if (!printerCanStart(state.status)) continue;
        if (this.jobs.some((job) => job.printerId === state.id && ACTIVE_QUEUE_STATES.has(job.status))) continue;
        const next = this.jobs
          .filter((job) => job.assignmentMode !== 'automatic' && job.printerId === state.id && (job.status === 'queued' || job.status === 'needs_review'))
          .sort((left, right) => compareQueuePriority(left, right, queuePositions))[0];
        if (next?.status === 'queued') this.startJob(next).catch((error) => console.error('Queued print start failed:', error));
      }

      if (changed) await this.persistAndNotify();
    } finally {
      this.processing = false;
      if (this.pendingReconcile) {
        this.pendingReconcile = false;
        this.scheduleReconcile();
      }
    }
  }

  async refreshAutomaticCompatibility(job, fleet, jobIndex = this.jobs.indexOf(job)) {
    const results = [];
    for (const state of fleet.values()) {
      if (!this.printerAllowed(state.id)) {
        results.push({
          printerId:state.id,
          printerName:state.name,
          ready:false,
          category:'blocked',
          reasons:[{ code:'licence_limit', text:'Inactive — no licence slot selected for this printer' }]
        });
        continue;
      }
      const printer = await this.getPrinter(state.id);
      if (!printer) continue;
      let adapter;
      try { adapter = this.adapterResolver(printer); } catch { continue; }
      const positions = new Map(this.jobs.map((other, index) => [other.id, index]));
      const earlierFixedWaiting = this.jobs.some((other) =>
        other.id !== job.id
        && other.assignmentMode !== 'automatic'
        && other.printerId === state.id
        && (other.status === 'queued' || other.status === 'needs_review')
        && compareQueuePriority(other, job, positions) < 0
      );
      const reserved = this.startingPrinters.has(state.id) || earlierFixedWaiting || this.jobs.some((other) =>
        other.id !== job.id && other.printerId === state.id && ACTIVE_QUEUE_STATES.has(other.status)
      );
      const operationDecision = this.operationCoordinator
        ? this.operationCoordinator.evaluate(state.id, PRINTER_OPERATION_TYPES.FILE_UPLOAD_START)
        : { allowed:true, activity:null };
      const result = evaluateQueueCompatibility({
        job,
        printer,
        state,
        adapter,
        bedClearanceRequired:this.requiresBedClearance(state.id),
        operationBusy:operationDecision.allowed === false ? (operationDecision.activity || { label:'another printer activity' }) : null,
        reserved
      });
      result.fileAlreadyPresent = false;
      if (result.ready) {
        try {
          result.fileAlreadyPresent = (await adapter.verifyFile(job.fileName))?.verified === true;
        } catch {}
      }
      results.push(result);
    }
    results.sort((left, right) => {
      if (left.ready && right.ready && left.fileAlreadyPresent !== right.fileAlreadyPresent) {
        return Number(right.fileAlreadyPresent) - Number(left.fileAlreadyPresent);
      }
      return 0;
    });
    const summarize = (category) => results.filter((item) => item.category === category).map((item) => ({
      printerId:item.printerId,
      printerName:item.printerName,
      reasons:item.reasons.map((reason) => ({ ...reason })),
      ...(item.toolMap ? { toolMap:{ ...item.toolMap } } : {}),
      ...(item.materialMap ? { materialMap:{ ...item.materialMap } } : {}),
      ...(item.ready ? { fileAlreadyPresent:item.fileAlreadyPresent === true } : {})
    }));
    const next = {
      evaluatedAt:nowIso(),
      ready:summarize('ready'),
      blocked:summarize('blocked'),
      needsReview:summarize('needs_review'),
      incompatible:summarize('incompatible')
    };
    const previousComparable = job.compatibility ? { ...job.compatibility, evaluatedAt:null } : null;
    const nextComparable = { ...next, evaluatedAt:null };
    const changed = JSON.stringify(previousComparable) !== JSON.stringify(nextComparable);
    job.compatibility = next;
    return { results, changed };
  }

  async ensureStagedFileAvailable(job, printer, adapter, state) {
    if (!job.stagedFile?.id) return { uploaded:false, verified:true, source:'printer-existing' };
    const staged = await this.getQueueFile(job.stagedFile.id);
    let verification = null;
    try { verification = await adapter.verifyFile(job.fileName); } catch {}
    if (verification?.verified) return { uploaded:false, verified:true, source:verification.source || 'printer-existing' };

    await adapter.uploadFile(staged.filePath, {
      fileName:job.fileName,
      firmwareVersion:state?.status?.firmwareVersion,
      levelingBeforePrint:job.options?.levelingBeforePrint !== false
    });
    verification = await adapter.verifyFile(job.fileName);
    if (!verification?.verified) throw new Error(verification?.warning || 'Upload completed, but the staged queue file could not be verified on the printer');
    const materialMetadata = job.requirements?.materialMetadata || staged.requirements?.materialMetadata || null;
    if (materialMetadata?.metadataAvailable) {
      await this.saveFileMaterialMetadata(printer.id, job.fileName, materialMetadata).catch(() => {});
      job.fileMaterial = materialMetadata;
    }
    return { uploaded:true, verified:true, source:verification.source || null };
  }

  resetAutomaticAssignment(job, error = null) {
    job.status = 'queued';
    job.printerId = null;
    job.printerName = 'Next available compatible printer';
    job.selectionReason = null;
    job.options = { ...sanitizeOptions(job.options), toolMap:null, materialMap:null, usedLogicalTools:[] };
    job.toolSnapshot = [];
    job.startRequestedAt = null;
    job.error = error || null;
    job.updatedAt = nowIso();
  }

  async startAutomaticJob(job, candidate) {
    if (!this.operationCoordinator || !candidate?.printerId) return this.startAutomaticJobUnlocked(job, candidate);
    try {
      return await this.operationCoordinator.run(
        candidate.printerId,
        'queued print preparation and start',
        () => this.startAutomaticJobUnlocked(job, candidate),
        { operationType:PRINTER_OPERATION_TYPES.FILE_UPLOAD_START }
      );
    } catch (error) {
      if (error?.code === 'PRINTER_BUSY') {
        if (error.conflictCode === 'transaction_busy') {
          const timer = setTimeout(() => this.scheduleReconcile(), 100);
          timer.unref?.();
        }
        return;
      }
      throw error;
    }
  }

  async startAutomaticJobUnlocked(job, candidate) {
    if (!job || job.status !== 'queued' || job.assignmentMode !== 'automatic' || !candidate?.printerId) return;
    if (!this.printerAllowed(candidate.printerId)) return;
    if (this.startingPrinters.has(candidate.printerId)) return;
    this.startingPrinters.add(candidate.printerId);
    try {
      const printer = await this.getPrinter(candidate.printerId);
      if (!printer) {
        this.resetAutomaticAssignment(job, 'Selected printer is no longer configured');
        await this.persistAndNotify();
        return;
      }
      const adapter = this.adapterResolver(printer);
      const state = this.fleetState.getPrinterState(printer.id);
      if (!state?.online || !state.status) {
        this.resetAutomaticAssignment(job, 'Selected printer went offline before assignment');
        await this.persistAndNotify();
        return;
      }
      const freshStatus = await adapter.getStatus();
      const freshEvaluation = evaluateQueueCompatibility({
        job,
        printer,
        state:{ ...state, online:true, status:freshStatus },
        adapter,
        bedClearanceRequired:this.requiresBedClearance(printer.id),
        reserved:false
      });
      if (!freshEvaluation.ready) {
        this.resetAutomaticAssignment(job, freshEvaluation.reasons.map((reason) => reason.text).join('; ') || 'Printer is no longer ready');
        await this.persistAndNotify();
        return;
      }

      job.printerId = printer.id;
      job.printerName = printer.name;
      const effectivePriority = priorityInfo(job).effectivePriority;
      job.selectionReason = candidate.fileAlreadyPresent
        ? `${printer.name} selected because this file is already verified on the printer and its live setup is compatible (${effectivePriority} priority).`
        : `${printer.name} selected as the first compatible idle printer for this ${effectivePriority} priority job.`;
      job.options = {
        ...sanitizeOptions(job.options),
        toolMap:freshEvaluation.toolMap ? { ...freshEvaluation.toolMap } : null,
        materialMap:freshEvaluation.materialMap ? { ...freshEvaluation.materialMap } : null,
        usedLogicalTools:Array.isArray(job.requirements?.requiredTools) ? [...job.requirements.requiredTools] : []
      };
      job.status = 'uploading';
      job.error = null;
      job.updatedAt = nowIso();
      await this.persistAndNotify();
      await this.ensureStagedFileAvailable(job, printer, adapter, { ...state, status:freshStatus });
      if (TERMINAL_STATES.has(job.status)) return;
      if (job.productionPaused === true) {
        this.resetAutomaticAssignment(job);
        await this.persistAndNotify();
        return;
      }

      job.status = 'preflight';
      job.updatedAt = nowIso();
      await this.persistAndNotify();
      const finalStatus = await adapter.getStatus();
      if (TERMINAL_STATES.has(job.status)) return;
      const finalEvaluation = evaluateQueueCompatibility({
        job,
        printer,
        state:{ ...state, online:true, status:finalStatus },
        adapter,
        bedClearanceRequired:this.requiresBedClearance(printer.id),
        reserved:false
      });
      if (!finalEvaluation.ready) {
        this.resetAutomaticAssignment(job, finalEvaluation.reasons.map((reason) => reason.text).join('; ') || 'Printer failed final preflight');
        await this.persistAndNotify();
        return;
      }
      job.options = {
        ...sanitizeOptions(job.options),
        toolMap:finalEvaluation.toolMap ? { ...finalEvaluation.toolMap } : job.options.toolMap,
        materialMap:finalEvaluation.materialMap ? { ...finalEvaluation.materialMap } : job.options.materialMap
      };

      const materialCheck = assessMaterialCompatibility(printer.adapterConfig?.filamentDesignation, job.fileMaterial || job.requirements?.materialMetadata || {});
      if (materialCheck.mismatch) {
        job.status = 'needs_review';
        job.error = `Needs review: file requires ${materialCheck.requiredMaterial}, but ${printer.name} is manually designated ${materialCheck.designatedMaterial}.`;
        job.updatedAt = nowIso();
        await this.persistAndNotify();
        return;
      }
      job.toolSnapshot = adapter.capabilities?.printToolMapping ? buildToolSnapshot({ status:finalStatus }, job.options.toolMap) : [];
      if (job.productionPaused === true) {
        this.resetAutomaticAssignment(job);
        await this.persistAndNotify();
        return;
      }
      if (this.chamberPreheat.isActive(printer.id)) {
        await this.chamberPreheat.stop(printer.id, { reason:'queued-print-started', turnOff:false });
      }
      if (TERMINAL_STATES.has(job.status)) return;
      if (job.productionPaused === true) {
        this.resetAutomaticAssignment(job);
        await this.persistAndNotify();
        return;
      }
      job.status = 'starting';
      job.startRequestedAt = nowIso();
      job.maxProgress = 0;
      job.updatedAt = nowIso();
      await this.persistAndNotify();
      await adapter.printLocalFile(job.fileName, sanitizeOptions(job.options));
      await this.fleetState.refreshNow(printer.id).catch(() => {});
    } catch (error) {
      if (TERMINAL_STATES.has(job.status)) {
        await this.persistAndNotify();
        return;
      }
      if (job.productionPaused === true) {
        this.resetAutomaticAssignment(job);
        await this.persistAndNotify();
        return;
      }
      if (job.status === 'starting') {
        this.markTerminal(job, 'failed', error.message || 'Automatic queued print failed to start', { requireBedClearance:true });
      } else {
        job.status = 'needs_review';
        job.error = `${job.printerName || 'Selected printer'}: ${error.message || 'Automatic queue preparation failed'}`;
        job.updatedAt = nowIso();
      }
      await this.persistAndNotify();
    } finally {
      this.startingPrinters.delete(candidate.printerId);
      this.scheduleReconcile();
    }
  }

  async startJob(job) {
    if (!this.operationCoordinator || !job?.printerId) return this.startJobUnlocked(job);
    try {
      return await this.operationCoordinator.run(
        job.printerId,
        'queued print preparation and start',
        () => this.startJobUnlocked(job),
        { operationType:PRINTER_OPERATION_TYPES.FILE_UPLOAD_START }
      );
    } catch (error) {
      if (error?.code === 'PRINTER_BUSY') {
        if (error.conflictCode === 'transaction_busy') {
          const timer = setTimeout(() => this.scheduleReconcile(), 100);
          timer.unref?.();
        }
        return;
      }
      throw error;
    }
  }

  async startJobUnlocked(job) {
    if (!job || job.status !== 'queued' || !this.printerAllowed(job.printerId) || this.startingPrinters.has(job.printerId) || this.requiresBedClearance(job.printerId)) return;
    this.startingPrinters.add(job.printerId);
    try {
      if (this.requiresBedClearance(job.printerId)) return;
      const state = this.fleetState.getPrinterState(job.printerId);
      if (!state?.online || !state.status || !printerCanStart(state.status)) return;
      const printer = await this.getPrinter(job.printerId);
      if (!printer) throw new Error('Printer not found');
      const adapter = this.adapterResolver(printer);
      if (!adapter.capabilities?.printLocalFile) throw new Error('Printing local files is not supported by this printer');
      let freshStatus = await adapter.getStatus();
      if (!printerCanStart(freshStatus)) return;
      if (job.stagedFile?.id) {
        job.status = 'uploading';
        job.updatedAt = nowIso();
        await this.persistAndNotify();
        await this.ensureStagedFileAvailable(job, printer, adapter, { ...state, status:freshStatus });
        if (TERMINAL_STATES.has(job.status)) return;
        job.status = 'preflight';
        job.updatedAt = nowIso();
        await this.persistAndNotify();
        freshStatus = await adapter.getStatus();
        if (!printerCanStart(freshStatus)) {
          job.status = 'queued';
          job.updatedAt = nowIso();
          await this.persistAndNotify();
          return;
        }
      }
      let latestFileMaterial = job.fileMaterial || job.requirements?.materialMetadata || null;
      try {
        latestFileMaterial = await this.getFileMaterialMetadata(job.printerId, job.fileName) || latestFileMaterial;
      } catch {}
      job.fileMaterial = latestFileMaterial;
      const materialCheck = assessMaterialCompatibility(printer.adapterConfig?.filamentDesignation, latestFileMaterial || {});
      if (materialCheck.mismatch) {
        job.status = 'needs_review';
        job.error = `Needs review: file requires ${materialCheck.requiredMaterial}, but this printer is manually designated ${materialCheck.designatedMaterial}. Change the designation, then recheck this queued job.`;
        job.updatedAt = nowIso();
        await this.persistAndNotify();
        return;
      }
      if (adapter.capabilities?.printToolMapping && Array.isArray(job.toolSnapshot) && job.toolSnapshot.length) {
        const problems = checkToolSnapshot(job.toolSnapshot, freshStatus);
        if (problems.length) {
          throw new Error(`U1 toolhead state changed since this job was queued: ${problems.join('; ')}. Review Print setup and queue the job again.`);
        }
      }
      if (adapter.capabilities?.materialSlotMapping && job.options?.materialMap) {
        const sources = Array.isArray(freshStatus?.materialSources) ? freshStatus.materialSources : [];
        for (const protocolIndex of Object.values(job.options.materialMap).map(Number)) {
          const source = sources.find((item) => Number(item.protocolIndex) === protocolIndex);
          if (!source || source.present === false) throw new Error(`Bambu material source ${protocolIndex} is no longer loaded. Review AMS Print setup and queue the job again.`);
        }
      }
      if (this.chamberPreheat.isActive(job.printerId)) {
        await this.chamberPreheat.stop(job.printerId, { reason: 'queued-print-started', turnOff: false });
      }

      job.status = 'starting';
      job.startRequestedAt = nowIso();
      job.maxProgress = 0;
      job.updatedAt = nowIso();
      job.error = null;
      await this.persistAndNotify();

      await adapter.printLocalFile(job.fileName, sanitizeOptions(job.options));
      await this.fleetState.refreshNow(job.printerId).catch(() => {});
    } catch (error) {
      this.markTerminal(job, 'failed', error.message || 'Queued print failed to start', { requireBedClearance: job.status === 'starting' });
      await this.persistAndNotify();
    } finally {
      this.startingPrinters.delete(job.printerId);
      this.scheduleReconcile();
    }
  }

  markTerminal(job, status, error, { requireBedClearance = false } = {}) {
    job.status = status;
    job.error = error || null;
    job.finishedAt = nowIso();
    job.updatedAt = job.finishedAt;
    job.bedClearanceRequired = requireBedClearance === true;
    job.bedClearedAt = requireBedClearance ? null : (job.bedClearedAt || null);
    this.trimHistory();
  }

  trimHistory() {
    const activeProductionIds = new Set(this.jobs.filter((job) => job.productionBatchId && !TERMINAL_STATES.has(job.status)).map((job) => job.productionBatchId));
    const removableTerminal = this.jobs.filter((job) => TERMINAL_STATES.has(job.status) && !(job.bedClearanceRequired === true && !job.bedClearedAt) && !activeProductionIds.has(job.productionBatchId));
    const pendingClearanceCount = this.jobs.filter((job) => TERMINAL_STATES.has(job.status) && job.bedClearanceRequired === true && !job.bedClearedAt).length;
    const removableLimit = Math.max(0, MAX_HISTORY - pendingClearanceCount);
    if (removableTerminal.length <= removableLimit) return;
    const remove = new Set(removableTerminal.slice(0, removableTerminal.length - removableLimit).map((job) => job.id));
    this.jobs = this.jobs.filter((job) => !remove.has(job.id));
  }

  emitDiagnosticTransitions() {
    if (!this.diagnostic) return;
    const currentIds = new Set();
    for (const job of this.jobs) {
      currentIds.add(job.id);
      const next = {
        status:job.status,
        printerId:job.printerId || null,
        error:job.error || null,
        selectionReason:job.selectionReason || null
      };
      const previous = this.diagnosticJobs.get(job.id);
      const changed = !previous
        || previous.status !== next.status
        || previous.printerId !== next.printerId
        || previous.error !== next.error
        || previous.selectionReason !== next.selectionReason;
      if (changed) {
        const level = ['failed', 'needs_review'].includes(job.status) ? 'warn' : 'info';
        Promise.resolve(this.diagnostic(level, previous ? 'Queue job state changed' : 'Queue job added', {
          jobId:job.id,
          fileName:job.fileName,
          assignmentMode:job.assignmentMode,
          previousStatus:previous?.status || null,
          status:job.status,
          printerId:job.printerId || null,
          printerName:job.printerName || null,
          priority:job.priority || 'normal',
          selectionReason:job.selectionReason || null,
          error:job.error || null
        })).catch(() => {});
      }
      this.diagnosticJobs.set(job.id, next);
    }
    for (const id of this.diagnosticJobs.keys()) {
      if (!currentIds.has(id)) this.diagnosticJobs.delete(id);
    }
  }

  async persistAndNotify() {
    const snapshot = structuredClone(this.jobs);
    const save = this.saveChain.then(() => this.saveJobs(snapshot));
    this.saveChain = save.catch(() => {});
    await save;
    this.emitDiagnosticTransitions();
    this.notify();
  }

  notify() {
    try { this.onChange?.(this.getSnapshot()); } catch {}
  }
}

export const printQueueHelpers = { printIsActive, printerCanStart, matchesFile, sanitizeOptions, buildToolSnapshot, checkToolSnapshot, normalizePriority, priorityInfo, compareQueuePriority };
