import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePrinterOperation,
  livePrinterActivity,
  PrinterPhysicalActivityTracker,
  PRINTER_OPERATION_TYPES
} from '../src/printer-operation-policy.js';
import { PrinterOperationCoordinator } from '../src/concurrency.js';

const idle = { status:'idle', fileName:null };
const printing = { status:'printing', fileName:'part.gcode' };
const paused = { status:'paused', fileName:'part.gcode' };

test('operation matrix blocks new work during active prints but permits live print controls', () => {
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_START, { status:printing }).allowed, false);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.FILE_UPLOAD_START, { status:printing }).allowed, false);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.BED_LEVEL, { status:printing }).allowed, false);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_PAUSE, { status:printing }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_CANCEL, { status:printing }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.TEMPERATURE, { status:printing }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.FAN, { status:printing }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.FILE_UPLOAD, { status:printing }).allowed, true);
});

test('operation matrix distinguishes paused print controls', () => {
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_RESUME, { status:paused }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_CANCEL, { status:paused }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_START, { status:paused }).allowed, false);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_PAUSE, { status:paused }).allowed, false);
});

test('operation matrix blocks print start while chamber preheat, levelling or calibration is active', () => {
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_START, {
    status:idle,
    chamberPreheatActive:true
  }).allowed, false);

  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_START, {
    status:{ status:'leveling' }
  }).allowed, false);

  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_START, {
    status:{ status:'idle', toolOffsetCalibration:{ available:true, state:'manual_clean' } }
  }).allowed, false);
});

test('manual heating permits thermal controls but blocks new print starts', () => {
  const context = { status:{ status:'heating', fileName:null } };
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.TEMPERATURE, context).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.FAN, context).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.PRINT_START, context).allowed, false);
});

test('camera and metadata controls remain available during maintenance activity', () => {
  const context = { status:{ status:'calibrating' } };
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.CAMERA, context).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.MATERIAL_DESIGNATION, context).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.NOZZLE_DESIGNATION, context).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.TEMPERATURE, context).allowed, false);
});

test('U1 macro activity is treated as busy when no print file is active', () => {
  const activity = livePrinterActivity({
    status:'idle',
    fileName:null,
    machineActivity:{ state:'printing', label:'printer macro/activity' }
  });
  assert.equal(activity.kind, 'busy');
  assert.match(activity.label, /macro/);
});

test('bed levelling tracker bridges the delay before live status reports maintenance activity', () => {
  let now = 1_000;
  const tracker = new PrinterPhysicalActivityTracker({
    nowFn:() => now,
    pendingObservationMs:30_000
  });

  tracker.start('p1', 'bed-leveling', 'bed levelling', { maxDurationMs:600_000 });
  assert.equal(tracker.current('p1', idle)?.kind, 'bed-leveling');

  now += 5_000;
  assert.equal(tracker.current('p1', { status:'leveling' })?.kind, 'bed-leveling');

  now += 5_000;
  assert.equal(tracker.current('p1', idle), null);
});

test('unobserved bed levelling tracker eventually releases after the observation grace period', () => {
  let now = 1_000;
  const tracker = new PrinterPhysicalActivityTracker({
    nowFn:() => now,
    pendingObservationMs:30_000
  });

  tracker.start('p1', 'bed-leveling', 'bed levelling', { maxDurationMs:600_000 });
  now += 29_000;
  assert.ok(tracker.current('p1', idle));
  now += 2_000;
  assert.equal(tracker.current('p1', idle), null);
});

test('sticky tool calibration tracker remains active across idle reports until explicitly cleared', () => {
  const tracker = new PrinterPhysicalActivityTracker();
  tracker.start('u1', 'calibration', 'tool calibration', { sticky:true, maxDurationMs:600_000 });
  assert.equal(tracker.current('u1', idle)?.kind, 'calibration');
  tracker.clear('u1');
  assert.equal(tracker.current('u1', idle), null);
});

test('coordinator applies physical activity policy in addition to transaction locking', async () => {
  const contexts = new Map([
    ['p1', { status:{ status:'leveling' } }],
    ['p2', { status:idle }]
  ]);
  const coordinator = new PrinterOperationCoordinator({
    evaluateFn:evaluatePrinterOperation,
    contextProvider:(id) => contexts.get(id) || { status:idle }
  });

  await assert.rejects(
    coordinator.run('p1', 'print start', async () => {}, { operationType:PRINTER_OPERATION_TYPES.PRINT_START }),
    (error) => {
      assert.equal(error.code, 'PRINTER_BUSY');
      assert.equal(error.statusCode, 409);
      assert.equal(error.conflictCode, 'activity_conflict');
      assert.match(error.message, /bed levelling in progress; print-start is not allowed/);
      return true;
    }
  );

  const result = await coordinator.run(
    'p2',
    'print start',
    async () => 'started',
    { operationType:PRINTER_OPERATION_TYPES.PRINT_START }
  );
  assert.equal(result, 'started');
});


test('heaters-off remains available as a safety operation during levelling and calibration', () => {
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.HEATERS_OFF, {
    status:{ status:'leveling' }
  }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.HEATERS_OFF, {
    status:{ status:'calibrating' }
  }).allowed, true);
});

test('idle calibration step/exit remain available for recovery after controller restart', () => {
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_STEP, { status:idle }).allowed, true);
  assert.equal(evaluatePrinterOperation(PRINTER_OPERATION_TYPES.TOOL_CALIBRATION_EXIT, { status:idle }).allowed, true);
});
