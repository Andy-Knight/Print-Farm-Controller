import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscoveryResponse } from '../src/discovery.js';

test('parses a modern Adventurer 5M Pro discovery packet', () => {
  const packet = Buffer.alloc(276);
  packet.write('Workshop Pro', 0x00, 'utf8');
  packet.writeUInt16BE(8899, 0x84);
  packet.writeUInt16BE(0x2b71, 0x86);
  packet.writeUInt16BE(0x0024, 0x88);
  packet.writeUInt16BE(1, 0x8a);
  packet.writeUInt16BE(0x5a02, 0x8c);
  packet.writeUInt16BE(8898, 0x8e);
  packet.writeUInt8(1, 0x90);
  packet.write('SNAD5MPRO123', 0x92, 'utf8');

  const printer = parseDiscoveryResponse(packet, '192.168.1.42');
  assert.equal(printer.model, 'Adventurer 5M Pro');
  assert.equal(printer.adapterType, 'flashforge-ad5m');
  assert.equal(printer.manufacturer, 'FlashForge');
  assert.equal(printer.host, '192.168.1.42');
  assert.equal(printer.serialNumber, 'SNAD5MPRO123');
  assert.equal(printer.commandPort, 8899);
  assert.equal(printer.httpPort, 8898);
  assert.equal(printer.lanMode, true);
  assert.equal(printer.status, 'busy');
});

test('ignores undersized UDP responses', () => {
  assert.equal(parseDiscoveryResponse(Buffer.alloc(20), '192.168.1.50'), null);
});
