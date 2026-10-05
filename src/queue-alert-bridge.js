function printerRef(printerId, printerName, lookup) {
  if (!printerId) return null;
  const live = lookup(printerId) || {};
  return {
    id:String(printerId),
    name:printerName || live.name || null,
    adapterType:live.adapterType || null,
    model:live.model || null
  };
}

export class QueueAlertBridge {
  constructor({
    alertService,
    printerLookupFn = null,
    onAlert = null,
    diagnosticFn = null
  } = {}) {
    if (!alertService) throw new Error('alertService is required');
    this.alertService = alertService;
    this.printerLookup = typeof printerLookupFn === 'function' ? printerLookupFn : () => null;
    this.onAlert = typeof onAlert === 'function' ? onAlert : () => {};
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : () => {};
    this.previousJobs = new Map();
    this.previousClearanceKeys = new Set();
    this.initialized = false;
    this.chain = Promise.resolve();
  }

  clearanceKey(item = {}) {
    return [
      String(item.printerId || ''),
      String(item.jobId || ''),
      String(item.finishedAt || ''),
      String(item.fileName || '')
    ].join('|');
  }

  async emit(input) {
    try {
      const result = await this.alertService.emit(input);
      if (!result?.duplicate) this.onAlert(result.alert);
      return result;
    } catch (error) {
      await Promise.resolve(this.diagnostic('warn', 'Queue event could not be converted to an alert', {
        type:input?.type || null,
        jobId:input?.source?.id || null,
        printerId:input?.printer?.id || null,
        error:error?.message || String(error)
      })).catch(() => {});
      return null;
    }
  }

  async observe(snapshot = {}) {
    const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
    const clearance = Array.isArray(snapshot.bedClearance) ? snapshot.bedClearance : [];
    const currentJobs = new Map(jobs.filter((job) => job?.id).map((job) => [String(job.id), job]));
    const clearanceKeys = new Set(clearance.map((item) => this.clearanceKey(item)));

    if (!this.initialized) {
      this.previousJobs = new Map([...currentJobs].map(([id, job]) => [id, String(job.status || '')]));
      this.previousClearanceKeys = clearanceKeys;
      this.initialized = true;
      return;
    }

    for (const [id, job] of currentJobs) {
      const status = String(job.status || '');
      const previousStatus = this.previousJobs.get(id) || null;
      if (status === 'needs_review' && previousStatus !== 'needs_review') {
        const printer = printerRef(job.printerId, job.printerName, this.printerLookup);
        const fileName = String(job.fileName || 'Queued print');
        await this.emit({
          id:`queue-review:${id}:${job.updatedAt || status}`,
          type:'queue.needs_review',
          severity:'warning',
          title:'Queue job needs review',
          message:`${fileName} needs operator review${job.error ? `: ${job.error}` : '.'}`,
          source:{ kind:'queue', id, name:fileName },
          printer,
          metadata:{
            jobId:id,
            assignmentMode:job.assignmentMode || null,
            groupId:job.groupId || null,
            error:job.error || null
          }
        });
      }
    }

    for (const item of clearance) {
      const key = this.clearanceKey(item);
      if (this.previousClearanceKeys.has(key)) continue;
      const printer = printerRef(item.printerId, item.printerName, this.printerLookup);
      const name = item.printerName || printer?.name || 'Printer';
      await this.emit({
        id:`bed-clearance:${key}`,
        type:'queue.bed_clearance',
        severity:'warning',
        title:'Bed clearance required',
        message:`${name} requires the print bed to be cleared before queued work can continue.`,
        source:{ kind:'queue', id:item.jobId ? String(item.jobId) : null, name:item.fileName || 'Completed print' },
        printer,
        metadata:{
          jobId:item.jobId || null,
          jobStatus:item.jobStatus || null,
          finishedAt:item.finishedAt || null
        }
      });
    }

    this.previousJobs = new Map([...currentJobs].map(([id, job]) => [id, String(job.status || '')]));
    this.previousClearanceKeys = clearanceKeys;
  }

  schedule(snapshot = {}) {
    this.chain = this.chain
      .catch(() => {})
      .then(() => this.observe(snapshot));
    return this.chain;
  }

  async stop() {
    await this.chain.catch(() => {});
  }
}
