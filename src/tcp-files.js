import net from 'node:net';

const DEFAULT_TCP_PORT = 8899;
const CONNECT_TIMEOUT_MS = 4000;
const COMMAND_TIMEOUT_MS = 10000;
const M661_SETTLE_MS = 1400;

export class PrinterTcpError extends Error {
  constructor(message, { cause = null } = {}) {
    super(message, { cause });
    this.name = 'PrinterTcpError';
  }
}

function hasOkTerminator(value) {
  return /(?:^|\r?\n)ok(?:\r?\n|$)/i.test(value);
}

function printableFileName(value) {
  const candidate = String(value || '')
    .replace(/\0/g, '')
    .trim()
    .replace(/^\/data\//, '')
    .replace(/^0:\/user\//i, '')
    .replace(/^\/data\/user\//i, '')
    .trim();

  if (!candidate) return null;
  if (!/\.(?:gcode|gx|g|3mf)$/i.test(candidate)) return null;
  return candidate;
}

/**
 * Parse the full-file response returned by FlashForge's TCP M661 command.
 *
 * Modern 5M firmware commonly returns a delimiter-based payload containing
 * /data/... paths. Older/legacy implementations can return an info_list.size
 * header followed by one file per line, so both forms are accepted.
 */
export function parseM661FileList(response) {
  const files = [];
  const seen = new Set();
  const add = (value) => {
    const file = printableFileName(value);
    if (!file || seen.has(file)) return;
    seen.add(file);
    files.push(file);
  };

  const text = String(response || '');

  // AD5M/AD5M Pro: entries are commonly separated with "::" and carry
  // absolute /data/ paths. Keep the extraction deliberately permissive so
  // filenames with spaces and Unicode survive intact.
  for (const segment of text.split('::')) {
    const dataIndex = segment.indexOf('/data/');
    if (dataIndex === -1) continue;
    const tail = segment.slice(dataIndex);
    const firstLine = tail.split(/[\r\n\0]/, 1)[0];
    add(firstLine);
  }

  // Legacy/documented form: an info_list.size line followed by plain names.
  // Also makes the parser resilient to firmware variants that omit /data/.
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.includes('::') || /^ok$/i.test(line) || /^CMD\s+M661\s+Received\.?$/i.test(line)) continue;
    if (/^info_list\.size\s*:/i.test(line)) continue;
    add(line);
  }

  return files;
}

function connectSocket(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new PrinterTcpError(`Timed out connecting to ${host}:${port}`));
    }, timeoutMs);

    const cleanup = () => clearTimeout(timer);
    socket.once('connect', () => {
      cleanup();
      resolve(socket);
    });
    socket.once('error', (error) => {
      cleanup();
      reject(new PrinterTcpError(`Could not connect to ${host}:${port}: ${error.message}`, { cause: error }));
    });
  });
}

function sendCommand(socket, command, {
  timeoutMs = COMMAND_TIMEOUT_MS,
  settleMs = 0,
  requireOk = true
} = {}) {
  return new Promise((resolve, reject) => {
    let response = '';
    let settledTimer = null;
    let completed = false;

    const finish = (error = null) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutTimer);
      if (settledTimer) clearTimeout(settledTimer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      if (error) reject(error);
      else resolve(response);
    };

    const scheduleSettle = () => {
      if (!settleMs) return;
      if (settledTimer) clearTimeout(settledTimer);
      settledTimer = setTimeout(() => finish(), settleMs);
    };

    const onData = (buffer) => {
      response += buffer.toString('utf8');
      if (settleMs) {
        // M661 is frequently two-stage: an immediate acknowledgement followed
        // by the file payload. Complete only after the stream has gone quiet.
        scheduleSettle();
      } else if (!requireOk || hasOkTerminator(response)) {
        finish();
      }
    };

    const onError = (error) => finish(new PrinterTcpError(`TCP command ${command} failed: ${error.message}`, { cause: error }));
    const onClose = () => {
      if (!completed) finish(new PrinterTcpError(`Printer closed the TCP connection during ${command}`));
    };

    const timeoutTimer = setTimeout(() => {
      if (settleMs && response) {
        // A useful response that lacked a conventional terminator is still
        // preferable to losing the entire file list on a firmware quirk.
        finish();
        return;
      }
      finish(new PrinterTcpError(`Timed out waiting for ${command}`));
    }, timeoutMs);

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.write(`${command}\n`, 'ascii', (error) => {
      if (error) finish(new PrinterTcpError(`Could not send ${command}: ${error.message}`, { cause: error }));
    });
  });
}

/**
 * Retrieve the complete printer-local file list through the 5M/Pro TCP API.
 * The socket is short-lived: acquire control, issue M661, release control.
 */
export async function listAllFilesTcp(printer, options = {}) {
  const host = printer.host;
  const port = Number(printer.tcpPort || printer.commandPort || DEFAULT_TCP_PORT);
  const connectTimeoutMs = Number(options.connectTimeoutMs || CONNECT_TIMEOUT_MS);
  const commandTimeoutMs = Number(options.commandTimeoutMs || COMMAND_TIMEOUT_MS);
  const settleMs = Number(options.settleMs || M661_SETTLE_MS);

  const socket = await connectSocket(host, port, connectTimeoutMs);
  try {
    const login = await sendCommand(socket, '~M601 S1', { timeoutMs: commandTimeoutMs });
    if (/Control Failed|Error:\s*have been connected/i.test(login)) {
      throw new PrinterTcpError('Printer TCP control is busy. Another local client may currently hold the control session.');
    }
    if (!/Control Success/i.test(login) && !hasOkTerminator(login)) {
      throw new PrinterTcpError('Printer did not accept the TCP control session.');
    }

    const raw = await sendCommand(socket, '~M661', {
      timeoutMs: commandTimeoutMs,
      settleMs,
      requireOk: false
    });
    return parseM661FileList(raw);
  } finally {
    if (!socket.destroyed) {
      try {
        // Best-effort release. Do not let a failed logout turn a successful
        // file listing into an error for the user.
        await sendCommand(socket, '~M602', { timeoutMs: 1200 }).catch(() => {});
      } finally {
        socket.end();
        setTimeout(() => {
          if (!socket.destroyed) socket.destroy();
        }, 100).unref?.();
      }
    }
  }
}
