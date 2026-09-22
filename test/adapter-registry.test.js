import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLASHFORGE_AD5M_ADAPTER_TYPE,
  BAMBU_LAB_ADAPTER_TYPE,
  getPrinterAdapter,
  listAdapterDefinitions,
  preparePrinterConfig,
  registerPrinterAdapter
} from '../src/adapters/adapter-registry.js';
import { PrinterAdapter, normalizeCapabilities } from '../src/adapters/printer-adapter.js';

test('FlashForge AD5M adapter exposes the current controller capabilities and limits', () => {
  const adapter = getPrinterAdapter({
    id: 'p1',
    adapterType: FLASHFORGE_AD5M_ADAPTER_TYPE,
    host: '192.168.1.20',
    serialNumber: 'SN',
    checkCode: 'CODE',
    model: 'Adventurer 5M Pro'
  });

  assert.equal(adapter.type, 'flashforge-ad5m');
  assert.equal(adapter.manufacturer, 'FlashForge');
  assert.equal(adapter.capabilities.fileUpload, true);
  assert.equal(adapter.capabilities.camera, true);
  assert.equal(adapter.capabilities.chamberPreheat, true);
  assert.equal(adapter.capabilities.materialStatus, true);
  assert.equal(adapter.capabilities.materialDesignation, true);
  assert.equal(adapter.capabilities.nozzleDesignation, true);
  assert.equal(adapter.limits.bedTemperature.max, 110);
  assert.equal(adapter.limits.nozzleTemperature.max, 265);
});

test('FlashForge connection validation belongs to the adapter definition', () => {
  const config = preparePrinterConfig({
    adapterType: 'flashforge-ad5m',
    name: 'Printer 1',
    host: 'http://192.168.1.25/',
    serialNumber: ' SN123 ',
    checkCode: ' ABCD ',
    model: 'Adventurer 5M Pro'
  });

  assert.equal(config.host, '192.168.1.25');
  assert.equal(config.serialNumber, 'SN123');
  assert.equal(config.checkCode, 'ABCD');
  assert.equal(config.adapterType, 'flashforge-ad5m');
  assert.throws(() => preparePrinterConfig({ adapterType:'flashforge-ad5m', name:'Bad', host:'192.168.1.2' }), /serialNumber and checkCode/);
});

test('Snapmaker U1 exposes print tool mapping and flow-calibration capabilities', () => {
  const adapter = getPrinterAdapter({
    id:'u1', adapterType:'snapmaker-u1', host:'192.168.1.90', httpPort:7125,
    manufacturer:'Snapmaker', model:'U1', adapterConfig:{}
  });
  assert.equal(adapter.capabilities.printToolMapping, true);
  assert.equal(adapter.capabilities.flowCalibrationBeforePrint, true);
  assert.equal(adapter.capabilities.levelBeforePrint, true);
  assert.equal(adapter.capabilities.timeLapseBeforePrint, true);
  assert.equal(adapter.capabilities.autoFilamentReplenishment, true);
  assert.equal(adapter.capabilities.filamentEntanglementDetection, true);
  assert.equal(adapter.capabilities.toolheadNozzleStatus, true);
  assert.equal(adapter.capabilities.toolheadOffsetCalibration, true);
  assert.equal(adapter.limits.toolCount, 4);
});

test('Bambu P1P, P1S, X1C and A1 Mini configuration exposes model-specific experimental capabilities', () => {
  const definition = listAdapterDefinitions().find((item) => item.type === BAMBU_LAB_ADAPTER_TYPE);
  const modelField = definition.configFields.find((field) => field.name === 'model');
  assert.equal(modelField.type, 'select');
  assert.deepEqual(modelField.options.map((option) => option.value), ['P1P','P1S','X1C','A1 Mini']);
  const common = {
    adapterType:BAMBU_LAB_ADAPTER_TYPE,
    name:'Bambu test',
    host:'127.0.0.1',
    serialNumber:'01S00SIM000001',
    accessCode:'12345678',
    mqttPort:18883,
    ftpsPort:19990,
    cameraPort:16000
  };
  const p1pConfig = preparePrinterConfig({ ...common, model:'p1p' });
  const p1sConfig = preparePrinterConfig({ ...common, model:'P1S' });
  const x1cConfig = preparePrinterConfig({ ...common, model:'x1c' });
  const a1MiniConfig = preparePrinterConfig({ ...common, model:'a1 mini', cameraPort:undefined });
  const a1MiniAliasConfig = preparePrinterConfig({ ...common, model:'A1-MINI', cameraPort:undefined });
  const x1cDefaults = preparePrinterConfig({ ...common, model:'X1C', cameraPort:undefined });
  assert.equal(p1pConfig.model, 'P1P');
  assert.equal(p1pConfig.checkCode, '12345678');
  assert.equal(p1sConfig.model, 'P1S');
  assert.equal(x1cConfig.model, 'X1C');
  assert.equal(a1MiniConfig.model, 'A1 Mini');
  assert.equal(a1MiniAliasConfig.model, 'A1 Mini');
  assert.equal(a1MiniConfig.cameraPort, 6000);
  assert.equal(a1MiniConfig.adapterConfig.cameraProtocol, 'tls-jpeg');
  assert.equal(x1cDefaults.cameraPort, 322);
  assert.equal(x1cDefaults.adapterConfig.cameraProtocol, 'rtsps-h264');
  const p1p = getPrinterAdapter(p1pConfig);
  const p1s = getPrinterAdapter(p1sConfig);
  const x1c = getPrinterAdapter(x1cConfig);
  const a1Mini = getPrinterAdapter(a1MiniConfig);
  assert.equal(p1p.capabilities.fileUpload, true);
  assert.equal(p1p.capabilities.camera, true);
  assert.equal(p1p.capabilities.materialSlotMapping, true);
  assert.equal(p1p.capabilities.chamberFan, false);
  assert.equal(p1s.capabilities.chamberFan, true);
  assert.equal(p1s.capabilities.chamberPreheat, true);
  assert.equal(x1c.capabilities.chamberFan, true);
  assert.equal(x1c.capabilities.chamberTemperatureSensor, true);
  assert.equal(x1c.capabilities.materialSlotMapping, true);
  assert.equal(x1c.capabilities.camera, false);
  assert.equal(x1c.limits.bedTemperature.max, 120);
  assert.equal(a1Mini.capabilities.camera, true);
  assert.equal(a1Mini.capabilities.chamberFan, false);
  assert.equal(a1Mini.capabilities.chamberPreheat, false);
  assert.equal(a1Mini.capabilities.materialSlotMapping, true);
  assert.equal(a1Mini.limits.bedTemperature.max, 80);
  assert.equal(a1Mini.limits.nozzleTemperature.max, 300);
  assert.deepEqual(a1Mini.uploadExtensions, ['.3mf', '.gcode']);
  assert.deepEqual(p1s.uploadExtensions, ['.3mf', '.gcode']);
  assert.throws(() => preparePrinterConfig({ ...common, model:'A1' }), /model must be P1P, P1S, X1C or A1 Mini/);
});

test('a new printer family can register without changing fleet services', () => {
  class ExampleAdapter extends PrinterAdapter {
    get type() { return 'example-test-adapter'; }
    get capabilities() { return normalizeCapabilities({ status:true, bedTemperature:true }); }
    get limits() { return { bedTemperature:{ min:0, max:130 } }; }
    async getStatus() { return { status:'ready', bed:{ actual:25, target:0 } }; }
  }

  registerPrinterAdapter({
    type: 'example-test-adapter',
    manufacturer: 'Example',
    label: 'Example test printer',
    capabilities: normalizeCapabilities({ status:true, bedTemperature:true }),
    prepareConfig: (input) => ({
      name: String(input.name || '').trim(),
      host: String(input.host || '').trim(),
      adapterType: 'example-test-adapter',
      manufacturer: 'Example',
      model: 'Example 130'
    }),
    create: (printer) => new ExampleAdapter(printer)
  });

  const adapter = getPrinterAdapter({ id:'x', adapterType:'example-test-adapter', host:'10.0.0.5' });
  assert.equal(adapter.limits.bedTemperature.max, 130);
  assert.equal(adapter.capabilities.camera, false);
  assert.ok(listAdapterDefinitions().some((definition) => definition.type === 'example-test-adapter'));
});


test('FlashForge manual nozzle designation normalizes the installed nozzle for queue compatibility', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok:true,
    async json() { return { code:0, detail:{ status:'ready', rightFilamentType:'PLA' } }; }
  });
  try {
    const adapter = getPrinterAdapter({
      id:'p-nozzle', adapterType:FLASHFORGE_AD5M_ADAPTER_TYPE, host:'192.168.1.22',
      serialNumber:'SN', checkCode:'CODE', adapterConfig:{ nozzleDiameterDesignation:0.6 }
    });
    const status = await adapter.getStatus();
    assert.equal(status.tools[0].nozzleDiameter, 0.6);
    assert.equal(status.tools[0].nozzleDiameterSource, 'manual');
    assert.equal(status.tools[0].nozzleManuallyAssigned, true);
    assert.equal(status.tools[0].reportedNozzleDiameter, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('FlashForge manual material designation overrides display value while retaining printer report', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok:true,
    async json() { return { code:0, detail:{ status:'ready', rightFilamentType:'PLA' } }; }
  });
  try {
    const adapter = getPrinterAdapter({
      id:'p-material', adapterType:FLASHFORGE_AD5M_ADAPTER_TYPE, host:'192.168.1.21',
      serialNumber:'SN', checkCode:'CODE', adapterConfig:{ filamentDesignation:'PETG', filamentColorDesignation:'#3366cc' }
    });
    const status = await adapter.getStatus();
    const filament = status.tools[0].filament;
    assert.equal(filament.material, 'PETG');
    assert.equal(filament.materialSource, 'manual');
    assert.equal(filament.color, '#3366CC');
    assert.equal(filament.colorSource, 'manual');
    assert.equal(filament.manuallyAssigned, true);
    assert.equal(filament.reportedMaterial, 'PLA');
    assert.equal(filament.reportedColor, null);
  } finally {
    global.fetch = originalFetch;
  }
});
