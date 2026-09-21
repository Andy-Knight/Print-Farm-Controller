import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { stageUploadRequest, validateUploadFilename } from '../src/upload-staging.js';

test('stages a raw browser upload and removes it during cleanup', async () => {
  const request = Readable.from([Buffer.from('G28\n'), Buffer.from('M104 S0\n')]);
  request.headers = { 'content-length':'12' };
  const staged = await stageUploadRequest(request, encodeURIComponent('part one.gcode'), { maxBytes:1024 });
  assert.equal(staged.fileName, 'part one.gcode');
  assert.equal(await fs.readFile(staged.filePath, 'utf8'), 'G28\nM104 S0\n');
  await staged.cleanup();
  await assert.rejects(fs.access(staged.filePath));
});

test('upload filename validation rejects paths and unsupported formats', () => {
  assert.equal(validateUploadFilename('part.gcode'), 'part.gcode');
  assert.equal(validateUploadFilename('model%203mf.3mf'), 'model 3mf.3mf');
  assert.equal(validateUploadFilename('u1-part.gco'), 'u1-part.gco');
  assert.equal(validateUploadFilename('u1-part.g'), 'u1-part.g');
  assert.throws(() => validateUploadFilename('../part.gcode'), /must not contain a path/);
  assert.throws(() => validateUploadFilename('notes.txt'), /\.gcode, \.gx, \.3mf, \.gco, or \.g/);
});
