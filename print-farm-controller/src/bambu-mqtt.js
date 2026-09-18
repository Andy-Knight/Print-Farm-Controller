import tls from 'node:tls';
import crypto from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 6000;

export class BambuMqttError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'BambuMqttError';
  }
}

function mqttLength(value) {
  const bytes = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

function mqttString(value) {
  const body = Buffer.from(String(value));
  const size = Buffer.alloc(2);
  size.writeUInt16BE(body.length);
  return Buffer.concat([size, body]);
}

function mqttPacket(header, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([header]), mqttLength(payload.length), payload]);
}

function readMqttString(buffer, offset) {
  if (offset + 2 > buffer.length) return null;
  const length = buffer.readUInt16BE(offset);
  const end = offset + 2 + length;
  if (end > buffer.length) return null;
  return { value: buffer.subarray(offset + 2, end).toString(), next: end };
}

function connectPacket(clientId, accessCode) {
  const variable = Buffer.concat([
    mqttString('MQTT'),
    Buffer.from([4, 0xc2, 0, 30])
  ]);
  const payload = Buffer.concat([
    mqttString(clientId),
    mqttString('bblp'),
    mqttString(accessCode)
  ]);
  return mqttPacket(0x10, Buffer.concat([variable, payload]));
}

function subscribePacket(topic, packetId = 1) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId);
  return mqttPacket(0x82, Buffer.concat([id, mqttString(topic), Buffer.from([0])]));
}

function publishPacket(topic, value) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return mqttPacket(0x30, Buffer.concat([mqttString(topic), body]));
}

function takePackets(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const packets = [];
  while (state.buffer.length >= 2) {
    let cursor = 1;
    let remaining = 0;
    let multiplier = 1;
    let byte;
    do {
      if (cursor >= state.buffer.length) return packets;
      byte = state.buffer[cursor++];
      remaining += (byte & 0x7f) * multiplier;
      multiplier *= 128;
      if (multiplier > 128 ** 4) throw new BambuMqttError('Invalid MQTT remaining length');
    } while (byte & 0x80);
    if (state.buffer.length < cursor + remaining) return packets;
    packets.push({ header: state.buffer[0], payload: state.buffer.subarray(cursor, cursor + remaining) });
    state.buffer = state.buffer.subarray(cursor + remaining);
  }
  return packets;
}

function connectionSettings(printer) {
  const host = String(printer?.host || '').trim();
  const serialNumber = String(printer?.serialNumber || '').trim();
  const accessCode = String(printer?.checkCode || printer?.accessCode || printer?.adapterConfig?.accessCode || '').trim();
  const mqttPort = Number(printer?.mqttPort || printer?.adapterConfig?.mqttPort || 8883);
  if (!host || !serialNumber || !accessCode) throw new BambuMqttError('Bambu host, serial number and access code are required');
  if (!Number.isInteger(mqttPort) || mqttPort < 1 || mqttPort > 65535) throw new BambuMqttError('Bambu MQTT port must be 1-65535');
  return { host, serialNumber, accessCode, mqttPort };
}

async function openClient(printer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const settings = connectionSettings(printer);
  const socket = tls.connect({
    host: settings.host,
    port: settings.mqttPort,
    rejectUnauthorized: false,
    servername: undefined
  });
  socket.setNoDelay(true);
  const state = { buffer: Buffer.alloc(0), queue: [], waiters: [] };
  const failWaiters = (error) => {
    for (const waiter of state.waiters.splice(0)) waiter.reject(error);
  };
  socket.on('data', (chunk) => {
    let packets;
    try { packets = takePackets(state, chunk); } catch (error) { failWaiters(error); socket.destroy(); return; }
    for (const packet of packets) {
      const index = state.waiters.findIndex((waiter) => waiter.predicate(packet));
      if (index >= 0) state.waiters.splice(index, 1)[0].resolve(packet);
      else state.queue.push(packet);
    }
  });
  socket.on('error', (error) => failWaiters(new BambuMqttError(`Bambu MQTT connection failed: ${error.message}`, { cause: error })));
  socket.on('close', () => failWaiters(new BambuMqttError('Bambu MQTT connection closed')));

  const waitFor = (predicate, label) => {
    const queued = state.queue.findIndex(predicate);
    if (queued >= 0) return Promise.resolve(state.queue.splice(queued, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => {
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(new BambuMqttError(`Timed out waiting for Bambu MQTT ${label}`));
      }, timeoutMs);
      state.waiters.push(waiter);
    });
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new BambuMqttError('Timed out connecting to Bambu MQTT')); }, timeoutMs);
    socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
    socket.once('error', (error) => { clearTimeout(timer); reject(new BambuMqttError(`Could not connect to Bambu MQTT: ${error.message}`, { cause: error })); });
  });

  const clientId = `pfc-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  socket.write(connectPacket(clientId, settings.accessCode));
  const connack = await waitFor((packet) => packet.header >> 4 === 2, 'authentication');
  const returnCode = connack.payload[1];
  if (returnCode !== 0) {
    socket.destroy();
    throw new BambuMqttError(returnCode === 4 ? 'Bambu MQTT rejected the access code' : `Bambu MQTT rejected the connection (${returnCode})`);
  }
  return { socket, settings, waitFor };
}

function closeClient(client) {
  if (!client?.socket || client.socket.destroyed) return;
  try { client.socket.end(mqttPacket(0xe0)); } catch { client.socket.destroy(); }
}

export async function getBambuReport(printer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const client = await openClient(printer, { timeoutMs });
  const reportTopic = `device/${client.settings.serialNumber}/report`;
  const requestTopic = `device/${client.settings.serialNumber}/request`;
  try {
    client.socket.write(subscribePacket(reportTopic));
    const suback = await client.waitFor((packet) => packet.header >> 4 === 9, 'subscription');
    if (suback.payload[suback.payload.length - 1] === 0x80) throw new BambuMqttError('Bambu MQTT status subscription was rejected');
    const sequenceId = String(Date.now());
    client.socket.write(publishPacket(requestTopic, { pushing: { command: 'pushall', sequence_id: sequenceId } }));
    const report = await client.waitFor((packet) => {
      if (packet.header >> 4 !== 3) return false;
      const topic = readMqttString(packet.payload, 0);
      return topic?.value === reportTopic && packet.payload.subarray(topic.next).includes(Buffer.from('"gcode_state"'));
    }, 'status report');
    const topic = readMqttString(report.payload, 0);
    try { return JSON.parse(report.payload.subarray(topic.next).toString()); }
    catch (error) { throw new BambuMqttError(`Bambu MQTT returned invalid status JSON: ${error.message}`, { cause: error }); }
  } finally {
    closeClient(client);
  }
}

export async function sendBambuCommand(printer, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const client = await openClient(printer, { timeoutMs });
  try {
    const requestTopic = `device/${client.settings.serialNumber}/request`;
    client.socket.write(publishPacket(requestTopic, body));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 80);
      client.socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    return { ok: true };
  } finally {
    closeClient(client);
  }
}

export const bambuMqttInternals = { mqttLength, mqttString, mqttPacket, takePackets, connectionSettings };
