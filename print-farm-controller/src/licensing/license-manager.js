import { getEditionDefinition } from './entitlements.js';

export class LicenseManager {
  constructor({
    edition = process.env.PRINT_CONTROLLER_EDITION || 'development',
    enforcementEnabled = false,
    source = 'development-config'
  } = {}) {
    const requestedEdition = String(edition || 'development').trim().toLowerCase();
    const requestedDefinition = getEditionDefinition(requestedEdition);

    this.requestedEdition = requestedEdition;
    this.definition = requestedDefinition || getEditionDefinition('community');
    this.enforcementEnabled = Boolean(enforcementEnabled);
    this.source = String(source || 'development-config');
    this.configurationWarning = requestedDefinition
      ? null
      : `Unknown licence edition "${requestedEdition}". Falling back to Community.`;
  }

  get edition() {
    return this.definition.id;
  }

  get maxPrinters() {
    return this.definition.maxPrinters;
  }

  hasFeature(feature) {
    const key = String(feature || '').trim();
    if (!key) return false;
    return this.definition.features.includes('*') || this.definition.features.includes(key);
  }

  canAddPrinter(configuredPrinterCount) {
    if (this.maxPrinters == null) return true;
    const count = Number(configuredPrinterCount);
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

  requirePrinterCapacity(configuredPrinterCount) {
    if (!this.enforcementEnabled || this.canAddPrinter(configuredPrinterCount)) return true;
    const error = new Error(
      `${this.definition.name} Edition supports up to ${this.maxPrinters} configured printers`
    );
    error.code = 'LICENSE_PRINTER_LIMIT';
    error.edition = this.edition;
    error.maxPrinters = this.maxPrinters;
    throw error;
  }

  getSnapshot() {
    return {
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
  }
}
