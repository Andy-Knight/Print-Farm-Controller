import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadGcodeFile, usesModernUploadHeaders } from '../src/upload-gcode.js';

async function withTempFile(name, content, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-upload-test-'));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  try { return await callback(filePath); }
  finally { await fs.rm(dir, { recursive:true, force:true }); }
}

test('uploadGcodeFile sends modern 5M multipart headers and file bytes to /uploadGcode', async () => {
  let captured = null;
  const server = http.createServer();
  const handle = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    captured = { url:req.url, headers:req.headers, body:Buffer.concat(chunks) };
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ code:0, message:'success' }));
  };
  server.on('checkContinue', (req, res) => { res.writeContinue(); handle(req, res); });
  server.on('request', handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await withTempFile('fleet-test.gcode', 'G28\nG1 X10 Y10\n', async (filePath) => {
      await uploadGcodeFile({
        id:'p1', host:'127.0.0.1', httpPort:port,
        serialNumber:'SERIAL123', checkCode:'CHECK123'
      }, filePath, { firmwareVersion:'5.1.4', levelingBeforePrint:true, expectWaitMs:50 });
    });

    assert.equal(captured.url, '/uploadGcode');
    assert.equal(captured.headers.serialnumber, 'SERIAL123');
    assert.equal(captured.headers.checkcode, 'CHECK123');
    assert.equal(captured.headers.printnow, 'false');
    assert.equal(captured.headers.levelingbeforeprint, 'true');
    assert.equal(captured.headers.flowcalibration, 'false');
    assert.equal(captured.headers.usematlstation, 'false');
    assert.equal(captured.headers.gcodetoolcnt, '0');
    assert.equal(captured.headers.materialmappings, 'W10=');
    const text = captured.body.toString('utf8');
    assert.match(text, /name="gcodeFile"; filename="fleet-test\.gcode"/);
    assert.match(text, /G28\nG1 X10 Y10/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Creator 5 upload uses material-station tool count without legacy materialMappings header', async () => {
  let captured = null;
  const server = http.createServer();
  const handle = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    captured = { url:req.url, headers:req.headers, body:Buffer.concat(chunks) };
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ code:0, message:'success' }));
  };
  server.on('checkContinue', (req, res) => { res.writeContinue(); handle(req, res); });
  server.on('request', handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await withTempFile('creator-multi.gcode', '; multi tool\nT0\nT1\nT2\n', async (filePath) => {
      await uploadGcodeFile({
        id:'c5', host:'127.0.0.1', httpPort:port,
        serialNumber:'CREATOR5SN', checkCode:'CREATOR5CODE'
      }, filePath, {
        creator5:true,
        toolCount:3,
        levelingBeforePrint:false,
        flowCalibrationBeforePrint:true,
        timeLapseBeforePrint:true,
        expectWaitMs:50
      });
    });

    assert.equal(captured.url, '/uploadGcode');
    assert.equal(captured.headers.serialnumber, 'CREATOR5SN');
    assert.equal(captured.headers.checkcode, 'CREATOR5CODE');
    assert.equal(captured.headers.printnow, 'false');
    assert.equal(captured.headers.levelingbeforeprint, 'false');
    assert.equal(captured.headers.flowcalibration, 'true');
    assert.equal(captured.headers.timelapsevideo, 'true');
    assert.equal(captured.headers.usematlstation, 'true');
    assert.equal(captured.headers.gcodetoolcnt, '3');
    assert.equal(captured.headers.materialmappings, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('upload header version selection keeps pre-3.1.3 compatibility', () => {
  assert.equal(usesModernUploadHeaders('3.1.2'), false);
  assert.equal(usesModernUploadHeaders('3.1.3'), true);
  assert.equal(usesModernUploadHeaders('5.1.4'), true);
  assert.equal(usesModernUploadHeaders(undefined), true);
});
