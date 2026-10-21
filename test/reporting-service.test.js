import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReportingService } from '../src/reporting-service.js';

function completedJob({
  id,
  printerId,
  printerName,
  fileName,
  libraryFileId = null,
  status = 'completed',
  startedAt,
  finishedAt,
  materialCost = null
}) {
  return {
    id,
    printerId,
    printerName,
    fileName,
    stagedFile:libraryFileId ? { id:libraryFileId } : null,
    status,
    startedAt,
    finishedAt,
    updatedAt:finishedAt,
    materialCost
  };
}

test('reporting history deduplicates terminal jobs and aggregates farm metrics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-reporting-'));
  const service = new ReportingService({ filePath:path.join(root, 'reporting-history.json') });
  try {
    await service.init();
    const jobs = [
      completedJob({
        id:'j1', printerId:'p1', printerName:'Printer 1', fileName:'clip.gcode',
        libraryFileId:'11111111-1111-4111-8111-111111111111',
        startedAt:'2026-09-29T10:00:00.000Z', finishedAt:'2026-09-29T11:00:00.000Z',
        materialCost:{
          complete:true, totalGrams:20, totalCost:0.4, currency:'GBP',
          tools:[{ index:0, material:'PLA', grams:20, filamentId:'f1', filamentLabel:'Brand · PLA', cost:0.4, currency:'GBP' }]
        }
      }),
      completedJob({
        id:'j2', printerId:'p1', printerName:'Printer 1', fileName:'clip.gcode',
        libraryFileId:'11111111-1111-4111-8111-111111111111',
        status:'failed',
        startedAt:'2026-09-29T12:00:00.000Z', finishedAt:'2026-09-29T12:30:00.000Z'
      }),
      completedJob({
        id:'j3', printerId:'p1', printerName:'Printer 1', fileName:'clip.gcode',
        libraryFileId:'11111111-1111-4111-8111-111111111111',
        status:'failed',
        startedAt:'2026-09-30T08:00:00.000Z', finishedAt:'2026-09-30T08:15:00.000Z'
      }),
      completedJob({
        id:'j4', printerId:'p2', printerName:'Printer 2', fileName:'hook.gcode',
        startedAt:'2026-09-30T09:00:00.000Z', finishedAt:'2026-09-30T10:30:00.000Z',
        materialCost:{
          complete:true, totalGrams:30, totalCost:0.75, currency:'GBP',
          tools:[{ index:0, material:'PETG', grams:30, filamentId:'f2', filamentLabel:'Brand · PETG', cost:0.75, currency:'GBP' }]
        }
      })
    ];

    const first = await service.recordTerminalJobs(jobs);
    assert.equal(first.recorded, 4);
    assert.equal(first.total, 4);
    const duplicate = await service.recordTerminalJobs(jobs);
    assert.equal(duplicate.recorded, 0);
    assert.equal((await service.getRecords())[0].libraryFileId, '11111111-1111-4111-8111-111111111111');

    const report = await service.getReport({
      from:'2026-09-29T00:00:00.000Z',
      to:'2026-09-30T23:59:59.999Z'
    });
    assert.equal(report.totals.attempts, 4);
    assert.equal(report.totals.completed, 2);
    assert.equal(report.totals.failed, 2);
    assert.equal(report.totals.runHours, 3.25);
    assert.equal(report.totals.materialGrams, 50);
    assert.deepEqual(report.totals.spendByCurrency, { GBP:1.15 });
    assert.equal(report.files[0].fileName, 'clip.gcode');
    assert.equal(report.files[0].attempts, 3);
    assert.equal(report.printers[0].printerId, 'p1');
    assert.equal(report.printers[0].failed, 2);
    assert.equal(report.printers[0].lastFailedAt, '2026-09-30T08:15:00.000Z');
    assert.equal(report.files[0].lastFailedAt, '2026-09-30T08:15:00.000Z');
    assert.equal(report.printers[0].failureRateTrend, 0.5);
    assert.equal(report.printers[0].earlierAttempts, 2);
    assert.equal(report.printers[0].recentAttempts, 1);
    assert.ok(report.printers[0].attentionReasons.some((reason) => /2 failed prints/.test(reason)));
    assert.equal(report.materials.length, 2);
    assert.equal(report.daily.length, 2);

    const filtered = await service.getReport({
      from:'2026-09-29T00:00:00.000Z',
      to:'2026-09-30T23:59:59.999Z',
      printerIds:['p2']
    });
    assert.equal(filtered.totals.attempts, 1);
    assert.equal(filtered.totals.completed, 1);
    assert.equal(filtered.printers[0].printerId, 'p2');
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('reporting history is not constrained by the queue 250-item history limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-reporting-retention-'));
  const service = new ReportingService({ filePath:path.join(root, 'reporting-history.json') });
  try {
    const jobs = Array.from({ length:260 }, (_, index) => completedJob({
      id:`job-${index}`,
      printerId:'p1',
      printerName:'Printer',
      fileName:'part.gcode',
      startedAt:new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
      finishedAt:new Date(Date.UTC(2026, 0, 1, 0, index + 1, 0)).toISOString()
    }));
    await service.recordTerminalJobs(jobs);
    assert.equal((await service.getRecords()).length, 260);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('unassigned queue jobs remain in farm totals without creating fictitious printers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-reporting-unassigned-'));
  const service = new ReportingService({ filePath:path.join(root, 'reporting-history.json') });
  try {
    await service.recordTerminalJobs([
      completedJob({
        id:'unassigned-cancel', printerId:null, printerName:'Next available compatible printer',
        fileName:'pending.gcode', status:'cancelled', finishedAt:'2026-09-30T08:00:00.000Z'
      }),
      completedJob({
        id:'unassigned-failure', printerId:null, printerName:'Next available compatible printer',
        fileName:'pending.gcode', status:'failed', finishedAt:'2026-09-30T08:05:00.000Z'
      }),
      completedJob({
        id:'success', printerId:'p1', printerName:'Healthy printer', fileName:'part.gcode',
        startedAt:'2026-09-30T10:00:00.000Z', finishedAt:'2026-09-30T10:02:00.000Z',
        materialCost:{ complete:true, totalGrams:12, totalCost:0.5, currency:'GBP', tools:[] }
      }),
      completedJob({
        id:'missing-start', printerId:'p2', printerName:'Printer without timestamps', fileName:'part.gcode',
        finishedAt:'2026-09-30T11:00:00.000Z'
      })
    ]);
    const dates = { from:'2026-09-30T00:00:00.000Z', to:'2026-09-30T23:59:59.999Z' };
    const report = await service.getReport(dates);
    assert.equal(report.totals.attempts, 4);
    assert.equal(report.totals.cancelled, 1);
    assert.equal(report.totals.failed, 1);
    assert.equal(report.files.find((row) => row.fileName === 'pending.gcode').attempts, 2);
    assert.equal(report.daily[0].attempts, 4);
    assert.deepEqual(report.printers.map((printer) => printer.printerId).sort(), ['p1', 'p2']);
    assert.ok(report.printers.every((printer) => printer.failed === 0 && printer.attentionReasons.length === 0));
    const short = report.printers.find((printer) => printer.printerId === 'p1');
    assert.equal(short.runMinutes, 2);
    assert.equal(short.runTimeRecordedCount, 1);
    assert.equal(short.materialGrams, 12);
    assert.deepEqual(short.spendByCurrency, { GBP:0.5 });
    const unknown = report.printers.find((printer) => printer.printerId === 'p2');
    assert.equal(unknown.runTimeRecordedCount, 0);
    assert.equal(unknown.runHours, 0);
    const filtered = await service.getReport({ ...dates, printerIds:['p1'] });
    assert.equal(filtered.totals.attempts, 1);
    assert.equal(filtered.printers.length, 1);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('previous period comparisons use an adjacent equal-length range and the same printer filters', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-report-previous-period-'));
  const service=new ReportingService({ filePath:path.join(root,'reporting-history.json') });
  try {
    await service.recordTerminalJobs([
      completedJob({ id:'prev-start',printerId:'p1',printerName:'P1',fileName:'f.gcode',
        startedAt:'2026-10-06T23:00:00.000Z',finishedAt:'2026-10-07T00:00:00.000Z' }),
      completedJob({ id:'prev-middle',printerId:'p1',printerName:'P1',fileName:'f.gcode',
        startedAt:'2026-10-09T23:00:00.000Z',finishedAt:'2026-10-10T00:00:00.000Z' }),
      completedJob({ id:'prev-other-printer',printerId:'p2',printerName:'P2',fileName:'f.gcode',
        startedAt:'2026-10-10T13:00:00.000Z',finishedAt:'2026-10-10T14:00:00.000Z' }),
      completedJob({ id:'prev-end',printerId:'p1',printerName:'P1',fileName:'f.gcode',
        status:'failed',startedAt:'2026-10-13T23:30:00.000Z',finishedAt:'2026-10-13T23:59:59.999Z' }),
      completedJob({ id:'current-start',printerId:'p1',printerName:'P1',fileName:'f.gcode',
        startedAt:'2026-10-14T00:00:00.000Z',finishedAt:'2026-10-14T00:00:00.000Z' }),
      completedJob({ id:'current-end',printerId:'p1',printerName:'P1',fileName:'f.gcode',
        startedAt:'2026-10-20T23:00:00.000Z',finishedAt:'2026-10-21T00:00:00.000Z' })
    ]);
    const range={ from:'2026-10-14T00:00:00.000Z', to:'2026-10-21T00:00:00.000Z' };
    const current=await service.getReport({ ...range, printerIds:['p1'] });
    assert.equal(current.totals.attempts,2);
    const prior=await service.getPreviousPeriodTotals({ ...range,printerIds:['p1'] });
    assert.equal(prior.range.to,'2026-10-13T23:59:59.999Z');
    assert.equal(new Date(prior.range.to).getTime()-new Date(prior.range.from).getTime(),
      new Date(range.to).getTime()-new Date(range.from).getTime());
    assert.equal(prior.totals.attempts,3);
    assert.equal(prior.totals.completed,2);
    assert.equal(prior.totals.failed,1);
    assert.equal(prior.totals.runHours,2.5);
    const noFilter=await service.getPreviousPeriodTotals(range);
    assert.equal(noFilter.totals.attempts,4);
    const noMatches=await service.getPreviousPeriodTotals({ ...range,printerIds:[] });
    assert.equal(noMatches.totals.attempts,0);
    const quiet=await service.getPreviousPeriodTotals({
      from:'2026-10-29T00:00:00.000Z', to:'2026-10-30T00:00:00.000Z'
    });
    assert.equal(quiet.totals.attempts,0);
    assert.match(prior.range.from,/2026-10-06T23:59:59.999Z/);
  } finally {
    await fs.rm(root,{ recursive:true,force:true });
  }
});
