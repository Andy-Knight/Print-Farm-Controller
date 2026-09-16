import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('interface exposes a persistent accessible light and dark mode switch', () => {
  assert.match(index, /id="themeToggle"/);
  assert.match(index, /role="switch"/);
  assert.match(index, /printer-fleet-theme/);
  assert.match(index, /prefers-color-scheme: light/);
  assert.match(app, /function applyTheme/);
  assert.match(app, /localStorage\.setItem\(THEME_STORAGE_KEY, next\)/);
  assert.match(app, /themeToggle\?\.addEventListener\('click'/);
  assert.match(styles, /:root\[data-theme="light"\]/);
  assert.match(styles, /\.theme-toggle-track::after/);
});

test('FlashForge cancelled state displays clearance-aware readiness while retaining raw status', () => {
  assert.match(app, /const CANCELLED_PRINTER_STATES = new Set/);
  assert.match(app, /printer\.adapterType === 'flashforge-ad5m'/);
  assert.match(app, /return queueBedClearance\(printer\.id\) \? 'cancelled' : 'ready'/);
  assert.match(app, /Printer reports \${rawState}/);
  assert.match(app, /clearance\.jobStatus[\s\S]*'cancelled'/);
});

test('U1 print setup uses material swatches instead of raw loaded-colour option text', () => {
  assert.match(app, /function physicalToolChoiceMarkup/);
  assert.match(app, /class=\\?"material-swatch/);
  assert.match(app, /data-tool-map-picker/);
  assert.doesNotMatch(app, /function physicalToolOptionText/);
  assert.match(styles, /\.tool-map-option \.material-swatch/);
});


test('Snapmaker U1 toolhead status puts RGB colour on a dedicated second line', () => {
  assert.match(app, /function filamentRgbText/);
  assert.match(app, /RGB\(\$\{red\}, \$\{green\}, \$\{blue\}\)/);
  assert.match(app, /data-material-rgb=/);
  assert.match(app, /\['snapmaker-u1','flashforge-ad5m','bambu-lab'\]\.includes\(printer\.adapterType\)/);
  assert.match(app, /rgbLine\?\.classList\.toggle\('hidden', !rgbText\)/);
  assert.match(styles, /\.material-tool > small\.material-rgb/);
  assert.doesNotMatch(app, /const values = \[source, reported, filament\.vendor \|\| filament\.manufacturer, filamentColorText\(filament\.color\)\]/);
  assert.match(app, /const details = \[presence, colorText, nozzle\]/);
});



test('FlashForge assigned filament colour shows hexadecimal and RGB values in toolhead status', () => {
  assert.match(app, /const values = \[source, reported, filament\.vendor \|\| filament\.manufacturer, normalizeColor\(filament\.color\)\]/);
  assert.match(app, /\['snapmaker-u1','flashforge-ad5m','bambu-lab'\]\.includes\(printer\.adapterType\)/);
  assert.match(app, /data-material-rgb=/);
  assert.match(app, /return `RGB\(\$\{red\}, \$\{green\}, \$\{blue\}\)`/);
});



test('Snapmaker U1 uses one control and one command for third-party filament type and colour', () => {
  assert.match(app, /function u1FilamentConfigEditState/);
  assert.match(app, /data-u1-filament-type-input/);
  assert.match(app, /data-u1-filament-color-input/);
  assert.match(app, /data-u1-filament-config-save/);
  assert.match(app, /Set filament on U1/);
  assert.match(app, /SNAPMAKER_U1_FILAMENT_TYPES/);
  assert.match(app, /\/filament-config/);
  assert.match(app, /Official Snapmaker RFID filament controls its own type and colour/);
  assert.doesNotMatch(app, /data-u1-filament-type-save/);
  assert.doesNotMatch(app, /data-u1-filament-color-save/);
  assert.match(styles, /\.u1-filament-config-control/);
});

test('U1 print setup exposes native timelapse and filament safety controls', () => {
  assert.match(app, /id=\"printSetupTimeLapse\"/);
  assert.match(app, /id=\"printSetupAutoReplenish\"/);
  assert.match(app, /id=\"printSetupEntangle\"/);
  assert.match(app, /id=\"printSetupEntangleSensitivity\"/);
  assert.match(app, /autoReplenishFilament: autoReplenish/);
  assert.match(app, /filamentEntangleSensitivity: entangleSensitivityValue/);
  assert.match(styles, /\.u1-print-options/);
});


test('U1 print setup warns on nozzle mismatch and exposes guided XYZ offset calibration', () => {
  assert.match(app, /function nozzleDiameterText/);
  assert.match(app, /requests a .*mm nozzle/);
  assert.match(app, /data-tool-offset-open/);
  assert.match(app, /data-tool-offset-action="start"/);
  assert.match(app, /data-tool-offset-action="advance-cleaning"/);
  assert.match(app, /data-tool-offset-action="check-plate"/);
  assert.doesNotMatch(app, /data-tool-offset-action="calibrate-tool"/);
  assert.match(app, /data-calibration-clean/);
  assert.match(app, />Cleaned<\/button>/);
  assert.match(app, /continue to T/);
  assert.match(styles, /\.calibration-clean-grid .*auto-fit.*minmax\(220px,1fr\)/);
  assert.match(styles, /\.calibration-tool-actions button .*white-space:nowrap/);
  assert.match(styles, /\.calibration-clean-tool small .*overflow-wrap:anywhere/);
  assert.match(app, /btn\.textContent = action === 'check-plate' \? 'Verifying…'[\s\S]*'Working…'/);
  assert.match(app, /cleanStatus\.textContent = toolIndex < 3[\s\S]*Cooling T\$\{toolIndex\} · preparing T\$\{toolIndex \+ 1\}/);
  assert.doesNotMatch(app, /btn\.textContent = action === 'check-plate' \? 'Verifying · probing follows…'/);
  assert.match(app, /Start cleaning sequence/);
  assert.match(app, /Verify plate & start probes/);
  assert.match(app, /Automatic XYZ probing/);
  assert.match(app, /automatically continue through the stock T0–T3 XYZ offset measurements/);
  assert.match(app, /data-tool-calibration-state/);
  assert.match(styles, /\.tool-offset-calibration/);
  assert.match(styles, /\.calibration-clean-grid/);
});


test('printer detail uses stable desktop columns so expanding maintenance does not rebalance panels', () => {
  assert.match(styles, /\.printer-dialog \{ width:min\(1200px,calc\(100vw - 30px\)\); \}/);
  assert.match(styles, /\.detail-grid \{ display:grid; grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\); gap:18px; align-items:start; \}/);
  assert.match(styles, /\.detail-grid > \.detail-column \{ min-width:0; \}/);
  assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.detail-grid \{ grid-template-columns:1fr; \}/);
  assert.match(app, /class="detail-column detail-column-left"/);
  assert.match(app, /class="detail-column detail-column-right"/);
  assert.match(app, /class="panel maintenance-panel"/);
  assert.match(app, /for \(const selector of \['\.chamber-preheat-panel', '\.fans-panel'\]\)/);
  assert.doesNotMatch(styles, /column-fill:balance/);
});

test('U1 XYZ calibration locks active workflow actions in the UI and server', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(app, /const toolOffsetActionLocks = new Map\(\)/);
  assert.match(app, /if \(toolOffsetActionLocks\.has\(id\)\)/);
  assert.match(app, /toolOffsetActionLocks\.set\(id, \{ action, toolIndex, startedAt: Date\.now\(\) \}\)/);
  assert.match(app, /stageDisabled \|\| Boolean\(actionInFlight\)/);
  assert.match(app, /action === 'start'\) stageDisabled = calibrationStarted/);
  assert.match(app, /action === 'check-plate'\) stageDisabled = !calibrationStarted \|\| !allCleaned/);
  assert.match(server, /const toolOffsetCalibrationLocks = new Map\(\)/);
  assert.match(server, /if \(toolOffsetCalibrationLocks\.has\(id\)\)/);
  assert.match(server, /toolOffsetCalibrationLocks\.delete\(id\)/);
});


test('dashboard exposes persistent print queue and printer file queue actions', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="queueBtn"/);
  assert.match(html, /id="queueDialog"/);
  assert.match(html, /id="queueActiveList"/);
  assert.match(html, /id="queueHistoryList"/);
  assert.match(app, /data-queue-file/);
  assert.match(app, /function renderPrintQueue/);
  assert.match(app, /await addPrintQueueJob/);
  assert.match(app, /renderU1PrintSetup\(printer, setup, btn\.dataset\.queueFile, 'queue'\)/);
  assert.match(styles, /\.queue-dialog/);
  assert.match(styles, /\.queue-job/);
});


test('queue UI can stage a file for the next available compatible printer', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const queue = fs.readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
  assert.match(html, /id="queueAddFileBtn"/);
  assert.match(html, /id="queueAddDialog"/);
  assert.match(html, /Next available compatible printer/);
  assert.match(app, /stageAutomaticQueueFile/);
  assert.match(app, /assignmentMode:'automatic'/);
  assert.match(app, /queueCompatibilityMarkup/);
  assert.match(server, /\/api\/queue\/stage/);
  assert.match(queue, /refreshAutomaticCompatibility/);
  assert.match(queue, /startAutomaticJob/);
  assert.match(styles, /\.queue-compatibility/);
});

test('cancelled queued jobs remain reprintable from recent history', () => {
  assert.match(app, /\['completed', 'failed', 'cancelled'\]\.includes\(job\.status\)/);
  assert.match(app, /data-queue-reprint=/);
  assert.match(app, /queueHistoryList\?\.addEventListener/);
  assert.match(app, /\/api\/queue\/\$\{encodeURIComponent\(job\.id\)\}\/reprint/);
});

test('queue UI exposes persistent bed-clearance interlock before automatic progression', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(app, /function queueBedClearance/);
  assert.match(app, /function confirmBedCleared/);
  assert.match(app, /BED CLEARANCE REQUIRED/);
  assert.match(app, /data-bed-cleared-card/);
  assert.match(app, /data-bed-cleared=/);
  assert.match(app, /awaiting bed clearance/);
  assert.match(server, /bed-clearance/);
  assert.match(server, /printQueue\.clearBed/);
  assert.match(html, /build plate has been confirmed clear/);
  assert.match(styles, /\.bed-clearance-strip/);
  assert.match(styles, /\.queue-job-clearance/);
});


test('dashboard labels fleet selection controls as fleet operations without redundant Done action', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="batchModeBtn"[^>]*>Fleet operations<\/button>/);
  assert.match(app, /selectionMode \? 'Exit fleet ops' : 'Fleet operations'/);
  assert.doesNotMatch(app, /Exit selection/);
  assert.doesNotMatch(html, /data-batch-done|>Done<\/button>/);
  assert.doesNotMatch(app, /data-batch-done/);
});


test('Fleet operations does not expose manual temperature setting', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const batchControl = fs.readFileSync(new URL('../src/batch-control.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-batch-open="temperature"|>Temperatures<\/button>/);
  assert.doesNotMatch(app, /title: 'Set temperatures'/);
  assert.doesNotMatch(app, /action === 'temperature'/);
  assert.doesNotMatch(batchControl, /case 'temperature'/);
  assert.match(html, /data-batch-direct="heaters-off"[^>]*>Heaters off<\/button>/);
  assert.match(batchControl, /case 'heaters-off'/);
});

test('FlashForge detail exposes printer-reported filament type in Toolhead status', () => {
  const printerApi = fs.readFileSync(new URL('../src/printer-api.js', import.meta.url), 'utf8');
  const adapter = fs.readFileSync(new URL('../src/adapters/flashforge-ad5m-adapter.js', import.meta.url), 'utf8');
  assert.match(printerApi, /rightFilamentType/);
  assert.match(printerApi, /materialSource: rightFilamentType \? 'printer'/);
  assert.match(adapter, /materialStatus: true/);
  assert.match(app, /Printer reported/);
  assert.match(app, /Filament presence unavailable/);
  assert.match(app, /FlashForge 5M local \/detail API/);
  assert.match(app, /Controller material type/);
  assert.match(app, /Controller filament colour/);
  assert.match(app, /data-material-color-input/);
  assert.match(app, /materialColorDesignation/);
  assert.match(app, /'ASA-CF'/);
  assert.match(app, /data-material-designation-save/);
  assert.match(app, /data-material-designation-clear/);
  assert.match(app, /Material and colour are used by automatic queue compatibility/);
});


test('FlashForge detail exposes persistent controller nozzle designation for automatic queue compatibility', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const adapter = fs.readFileSync(new URL('../src/adapters/flashforge-ad5m-adapter.js', import.meta.url), 'utf8');
  assert.match(app, /Controller nozzle designation/);
  assert.match(app, /data-nozzle-designation-save/);
  assert.match(app, /data-nozzle-designation-clear/);
  assert.match(app, /\/api\/printers\/\$\{id\}\/nozzle-designation/);
  assert.match(server, /action === 'nozzle-designation'/);
  assert.match(store, /setPrinterNozzleDesignation/);
  assert.match(adapter, /nozzleDiameterDesignation/);
  assert.match(adapter, /nozzleDiameterSource = 'manual'/);
});

test('FlashForge file material mismatch is warned for direct print and held for queue review', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const queue = fs.readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
  assert.match(app, /flashForgeFileMaterialCheck/);
  assert.match(app, /MATERIAL MISMATCH/);
  assert.match(app, /allowMaterialMismatch/);
  assert.match(app, /needs_review:'Needs review'/);
  assert.match(app, /data-queue-recheck/);
  assert.match(server, /action === 'file-material'/);
  assert.match(server, /Confirm Print anyway to override this warning/);
  assert.match(queue, /job\.status = 'needs_review'/);
  assert.match(queue, /Change the designation, then recheck this queued job/);
  assert.match(styles, /\.queue-status\.needs_review/);
});

test('printer detail supports persistent controller-side renaming while retaining reported identity', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  assert.match(app, /data-printer-name/);
  assert.match(app, /data-rename>Rename printer/);
  assert.match(app, /Printer-reported name/);
  assert.match(app, /\/api\/printers\/\$\{id\}\/name/);
  assert.match(app, /printer\.name = result\.printer\.name/);
  assert.match(server, /action === 'name'/);
  assert.match(server, /renamePrinter\(id, body\.name\)/);
  assert.match(store, /export async function renamePrinter/);
  assert.match(store, /Printer name must be 80 characters or fewer/);
});


test('finished production batches can be reprinted from recent history', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const queue = fs.readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
  assert.match(app, /data-production-reprint/);
  assert.match(app, /Reprint batch/);
  assert.match(app, /Reprint all \${batch\.quantity} copies/);
  assert.match(app, /production\/\$\{encodeURIComponent\(batchId\)\}\/reprint/);
  assert.match(server, /pause\|resume\|cancel\|quantity\|priority\|reprint/);
  assert.match(queue, /async reprintProduction/);
  assert.match(queue, /Production batch must be finished before it can be reprinted/);
});


test('printer detail exposes verified upload to an individual printer', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const fleetState = fs.readFileSync(new URL('../src/fleet-state.js', import.meta.url), 'utf8');
  assert.match(app, /data-printer-file-upload/);
  assert.match(app, /data-printer-file-upload-input/);
  assert.match(app, /Uploaded and verified/);
  assert.match(app, /\/api\/printers\/\$\{encodeURIComponent\(id\)\}\/files/);
  assert.match(server, /req\.method === 'POST' && action === 'files'/);
  assert.match(server, /printerIds:\[id\]/);
  assert.match(fleetState, /uploadExtensions/);
  assert.match(styles, /\.printer-file-upload/);
});

test('queue UI exposes production quantity and batch controls', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const queue = fs.readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
  assert.match(html, /id="queueAddQuantity"/);
  assert.match(html, /Quantity 2 or more creates one production batch/);
  assert.match(app, /productionBatchMarkup/);
  assert.match(app, /Pause production/);
  assert.match(app, /Cancel remaining/);
  assert.match(app, /data-production-quantity/);
  assert.match(server, /productionQueueMatch/);
  assert.match(queue, /pauseProduction/);
  assert.match(queue, /setProductionQuantity/);
  assert.match(queue, /productionBatches/);
  assert.match(styles, /\.production-progress/);
});

test('queue UI exposes persistent job and production priority controls', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const queue = fs.readFileSync(new URL('../src/print-queue.js', import.meta.url), 'utf8');
  assert.match(index, /id="queueAddPriority"/);
  assert.match(index, /Higher-priority jobs are offered/);
  assert.match(app, /data-queue-priority/);
  assert.match(app, /data-production-priority-select/);
  assert.match(app, /queuePriorityBadge/);
  assert.match(app, /queue-selection-reason/);
  assert.match(server, /setProductionPriority/);
  assert.match(server, /setPriority\(jobId, body\.priority\)/);
  assert.match(queue, /PRIORITY_AGING_MS/);
  assert.match(queue, /fileAlreadyPresent/);
  assert.match(styles, /\.queue-priority\.priority-high/);
});

test('production batch controls occupy a separate responsive row below batch items', () => {
  assert.match(styles, /\.production-batch\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.production-actions\s*\{[\s\S]*?width:100%[\s\S]*?border-top/);
  assert.match(styles, /\.production-actions > button,[\s\S]*?\.production-actions > label \{ flex:1 1 170px; \}/);
});
