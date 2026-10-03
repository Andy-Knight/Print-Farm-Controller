import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
  getPrinterAdapter,
  listAdapterDefinitions,
  preparePrinterConfig
} from '../src/adapters/adapter-registry.js';
import { prusaLinkInternals } from '../src/prusa-link-api.js';

test('Prusa CORE One+ is registered with safe first-pass local capabilities', () => {
  const definition = listAdapterDefinitions().find((item) => item.type === PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE);
  assert.ok(definition);
  assert.equal(definition.manufacturer, 'Prusa');
  assert.deepEqual(definition.models, ['CORE One+']);
  assert.equal(definition.discovery, false);

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
  assert.equal(adapter.capabilities.nozzleDesignation, true);
  assert.equal(adapter.capabilities.fixedToolMapping, false);
  assert.equal(adapter.capabilities.toolheadNozzleStatus, true);
  assert.deepEqual(adapter.uploadExtensions, ['.gcode', '.bgcode']);
  assert.equal(adapter.limits.nozzleTemperature.max, 290);
  assert.equal(adapter.limits.bedTemperature.max, 120);
  assert.equal(adapter.limits.chamberTemperature.max, 55);
  assert.equal(adapter.limits.toolCount, 1);
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
    assert.deepEqual(adapter.limits.buildVolume, { x:248, y:205, z:270 });
    assert.equal(adapter.capabilities.fixedToolMapping, true);
    assert.equal(adapter.capabilities.printToolMapping, false);
    assert.equal(adapter.capabilities.materialDesignation, false);
    assert.equal(adapter.capabilities.nozzleDesignation, false);
  }

  assert.throws(() => preparePrinterConfig({
    adapterType:PRUSA_CORE_ONE_PLUS_ADAPTER_TYPE,
    name:'Invalid CORE One+',
    host:'192.168.1.72',
    prusaLinkPassword:'secret',
    toolCount:2
  }), /1, 4 or 8 tools/);
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
