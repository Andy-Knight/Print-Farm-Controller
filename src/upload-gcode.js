import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runPrinterHttpExclusive } from './printer-http-queue.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_EXPECT_WAIT_MS = 1000;
const MAX_RESPONSE_BYTES = 1_000_000;

export class PrinterUploadError extends Error {
  constructor(message, { cause = null, code = null } = {}) {
    super(message, { cause });
    this.name = 'PrinterUploadError';
    this.code = code;
  }
}

function firmwareParts(version) {
  return (String(version || '').match(/\d+/g) || []).slice(0, 3).map(Number);
}

/** New 5M upload headers were introduced in firmware 3.1.3. */
export function usesModernUploadHeaders(version) {
  const parts = firmwareParts(version);
  if (!parts.length) return true; // Current firmware defaults to the modern format.
  const current = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  const minimum = [3, 1, 3];
  for (let i = 0; i < 3; i++) {
    if (current[i] > minimum[i]) return true;
    if (current[i] < minimum[i]) return false;
  }
  return true;
}

function quoteMultipartFilename(fileName) {
  return String(fileName).replace(/["\r\n]/g, '_');
}

function parsePrinterResponse(statusCode, raw) {
  if (statusCode < 200 || statusCode >= 300) {
    throw new PrinterUploadError(`Printer returned HTTP ${statusCode} during upload`);
  }
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new PrinterUploadError('Printer returned an invalid upload response', { cause: error });
  }
  if (typeof data.code === 'number' && data.code !== 0) {
    if (data.code === -2 || /lan mode error/i.test(String(data.message || ''))) {
      throw new PrinterUploadError('Printer LAN API is disabled.', { code: data.code });
    }
    throw new PrinterUploadError(data.message || `Printer upload API error ${data.code}`, { code: data.code });
  }
  return data;
}

async function sendMultipartUpload(printer, filePath, {
  firmwareVersion,
  levelingBeforePrint = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  expectWaitMs = DEFAULT_EXPECT_WAIT_MS
} = {}) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new PrinterUploadError('Upload source is not a file');

  const fileName = path.basename(filePath);
  const boundary = `----FlashForgeFleet${crypto.randomUUID().replace(/-/g, '')}`;
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="gcodeFile"; filename="${quoteMultipartFilename(fileName)}"\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n',
    'utf8'
  );
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const headers = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': String(preamble.length + stats.size + ending.length),
    serialNumber: printer.serialNumber,
    checkCode: printer.checkCode,
    fileSize: String(stats.size),
    printNow: 'false',
    levelingBeforePrint: String(Boolean(levelingBeforePrint)).toLowerCase(),
    Expect: '100-continue'
  };

  if (usesModernUploadHeaders(firmwareVersion)) {
    headers.flowCalibration = 'false';
    headers.useMatlStation = 'false';
    headers.gcodeToolCnt = '0';
    headers.materialMappings = 'W10='; // base64 for []
  }

  return new Promise((resolve, reject) => {
    let bodyStarted = false;
    let finalResponseStarted = false;
    let completed = false;
    let expectTimer = null;
    let fileStream = null;

    const finish = (error, value) => {
      if (completed) return;
      completed = true;
      if (expectTimer) clearTimeout(expectTimer);
      if (fileStream && error) fileStream.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    const request = http.request({
      host: printer.host,
      port: Number(printer.httpPort || 8898),
      path: '/uploadGcode',
      method: 'POST',
      headers
    }, (response) => {
      finalResponseStarted = true;
      if (expectTimer) clearTimeout(expectTimer);
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new PrinterUploadError('Printer upload response was unexpectedly large'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', (error) => finish(new PrinterUploadError(`Upload response failed: ${error.message}`, { cause: error })));
      response.once('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          finish(null, parsePrinterResponse(response.statusCode || 0, raw));
        } catch (error) {
          finish(error);
        }
      });
    });

    const startBody = () => {
      if (bodyStarted || finalResponseStarted || completed) return;
      bodyStarted = true;
      if (expectTimer) clearTimeout(expectTimer);
      request.write(preamble);
      fileStream = createReadStream(filePath);
      fileStream.once('error', (error) => request.destroy(new PrinterUploadError(`Could not read upload file: ${error.message}`, { cause: error })));
      fileStream.once('end', () => request.end(ending));
      fileStream.pipe(request, { end: false });
    };

    request.setTimeout(timeoutMs, () => request.destroy(new PrinterUploadError(`Timed out uploading to ${printer.host}`)));
    request.once('continue', startBody);
    request.once('error', (error) => {
      finish(error instanceof PrinterUploadError ? error : new PrinterUploadError(`Could not upload to ${printer.host}: ${error.message}`, { cause: error }));
    });
    request.flushHeaders();
    expectTimer = setTimeout(startBody, expectWaitMs);
  });
}

/**
 * Uploads a file to an Adventurer 5M-family printer using /uploadGcode.
 * printNow is deliberately false; callers may verify storage then start the
 * printer separately with /printGcode.
 */
export async function uploadGcodeFile(printer, filePath, options = {}) {
  return runPrinterHttpExclusive(printer, () => sendMultipartUpload(printer, filePath, options));
}
