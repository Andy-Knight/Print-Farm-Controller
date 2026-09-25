import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createEmulator } from '../emulator/server.js';
import { resolveControllerRuntimePaths } from './runtime-paths.js';

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class EmulatorManager {
  constructor({
    settingsPath = resolveControllerRuntimePaths().emulatorSettingsPath,
    host = '127.0.0.1',
    withDefaults = process.env.EMULATOR_NO_DEFAULTS !== '1',
    emulator = null
  } = {}) {
    const runtimePaths = resolveControllerRuntimePaths();
    this.settingsPath = settingsPath;
    this.host = host;
    this.enabled = false;
    this.emulator = emulator || createEmulator({
      host,
      withDefaults,
      publicDir:runtimePaths.emulatorPublicDir,
      assetsDir:runtimePaths.emulatorAssetsDir
    });
  }

  snapshot() {
    return {
      available: true,
      enabled: this.enabled,
      running: this.emulator.running,
      host: this.host,
      loopbackOnly: true,
      printerCount: this.emulator.printers.size
    };
  }

  async init() {
    try {
      const settings = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      this.enabled = settings.enabled === true;
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn(`Could not read emulator settings: ${error.message}`);
    }
    if (process.env.CONTROLLER_EMULATOR_ENABLED === '1') this.enabled = true;
    if (this.enabled) await this.emulator.startProtocols();
    return this.snapshot();
  }

  async setEnabled(enabled) {
    const requested = enabled === true;
    if (requested && !this.emulator.running) await this.emulator.startProtocols();
    if (!requested && this.emulator.running) await this.emulator.stopProtocols();
    this.enabled = requested;
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, `${JSON.stringify({ enabled: this.enabled }, null, 2)}\n`, 'utf8');
    return this.snapshot();
  }

  isSimulatedConfig(config = {}) {
    const host = String(config.host || '').trim().toLowerCase();
    const adapterType = String(config.adapterType || '').trim();
    if (!host || !adapterType) return false;
    for (const printer of this.emulator.printers.values()) {
      if (String(printer.adapterType || '') !== adapterType) continue;
      if (String(printer.host || '').trim().toLowerCase() !== host) continue;
      const ports = printer.ports || {};
      const serial = String(config.serialNumber || '').trim();
      if (serial && printer.serialNumber && serial !== String(printer.serialNumber)) continue;
      if (adapterType === 'flashforge-ad5m') {
        if (Number(config.httpPort || 8898) === Number(ports.httpPort)
          && Number(config.tcpPort || config.commandPort || 8899) === Number(ports.tcpPort)) return true;
      } else if (adapterType === 'flashforge-creator5') {
        if (Number(config.httpPort || 8898) === Number(ports.httpPort)) return true;
      } else if (adapterType === 'bambu-lab') {
        if (Number(config.mqttPort || 8883) === Number(ports.mqttPort)
          && Number(config.ftpsPort || 990) === Number(ports.ftpsPort)) return true;
      } else if (adapterType === 'snapmaker-u1') {
        if (Number(config.httpPort || 7125) === Number(ports.httpPort)) return true;
      }
    }
    return false;
  }

  async handleApi(request, response, url) {
    if (url.pathname === '/api/emulator/status') {
      if (request.method === 'GET') return json(response, 200, this.snapshot());
      if (['POST', 'PUT'].includes(request.method)) {
        const body = await readJson(request);
        return json(response, 200, await this.setEnabled(body.enabled === true));
      }
      return json(response, 405, { error: 'Unsupported operation' });
    }
    if (!this.enabled || !this.emulator.running) {
      return json(response, 503, { error: 'Printer simulator is disabled' });
    }
    return this.emulator.handleApi(request, response, url, { basePath: '/api/emulator' });
  }

  serveStatic(response, url) {
    return this.emulator.serveStatic(response, url, { basePath: '/simulator' });
  }

  async stop() {
    await this.emulator.stop();
  }
}
