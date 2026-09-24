export class BackupOperationLock {
  constructor() {
    this.currentOperation = null;
  }

  status() {
    return this.currentOperation ? { ...this.currentOperation } : null;
  }

  isBusy() {
    return Boolean(this.currentOperation);
  }

  async run(kind, callback) {
    if (this.currentOperation) {
      const error = new Error(`A ${this.currentOperation.kind} backup operation is already in progress`);
      error.statusCode = 409;
      throw error;
    }
    this.currentOperation = {
      kind:String(kind || 'backup'),
      startedAt:new Date().toISOString()
    };
    try {
      return await callback();
    } finally {
      this.currentOperation = null;
    }
  }
}
