import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackupArchive } from '../src/backup-recovery/backup-service.js';
import {
  activatePendingRestore,
  cancelStagedRestore,
  commitActivatedRestore,
  pendingRestoreStatus,
  prepareRestoredJobs,
  restoreRuntimePaths,
  rollbackActivatedRestore,
  stageRestoreBackup
} from '../src/backup-recovery/restore-service.js';

async function tempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive:true });
  await fs.writeFile(filePath, JSON.stringify(value));
}

async function createBackupFixture(root, {
  version = '0.23.0',
  jobs = [],
  printers = [{ id:'restored-printer', name:'Restored printer' }],
  backupLicense = null
} = {}) {
  const sourceData = path.join(root, 'backup-source');
  const backupPath = path.join(root, 'fixture.pfcbackup');
  const sourceLicense = path.join(root, 'backup-license.json');
  await fs.mkdir(sourceData, { recursive:true });
  await writeJson(path.join(sourceData, 'printers.json'), printers);
  await writeJson(path.join(sourceData, 'print-jobs.json'), jobs);
  await writeJson(path.join(sourceData, 'file-material-metadata.json'), {});
  if (backupLicense) await writeJson(sourceLicense, backupLicense);
  await createBackupArchive({
    destinationPath:backupPath,
    dataDir:sourceData,
    applicationDir:root,
    licensePath:sourceLicense,
    controllerVersion:version
  });
  return { backupPath, sourceData, sourceLicense };
}

test('prepareRestoredJobs recovery-holds every unfinished job and preserves terminal history', () => {
  const jobs = [
    { id:'queued', status:'queued', assignmentMode:'automatic', printerId:'p1', printerName:'P1', options:{ toolMap:{ 0:1 } } },
    { id:'starting', status:'starting', assignmentMode:'fixed', printerId:'p2', productionBatchId:'batch', productionPaused:false },
    { id:'printing', status:'printing', assignmentMode:'fixed', printerId:'p3', bedClearanceRequired:false },
    { id:'auto-printing', status:'printing', assignmentMode:'automatic', printerId:'p5', printerName:'Auto printer', bedClearanceRequired:false },
    { id:'completed', status:'completed', assignmentMode:'fixed', printerId:'p4', finishedAt:'2026-01-01T00:00:00.000Z' }
  ];
  const restored = prepareRestoredJobs(jobs, { restoredAt:'2026-09-24T18:00:00.000Z' });

  for (const job of restored.slice(0, 4)) {
    assert.equal(job.status, 'needs_review');
    assert.equal(job.restoreRecoveryHold, true);
    assert.match(job.error, /Restored — review required/);
    assert.equal(job.startRequestedAt, null);
    assert.equal(job.startedAt, null);
    assert.equal(job.finishedAt, null);
    assert.equal(job.options.toolMap, null);
    assert.equal(job.options.materialMap, null);
  }
  assert.equal(restored[0].printerId, null);
  assert.equal(restored[0].printerName, 'Next available compatible printer');
  assert.equal(restored[1].productionPaused, true);
  assert.equal(restored[1].bedClearanceRequired, true);
  assert.equal(restored[2].bedClearanceRequired, true);
  assert.equal(restored[3].printerId, 'p5');
  assert.equal(restored[3].printerName, 'Auto printer');
  assert.equal(restored[3].bedClearanceRequired, true);
  assert.deepEqual(restored[4], jobs[4]);
});

test('staging a restore does not change live data and can be cancelled', async () => {
  const root = await tempRoot('pfc-restore-stage-');
  const liveData = path.join(root, 'live-data');
  const liveLicense = path.join(root, 'live-license.json');
  try {
    await fs.mkdir(liveData, { recursive:true });
    await writeJson(path.join(liveData, 'printers.json'), [{ id:'live-printer', name:'Live printer' }]);
    await writeJson(liveLicense, { current:true });
    const fixture = await createBackupFixture(root, {
      jobs:[{ id:'q1', status:'queued', assignmentMode:'automatic' }]
    });

    const result = await stageRestoreBackup(fixture.backupPath, {
      dataDir:liveData,
      licensePath:liveLicense,
      currentControllerVersion:'0.23.0',
      originalFileName:'fixture.pfcbackup'
    });
    assert.equal(result.staged, true);
    assert.equal(result.restartRequired, true);
    assert.equal(result.recoveryHeldJobs, 1);
    const livePrinters = JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8'));
    assert.equal(livePrinters[0].id, 'live-printer');

    const pending = await pendingRestoreStatus(liveData);
    assert.equal(pending.pending, true);
    assert.equal(pending.phase, 'staged');

    const cancelled = await cancelStagedRestore(liveData);
    assert.equal(cancelled.cancelled, true);
    assert.equal((await pendingRestoreStatus(liveData)).pending, false);
    const stillLive = JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8'));
    assert.equal(stillLive[0].id, 'live-printer');
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('activation swaps staged data and commit makes the restored state permanent', async () => {
  const root = await tempRoot('pfc-restore-activate-');
  const liveData = path.join(root, 'live-data');
  const liveLicense = path.join(root, 'live-license.json');
  try {
    await fs.mkdir(liveData, { recursive:true });
    await writeJson(path.join(liveData, 'printers.json'), [{ id:'old-printer', name:'Old printer' }]);
    await writeJson(path.join(liveData, 'print-jobs.json'), []);
    await writeJson(liveLicense, { current:'old' });

    const fixture = await createBackupFixture(root, {
      jobs:[{ id:'restored-job', status:'queued', assignmentMode:'automatic', productionBatchId:'batch-1' }],
      printers:[{ id:'new-printer', name:'New printer' }],
      backupLicense:{ current:'restored' }
    });
    await stageRestoreBackup(fixture.backupPath, {
      dataDir:liveData,
      licensePath:liveLicense,
      currentControllerVersion:'0.23.0'
    });

    const tx = await activatePendingRestore({ dataDir:liveData, licensePath:liveLicense });
    assert.equal(tx.activated, true);
    const printers = JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8'));
    assert.equal(printers[0].id, 'new-printer');
    const jobs = JSON.parse(await fs.readFile(path.join(liveData, 'print-jobs.json'), 'utf8'));
    assert.equal(jobs[0].status, 'needs_review');
    assert.equal(jobs[0].restoreRecoveryHold, true);
    assert.equal(jobs[0].productionPaused, true);
    assert.deepEqual(JSON.parse(await fs.readFile(liveLicense, 'utf8')), { current:'restored' });

    await commitActivatedRestore(tx);
    assert.equal((await pendingRestoreStatus(liveData)).pending, false);
    assert.equal((JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8')))[0].id, 'new-printer');
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('an activated restore rolls back to the previous data if startup is not committed', async () => {
  const root = await tempRoot('pfc-restore-rollback-');
  const liveData = path.join(root, 'live-data');
  const liveLicense = path.join(root, 'live-license.json');
  try {
    await fs.mkdir(liveData, { recursive:true });
    await writeJson(path.join(liveData, 'printers.json'), [{ id:'old-printer' }]);
    await writeJson(path.join(liveData, 'print-jobs.json'), []);
    await writeJson(liveLicense, { license:'old' });

    const fixture = await createBackupFixture(root, {
      printers:[{ id:'new-printer' }],
      backupLicense:{ license:'new' }
    });
    await stageRestoreBackup(fixture.backupPath, {
      dataDir:liveData,
      licensePath:liveLicense,
      currentControllerVersion:'0.23.0'
    });
    const first = await activatePendingRestore({ dataDir:liveData, licensePath:liveLicense });
    assert.equal(first.activated, true);
    assert.equal((JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8')))[0].id, 'new-printer');

    // Simulate a crash before successful startup commit: the next startup sees
    // the activated journal and restores the previous controller state.
    const second = await activatePendingRestore({ dataDir:liveData, licensePath:liveLicense });
    assert.equal(second.rolledBack, true);
    assert.equal((JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8')))[0].id, 'old-printer');
    assert.deepEqual(JSON.parse(await fs.readFile(liveLicense, 'utf8')), { license:'old' });
    assert.equal((await pendingRestoreStatus(liveData)).pending, false);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('explicit rollback restores previous data before commit', async () => {
  const root = await tempRoot('pfc-restore-explicit-rollback-');
  const liveData = path.join(root, 'live-data');
  const liveLicense = path.join(root, 'live-license.json');
  try {
    await fs.mkdir(liveData, { recursive:true });
    await writeJson(path.join(liveData, 'printers.json'), [{ id:'before' }]);
    await writeJson(path.join(liveData, 'print-jobs.json'), []);
    const fixture = await createBackupFixture(root, { printers:[{ id:'after' }] });
    await stageRestoreBackup(fixture.backupPath, {
      dataDir:liveData,
      licensePath:liveLicense,
      currentControllerVersion:'0.23.0'
    });
    const tx = await activatePendingRestore({ dataDir:liveData, licensePath:liveLicense });
    assert.equal((JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8')))[0].id, 'after');
    await rollbackActivatedRestore(tx);
    assert.equal((JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8')))[0].id, 'before');
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});


test('tampered pending restore journal cannot redirect cleanup outside controller restore paths', async () => {
  const root = await tempRoot('pfc-restore-marker-safety-');
  const liveData = path.join(root, 'live-data');
  const liveLicense = path.join(root, 'live-license.json');
  try {
    await fs.mkdir(liveData, { recursive:true });
    await writeJson(path.join(liveData, 'printers.json'), [{ id:'live' }]);
    await writeJson(path.join(liveData, 'print-jobs.json'), []);
    const fixture = await createBackupFixture(root);
    await stageRestoreBackup(fixture.backupPath, {
      dataDir:liveData,
      licensePath:liveLicense,
      currentControllerVersion:'0.23.0'
    });

    const markerPath = restoreRuntimePaths(liveData).pendingMarkerPath;
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    marker.stageDir = root;
    await fs.writeFile(markerPath, JSON.stringify(marker));

    await assert.rejects(() => cancelStagedRestore(liveData), /stage path is invalid/);
    assert.ok((await fs.stat(root)).isDirectory());
    assert.ok((await fs.stat(liveData)).isDirectory());
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});


test('successful restore keeps rollback metadata for the recovery window and cleans it after expiry', async () => {
  const root = await tempRoot('pfc-restore-retention-');
  const liveData = path.join(root, 'live-data');
  const liveLicense = path.join(root, 'live-license.json');
  try {
    await fs.mkdir(liveData, { recursive:true });
    await writeJson(path.join(liveData, 'printers.json'), [{ id:'old-printer' }]);
    await writeJson(path.join(liveData, 'print-jobs.json'), []);
    const fixture = await createBackupFixture(root, { printers:[{ id:'new-printer' }] });

    await stageRestoreBackup(fixture.backupPath, {
      dataDir:liveData,
      licensePath:liveLicense,
      currentControllerVersion:'0.23.0'
    });
    const tx = await activatePendingRestore({ dataDir:liveData, licensePath:liveLicense });
    const committed = await commitActivatedRestore(tx, {
      now:new Date('2026-09-24T18:00:00.000Z'),
      retentionMs:60_000
    });
    assert.equal(committed.committed, true);
    assert.equal(committed.rollbackRetainUntil, '2026-09-24T18:01:00.000Z');

    const status = await pendingRestoreStatus(liveData);
    assert.equal(status.pending, false);
    assert.equal(status.recentlyRestored, true);
    assert.equal(status.rollbackRetainUntil, '2026-09-24T18:01:00.000Z');

    // Rewrite the retained-until timestamp into the past to simulate the next
    // lifecycle check occurring after the recovery window.
    const markerPath = restoreRuntimePaths(liveData).pendingMarkerPath;
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    marker.rollbackRetainUntil = '2020-01-01T00:00:00.000Z';
    await fs.writeFile(markerPath, JSON.stringify(marker));

    const cleanup = await activatePendingRestore({ dataDir:liveData, licensePath:liveLicense });
    assert.equal(cleanup.rollbackRetentionExpired, true);
    assert.equal((await pendingRestoreStatus(liveData)).pending, false);
    assert.equal((JSON.parse(await fs.readFile(path.join(liveData, 'printers.json'), 'utf8')))[0].id, 'new-printer');
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
