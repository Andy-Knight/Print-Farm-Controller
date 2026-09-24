import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const restoreService = fs.readFileSync(new URL('../src/backup-recovery/restore-service.js', import.meta.url), 'utf8');
const scheduledBackupService = fs.readFileSync(new URL('../src/backup-recovery/scheduled-backup-service.js', import.meta.url), 'utf8');

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


test('restore inspection enables staged restart-based restore with cancel support', () => {
  assert.match(index, /id="restoreBackupFileInput"[^>]*accept="\.pfcbackup/);
  assert.match(index, /id="restoreInspectBtn"[^>]*>Inspect backup<\/button>/);
  assert.match(index, /id="restoreStageBtn"[^>]*disabled[^>]*>Restore backup<\/button>/);
  assert.match(index, /id="restoreCancelStageBtn"[^>]*>Cancel staged restore<\/button>/);
  assert.match(index, /Inspection never changes controller data/);
  assert.match(index, /staged restore activates only after Print Farm Controller is restarted/);
  assert.match(app, /async function inspectRestoreFile\(\)/);
  assert.match(app, /fetch\('\/api\/restore\/inspect'/);
  assert.match(app, /renderRestoreInspection\(payload\.inspection\)/);
  assert.match(app, /restoreStageBtn\.disabled = false/);
  assert.match(app, /async function stageRestoreFile\(\)/);
  assert.match(app, /fetch\('\/api\/restore\/stage'/);
  assert.match(app, /async function cancelStagedRestoreUi\(\)/);
  assert.match(app, /api\('\/api\/restore\/stage', \{ method:'DELETE' \}\)/);
  assert.match(app, /Restore staged — restart required/);
  assert.match(app, /Restored — review required/);
  assert.match(styles, /\.restore-inspection-summary/);
  assert.match(styles, /\.restore-valid-banner/);
  assert.match(styles, /\.restore-staged-banner/);
  assert.match(styles, /\.queue-status\.restore-hold/);
  assert.match(server, /url\.pathname === '\/api\/restore\/inspect'/);
  assert.match(server, /url\.pathname === '\/api\/restore\/stage'/);
  assert.match(server, /stageRestoreBackup\(uploaded\.filePath/);
  assert.match(server, /activatePendingRestore/);
  assert.match(server, /commitActivatedRestore/);
  assert.match(server, /rollbackActivatedRestore/);
  assert.match(server, /restorePendingRestart/);
  assert.match(server, /printQueue\.setDispatchPaused\(true\)/);
  assert.match(server, /activeMutationRequests > 1/);
  assert.match(server, /restorePendingRestart \|\| restoreInspectionInProgress/);
  assert.match(server, /Restore staged; controller restart required/);
  assert.match(restoreService, /phase:'staged'/);
  assert.match(restoreService, /marker\.phase = 'activating'/);
  assert.match(restoreService, /marker\.phase = 'installing'/);
  assert.match(restoreService, /marker\.phase = 'activated'/);
  assert.match(restoreService, /marker\.phase = 'committed'/);
  assert.match(restoreService, /RESTORE_ROLLBACK_RETENTION_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(restoreService, /restoreRecoveryHold = true/);
});


test('scheduled backup UI configures writable local or network destinations and retention', () => {
  assert.match(index, /id="backupScheduleEnabled"/);
  assert.match(index, /id="backupScheduleDestination"/);
  assert.match(index, /id="backupScheduleFrequency"/);
  assert.match(index, /id="backupScheduleTime"/);
  assert.match(index, /id="backupScheduleWeekday"/);
  assert.match(index, /id="backupScheduleRetention"[^>]*value="14"/);
  assert.match(index, /id="backupTestDestinationBtn"[^>]*>Test destination<\/button>/);
  assert.match(index, /id="backupSaveScheduleBtn"[^>]*>Save schedule<\/button>/);
  assert.match(index, /Manual backups and backups from other installations are never pruned/);

  assert.match(app, /async function testScheduledBackupDestination\(\)/);
  assert.match(app, /api\('\/api\/backup\/test-destination'/);
  assert.match(app, /async function saveScheduledBackupSettings\(\)/);
  assert.match(app, /api\('\/api\/backup\/settings'/);
  assert.match(app, /updateBackupWeekdayVisibility/);
  assert.match(app, /Next scheduled backup/);

  assert.match(server, /new ScheduledBackupService/);
  assert.match(server, /new BackupOperationLock/);
  assert.match(server, /url\.pathname === '\/api\/backup\/settings'/);
  assert.match(server, /url\.pathname === '\/api\/backup\/test-destination'/);
  assert.match(server, /scheduledBackupService\.start\(\)/);
  assert.match(server, /scheduledBackupService\.stop\(\)/);

  assert.match(scheduledBackupService, /source:'scheduled'/);
  assert.match(scheduledBackupService, /manifest\.backupSource !== 'scheduled'/);
  assert.match(scheduledBackupService, /manifest\.installationId/);
  assert.match(scheduledBackupService, /retentionCount/);
  assert.match(scheduledBackupService, /newestBackupPath/);
  assert.match(styles, /\.backup-schedule-grid/);
});
