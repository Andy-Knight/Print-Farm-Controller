import { PrinterAdapter, normalizeCapabilities } from './printer-adapter.js';
import {
  getPrusaLinkFiles,
  getPrusaLinkStatus,
  printPrusaLinkFile,
  setPrusaLinkJobState,
  uploadPrusaLinkFile,
  verifyPrusaLinkFile
} from '../prusa-link-api.js';

export const PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE = 'prusa-core-one-plus';
export const PRUSA_CORE_ONE_PLUS_TOOL_COUNTS = Object.freeze([1, 4, 8]);

function normalizeToolCount(value) {
  const count = Number(value || 1);
  if (!PRUSA_CORE_ONE_PLUS_TOOL_COUNTS.includes(count)) throw new Error('CORE One+ tool configuration must be 1, 4 or 8 tools');
  return count;
}

function cleanHost(host) {
  return String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/:\d+$/, '');
}

export function preparePrusaCoreOnePlusConfig(input = {}) {
  const name = String(input.name || '').trim();
  const host = cleanHost(input.host);
  const httpPort = Number(input.httpPort || 80);
  const username = String(input.prusaLinkUsername || input.adapterConfig?.prusaLinkUsername || 'maker').trim() || 'maker';
  const password = String(input.prusaLinkPassword || input.adapterConfig?.prusaLinkPassword || '').trim();
  const apiKey = String(input.apiKey || input.adapterConfig?.apiKey || '').trim();
  const toolCount = normalizeToolCount(input.toolCount || input.adapterConfig?.toolCount || 1);

  if (!name || !host) throw new Error('name and host are required');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error('Host/IP contains invalid characters');
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) throw new Error('PrusaLink HTTP port must be 1-65535');
  if (!password && !apiKey) throw new Error('PrusaLink password or API key is required');

  return {
    name,
    host,
    httpPort,
    cameraPort:80,
    tcpPort:0,
    adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
    manufacturer:'Prusa',
    model:'CORE One+',
    serialNumber:String(input.serialNumber || '').trim(),
    checkCode:'',
    adapterConfig:{
      prusaLinkUsername:username,
      toolCount,
      ...(password ? { prusaLinkPassword:password } : {}),
      ...(apiKey ? { apiKey } : {})
    }
  };
}

const SINGLE_TOOL_CAPABILITIES = normalizeCapabilities({
  status:true,
  localFiles:true,
  fileUpload:true,
  printLocalFile:true,
  jobControl:true,
  materialStatus:true,
  materialDesignation:true,
  nozzleDesignation:true,
  toolheadNozzleStatus:true
});

const INDX_CAPABILITIES = normalizeCapabilities({
  status:true,
  localFiles:true,
  fileUpload:true,
  printLocalFile:true,
  jobControl:true,
  materialStatus:true,
  fixedToolMapping:true,
  toolheadNozzleStatus:true
});

export class PrusaCoreOnePlusAdapter extends PrinterAdapter {
  get type() { return PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE; }
  get manufacturer() { return 'Prusa'; }
  get model() { return 'CORE One+'; }
  get toolCount() { return normalizeToolCount(this.printer?.adapterConfig?.toolCount || 1); }
  get capabilities() { return this.toolCount > 1 ? INDX_CAPABILITIES : SINGLE_TOOL_CAPABILITIES; }
  get uploadExtensions() { return ['.gcode', '.bgcode']; }
  get limits() {
    const indx = this.toolCount > 1;
    return Object.freeze({
      bedTemperature:{ min:0, max:120 },
      nozzleTemperature:{ min:0, max:indx ? 300 : 290 },
      chamberTemperature:{ min:0, max:55 },
      toolCount:this.toolCount,
      buildVolume:indx ? { x:248, y:205, z:270 } : { x:250, y:220, z:270 }
    });
  }

  async getStatus() { return getPrusaLinkStatus(this.printer); }
  async getFiles() { return getPrusaLinkFiles(this.printer); }
  async getPrintSetup(fileName) {
    if (this.toolCount <= 1) return null;
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
      warning:'CORE One+ INDX tool indices are fixed by the sliced file. Print Farm Controller validates T0→T0, T1→T1 and so on; it does not remap a sliced tool to a different physical INDX tool.'
    };
  }
  async uploadFile(filePath, options = {}) { return uploadPrusaLinkFile(this.printer, filePath, options); }
  async verifyFile(fileName) { return verifyPrusaLinkFile(this.printer, fileName); }
  async printLocalFile(fileName, options = {}) {
    const used = Array.isArray(options?.usedLogicalTools) ? options.usedLogicalTools.map(Number).filter(Number.isInteger) : [];
    if (used.some((index) => index < 0 || index >= this.toolCount)) {
      throw new Error(`Print references a tool outside this CORE One+ ${this.toolCount}-tool configuration`);
    }
    if (options?.toolMap && typeof options.toolMap === 'object') {
      for (const [logical, physical] of Object.entries(options.toolMap)) {
        if (Number(logical) !== Number(physical)) {
          throw new Error('CORE One+ INDX uses fixed tool indices; remapping logical tools to different physical tools is not supported');
        }
      }
    }
    return printPrusaLinkFile(this.printer, fileName);
  }
  async setJobState(action) { return setPrusaLinkJobState(this.printer, action); }
}

export const prusaCoreOnePlusAdapterDefinition = Object.freeze({
  type:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
  manufacturer:'Prusa',
  label:'Prusa CORE One+',
  models:['CORE One+'],
  capabilities:SINGLE_TOOL_CAPABILITIES,
  configFields:[
    {
      name:'toolCount',
      label:'Tool configuration',
      required:true,
      type:'select',
      defaultValue:1,
      options:[
        { value:1, label:'Standard · 1 tool' },
        { value:4, label:'INDX · 4 tools' },
        { value:8, label:'INDX · 8 tools' }
      ],
      help:'Choose the installed CORE One+ tool system. INDX configurations use fixed sliced tool indices (T0→T0, T1→T1, etc.).'
    },
    {
      name:'httpPort',
      label:'PrusaLink HTTP port',
      required:true,
      type:'number',
      defaultValue:80,
      min:1,
      max:65535,
      help:'CORE One+ normally exposes PrusaLink on port 80.'
    },
    {
      name:'prusaLinkUsername',
      label:'PrusaLink username',
      required:false,
      defaultValue:'maker',
      placeholder:'maker',
      help:'Shown on the printer under Settings → Network → PrusaLink. The default on current firmware is normally maker.'
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
      help:'If your firmware exposes an API key, it can be used instead of the PrusaLink password.'
    }
  ],
  prepareConfig:preparePrusaCoreOnePlusConfig,
  create:(printer) => new PrusaCoreOnePlusAdapter(printer)
});
