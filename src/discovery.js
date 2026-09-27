import dgram from 'node:dgram';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { configuredDiscoverySubnet, discoverySubnetHosts } from './discovery-network.js';
const FLASHFORGE_AD5M_ADAPTER_TYPE = 'flashforge-ad5m';
const FLASHFORGE_CREATOR5_ADAPTER_TYPE = 'flashforge-creator5';

const MODERN_SIZE = 276;
const LEGACY_SIZE = 140;
const MULTICAST_ADDRESS = '225.0.0.9';
const DEFAULT_PORTS = [8899, 19000, 48899];

const TCP_PROBE_PORT = 8899;
const TCP_PROBE_TIMEOUT_MS = 300;
const TCP_PROBE_CONCURRENCY = 64;

function m115Field(response, label) {
  const match = String(response || '').match(new RegExp(`^${label}\\s*:\\s*(.+)import dgram from 'node:dgram';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { configuredDiscoverySubnet, discoverySubnetHosts } from './discovery-network.js';
const FLASHFORGE_AD5M_ADAPTER_TYPE = 'flashforge-ad5m';
const FLASHFORGE_CREATOR5_ADAPTER_TYPE = 'flashforge-creator5';

const MODERN_SIZE = 276;
const LEGACY_SIZE = 140;
const MULTICAST_ADDRESS = '225.0.0.9';
, 'im'));
  return match ? match[1].trim() : '';
}

export function parseFlashForgeM115(response, host) {
  const text = String(response || '');
  if (!/Machine Type\s*:/i.test(text) || !/\bSN\s*:/i.test(text)) return null;

  const machineType = m115Field(text, 'Machine Type');
  const machineName = m115Field(text, 'Machine Name');
  const firmwareVersion = m115Field(text, 'Firmware');
  const serialNumber = m115Field(text, 'SN');
  if (!serialNumber || !/flashforge/i.test(machineType)) return null;

  const normalizedType = machineType.toUpperCase();
  if (!normalizedType.includes('ADVENTURER 5M')) return null;
  const model = normalizedType.includes('PRO') ? 'Adventurer 5M Pro' : 'Adventurer 5M';

  return {
    protocol:'tcp-m115',
    adapterType:FLASHFORGE_AD5M_ADAPTER_TYPE,
    manufacturer:'FlashForge',
    name:machineName || model,
    host,
    serialNumber,
    model,
    commandPort:TCP_PROBE_PORT,
    httpPort:8898,
    cameraPort:8080,
    vendorId:null,
    productId:null,
    productType:null,
    status:'unknown',
    lanMode:null,
    firmwareVersion:firmwareVersion || null
  };
}

export function probeFlashForgeM115(host, {
  port = TCP_PROBE_PORT,
  timeoutMs = TCP_PROBE_TIMEOUT_MS
} = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let response = '';

    const finish = (printer = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      resolve(printer);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.setNoDelay(true);
    socket.on('connect', () => {
      socket.write('~M115\n', 'ascii');
    });
    socket.on('data', (buffer) => {
      response += buffer.toString('utf8');
      if (/\bok\b/i.test(response) || response.length > 4096) {
        finish(parseFlashForgeM115(response, host));
      }
    });
    socket.on('error', () => finish(null));
    socket.on('close', () => {
      if (!settled) finish(parseFlashForgeM115(response, host));
    });
  });
}

async function probeConfiguredFlashForgeSubnet(subnet, onPrinter) {
  const queue = discoverySubnetHosts(subnet);
  if (!queue.length) return;
  const workers = Array.from({ length: Math.min(TCP_PROBE_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const host = queue.shift();
      const printer = await probeFlashForgeM115(host);
      if (printer) onPrinter(printer);
    }
  });
  await Promise.all(workers);
}

const MODERN_MODELS = new Map([
  [0x0023, 'Adventurer 5M'],
  [0x0024, 'Adventurer 5M Pro'],
  [0x0026, 'AD5X'],
  [0x0028, 'Creator 5'],
  [0x0029, 'Creator 5 Pro']
]);

function cleanString(buffer, start, end) {
  return buffer.toString('utf8', start, end).replace(/\0.*$/s, '').trim();
}

function statusName(code) {
  if (code === 0) return 'ready';
  if (code === 1) return 'busy';
  if (code === 2) return 'error';
  return 'unknown';
}

function modelFromModern(name, productId, productType) {
  if (MODERN_MODELS.has(productId)) return MODERN_MODELS.get(productId);
  const upper = String(name || '').toUpperCase();
  if (productType === 0x5a02 || upper.includes('ADVENTURER 5M') || upper.includes('AD5M')) {
    return upper.includes('PRO') ? 'Adventurer 5M Pro' : 'Adventurer 5M';
  }
  if (upper === 'AD5X') return 'AD5X';
  return 'Unknown';
}

function modelFromLegacy(name, productId) {
  const upper = String(name || '').toUpperCase();
  if (upper.includes('ADVENTURER 4') || upper.includes('ADVENTURER4') || upper.includes('AD4') || productId === 0x0016 || productId === 0x001e) {
    return 'Adventurer 4';
  }
  if (upper.includes('ADVENTURER 3') || upper.includes('ADVENTURER3') || upper.includes('AD3') || productId === 0x0008) {
    return 'Adventurer 3';
  }
  return 'Unknown';
}

export function parseDiscoveryResponse(buffer, remoteAddress) {
  if (!Buffer.isBuffer(buffer) || buffer.length < LEGACY_SIZE) return null;

  if (buffer.length >= MODERN_SIZE) {
    const name = cleanString(buffer, 0x00, 0x84);
    const commandPort = buffer.readUInt16BE(0x84);
    const vendorId = buffer.readUInt16BE(0x86);
    const productId = buffer.readUInt16BE(0x88);
    const statusCode = buffer.readUInt16BE(0x8a);
    const productType = buffer.readUInt16BE(0x8c);
    const eventPort = buffer.readUInt16BE(0x8e);
    const lanMode = buffer.readUInt8(0x90) === 1;
    const serialNumber = cleanString(buffer, 0x92, 0x92 + 128);

    const model = modelFromModern(name, productId, productType);
    const adapterType = ['Adventurer 5M', 'Adventurer 5M Pro'].includes(model)
      ? FLASHFORGE_AD5M_ADAPTER_TYPE
      : ['Creator 5', 'Creator 5 Pro'].includes(model)
        ? FLASHFORGE_CREATOR5_ADAPTER_TYPE
        : null;

    return {
      protocol: 'modern',
      adapterType,
      manufacturer: 'FlashForge',
      name: name || `FlashForge ${remoteAddress}`,
      host: remoteAddress,
      serialNumber,
      model,
      commandPort,
      httpPort: eventPort || 8898,
      cameraPort: 8080,
      vendorId,
      productId,
      productType,
      status: statusName(statusCode),
      lanMode
    };
  }

  const name = cleanString(buffer, 0x00, 0x80);
  const commandPort = buffer.readUInt16BE(0x84);
  const vendorId = buffer.readUInt16BE(0x86);
  const productId = buffer.readUInt16BE(0x88);
  const statusCode = buffer.readUInt16BE(0x8a);
  return {
    protocol: 'legacy',
    adapterType: null,
    manufacturer: 'FlashForge',
    name: name || `FlashForge ${remoteAddress}`,
    host: remoteAddress,
    serialNumber: '',
    model: modelFromLegacy(name, productId),
    commandPort,
    httpPort: null,
    cameraPort: null,
    vendorId,
    productId,
    productType: null,
    status: statusName(statusCode),
    lanMode: null
  };
}

function broadcastAddress(address, netmask) {
  const ip = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  if (ip.length !== 4 || mask.length !== 4 || [...ip, ...mask].some(Number.isNaN)) return null;
  return ip.map((octet, i) => ((octet & mask[i]) | ((~mask[i]) & 255)) & 255).join('.');
}

export function getBroadcastAddresses({ interfaces = networkInterfaces(), env = process.env } = {}) {
  const result = new Set(['255.255.255.255']);
  for (const group of Object.values(interfaces || {})) {
    for (const iface of group || []) {
      if (iface.family !== 'IPv4' || iface.internal || !iface.netmask) continue;
      const address = broadcastAddress(iface.address, iface.netmask);
      if (address) result.add(address);
    }
  }

  const configuredSubnet = configuredDiscoverySubnet(env);
  if (configuredSubnet?.broadcast) result.add(configuredSubnet.broadcast);

  return [...result];
}

export async function discoverPrinters({ timeoutMs = 4000, idleTimeoutMs = 1200, ports = DEFAULT_PORTS, env = process.env } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const printers = new Map();

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    socket.once('error', onError);
    socket.bind(0, () => {
      socket.off('error', onError);
      socket.setBroadcast(true);
      resolve();
    });
  });

  return new Promise((resolve) => {
    let idleTimer = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      try { socket.close(); } catch {}
      resolve([...printers.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, idleTimeoutMs);
    };

    socket.on('message', (buffer, rinfo) => {
      const printer = parseDiscoveryResponse(buffer, rinfo.address);
      if (!printer) return;
      const key = `${printer.host}:${printer.commandPort || printer.httpPort || ''}`;
      const previous = printers.get(key);
      if (!previous || printer.protocol === 'modern') printers.set(key, printer);
      resetIdle();
    });

    socket.on('error', (error) => {
      console.warn(`Discovery socket error: ${error.message}`);
    });

    try { socket.addMembership(MULTICAST_ADDRESS); } catch {}
    const packet = Buffer.alloc(0);

    for (const port of ports) {
      if (port === 8899 || port === 19000) {
        try { socket.send(packet, port, MULTICAST_ADDRESS); } catch {}
      }
    }

    for (const address of getBroadcastAddresses({ env })) {
      for (const port of ports) {
        try { socket.send(packet, port, address); } catch {}
      }
    }

    const configuredSubnet = configuredDiscoverySubnet(env);
    for (const address of discoverySubnetHosts(configuredSubnet)) {
      for (const port of ports) {
        try { socket.send(packet, port, address); } catch {}
      }
    }

    for (const port of ports) {
      try { socket.send(packet, port, '127.0.0.1'); } catch {}
    }

    if (configuredSubnet) {
      probeConfiguredFlashForgeSubnet(configuredSubnet, (printer) => {
        if (finished) return;
        const key = `${printer.host}:${printer.commandPort || printer.httpPort || ''}`;
        if (!printers.has(key)) printers.set(key, printer);
        resetIdle();
      }).catch((error) => {
        console.warn(`Configured FlashForge TCP discovery failed: ${error.message}`);
      });
    }

    const totalTimer = setTimeout(finish, timeoutMs);
    idleTimer = setTimeout(finish, idleTimeoutMs);
  });
}
