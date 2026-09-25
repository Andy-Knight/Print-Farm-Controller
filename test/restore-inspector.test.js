import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectLogicalBackupSnapshot, createBackupArchive } from '../src/backup-recovery/backup-service.js';
import { safeArchivePath, writeZipArchive } from '../src/backup-recovery/backup-archive.js';
import { inspectRestoreBackup } from '../src/backup-recovery/restore-inspector.js';
import { validateBackupUploadFilename } from '../src/backup-recovery/restore-upload-staging.js';

async function makeRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(dataDir, { recursive:true });
  return { root, dataDir };
}

async function seedLibrary(dataDir, {
  id = '11111111-1111-4111-8111-111111111111',
  fileName = 'part.gcode',
  content = 'G28\nG1 X10\n'
} = {}) {
  const directory = path.join(dataDir, 'print-library', id);
  await fs.mkdir(directory, { recursive:true });
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  await fs.writeFile(path.join(directory, fileName), content);
  await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify({
    id,
    fileName,
    size:Buffer.byteLength(content),
    sha256,
    description:'Restore inspection test',
    preview:{ available:false, checkedAt:'2026-09-24T17:00:00.000Z', source:null },
    addedAt:'2026-09-24T17:00:00.000Z',
    stagedAt:'2026-09-24T17:00:00.000Z',
    requirements:null
  }));
  return { id, fileName, sha256 };
}

test('restore inspection validates a current backup and reports contents without changing live data', async () => {
  const { root, dataDir } = await makeRoot('pfc-restore-inspect-valid-');
  const backupPath = path.join(root, 'valid.pfcbackup');
  try {
    const library = await seedLibrary(dataDir);
    const printers = [{ id:'printer-1', name:'Workshop U1', adapterType:'snapmaker-u1' }];
    const jobs = [
      { id:'queued-1', status:'queued', stagedFile:{ id:library.id, fileName:library.fileName } },
      { id:'history-1', status:'completed', stagedFile:{ id:library.id, fileName:library.fileName } }
    ];
    await fs.writeFile(path.join(dataDir, 'printers.json'), JSON.stringify(printers));
    await fs.writeFile(path.join(dataDir, 'print-jobs.json'), JSON.stringify(jobs));
    await fs.writeFile(path.join(dataDir, 'file-material-metadata.json'), '{}');

    await createBackupArchive({
      destinationPath:backupPath,
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'missing-license.json'),
      controllerVersion:'0.23.0',
      now:new Date('2026-09-24T17:30:00.000Z')
    });

    const beforePrinters = await fs.readFile(path.join(dataDir, 'printers.json'), 'utf8');
    const beforeJobs = await fs.readFile(path.join(dataDir, 'print-jobs.json'), 'utf8');
    const inspection = await inspectRestoreBackup(backupPath, {
      currentControllerVersion:'0.23.0',
      targetDataDir:dataDir,
      originalFileName:'valid.pfcbackup'
    });

    assert.equal(inspection.valid, true);
    assert.equal(inspection.fileName, 'valid.pfcbackup');
    assert.equal(inspection.sourceControllerVersion, '0.23.0');
    assert.deepEqual(inspection.counts, { printers:1, printLibrary:1, queued:1, history:1 });
    assert.equal(inspection.licenseIncluded, false);
    assert.equal(inspection.migrationsRequired.length, 0);
    assert.match(inspection.warnings.join(' '), /recovery hold/i);
    assert.equal(await fs.readFile(path.join(dataDir, 'printers.json'), 'utf8'), beforePrinters);
    assert.equal(await fs.readFile(path.join(dataDir, 'print-jobs.json'), 'utf8'), beforeJobs);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('restore inspection validates printer groups and rejects duplicate membership', async () => {
  const { root, dataDir } = await makeRoot('pfc-restore-groups-');
  const backupPath = path.join(root, 'groups.pfcbackup');
  try {
    const printers = [{ id:'p1', name:'Printer 1' }, { id:'p2', name:'Printer 2' }];
    await fs.writeFile(path.join(dataDir, 'printers.json'), JSON.stringify(printers));
    await fs.writeFile(path.join(dataDir, 'print-jobs.json'), '[]');
    await fs.writeFile(path.join(dataDir, 'file-material-metadata.json'), '{}');
    await fs.writeFile(path.join(dataDir, 'printer-groups.json'), JSON.stringify({
      version:1,
      groups:[
        { id:'g1', name:'Production', printerIds:['p1'] },
        { id:'g2', name:'Prototype', printerIds:['p1','p2'] }
      ]
    }));

    await createBackupArchive({
      destinationPath:backupPath,
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'none'),
      controllerVersion:'0.25.0'
    });

    await assert.rejects(
      () => inspectRestoreBackup(backupPath, { currentControllerVersion:'0.25.0', targetDataDir:dataDir }),
      /more than one printer group/i
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('restore inspection rejects a backup created by a newer controller version', async () => {
  const { root, dataDir } = await makeRoot('pfc-restore-newer-version-');
  const backupPath = path.join(root, 'newer.pfcbackup');
  try {
    await createBackupArchive({
      destinationPath:backupPath,
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'none'),
      controllerVersion:'0.24.0'
    });
    await assert.rejects(
      () => inspectRestoreBackup(backupPath, { currentControllerVersion:'0.23.0', targetDataDir:dataDir }),
      /created by newer Print Farm Controller v0\.24\.0/
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('restore inspection rejects queue references to missing Print Library files', async () => {
  const { root, dataDir } = await makeRoot('pfc-restore-missing-library-');
  const backupPath = path.join(root, 'missing-library.pfcbackup');
  try {
    await fs.writeFile(path.join(dataDir, 'print-jobs.json'), JSON.stringify([{
      id:'queued-1',
      status:'queued',
      stagedFile:{ id:'22222222-2222-4222-8222-222222222222', fileName:'missing.gcode' }
    }]));
    await createBackupArchive({
      destinationPath:backupPath,
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'none'),
      controllerVersion:'0.23.0'
    });
    await assert.rejects(
      () => inspectRestoreBackup(backupPath, { currentControllerVersion:'0.23.0', targetDataDir:dataDir }),
      /references missing Print Library file/
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('restore inspection rejects archive entries not covered by checksums', async () => {
  const { root, dataDir } = await makeRoot('pfc-restore-unchecksummed-');
  const backupPath = path.join(root, 'unchecksummed.pfcbackup');
  try {
    const snapshot = await collectLogicalBackupSnapshot({
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'none'),
      controllerVersion:'0.23.0'
    });
    await writeZipArchive(backupPath, [
      ...snapshot.entries,
      { name:'unexpected.txt', buffer:Buffer.from('not checksummed') }
    ]);
    await assert.rejects(
      () => inspectRestoreBackup(backupPath, { currentControllerVersion:'0.23.0', targetDataDir:dataDir }),
      /not covered by the checksum document/
    );
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('backup archive and restore upload paths reject absolute, traversal and wrong-extension names', () => {
  assert.throws(() => safeArchivePath('/absolute/state.json'), /must be relative/);
  assert.throws(() => safeArchivePath('C:\\absolute\\state.json'), /must be relative/);
  assert.throws(() => safeArchivePath('../state.json'), /invalid/);
  assert.throws(() => safeArchivePath('print-library//file.gcode'), /invalid/);
  assert.equal(validateBackupUploadFilename('controller.pfcbackup'), 'controller.pfcbackup');
  assert.throws(() => validateBackupUploadFilename('../controller.pfcbackup'), /must not contain a path/);
  assert.throws(() => validateBackupUploadFilename('controller.zip'), /Choose a \.pfcbackup file/);
});
