export function printerArtworkKey(printer) {
  const adapterType = String(printer?.adapterType || '').trim().toLowerCase();
  const model = String(printer?.model || '').trim().toLowerCase();

  if (adapterType === 'snapmaker-u1') return 'snapmaker-u1';
  if (adapterType === 'prusa-core-one-plus') return 'prusa-core-one-plus';
  if (adapterType === 'flashforge-ad5m') return 'ad5m-pro';
  if (adapterType === 'flashforge-creator5') return model.includes('pro') ? 'creator-5-pro' : 'creator-5';
  if (adapterType === 'bambu-lab') {
    if (['p1p', 'p1s', 'a1'].includes(model)) return model;
    if (model === 'x1c' || model.includes('x1 carbon')) return 'x1c';
    if (model === 'a1 mini' || model === 'a1-mini') return 'a1-mini';
  }
  return null;
}

export function printerIsPrinting(printer) {
  const state = String(printer?.status?.status || '').toLowerCase();
  if (state === 'heating' && printer?.chamberPreheat?.active && !printer?.status?.fileName) return false;
  return ['printing', 'working', 'heating', 'building_from_sd'].includes(state);
}

export function printerMapTiles(printers, queue, attentionPrinterIds) {
  const queued = new Map();
  const completions = new Map();
  const recordCompletion = (printerId, status, finishedAt) => {
    if (!printerId || status !== 'completed') return;
    const time = Date.parse(finishedAt);
    if (time > (completions.get(printerId) || 0)) {
      completions.set(printerId, time);
    }
  };
  for (const job of queue.jobs || []) {
    if (job.status === 'queued' && job.printerId) {
      queued.set(job.printerId, (queued.get(job.printerId) || 0) + 1);
    }
    recordCompletion(job.printerId, job.status, job.finishedAt);
  }
  const attention = new Set(attentionPrinterIds);
  for (const item of queue.bedClearance || []) {
    attention.add(item.printerId);
    recordCompletion(item.printerId, item.jobStatus, item.finishedAt);
  }
  return printers.map(printer => ({
    id:printer.id,
    name:printer.name,
    imageKey:printerArtworkKey(printer),
    printing:Boolean(printer.online && printerIsPrinting(printer)),
    alert:attention.has(printer.id) || !printer.online
      || ['error', 'pause', 'paused'].includes(String(printer.status?.status || '').toLowerCase())
      || ['due', 'due_soon'].includes(String(printer.maintenance?.state || '').toLowerCase()),
    queued:queued.get(printer.id) || 0,
    completedAt:completions.get(printer.id) || null
  }));
}
