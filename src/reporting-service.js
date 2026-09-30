import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { printerStorePath } from './store.js';
import { KeyedSerialExecutor } from './concurrency.js';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_PATH = path.join(path.dirname(printerStorePath), 'reporting-history.json');

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  return value == null ? null : structuredClone(value);
}

function terminalStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return TERMINAL_STATES.has(status) ? status : null;
}

function validDate(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : null;
}

function compactRecord(job) {
  const status = terminalStatus(job?.status);
  const id = String(job?.id || '').trim();
  if (!status || !id) return null;
  return {
    id,
    productionBatchId:job.productionBatchId || null,
    printerId:job.printerId || null,
    printerName:job.printerName || null,
    fileName:String(job.fileName || '').trim() || 'Unknown file',
    libraryFileId:job.stagedFile?.id || null,
    status,
    queuedAt:job.queuedAt || null,
    startedAt:job.startedAt || job.startRequestedAt || null,
    finishedAt:job.finishedAt || job.updatedAt || null,
    error:job.error || null,
    materialCost:job.materialCost ? clone(job.materialCost) : null
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;
}

function clippedDurationSeconds(record, fromMs, toMs) {
  const start = validDate(record.startedAt);
  const finish = validDate(record.finishedAt);
  if (start == null || finish == null || finish <= start) return 0;
  const clippedStart = Math.max(start, fromMs);
  const clippedFinish = Math.min(finish, toMs);
  return Math.max(0, Math.round((clippedFinish - clippedStart) / 1000));
}

function blankCounts() {
  return { attempts:0, completed:0, failed:0, cancelled:0 };
}

function applyStatus(counts, status) {
  counts.attempts += 1;
  if (status === 'completed') counts.completed += 1;
  else if (status === 'failed') counts.failed += 1;
  else if (status === 'cancelled') counts.cancelled += 1;
}

function decorateCounts(counts) {
  return {
    ...counts,
    completionRate:ratio(counts.completed, counts.attempts),
    failureRate:ratio(counts.failed, counts.attempts),
    cancellationRate:ratio(counts.cancelled, counts.attempts)
  };
}

function currencyTotalsAdd(target, currency, value) {
  if (!currency || !Number.isFinite(Number(value))) return;
  target[currency] = Math.round((((target[currency] || 0) + Number(value)) + Number.EPSILON) * 10000) / 10000;
}

function reportRange({ from, to } = {}) {
  const toMs = to ? validDate(to) : Date.now();
  const fromMs = from ? validDate(from) : (toMs == null ? null : toMs - (30 * 24 * 60 * 60 * 1000));
  if (fromMs == null || toMs == null) throw new Error('Reporting date range is invalid');
  if (fromMs > toMs) throw new Error('Reporting start date must not be after the end date');
  return {
    fromMs,
    toMs,
    from:new Date(fromMs).toISOString(),
    to:new Date(toMs).toISOString()
  };
}

export class ReportingService {
  constructor({ filePath = DEFAULT_PATH } = {}) {
    this.filePath = path.resolve(filePath);
    this.mutations = new KeyedSerialExecutor();
    this.initialization = null;
  }

  async init() {
    if (!this.initialization) {
      this.initialization = (async () => {
        await fs.mkdir(path.dirname(this.filePath), { recursive:true, mode:0o700 });
        try {
          await fs.writeFile(this.filePath, JSON.stringify({ version:1, records:[] }, null, 2) + '\n', { mode:0o600, flag:'wx' });
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
        await this.load();
      })().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  async load() {
    const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    if (!plainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      throw new Error('Reporting history store is invalid');
    }
    return {
      version:1,
      records:parsed.records.map((record) => compactRecord(record)).filter(Boolean)
    };
  }

  async save(store) {
    const temp = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(store, null, 2) + '\n', { mode:0o600 });
      await fs.rename(temp, this.filePath);
    } finally {
      await fs.rm(temp, { force:true }).catch(() => {});
    }
  }

  async recordTerminalJobs(jobs = []) {
    await this.init();
    return this.mutations.run('history', async () => {
      const store = await this.load();
      const byId = new Map(store.records.map((record) => [record.id, record]));
      let changed = false;
      let changedRecords = 0;
      for (const job of Array.isArray(jobs) ? jobs : []) {
        const record = compactRecord(job);
        if (!record) continue;
        const previous = byId.get(record.id);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(record)) {
          byId.set(record.id, record);
          changed = true;
          changedRecords += 1;
        }
      }
      if (!changed) return { recorded:0, total:store.records.length };
      store.records = [...byId.values()].sort((left, right) =>
        (validDate(left.finishedAt) || 0) - (validDate(right.finishedAt) || 0)
        || left.id.localeCompare(right.id)
      );
      await this.save(store);
      return { recorded:changedRecords, total:store.records.length };
    });
  }

  async getRecords() {
    await this.init();
    return clone((await this.load()).records);
  }

  async getReport({ from = null, to = null, printerIds = null } = {}) {
    const range = reportRange({ from, to });
    const allowedPrinters = printerIds == null
      ? null
      : new Set((Array.isArray(printerIds) ? printerIds : [printerIds]).map((value) => String(value || '').trim()).filter(Boolean));
    const records = (await this.getRecords()).filter((record) => {
      const finished = validDate(record.finishedAt);
      if (finished == null || finished < range.fromMs || finished > range.toMs) return false;
      return !allowedPrinters || allowedPrinters.has(String(record.printerId || ''));
    });

    const totals = blankCounts();
    let runSeconds = 0;
    let materialGrams = 0;
    let costedPrints = 0;
    let uncostedPrints = 0;
    const spendByCurrency = {};
    const printers = new Map();
    const files = new Map();
    const materials = new Map();
    const daily = new Map();

    for (const record of records) {
      applyStatus(totals, record.status);
      const duration = clippedDurationSeconds(record, range.fromMs, range.toMs);
      runSeconds += duration;

      const printerKey = String(record.printerId || record.printerName || 'unknown');
      if (!printers.has(printerKey)) {
        printers.set(printerKey, {
          printerId:record.printerId || null,
          printerName:record.printerName || 'Unknown printer',
          ...blankCounts(),
          runSeconds:0,
          materialGrams:0,
          spendByCurrency:{},
          lastFinishedAt:null
        });
      }
      const printer = printers.get(printerKey);
      applyStatus(printer, record.status);
      printer.runSeconds += duration;
      if (!printer.lastFinishedAt || String(record.finishedAt) > printer.lastFinishedAt) printer.lastFinishedAt = record.finishedAt;

      const fileKey = record.libraryFileId ? `library:${record.libraryFileId}` : `name:${record.fileName.toLowerCase()}`;
      if (!files.has(fileKey)) {
        files.set(fileKey, {
          libraryFileId:record.libraryFileId || null,
          fileName:record.fileName,
          ...blankCounts(),
          lastFinishedAt:null,
          materialGrams:0,
          spendByCurrency:{}
        });
      }
      const file = files.get(fileKey);
      applyStatus(file, record.status);
      if (!file.lastFinishedAt || String(record.finishedAt) > file.lastFinishedAt) file.lastFinishedAt = record.finishedAt;

      const day = String(record.finishedAt || '').slice(0, 10) || 'unknown';
      if (!daily.has(day)) {
        daily.set(day, {
          date:day,
          ...blankCounts(),
          runSeconds:0,
          materialGrams:0,
          spendByCurrency:{}
        });
      }
      const dailyRow = daily.get(day);
      applyStatus(dailyRow, record.status);
      dailyRow.runSeconds += duration;

      if (record.status !== 'completed') continue;
      const snapshot = record.materialCost;
      if (!snapshot) {
        uncostedPrints += 1;
        continue;
      }
      if (snapshot.complete === true) costedPrints += 1;
      else uncostedPrints += 1;

      const totalGrams = Number(snapshot.totalGrams);
      if (Number.isFinite(totalGrams) && totalGrams >= 0) {
        materialGrams += totalGrams;
        printer.materialGrams += totalGrams;
        file.materialGrams += totalGrams;
        dailyRow.materialGrams += totalGrams;
      }
      if (snapshot.complete === true && snapshot.currency && Number.isFinite(Number(snapshot.totalCost))) {
        currencyTotalsAdd(spendByCurrency, snapshot.currency, snapshot.totalCost);
        currencyTotalsAdd(printer.spendByCurrency, snapshot.currency, snapshot.totalCost);
        currencyTotalsAdd(file.spendByCurrency, snapshot.currency, snapshot.totalCost);
        currencyTotalsAdd(dailyRow.spendByCurrency, snapshot.currency, snapshot.totalCost);
      }

      for (const tool of Array.isArray(snapshot.tools) ? snapshot.tools : []) {
        const grams = Number(tool?.grams);
        if (!Number.isFinite(grams) || grams < 0) continue;
        const key = tool.filamentId || `material:${String(tool.material || 'Unknown').toUpperCase()}`;
        if (!materials.has(key)) {
          materials.set(key, {
            filamentId:tool.filamentId || null,
            label:tool.filamentLabel || tool.material || 'Unknown material',
            material:tool.material || null,
            grams:0,
            spendByCurrency:{},
            completedPrintIds:new Set()
          });
        }
        const material = materials.get(key);
        material.grams += grams;
        material.completedPrintIds.add(record.id);
        if (tool.currency && Number.isFinite(Number(tool.cost))) {
          currencyTotalsAdd(material.spendByCurrency, tool.currency, tool.cost);
        }
      }
    }

    const printerRows = [...printers.values()].map((printer) => {
      const decorated = decorateCounts(printer);
      const attentionReasons = [];
      if (printer.failed >= 2) attentionReasons.push(`${printer.failed} failed prints in this period`);
      if (printer.attempts >= 5 && decorated.failureRate != null && decorated.failureRate >= 0.2) {
        attentionReasons.push(`${Math.round(decorated.failureRate * 100)}% failure rate across ${printer.attempts} attempts`);
      }
      return {
        ...decorated,
        runHours:Math.round((printer.runSeconds / 3600) * 100) / 100,
        materialGrams:Math.round(printer.materialGrams * 1000) / 1000,
        attentionReasons
      };
    }).sort((left, right) =>
      right.failed - left.failed
      || (right.failureRate || 0) - (left.failureRate || 0)
      || right.attempts - left.attempts
      || left.printerName.localeCompare(right.printerName)
    );

    const fileRows = [...files.values()].map((file) => ({
      ...decorateCounts(file),
      materialGrams:Math.round(file.materialGrams * 1000) / 1000
    })).sort((left, right) =>
      right.completed - left.completed
      || right.attempts - left.attempts
      || left.fileName.localeCompare(right.fileName)
    );

    const materialRows = [...materials.values()].map((material) => ({
      filamentId:material.filamentId,
      label:material.label,
      material:material.material,
      grams:Math.round(material.grams * 1000) / 1000,
      completedPrints:material.completedPrintIds.size,
      spendByCurrency:material.spendByCurrency
    })).sort((left, right) => right.grams - left.grams || left.label.localeCompare(right.label));

    const dailyRows = [...daily.values()].map((row) => ({
      ...decorateCounts(row),
      runHours:Math.round((row.runSeconds / 3600) * 100) / 100,
      materialGrams:Math.round(row.materialGrams * 1000) / 1000
    })).sort((left, right) => left.date.localeCompare(right.date));

    return {
      range:{ from:range.from, to:range.to },
      filters:{ printerIds:allowedPrinters ? [...allowedPrinters] : null },
      totals:{
        ...decorateCounts(totals),
        runHours:Math.round((runSeconds / 3600) * 100) / 100,
        materialGrams:Math.round(materialGrams * 1000) / 1000,
        costedPrints,
        uncostedPrints,
        spendByCurrency
      },
      printers:printerRows,
      files:fileRows,
      materials:materialRows,
      daily:dailyRows
    };
  }
}

export const reportingHistoryPath = DEFAULT_PATH;
