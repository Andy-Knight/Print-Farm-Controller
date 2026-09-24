import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackupInDirectory } from '../src/backup-recovery/backup-service.js';
import { loadBackupSettings, saveBackupSettings } from '../src/backup-recovery/backup-settings-store.js';
import { BackupOperationLock } from '../src/backup-recovery/backup-operation-lock.js';
import {
  nextScheduledBackupAt,
  previousScheduledBackupAt,
  pruneScheduledBackups,
  ScheduledBackupService,
  validateBackupDestination
} from '../src/backup-recovery/scheduled-backup-service.js';

function fakeTimerApi() {
  const timers = [];
  return {
    timers,
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    }
  };
}

async function makeData(root, name = 'data') {
  const dataDir = path.join(root, name);
  await fs.mkdir(dataDir, { recursive:true });
  await fs.writeFile(path.join(dataDir, 'printers.json'), JSON.stringify([{ id:`${name}-printer`, name }]));
  await fs.writeFile(path.join(dataDir, 'print-jobs.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'file-material-metadata.json'), '{}');
  return dataDir;
}

test('next scheduled backup uses controller-local daily and weekly times', () => {
  const beforeDaily = new Date(2026, 8, 24, 1, 30, 0, 0);
  const daily = nextScheduledBackupAt({
    enabled:true,
    frequency:'daily',
    scheduleTime:'02:00',
    scheduleWeekday:1
  }, beforeDaily);
  assert.equal(daily.getFullYear(), 2026);
  assert.equal(daily.getMonth(), 8);
  assert.equal(daily.getDate(), 24);
  assert.equal(daily.getHours(), 2);
  assert.equal(daily.getMinutes(), 0);

  const afterDaily = nextScheduledBackupAt({
    enabled:true,
    frequency:'daily',
    scheduleTime:'02:00',
    scheduleWeekday:1
  }, new Date(2026, 8, 24, 2, 30, 0, 0));
  assert.equal(afterDaily.getDate(), 25);
  assert.equal(afterDaily.getHours(), 2);

  const monday = nextScheduledBackupAt({
    enabled:true,
    frequency:'weekly',
    scheduleTime:'03:15',
    scheduleWeekday:1
  }, new Date(2026, 8, 24, 12, 0, 0, 0));
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getHours(), 3);
  assert.equal(monday.getMinutes(), 15);
  assert.ok(monday.getTime() > new Date(2026, 8, 24, 12, 0, 0, 0).getTime());

  assert.equal(nextScheduledBackupAt({ enabled:false }, new Date()), null);
});

test('scheduled backup destination must exist and be writable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-destination-'));
  try {
    const result = await validateBackupDestination(root);
    assert.equal(result.writable, true);
    assert.equal(result.destination, root);
    const files = await fs.readdir(root);
    assert.equal(files.some((name) => name.startsWith('.pfc-backup-write-test-')), false);

    await assert.rejects(
      () => validateBackupDestination(path.join(root, 'missing')),
      /does not exist/
    );

    const file = path.join(root, 'not-a-directory');
    await fs.writeFile(file, 'x');
    await assert.rejects(
      () => validateBackupDestination(file),
      /must be a directory/
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('scheduled backups are verified, retained by installation, and never prune manual or foreign backups', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-retention-'));
  const destination = path.join(root, 'backups');
  const timers = fakeTimerApi();
  try {
    await fs.mkdir(destination, { recursive:true });
    const dataDir = await makeData(root, 'controller-a');
    const lock = new BackupOperationLock();
    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'no-license-a.json'),
      controllerVersion:'0.23.0',
      operationLock:lock,
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn
    });

    const configured = await service.updateSettings({
      enabled:true,
      destination,
      frequency:'daily',
      scheduleTime:'02:00',
      retentionCount:2
    });
    assert.equal(configured.enabled, true);
    assert.equal(configured.retentionCount, 2);
    assert.ok(configured.nextRunAt);

    for (const now of [
      new Date('2026-09-20T01:00:00.000Z'),
      new Date('2026-09-21T01:00:00.000Z'),
      new Date('2026-09-22T01:00:00.000Z')
    ]) {
      const result = await service.runScheduledBackup({ now });
      assert.equal(result.success, true);
    }

    const settingsA = await loadBackupSettings({ dataDir, create:false });
    assert.equal(settingsA.lastScheduledSuccess.source, 'scheduled');
    assert.equal(settingsA.lastScheduledError, null);
    assert.equal(settingsA.lastRetentionResult.deleted, 1);

    // A manual backup copied into the same destination must never be retained/pruned
    // as scheduler-owned work.
    await createBackupInDirectory({
      destinationDir:destination,
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'no-license-a.json'),
      controllerVersion:'0.23.0',
      source:'manual',
      now:new Date('2026-09-19T01:00:00.000Z')
    });

    // A scheduled backup from a different controller installation must also remain.
    const foreignData = await makeData(root, 'controller-b');
    await createBackupInDirectory({
      destinationDir:destination,
      dataDir:foreignData,
      applicationDir:root,
      licensePath:path.join(root, 'no-license-b.json'),
      controllerVersion:'0.23.0',
      source:'scheduled',
      now:new Date('2026-09-18T01:00:00.000Z')
    });

    const before = await fs.readdir(destination);
    const cleanup = await pruneScheduledBackups({
      destination,
      installationId:settingsA.installationId,
      retentionCount:1
    });
    assert.equal(cleanup.deleted.length, 1);

    const after = await fs.readdir(destination);
    assert.equal(after.length, before.length - 1);
    // One current-install scheduled + one manual + one foreign scheduled.
    assert.equal(after.filter((name) => name.endsWith('.pfcbackup')).length, 3);
    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('enabling a schedule rejects an unavailable destination and leaves scheduling disabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-invalid-'));
  const timers = fakeTimerApi();
  try {
    const dataDir = await makeData(root);
    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      controllerVersion:'0.23.0',
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn
    });
    await assert.rejects(
      () => service.updateSettings({
        enabled:true,
        destination:path.join(root, 'missing'),
        frequency:'daily',
        scheduleTime:'02:00',
        retentionCount:14
      }),
      /does not exist/
    );
    const settings = await loadBackupSettings({ dataDir, create:true });
    assert.equal(settings.enabled, false);
    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('shared backup lock prevents scheduled and manual-style operations from overlapping', async () => {
  const lock = new BackupOperationLock();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const running = lock.run('manual', () => gate);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(lock.status().kind, 'manual');
  await assert.rejects(
    () => lock.run('scheduled', async () => {}),
    (error) => error?.statusCode === 409 && /manual backup operation is already in progress/.test(error.message)
  );

  release('done');
  assert.equal(await running, 'done');
  assert.equal(lock.status(), null);
});


test('scheduled backup settings reject invalid time weekday and retention values', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-validation-'));
  const timers = fakeTimerApi();
  try {
    const dataDir = await makeData(root);
    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      controllerVersion:'0.23.0',
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn
    });
    await assert.rejects(
      () => service.updateSettings({ enabled:false, frequency:'daily', scheduleTime:'25:00', scheduleWeekday:1, retentionCount:14 }),
      /24-hour time/
    );
    await assert.rejects(
      () => service.updateSettings({ enabled:false, frequency:'weekly', scheduleTime:'02:00', scheduleWeekday:7, retentionCount:14 }),
      /weekday is invalid/
    );
    await assert.rejects(
      () => service.updateSettings({ enabled:false, frequency:'daily', scheduleTime:'02:00', scheduleWeekday:1, retentionCount:0 }),
      /retention must be a whole number/
    );
    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});


test('previous scheduled backup finds the most recent local daily or weekly slot', () => {
  const daily = previousScheduledBackupAt({
    enabled:true,
    frequency:'daily',
    scheduleTime:'02:00',
    scheduleWeekday:1
  }, new Date(2026, 8, 24, 12, 0, 0, 0));
  assert.equal(daily.getDate(), 24);
  assert.equal(daily.getHours(), 2);

  const weekly = previousScheduledBackupAt({
    enabled:true,
    frequency:'weekly',
    scheduleTime:'03:15',
    scheduleWeekday:1
  }, new Date(2026, 8, 24, 12, 0, 0, 0));
  assert.equal(weekly.getDay(), 1);
  assert.equal(weekly.getHours(), 3);
  assert.equal(weekly.getMinutes(), 15);
  assert.ok(weekly.getTime() <= new Date(2026, 8, 24, 12, 0, 0, 0).getTime());
});

test('scheduler queues a startup catch-up when the most recent run was missed while offline', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-catchup-'));
  const destination = path.join(root, 'backups');
  const timers = fakeTimerApi();
  try {
    await fs.mkdir(destination, { recursive:true });
    const dataDir = await makeData(root);
    await saveBackupSettings({
      enabled:true,
      destination,
      frequency:'daily',
      scheduleTime:'02:00',
      scheduleWeekday:1,
      scheduleEffectiveAt:'2026-09-23T12:00:00.000Z',
      retentionCount:14
    }, { dataDir });

    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      controllerVersion:'0.23.0',
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn,
      catchUpDelayMs:1_000
    });
    const status = await service.start({ now:new Date('2026-09-24T12:00:00.000Z') });
    assert.equal(status.catchUpPending, true);
    assert.equal(status.catchUpScheduledFor, '2026-09-24T02:00:00.000Z');
    assert.ok(timers.timers.some((timer) => timer.delay === 1_000));
    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('scheduler does not catch up a slot from before the current schedule became effective', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-no-catchup-new-'));
  const destination = path.join(root, 'backups');
  const timers = fakeTimerApi();
  try {
    await fs.mkdir(destination, { recursive:true });
    const dataDir = await makeData(root);
    await saveBackupSettings({
      enabled:true,
      destination,
      frequency:'daily',
      scheduleTime:'02:00',
      scheduleWeekday:1,
      scheduleEffectiveAt:'2026-09-24T10:00:00.000Z',
      retentionCount:14
    }, { dataDir });

    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      controllerVersion:'0.23.0',
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn,
      catchUpDelayMs:1_000
    });
    const status = await service.start({ now:new Date('2026-09-24T12:00:00.000Z') });
    assert.equal(status.catchUpPending, false);
    assert.equal(status.catchUpScheduledFor, null);
    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('scheduler does not catch up a slot that already has a recorded attempt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-no-catchup-attempted-'));
  const destination = path.join(root, 'backups');
  const timers = fakeTimerApi();
  try {
    await fs.mkdir(destination, { recursive:true });
    const dataDir = await makeData(root);
    await saveBackupSettings({
      enabled:true,
      destination,
      frequency:'daily',
      scheduleTime:'02:00',
      scheduleWeekday:1,
      scheduleEffectiveAt:'2026-09-23T10:00:00.000Z',
      lastScheduledAttemptAt:'2026-09-24T02:00:30.000Z',
      retentionCount:14
    }, { dataDir });

    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      controllerVersion:'0.23.0',
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn,
      catchUpDelayMs:1_000
    });
    const status = await service.start({ now:new Date('2026-09-24T12:00:00.000Z') });
    assert.equal(status.catchUpPending, false);
    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('busy backup operation retries a missed scheduled catch-up instead of dropping it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-catchup-busy-'));
  const destination = path.join(root, 'backups');
  const timers = fakeTimerApi();
  const lock = new BackupOperationLock();
  try {
    await fs.mkdir(destination, { recursive:true });
    const dataDir = await makeData(root);
    await saveBackupSettings({
      enabled:true,
      destination,
      frequency:'daily',
      scheduleTime:'02:00',
      scheduleWeekday:1,
      scheduleEffectiveAt:'2026-09-23T10:00:00.000Z',
      retentionCount:14
    }, { dataDir });

    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      controllerVersion:'0.23.0',
      operationLock:lock,
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn,
      busyCatchUpRetryMs:2_000
    });
    service.started = true;

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const manual = lock.run('manual', () => gate);
    await new Promise((resolve) => setImmediate(resolve));

    const result = await service.runScheduledBackup({
      now:new Date('2026-09-24T12:00:00.000Z'),
      trigger:'catch-up',
      scheduledFor:'2026-09-24T02:00:00.000Z'
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'busy');
    assert.equal(result.retryScheduled, true);
    assert.equal(service.catchUpScheduledFor, '2026-09-24T02:00:00.000Z');
    assert.ok(timers.timers.some((timer) => timer.delay === 2_000));

    release('done');
    await manual;
    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('enabling or changing schedule timing resets the catch-up effective time', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-scheduled-effective-time-'));
  const destination = path.join(root, 'backups');
  const timers = fakeTimerApi();
  try {
    await fs.mkdir(destination, { recursive:true });
    const dataDir = await makeData(root);
    const service = new ScheduledBackupService({
      dataDir,
      applicationDir:root,
      controllerVersion:'0.23.0',
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn
    });

    await service.updateSettings({
      enabled:true,
      destination,
      frequency:'daily',
      scheduleTime:'02:00',
      scheduleWeekday:1,
      retentionCount:14
    });
    const first = await loadBackupSettings({ dataDir, create:false });
    assert.ok(first.scheduleEffectiveAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.updateSettings({
      enabled:true,
      destination,
      frequency:'daily',
      scheduleTime:'03:00',
      scheduleWeekday:1,
      retentionCount:14
    });
    const second = await loadBackupSettings({ dataDir, create:false });
    assert.ok(new Date(second.scheduleEffectiveAt).getTime() >= new Date(first.scheduleEffectiveAt).getTime());

    service.stop();
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
