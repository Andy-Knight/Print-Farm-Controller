import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { printerStorePath } from './store.js';

const QUEUE_PATH = path.join(path.dirname(printerStorePath), 'print-jobs.json');

async function ensureQueueStore() {
  await fs.mkdir(path.dirname(QUEUE_PATH), { recursive: true });
  try {
    await fs.access(QUEUE_PATH);
  } catch {
    await fs.writeFile(QUEUE_PATH, '[]\n', { mode: 0o600 });
  }
}

export async function loadPrintJobs() {
  await ensureQueueStore();
  const raw = await fs.readFile(QUEUE_PATH, 'utf8');
  const jobs = JSON.parse(raw || '[]');
  return Array.isArray(jobs) ? jobs : [];
}

export async function savePrintJobs(jobs) {
  await ensureQueueStore();
  const temp = `${QUEUE_PATH}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(jobs, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, QUEUE_PATH);
  } finally {
    await fs.rm(temp, { force:true }).catch(() => {});
  }
}

export const printQueueStorePath = QUEUE_PATH;
