export class PrinterBusyError extends Error {
  constructor(printerId, activeOperation) {
    const operation = activeOperation?.label || 'another operation';
    super(`Printer busy — ${operation} in progress`);
    this.name = 'PrinterBusyError';
    this.code = 'PRINTER_BUSY';
    this.statusCode = 409;
    this.printerId = String(printerId || '');
    this.activeOperation = operation;
    this.startedAt = activeOperation?.startedAt || null;
  }
}

export class PrinterOperationCoordinator {
  constructor({ nowFn = () => Date.now() } = {}) {
    this.now = nowFn;
    this.active = new Map();
  }

  current(printerId) {
    const item = this.active.get(String(printerId || ''));
    return item ? { ...item } : null;
  }

  isBusy(printerId) {
    return this.active.has(String(printerId || ''));
  }

  async run(printerId, label, task) {
    const id = String(printerId || '').trim();
    if (!id) throw new Error('printerId is required');
    if (typeof task !== 'function') throw new Error('task is required');

    const active = this.active.get(id);
    if (active) throw new PrinterBusyError(id, active);

    const operation = {
      label:String(label || 'printer operation').trim() || 'printer operation',
      startedAt:new Date(this.now()).toISOString()
    };
    this.active.set(id, operation);
    try {
      return await task();
    } finally {
      if (this.active.get(id) === operation) this.active.delete(id);
    }
  }
}

export class KeyedSerialExecutor {
  constructor() {
    this.tails = new Map();
  }

  async run(key, task) {
    const normalized = String(key || 'default');
    if (typeof task !== 'function') throw new Error('task is required');

    const previous = this.tails.get(normalized) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.tails.set(normalized, tail);

    await previous.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(normalized) === tail) this.tails.delete(normalized);
    }
  }

  pendingKeys() {
    return this.tails.size;
  }
}
