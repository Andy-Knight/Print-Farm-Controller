import { normalizeCapabilities } from './printer-adapter.js';

export const PRUSA_LINK_COMMON_CAPABILITIES = Object.freeze({
  status:true,
  localFiles:true,
  fileUpload:true,
  printLocalFile:true,
  jobControl:true,
  materialStatus:true,
  toolheadNozzleStatus:true
});

function toolConfiguration({ count, label, mappingMode = 'single', limits = {}, capabilities = {} }) {
  return Object.freeze({
    count:Number(count),
    label:String(label),
    mappingMode,
    limits:Object.freeze({ ...limits, toolCount:Number(count) }),
    capabilities:normalizeCapabilities({
      ...PRUSA_LINK_COMMON_CAPABILITIES,
      ...capabilities
    })
  });
}

export const PRUSA_CORE_ONE_PLUS_PROFILE = Object.freeze({
  id:'core-one-plus',
  adapterType:'prusa-core-one-plus',
  manufacturer:'Prusa',
  model:'CORE One+',
  label:'Prusa CORE One+',
  defaultHttpPort:80,
  defaultUsername:'maker',
  uploadExtensions:Object.freeze(['.gcode', '.bgcode']),
  defaultToolCount:1,
  toolConfigurations:Object.freeze([
    toolConfiguration({
      count:1,
      label:'Standard · 1 tool',
      limits:{
        bedTemperature:{ min:0, max:120 },
        nozzleTemperature:{ min:0, max:290 },
        chamberTemperature:{ min:0, max:55 },
        buildVolume:{ x:250, y:220, z:270 }
      },
      capabilities:{
        materialDesignation:true,
        nozzleDesignation:true
      }
    }),
    toolConfiguration({
      count:4,
      label:'INDX · 4 tools',
      mappingMode:'fixed-tool-index',
      limits:{
        bedTemperature:{ min:0, max:120 },
        nozzleTemperature:{ min:0, max:300 },
        chamberTemperature:{ min:0, max:55 },
        buildVolume:{ x:248, y:205, z:270 }
      },
      capabilities:{ fixedToolMapping:true }
    }),
    toolConfiguration({
      count:8,
      label:'INDX · 8 tools',
      mappingMode:'fixed-tool-index',
      limits:{
        bedTemperature:{ min:0, max:120 },
        nozzleTemperature:{ min:0, max:300 },
        chamberTemperature:{ min:0, max:55 },
        buildVolume:{ x:248, y:205, z:270 }
      },
      capabilities:{ fixedToolMapping:true }
    })
  ]),
  fixedToolWarning:'INDX tool indices are fixed by the sliced file. Print Farm Controller validates T0→T0, T1→T1 and so on; it does not remap a sliced tool to a different physical INDX tool.'
});

const profiles = new Map([
  [PRUSA_CORE_ONE_PLUS_PROFILE.adapterType, PRUSA_CORE_ONE_PLUS_PROFILE]
]);

export function getPrusaLinkModelProfile(adapterType) {
  return profiles.get(String(adapterType || '')) || null;
}

export function listPrusaLinkModelProfiles() {
  return [...profiles.values()];
}

export function prusaLinkToolConfiguration(profile, value = undefined) {
  if (!profile) throw new Error('PrusaLink model profile is required');
  const count = Number(value ?? profile.defaultToolCount ?? 1);
  const configuration = profile.toolConfigurations.find((item) => item.count === count);
  if (!configuration) {
    const supported = profile.toolConfigurations.map((item) => item.count).join(', ');
    throw new Error(`${profile.model} tool configuration must be one of: ${supported}`);
  }
  return configuration;
}
