import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  evaluatePrinterOperation,
  PRINTER_OPERATION_TYPES as TYPES
} from '../src/printer-operation-policy.js';
import {
  PrinterOperationCoordinator
} from '../src/concurrency.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('printer operation safety decisions are activity-sensitive, including recovery actions', () => {
  const scenarios = [
    ['idle starts', { status:{ status:'ready' } }, TYPES.PRINT_START, true],
    ['printing blocks start', { status:{ status:'printing', fileName:'part.gcode' } }, TYPES.PRINT_START, false],
    ['printing permits pause', { status:{ status:'printing', fileName:'part.gcode' } }, TYPES.PRINT_PAUSE, true],
    ['paused permits resume', { status:{ status:'paused', fileName:'part.gcode' } }, TYPES.PRINT_RESUME, true],
    ['paused blocks second print', { status:{ status:'paused' } }, TYPES.PRINT_START, false],
    ['chamber preheat blocks start', { status:{ status:'idle' }, chamberPreheatActive:true }, TYPES.PRINT_START, false],
    ['levelling blocks start', { status:{ status:'leveling' } }, TYPES.PRINT_START, false],
    ['levelling permits file transfer', { status:{ status:'leveling' } }, TYPES.FILE_UPLOAD, true],
    ['levelling blocks temperature adjustment', { status:{ status:'leveling' } }, TYPES.TEMPERATURE, false],
    ['levelling permits heater emergency-off', { status:{ status:'leveling' } }, TYPES.HEATERS_OFF, true],
    ['calibration permits recovery exit', { status:{ status:'calibrating' } }, TYPES.TOOL_CALIBRATION_EXIT, true],
    ['calibration blocks new print', { status:{ status:'calibrating' } }, TYPES.PRINT_START, false],
    ['U1 macro blocks start', { status:{ status:'idle', machineActivity:{ state:'printing', label:'macro' } } }, TYPES.PRINT_START, false],
    ['U1 macro permits metadata', { status:{ status:'idle', machineActivity:{ state:'printing', label:'macro' } } }, TYPES.NOZZLE_DESIGNATION, true],
    ['fault blocks print', { status:{ status:'error' } }, TYPES.PRINT_START, false],
    ['fault permits emergency-off', { status:{ status:'error' } }, TYPES.HEATERS_OFF, true],
    ['manual heating blocks print', { status:{ status:'heating', fileName:null } }, TYPES.PRINT_START, false],
    ['manual heating permits temperature', { status:{ status:'heating', fileName:null } }, TYPES.TEMPERATURE, true],
    ['tracked bed level prevents idle telemetry bypass', {
      status:{ status:'idle' }, trackedActivity:{ kind:'bed-leveling', label:'bed levelling' }
    }, TYPES.PRINT_START, false]
  ];
  for (const [name, context, action, allowed] of scenarios) {
    const decision = evaluatePrinterOperation(action, context);
    assert.equal(decision.allowed, allowed, name);
    if (!allowed) {
      assert.equal(decision.code, 'activity_conflict', name);
      assert.ok(decision.message.includes(action), name);
    }
  }
});

test('fault injection detects accidental allowance of print-start during bed levelling', () => {
  const source = readFileSync(new URL('../src/printer-operation-policy.js', import.meta.url), 'utf8');
  const original = "'bed-leveling': new Set([\n    PRINTER_OPERATION_TYPES.FILE_UPLOAD,";
  const mutant = "'bed-leveling': new Set([\n    PRINTER_OPERATION_TYPES.PRINT_START,\n    PRINTER_OPERATION_TYPES.FILE_UPLOAD,";
  assert.equal(source.split(original).length, 2, 'locate the real bed-level policy');
  const mutatedSource = source.replace(original, mutant).replaceAll('export ', '');
  const evaluateMutant = runInNewContext(
    mutatedSource + '\nevaluatePrinterOperation;',
    { Set, Object, String, Number, Boolean, Math }
  );
  const context = { status:{ status:'leveling' } };
  assert.equal(evaluatePrinterOperation(TYPES.PRINT_START, context).allowed, false);
  assert.equal(evaluateMutant(TYPES.PRINT_START, context).allowed, true,
    'a harmful policy mutation violates the behavioral safety assertion');
});

test('live physical activity changes are evaluated at operation dispatch, not when the coordinator is created', async () => {
  let state = { status:{ status:'idle' } };
  const coordinator = new PrinterOperationCoordinator({
    evaluateFn:evaluatePrinterOperation,
    contextProvider:() => state
  });
  const starts = [];
  state = { status:{ status:'leveling' } };
  await assert.rejects(
    coordinator.run('u1', 'new print', async () => starts.push('started'), { operationType:TYPES.PRINT_START }),
    (error) => {
      assert.equal(error.code, 'PRINTER_BUSY');
      assert.equal(error.statusCode, 409);
      assert.equal(error.conflictCode, 'activity_conflict');
      return true;
    }
  );
  assert.deepEqual(starts, [], 'blocked task must not execute');
  state = { status:{ status:'ready' } };
  const started = await coordinator.run('u1', 'new print', async () => {
    starts.push('started');
    return 'ok';
  }, { operationType:TYPES.PRINT_START });
  assert.equal(started, 'ok');
  assert.deepEqual(starts, ['started']);
});

test('concurrent requests are isolated per printer and active same-printer work blocks later actions', async () => {
  const gates = [deferred(), deferred()];
  const coordinator = new PrinterOperationCoordinator({nowFn:() => 1_600_000_000_000});
  const first = coordinator.run(' p1 ', 'bed levelling', () => gates[0].promise);
  const second = coordinator.run('p2', 'file upload', () => gates[1].promise);
  assert.equal(coordinator.isBusy('p1'), true);
  assert.equal(coordinator.isBusy('p2'), true);
  const decision = coordinator.evaluate('p1', TYPES.PRINT_START);
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'transaction_busy');
  let conflictingExecuted = false;
  await assert.rejects(coordinator.run('p1', 'print start', async () => {
    conflictingExecuted = true;
  }, {operationType:TYPES.PRINT_START}), (error) => {
    assert.equal(error.conflictCode, 'transaction_busy');
    assert.equal(error.statusCode, 409);
    assert.match(error.message, /bed levelling/);
    return true;
  });
  assert.equal(conflictingExecuted, false);
  const snapshot = coordinator.current('p1');
  assert.equal(snapshot.operationType, null);
  assert.equal(snapshot.startedAt, '2020-09-13T12:26:40.000Z');
  gates[0].resolve('levelled');
  assert.equal(await first, 'levelled');
  assert.equal(coordinator.isBusy('p1'), false);
  assert.equal(coordinator.isBusy('p2'), true, 'other printer remains independently busy');
  gates[1].resolve('uploaded');
  assert.equal(await second, 'uploaded');
  assert.equal(coordinator.activeOperations().length, 0);
});

test('failed or rejected physical commands never leave a printer permanently locked', async () => {
  const coordinator = new PrinterOperationCoordinator();
  await assert.rejects(coordinator.run('p1', 'bad command', async () => {
    throw new Error('simulated firmware rejection');
  }), /simulated firmware rejection/);
  assert.equal(coordinator.isBusy('p1'), false);
  assert.equal(await coordinator.run('p1', 'retry command', async () => 'recovered'), 'recovered');
  assert.equal(coordinator.activeOperations().length, 0);
});

test('printer operation coordinator rejects empty targets and does not invoke the task', async () => {
  const coordinator = new PrinterOperationCoordinator();
  let executed = false;
  await assert.rejects(coordinator.run('   ', 'print start', async () => {
    executed = true;
  }), /printerId is required/);
  assert.equal(executed, false);
  assert.equal(coordinator.activeOperations().length, 0);
});


test('fault injection exposes a same-printer transaction overlap when the lock check is bypassed', async () => {
  const source = readFileSync(new URL('../src/concurrency.js', import.meta.url), 'utf8');
  const lockGuard = 'if (active) throw new PrinterBusyError(id, active);';
  assert.equal(source.split(lockGuard).length, 2, 'locate production transaction guard');
  const mutatedSource = source.replace(lockGuard, 'if (false) throw new PrinterBusyError(id, active);')
    .replaceAll('export ', '');
  const MutatedCoordinator = runInNewContext(
    mutatedSource + '\nPrinterOperationCoordinator;',
    { Date, Map, Promise, String, Error }
  );

  const normal = new PrinterOperationCoordinator();
  const normalGate = deferred();
  const firstNormal = normal.run('p1', 'level', () => normalGate.promise);
  await assert.rejects(normal.run('p1', 'start print', async () => 'unexpected'), (error) =>
    error.code === 'PRINTER_BUSY' && error.statusCode === 409);
  normalGate.resolve('done');
  await firstNormal;

  const mutated = new MutatedCoordinator();
  const mutantGate = deferred();
  let overlappingStarted = false;
  const firstMutant = mutated.run('p1', 'level', () => mutantGate.promise);
  const secondMutant = mutated.run('p1', 'start print', async () => {
    overlappingStarted = true;
    return 'unsafe overlap';
  });
  assert.equal(await secondMutant, 'unsafe overlap');
  assert.equal(overlappingStarted, true,
    'the isolated mutant allows a print start while levelling is still running');
  mutantGate.resolve('done');
  await firstMutant;
});
