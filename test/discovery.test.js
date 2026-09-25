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

test('parses Creator 5 and Creator 5 Pro discovery packets', () => {
  for (const [pid, model, host] of [
    [0x0028, 'Creator 5', '192.168.1.50'],
    [0x0029, 'Creator 5 Pro', '192.168.1.51']
  ]) {
    const packet = Buffer.alloc(276);
    packet.write(model, 0x00, 'utf8');
    packet.writeUInt16BE(8899, 0x84);
    packet.writeUInt16BE(0x2b71, 0x86);
    packet.writeUInt16BE(pid, 0x88);
    packet.writeUInt16BE(0, 0x8a);
    packet.writeUInt16BE(0x5a02, 0x8c);
    packet.writeUInt16BE(8898, 0x8e);
    packet.writeUInt8(1, 0x90);
    packet.write(`SN-${pid}`, 0x92, 'utf8');

    const printer = parseDiscoveryResponse(packet, host);
    assert.equal(printer.model, model);
    assert.equal(printer.adapterType, 'flashforge-creator5');
    assert.equal(printer.manufacturer, 'FlashForge');
    assert.equal(printer.host, host);
    assert.equal(printer.httpPort, 8898);
    // Discovery still carries the legacy command port even though Creator 5
    // does not serve it; the Creator adapter deliberately ignores it.
    assert.equal(printer.commandPort, 8899);
  }
});

test('ignores undersized UDP responses', () => {
  assert.equal(parseDiscoveryResponse(Buffer.alloc(20), '192.168.1.50'), null);
});
