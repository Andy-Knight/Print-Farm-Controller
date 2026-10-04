import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
  getPrinterAdapter,
  listAdapterDefinitions,
  preparePrinterConfig
} from '../src/adapters/adapter-registry.js';
import { prusaLinkInternals } from '../src/prusa-link-api.js';
import { createPrusaLinkAdapterDefinition, PrusaLinkAdapter } from '../src/adapters/prusa-link-adapter.js';
import { PRUSA_CORE_ONE_PLUS_PROFILE, listPrusaLinkModelProfiles } from '../src/adapters/prusa-link-models.js';
import { normalizeCapabilities } from '../src/adapters/printer-adapter.js';

test('Prusa CORE One+ is registered with safe first-pass local capabilities', () => {
  const definition = listAdapterDefinitions().find((item) => item.type === PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE);
  assert.ok(definition);
  assert.equal(definition.manufacturer, 'Prusa');
  assert.deepEqual(definition.models, ['CORE One+']);
  assert.equal(definition.discovery, false);
  assert.equal(definition.experimental, true);
  assert.equal(definition.capabilities.toolConfiguration, true);
  assert.deepEqual(definition.configFields.find((field) => field.name === 'toolCount').options.map((item) => item.value), [1,4,8]);

  const config = preparePrinterConfig({
    adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
    name:'CORE One+',
    host:'http://192.168.1.70/',
    prusaLinkPassword:'secret'
  });
  assert.equal(config.host, '192.168.1.70');
  assert.equal(config.httpPort, 80);
  assert.equal(config.model, 'CORE One+');
  assert.equal(config.adapterConfig.prusaLinkUsername, 'maker');
  assert.equal(config.adapterConfig.prusaLinkPassword, 'secret');
  assert.equal(config.adapterConfig.toolCount, 1);

  const adapter = getPrinterAdapter(config);
  assert.equal(adapter.capabilities.status, true);
  assert.equal(adapter.capabilities.localFiles, true);
  assert.equal(adapter.capabilities.fileUpload, true);
  assert.equal(adapter.capabilities.printLocalFile, true);
  assert.equal(adapter.capabilities.jobControl, true);
  assert.equal(adapter.capabilities.nozzleTemperature, false);
  assert.equal(adapter.capabilities.bedTemperature, false);
  assert.equal(adapter.capabilities.camera, false);
  assert.equal(adapter.capabilities.chamberTemperatureControl, false);
  assert.equal(adapter.capabilities.materialDesignation, true);
  assert.equal(adapter.capabilities.toolMaterialDesignation, true);
  assert.equal(adapter.capabilities.nozzleDesignation, true);
  assert.equal(adapter.capabilities.fixedToolMapping, false);
  assert.equal(adapter.capabilities.toolheadNozzleStatus, true);
  assert.deepEqual(adapter.uploadExtensions, ['.gcode', '.bgcode']);
  assert.equal(adapter.limits.nozzleTemperature.max, 290);
  assert.equal(adapter.limits.bedTemperature.max, 120);
  assert.equal(adapter.limits.chamberTemperature.max, 55);
  assert.equal(adapter.limits.toolCount, 1);
  assert.deepEqual(adapter.limits.nozzleDiameters, [0.25, 0.4, 0.5, 0.6, 0.8, 1.0]);
  assert.deepEqual(adapter.limits.buildVolume, { x:250, y:220, z:270 });
});

test('Prusa CORE One+ supports Standard, INDX 4-tool and INDX 8-tool configurations', () => {
  for (const toolCount of [4, 8]) {
    const config = preparePrinterConfig({
      adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
      name:`CORE One+ INDX ${toolCount}`,
      host:'192.168.1.71',
      prusaLinkPassword:'secret',
      toolCount
    });
    assert.equal(config.adapterConfig.toolCount, toolCount);
    const adapter = getPrinterAdapter(config);
    assert.equal(adapter.limits.toolCount, toolCount);
    assert.equal(adapter.limits.nozzleTemperature.max, 300);
    assert.deepEqual(adapter.limits.nozzleDiameters, [0.25, 0.4, 0.5, 0.6, 0.8, 1.0]);
    assert.deepEqual(adapter.limits.buildVolume, { x:248, y:205, z:270 });
    assert.equal(adapter.capabilities.fixedToolMapping, true);
    assert.equal(adapter.capabilities.printToolMapping, false);
    assert.equal(adapter.capabilities.materialDesignation, false);
    assert.equal(adapter.capabilities.toolMaterialDesignation, true);
    assert.equal(adapter.capabilities.nozzleDesignation, false);
  }

  assert.throws(() => preparePrinterConfig({
    adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
    name:'Invalid CORE One+',
    host:'192.168.1.72',
    prusaLinkPassword:'secret',
    toolCount:2
  }), /one of: 1, 4, 8/);
});

test('Prusa CORE One+ requires local PrusaLink credentials', () => {
  assert.throws(() => preparePrinterConfig({
    adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
    name:'CORE One+',
    host:'192.168.1.70'
  }), /password or API key/);

  const config = preparePrinterConfig({
    adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
    name:'CORE One+',
    host:'192.168.1.70',
    apiKey:'api-key'
  });
  assert.equal(config.adapterConfig.apiKey, 'api-key');
  assert.equal(config.adapterConfig.prusaLinkPassword, undefined);
});

test('PrusaLink state mapping matches controller queue state semantics', () => {
  const { normalizeState } = prusaLinkInternals;
  assert.equal(normalizeState('IDLE'), 'idle');
  assert.equal(normalizeState('READY'), 'idle');
  assert.equal(normalizeState('BUSY'), 'working');
  assert.equal(normalizeState('PRINTING'), 'printing');
  assert.equal(normalizeState('PAUSED'), 'paused');
  assert.equal(normalizeState('FINISHED'), 'complete');
  assert.equal(normalizeState('STOPPED'), 'cancelled');
  assert.equal(normalizeState('ATTENTION'), 'error');
});

test('PrusaLink Digest challenge parser and authorization cover the firmware auth flow', () => {
  const challenge = prusaLinkInternals.parseDigestChallenge(
    'Digest realm="Printer API", nonce="abc123", qop="auth", opaque="opaque-value"'
  );
  assert.deepEqual(challenge, {
    realm:'Printer API',
    nonce:'abc123',
    qop:'auth',
    opaque:'opaque-value'
  });
  const authorization = prusaLinkInternals.digestAuthorization({
    method:'GET',
    uri:'/api/v1/status',
    username:'maker',
    password:'secret',
    challenge,
    nc:1
  });
  assert.match(authorization, /^Digest /);
  assert.match(authorization, /username="maker"/);
  assert.match(authorization, /realm="Printer API"/);
  assert.match(authorization, /uri="\/api\/v1\/status"/);
  assert.match(authorization, /qop=auth/);
  assert.match(authorization, /nc=00000001/);
  assert.match(authorization, /response="[0-9a-f]+"/);
});

test('PrusaLink file tree flattens printable files without inventing non-print files', () => {
  const files = prusaLinkInternals.flattenFolder({
    children:[
      { type:'PRINT_FILE', display_name:'cube.bgcode' },
      { type:'FILE', display_name:'notes.txt' },
      {
        type:'FOLDER',
        display_name:'jobs',
        children:[
          { type:'PRINT_FILE', display_name:'bracket.gcode' }
        ]
      }
    ]
  });
  assert.deepEqual(files, ['cube.bgcode', 'jobs/bracket.gcode']);
});


test('Prusa CORE One+ status is normalized from PrusaLink v1 telemetry', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body) => new Response(JSON.stringify(body), {
      status:200,
      headers:{ 'content-type':'application/json' }
    });
    if (url.pathname === '/api/v1/info') return json({
      name:'Workshop CORE One+',
      serial:'CZPXTEST123',
      nozzle_diameter:0.4,
      active_camera:false
    });
    if (url.pathname === '/api/version') return json({ firmware:'6.8.1', printer:'CORE One+' });
    if (url.pathname === '/api/v1/status') return json({
      printer:{
        state:'PRINTING',
        temp_nozzle:241.5,
        target_nozzle:245,
        temp_bed:89.5,
        target_bed:90,
        fan_print:55,
        status_printer:{ ok:true, message:'OK' }
      },
      job:{ id:42, progress:35, time_remaining:1800, time_printing:900 }
    });
    if (url.pathname === '/api/v1/job') return json({
      id:42,
      state:'PRINTING',
      progress:35,
      time_remaining:1800,
      time_printing:900,
      file:{ name:'BRACKET.BGC', display_name:'bracket.bgcode', path:'/usb' }
    });
    throw new Error(`Unexpected request ${url.pathname}`);
  };

  try {
    const adapter = getPrinterAdapter(preparePrinterConfig({
      adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
      name:'Prusa',
      host:'192.168.1.70',
      apiKey:'test-api-key'
    }));
    const status = await adapter.getStatus();
    assert.equal(status.status, 'printing');
    assert.equal(status.fileName, 'bracket.bgcode');
    assert.equal(status.progress, 35);
    assert.equal(status.remainingSeconds, 1800);
    assert.equal(status.elapsedSeconds, 900);
    assert.equal(status.nozzle.actual, 241.5);
    assert.equal(status.nozzle.target, 245);
    assert.equal(status.bed.actual, 89.5);
    assert.equal(status.bed.target, 90);
    assert.equal(status.tools[0].nozzleDiameter, 0.4);
    assert.equal(status.firmwareVersion, '6.8.1');
  } finally {
    global.fetch = originalFetch;
  }
});


test('PrusaLink normalizes eight reported INDX tools without remapping tool indices', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body) => new Response(JSON.stringify(body), {
      status:200,
      headers:{ 'content-type':'application/json' }
    });
    const tools = Array.from({ length:8 }, (_, index) => ({
      index,
      nozzle_diameter:index === 3 ? 0.6 : 0.4,
      filament_type:index === 3 ? 'PETG' : 'PLA',
      filament_color:index === 3 ? '#00FF00' : '#FF0000',
      filament_present:true,
      actual:index === 0 ? 215 : 25,
      target:index === 0 ? 215 : 0
    }));
    if (url.pathname === '/api/v1/info') return json({
      name:'CORE One+ INDX 8',
      serial:'INDX8',
      nozzle_diameters:tools.map((tool) => tool.nozzle_diameter),
      tools,
      active_camera:false
    });
    if (url.pathname === '/api/version') return json({ firmware:'6.8.1', printer:'CORE One+' });
    if (url.pathname === '/api/v1/status') return json({
      printer:{
        state:'IDLE',
        active_tool:0,
        temp_nozzle:215,
        target_nozzle:215,
        temp_bed:60,
        target_bed:60,
        tools,
        status_printer:{ ok:true, message:'OK' }
      }
    });
    if (url.pathname === '/api/v1/job') return new Response('', { status:404 });
    throw new Error(`Unexpected request ${url.pathname}`);
  };

  try {
    const adapter = getPrinterAdapter(preparePrinterConfig({
      adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
      name:'INDX 8',
      host:'192.168.1.73',
      apiKey:'test-api-key',
      toolCount:8
    }));
    const status = await adapter.getStatus();
    assert.equal(status.tools.length, 8);
    assert.deepEqual(status.tools.map((tool) => tool.index), [0,1,2,3,4,5,6,7]);
    assert.equal(status.tools[3].filament.material, 'PETG');
    assert.equal(status.tools[3].filament.color, '#00FF00');
    assert.equal(status.tools[3].nozzleDiameter, 0.6);
    assert.equal(status.materials.toolCount, 8);
    assert.equal(status.materials.loadedCount, 8);
  } finally {
    global.fetch = originalFetch;
  }
});


test('PrusaLink per-tool manual filament designation overrides reported material and colour', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body) => new Response(JSON.stringify(body), {
      status:200,
      headers:{ 'content-type':'application/json' }
    });
    const tools = Array.from({ length:4 }, (_, index) => ({
      index,
      nozzle_diameter:0.4,
      filament_type:'PLA',
      filament_color:'#FF0000',
      filament_present:true,
      actual:index === 0 ? 215 : 25,
      target:index === 0 ? 215 : 0
    }));
    if (url.pathname === '/api/v1/info') return json({
      name:'CORE One+ INDX 4',
      serial:'INDX4',
      nozzle_diameters:[0.4,0.4,0.4,0.4],
      tools,
      active_camera:false
    });
    if (url.pathname === '/api/version') return json({ firmware:'6.8.1', printer:'CORE One+' });
    if (url.pathname === '/api/v1/status') return json({
      printer:{
        state:'IDLE',
        active_tool:0,
        temp_nozzle:215,
        target_nozzle:215,
        temp_bed:60,
        target_bed:60,
        tools,
        status_printer:{ ok:true, message:'OK' }
      }
    });
    if (url.pathname === '/api/v1/job') return new Response('', { status:404 });
    throw new Error(`Unexpected request ${url.pathname}`);
  };

  try {
    const adapter = getPrinterAdapter(preparePrinterConfig({
      adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
      name:'INDX 4',
      host:'192.168.1.74',
      apiKey:'test-api-key',
      toolCount:4,
      adapterConfig:{
        toolDesignations:{
          '2':{ material:'ASA', color:'#0066FF', colorFamily:'blue' }
        }
      }
    }));
    const status = await adapter.getStatus();
    const t2 = status.tools[2];
    assert.equal(t2.filament.material, 'ASA');
    assert.equal(t2.filament.materialSource, 'manual');
    assert.equal(t2.filament.color, '#0066FF');
    assert.equal(t2.filament.colorSource, 'manual');
    assert.equal(t2.filament.colorFamily, 'blue');
    assert.equal(t2.filament.colorFamilySource, 'manual');
    assert.equal(t2.filament.reportedMaterial, 'PLA');
    assert.equal(t2.filament.reportedColor, '#FF0000');
    assert.equal(t2.filament.manuallyAssigned, true);
    assert.equal(status.tools[1].filament.material, 'PLA');
    assert.equal(status.tools[1].filament.materialSource, 'printer');
  } finally {
    global.fetch = originalFetch;
  }
});

test('PrusaLink per-tool nozzle designation overrides the nozzle reported for one INDX tool', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const json = (body) => new Response(JSON.stringify(body), {
      status:200,
      headers:{ 'content-type':'application/json' }
    });
    const tools = Array.from({ length:4 }, (_, index) => ({
      index,
      nozzle_diameter:0.4,
      filament_type:'PLA',
      filament_color:'#FF0000',
      filament_present:true,
      actual:index === 0 ? 215 : 25,
      target:index === 0 ? 215 : 0
    }));
    if (url.pathname === '/api/v1/info') return json({
      name:'CORE One+ INDX 4',
      serial:'INDX4-NOZZLE',
      nozzle_diameters:[0.4,0.4,0.4,0.4],
      tools,
      active_camera:false
    });
    if (url.pathname === '/api/version') return json({ firmware:'6.8.1', printer:'CORE One+' });
    if (url.pathname === '/api/v1/status') return json({
      printer:{
        state:'IDLE',
        active_tool:0,
        temp_nozzle:215,
        target_nozzle:215,
        temp_bed:60,
        target_bed:60,
        tools,
        status_printer:{ ok:true, message:'OK' }
      }
    });
    if (url.pathname === '/api/v1/job') return new Response('', { status:404 });
    throw new Error(`Unexpected request ${url.pathname}`);
  };

  try {
    const adapter = getPrinterAdapter(preparePrinterConfig({
      adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
      name:'INDX 4 nozzles',
      host:'192.168.1.75',
      apiKey:'test-api-key',
      toolCount:4,
      adapterConfig:{
        toolDesignations:{
          '2':{ nozzleDiameter:0.6 }
        }
      }
    }));
    const status = await adapter.getStatus();
    assert.equal(status.tools[0].nozzleDiameter, 0.4);
    assert.equal(status.tools[0].nozzleDiameterSource, 'printer');
    assert.equal(status.tools[2].reportedNozzleDiameter, 0.4);
    assert.equal(status.tools[2].nozzleDiameter, 0.6);
    assert.equal(status.tools[2].nozzleDiameterSource, 'manual');
    assert.equal(status.tools[2].nozzleManuallyAssigned, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('CORE One+ UI and API expose per-tool material and colour designation', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const models = fs.readFileSync(new URL('../src/adapters/prusa-link-models.js', import.meta.url), 'utf8');

  assert.match(models, /toolMaterialDesignation:true/);
  assert.match(app, /function prusaToolMaterialDesignationMarkup/);
  assert.match(app, /data-prusa-tool-material-input/);
  assert.match(app, /filamentTypeSelectMarkup/);
  assert.doesNotMatch(app, /prusaMaterialTypes/);
  assert.match(app, /data-prusa-tool-color-family-input/);
  assert.match(app, /data-prusa-tool-material-save/);
  assert.match(app, /data-prusa-tool-material-clear/);
  assert.match(app, /data-prusa-tool-material-clear="\$\{tool\.index\}">Clear assignment<\/button>/);
  const perToolMarkup = app.slice(
    app.indexOf('function prusaToolMaterialDesignationMarkup'),
    app.indexOf('function flashForgeMaterialDesignationMarkup')
  );
  assert.doesNotMatch(perToolMarkup, />Use printer value<\/button>/);
  assert.match(perToolMarkup, /multiToolFilamentHelpText/);
  assert.match(perToolMarkup, /Clear returns to the values reported by PrusaLink\./);
  assert.match(perToolMarkup, /Clear makes values not reported by PrusaLink unknown\./);
  assert.match(app, /\/tool-material-designation/);
  assert.match(styles, /\.prusa-tool-filament-control/);
  assert.match(server, /action === 'tool-material-designation'/);
  assert.match(server, /setPrinterToolMaterialDesignation/);
  assert.match(store, /export async function setPrinterToolMaterialDesignation/);
  assert.match(store, /toolDesignations/);
  assert.match(store, /representativeColor/);
});

test('CORE One+ INDX UI and API expose a nozzle designation for every physical tool', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const models = fs.readFileSync(new URL('../src/adapters/prusa-link-models.js', import.meta.url), 'utf8');
  const base = fs.readFileSync(new URL('../src/adapters/printer-adapter.js', import.meta.url), 'utf8');

  assert.match(base, /toolNozzleDesignation: false/);
  assert.match(models, /toolNozzleDesignation:true/);
  assert.match(app, /function toolNozzleDesignationMarkup/);
  assert.match(app, /function nozzleDiameterSelectMarkup/);
  assert.match(app, /<select \${inputAttributes}>/);
  assert.match(app, /data-tool-nozzle-input/);
  assert.doesNotMatch(app, /<input type="number" data-tool-nozzle-input/);
  assert.doesNotMatch(app, /prusaToolNozzleSizes-/);
  assert.match(app, /data-tool-nozzle-save/);
  assert.match(app, /data-tool-nozzle-clear/);
  assert.match(app, /data-tool-nozzle-save="\$\{tool\.index\}">Assign<\/button>/);
  assert.match(app, /data-tool-nozzle-clear="\$\{tool\.index\}">Clear<\/button>/);
  assert.match(app, /multiToolNozzleHelpText\(nozzleHelpDetail\)/);
  assert.match(app, /If PrusaLink does not report a nozzle size, Clear makes it unknown\./);
  assert.match(app, /toolNozzleDesignationMarkup\(printer, tool, tools\.length\)/);
  assert.match(app, /\/tool-nozzle-designation/);
  assert.match(server, /action === 'tool-nozzle-designation'/);
  assert.match(server, /adapter\.limits\?\.nozzleDiameters/);
  assert.match(server, /Unsupported nozzle size\. Choose one of/);
  assert.match(server, /setPrinterToolNozzleDesignation/);
  assert.match(store, /export async function setPrinterToolNozzleDesignation/);
  assert.match(store, /next\.nozzleDiameter = designation/);
  assert.match(store, /previousConfiguration\.count === 1 && configuration\.count > 1/);
  assert.match(store, /previousConfiguration\.count > 1 && configuration\.count === 1/);
});

test('CORE One+ standard and INDX nozzle designations are controlled dropdowns only', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const models = fs.readFileSync(new URL('../src/adapters/prusa-link-models.js', import.meta.url), 'utf8');

  assert.match(models, /nozzleDiameters:Object\.freeze\(\[0\.25, 0\.4, 0\.5, 0\.6, 0\.8, 1\.0\]\)/);
  assert.match(app, /function toolNozzleDesignationMarkup[\s\S]*nozzleDiameterSelectMarkup/);
  assert.match(app, /inputAttributes:'data-nozzle-designation-input'/);
  assert.match(app, /inputAttributes:`data-tool-nozzle-input=/);
  assert.match(app, /Choose a nozzle size from the list/);
});

test('CORE One+ UI exposes model-driven persistent tool configuration', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const models = fs.readFileSync(new URL('../src/adapters/prusa-link-models.js', import.meta.url), 'utf8');

  assert.match(app, /data-tool-configuration-input/);
  assert.match(app, /limits\.toolConfigurations/);
  assert.match(app, /capabilities\?\.toolConfiguration/);
  assert.match(models, /Standard · 1 tool/);
  assert.match(models, /INDX · 4 tools/);
  assert.match(models, /INDX · 8 tools/);
  assert.match(app, /\/tool-configuration/);
  assert.match(server, /adapter\.capabilities\?\.toolConfiguration/);
  assert.match(server, /adapter\.limits\?\.toolConfigurations/);
  assert.match(store, /export async function setPrinterToolCount/);
  assert.match(store, /getPrusaLinkModelProfile/);
  assert.match(store, /configuredToolCount/);
});


test('PrusaLink family adapter can instantiate another model from profile data only', () => {
  assert.ok(listPrusaLinkModelProfiles().some((profile) => profile.adapterType === PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE));
  assert.equal(PRUSA_CORE_ONE_PLUS_PROFILE.model, 'CORE One+');

  const syntheticProfile = Object.freeze({
    id:'test-prusa-model',
    adapterType:'prusa-test-model',
    manufacturer:'Prusa',
    model:'Test Prusa',
    label:'Prusa Test Prusa',
    defaultHttpPort:80,
    defaultUsername:'maker',
    uploadExtensions:Object.freeze(['.gcode', '.bgcode']),
    defaultToolCount:1,
    toolConfigurations:Object.freeze([
      Object.freeze({
        count:1,
        label:'Standard · 1 tool',
        mappingMode:'single',
        limits:Object.freeze({
          toolCount:1,
          bedTemperature:{ min:0, max:110 },
          nozzleTemperature:{ min:0, max:300 },
          chamberTemperature:{ min:0, max:0 },
          buildVolume:{ x:180, y:180, z:180 }
        }),
        capabilities:normalizeCapabilities({
          status:true,
          localFiles:true,
          fileUpload:true,
          printLocalFile:true,
          jobControl:true,
          materialStatus:true,
          materialDesignation:true,
          nozzleDesignation:true,
          toolheadNozzleStatus:true
        })
      })
    ])
  });

  const definition = createPrusaLinkAdapterDefinition(syntheticProfile);
  const config = definition.prepareConfig({
    name:'Synthetic Prusa',
    host:'192.168.1.88',
    apiKey:'test-key'
  });
  const adapter = definition.create(config);

  assert.ok(adapter instanceof PrusaLinkAdapter);
  assert.equal(adapter.type, 'prusa-test-model');
  assert.equal(adapter.manufacturer, 'Prusa');
  assert.equal(adapter.model, 'Test Prusa');
  assert.equal(adapter.limits.toolCount, 1);
  assert.equal(adapter.limits.nozzleTemperature.max, 300);
  assert.deepEqual(adapter.uploadExtensions, ['.gcode','.bgcode']);
});

test('CORE One+ wrapper contains model identity while shared PrusaLink behavior lives in family modules', () => {
  const wrapper = fs.readFileSync(new URL('../src/adapters/prusa-core-one-plus-adapter.js', import.meta.url), 'utf8');
  const family = fs.readFileSync(new URL('../src/adapters/prusa-link-adapter.js', import.meta.url), 'utf8');
  const models = fs.readFileSync(new URL('../src/adapters/prusa-link-models.js', import.meta.url), 'utf8');
  const registry = fs.readFileSync(new URL('../src/adapters/adapter-registry.js', import.meta.url), 'utf8');

  assert.match(wrapper, /extends PrusaLinkAdapter/);
  assert.match(wrapper, /PRUSA_CORE_ONE_PLUS_PROFILE/);
  assert.doesNotMatch(wrapper, /getPrusaLinkStatus/);
  assert.match(family, /class PrusaLinkAdapter/);
  assert.match(family, /createPrusaLinkAdapterDefinition/);
  assert.match(models, /listPrusaLinkModelProfiles/);
  assert.match(registry, /for \(const profile of listPrusaLinkModelProfiles\(\)\)/);

  for (const path of [
    '../src/prusa-link-api.js',
    '../src/server.js',
    '../src/store.js',
    '../emulator/protocols.js'
  ]) {
    const shared = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(shared, /prusa-core-one-plus/, `${path} must stay model-neutral`);
  }
});


test('Add Printer dropdown marks CORE One+ support as experimental without renaming the model', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const definition = listAdapterDefinitions().find((item) => item.type === PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE);
  assert.equal(definition.label, 'Prusa CORE One+');
  assert.equal(definition.models[0], 'CORE One+');
  assert.equal(definition.experimental, true);
  assert.match(app, /adapter\.experimental \? `\$\{label\} \(Experimental\)` : label/);
});
