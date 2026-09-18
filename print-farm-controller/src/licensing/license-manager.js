import { getEditionDefinition } from './entitlements.js';

function defaultSimulatedCheck(printer) {
  return printer?.simulated === true;
}

export class LicenseManager {
  constructor({
    edition = process.env.PRINT_CONTROLLER_EDITION || 'development',
    enforcementEnabled = null,
    source = 'development-config'
  } = {}) {
    const requestedEdition = String(edition || 'development').trim().toLowerCase();
    const requestedDefinition = getEditionDefinition(requestedEdition);

    this.requestedEdition = requestedEdition;
    this.definition = requestedDefinition || getEditionDefinition('community');
    this.enforcementEnabled = enforcementEnabled == null
      ? this.definition.id !== 'development'
      : Boolean(enforcementEnabled);
    this.source = String(source || 'development-config');
    this.configurationWarning = requestedDefinition
      ? null
      : `Unknown licence edition "${requestedEdition}". Falling back to Community.`;
  }

  get edition() { return this.definition.id; }
  get maxPrinters() { return this.definition.maxPrinters; }

  hasFeature(feature) {
    const key = String(feature || '').trim();
    if (!key) return false;
    return this.definition.features.includes('*') || this.definition.features.includes(key);
  }

  canAddPrinter(configuredPhysicalPrinterCount) {
    if (!this.enforcementEnabled || this.maxPrinters == null) return true;
    const count = Number(configuredPhysicalPrinterCount);
    if (!Number.isFinite(count) || count < 0) return false;
    return count < this.maxPrinters;
  }

  requireFeature(feature) {
    if (!this.enforcementEnabled || this.hasFeature(feature)) return true;
    const error = new Error(`${this.definition.name} Edition does not include ${feature}`);
    error.code = 'LICENSE_FEATURE_REQUIRED';
    error.feature = String(feature || '');
    error.edition = this.edition;
    throw error;
  }

  requirePrinterCapacity(configuredPhysicalPrinterCount) {
    if (this.canAddPrinter(configuredPhysicalPrinterCount)) return true;
    const error = new Error(
      `${this.definition.name} Edition supports up to ${this.maxPrinters} physical printers. Remove a configured printer or change edition before adding another.`
    );
    error.code = 'LICENSE_PRINTER_LIMIT';
    error.edition = this.edition;
    error.maxPrinters = this.maxPrinters;
    throw error;
  }

  resolvePrinterAccess(printers = [], { isSimulated = defaultSimulatedCheck } = {}) {
    const items = Array.isArray(printers) ? printers : [];
    const simulatedIds = new Set();
    const physical = [];
    for (const printer of items) {
      if (isSimulated(printer)) simulatedIds.add(printer.id);
      else physical.push(printer);
    }

    const overLimit = this.enforcementEnabled && this.maxPrinters != null && physical.length > this.maxPrinters;
    const activePhysicalIds = new Set();

    if (!this.enforcementEnabled || this.maxPrinters == null || !overLimit) {
      for (const printer of physical) activePhysicalIds.add(printer.id);
    } else {
      const selected = physical.filter((printer) => printer.licenseSlotActive === true);
      for (const printer of selected.slice(0, this.maxPrinters)) activePhysicalIds.add(printer.id);
    }

    const activePhysicalPrinters = activePhysicalIds.size;
    const slotsRemaining = this.maxPrinters == null ? null : Math.max(0, this.maxPrinters - activePhysicalPrinters);
    const resolvedPrinters = items.map((printer) => {
      const simulated = simulatedIds.has(printer.id);
      const active = simulated || activePhysicalIds.has(printer.id);
      let reason = null;
      if (simulated) reason = 'simulator';
      else if (active) reason = overLimit ? 'selected-licence-slot' : 'within-edition-limit';
      else if (overLimit) reason = 'licence-limit';
      return {
        ...printer,
        simulated,
        licenseActive: active,
        licenseConsumesSlot: !simulated,
        licenseInactiveReason: active ? null : reason
      };
    });

    return {
      printers: resolvedPrinters,
      configuredPhysicalPrinters: physical.length,
      activePhysicalPrinters,
      inactivePhysicalPrinters: Math.max(0, physical.length - activePhysicalPrinters),
      simulatedPrinters: simulatedIds.size,
      maxPrinters: this.maxPrinters,
      slotsRemaining,
      overLimit,
      selectionRequired: overLimit && activePhysicalPrinters < Math.min(this.maxPrinters, physical.length)
    };
  }

  isPrinterActive(printerId, printers = [], options = {}) {
    return this.resolvePrinterAccess(printers, options).printers
      .find((printer) => printer.id === printerId)?.licenseActive !== false;
  }

  getSnapshot({ printers = null, isSimulated = defaultSimulatedCheck } = {}) {
    const snapshot = {
      edition: this.edition,
      name: this.definition.name,
      label: `${this.definition.name} Edition`,
      maxPrinters: this.maxPrinters,
      features: [...this.definition.features],
      enforcementEnabled: this.enforcementEnabled,
      source: this.source,
      commercial: this.definition.commercial,
      configurationWarning: this.configurationWarning
    };
    if (Array.isArray(printers)) {
      const usage = this.resolvePrinterAccess(printers, { isSimulated });
      Object.assign(snapshot, {
        configuredPhysicalPrinters: usage.configuredPhysicalPrinters,
        activePhysicalPrinters: usage.activePhysicalPrinters,
        inactivePhysicalPrinters: usage.inactivePhysicalPrinters,
        simulatedPrinters: usage.simulatedPrinters,
        slotsRemaining: usage.slotsRemaining,
        overLimit: usage.overLimit,
        selectionRequired: usage.selectionRequired
      });
    }
    return snapshot;
  }
}
