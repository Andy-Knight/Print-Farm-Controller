import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('Backup and Recovery is available from the controller overflow menu', () => {
  assert.match(index, /id="backupRecoveryBtn"[^>]*>Backup &amp; recovery<\/button>/);
  assert.match(index, /id="backupRecoveryDialog"/);
  assert.match(index, /id="backupCreateBtn"[^>]*>Create backup now<\/button>/);
  assert.match(index, /v0\.23\.0 backups are integrity-checked but are not encrypted/);
  assert.match(index, /Restore backup<\/button>/);
  assert.match(index, /Restore backup<\/button>[\s\S]*disabled|disabled>Restore backup/);
  assert.match(app, /backupRecoveryBtn\?\.addEventListener/);
  assert.match(app, /backupCreateBtn\?\.addEventListener\('click', createManualBackup\)/);
  assert.match(styles, /\.backup-recovery-dialog/);
  assert.match(styles, /\.backup-warning/);
});

test('manual backup UI uses create/status API and one-time streamed download URL', () => {
  assert.match(app, /api\('\/api\/backup\/status'\)/);
  assert.match(app, /api\('\/api\/backup\/create', \{ method:'POST' \}\)/);
  assert.match(app, /link\.href = backup\.downloadUrl/);
  assert.match(app, /Backup verified/);
  assert.match(server, /new ManualBackupManager/);
  assert.match(server, /url\.pathname === '\/api\/backup\/status'/);
  assert.match(server, /url\.pathname === '\/api\/backup\/create'/);
  assert.ok(server.includes("url.pathname.match(/^\\/api\\/backup\\/download\\/([^/]+)$/)"));
  assert.match(server, /manualBackupManager\.stream\(backupId, res\)/);
  assert.match(server, /Manual backup created and verified/);
});


test('restore inspection validates a pfcbackup without enabling restore activation', () => {
  assert.match(index, /id="restoreBackupFileInput"[^>]*accept="\.pfcbackup/);
  assert.match(index, /id="restoreInspectBtn"[^>]*>Inspect backup<\/button>/);
  assert.match(index, /id="restoreStageBtn"[^>]*disabled[^>]*>Restore backup<\/button>/);
  assert.match(index, /Inspection never changes controller data/);
  assert.match(app, /async function inspectRestoreFile\(\)/);
  assert.match(app, /fetch\('\/api\/restore\/inspect'/);
  assert.match(app, /renderRestoreInspection\(payload\.inspection\)/);
  assert.match(app, /Backup is valid/);
  assert.match(app, /Actual restore\/staging is not enabled in this build yet/);
  assert.match(styles, /\.restore-inspection-summary/);
  assert.match(styles, /\.restore-valid-banner/);
  assert.match(server, /url\.pathname === '\/api\/restore\/inspect'/);
  assert.match(server, /inspectRestoreBackup\(staged\.filePath/);
  assert.match(server, /restoreInspectionInProgress/);
  assert.match(server, /Restore backup inspection passed/);
});
