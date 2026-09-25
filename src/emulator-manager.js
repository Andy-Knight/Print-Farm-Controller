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

function definitionFromPrinter(printer) {
  return {
    profileId:String(printer.profileId || ''),
    name:String(printer.name || ''),
    ports:{ ...(printer.ports || {}) },
    serialNumber:String(printer.serialNumber || ''),
    checkCode:String(printer.checkCode || '')
  };
}

function sameDefinition(printer, definition) {
  if (String(printer.profileId || '') !== String(definition?.profileId || '')) return false;
  const ports = definition?.ports || {};
  for (const [key, value] of Object.entries(ports)) {
    if (Number(printer.ports?.[key]) !== Number(value)) return false;
  }
  const serial = String(definition?.serialNumber || '').trim();
  if (serial && serial !== String(printer.serialNumber || '').trim()) return false;
  return true;
}

function profileIdFromControllerConfig(config = {}) {
  const adapterType = String(config.adapterType || '').trim();
  const model = String(config.model || '').trim().toLowerCase();
  if (adapterType === 'flashforge-creator5') {
    return model.includes('pro') ? 'flashforge-creator-5-pro' : 'flashforge-creator-5';
  }
  if (adapterType === 'flashforge-ad5m') return 'flashforge-ad5m-pro';
  if (adapterType === 'snapmaker-u1') return 'snapmaker-u1';
  if (adapterType === 'bambu-lab') {
    if (model === 'p1p') return 'bambu-p1p';
    if (model === 'p1s') return 'bambu-p1s';
    if (model === 'x1c' || model.includes('x1 carbon')) return 'bambu-x1c';
    if (model === 'a1 mini' || model === 'a1-mini') return 'bambu-a1-mini';
  }
  return null;
}

function definitionFromControllerConfig(config = {}) {
  const profileId = profileIdFromControllerConfig(config);
  if (!profileId) return null;
  const ports = {};
  for (const key of ['httpPort','tcpPort','mqttPort','ftpsPort','cameraPort']) {
    const value = Number(config[key]);
    if (Number.isInteger(value) && value > 0 && value <= 65535) ports[key] = value;
  }
  return {
    profileId,
    name:String(config.name || '').trim() || undefined,
    ports,
    serialNumber:String(config.serialNumber || '').trim() || undefined,
    checkCode:String(config.checkCode || config.accessCode || '').trim() || undefined
  };
}

export class EmulatorManager {
  constructor({
    settingsPath = resolveControllerRuntimePaths().emulatorSettingsPath,
    host = '127.0.0.1',
    withDefaults = process.env.EMULATOR_NO_DEFAULTS !== '1',
    emulator = null,
    registeredPrintersProvider = null
  } = {}) {
    const runtimePaths = resolveControllerRuntimePaths();
    this.settingsPath = settingsPath;
    this.host = host;
    this.enabled = false;
    this.savedDefinitions = [];
    this.registeredPrintersProvider = typeof registeredPrintersProvider === 'function' ? registeredPrintersProvider : null;
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

  currentDefinitions() {
    return [...this.emulator.printers.values()].map(definitionFromPrinter);
  }

  async writeSettings({ capturePrinters = true } = {}) {
    if (capturePrinters && this.emulator.printers.size) this.savedDefinitions = this.currentDefinitions();
    await fs.mkdir(path.dirname(this.settingsPath), { recursive:true });
    const settings = {
      enabled:this.enabled,
      printers:this.savedDefinitions
    };
    const tempPath = `${this.settingsPath}.tmp-${process.pid}`;
    await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.settingsPath);
  }

  async restoreSavedDefinitions() {
    if (!this.emulator.running || !this.savedDefinitions.length) return;
    for (const definition of this.savedDefinitions) {
      if (!definition?.profileId) continue;
      if ([...this.emulator.printers.values()].some((printer) => sameDefinition(printer, definition))) continue;
      try {
        await this.emulator.addPrinter(definition);
      } catch (error) {
        console.warn(`Could not restore simulated printer ${definition.name || definition.profileId}: ${error.message}`);
      }
    }
  }

  async restoreRegisteredSimulatedPrinters() {
    if (!this.emulator.running || !this.registeredPrintersProvider) return;
    let configured = [];
    try {
      configured = await this.registeredPrintersProvider();
    } catch (error) {
      console.warn(`Could not inspect registered printers for simulator recovery: ${error.message}`);
      return;
    }
    for (const config of configured || []) {
      if (config?.simulated !== true) continue;
      if (this.isSimulatedConfig(config)) continue;
      const definition = definitionFromControllerConfig(config);
      if (!definition) continue;
      if ([...this.emulator.printers.values()].some((printer) => sameDefinition(printer, definition))) continue;
      try {
        await this.emulator.addPrinter(definition);
        console.log(`Recovered simulated printer definition: ${config.name || definition.profileId}`);
      } catch (error) {
        console.warn(`Could not recover simulated printer ${config.name || definition.profileId}: ${error.message}`);
      }
    }
  }

  async ensureRunningPrinters() {
    if (!this.emulator.running) await this.emulator.startProtocols();
    await this.restoreSavedDefinitions();
    await this.restoreRegisteredSimulatedPrinters();
    this.savedDefinitions = this.currentDefinitions();
  }

  async init() {
    try {
      const settings = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      this.enabled = settings.enabled === true;
      this.savedDefinitions = Array.isArray(settings.printers) ? settings.printers : [];
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn(`Could not read emulator settings: ${error.message}`);
    }
    if (process.env.CONTROLLER_EMULATOR_ENABLED === '1') this.enabled = true;
    if (this.enabled) {
      await this.ensureRunningPrinters();
      await this.writeSettings();
    }
    return this.snapshot();
  }

  async setEnabled(enabled) {
    const requested = enabled === true;
    if (requested) {
      this.enabled = true;
      await this.ensureRunningPrinters();
      await this.writeSettings();
      return this.snapshot();
    }

    if (this.emulator.running) {
      this.savedDefinitions = this.currentDefinitions();
      await this.emulator.stopProtocols();
    }
    this.enabled = false;
    await this.writeSettings({ capturePrinters:false });
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
    const definitionMutation = (
      (url.pathname === '/api/emulator/printers' && request.method === 'POST')
      || (/^\/api\/emulator\/printers\/[^/]+$/.test(url.pathname) && ['DELETE','PATCH','PUT'].includes(request.method))
    );
    const result = await this.emulator.handleApi(request, response, url, { basePath: '/api/emulator' });
    if (definitionMutation) {
      this.savedDefinitions = this.currentDefinitions();
      await this.writeSettings({ capturePrinters:false });
    }
    return result;
  }

  serveStatic(response, url) {
    return this.emulator.serveStatic(response, url, { basePath: '/simulator' });
  }

  async stop() {
    if (this.emulator.running) {
      this.savedDefinitions = this.currentDefinitions();
      await this.writeSettings({ capturePrinters:false }).catch(() => {});
    }
    await this.emulator.stop();
  }
}
