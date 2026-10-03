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
  assert.deepEqual(adapter.uploadExtensions, ['.gcode', '.bgcode']);
  assert.equal(adapter.limits.nozzleTemperature.max, 290);
  assert.equal(adapter.limits.bedTemperature.max, 120);
  assert.equal(adapter.limits.chamberTemperature.max, 55);
  assert.deepEqual(adapter.limits.buildVolume, { x:250, y:220, z:270 });
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
