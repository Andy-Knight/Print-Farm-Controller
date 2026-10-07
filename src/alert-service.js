import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { controllerDataDir } from './store.js';
import { createDefaultNotificationProviders } from './notification-providers.js';

const HISTORY_LIMIT = 1000;
const SEVERITIES = new Set(['info', 'warning', 'critical']);
const SCOPE_TYPES = new Set(['all', 'printer', 'group', 'model']);
const EVENT_TYPE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
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

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function cleanText(value, { required = false, max = 160, label = 'Value', multiline = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  const invalidControl = multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/;
  if (invalidControl.test(text)) throw new Error(`${label} contains invalid characters`);
  return text;
}

function normalizeEventType(value) {
  const type = cleanText(value, { required:true, max:100, label:'Alert event type' }).toLowerCase();
  if (!EVENT_TYPE_PATTERN.test(type)) throw new Error('Alert event type contains invalid characters');
  return type;
}

function normalizeSeverity(value) {
  const severity = cleanText(value || 'info', { required:true, max:20, label:'Alert severity' }).toLowerCase();
  if (!SEVERITIES.has(severity)) throw new Error('Alert severity must be info, warning or critical');
  return severity;
}

function normalizeStringList(value, { label, allowWildcard = false, normalizer = null } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = [];
  for (const raw of value) {
    const item = cleanText(raw, { required:true, max:100, label });
    const normalized = allowWildcard && item === '*' ? '*' : (normalizer ? normalizer(item) : item);
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function normalizeScope(value = {}) {
  const type = cleanText(value.type || 'all', { required:true, max:20, label:'Alert rule scope' }).toLowerCase();
  if (!SCOPE_TYPES.has(type)) throw new Error('Alert rule scope must be all, printer, group or model');
  if (type === 'all') return { type:'all' };
  if (type === 'printer') {
    return {
      type,
      printerId:cleanText(value.printerId, { required:true, max:120, label:'Printer' })
    };
  }
  if (type === 'group') {
    return {
      type,
      groupId:cleanText(value.groupId, { required:true, max:120, label:'Printer group' })
    };
  }
  return {
    type,
    adapterType:cleanText(value.adapterType, { required:true, max:80, label:'Printer adapter type' }),
    model:cleanText(value.model, { required:true, max:120, label:'Printer model' })
  };
}

function defaultState() {
  return {
    version:1,
    rules:[],
    destinations:[],
    history:[],
    activeConditions:{}
  };
}

function normalizeAlert(input, nowFn) {
  const createdAt = input?.createdAt
    ? new Date(input.createdAt).toISOString()
    : nowFn().toISOString();
  const printer = input?.printer && typeof input.printer === 'object'
    ? {
        id:cleanText(input.printer.id, { max:120, label:'Printer id' }) || null,
        name:cleanText(input.printer.name, { max:160, label:'Printer name' }) || null,
        adapterType:cleanText(input.printer.adapterType, { max:80, label:'Printer adapter type' }) || null,
        model:cleanText(input.printer.model, { max:120, label:'Printer model' }) || null
      }
    : null;
  const source = input?.source && typeof input.source === 'object'
    ? {
        kind:cleanText(input.source.kind, { max:60, label:'Alert source kind' }) || null,
        id:cleanText(input.source.id, { max:120, label:'Alert source id' }) || null,
        name:cleanText(input.source.name, { max:160, label:'Alert source name' }) || null
      }
    : null;

  return {
    id:cleanText(input?.id, { max:120, label:'Alert id' }) || crypto.randomUUID(),
    type:normalizeEventType(input?.type),
    severity:normalizeSeverity(input?.severity),
    title:cleanText(input?.title, { required:true, max:160, label:'Alert title' }),
    message:cleanText(input?.message, { required:true, max:2000, label:'Alert message', multiline:true }),
    createdAt,
    readAt:input?.readAt ? new Date(input.readAt).toISOString() : null,
    source,
    printer,
    metadata:input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? clone(input.metadata)
      : {}
  };
}

function normalizeRule(input, existing = null) {
  const eventTypes = input.eventTypes === undefined && existing
    ? existing.eventTypes
    : normalizeStringList(input.eventTypes ?? ['*'], {
        label:'Alert event types',
        allowWildcard:true,
        normalizer:normalizeEventType
      });
  if (!eventTypes.length) throw new Error('Alert rule must include at least one event type');

  const severities = input.severities === undefined && existing
    ? existing.severities
    : normalizeStringList(input.severities ?? [...SEVERITIES], {
        label:'Alert severities',
        normalizer:normalizeSeverity
      });
  if (!severities.length) throw new Error('Alert rule must include at least one severity');

  const destinationIds = input.destinationIds === undefined && existing
    ? existing.destinationIds
    : normalizeStringList(input.destinationIds ?? [], { label:'Alert destinations' });

  return {
    id:existing?.id || crypto.randomUUID(),
    name:cleanText(input.name ?? existing?.name, { required:true, max:100, label:'Alert rule name' }),
    enabled:input.enabled === undefined ? existing?.enabled !== false : Boolean(input.enabled),
    eventTypes,
    severities,
    scope:input.scope === undefined && existing ? clone(existing.scope) : normalizeScope(input.scope),
    destinationIds,
    createdAt:existing?.createdAt || null,
    updatedAt:existing?.updatedAt || null
  };
}

function normalizeDestination(input, providers, existing = null) {
  const providerId = cleanText(input.provider ?? existing?.provider, {
    required:true,
    max:40,
    label:'Notification provider'
  }).toLowerCase();
  const provider = providers.get(providerId);
  if (!provider) throw new Error(`Unsupported notification provider: ${providerId}`);
  const previousConfig = existing?.config || {};
  const suppliedConfig = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
    ? input.config
    : {};
  return {
    id:existing?.id || crypto.randomUUID(),
    name:cleanText(input.name ?? existing?.name, { required:true, max:100, label:'Notification destination name' }),
    provider:providerId,
    enabled:input.enabled === undefined ? existing?.enabled !== false : Boolean(input.enabled),
    config:provider.normalizeConfig(suppliedConfig, previousConfig),
    createdAt:existing?.createdAt || null,
    updatedAt:existing?.updatedAt || null
  };
}

function publicDestination(destination, providers) {
  const provider = providers.get(destination.provider);
  return {
    id:destination.id,
    name:destination.name,
    provider:destination.provider,
    providerLabel:provider?.label || destination.provider,
    enabled:destination.enabled !== false,
    config:provider?.publicConfig ? provider.publicConfig(destination.config) : {},
    createdAt:destination.createdAt,
    updatedAt:destination.updatedAt
  };
}

function scopeMatches(rule, alert, groupLookup) {
  const scope = rule.scope || { type:'all' };
  if (scope.type === 'all') return true;
  if (scope.type === 'printer') return String(alert.printer?.id || '') === String(scope.printerId || '');
  if (scope.type === 'model') {
    return String(alert.printer?.adapterType || '').toLowerCase() === String(scope.adapterType || '').toLowerCase()
      && String(alert.printer?.model || '').toLowerCase() === String(scope.model || '').toLowerCase();
  }
  if (scope.type === 'group') {
    if (!alert.printer?.id) return false;
    const group = groupLookup(scope.groupId);
    return Boolean(group?.printerIds?.map(String).includes(String(alert.printer.id)));
  }
  return false;
}

function ruleMatches(rule, alert, groupLookup) {
  if (rule.enabled === false) return false;
  if (!rule.eventTypes.includes('*') && !rule.eventTypes.includes(alert.type)) return false;
  if (!rule.severities.includes(alert.severity)) return false;
  return scopeMatches(rule, alert, groupLookup);
}

function alertRequiresRead(alert = {}) {
  return ['warning', 'critical'].includes(String(alert.severity || '').toLowerCase());
}

function alertRequiresAttention(alert = {}) {
  if (alert.readAt) return false;
  if (!alertRequiresRead(alert)) return false;
  if (String(alert.type || '').toLowerCase().startsWith('maintenance.')) return false;
  return true;
}

export class AlertService {
  constructor({
    dataDir = controllerDataDir,
    filePath = null,
    nowFn = () => new Date(),
    providers = createDefaultNotificationProviders(),
    groupLookupFn = null,
    diagnosticFn = null,
    historyLimit = HISTORY_LIMIT
  } = {}) {
    this.filePath = path.resolve(filePath || path.join(dataDir, 'alerts.json'));
    this.nowFn = nowFn;
    this.providers = providers instanceof Map ? providers : new Map(providers || []);
    this.groupLookup = typeof groupLookupFn === 'function' ? groupLookupFn : () => null;
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : () => {};
    this.historyLimit = Math.max(1, Number(historyLimit) || HISTORY_LIMIT);
    this.state = defaultState();
    this.initialized = false;
    this.saveChain = Promise.resolve();
  }

  async init() {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive:true, mode:0o700 });
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!raw || raw.version !== 1 || !Array.isArray(raw.rules) || !Array.isArray(raw.destinations) || !Array.isArray(raw.history)) {
        throw new Error('Alert store is invalid');
      }
      this.state = {
        ...raw,
        activeConditions:raw.activeConditions && typeof raw.activeConditions === 'object' && !Array.isArray(raw.activeConditions)
          ? raw.activeConditions
          : {}
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.state = defaultState();
      await this.persist();
    }
    this.initialized = true;
  }

  async persist() {
    const snapshot = clone(this.state);
    const previous = this.saveChain.catch(() => {});
    this.saveChain = previous.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive:true, mode:0o700 });
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

  providerDefinitions() {
    return [...this.providers.values()].map((provider) => ({ id:provider.id, label:provider.label }));
  }

  listRules() {
    return clone(this.state.rules);
  }

  listDestinations() {
    return this.state.destinations.map((destination) => publicDestination(destination, this.providers));
  }

  listHistory({ limit = 100, unreadOnly = false } = {}) {
    const bounded = Math.max(1, Math.min(this.historyLimit, Number(limit) || 100));
    const source = unreadOnly
      ? this.state.history.filter((alert) => alertRequiresRead(alert) && !alert.readAt)
      : this.state.history;
    return clone(source.slice(0, bounded));
  }

  unreadCount() {
    return this.state.history.reduce(
      (count, alert) => count + (alertRequiresRead(alert) && !alert.readAt ? 1 : 0),
      0
    );
  }

  attentionUnreadCount() {
    return this.state.history.reduce((count, alert) => count + (alertRequiresAttention(alert) ? 1 : 0), 0);
  }

  snapshot({ historyLimit = 20 } = {}) {
    return {
      version:1,
      unreadCount:this.unreadCount(),
      attentionUnreadCount:this.attentionUnreadCount(),
      providers:this.providerDefinitions(),
      rules:this.listRules(),
      destinations:this.listDestinations(),
      history:this.listHistory({ limit:historyLimit })
    };
  }

  async createRule(input = {}) {
    await this.init();
    const now = this.nowFn().toISOString();
    const rule = normalizeRule(input);
    for (const id of rule.destinationIds) {
      if (!this.state.destinations.some((destination) => destination.id === id)) {
        throw new Error('Alert rule references an unknown notification destination');
      }
    }
    rule.createdAt = now;
    rule.updatedAt = now;
    this.state.rules.push(rule);
    await this.persist();
    return clone(rule);
  }

  async updateRule(ruleId, input = {}) {
    await this.init();
    const index = this.state.rules.findIndex((rule) => rule.id === String(ruleId || ''));
    if (index < 0) {
      const error = new Error('Alert rule not found');
      error.statusCode = 404;
      throw error;
    }
    const next = normalizeRule(input, this.state.rules[index]);
    for (const id of next.destinationIds) {
      if (!this.state.destinations.some((destination) => destination.id === id)) {
        throw new Error('Alert rule references an unknown notification destination');
      }
    }
    next.updatedAt = this.nowFn().toISOString();
    this.state.rules[index] = next;
    await this.persist();
    return clone(next);
  }

  async deleteRule(ruleId) {
    await this.init();
    const before = this.state.rules.length;
    this.state.rules = this.state.rules.filter((rule) => rule.id !== String(ruleId || ''));
    if (this.state.rules.length === before) {
      const error = new Error('Alert rule not found');
      error.statusCode = 404;
      throw error;
    }
    await this.persist();
    return true;
  }

  async createDestination(input = {}) {
    await this.init();
    const now = this.nowFn().toISOString();
    const destination = normalizeDestination(input, this.providers);
    destination.createdAt = now;
    destination.updatedAt = now;
    this.state.destinations.push(destination);
    await this.persist();
    return publicDestination(destination, this.providers);
  }

  async updateDestination(destinationId, input = {}) {
    await this.init();
    const index = this.state.destinations.findIndex((destination) => destination.id === String(destinationId || ''));
    if (index < 0) {
      const error = new Error('Notification destination not found');
      error.statusCode = 404;
      throw error;
    }
    const next = normalizeDestination(input, this.providers, this.state.destinations[index]);
    next.updatedAt = this.nowFn().toISOString();
    this.state.destinations[index] = next;
    await this.persist();
    return publicDestination(next, this.providers);
  }

  async deleteDestination(destinationId) {
    await this.init();
    const id = String(destinationId || '');
    if (this.state.rules.some((rule) => rule.destinationIds.includes(id))) {
      const error = new Error('Remove this destination from alert rules before deleting it');
      error.statusCode = 409;
      throw error;
    }
    const before = this.state.destinations.length;
    this.state.destinations = this.state.destinations.filter((destination) => destination.id !== id);
    if (this.state.destinations.length === before) {
      const error = new Error('Notification destination not found');
      error.statusCode = 404;
      throw error;
    }
    await this.persist();
    return true;
  }

  async markRead(alertId = null) {
    await this.init();
    const now = this.nowFn().toISOString();
    let changed = 0;
    for (const alert of this.state.history) {
      if (alert.readAt || !alertRequiresRead(alert)) continue;
      if (alertId && alert.id !== String(alertId)) continue;
      alert.readAt = now;
      changed += 1;
    }
    if (alertId && changed === 0 && !this.state.history.some((alert) => alert.id === String(alertId))) {
      const error = new Error('Alert not found');
      error.statusCode = 404;
      throw error;
    }
    if (changed) await this.persist();
    return {
      changed,
      unreadCount:this.unreadCount(),
      attentionUnreadCount:this.attentionUnreadCount()
    };
  }

  async adoptCondition(conditionKey, { type = null, printerId = null } = {}) {
    await this.init();
    const key = cleanText(conditionKey, { required:true, max:240, label:'Alert condition key' });
    if (this.state.activeConditions?.[key]) {
      return { adopted:true, alertId:this.state.activeConditions[key], existing:true };
    }
    const wantedType = type ? normalizeEventType(type) : null;
    const wantedPrinterId = printerId == null ? null : String(printerId);
    const existing = this.state.history.find((alert) => {
      if (wantedType && alert.type !== wantedType) return false;
      if (wantedPrinterId !== null && String(alert.printer?.id || '') !== wantedPrinterId) return false;
      return true;
    });
    if (!existing) return { adopted:false, alertId:null, existing:false };
    this.state.activeConditions[key] = existing.id;
    await this.persist();
    return { adopted:true, alertId:existing.id, existing:false };
  }

  async emitCondition(conditionKey, input = {}) {
    await this.init();
    const key = cleanText(conditionKey, { required:true, max:240, label:'Alert condition key' });
    const activeAlertId = this.state.activeConditions?.[key] || null;
    if (activeAlertId) {
      const existing = this.state.history.find((alert) => alert.id === activeAlertId) || null;
      if (existing) {
        return {
          alert:clone(existing),
          matchedRuleIds:[],
          deliveries:[],
          duplicate:true,
          conditionKey:key
        };
      }
      delete this.state.activeConditions[key];
    }

    const result = await this.emit(input);
    if (!result?.duplicate) {
      this.state.activeConditions[key] = result.alert.id;
      await this.persist();
    }
    return { ...result, conditionKey:key };
  }

  async resolveCondition(conditionKey) {
    await this.init();
    const key = cleanText(conditionKey, { required:true, max:240, label:'Alert condition key' });
    if (!this.state.activeConditions?.[key]) return { resolved:false };
    const alertId = this.state.activeConditions[key];
    delete this.state.activeConditions[key];
    await this.persist();
    return { resolved:true, alertId };
  }

  async testDestination(destinationId) {
    await this.init();
    const destination = this.state.destinations.find((item) => item.id === String(destinationId || ''));
    if (!destination) {
      const error = new Error('Notification destination not found');
      error.statusCode = 404;
      throw error;
    }
    const provider = this.providers.get(destination.provider);
    const now = this.nowFn().toISOString();
    const alert = {
      id:crypto.randomUUID(),
      type:'system.test',
      severity:'info',
      title:'Print Farm Controller test notification',
      message:'Notifications are configured correctly.',
      createdAt:now,
      source:{ kind:'controller', id:null, name:'Print Farm Controller' },
      printer:null,
      metadata:{ test:true }
    };
    await provider.send(destination.config, alert);
    return { ok:true };
  }

  async emit(input = {}) {
    await this.init();
    const alert = normalizeAlert(input, this.nowFn);
    const existing = this.state.history.find((item) => item.id === alert.id);
    if (existing) {
      return {
        alert:clone(existing),
        matchedRuleIds:[],
        deliveries:[],
        duplicate:true
      };
    }
    this.state.history.unshift(alert);
    if (this.state.history.length > this.historyLimit) this.state.history.length = this.historyLimit;
    await this.persist();

    const matchedRules = this.state.rules.filter((rule) => ruleMatches(rule, alert, this.groupLookup));
    const destinationIds = [...new Set(matchedRules.flatMap((rule) => rule.destinationIds))];
    const deliveries = [];

    for (const destinationId of destinationIds) {
      const destination = this.state.destinations.find((item) => item.id === destinationId);
      if (!destination || destination.enabled === false) continue;
      const provider = this.providers.get(destination.provider);
      if (!provider) continue;
      try {
        const result = await provider.send(destination.config, alert);
        deliveries.push({ destinationId, ok:true, status:result?.status || null });
      } catch (error) {
        deliveries.push({ destinationId, ok:false, error:error?.message || String(error) });
        await Promise.resolve(this.diagnostic('warn', 'Alert delivery failed', {
          alertId:alert.id,
          alertType:alert.type,
          destinationId,
          provider:destination.provider,
          error:error?.message || String(error)
        })).catch(() => {});
      }
    }

    return {
      alert:clone(alert),
      matchedRuleIds:matchedRules.map((rule) => rule.id),
      deliveries
    };
  }
}

export const alertStoreFileName = 'alerts.json';
