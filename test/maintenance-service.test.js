import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MaintenanceService } from '../src/maintenance-service.js';

class FakeFleet {
  constructor(printers = []) {
    this.printers = printers;
    this.listeners = new Set();
  }
  getFleet() { return this.printers; }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(printers) {
    this.printers = printers;
    for (const listener of this.listeners) listener(printers);
  }
}

function printer(status = 'idle', online = true) {
  return {
    id:'printer-1',
    name:'Printer 1',
    manufacturer:'Test',
    model:'Model',
    online,
    status:{ status, fileName:status === 'printing' ? 'part.gcode' : null }
  };
}

test('maintenance tasks persist, become due, and completion creates history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-maintenance-'));
  let now = Date.parse('2026-09-24T12:00:00Z');
  const fleet = new FakeFleet([printer()]);
  const service = new MaintenanceService({
    fleetState:fleet,
    dataDir:dir,
    printerLookup:async (id) => id === 'printer-1' ? { id } : null,
    nowFn:() => now,
    persistDelayMs:1
  });

  try {
    await service.start();
    const created = await service.addTask('printer-1', {
      name:'Lubricate rails',
      description:'Inspect and lubricate motion rails',
      schedule:{ type:'days', interval:30 }
    });
    assert.equal(created.status.state, 'current');

    now += 31 * 86400000;
    let snapshot = await service.getSnapshot([printer()]);
    assert.equal(snapshot.printers[0].summary.due, 1);
    assert.equal(snapshot.printers[0].tasks[0].status.state, 'due');

    const completed = await service.completeTask('printer-1', created.id, 'Completed during monthly service');
    assert.equal(completed.history.taskName, 'Lubricate rails');
    assert.equal(completed.task.status.state, 'current');

    await service.stop();

    const reloaded = new MaintenanceService({
      fleetState:fleet,
      dataDir:dir,
      printerLookup:async (id) => id === 'printer-1' ? { id } : null,
      nowFn:() => now
    });
    await reloaded.start();
    snapshot = await reloaded.getSnapshot([printer()]);
    assert.equal(snapshot.printers[0].tasks.length, 1);
    assert.equal(snapshot.printers[0].history.length, 1);
    assert.equal(snapshot.printers[0].history[0].notes, 'Completed during monthly service');
    await reloaded.stop();
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('completed maintenance cannot be completed again until Due soon', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-maintenance-repeat-gate-'));
  let now = Date.parse('2026-09-24T12:00:00Z');
  const fleet = new FakeFleet([printer()]);
  const service = new MaintenanceService({
    fleetState:fleet,
    dataDir:dir,
    printerLookup:async () => ({ id:'printer-1' }),
    nowFn:() => now,
    persistDelayMs:1
  });

  try {
    await service.start();
    const task = await service.addTask('printer-1', {
      name:'Lubricate rails',
      schedule:{ type:'days', interval:10 }
    });

    assert.equal(task.completionAllowed, true);
    await service.completeTask('printer-1', task.id, 'Initial service');

    let snapshot = await service.getSnapshot([printer()]);
    let current = snapshot.printers[0].tasks[0];
    assert.equal(current.status.state, 'current');
    assert.equal(current.completionAllowed, false);
    assert.match(current.completionReason, /Due soon \(80%/);

    await assert.rejects(
      () => service.completeTask('printer-1', task.id, 'Too early'),
      (error) => error?.statusCode === 409 && /Due soon \(80%/.test(error.message)
    );

    now += 7 * 86400000;
    snapshot = await service.getSnapshot([printer()]);
    current = snapshot.printers[0].tasks[0];
    assert.equal(current.status.state, 'current');
    assert.equal(current.completionAllowed, false);

    now += 1 * 86400000;
    snapshot = await service.getSnapshot([printer()]);
    current = snapshot.printers[0].tasks[0];
    assert.equal(current.status.state, 'due_soon');
    assert.equal(current.completionAllowed, true);

    await service.completeTask('printer-1', task.id, 'Scheduled service');
    snapshot = await service.getSnapshot([printer()]);
    assert.equal(snapshot.printers[0].history.length, 2);
    assert.equal(snapshot.printers[0].tasks[0].completionAllowed, false);
  } finally {
    await service.stop();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('live maintenance status exposes due-soon and due states for fleet indicators', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-maintenance-live-status-'));
  let now = Date.parse('2026-09-24T12:00:00Z');
  const fleet = new FakeFleet([printer()]);
  const service = new MaintenanceService({
    fleetState:fleet,
    dataDir:dir,
    printerLookup:async () => ({ id:'printer-1' }),
    nowFn:() => now,
    persistDelayMs:1
  });

  try {
    await service.start();
    await service.addTask('printer-1', {
      name:'Lubricate rails',
      schedule:{ type:'days', interval:10 }
    });

    assert.deepEqual(service.getPrinterStatus('printer-1'), {
      state:'current',
      total:1,
      due:0,
      dueSoon:0
    });

    now += 8 * 86400000;
    assert.equal(service.getPrinterStatus('printer-1').state, 'due_soon');
    assert.equal(service.getPrinterStatus('printer-1').dueSoon, 1);

    now += 2 * 86400000;
    assert.equal(service.getPrinterStatus('printer-1').state, 'due');
    assert.equal(service.getPrinterStatus('printer-1').due, 1);
  } finally {
    await service.stop();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('model-wide tasks are inherited without duplication and keep per-printer baselines', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-maintenance-model-'));
  let now = Date.parse('2026-09-24T12:00:00Z');
  const p1 = { ...printer(), id:'printer-1', name:'U1 A', adapterType:'snapmaker-u1', model:'U1' };
  const p2 = { ...printer(), id:'printer-2', name:'U1 B', adapterType:'snapmaker-u1', model:'U1' };
  const other = { ...printer(), id:'printer-3', name:'5M', adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' };
  const fleet = new FakeFleet([p1, other]);
  const lookup = new Map([[p1.id,p1],[p2.id,p2],[other.id,other]]);
  const service = new MaintenanceService({
    fleetState:fleet,
    dataDir:dir,
    printerLookup:async (id) => lookup.get(id) || null,
    nowFn:() => now,
    persistDelayMs:1
  });

  try {
    await service.start();
    const modelTask = await service.addModelTask(
      { adapterType:'snapmaker-u1', model:'U1' },
      { name:'Lubricate rails', schedule:{ type:'days', interval:30 } }
    );

    let snapshot = await service.getSnapshot([p1, other]);
    assert.equal(snapshot.modelTasks.length, 1);
    assert.equal(snapshot.printers.find((item) => item.printerId === p1.id).tasks.length, 1);
    assert.equal(snapshot.printers.find((item) => item.printerId === other.id).tasks.length, 0);
    assert.equal(snapshot.printers.find((item) => item.printerId === p1.id).tasks[0].assignment.scope, 'model');

    now += 10 * 86400000;
    fleet.emit([p1, p2, other]);
    snapshot = await service.getSnapshot([p1, p2, other]);
    const p1Task = snapshot.printers.find((item) => item.printerId === p1.id).tasks[0];
    const p2Task = snapshot.printers.find((item) => item.printerId === p2.id).tasks[0];
    assert.equal(p1Task.id, modelTask.id);
    assert.equal(p2Task.id, modelTask.id);
    assert.notEqual(p1Task.assignedAt, p2Task.assignedAt);
    assert.equal(p2Task.status.state, 'current');

    now += 24 * 86400000;
    await service.completeTask(p1.id, modelTask.id, 'Serviced first printer only');
    snapshot = await service.getSnapshot([p1, p2, other]);
    const afterP1 = snapshot.printers.find((item) => item.printerId === p1.id);
    const afterP2 = snapshot.printers.find((item) => item.printerId === p2.id);
    assert.equal(afterP1.tasks[0].status.state, 'current');
    assert.equal(afterP1.history.length, 1);
    assert.equal(afterP1.history[0].assignment.scope, 'model');
    assert.equal(afterP2.tasks[0].status.state, 'due_soon');

    const raw = JSON.parse(await fs.readFile(path.join(dir, 'maintenance.json'), 'utf8'));
    assert.equal(raw.modelTasks.length, 1);
    assert.equal(raw.printers[p1.id].tasks.length, 0);
    assert.equal(raw.printers[p2.id].tasks.length, 0);
    assert.ok(raw.printers[p1.id].modelTaskState[modelTask.id]);
    assert.ok(raw.printers[p2.id].modelTaskState[modelTask.id]);
  } finally {
    await service.stop();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('maintenance usage tracks observed print time and print cycles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-maintenance-usage-'));
  let now = Date.parse('2026-09-24T12:00:00Z');
  const fleet = new FakeFleet([printer('printing')]);
  const service = new MaintenanceService({
    fleetState:fleet,
    dataDir:dir,
    printerLookup:async () => ({ id:'printer-1' }),
    nowFn:() => now,
    persistDelayMs:1
  });

  try {
    await service.start();

    now += 60_000;
    fleet.emit([printer('printing')]);
    now += 30_000;
    fleet.emit([printer('idle')]);

    let snapshot = await service.getSnapshot([printer()]);
    assert.equal(snapshot.printers[0].usage.printSeconds, 90);
    assert.equal(snapshot.printers[0].usage.printCount, 1);

    const task = await service.addTask('printer-1', {
      name:'Inspect nozzle',
      schedule:{ type:'print_hours', interval:1 }
    });

    for (let minute = 0; minute < 60; minute++) {
      now += 60_000;
      fleet.emit([printer('printing')]);
    }
    now += 60_000;
    fleet.emit([printer('idle')]);

    snapshot = await service.getSnapshot([printer()]);
    const current = snapshot.printers[0].tasks.find((item) => item.id === task.id);
    assert.equal(current.status.state, 'due');
    assert.equal(snapshot.printers[0].usage.printCount, 2);
  } finally {
    await service.stop();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('maintenance print-count tasks become due after the configured number of observed print cycles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-maintenance-count-'));
  let now = Date.parse('2026-09-24T12:00:00Z');
  const fleet = new FakeFleet([printer()]);
  const service = new MaintenanceService({
    fleetState:fleet,
    dataDir:dir,
    printerLookup:async () => ({ id:'printer-1' }),
    nowFn:() => now,
    persistDelayMs:1
  });

  try {
    await service.start();
    const task = await service.addTask('printer-1', {
      name:'Clean build surface',
      schedule:{ type:'print_count', interval:2 }
    });

    for (let cycle = 0; cycle < 2; cycle++) {
      now += 1000;
      fleet.emit([printer('printing')]);
      now += 1000;
      fleet.emit([printer('idle')]);
    }

    const snapshot = await service.getSnapshot([printer()]);
    const current = snapshot.printers[0].tasks.find((item) => item.id === task.id);
    assert.equal(current.status.state, 'due');
    assert.equal(snapshot.printers[0].usage.printCount, 2);
  } finally {
    await service.stop();
    await fs.rm(dir, { recursive:true, force:true });
  }
});
