import {withOperationBudget,abortError,currentOperation} from '../security/operation-budget.js';
export class BackupOperationLock {
  constructor({timeoutMs}={}) {
    this.timeoutMs=timeoutMs;
    this.controller=null;
    this.currentOperation = null;
  }

  status() {
    return this.currentOperation ? { ...this.currentOperation } : null;
  }

  isBusy() {
    return Boolean(this.currentOperation);
  }

  cancel(){
    if(!this.controller)return false;
    this.currentOperation.cancelRequested=true;
    this.controller.abort(abortError('Backup operation cancelled by administrator'));
    return true;
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
    this.controller=currentOperation()?.controller||new AbortController();
    try {
      return await withOperationBudget(callback,{timeoutMs:this.timeoutMs,controller:this.controller});
    } finally {
      this.currentOperation = null;this.controller=null;
    }
  }
}
