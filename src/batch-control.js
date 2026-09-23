import { getPrinter } from './store.js';
import { getPrinterAdapter } from './adapters/adapter-registry.js';
import { isPrintJobActive } from './chamber-preheat.js';

const PAUSED_STATES = new Set(['pause', 'paused']);
const RUNNING_STATES = new Set(['printing', 'working', 'building_from_sd']);
const MAX_BATCH_PRINTERS = 100;

function normalizeIds(printerIds) {
  if (!Array.isArray(printerIds)) throw new Error('printerIds must be an array');
  const ids = [...new Set(printerIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new Error('Select at least one printer');
  if (ids.length > MAX_BATCH_PRINTERS) throw new Error(`A batch may contain at most ${MAX_BATCH_PRINTERS} printers`);
  return ids;
}

function validatePercent(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`${label} must be 0-100%`);
  return number;
}

export function validateBatchRequest({ printerIds, action, params = {} } = {}) {
  const ids = normalizeIds(printerIds);
  const normalizedAction = String(action || '').trim();
  const normalizedParams = { ...(params || {}) };

  if (normalizedAction === 'fans') {
    if (normalizedParams.coolingFan === undefined && normalizedParams.chamberFan === undefined) throw new Error('Supply a cooling and/or chamber fan speed');
    if (normalizedParams.coolingFan !== undefined) normalizedParams.coolingFan = validatePercent(normalizedParams.coolingFan, 'Cooling fan');
    if (normalizedParams.chamberFan !== undefined) normalizedParams.chamberFan = validatePercent(normalizedParams.chamberFan, 'Chamber fan');
  } else if (normalizedAction === 'chamber-preheat-start') {
    normalizedParams.bedTemperature = Number(normalizedParams.bedTemperature);
    normalizedParams.durationMinutes = Number(normalizedParams.durationMinutes);
  } else if (!['chamber-preheat-stop', 'heaters-off', 'pause', 'resume', 'cancel'].includes(normalizedAction)) {
    throw new Error(`Unsupported batch action: ${normalizedAction || '(none)'}`);
  }

  return { printerIds: ids, action: normalizedAction, params: normalizedParams };
}

function ensureCapability(adapter, capability, message) {
  if (!adapter.capabilities?.[capability]) throw new Error(message);
}


export class BatchControlService {
  constructor({
    fleetState,
    chamberPreheat,
    getPrinterFn = getPrinter,
    adapterResolver = getPrinterAdapter,
    setTemperaturesFn = null,
    setFansFn = null,
    setJobStateFn = null,
    printerAllowedFn = null,
    operationCoordinator = null,
    maxConcurrent = 4
  } = {}) {
    if (!fleetState) throw new Error('fleetState is required');
    if (!chamberPreheat) throw new Error('chamberPreheat is required');
    this.fleetState = fleetState;
    this.chamberPreheat = chamberPreheat;
    this.getPrinter = getPrinterFn;
    this.adapterResolver = adapterResolver;
    this.setTemperaturesOverride = setTemperaturesFn;
    this.setFansOverride = setFansFn;
    this.setJobStateOverride = setJobStateFn;
    this.printerAllowed = typeof printerAllowedFn === 'function' ? printerAllowedFn : () => true;
    this.operationCoordinator = operationCoordinator;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 4);
  }

  async execute(request) {
    const { printerIds, action, params } = validateBatchRequest(request);
    if (action === 'chamber-preheat-start' && typeof this.chamberPreheat.validate === 'function') {
      this.chamberPreheat.validate(params);
    }
    const queue = [...printerIds];
    const results = [];

    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        results.push(await this.executeOne(id, action, params));
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.maxConcurrent, queue.length) }, () => worker()));

    const order = new Map(printerIds.map((id, index) => [id, index]));
    results.sort((a, b) => order.get(a.id) - order.get(b.id));
    const succeeded = results.filter((result) => result.ok).length;
    return {
      action,
      requested: printerIds.length,
      succeeded,
      failed: printerIds.length - succeeded,
      results
    };
  }

  async executeOne(id, action, params) {
    if (!this.operationCoordinator) return this.executeOneUnlocked(id, action, params);
    try {
      return await this.operationCoordinator.run(id, `batch ${action}`, () => this.executeOneUnlocked(id, action, params));
    } catch (error) {
      const printer = await this.getPrinter(id).catch(() => null);
      return { id, name:printer?.name || id, ok:false, error:error.message || 'Printer operation is busy' };
    }
  }

  async executeOneUnlocked(id, action, params) {
    const printer = await this.getPrinter(id);
    const name = printer?.name || id;
    if (!printer) return { id, name, ok: false, error: 'Printer not found' };

    const safetyAction = ['chamber-preheat-stop', 'heaters-off', 'pause', 'resume', 'cancel'].includes(action);
    if (!safetyAction && !this.printerAllowed(id)) {
      return { id, name, ok:false, error:'Printer is inactive because it does not currently have a licence slot' };
    }

    const state = this.fleetState.getPrinterState(id);
    if (!state?.online) return { id, name, ok: false, error: state?.error || 'Printer is offline' };

    try {
      const adapter = this.adapterResolver(printer);
      const status = state.status || {};
      const stateName = String(status.status || '').toLowerCase();
      const setTemperatures = (values) => this.setTemperaturesOverride
        ? this.setTemperaturesOverride(printer, values)
        : adapter.setTemperatures(values);
      const setFans = (values) => this.setFansOverride
        ? this.setFansOverride(printer, values)
        : adapter.setFans(values);
      const setJobState = (jobAction) => this.setJobStateOverride
        ? this.setJobStateOverride(printer, jobAction)
        : adapter.setJobState(jobAction);

      switch (action) {
        case 'fans':
          if (params.coolingFan !== undefined) ensureCapability(adapter, 'coolingFan', 'Cooling fan control is not supported');
          if (params.chamberFan !== undefined) ensureCapability(adapter, 'chamberFan', 'Chamber fan control is not supported');
          await setFans(params);
          break;
        case 'chamber-preheat-start':
          ensureCapability(adapter, 'chamberPreheat', 'Chamber preheat is not supported');
          await this.chamberPreheat.start(id, params);
          break;
        case 'chamber-preheat-stop':
          if (!this.chamberPreheat.isActive(id)) throw new Error('Chamber preheat is not active');
          await this.chamberPreheat.stop(id, { reason: 'batch-manual', turnOff: true });
          break;
        case 'heaters-off':
          if (!adapter.capabilities?.nozzleTemperature && !adapter.capabilities?.bedTemperature) throw new Error('Heater control is not supported');
          if (this.chamberPreheat.isActive(id)) {
            await this.chamberPreheat.stop(id, { reason: 'batch-heaters-off', turnOff: false });
          }
          await setTemperatures({
            ...(adapter.capabilities?.nozzleTemperature ? { nozzle: 0, ...(adapter.capabilities?.toolTemperatures ? { allTools: true } : {}) } : {}),
            ...(adapter.capabilities?.bedTemperature ? { bed: 0 } : {})
          });
          break;
        case 'pause':
          ensureCapability(adapter, 'jobControl', 'Job control is not supported');
          if (PAUSED_STATES.has(stateName)) throw new Error('Print is already paused');
          if (!isPrintJobActive(status)) throw new Error('No active print to pause');
          await setJobState('pause');
          break;
        case 'resume':
          ensureCapability(adapter, 'jobControl', 'Job control is not supported');
          if (!PAUSED_STATES.has(stateName)) throw new Error('Printer is not paused');
          await setJobState('resume');
          break;
        case 'cancel':
          ensureCapability(adapter, 'jobControl', 'Job control is not supported');
          if (!isPrintJobActive(status) && !RUNNING_STATES.has(stateName)) throw new Error('No active print to cancel');
          await setJobState('cancel');
          break;
        default:
          throw new Error(`Unsupported batch action: ${action}`);
      }

      return { id, name, ok: true, adapterType: adapter.type };
    } catch (error) {
      return { id, name, ok: false, error: error.message || 'Batch command failed' };
    }
  }
}
