import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { listAllFilesTcp, parseM661FileList } from '../src/tcp-files.js';

test('parses modern M661 /data entries and preserves spaces', () => {
  const response = [
    'CMD M661 Received.',
    'ok',
    '::/data/Benchy.gcode::/data/Parts/door bracket.3mf::/data/Calibration Cube.gx'
  ].join('\n');

  assert.deepEqual(parseM661FileList(response), [
    'Benchy.gcode',
    'Parts/door bracket.3mf',
    'Calibration Cube.gx'
  ]);
});

test('parses documented line-oriented M661 response', () => {
  const response = [
    'CMD M661 Received.',
    'info_list.size: 3',
    'test1.gcode',
    'test2.gx',
    'test3.g',
    'ok'
  ].join('\n');

  assert.deepEqual(parseM661FileList(response), ['test1.gcode', 'test2.gx', 'test3.g']);
});


test('parses one /data file per line firmware variant', () => {
  const response = [
    'CMD M661 Received.',
    '/data/alpha.gcode',
    '/data/folder/beta part.3mf',
    'ok'
  ].join('\n');

  assert.deepEqual(parseM661FileList(response), ['alpha.gcode', 'folder/beta part.3mf']);
});

test('waits for delayed second-stage M661 payload', async (t) => {
  const commands = [];
  const server = net.createServer((socket) => {
    let pending = '';
    socket.on('data', (buffer) => {
      pending += buffer.toString('ascii');
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const command = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!command) continue;
        commands.push(command);
        if (command === '~M601 S1') {
          socket.write('CMD M601 Received.\nControl Success.\nok\n');
        } else if (command === '~M661') {
          socket.write('CMD M661 Received.\nok\n');
          setTimeout(() => socket.write('::/data/old-job.gcode::/data/new job.3mf'), 25);
        } else if (command === '~M602') {
          socket.write('CMD M602 Received.\nControl Release.\nok\n');
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const files = await listAllFilesTcp(
    { host: '127.0.0.1', tcpPort: port },
    { settleMs: 150, connectTimeoutMs: 500, commandTimeoutMs: 1000 }
  );

  assert.deepEqual(files, ['old-job.gcode', 'new job.3mf']);
  assert.deepEqual(commands.slice(0, 3), ['~M601 S1', '~M661', '~M602']);
});
