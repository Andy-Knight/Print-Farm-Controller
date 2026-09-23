import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyedSerialExecutor, PrinterOperationCoordinator } from '../src/concurrency.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('printer operation coordinator rejects overlapping operations for the same printer', async () => {
  const coordinator = new PrinterOperationCoordinator();
  const gate = deferred();
  const first = coordinator.run('p1', 'print start', async () => {
    await gate.promise;
    return 'done';
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.isBusy('p1'), true);
  assert.equal(coordinator.current('p1').label, 'print start');

  await assert.rejects(
    coordinator.run('p1', 'temperature change', async () => {}),
    (error) => {
      assert.equal(error.code, 'PRINTER_BUSY');
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Printer busy.*print start in progress/);
      return true;
    }
  );

  gate.resolve();
  assert.equal(await first, 'done');
  assert.equal(coordinator.isBusy('p1'), false);
});

test('printer operation coordinator allows different printers concurrently', async () => {
  const coordinator = new PrinterOperationCoordinator();
  const gateA = deferred();
  const gateB = deferred();
  const first = coordinator.run('p1', 'print start', () => gateA.promise);
  const second = coordinator.run('p2', 'bed levelling', () => gateB.promise);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.isBusy('p1'), true);
  assert.equal(coordinator.isBusy('p2'), true);

  gateA.resolve('a');
  gateB.resolve('b');
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
});

test('keyed serial executor preserves order for one shared resource', async () => {
  const executor = new KeyedSerialExecutor();
  const order = [];
  const firstGate = deferred();

  const first = executor.run('queue', async () => {
    order.push('first-start');
    await firstGate.promise;
    order.push('first-end');
  });
  const second = executor.run('queue', async () => {
    order.push('second');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first-start']);

  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  assert.equal(executor.pendingKeys(), 0);
});

test('keyed serial executor releases the resource after a failed mutation', async () => {
  const executor = new KeyedSerialExecutor();
  await assert.rejects(executor.run('registry', async () => {
    throw new Error('failed');
  }), /failed/);

  const result = await executor.run('registry', async () => 'next');
  assert.equal(result, 'next');
  assert.equal(executor.pendingKeys(), 0);
});
