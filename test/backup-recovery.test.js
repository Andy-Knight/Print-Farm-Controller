import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackupArchive, collectLogicalBackupSnapshot } from '../src/backup-recovery/backup-service.js';
import { inspectZipArchive } from '../src/backup-recovery/backup-archive.js';
import { verifyBackupArchive } from '../src/backup-recovery/backup-format.js';

test('logical backup creates a verified portable pfcbackup with known persistent state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-backup-test-'));
  const dataDir = path.join(root, 'data');
  const libraryId = '11111111-1111-4111-8111-111111111111';
  const libraryDir = path.join(dataDir, 'print-library', libraryId);
  const destination = path.join(root, 'controller-backup.pfcbackup');
  const licensePath = path.join(dataDir, 'license.json');
  try {
    await fs.mkdir(libraryDir, { recursive:true });
    await fs.writeFile(path.join(dataDir, 'printers.json'), JSON.stringify([{ id:'p1', name:'U1', checkCode:'secret' }]));
    await fs.writeFile(path.join(dataDir, 'print-jobs.json'), JSON.stringify([
      { id:'q1', status:'queued' },
      { id:'h1', status:'completed' }
    ]));
    await fs.writeFile(path.join(dataDir, 'file-material-metadata.json'), JSON.stringify({ p1:{ test:{ requiredMaterial:'PLA' } } }));
    await fs.writeFile(path.join(dataDir, 'emulator-settings.json'), JSON.stringify({ enabled:true }));
    await fs.writeFile(path.join(dataDir, 'maintenance.json'), JSON.stringify({ version:1, modelTasks:[], groupTasks:[], printers:{ p1:{ usage:{ printSeconds:7200, printCount:4 }, tasks:[], history:[] } } }));
    await fs.writeFile(path.join(dataDir, 'printer-groups.json'), JSON.stringify({
      version:1,
      groups:[{ id:'group-1', name:'Production', printerIds:['p1'], createdAt:'2026-09-24T16:00:00.000Z', updatedAt:'2026-09-24T16:00:00.000Z' }]
    }));
    await fs.writeFile(licensePath, JSON.stringify({ payload:'signed-test-document' }));
    const gcode = 'G28\nG1 X10\n';
    await fs.writeFile(path.join(libraryDir, 'part.gcode'), gcode);
    await fs.writeFile(path.join(libraryDir, 'preview.png'), Buffer.from([0x89,0x50,0x4e,0x47]));
    await fs.writeFile(path.join(libraryDir, 'metadata.json'), JSON.stringify({
      id:libraryId, fileName:'part.gcode', size:Buffer.byteLength(gcode), sha256:'a'.repeat(64),
      description:'Backup test', preview:{ available:true, mimeType:'image/png', fileName:'preview.png' }
    }));
    await fs.mkdir(path.join(root, 'logs'), { recursive:true });
    await fs.writeFile(path.join(root, 'logs', 'controller.log'), 'must not be backed up');
    await fs.writeFile(path.join(dataDir, 'private-signing-key.pem'), 'must not be backed up');

    const result = await createBackupArchive({
      destinationPath:destination,
      dataDir,
      applicationDir:root,
      licensePath,
      controllerVersion:'0.23.0',
      now:new Date('2026-09-24T16:30:00.000Z')
    });
    assert.equal(result.manifest.format, 'print-farm-controller-backup');
    assert.equal(result.manifest.formatVersion, 1);
    assert.equal(result.manifest.counts.printers, 1);
    assert.equal(result.manifest.counts.printLibrary, 1);
    assert.equal(result.manifest.counts.queued, 1);
    assert.equal(result.manifest.counts.history, 1);
    assert.equal(result.manifest.licenseIncluded, true);
    assert.match(result.manifest.installationId, /^[0-9a-f-]{36}$/);

    const verified = await verifyBackupArchive(destination);
    assert.equal(verified.manifest.sourceControllerVersion, '0.23.0');
    const archive = await inspectZipArchive(destination);
    const names = new Set(archive.entries.map((entry) => entry.name));
    for (const expected of [
      'manifest.json','checksums.json','state/printers.json','state/print-jobs.json',
      'state/file-material-metadata.json','state/emulator-settings.json','state/backup-settings.json','state/maintenance.json','state/printer-groups.json',
      'state/license.json',`print-library/${libraryId}/metadata.json`,
      `print-library/${libraryId}/part.gcode`,`print-library/${libraryId}/preview.png`
    ]) assert.ok(names.has(expected), expected);
    assert.equal([...names].some((name) => /log|private-signing-key/i.test(name)), false);
    assert.equal((await archive.read(`print-library/${libraryId}/part.gcode`)).toString(), gcode);
    const maintenance = JSON.parse((await archive.read('state/maintenance.json')).toString('utf8'));
    assert.equal(maintenance.printers.p1.usage.printSeconds, 7200);
    const printerGroups = JSON.parse((await archive.read('state/printer-groups.json')).toString('utf8'));
    assert.equal(printerGroups.groups[0].name, 'Production');
    assert.deepEqual(printerGroups.groups[0].printerIds, ['p1']);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('backup snapshot is path independent and never exposes absolute host paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-backup-path-test-'));
  const dataDir = path.join(root, 'custom-data');
  try {
    await fs.mkdir(dataDir, { recursive:true });
    const snapshot = await collectLogicalBackupSnapshot({
      dataDir,
      applicationDir:root,
      licensePath:path.join(root, 'missing-license.json'),
      controllerVersion:'0.23.0'
    });
    for (const entry of snapshot.entries) {
      assert.equal(path.isAbsolute(entry.name), false);
      assert.equal(entry.name.includes('..'), false);
      assert.equal(entry.name.includes(root.replace(/\\/g, '/')), false);
    }
    assert.equal(snapshot.manifest.counts.printers, 0);
    assert.equal(snapshot.manifest.counts.printLibrary, 0);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('backup verification rejects archive corruption', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-backup-corrupt-test-'));
  const dataDir = path.join(root, 'data');
  const destination = path.join(root, 'corrupt.pfcbackup');
  try {
    await fs.mkdir(dataDir, { recursive:true });
    await createBackupArchive({ destinationPath:destination, dataDir, licensePath:path.join(root, 'none'), controllerVersion:'0.23.0' });
    const archive = await inspectZipArchive(destination);
    const printers = archive.byName.get('state/printers.json');
    const handle = await fs.open(destination, 'r+');
    try {
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, printers.localOffset);
      const start = printers.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const byte = Buffer.alloc(1);
      await handle.read(byte, 0, 1, start);
      byte[0] ^= 0xff;
      await handle.write(byte, 0, 1, start);
    } finally {
      await handle.close();
    }
    await assert.rejects(() => verifyBackupArchive(destination), /CRC mismatch|checksum mismatch/i);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});
