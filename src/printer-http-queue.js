const queues = new Map();

function printerKey(printer) {
  return String(printer?.id || `${printer?.host || 'unknown'}:${printer?.httpPort || 8898}`);
}

/**
 * FlashForge's local HTTP service is much more reliable when requests for one
 * printer are serialized. Long-running operations such as /uploadGcode share
 * this queue with status/control POSTs so a fleet poll cannot interleave with
 * a file transfer on the same printer.
 */
export async function runPrinterHttpExclusive(printer, task) {
  const key = printerKey(printer);
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  queues.set(key, tail);

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}

export function queuedPrinterCount() {
  return queues.size;
}
