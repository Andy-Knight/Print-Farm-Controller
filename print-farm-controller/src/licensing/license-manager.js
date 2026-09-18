import { getEditionDefinition } from './entitlements.js';

function defaultSimulatedCheck(printer) {
  return printer?.simulated === true;
}

function normalizeAdditionalFeatures(features) {
  if (!Array.isArray(features)) return [];
  return [...new Set(features.map((feature) => String(feature || '').trim()).filter(Boolean))];
}

export class LicenseManager {
  constructor({
    edition = process.env.PRINT_CONTROLLER_EDITION || 'development',
    enforcementEnabled = null,
    source = 'development-config',
    maxPrinters = undefined,
    additionalFeatures = null,
    configurationWarning = null,
    licenseStatus = null,
    licenseDetails = null
  } = {}) {
    const requestedEdition = String(edition || 'development').trim().toLowerCase();
    const requestedDefinition = getEditionDefinition(requestedEdition);

    this.requestedEdition = requestedEdition;
    this.definition = requestedDefinition || getEditionDefinition('community');
    this.maxPrintersOverride = Number.isInteger(Number(maxPrinters)) && Number(maxPrinters) >= 1
      ? Number(maxPrinters)
      : null;
    this.additionalFeatures = normalizeAdditionalFeatures(additionalFeatures);
    this.enforcementEnabled = enforcementEnabled == null
      ? this.definition.id !== 'development'
      : Boolean(enforcementEnabled);
    this.source = String(source || 'development-config');
    this.configurationWarning = configurationWarning || (requestedDefinition
      ? null
      : `Unknown licence edition "${requestedEdition}". Falling back to Community.`);
    this.licenseStatus = licenseStatus || (this.definition.id === 'development' ? 'development-override' : null);
    this.licenseDetails = licenseDetails && typeof licenseDetails === 'object'
      ? { ...licenseDetails }
      : null;
  }

  get edition() { return this.definition.id; }

  get maxPrinters() {
    return this.maxPrintersOverride ?? this.definition.maxPrinters;
  }

  get features() {
    if (this.definition.features.includes('*')) return ['*'];
    return [...new Set([...this.definition.features, ...this.additionalFeatures])];
  }

  hasFeature(feature) {
    const key = String(feature || '').trim();
    if (!key) return false;
    const features = this.features;
    return features.includes('*') || features.includes(key);
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
    const details = this.licenseDetails || {};
    const snapshot = {
      edition: this.edition,
      name: this.definition.name,
      label: `${this.definition.name} Edition`,
      maxPrinters: this.maxPrinters,
      features: this.features,
      enforcementEnabled: this.enforcementEnabled,
      source: this.source,
      commercial: this.definition.commercial,
      configurationWarning: this.configurationWarning,
      licenseStatus: this.licenseStatus,
      licenseId: details.licenseId || null,
      customer: details.customer || null,
      licenseType: details.licenseType || null,
      issuedAt: details.issuedAt || null,
      expiresAt: details.expiresAt || null,
      updatesUntil: details.updatesUntil || null,
      updatesExpired: details.updatesExpired === true,
      signatureKeyId: details.signatureKeyId || null,
      licenseFile: details.licenseFile || null
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
