import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { allocatePorts, getProfile, listProfiles } from './profiles.js';
import { startProtocolEndpoints } from './protocols.js';
import { VirtualPrinter } from './virtual-printer.js';
import { resolveControllerRuntimePaths } from '../src/runtime-paths.js';
import { emulatorPublicAssetKey, readRuntimeAsset } from '../src/runtime-assets.js';

const runtimePaths = resolveControllerRuntimePaths();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function json(response, status, body) {
  const content = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': content.length,
    'cache-control': 'no-store'
  });
  response.end(content);
}

async function jsonBody(request, limit = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function controllerSettings(printer) {
  const common = {
    name: printer.name,
    adapterType: printer.adapterType,
    host: printer.host,
    simulated: true
  };
  if (printer.adapterType === 'flashforge-ad5m') {
    return {
      ...common,
      model: printer.model,
      serialNumber: printer.serialNumber,
      checkCode: printer.checkCode,
      httpPort: printer.ports.httpPort,
      tcpPort: printer.ports.tcpPort,
      cameraPort: printer.ports.cameraPort
    };
  }
  if (printer.adapterType === 'flashforge-creator5') {
    return {
      ...common,
      model: printer.model,
      serialNumber: printer.serialNumber,
      checkCode: printer.checkCode,
      httpPort: printer.ports.httpPort,
      cameraPort: printer.ports.cameraPort
    };
  }
  if (printer.adapterType === 'bambu-lab') {
    return {
      ...common,
      model: printer.model,
      serialNumber: printer.serialNumber,
      accessCode: printer.checkCode,
      mqttPort: printer.ports.mqttPort,
      ftpsPort: printer.ports.ftpsPort,
      cameraPort: printer.ports.cameraPort,
      tls: true,
      protocolStatus: 'simulated-unverified'
    };
  }
  return { ...common, model: printer.model, httpPort: printer.ports.httpPort };
}

export function createEmulator({
  host = process.env.EMULATOR_HOST || '127.0.0.1',
  managementPort = Number(process.env.EMULATOR_PORT || 4250),
  withDefaults = process.env.EMULATOR_NO_DEFAULTS !== '1',
  publicDir = runtimePaths.emulatorPublicDir,
  assetsDir = runtimePaths.emulatorAssetsDir
} = {}) {
  const printers = new Map();
  const endpointHandles = new Map();
  const sseClients = new Set();
  let managementServer = null;
  let protocolsStarted = false;
  let nextId = 1;

  const serializePrinter = (printer) => ({ ...printer.snapshot(), controllerSettings: controllerSettings(printer) });
  const broadcast = () => {
    const payload = `data: ${JSON.stringify({ printers: [...printers.values()].map(serializePrinter) })}\n\n`;
    for (const client of sseClients) client.write(payload);
  };

  async function addPrinter(input = {}) {
    const profile = getProfile(input.profileId);
    if (!profile) throw new Error(`Unknown printer profile: ${input.profileId}`);
    const id = String(input.id || `sim-${nextId++}`);
    if (printers.has(id)) throw new Error(`A simulated printer named ${id} already exists`);
    const ports = { ...allocatePorts(profile, [...printers.values()]), ...(input.ports || {}) };
    const printer = new VirtualPrinter({
      id,
      profile,
      name: input.name,
      host,
      ports,
      serialNumber: input.serialNumber,
      checkCode: input.checkCode
    });
    printer.on('change', broadcast);
    try {
      const endpoints = await startProtocolEndpoints(printer, { assetsDir });
      endpointHandles.set(id, endpoints);
      printers.set(id, printer);
      broadcast();
      return serializePrinter(printer);
    } catch (error) {
      printer.close();
      throw new Error(`Could not start ${printer.name}: ${error.message}`);
    }
  }

  async function removePrinter(id) {
    const printer = printers.get(id);
    if (!printer) return false;
    await endpointHandles.get(id)?.close();
    endpointHandles.delete(id);
    printers.delete(id);
    printer.close();
    broadcast();
    return true;
  }

  function printerFor(id) {
    const printer = printers.get(id);
    if (!printer) throw Object.assign(new Error('Simulated printer not found'), { status: 404 });
    return printer;
  }

  async function api(request, response, url, { basePath = '/api' } = {}) {
    const pathname = url.pathname.startsWith(basePath) ? `/api${url.pathname.slice(basePath.length)}` : url.pathname;
    if (pathname === '/api/profiles' && request.method === 'GET') return json(response, 200, { profiles: listProfiles() });
    if (pathname === '/api/printers' && request.method === 'GET') return json(response, 200, { printers: [...printers.values()].map(serializePrinter) });
    if (pathname === '/api/printers' && request.method === 'POST') return json(response, 201, { printer: await addPrinter(await jsonBody(request)) });
    if (pathname === '/api/events' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      sseClients.add(response);
      response.write(`data: ${JSON.stringify({ printers: [...printers.values()].map(serializePrinter) })}\n\n`);
      request.on('close', () => sseClients.delete(response));
      return;
    }

    const match = pathname.match(/^\/api\/printers\/([^/]+)(?:\/(actions|faults|scenarios|files))?$/);
    if (!match) return json(response, 404, { error: 'Not found' });
    const id = decodeURIComponent(match[1]);
    const section = match[2] || null;
    if (!section && request.method === 'DELETE') return json(response, (await removePrinter(id)) ? 200 : 404, { removed: !printers.has(id) });
    const printer = printerFor(id);
    const body = request.method === 'GET' ? {} : await jsonBody(request);
    if (!section && ['PATCH', 'PUT'].includes(request.method)) printer.configure(body);
    else if (section === 'actions' && request.method === 'POST') printer.action(body.action, body);
    else if (section === 'faults' && ['PATCH', 'PUT', 'POST'].includes(request.method)) printer.setFaults(body);
    else if (section === 'scenarios' && request.method === 'POST') printer.runScenario(body.scenario);
    else if (section === 'files' && request.method === 'POST') printer.addFile(body.fileName, { size: body.size, content: body.content });
    else if (section === 'files' && request.method === 'DELETE') printer.removeFile(body.fileName);
    else return json(response, 405, { error: 'Unsupported operation' });
    return json(response, 200, { printer: serializePrinter(printer) });
  }

  async function staticFile(response, url, { basePath = '/' } = {}) {
    const pathname = basePath === '/' ? url.pathname : url.pathname.slice(basePath.length);
    const requested = !pathname || pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const relative = path.posix.normalize(String(requested).replaceAll('\\', '/'));
    if (!relative || relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
      return json(response, 403, { error: 'Forbidden' });
    }
    const sourcePath = publicDir ? path.join(publicDir, ...relative.split('/')) : null;
    try {
      const content = await readRuntimeAsset({
        key:emulatorPublicAssetKey(relative),
        filePath:sourcePath
      });
      response.writeHead(200, { 'content-type': MIME[path.extname(relative)] || 'application/octet-stream', 'content-length': content.length });
      response.end(content);
    } catch {
      json(response, 404, { error: 'Not found' });
    }
  }

  async function startProtocols() {
    if (protocolsStarted) return;
    protocolsStarted = true;
    try {
      if (withDefaults && printers.size === 0) {
        await addPrinter({ profileId: 'flashforge-ad5m-pro', name: 'Simulated AD5M Pro' });
        await addPrinter({ profileId: 'snapmaker-u1', name: 'Simulated Snapmaker U1' });
        await addPrinter({ profileId: 'bambu-p1p', name: 'Simulated Bambu Lab P1P' });
        await addPrinter({ profileId: 'bambu-p1s', name: 'Simulated Bambu Lab P1S' });
        await addPrinter({ profileId: 'bambu-x1c', name: 'Simulated Bambu Lab X1 Carbon' });
        await addPrinter({ profileId: 'bambu-a1-mini', name: 'Simulated Bambu Lab A1 Mini' });
      }
    } catch (error) {
      protocolsStarted = false;
      for (const id of [...printers.keys()]) await removePrinter(id);
      throw error;
    }
  }

  async function stopProtocols() {
    for (const id of [...printers.keys()]) await removePrinter(id);
    for (const client of sseClients) client.end();
    sseClients.clear();
    protocolsStarted = false;
  }

  async function start() {
    if (managementServer) return managementServer.address();
    managementServer = http.createServer(async (request, response) => {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      try {
        if (url.pathname.startsWith('/api/')) await api(request, response, url);
        else await staticFile(response, url);
      } catch (error) {
        json(response, Number(error.status || 400), { error: error.message });
      }
    });
    await new Promise((resolve, reject) => {
      managementServer.once('error', reject);
      managementServer.listen(managementPort, host, resolve);
    });
    await startProtocols();
    return managementServer.address();
  }

  async function stop() {
    await stopProtocols();
    if (managementServer) await new Promise((resolve) => managementServer.close(resolve));
    managementServer = null;
  }

  return {
    start,
    stop,
    startProtocols,
    stopProtocols,
    handleApi: api,
    serveStatic: staticFile,
    addPrinter,
    removePrinter,
    printers,
    get running() { return protocolsStarted; },
    get managementServer() { return managementServer; }
  };
}

const standaloneEntry = runtimePaths.sourceRoot ? path.join(runtimePaths.sourceRoot, 'emulator', 'server.js') : null;
const isEntryPoint = Boolean(standaloneEntry && process.argv[1] && path.resolve(process.argv[1]) === standaloneEntry);
if (isEntryPoint) {
  const emulator = createEmulator();
  emulator.start().then((address) => {
    console.log(`Printer Emulator running at http://${address.address}:${address.port}`);
    console.log('The emulator is bound to loopback by default and is not exposed to the LAN.');
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  const shutdown = async () => {
    await emulator.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
