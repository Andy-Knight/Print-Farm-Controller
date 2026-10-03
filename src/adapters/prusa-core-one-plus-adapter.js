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
      ...(password ? { prusaLinkPassword:password } : {}),
      ...(apiKey ? { apiKey } : {})
    }
  };
}

const CAPABILITIES = normalizeCapabilities({
  status:true,
  localFiles:true,
  fileUpload:true,
  printLocalFile:true,
  jobControl:true,
  materialStatus:true,
  materialDesignation:true,
  nozzleDesignation:true
});

export class PrusaCoreOnePlusAdapter extends PrinterAdapter {
  get type() { return PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE; }
  get manufacturer() { return 'Prusa'; }
  get model() { return 'CORE One+'; }
  get capabilities() { return CAPABILITIES; }
  get uploadExtensions() { return ['.gcode', '.bgcode']; }
  get limits() {
    return Object.freeze({
      bedTemperature:{ min:0, max:120 },
      nozzleTemperature:{ min:0, max:290 },
      chamberTemperature:{ min:0, max:55 },
      toolCount:1,
      buildVolume:{ x:250, y:220, z:270 }
    });
  }

  async getStatus() { return getPrusaLinkStatus(this.printer); }
  async getFiles() { return getPrusaLinkFiles(this.printer); }
  async uploadFile(filePath, options = {}) { return uploadPrusaLinkFile(this.printer, filePath, options); }
  async verifyFile(fileName) { return verifyPrusaLinkFile(this.printer, fileName); }
  async printLocalFile(fileName) { return printPrusaLinkFile(this.printer, fileName); }
  async setJobState(action) { return setPrusaLinkJobState(this.printer, action); }
}

export const prusaCoreOnePlusAdapterDefinition = Object.freeze({
  type:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
  manufacturer:'Prusa',
  label:'Prusa CORE One+',
  models:['CORE One+'],
  capabilities:CAPABILITIES,
  configFields:[
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
