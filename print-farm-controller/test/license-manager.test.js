import test from 'node:test';
import assert from 'node:assert/strict';
import { LICENSE_FEATURES } from '../src/licensing/entitlements.js';
import { LicenseManager } from '../src/licensing/license-manager.js';

test('development edition is unrestricted and non-enforcing', () => {
  const manager = new LicenseManager({ edition:'development' });
  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.edition, 'development');
  assert.equal(snapshot.enforcementEnabled, false);
  assert.equal(snapshot.maxPrinters, null);
  assert.equal(manager.hasFeature('anything.future'), true);
  assert.equal(manager.canAddPrinter(10_000), true);
});

test('commercial editions enable enforcement and expose planned entitlements', () => {
  const community = new LicenseManager({ edition:'community' });
  const pro = new LicenseManager({ edition:'pro' });
  const farm = new LicenseManager({ edition:'farm' });
  assert.equal(community.enforcementEnabled, true);
  assert.equal(community.maxPrinters, 2);
  assert.equal(community.hasFeature(LICENSE_FEATURES.BASIC_CONTROL), true);
  assert.equal(community.hasFeature(LICENSE_FEATURES.SMART_ASSIGNMENT), false);
  assert.equal(pro.maxPrinters, 10);
  assert.equal(pro.hasFeature(LICENSE_FEATURES.JOB_PRIORITY), true);
  assert.equal(pro.hasFeature(LICENSE_FEATURES.SMART_ASSIGNMENT), false);
  assert.equal(farm.maxPrinters, 25);
  assert.equal(farm.hasFeature(LICENSE_FEATURES.SMART_ASSIGNMENT), true);
  assert.equal(farm.hasFeature(LICENSE_FEATURES.AUTO_TRANSFER), true);
});

test('printer limits prevent adding physical printers beyond the edition allowance', () => {
  const manager = new LicenseManager({ edition:'community' });
  assert.equal(manager.canAddPrinter(0), true);
  assert.equal(manager.canAddPrinter(1), true);
  assert.equal(manager.canAddPrinter(2), false);
  assert.throws(() => manager.requirePrinterCapacity(2), (error) => error.code === 'LICENSE_PRINTER_LIMIT');
});

test('an over-limit fleet requires explicit licence-slot selection', () => {
  const manager = new LicenseManager({ edition:'community' });
  const first = manager.resolvePrinterAccess([
    { id:'a', licenseSlotActive:null },
    { id:'b', licenseSlotActive:null },
    { id:'c', licenseSlotActive:null },
    { id:'sim', simulated:true }
  ]);
  assert.equal(first.overLimit, true);
  assert.equal(first.configuredPhysicalPrinters, 3);
  assert.equal(first.activePhysicalPrinters, 0);
  assert.equal(first.simulatedPrinters, 1);
  assert.equal(first.selectionRequired, true);
  assert.equal(first.printers.find((p) => p.id === 'sim').licenseActive, true);
  assert.equal(first.printers.find((p) => p.id === 'a').licenseActive, false);

  const selected = manager.resolvePrinterAccess([
    { id:'a', licenseSlotActive:true },
    { id:'b', licenseSlotActive:true },
    { id:'c', licenseSlotActive:false }
  ]);
  assert.equal(selected.activePhysicalPrinters, 2);
  assert.equal(selected.slotsRemaining, 0);
  assert.equal(selected.selectionRequired, false);
  assert.equal(selected.printers.find((p) => p.id === 'a').licenseActive, true);
  assert.equal(selected.printers.find((p) => p.id === 'c').licenseActive, false);
});

test('fleets within the edition limit remain active without explicit selections', () => {
  const manager = new LicenseManager({ edition:'community' });
  const usage = manager.resolvePrinterAccess([
    { id:'a', licenseSlotActive:false },
    { id:'b', licenseSlotActive:null }
  ]);
  assert.equal(usage.overLimit, false);
  assert.equal(usage.activePhysicalPrinters, 2);
  assert.ok(usage.printers.every((printer) => printer.licenseActive));
});

test('enforcement can still be disabled explicitly for development testing', () => {
  const manager = new LicenseManager({ edition:'community', enforcementEnabled:false });
  assert.doesNotThrow(() => manager.requireFeature(LICENSE_FEATURES.SMART_ASSIGNMENT));
  assert.doesNotThrow(() => manager.requirePrinterCapacity(50));
});

test('an invalid configured edition fails closed to Community', () => {
  const manager = new LicenseManager({ edition:'made-up-edition' });
  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.edition, 'community');
  assert.equal(snapshot.enforcementEnabled, true);
  assert.match(snapshot.configurationWarning, /falling back to Community/i);
});
