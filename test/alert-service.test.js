import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AlertService } from '../src/alert-service.js';
import { NtfyNotificationProvider, WebhookNotificationProvider } from '../src/notification-providers.js';

function fakeProvider(sent) {
  return {
    id:'fake',
    label:'Fake',
    normalizeConfig(input = {}, previous = {}) {
      return { endpoint:String(input.endpoint ?? previous.endpoint ?? '').trim() };
    },
    publicConfig(config = {}) {
      return { endpoint:config.endpoint || '' };
    },
    async send(config, alert) {
      sent.push({ config:structuredClone(config), alert:structuredClone(alert) });
      return { ok:true, status:202 };
    }
  };
}

test('alert service persists history and sends only matching rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-alerts-'));
  const sent = [];
  const provider = fakeProvider(sent);
  const groups = new Map([
    ['production', { id:'production', printerIds:['p1'] }]
  ]);
  const clock = [
    new Date('2026-10-05T18:00:00.000Z'),
    new Date('2026-10-05T18:01:00.000Z'),
    new Date('2026-10-05T18:02:00.000Z'),
    new Date('2026-10-05T18:03:00.000Z'),
    new Date('2026-10-05T18:04:00.000Z')
  ];
  let clockIndex = 0;

  try {
    const service = new AlertService({
      dataDir:root,
      providers:new Map([[provider.id, provider]]),
      groupLookupFn:(id) => groups.get(id) || null,
      nowFn:() => clock[Math.min(clockIndex++, clock.length - 1)]
    });
    await service.init();

    const destination = await service.createDestination({
      name:'Test destination',
      provider:'fake',
      config:{ endpoint:'capture' }
    });
    const rule = await service.createRule({
      name:'Production failures',
      eventTypes:['print.failed'],
      severities:['critical'],
      scope:{ type:'group', groupId:'production' },
      destinationIds:[destination.id]
    });

    const matched = await service.emit({
      type:'print.failed',
      severity:'critical',
      title:'Print failed',
      message:'Part failed on Printer 1',
      printer:{ id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' }
    });
    assert.deepEqual(matched.matchedRuleIds, [rule.id]);
    assert.equal(matched.deliveries.length, 1);
    assert.equal(matched.deliveries[0].ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].alert.type, 'print.failed');

    const unmatched = await service.emit({
      type:'print.failed',
      severity:'critical',
      title:'Print failed',
      message:'Part failed on Printer 2',
      printer:{ id:'p2', name:'Printer 2', adapterType:'snapmaker-u1', model:'U1' }
    });
    assert.deepEqual(unmatched.matchedRuleIds, []);
    assert.equal(sent.length, 1);
    assert.equal(service.listHistory().length, 2);
    assert.equal(service.unreadCount(), 2);

    const markOne = await service.markRead(matched.alert.id);
    assert.equal(markOne.changed, 1);
    assert.equal(markOne.unreadCount, 1);
    const markAll = await service.markRead();
    assert.equal(markAll.changed, 1);
    assert.equal(markAll.unreadCount, 0);

    const reloaded = new AlertService({
      dataDir:root,
      providers:new Map([[provider.id, provider]]),
      groupLookupFn:(id) => groups.get(id) || null
    });
    await reloaded.init();
    assert.equal(reloaded.listRules().length, 1);
    assert.equal(reloaded.listDestinations().length, 1);
    assert.equal(reloaded.listHistory().length, 2);
    assert.equal(reloaded.unreadCount(), 0);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('top-bar attention count excludes maintenance and informational alerts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-alert-attention-'));
  try {
    const service = new AlertService({ dataDir:root, providers:new Map() });
    await service.init();

    await service.emit({
      type:'maintenance.due',
      severity:'warning',
      title:'Maintenance due',
      message:'Printer maintenance is due'
    });
    await service.emit({
      type:'print.completed',
      severity:'info',
      title:'Print completed',
      message:'Part finished'
    });

    assert.equal(service.unreadCount(), 2);
    assert.equal(service.attentionUnreadCount(), 0);

    const operational = await service.emit({
      type:'queue.bed_clearance',
      severity:'warning',
      title:'Bed clearance required',
      message:'Clear the bed'
    });

    assert.equal(service.unreadCount(), 3);
    assert.equal(service.attentionUnreadCount(), 1);
    assert.equal(service.snapshot().attentionUnreadCount, 1);

    const marked = await service.markRead(operational.alert.id);
    assert.equal(marked.unreadCount, 2);
    assert.equal(marked.attentionUnreadCount, 0);
    assert.equal(service.unreadCount(), 2);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('active condition alerts do not duplicate after restart even when already read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-alert-condition-restart-'));
  try {
    const first = new AlertService({ dataDir:root, providers:new Map() });
    await first.init();
    const opened = await first.emitCondition('printer.offline:p1', {
      type:'printer.offline',
      severity:'warning',
      title:'Printer offline',
      message:'Printer 1 is offline',
      printer:{ id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' }
    });
    assert.equal(opened.duplicate, undefined);
    assert.equal(first.listHistory().length, 1);

    await first.markRead(opened.alert.id);
    assert.equal(first.listHistory()[0].readAt !== null, true);

    const restarted = new AlertService({ dataDir:root, providers:new Map() });
    await restarted.init();
    const repeated = await restarted.emitCondition('printer.offline:p1', {
      type:'printer.offline',
      severity:'warning',
      title:'Printer offline',
      message:'Printer 1 is offline',
      printer:{ id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' }
    });
    assert.equal(repeated.duplicate, true);
    assert.equal(restarted.listHistory().length, 1);
    assert.equal(restarted.listHistory()[0].readAt !== null, true);

    await restarted.resolveCondition('printer.offline:p1');
    const reopened = await restarted.emitCondition('printer.offline:p1', {
      type:'printer.offline',
      severity:'warning',
      title:'Printer offline again',
      message:'Printer 1 is offline again',
      printer:{ id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' }
    });
    assert.notEqual(reopened.alert.id, opened.alert.id);
    assert.equal(restarted.listHistory().length, 2);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('existing pre-condition-registry history can be adopted on restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-alert-condition-adopt-'));
  try {
    const legacy = new AlertService({ dataDir:root, providers:new Map() });
    await legacy.init();
    const old = await legacy.emit({
      type:'maintenance.due',
      severity:'warning',
      title:'Maintenance due',
      message:'Printer 1 maintenance due',
      printer:{ id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' }
    });
    await legacy.markRead(old.alert.id);

    const restarted = new AlertService({ dataDir:root, providers:new Map() });
    await restarted.init();
    const adopted = await restarted.adoptCondition('maintenance.due:p1', {
      type:'maintenance.due',
      printerId:'p1'
    });
    assert.equal(adopted.adopted, true);

    const repeated = await restarted.emitCondition('maintenance.due:p1', {
      type:'maintenance.due',
      severity:'warning',
      title:'Maintenance due',
      message:'Printer 1 maintenance due',
      printer:{ id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' }
    });
    assert.equal(repeated.duplicate, true);
    assert.equal(restarted.listHistory().length, 1);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('alert destinations cannot be deleted while referenced by a rule', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-alert-destination-'));
  const provider = fakeProvider([]);
  try {
    const service = new AlertService({ dataDir:root, providers:new Map([[provider.id, provider]]) });
    const destination = await service.createDestination({
      name:'Destination',
      provider:'fake',
      config:{ endpoint:'capture' }
    });
    const rule = await service.createRule({
      name:'All warnings',
      eventTypes:['*'],
      severities:['warning'],
      scope:{ type:'all' },
      destinationIds:[destination.id]
    });
    await assert.rejects(() => service.deleteDestination(destination.id), /remove this destination/i);
    await service.deleteRule(rule.id);
    assert.equal(await service.deleteDestination(destination.id), true);
  } finally {
    await fs.rm(root, { recursive:true, force:true });
  }
});

test('ntfy provider sends outbound HTTPS notifications and redacts credentials from public config', async () => {
  const requests = [];
  const provider = new NtfyNotificationProvider({
    fetchFn:async (url, options) => {
      requests.push({ url, options });
      return { ok:true, status:200 };
    }
  });
  const config = provider.normalizeConfig({
    server:'https://ntfy.sh/',
    topic:'pfc-secret-topic',
    token:'secret-token'
  });
  assert.deepEqual(provider.publicConfig(config), {
    server:'https://ntfy.sh',
    topic:'pfc-secret-topic',
    username:'',
    hasPassword:false,
    hasToken:true
  });

  await provider.send(config, {
    id:'a1',
    type:'print.failed',
    severity:'critical',
    title:'Print failed',
    message:'Printer 1 failed',
    createdAt:'2026-10-05T18:00:00.000Z'
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://ntfy.sh/pfc-secret-topic');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, 'Bearer secret-token');
  assert.equal(requests[0].options.headers.priority, '5');
  assert.equal(requests[0].options.body, 'Printer 1 failed');
});

test('generic webhook provider posts the versioned alert envelope', async () => {
  const requests = [];
  const provider = new WebhookNotificationProvider({
    fetchFn:async (url, options) => {
      requests.push({ url, options });
      return { ok:true, status:204 };
    }
  });
  const config = provider.normalizeConfig({
    url:'https://example.test/hooks/pfc',
    authorization:'Bearer webhook-secret'
  });
  assert.deepEqual(provider.publicConfig(config), {
    url:'https://example.test/hooks/pfc',
    hasAuthorization:true
  });

  await provider.send(config, {
    id:'a1',
    type:'maintenance.due',
    severity:'warning',
    title:'Maintenance due',
    message:'Clean Printer 1',
    createdAt:'2026-10-05T18:00:00.000Z',
    source:{ kind:'maintenance', id:'task-1', name:'Clean nozzle' },
    printer:{ id:'p1', name:'Printer 1', adapterType:'snapmaker-u1', model:'U1' },
    metadata:{ taskId:'task-1' }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.test/hooks/pfc');
  assert.equal(requests[0].options.headers.authorization, 'Bearer webhook-secret');
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.alert.type, 'maintenance.due');
  assert.equal(body.alert.printer.id, 'p1');
});
