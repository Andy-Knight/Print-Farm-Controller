import fs from 'node:fs/promises';
import { printerIsPrinting } from '../public/printer-map-status.js';
import {
  dashboardPrinterNeedsAttention, FLEET_HISTORY_INTERVAL, FLEET_HISTORY_METRICS, FLEET_HISTORY_WINDOW
} from '../public/dashboard-fleet-history.js';

export class FleetHistory {
  constructor({filePath, getPrinters, getBedClearance, now = Date.now, warn = console.warn}) {
    Object.assign(this, {filePath, getPrinters, getBedClearance, now, warn});
    this.samples = [];
    this.timer = null;
    this.pending = null;
  }

  window(samples, endAt = this.now()) {
    return samples.filter(({at}) => at > endAt - FLEET_HISTORY_WINDOW && at <= endAt);
  }

  async start() {
    try {
      const stored = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (stored.version !== 1 || !Array.isArray(stored.samples)) throw new Error('Invalid history format');
      const valid = stored.samples.filter(sample => Number.isSafeInteger(sample?.at)
        && sample.at % FLEET_HISTORY_INTERVAL === 0
        && sample.printers && typeof sample.printers === 'object' && !Array.isArray(sample.printers));
      this.samples = this.window([...new Map(valid.map(sample => [sample.at, sample])).values()])
        .sort((a, b) => a.at - b.at);
    } catch (error) {
      if (error.code !== 'ENOENT') this.warn('Could not read Dashboard fleet history: ' + error.message);
    }
    const tick = () => {
      this.record().catch(error => this.warn('Could not save Dashboard fleet history: ' + error.message));
      const delay = FLEET_HISTORY_INTERVAL - this.now() % FLEET_HISTORY_INTERVAL;
      this.timer = setTimeout(tick, delay);
      this.timer.unref();
    };
    tick();
  }

  async stop() {
    clearTimeout(this.timer);
    await this.pending?.catch(() => {});
  }

  async record() {
    if (this.pending) return;
    const at = Math.floor(this.now() / FLEET_HISTORY_INTERVAL) * FLEET_HISTORY_INTERVAL;
    if (this.samples.at(-1)?.at >= at) return;
    const printers = this.getPrinters();
    // Wait for the first completed poll. The initial placeholder looks offline.
    if (printers.some(printer => !printer.lastSeen && !printer.consecutiveFailures)) return;
    const clearance = new Set(this.getBedClearance().map(item => item.printerId));
    const sample = {at, printers:Object.fromEntries(printers.map(printer => [
      printer.id,
      Number(Boolean(printer.online)) | (Number(printerIsPrinting(printer)) << 1)
        | (Number(dashboardPrinterNeedsAttention(printer, clearance.has(printer.id))) << 2)
    ]))};
    this.samples = [...this.window(this.samples, at), sample];
    const temporary = this.filePath + '.tmp';
    this.pending = fs.writeFile(temporary, JSON.stringify({version:1,samples:this.samples}))
      .then(() => fs.rename(temporary, this.filePath));
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
  }

  getHistory(printerIds = null) {
    const endAt = this.now();
    const selected = printerIds === null ? null : new Set(printerIds);
    const samples = this.window(this.samples, endAt).map(sample => {
      const counts = {at:sample.at, all:0, online:0, printing:0, attention:0};
      for (const [printerId, flags] of Object.entries(sample.printers)) {
        if (selected && !selected.has(printerId)) continue;
        counts.all++;
        FLEET_HISTORY_METRICS.forEach((key, bit) => { counts[key] += (flags >> bit) & 1; });
      }
      return counts;
    });
    return {endAt, samples};
  }
}
