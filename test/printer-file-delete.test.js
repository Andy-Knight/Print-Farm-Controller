import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { DEFAULT_CAPABILITIES } from '../src/adapters/printer-adapter.js';
import { getPrinterAdapter, preparePrinterConfig } from '../src/adapters/adapter-registry.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const moonraker = fs.readFileSync(new URL('../src/moonraker-api.js', import.meta.url), 'utf8');
const prusaLink = fs.readFileSync(new URL('../src/prusa-link-api.js', import.meta.url), 'utf8');
const bambuFtps = fs.readFileSync(new URL('../src/bambu-ftps.js', import.meta.url), 'utf8');

test('printer file deletion is opt-in and enabled only by adapters with an implemented delete path', () => {
  assert.equal(DEFAULT_CAPABILITIES.fileDelete, false);

  const u1 = getPrinterAdapter(preparePrinterConfig({
    adapterType:'snapmaker-u1',
    name:'U1',
    host:'192.168.1.20'
  }));
  assert.equal(u1.capabilities.fileDelete, true);

  const prusa = getPrinterAdapter(preparePrinterConfig({
    adapterType:'prusa-core-one-plus',
    name:'CORE One+',
    host:'192.168.1.21',
    apiKey:'test'
  }));
  assert.equal(prusa.capabilities.fileDelete, true);

  const bambu = getPrinterAdapter(preparePrinterConfig({
    adapterType:'bambu-lab',
    name:'P1S',
    model:'P1S',
    host:'192.168.1.22',
    serialNumber:'TESTSERIAL',
    accessCode:'12345678'
  }));
  assert.equal(bambu.capabilities.fileDelete, true);

  const ad5m = getPrinterAdapter(preparePrinterConfig({
    adapterType:'flashforge-ad5m',
    name:'AD5M',
    host:'192.168.1.23',
    serialNumber:'TEST',
    checkCode:'12345678'
  }));
  assert.equal(ad5m.capabilities.fileDelete, false);
});

test('supported printer protocols implement destructive file operations', () => {
  assert.match(moonraker, /export async function deleteMoonrakerFile/);
  assert.match(moonraker, /server\/files\/gcodes/);
  assert.match(moonraker, /method:'DELETE'/);

  assert.match(prusaLink, /export async function deletePrusaLinkFile/);
  assert.match(prusaLink, /prusaRequest\(printer, target\.route, \{ method:'DELETE'/);

  assert.match(bambuFtps, /async delete\(remoteName\)/);
  assert.match(bambuFtps, /DELE \$\{target\}/);
  assert.match(bambuFtps, /export function deleteBambuFile/);
});

test('printer files API and UI expose delete only when the capability is advertised', () => {
  assert.match(server, /req\.method === 'DELETE' && action === 'files'/);
  assert.match(server, /adapter\.capabilities\?\.fileDelete/);
  assert.match(server, /adapter\.deleteFile\(fileName\)/);

  assert.match(app, /capabilities\.fileDelete \? .*data-delete-printer-file/s);
  assert.match(app, /data-delete-printer-file/);
  assert.match(app, /This deletes only the copy stored on the printer\. The Print Library is not affected\./);
  assert.match(app, /method:'DELETE'/);
  assert.match(app, /await openPrinter\(id\)/);
});
