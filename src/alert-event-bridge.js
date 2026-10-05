function printerReference(printer) {
  if (!printer?.id) return null;
  return {
    id:String(printer.id),
    name:printer.name || null,
    adapterType:printer.adapterType || null,
    model:printer.model || null
  };
}

function maintenanceState(service, printer) {
  try {
    return service?.getPrinterStatus?.(printer)?.state || 'none';
  } catch {
    return 'none';
  }
}

export class AlertEventBridge {
  constructor({
    fleetState,
    alertService,
    maintenanceService = null,
    offlineFailureThreshold = 3,
    onAlert = null,
    diagnosticFn = null
  } = {}) {
    if (!fleetState) throw new Error('fleetState is required');
    if (!alertService) throw new Error('alertService is required');
    this.fleetState = fleetState;
    this.alertService = alertService;
    this.maintenanceService = maintenanceService;
    this.offlineFailureThreshold = Math.max(1, Number(offlineFailureThreshold) || 3);
    this.onAlert = typeof onAlert === 'function' ? onAlert : () => {};
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : () => {};
    this.previous = new Map();
    this.unsubscribe = null;
    this.started = false;
    this.observationChain = Promise.resolve();
  }

  snapshotFor(printer) {
    return {
      online:Boolean(printer?.online),
      consecutiveFailures:Math.max(0, Number(printer?.consecutiveFailures || 0)),
      maintenanceState:maintenanceState(this.maintenanceService, printer)
    };
  }

  async emit(input) {
    try {
      const result = await this.alertService.emit(input);
      if (!result?.duplicate) this.onAlert(result.alert);
      return result;
    } catch (error) {
      await Promise.resolve(this.diagnostic('warn', 'Controller event could not be converted to an alert', {
        type:input?.type || null,
        printerId:input?.printer?.id || null,
        error:error?.message || String(error)
      })).catch(() => {});
      return null;
    }
  }

  async observe(printers, { baseline = false } = {}) {
    const fleet = Array.isArray(printers) ? printers : [];
    const seen = new Set();

    for (const printer of fleet) {
      if (!printer?.id) continue;
      const id = String(printer.id);
      seen.add(id);
      const current = this.snapshotFor(printer);
      const previous = this.previous.get(id);

      if (!baseline && previous) {
        const crossedOfflineThreshold = !current.online
          && current.consecutiveFailures >= this.offlineFailureThreshold
          && (previous.online || previous.consecutiveFailures < this.offlineFailureThreshold);
        if (crossedOfflineThreshold) {
          await this.emit({
            type:'printer.offline',
            severity:'warning',
            title:'Printer offline',
            message:`${printer.name || id} is offline after ${current.consecutiveFailures} consecutive connection failures.`,
            source:{ kind:'printer', id, name:printer.name || id },
            printer:printerReference(printer),
            metadata:{
              previousOnline:previous.online,
              consecutiveFailures:current.consecutiveFailures,
              threshold:this.offlineFailureThreshold
            }
          });
        }

        if (previous.maintenanceState !== current.maintenanceState) {
          if (current.maintenanceState === 'due_soon') {
            await this.emit({
              type:'maintenance.due_soon',
              severity:'warning',
              title:'Maintenance due soon',
              message:`${printer.name || id} has maintenance due soon.`,
              source:{ kind:'maintenance', id, name:printer.name || id },
              printer:printerReference(printer),
              metadata:{ previousState:previous.maintenanceState, currentState:current.maintenanceState }
            });
          } else if (current.maintenanceState === 'due') {
            await this.emit({
              type:'maintenance.due',
              severity:'warning',
              title:'Maintenance due',
              message:`${printer.name || id} has maintenance due.`,
              source:{ kind:'maintenance', id, name:printer.name || id },
              printer:printerReference(printer),
              metadata:{ previousState:previous.maintenanceState, currentState:current.maintenanceState }
            });
          }
        }
      }

      this.previous.set(id, current);
    }

    for (const id of this.previous.keys()) {
      if (!seen.has(id)) this.previous.delete(id);
    }
  }

  scheduleObservation(printers) {
    this.observationChain = this.observationChain
      .catch(() => {})
      .then(() => this.observe(printers));
    return this.observationChain;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.observe(this.fleetState.getFleet?.() || [], { baseline:true });
    this.unsubscribe = this.fleetState.subscribe?.((printers) => {
      this.scheduleObservation(printers).catch(() => {});
    }) || null;
  }

  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.started = false;
    await this.observationChain.catch(() => {});
  }
}
