import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { controllerDataDir, listPrinters } from './store.js';

const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400];
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replaceFileWithRetry(source, destination) {
  let retry = 0;
  while (true) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || retry >= WINDOWS_RENAME_RETRY_DELAYS_MS.length) throw error;
      await delay(WINDOWS_RENAME_RETRY_DELAYS_MS[retry]);
      retry += 1;
    }
  }
}

function normalizeName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new Error('Printer group name is required');
  if (name.length > 80) throw new Error('Printer group name must be 80 characters or fewer');
  if (/[\x00-\x1f\x7f]/.test(name)) throw new Error('Printer group name contains invalid characters');
  return name;
}

function normalizePrinterIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Printer group members must be an array');
  return [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))];
}

function defaultState() {
  return { version:1, groups:[] };
}

function normalizeState(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.groups)) throw new Error('Printer group store is invalid');
  const names = new Set();
  const groups = raw.groups.map((source) => {
    const id = String(source?.id || '').trim();
    if (!id) throw new Error('Printer group store contains a group without an id');
    const name = normalizeName(source?.name);
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) throw new Error('Printer group store contains duplicate group names');
    names.add(nameKey);
    const printerIds = normalizePrinterIds(source?.printerIds);
    return {
      id,
      name,
      printerIds,
      createdAt:source?.createdAt || null,
      updatedAt:source?.updatedAt || source?.createdAt || null
    };
  });
  return { version:1, groups };
}

export class PrinterGroupService {
  constructor({
    dataDir = controllerDataDir,
    listPrintersFn = listPrinters,
    nowFn = () => new Date()
  } = {}) {
    this.filePath = path.join(path.resolve(dataDir), 'printer-groups.json');
    this.listPrinters = listPrintersFn;
    this.nowFn = nowFn;
    this.state = defaultState();
    this.initialized = false;
    this.saveChain = Promise.resolve();
  }

  async init() {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive:true });
    try {
      this.state = normalizeState(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.state = defaultState();
      await this.persist();
    }
    this.initialized = true;
  }

  async persist() {
    const snapshot = structuredClone(this.state);
    const previous = this.saveChain.catch(() => {});
    this.saveChain = previous.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive:true });
      const temp = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { mode:0o600 });
        await replaceFileWithRetry(temp, this.filePath);
      } finally {
        await fs.rm(temp, { force:true }).catch(() => {});
      }
    });
    return this.saveChain;
  }

  list() {
    return structuredClone(this.state.groups || []);
  }

  get(groupId) {
    const group = (this.state.groups || []).find((item) => item.id === String(groupId || ''));
    return group ? structuredClone(group) : null;
  }

  groupsForPrinter(printerId) {
    const id = String(printerId || '');
    return structuredClone((this.state.groups || []).filter((item) => item.printerIds.includes(id)));
  }

  groupForPrinter(printerId) {
    return this.groupsForPrinter(printerId)[0] || null;
  }

  isPrinterInGroup(printerId, groupId) {
    const group = (this.state.groups || []).find((item) => item.id === String(groupId || ''));
    return Boolean(group?.printerIds.includes(String(printerId || '')));
  }

  async validateMembers(printerIds) {
    const configured = await this.listPrinters();
    const valid = new Set((configured || []).map((printer) => String(printer.id)));
    const missing = printerIds.filter((id) => !valid.has(id));
    if (missing.length) throw new Error('Printer group contains a printer that is no longer configured');
  }

  assertUniqueName(name, exceptId = null) {
    const key = name.toLowerCase();
    if ((this.state.groups || []).some((group) => group.id !== exceptId && group.name.toLowerCase() === key)) {
      throw new Error('A printer group with this name already exists');
    }
  }

  assignMembers(groupId, printerIds) {
    const group = this.state.groups.find((item) => item.id === groupId);
    group.printerIds = [...printerIds];
  }

  async create({ name, printerIds = [] } = {}) {
    await this.init();
    const normalizedName = normalizeName(name);
    const members = normalizePrinterIds(printerIds);
    this.assertUniqueName(normalizedName);
    await this.validateMembers(members);
    const timestamp = this.nowFn().toISOString();
    const group = {
      id:crypto.randomUUID(),
      name:normalizedName,
      printerIds:[],
      createdAt:timestamp,
      updatedAt:timestamp
    };
    this.state.groups.push(group);
    this.assignMembers(group.id, members);
    await this.persist();
    return this.get(group.id);
  }

  async update(groupId, { name, printerIds } = {}) {
    await this.init();
    const id = String(groupId || '');
    const group = this.state.groups.find((item) => item.id === id);
    if (!group) {
      const error = new Error('Printer group not found');
      error.statusCode = 404;
      throw error;
    }
    if (name !== undefined) {
      const normalizedName = normalizeName(name);
      this.assertUniqueName(normalizedName, id);
      group.name = normalizedName;
    }
    if (printerIds !== undefined) {
      const members = normalizePrinterIds(printerIds);
      await this.validateMembers(members);
      this.assignMembers(id, members);
    }
    group.updatedAt = this.nowFn().toISOString();
    await this.persist();
    return this.get(id);
  }

  async delete(groupId) {
    await this.init();
    const id = String(groupId || '');
    const before = this.state.groups.length;
    this.state.groups = this.state.groups.filter((group) => group.id !== id);
    if (before === this.state.groups.length) {
      const error = new Error('Printer group not found');
      error.statusCode = 404;
      throw error;
    }
    await this.persist();
    return true;
  }

  async removePrinter(printerId) {
    await this.init();
    const id = String(printerId || '');
    let changed = false;
    for (const group of this.state.groups) {
      const next = group.printerIds.filter((memberId) => memberId !== id);
      if (next.length !== group.printerIds.length) {
        group.printerIds = next;
        group.updatedAt = this.nowFn().toISOString();
        changed = true;
      }
    }
    if (changed) await this.persist();
    return changed;
  }

  snapshot(printers = []) {
    const byId = new Map((printers || []).map((printer) => [String(printer.id), printer]));
    return {
      version:1,
      groups:this.list().map((group) => ({
        ...group,
        members:group.printerIds
          .map((printerId) => byId.get(printerId))
          .filter(Boolean)
          .map((printer) => ({
            printerId:printer.id,
            printerName:printer.name,
            adapterType:printer.adapterType || null,
            manufacturer:printer.manufacturer || null,
            model:printer.model || null
          }))
      }))
    };
  }
}

export const printerGroupStoreFileName = 'printer-groups.json';
