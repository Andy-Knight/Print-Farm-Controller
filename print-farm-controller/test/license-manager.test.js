import test from 'node:test';
import assert from 'node:assert/strict';
import { LICENSE_FEATURES } from '../src/licensing/entitlements.js';
import { LicenseManager } from '../src/licensing/license-manager.js';

test('development edition is unrestricted for feature development', () => {
  const manager = new LicenseManager({ edition:'development' });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.edition, 'development');
  assert.equal(snapshot.maxPrinters, null);
  assert.equal(manager.hasFeature('anything.future'), true);
  assert.equal(manager.canAddPrinter(10_000), true);
});

test('commercial editions expose the planned printer limits and feature entitlements', () => {
  const community = new LicenseManager({ edition:'community' });
  const pro = new LicenseManager({ edition:'pro' });
  const farm = new LicenseManager({ edition:'farm' });

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

test('licence checks are advisory until enforcement is deliberately enabled', () => {
  const manager = new LicenseManager({ edition:'community', enforcementEnabled:false });

  assert.doesNotThrow(() => manager.requireFeature(LICENSE_FEATURES.SMART_ASSIGNMENT));
  assert.doesNotThrow(() => manager.requirePrinterCapacity(50));
});

test('enforcement methods are ready for a later gated release', () => {
  const manager = new LicenseManager({ edition:'community', enforcementEnabled:true });

  assert.doesNotThrow(() => manager.requireFeature(LICENSE_FEATURES.BASIC_CONTROL));
  assert.throws(
    () => manager.requireFeature(LICENSE_FEATURES.SMART_ASSIGNMENT),
    (error) => error.code === 'LICENSE_FEATURE_REQUIRED'
  );

  assert.equal(manager.canAddPrinter(1), true);
  assert.equal(manager.canAddPrinter(2), false);
  assert.throws(
    () => manager.requirePrinterCapacity(2),
    (error) => error.code === 'LICENSE_PRINTER_LIMIT'
  );
});

test('an invalid configured edition fails closed to Community', () => {
  const manager = new LicenseManager({ edition:'made-up-edition' });
  const snapshot = manager.getSnapshot();

  assert.equal(snapshot.edition, 'community');
  assert.match(snapshot.configurationWarning, /falling back to Community/i);
});
