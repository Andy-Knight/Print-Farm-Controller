import { PrinterAdapter } from './printer-adapter.js';
import {
  getPrusaLinkFiles,
  getPrusaLinkStatus,
  printPrusaLinkFile,
  setPrusaLinkJobState,
  uploadPrusaLinkFile,
  verifyPrusaLinkFile
} from '../prusa-link-api.js';
import { prusaLinkToolConfiguration } from './prusa-link-models.js';

function cleanHost(host) {
  return String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/:\d+$/, '');
}

export function preparePrusaLinkConfig(profile, input = {}) {
  if (!profile) throw new Error('PrusaLink model profile is required');
  const name = String(input.name || '').trim();
  const host = cleanHost(input.host);
  const httpPort = Number(input.httpPort || profile.defaultHttpPort || 80);
  const existing = input.adapterConfig && typeof input.adapterConfig === 'object' ? input.adapterConfig : {};
  const username = String(input.prusaLinkUsername || existing.prusaLinkUsername || profile.defaultUsername || 'maker').trim() || 'maker';
  const password = String(input.prusaLinkPassword || existing.prusaLinkPassword || '').trim();
  const apiKey = String(input.apiKey || existing.apiKey || '').trim();
  const configuration = prusaLinkToolConfiguration(profile, input.toolCount ?? existing.toolCount ?? profile.defaultToolCount);

  if (!name || !host) throw new Error('name and host are required');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Host/IP contains invalid characters');
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) throw new Error('PrusaLink HTTP port must be 1-65535');
  if (!password && !apiKey) throw new Error('PrusaLink password or API key is required');

  return {
    name,
    host,
    httpPort,
    cameraPort:Number(input.cameraPort || 80),
    tcpPort:0,
    adapterType:profile.adapterType,
    manufacturer:profile.manufacturer,
    model:profile.model,
    serialNumber:String(input.serialNumber || '').trim(),
    checkCode:'',
    adapterConfig:{
      ...existing,
      prusaLinkUsername:username,
      toolCount:configuration.count,
      ...(password ? { prusaLinkPassword:password } : {}),
      ...(apiKey ? { apiKey } : {})
    }
  };
}

export class PrusaLinkAdapter extends PrinterAdapter {
  constructor(printer, profile) {
    super(printer);
    if (!profile) throw new Error('PrusaLink model profile is required');
    this.profile = profile;
  }

  get type() { return this.profile.adapterType; }
  get manufacturer() { return this.profile.manufacturer; }
  get model() { return this.profile.model; }
  get toolConfiguration() {
    return prusaLinkToolConfiguration(
      this.profile,
      this.printer?.adapterConfig?.toolCount ?? this.profile.defaultToolCount
    );
  }
  get toolCount() { return this.toolConfiguration.count; }
  get capabilities() {
    return Object.freeze({
      ...this.toolConfiguration.capabilities,
      toolConfiguration:this.profile.toolConfigurations.length > 1
    });
  }
  get uploadExtensions() { return [...this.profile.uploadExtensions]; }
  get limits() {
    return Object.freeze({
      ...this.toolConfiguration.limits,
      toolCount:this.toolCount,
      toolConfigurations:this.profile.toolConfigurations.map(({ count, label, mappingMode }) => ({ count, label, mappingMode }))
    });
  }

  async getStatus() { return getPrusaLinkStatus(this.printer); }
  async getFiles() { return getPrusaLinkFiles(this.printer); }

  async getPrintSetup(fileName) {
    if (this.toolConfiguration.mappingMode !== 'fixed-tool-index') return null;
    const status = await this.getStatus();
    return {
      fileName,
      mappingMode:'fixed-tool-index',
      logicalTools:[],
      referencedTools:[],
      physicalTools:(status.tools || []).map((tool) => ({
        index:tool.index,
        nozzleDiameter:tool.nozzleDiameter ?? null,
        filament:tool.filament ? { ...tool.filament } : null
      })),
      warning:this.profile.fixedToolWarning || 'Tool indices are fixed by the sliced file.'
    };
  }

  async uploadFile(filePath, options = {}) { return uploadPrusaLinkFile(this.printer, filePath, options); }
  async verifyFile(fileName) { return verifyPrusaLinkFile(this.printer, fileName); }

  async printLocalFile(fileName, options = {}) {
    if (this.toolConfiguration.mappingMode === 'fixed-tool-index') {
      const used = Array.isArray(options?.usedLogicalTools)
        ? options.usedLogicalTools.map(Number).filter(Number.isInteger)
        : [];
      if (used.some((index) => index < 0 || index >= this.toolCount)) {
        throw new Error(`Print references a tool outside this ${this.profile.model} ${this.toolCount}-tool configuration`);
      }
      if (options?.toolMap && typeof options.toolMap === 'object') {
        for (const [logical, physical] of Object.entries(options.toolMap)) {
          if (Number(logical) !== Number(physical)) {
            throw new Error(`${this.profile.model} uses fixed tool indices; remapping logical tools to different physical tools is not supported`);
          }
        }
      }
    }
    return printPrusaLinkFile(this.printer, fileName);
  }

  async setJobState(action) { return setPrusaLinkJobState(this.printer, action); }
}

export function createPrusaLinkAdapterDefinition(profile, { AdapterClass = PrusaLinkAdapter } = {}) {
  if (!profile) throw new Error('PrusaLink model profile is required');
  const defaultConfiguration = prusaLinkToolConfiguration(profile, profile.defaultToolCount);
  const configFields = [];

  if (profile.toolConfigurations.length > 1) {
    configFields.push({
      name:'toolCount',
      label:'Tool configuration',
      required:true,
      type:'select',
      defaultValue:profile.defaultToolCount,
      options:profile.toolConfigurations.map(({ count, label }) => ({ value:count, label })),
      help:`Choose the installed ${profile.model} tool system. Multi-tool configurations retain their sliced tool indices.`
    });
  }

  configFields.push(
    {
      name:'httpPort',
      label:'PrusaLink HTTP port',
      required:true,
      type:'number',
      defaultValue:profile.defaultHttpPort || 80,
      min:1,
      max:65535,
      help:`${profile.model} normally exposes PrusaLink on this local HTTP port.`
    },
    {
      name:'prusaLinkUsername',
      label:'PrusaLink username',
      required:false,
      defaultValue:profile.defaultUsername || 'maker',
      placeholder:profile.defaultUsername || 'maker',
      help:'Shown on the printer under Settings → Network → PrusaLink.'
    },
    {
      name:'prusaLinkPassword',
      label:'PrusaLink password',
      required:false,
      secret:true,
      placeholder:'Printer PrusaLink password',
      help:'Enter the local PrusaLink password shown on the printer. This remains in the controller backend and is not exposed to browsers.'
    },
    {
      name:'apiKey',
      label:'PrusaLink API key (optional alternative)',
      required:false,
      secret:true,
      placeholder:'Optional API key',
      help:'If the printer firmware exposes an API key, it can be used instead of the PrusaLink password.'
    }
  );

  return Object.freeze({
    type:profile.adapterType,
    manufacturer:profile.manufacturer,
    label:profile.label,
    models:[profile.model],
    capabilities:Object.freeze({
      ...defaultConfiguration.capabilities,
      toolConfiguration:profile.toolConfigurations.length > 1
    }),
    configFields,
    prepareConfig:(input) => preparePrusaLinkConfig(profile, input),
    create:(printer) => new AdapterClass(printer, profile)
  });
}
