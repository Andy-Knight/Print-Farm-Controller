export class PrinterBusyError extends Error {
  constructor(printerId, activeOperation, message = null) {
    const operation = activeOperation?.label || 'another operation';
    super(message || `Printer busy — ${operation} in progress`);
    this.name = 'PrinterBusyError';
    this.code = 'PRINTER_BUSY';
    this.statusCode = 409;
    this.printerId = String(printerId || '');
    this.activeOperation = operation;
    this.startedAt = activeOperation?.startedAt || null;
  }
}

export class PrinterOperationCoordinator {
  constructor({ nowFn = () => Date.now(), evaluateFn = null, contextProvider = null } = {}) {
    this.now = nowFn;
    this.active = new Map();
    this.evaluateFn = typeof evaluateFn === 'function' ? evaluateFn : null;
    this.contextProvider = typeof contextProvider === 'function' ? contextProvider : null;
  }

  current(printerId) {
    const item = this.active.get(String(printerId || ''));
    return item ? { ...item } : null;
  }

  isBusy(printerId) {
    return this.active.has(String(printerId || ''));
  }

  evaluate(printerId, operationType = null, { ignoreTransaction = false } = {}) {
    const id = String(printerId || '').trim();
    if (!id) return { allowed:false, code:'printer_id_required', message:'printerId is required', activity:null };

    const active = this.active.get(id);
    if (active && !ignoreTransaction) {
      return {
        allowed:false,
        code:'transaction_busy',
        message:`Printer busy — ${active.label || 'another operation'} in progress`,
        activity:{ kind:'transaction', label:active.label || 'another operation', source:'controller' }
      };
    }

    if (!this.evaluateFn || !operationType) return { allowed:true, code:null, message:null, activity:null };
    const context = this.contextProvider ? (this.contextProvider(id) || {}) : {};
    return this.evaluateFn(operationType, context);
  }

  async run(printerId, label, task, { operationType = null } = {}) {
    const id = String(printerId || '').trim();
    if (!id) throw new Error('printerId is required');
    if (typeof task !== 'function') throw new Error('task is required');

    const active = this.active.get(id);
    if (active) throw new PrinterBusyError(id, active);

    const decision = this.evaluate(id, operationType, { ignoreTransaction:true });
    if (decision?.allowed === false) {
      throw new PrinterBusyError(id, decision.activity, decision.message || 'Printer operation is blocked by current printer activity');
    }

    const operation = {
      label:String(label || 'printer operation').trim() || 'printer operation',
      operationType:operationType || null,
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
