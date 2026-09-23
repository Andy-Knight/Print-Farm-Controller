const PRINTING_STATES = new Set(['printing', 'working', 'building_from_sd']);
const PAUSED_STATES = new Set(['pause', 'paused']);
const FAULT_STATES = new Set(['error', 'fault', 'failed', 'alarm']);
const IDLE_STATES = new Set(['', 'idle', 'ready', 'standby', 'complete', 'completed', 'cancel', 'cancelled', 'canceled', 'stopped']);
const BED_LEVEL_STATES = new Set([
  'leveling', 'levelling', 'bed_leveling', 'bed levelling', 'bed leveling',
  'mesh_calibration', 'bed_mesh_calibrate', 'probing', 'homing'
]);
const CALIBRATION_STATES = new Set(['calibrating', 'calibration', 'tool_calibration', 'tool calibration']);
const CALIBRATION_IDLE_STATES = new Set(['', 'idle', 'ready', 'standby', 'complete', 'completed', 'done', 'none']);

export const PRINTER_OPERATION_TYPES = Object.freeze({
  PRINT_START:'print-start',
  PRINT_PAUSE:'print-pause',
  PRINT_RESUME:'print-resume',
  PRINT_CANCEL:'print-cancel',
  FILE_UPLOAD:'file-upload',
  FILE_UPLOAD_START:'file-upload-start',
  TEMPERATURE:'temperature',
  FAN:'fan',
  FILTRATION:'filtration',
  CHAMBER_PREHEAT_START:'chamber-preheat-start',
  CHAMBER_PREHEAT_STOP:'chamber-preheat-stop',
  BED_LEVEL:'bed-level',
  TOOL_CALIBRATION_START:'tool-calibration-start',
  TOOL_CALIBRATION_STEP:'tool-calibration-step',
  TOOL_CALIBRATION_EXIT:'tool-calibration-exit',
  FILAMENT_CONFIG:'filament-config',
  CAMERA:'camera',
  LICENSE_SLOT:'license-slot',
  PRINTER_REMOVAL:'printer-removal',
  MATERIAL_DESIGNATION:'material-designation',
  NOZZLE_DESIGNATION:'nozzle-designation',
  HEATERS_OFF:'heaters-off'
});

const ALL = new Set(Object.values(PRINTER_OPERATION_TYPES));
const SAFE_METADATA = new Set([
  PRINTER_OPERATION_TYPES.CAMERA,
  PRINTER_OPERATION_TYPES.LICENSE_SLOT,
  PRINTER_OPERATION_TYPES.MATERIAL_DESIGNATION,
  PRINTER_OPERATION_TYPES.NOZZLE_DESIGNATION
]);
const LIVE_PRINT_CONTROLS = new Set([
  PRINTER_OPERATION_TYPES.TEMPERATURE,
  PRINTER_OPERATION_TYPES.FAN,
  PRINTER_OPERATION_TYPES.FILTRATION,
  PRINTER_OPERATION_TYPES.FILE_UPLOAD,
  PRINTER_OPERATION_TYPES.CAMERA,
  PRINTER_OPERATION_TYPES.LICENSE_SLOT,
  PRINTER_OPERATION_TYPES.MATERIAL_DESIGNATION,
  PRINTER_OPERATION_TYPES.NOZZLE_DESIGNATION,
  PRINTER_OPERATION_TYPES.HEATERS_OFF
]);

const ALLOWED_BY_ACTIVITY = Object.freeze({
  idle: new Set([
    PRINTER_OPERATION_TYPES.PRINT_START,
    PRINTER_OPERATION_TYPES.FILE_UPLOAD,
    PRINTER_OPERATION_TYPES.FILE_UPLOAD_START,
    PRINTER_OPERATION_TYPES.TEMPERATURE,
    PRINTER_OPERATION_TYPES.FAN,
    PRINTER_OPERATION_TYPES.FILTRATION,
    PRINTER_OPERATION_TYPES.CHAMBER_PREHEAT_START,
    PRINTER_OPERATION_TYPES.CHAMBER_PREHEAT_STOP,
    PRINTER_OPERATION_TYPES.BED_LEVEL,
    PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_START,
    PRINTER_OPERATION_TYPES.FILAMENT_CONFIG,
    PRINTER_OPERATION_TYPES.CAMERA,
    PRINTER_OPERATION_TYPES.LICENSE_SLOT,
    PRINTER_OPERATION_TYPES.PRINTER_REMOVAL,
    PRINTER_OPERATION_TYPES.MATERIAL_DESIGNATION,
    PRINTER_OPERATION_TYPES.NOZZLE_DESIGNATION,
    PRINTER_OPERATION_TYPES.HEATERS_OFF
  ]),
  printing: new Set([
    ...LIVE_PRINT_CONTROLS,
    PRINTER_OPERATION_TYPES.PRINT_PAUSE,
    PRINTER_OPERATION_TYPES.PRINT_CANCEL
  ]),
  paused: new Set([
    ...LIVE_PRINT_CONTROLS,
    PRINTER_OPERATION_TYPES.PRINT_RESUME,
    PRINTER_OPERATION_TYPES.PRINT_CANCEL
  ]),
  'chamber-preheat': new Set([
    PRINTER_OPERATION_TYPES.CHAMBER_PREHEAT_STOP,
    PRINTER_OPERATION_TYPES.TEMPERATURE,
    PRINTER_OPERATION_TYPES.FAN,
    PRINTER_OPERATION_TYPES.FILTRATION,
    PRINTER_OPERATION_TYPES.FILE_UPLOAD,
    ...SAFE_METADATA,
    PRINTER_OPERATION_TYPES.HEATERS_OFF
  ]),
  'bed-leveling': new Set([
    PRINTER_OPERATION_TYPES.FILE_UPLOAD,
    ...SAFE_METADATA
  ]),
  calibration: new Set([
    PRINTER_OPERATION_TYPES.FILE_UPLOAD,
    PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_STEP,
    PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_EXIT,
    ...SAFE_METADATA
  ]),
  fault: new Set([
    PRINTER_OPERATION_TYPES.PRINT_CANCEL,
    PRINTER_OPERATION_TYPES.CHAMBER_PREHEAT_STOP,
    PRINTER_OPERATION_TYPES.TEMPERATURE,
    PRINTER_OPERATION_TYPES.FAN,
    PRINTER_OPERATION_TYPES.FILTRATION,
    PRINTER_OPERATION_TYPES.CAMERA,
    PRINTER_OPERATION_TYPES.LICENSE_SLOT,
    PRINTER_OPERATION_TYPES.PRINTER_REMOVAL,
    PRINTER_OPERATION_TYPES.HEATERS_OFF
  ]),
  busy: new Set([
    PRINTER_OPERATION_TYPES.PRINT_CANCEL,
    PRINTER_OPERATION_TYPES.FILE_UPLOAD,
    PRINTER_OPERATION_TYPES.CAMERA,
    PRINTER_OPERATION_TYPES.LICENSE_SLOT,
    PRINTER_OPERATION_TYPES.MATERIAL_DESIGNATION,
    PRINTER_OPERATION_TYPES.NOZZLE_DESIGNATION,
    PRINTER_OPERATION_TYPES.HEATERS_OFF
  ])
});

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function toolCalibrationActive(status = {}) {
  const calibration = status.toolOffsetCalibration;
  if (!calibration?.available) return false;
  const state = normalized(calibration.state);
  return Boolean(state && !CALIBRATION_IDLE_STATES.has(state));
}

export function livePrinterActivity(status = {}) {
  const state = normalized(status.status);
  if (FAULT_STATES.has(state)) return { kind:'fault', label:'printer fault', source:'live' };
  if (PAUSED_STATES.has(state)) return { kind:'paused', label:'paused print', source:'live' };
  if (PRINTING_STATES.has(state) || (state === 'heating' && status.fileName)) {
    return { kind:'printing', label:'active print', source:'live' };
  }
  if (toolCalibrationActive(status)) return { kind:'calibration', label:'tool calibration', source:'live' };
  if (BED_LEVEL_STATES.has(state)) return { kind:'bed-leveling', label:'bed levelling', source:'live' };
  if (CALIBRATION_STATES.has(state)) return { kind:'calibration', label:'calibration', source:'live' };

  const machineState = normalized(status.machineActivity?.state || status.machineActivity);
  if (['printing', 'busy', 'working'].includes(machineState) && !status.fileName) {
    return { kind:'busy', label:status.machineActivity?.label || 'printer macro/activity', source:'live' };
  }
  if (IDLE_STATES.has(state)) return { kind:'idle', label:'idle', source:'live' };
  return { kind:'busy', label:state ? `printer state ${state}` : 'printer activity', source:'live' };
}

export function effectivePrinterActivity({ status = {}, chamberPreheatActive = false, trackedActivity = null } = {}) {
  const live = livePrinterActivity(status);
  if (live.kind === 'fault' || live.kind === 'printing' || live.kind === 'paused') return live;
  if (trackedActivity) return { ...trackedActivity, source:trackedActivity.source || 'controller' };
  if (chamberPreheatActive) return { kind:'chamber-preheat', label:'chamber preheat', source:'controller' };
  return live;
}

export function evaluatePrinterOperation(operationType, context = {}) {
  const type = String(operationType || '').trim();
  if (!ALL.has(type)) {
    return { allowed:false, code:'unknown_operation', message:`Unknown printer operation: ${type || '(none)'}`, activity:null };
  }

  const activity = effectivePrinterActivity(context);
  const allowed = ALLOWED_BY_ACTIVITY[activity.kind] || ALLOWED_BY_ACTIVITY.busy;
  if (allowed.has(type)) return { allowed:true, code:null, message:null, activity };

  return {
    allowed:false,
    code:'activity_conflict',
    activity,
    message:`Printer busy — ${activity.label} blocks ${type}`
  };
}

export class PrinterPhysicalActivityTracker {
  constructor({ nowFn = () => Date.now(), pendingObservationMs = 30_000 } = {}) {
    this.now = nowFn;
    this.pendingObservationMs = pendingObservationMs;
    this.activities = new Map();
  }

  start(printerId, kind, label, { sticky = false, maxDurationMs = 60 * 60_000 } = {}) {
    const id = String(printerId || '').trim();
    if (!id) throw new Error('printerId is required');
    const startedAtMs = this.now();
    const activity = {
      kind,
      label:label || kind,
      source:'controller',
      startedAt:new Date(startedAtMs).toISOString(),
      startedAtMs,
      pendingUntilMs:startedAtMs + this.pendingObservationMs,
      expiresAtMs:startedAtMs + maxDurationMs,
      sticky:Boolean(sticky),
      observed:false
    };
    this.activities.set(id, activity);
    return this.current(id);
  }

  clear(printerId) {
    return this.activities.delete(String(printerId || ''));
  }

  current(printerId, status = null) {
    const id = String(printerId || '');
    const activity = this.activities.get(id);
    if (!activity) return null;
    const now = this.now();
    if (now >= activity.expiresAtMs) {
      this.activities.delete(id);
      return null;
    }

    if (status && !activity.sticky) {
      const live = livePrinterActivity(status);
      const matches = activity.kind === live.kind
        || (activity.kind === 'bed-leveling' && live.kind === 'busy')
        || (activity.kind === 'calibration' && live.kind === 'busy');
      if (matches && live.kind !== 'idle') activity.observed = true;

      if (activity.observed && live.kind === 'idle') {
        this.activities.delete(id);
        return null;
      }
      if (!activity.observed && now >= activity.pendingUntilMs && live.kind === 'idle') {
        this.activities.delete(id);
        return null;
      }
    }

    const { startedAtMs, pendingUntilMs, expiresAtMs, ...publicActivity } = activity;
    return { ...publicActivity };
  }
}

export const printerOperationPolicyInternals = {
  ALLOWED_BY_ACTIVITY,
  BED_LEVEL_STATES,
  CALIBRATION_STATES,
  IDLE_STATES,
  PAUSED_STATES,
  PRINTING_STATES,
  toolCalibrationActive
};
