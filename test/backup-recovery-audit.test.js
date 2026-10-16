import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createBackupArchive } from '../src/backup-recovery/backup-service.js';
import {
  stageRestoreBackup, activatePendingRestore, cancelStagedRestore,
  commitActivatedRestore, pendingRestoreStatus, prepareRestoredJobs,
  restoreRuntimePaths
} from '../src/backup-recovery/restore-service.js';

async function withBackup(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-restore-audit-'));
  const dataDir = path.join(root, 'live');
  const sourceDir = path.join(root, 'source');
  const backupPath = path.join(root, 'audit.pfcbackup');
  const licensePath = path.join(root, 'active-license.json');
  const write = async (directory, name, value) => {
    const file = path.join(directory, name);
    await fs.mkdir(path.dirname(file), { recursive:true });
    await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  try {
    await write(dataDir, 'printers.json', [{ id:'live', name:'Existing controller' }]);
    await write(dataDir, 'print-jobs.json', [{ id:'live-job', status:'completed' }]);
    await write(dataDir, 'print-library/old-lib/old.gcode', 'G28\n; ORIGINAL ONLY\n');
    await write(root, 'active-license.json', { id:'existing-license' });

    await write(sourceDir, 'printers.json', [{ id:'restored', name:'Recovered controller' }]);
    await write(sourceDir, 'print-jobs.json', [
      { id:'waiting', assignmentMode:'automatic', status:'queued', printerId:null, fileName:'waiting.gcode', options:{ toolMap:{ 0:1 } } },
      { id:'running', assignmentMode:'fixed', status:'printing', printerId:'restored', fileName:'running.gcode', options:{} }
    ]);
    await write(sourceDir, 'file-material-metadata.json', {});
    await createBackupArchive({
      destinationPath:backupPath, dataDir:sourceDir, applicationDir:root,
      licensePath:path.join(root, 'nonexistent-signed-license.json'), controllerVersion:'0.48.0'
    });
    return await callback({
      root, dataDir, sourceDir, backupPath, licensePath,
      write,
      read:async (name) => fs.readFile(path.join(dataDir, name), 'utf8'),
      stage:() => stageRestoreBackup(backupPath, {
        dataDir, licensePath, currentControllerVersion:'0.48.0',
        originalFileName:'audit.pfcbackup'
      })
    });
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
}

test('restore cannot be staged twice and cancellation preserves all live printer, file and licence bytes', async () => {
  await withBackup(async ({dataDir, backupPath, licensePath, read, stage}) => {
    const originalPrinters = await read('printers.json');
    const originalLibrary = await read('print-library/old-lib/old.gcode');
    const originalLicense = await fs.readFile(licensePath, 'utf8');
    assert.equal((await stage()).staged, true);
    await assert.rejects(
      stage,
      (error) => error.statusCode === 409 && /already staged/.test(error.message)
    );
    assert.equal(await read('printers.json'), originalPrinters);
    assert.equal(await read('print-library/old-lib/old.gcode'), originalLibrary);
    assert.equal(await fs.readFile(licensePath, 'utf8'), originalLicense);
    assert.equal((await pendingRestoreStatus(dataDir)).phase, 'staged');
    assert.equal((await cancelStagedRestore(dataDir)).cancelled, true);
    assert.equal((await pendingRestoreStatus(dataDir)).pending, false);
    assert.equal((await cancelStagedRestore(dataDir)).cancelled, false);
    assert.equal(await read('printers.json'), originalPrinters);
    assert.equal(await read('print-library/old-lib/old.gcode'), originalLibrary);
    assert.equal(await fs.readFile(licensePath, 'utf8'), originalLicense);
    assert.ok(backupPath.endsWith('.pfcbackup'));
  });
});

test('restore rejects a corrupted backup before changing live data or writing a pending marker', async () => {
  await withBackup(async ({dataDir, backupPath, licensePath, read, stage}) => {
    const before = await read('printers.json');
    const handle = await fs.open(backupPath, 'r+');
    try {
      const byte = Buffer.alloc(1);
      await handle.read(byte, 0, 1, 0);
      byte[0] ^= 0xff;
      await handle.write(byte, 0, 1, 0);
    } finally {
      await handle.close();
    }
    await assert.rejects(stage, /archive|zip|signature|header|invalid|mismatch|bad/i);
    assert.equal(await read('printers.json'), before);
    assert.deepEqual(await pendingRestoreStatus(dataDir), { pending:false });
    assert.deepEqual(JSON.parse(await fs.readFile(licensePath, 'utf8')), { id:'existing-license' });
  });
});

test('recovery startup rolls back printer data, print files and licence if activation was not committed', async () => {
  await withBackup(async ({dataDir, licensePath, read, stage}) => {
    const oldPrinters = await read('printers.json');
    const oldJobs = await read('print-jobs.json');
    const oldLibrary = await read('print-library/old-lib/old.gcode');
    const oldLicense = await fs.readFile(licensePath, 'utf8');

    await stage();
    const transaction = await activatePendingRestore({dataDir, licensePath});
    assert.equal(transaction.activated, true);
    const restored = JSON.parse(await read('printers.json'));
    assert.equal(restored[0].id, 'restored');
    const jobs = JSON.parse(await read('print-jobs.json'));
    assert.ok(jobs.every((job) => job.status === 'needs_review' && job.restoreRecoveryHold === true));
    assert.equal(jobs.find((job) => job.id === 'running')?.bedClearanceRequired, true);
    assert.equal(jobs.find((job) => job.id === 'waiting')?.options.toolMap, null);
    await assert.rejects(fs.access(path.join(dataDir, 'print-library', 'old-lib', 'old.gcode')));
    // Backup deliberately excludes a signed licence; activation removes the
    // obsolete external licence, so rollback must restore the original bytes.
    await assert.rejects(fs.access(licensePath));

    const recovered = await activatePendingRestore({dataDir, licensePath});
    assert.equal(recovered.rolledBack, true);
    assert.equal(await read('printers.json'), oldPrinters);
    assert.equal(await read('print-jobs.json'), oldJobs);
    assert.equal(await read('print-library/old-lib/old.gcode'), oldLibrary);
    assert.equal(await fs.readFile(licensePath, 'utf8'), oldLicense);
    assert.deepEqual(await pendingRestoreStatus(dataDir), {pending:false});
  });
});

test('a missing rollback snapshot refuses destructive recovery instead of deleting activated live files', async () => {
  await withBackup(async ({dataDir, licensePath, read, stage}) => {
    await stage();
    const transaction = await activatePendingRestore({dataDir, licensePath});
    assert.equal(transaction.activated, true);
    const restoredPrinters = await read('printers.json');
    const markerPath = restoreRuntimePaths(dataDir).pendingMarkerPath;
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    assert.equal(marker.phase, 'activated');
    assert.equal(marker.originalEntries['printers.json'], true);
    await fs.rm(path.join(marker.rollbackDir, 'printers.json'));
    await assert.rejects(
      activatePendingRestore({dataDir, licensePath}),
      /Restore rollback snapshot is missing printers\.json/
    );
    assert.equal(await read('printers.json'), restoredPrinters);
    assert.equal((await pendingRestoreStatus(dataDir)).phase, 'activated');
  });
});

test('committed restore retains recovered data across another startup and cannot be cancelled', async () => {
  await withBackup(async ({dataDir, licensePath, read, stage}) => {
    await stage();
    const tx = await activatePendingRestore({dataDir, licensePath});
    await commitActivatedRestore(tx, {now:new Date(), retentionMs:60_000});
    const printers = await read('printers.json');
    const pending = await activatePendingRestore({dataDir, licensePath});
    assert.equal(pending.committed, true);
    assert.equal(pending.rollbackRetained, true);
    assert.equal(await read('printers.json'), printers);
    assert.equal((await pendingRestoreStatus(dataDir)).pending, false);
    await assert.rejects(cancelStagedRestore(dataDir), (error) => error.statusCode === 409);
  });
});

test('fault injection: suppressing the recovery hold would allow an unfinished restored job to evade safety review', () => {
  const source = readFileSync(new URL('../src/backup-recovery/restore-service.js', import.meta.url), 'utf8');
  const start = source.indexOf('function cleanRestoredOptions(');
  const end = source.indexOf('\nfunction restoredBackupSettings(', start);
  assert.ok(start >= 0 && end > start, 'locate production recovery hold transform');
  const snippet = source.slice(start, end).replace('export function prepareRestoredJobs', 'function prepareRestoredJobs');
  const mutant = snippet.replace('job.restoreRecoveryHold = true;', 'job.restoreRecoveryHold = false;');
  assert.notEqual(snippet, mutant, 'mutation must affect the real hold assignment');
  const badPrepare = runInNewContext(mutant + '\nprepareRestoredJobs;', {
    TERMINAL_STATES:new Set(['completed','failed','cancelled']),
    PRINT_MAY_HAVE_STARTED_STATES:new Set(['starting','printing']),
    structuredClone, String, Date
  });
  const fixture = [{id:'unsafe', assignmentMode:'automatic', status:'printing', printerId:'p1', options:{toolMap:{0:1}}}];
  const held = prepareRestoredJobs(fixture);
  const unsafe = badPrepare(fixture);
  assert.equal(held[0].restoreRecoveryHold, true);
  assert.equal(held[0].status, 'needs_review');
  assert.equal(held[0].bedClearanceRequired, true);
  assert.equal(unsafe[0].restoreRecoveryHold, false,
    'an unsafe mutation fails the explicit recovery-held job invariant');
});
