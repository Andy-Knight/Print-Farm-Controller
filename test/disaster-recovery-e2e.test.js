import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackupArchive } from '../src/backup-recovery/backup-service.js';
import {
  activatePendingRestore,
  commitActivatedRestore,
  pendingRestoreStatus,
  stageRestoreBackup
} from '../src/backup-recovery/restore-service.js';
import { ScheduledBackupService } from '../src/backup-recovery/scheduled-backup-service.js';
import { PrintQueueService } from '../src/print-queue.js';
import { loadLicenseManager } from '../src/licensing/license-loader.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive:true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

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

function restoredFleet(printers) {
  const states = new Map(printers.map((printer) => [printer.id, {
    id:printer.id,
    name:printer.name,
    online:true,
    status:{
      status:'idle',
      fileName:null,
      progress:0,
      tools:[]
    }
  }]));
  return {
    subscribe() {
      return () => {};
    },
    getPrinterState(id) {
      return states.get(id) || null;
    }
  };
}

test('end-to-end disaster recovery restores portable state and reinitializes safely', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-disaster-recovery-e2e-'));
  const sourceData = path.join(root, 'source-data');
  const targetData = path.join(root, 'replacement-data');
  const backupPath = path.join(root, 'disaster-recovery.pfcbackup');
  const sourceLicense = path.join(sourceData, 'license.json');
  const targetLicense = path.join(targetData, 'license.json');
  const libraryId = '44444444-4444-4444-8444-444444444444';
  const libraryDir = path.join(sourceData, 'print-library', libraryId);
  const printBytes = Buffer.from('; disaster recovery fixture\nG28\nG1 X25 Y25 F6000\n');
  const previewBytes = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01,0x02,0x03]);
  const printHash = sha256(printBytes);
  const invalidSignedLicense = {
    payload:{
      licenseId:'dr-invalid-signature',
      edition:'farm',
      maxPrinters:25
    },
    signature:'deliberately-invalid',
    keyId:'primary-2026'
  };

  const printers = [
    {
      id:'u1-dr',
      name:'DR Snapmaker U1',
      adapterType:'snapmaker-u1',
      manufacturer:'Snapmaker',
      model:'U1',
      host:'192.0.2.10',
      serialNumber:'DR-U1',
      adapterConfig:{ nozzleDiameterDesignation:0.4 },
      licenseSlotActive:true
    },
    {
      id:'ff-dr',
      name:'DR AD5M Pro',
      adapterType:'flashforge-ad5m',
      manufacturer:'FlashForge',
      model:'Adventurer 5M Pro',
      host:'192.0.2.20',
      serialNumber:'DR-FF',
      adapterConfig:{
        filamentDesignation:'ASA-CF',
        filamentColorFamilyDesignation:'black',
        nozzleDiameterDesignation:0.6
      },
      licenseSlotActive:true
    }
  ];
  const libraryMetadata = {
    id:libraryId,
    fileName:'dr-part.gcode',
    size:printBytes.length,
    sha256:printHash,
    description:'End-to-end disaster recovery fixture',
    printerTarget:{ adapterType:'flashforge-ad5m', model:'Adventurer 5M Pro' },
    requirements:{
      nozzleDiameter:0.6,
      materials:[{ material:'ASA-CF', color:'#111111', colorFamily:'black' }],
      requiredTools:[0]
    },
    preview:{
      available:true,
      mimeType:'image/png',
      fileName:'preview.png'
    },
    addedAt:'2026-09-20T12:00:00.000Z',
    stagedAt:'2026-09-20T12:00:00.000Z'
  };
  const jobs = [
    {
      id:'history-complete',
      assignmentMode:'fixed',
      printerId:'ff-dr',
      printerName:'DR AD5M Pro',
      fileName:'dr-part.gcode',
      stagedFile:{ id:libraryId, fileName:'dr-part.gcode', size:printBytes.length, sha256:printHash },
      status:'completed',
      queuedAt:'2026-09-21T09:00:00.000Z',
      startedAt:'2026-09-21T09:05:00.000Z',
      finishedAt:'2026-09-21T10:00:00.000Z',
      updatedAt:'2026-09-21T10:00:00.000Z',
      maxProgress:100,
      options:{}
    },
    {
      id:'queued-auto',
      assignmentMode:'automatic',
      printerId:null,
      printerName:'Next available compatible printer',
      fileName:'dr-part.gcode',
      stagedFile:{ id:libraryId, fileName:'dr-part.gcode', size:printBytes.length, sha256:printHash },
      productionBatchId:'batch-dr',
      productionSequence:1,
      productionQuantity:2,
      productionPaused:false,
      status:'queued',
      queuedAt:'2026-09-23T11:00:00.000Z',
      updatedAt:'2026-09-23T11:00:00.000Z',
      options:{ toolMap:{ 0:0 }, materialMap:{ 0:0 }, usedLogicalTools:[0] },
      requirements:libraryMetadata.requirements,
      bedClearanceRequired:false
    },
    {
      id:'printing-before-backup',
      assignmentMode:'fixed',
      printerId:'ff-dr',
      printerName:'DR AD5M Pro',
      fileName:'dr-part.gcode',
      stagedFile:{ id:libraryId, fileName:'dr-part.gcode', size:printBytes.length, sha256:printHash },
      productionBatchId:'batch-dr',
      productionSequence:2,
      productionQuantity:2,
      productionPaused:false,
      status:'printing',
      queuedAt:'2026-09-23T12:00:00.000Z',
      startedAt:'2026-09-23T12:05:00.000Z',
      updatedAt:'2026-09-23T12:30:00.000Z',
      options:{ toolMap:{ 0:0 }, materialMap:{ 0:0 }, usedLogicalTools:[0] },
      requirements:libraryMetadata.requirements,
      bedClearanceRequired:false
    }
  ];
  const fileMaterials = {
    'ff-dr':{
      'dr-part.gcode':{
        fileName:'dr-part.gcode',
        metadataAvailable:true,
        requiredMaterial:'ASA-CF',
        materials:[{ material:'ASA-CF', color:'#111111', colorFamily:'black' }],
        source:'3mf-gcode'
      }
    }
  };

  const maintenanceState = {
    version:1,
    printers:{
      'ff-dr':{
        usage:{ printSeconds:14400, printCount:12, updatedAt:'2026-09-23T12:30:00.000Z' },
        tasks:[],
        history:[{
          id:'maintenance-history-1',
          taskId:'maintenance-task-1',
          taskName:'Lubricate rails',
          completedAt:'2026-09-20T00:00:00.000Z',
          notes:'Completed before backup',
          usageSnapshot:{ printSeconds:7200, printHours:2, printCount:6 }
        }]
      }
    }
  };

  try {
    await fs.mkdir(libraryDir, { recursive:true });
    await writeJson(path.join(sourceData, 'printers.json'), printers);
    await writeJson(path.join(sourceData, 'print-jobs.json'), jobs);
    await writeJson(path.join(sourceData, 'file-material-metadata.json'), fileMaterials);
    await writeJson(path.join(sourceData, 'emulator-settings.json'), { enabled:true });
    await writeJson(path.join(sourceData, 'maintenance.json'), maintenanceState);
    await writeJson(path.join(sourceData, 'backup-settings.json'), {
      installationId:'55555555-5555-4555-8555-555555555555',
      enabled:true,
      destination:'\\\\nas.example.invalid\\pfc-backups',
      frequency:'daily',
      scheduleTime:'02:00',
      scheduleWeekday:1,
      scheduleEffectiveAt:'2026-09-20T10:00:00.000Z',
      retentionCount:14
    });
    await fs.writeFile(path.join(libraryDir, 'dr-part.gcode'), printBytes);
    await fs.writeFile(path.join(libraryDir, 'preview.png'), previewBytes);
    await writeJson(path.join(libraryDir, 'metadata.json'), libraryMetadata);
    await writeJson(sourceLicense, invalidSignedLicense);

    const backup = await createBackupArchive({
      destinationPath:backupPath,
      dataDir:sourceData,
      applicationDir:root,
      licensePath:sourceLicense,
      controllerVersion:'0.23.0',
      now:new Date('2026-09-24T08:00:00.000Z')
    });
    assert.equal(backup.manifest.counts.printers, 2);
    assert.equal(backup.manifest.counts.printLibrary, 1);
    assert.equal(backup.manifest.counts.queued, 2);
    assert.equal(backup.manifest.counts.history, 1);
    assert.equal(backup.manifest.licenseIncluded, true);

    // Simulate installation on a replacement controller host. Existing target
    // state must remain untouched until the staged restore activates.
    await fs.mkdir(targetData, { recursive:true });
    await writeJson(path.join(targetData, 'printers.json'), [{ id:'fresh-install-printer', name:'Fresh install placeholder' }]);
    await writeJson(path.join(targetData, 'print-jobs.json'), []);
    await writeJson(path.join(targetData, 'file-material-metadata.json'), {});
    await writeJson(path.join(targetData, 'backup-settings.json'), {
      installationId:'66666666-6666-4666-8666-666666666666',
      enabled:false,
      retentionCount:14
    });

    const staged = await stageRestoreBackup(backupPath, {
      dataDir:targetData,
      licensePath:targetLicense,
      currentControllerVersion:'0.23.0',
      originalFileName:'disaster-recovery.pfcbackup',
      now:new Date('2026-09-24T08:05:00.000Z')
    });
    assert.equal(staged.staged, true);
    assert.equal(staged.recoveryHeldJobs, 2);
    assert.equal((JSON.parse(await fs.readFile(path.join(targetData, 'printers.json'), 'utf8')))[0].id, 'fresh-install-printer');

    // Simulate the next controller process startup: activate the staged data
    // before normal services initialize, then reinitialize services from it.
    const transaction = await activatePendingRestore({
      dataDir:targetData,
      licensePath:targetLicense
    });
    assert.equal(transaction.activated, true);

    const restoredPrinters = JSON.parse(await fs.readFile(path.join(targetData, 'printers.json'), 'utf8'));
    assert.deepEqual(restoredPrinters, printers);

    const restoredMetadata = JSON.parse(await fs.readFile(
      path.join(targetData, 'print-library', libraryId, 'metadata.json'),
      'utf8'
    ));
    assert.deepEqual(restoredMetadata, libraryMetadata);
    const restoredPrintBytes = await fs.readFile(path.join(targetData, 'print-library', libraryId, 'dr-part.gcode'));
    assert.equal(sha256(restoredPrintBytes), printHash);
    assert.deepEqual(restoredPrintBytes, printBytes);
    assert.deepEqual(
      await fs.readFile(path.join(targetData, 'print-library', libraryId, 'preview.png')),
      previewBytes
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(targetData, 'file-material-metadata.json'), 'utf8')),
      fileMaterials
    );
    assert.deepEqual(JSON.parse(await fs.readFile(targetLicense, 'utf8')), invalidSignedLicense);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetData, 'maintenance.json'), 'utf8')), maintenanceState);

    const restoredSettings = JSON.parse(await fs.readFile(path.join(targetData, 'backup-settings.json'), 'utf8'));
    assert.equal(restoredSettings.installationId, '55555555-5555-4555-8555-555555555555');
    assert.equal(restoredSettings.enabled, false);
    assert.equal(restoredSettings.destination, '\\\\nas.example.invalid\\pfc-backups');
    assert.equal(restoredSettings.frequency, 'daily');
    assert.equal(restoredSettings.scheduleTime, '02:00');
    assert.equal(restoredSettings.retentionCount, 14);
    assert.match(restoredSettings.lastError, /restored disabled/i);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(targetData, 'emulator-settings.json'), 'utf8')),
      { enabled:true }
    );

    const restoredJobs = JSON.parse(await fs.readFile(path.join(targetData, 'print-jobs.json'), 'utf8'));
    const completed = restoredJobs.find((job) => job.id === 'history-complete');
    const queued = restoredJobs.find((job) => job.id === 'queued-auto');
    const printing = restoredJobs.find((job) => job.id === 'printing-before-backup');
    assert.equal(completed.status, 'completed');
    assert.equal(completed.finishedAt, '2026-09-21T10:00:00.000Z');
    assert.equal(completed.restoreRecoveryHold, undefined);
    for (const job of [queued, printing]) {
      assert.equal(job.status, 'needs_review');
      assert.equal(job.restoreRecoveryHold, true);
      assert.equal(job.productionPaused, true);
      assert.match(job.error, /Restored — review required/);
    }
    assert.equal(queued.printerId, null);
    assert.equal(queued.options.toolMap, null);
    assert.equal(printing.printerId, 'ff-dr');
    assert.equal(printing.bedClearanceRequired, true);
    assert.equal(printing.bedClearedAt, null);

    // Reinitialize queue processing from the restored store. Even with an idle,
    // online compatible printer available, recovery-held work must not dispatch.
    const starts = [];
    const queue = new PrintQueueService({
      fleetState:restoredFleet(restoredPrinters),
      chamberPreheat:{ isActive:() => false, stop:async () => {} },
      getPrinterFn:async (id) => restoredPrinters.find((printer) => printer.id === id) || null,
      adapterResolver:() => ({
        capabilities:{ printLocalFile:true },
        getStatus:async () => ({ status:'idle', fileName:null, progress:0 }),
        printLocalFile:async (fileName) => starts.push(fileName)
      }),
      loadJobsFn:async () => JSON.parse(await fs.readFile(path.join(targetData, 'print-jobs.json'), 'utf8')),
      saveJobsFn:async (next) => writeJson(path.join(targetData, 'print-jobs.json'), next),
      getFileMaterialMetadataFn:async () => null
    });
    await queue.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const queueSnapshot = queue.getSnapshot();
    assert.equal(queueSnapshot.history, 1);
    assert.equal(queueSnapshot.needsReview, 2);
    assert.equal(queueSnapshot.queued, 0);
    assert.equal(queueSnapshot.active, 0);
    assert.equal(queueSnapshot.productionBatches.length, 1);
    assert.equal(queueSnapshot.productionBatches[0].paused, true);
    assert.equal(queueSnapshot.productionBatches[0].needsReview, 2);
    assert.equal(starts.length, 0);
    queue.stop();

    // Reinitialize backup scheduling: restored schedule configuration must be
    // present but disabled, so no timer or catch-up is armed automatically.
    const timers = fakeTimerApi();
    const scheduler = new ScheduledBackupService({
      dataDir:targetData,
      applicationDir:root,
      licensePath:targetLicense,
      controllerVersion:'0.23.0',
      setTimeoutFn:timers.setTimeoutFn,
      clearTimeoutFn:timers.clearTimeoutFn
    });
    const scheduleStatus = await scheduler.start({ now:new Date('2026-09-24T08:10:00.000Z') });
    assert.equal(scheduleStatus.enabled, false);
    assert.equal(scheduleStatus.nextRunAt, null);
    assert.equal(scheduleStatus.catchUpPending, false);
    assert.equal(timers.timers.length, 0);
    scheduler.stop();

    // Reinitialize licensing through the normal loader. Restore preserves the
    // document, but an invalid signature remains invalid and fails closed to
    // Community Edition rather than being trusted because it came from backup.
    const licenseManager = await loadLicenseManager({
      appDir:root,
      dataDir:targetData,
      env:{},
      preferredLicenseFile:targetLicense,
      trustedPublicKeys:{}
    });
    const license = licenseManager.getSnapshot({ printers:restoredPrinters });
    assert.equal(license.edition, 'community');
    assert.equal(license.source, 'invalid-license');
    assert.equal(license.licenseStatus, 'invalid');
    assert.equal(license.enforcementEnabled, true);

    const committed = await commitActivatedRestore(transaction, {
      now:new Date('2026-09-24T08:11:00.000Z')
    });
    assert.equal(committed.committed, true);
    const restoreStatus = await pendingRestoreStatus(targetData);
    assert.equal(restoreStatus.pending, false);
    assert.equal(restoreStatus.recentlyRestored, true);
    assert.ok(restoreStatus.rollbackRetainUntil);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
