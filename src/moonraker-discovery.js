import os from 'node:os';
import { moonrakerRequest, isSnapmakerU1ObjectList } from './moonraker-api.js';

const DEFAULT_PORTS = [7125, 80];
const DEFAULT_TIMEOUT_MS = 260;
const DEFAULT_CONCURRENCY = 64;

function isPrivateIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function localDiscoveryCandidates(interfaces = os.networkInterfaces()) {
  const candidates = new Set();
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIpv4(entry.address)) continue;
      const parts = entry.address.split('.').map(Number);
      // U1 installations are overwhelmingly on home/office LANs. A bounded /24
      // scan avoids sweeping large corporate networks while covering the normal
      // local subnet even when OS netmask metadata is unavailable/inconsistent.
      for (let host = 1; host <= 254; host++) {
        const ip = `${parts[0]}.${parts[1]}.${parts[2]}.${host}`;
        if (ip !== entry.address) candidates.add(ip);
      }
    }
  }
  return [...candidates];
}

async function requestWithShortTimeout(printer, endpoint, timeoutMs) {
  return moonrakerRequest(printer, endpoint, { timeoutMs });
}

export async function probeSnapmakerU1(host, {
  ports = DEFAULT_PORTS,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  for (const port of ports) {
    const printer = { host, httpPort: port, adapterConfig: {} };
    try {
      const serverInfo = await requestWithShortTimeout(printer, '/server/info', timeoutMs);
      const objectsResult = await requestWithShortTimeout(printer, '/printer/objects/list', timeoutMs + 120);
      const objects = Array.isArray(objectsResult?.objects) ? objectsResult.objects : (Array.isArray(objectsResult) ? objectsResult : []);
      if (!isSnapmakerU1ObjectList(objects)) continue;
      const printerInfo = await requestWithShortTimeout(printer, '/printer/info', timeoutMs + 120).catch(() => ({}));
      const hostname = String(printerInfo?.hostname || serverInfo?.hostname || '').trim();
      return {
        name: hostname || 'Snapmaker U1',
        host,
        httpPort: port,
        adapterType: 'snapmaker-u1',
        manufacturer: 'Snapmaker',
        model: 'U1',
        serialNumber: '',
        moonrakerVersion: serverInfo?.moonraker_version || null,
        firmwareVersion: printerInfo?.software_version || null
      };
    } catch {
      // This host/port is not a reachable compatible Moonraker instance.
    }
  }
  return null;
}

export async function discoverSnapmakerU1({
  candidates = localDiscoveryCandidates(),
  concurrency = DEFAULT_CONCURRENCY,
  probe = probeSnapmakerU1
} = {}) {
  const queue = [...new Set(candidates)];
  const results = [];
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), queue.length || 1) }, async () => {
    while (queue.length) {
      const host = queue.shift();
      const result = await probe(host);
      if (result) results.push(result);
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}
