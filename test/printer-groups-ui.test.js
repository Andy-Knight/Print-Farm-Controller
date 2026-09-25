import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const queue = fs.readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
const backupService = fs.readFileSync(new URL('../src/backup-recovery/backup-service.js', import.meta.url), 'utf8');
const restoreService = fs.readFileSync(new URL('../src/backup-recovery/restore-service.js', import.meta.url), 'utf8');

test('printer groups are manageable from the controller overflow menu', () => {
  assert.match(index, /id="printerGroupsBtn"[^>]*>Printer groups<\/button>/);
  assert.match(index, /id="printerGroupsDialog"/);
  assert.match(index, /id="printerGroupForm"/);
  assert.match(index, /id="printerGroupMembers"/);
  assert.match(app, /api\('\/api\/printer-groups'\)/);
  assert.match(app, /data-printer-group-member/);
  assert.match(app, /data-printer-group-edit/);
  assert.match(app, /data-printer-group-delete/);
  assert.match(server, /new PrinterGroupService/);
  assert.match(server, /url\.pathname === '\/api\/printer-groups'/);
  assert.match(server, /printerGroups\.create/);
  assert.match(server, /printerGroups\.update/);
  assert.match(server, /printerGroups\.delete/);
  assert.match(styles, /\.printer-groups-dialog/);
  assert.match(styles, /\.printer-group-member/);
});

test('printer group member checkboxes override global full-width input styling', () => {
  assert.match(styles, /\.printer-group-member input\[type="checkbox"\]/);
  assert.match(styles, /width:16px/);
  assert.match(styles, /height:16px/);
  assert.match(styles, /flex:0 0 16px/);
  assert.match(styles, /\.printer-group-member span \{[\s\S]*flex:1 1 auto/);
});

test('automatic fleet queue can be restricted to a selected printer group', () => {
  assert.match(index, /id="queueAddGroup"[^>]*name="groupId"/);
  assert.match(index, /Any configured printer/);
  assert.match(app, /populateQueueGroupOptions/);
  assert.match(app, /const groupId = String\(data\.get\('groupId'\)/);
  assert.match(app, /queueLibraryFile\(queueAddLibraryFile\.id, options, quantity, priority, groupId\)/);
  assert.match(server, /groupId: body\.groupId \|\| null/);
  assert.match(queue, /getPrinterGroupFn/);
  assert.match(queue, /groupId:requestedGroup\?\.id \|\| null/);
  assert.match(queue, /code:restrictedGroup \? 'printer_group' : 'printer_group_missing'/);
  assert.match(queue, /Not a member of printer group/);
  assert.match(app, /Printer group: \$\{job\.groupName \|\| job\.groupId\}/);
});

test('printer group state participates in backup and restore', () => {
  assert.match(backupService, /state\/printer-groups\.json/);
  assert.match(restoreService, /'printer-groups\.json'/);
  assert.match(restoreService, /state\/printer-groups\.json/);
  assert.match(restoreService, /\{ version:1, groups:\[\] \}/);
});
