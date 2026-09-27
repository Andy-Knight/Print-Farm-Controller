import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { parseDiscoveryResponse, parseFlashForgeM115, probeFlashForgeM115 } from '../src/discovery.js';

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


test('parses an Adventurer 5M Pro M115 identity response', () => {
  const response = [
    'CMD M115 Received.',
    'Machine Type: FlashForge Adventurer 5M Pro',
    'Machine Name: Workshop Pro',
    'Firmware: v3.2.7',
    'SN: SNAD5MPRO123',
    'X: 220 Y: 220 Z: 220',
    'Tool Count: 1',
    'ok'
  ].join('\n');

  const printer = parseFlashForgeM115(response, '192.168.1.42');
  assert.equal(printer.adapterType, 'flashforge-ad5m');
  assert.equal(printer.model, 'Adventurer 5M Pro');
  assert.equal(printer.name, 'Workshop Pro');
  assert.equal(printer.serialNumber, 'SNAD5MPRO123');
  assert.equal(printer.host, '192.168.1.42');
  assert.equal(printer.commandPort, 8899);
  assert.equal(printer.httpPort, 8898);
  assert.equal(printer.firmwareVersion, 'v3.2.7');
});

test('M115 identity parser ignores unrelated TCP services and unsupported models', () => {
  assert.equal(parseFlashForgeM115('HTTP/1.1 200 OK', '192.168.1.10'), null);
  assert.equal(parseFlashForgeM115([
    'Machine Type: FlashForge Adventurer III',
    'Machine Name: Legacy',
    'SN: LEGACY123',
    'ok'
  ].join('\n'), '192.168.1.11'), null);
});

test('active M115 probe discovers an AD5M-family printer over TCP', async (t) => {
  const server = net.createServer((socket) => {
    socket.on('data', (buffer) => {
      if (!buffer.toString('ascii').includes('~M115')) return;
      socket.write([
        'CMD M115 Received.',
        'Machine Type: FlashForge Adventurer 5M',
        'Machine Name: Container Test',
        'Firmware: v5.1.8',
        'SN: SNCONTAINER001',
        'ok',
        ''
      ].join('\n'));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const port = server.address().port;
  const printer = await probeFlashForgeM115('127.0.0.1', { port, timeoutMs:500 });
  assert.equal(printer?.model, 'Adventurer 5M');
  assert.equal(printer?.name, 'Container Test');
  assert.equal(printer?.serialNumber, 'SNCONTAINER001');
});
