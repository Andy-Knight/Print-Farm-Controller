export const EMULATOR_PROFILES = Object.freeze({
  'bambu-p1p': Object.freeze({
    id: 'bambu-p1p',
    adapterType: 'bambu-lab',
    manufacturer: 'Bambu Lab',
    model: 'P1P',
    toolCount: 1,
    defaults: Object.freeze({
      mqttPort: 18883,
      ftpsPort: 19990,
      cameraPort: 16000,
      serialNumber: '01P00SIM000001',
      checkCode: '12345678'
    })
  }),
  'bambu-p1s': Object.freeze({
    id: 'bambu-p1s',
    adapterType: 'bambu-lab',
    manufacturer: 'Bambu Lab',
    model: 'P1S',
    toolCount: 1,
    defaults: Object.freeze({
      mqttPort: 18893,
      ftpsPort: 20000,
      cameraPort: 16010,
      serialNumber: '01S00SIM000001',
      checkCode: '87654321'
    })
  }),
  'flashforge-ad5m-pro': Object.freeze({
    id: 'flashforge-ad5m-pro',
    adapterType: 'flashforge-ad5m',
    manufacturer: 'FlashForge',
    model: 'Adventurer 5M Pro',
    toolCount: 1,
    defaults: Object.freeze({
      httpPort: 18898,
      tcpPort: 18899,
      cameraPort: 18080,
      serialNumber: 'SIM-FF-AD5M-001',
      checkCode: 'SIMULATOR'
    })
  }),
  'snapmaker-u1': Object.freeze({
    id: 'snapmaker-u1',
    adapterType: 'snapmaker-u1',
    manufacturer: 'Snapmaker',
    model: 'U1',
    toolCount: 4,
    defaults: Object.freeze({
      httpPort: 17125,
      serialNumber: 'SIM-U1-001'
    })
  })
});

export function listProfiles() {
  return Object.values(EMULATOR_PROFILES).map((profile) => ({
    ...profile,
    defaults: { ...profile.defaults }
  }));
}

export function getProfile(profileId) {
  return EMULATOR_PROFILES[String(profileId || '')] || null;
}

export function allocatePorts(profile, printers = []) {
  const used = new Set(printers.flatMap((printer) => Object.values(printer.ports || {})).map(Number));
  const ports = {};
  for (const [name, defaultPort] of Object.entries(profile.defaults)) {
    if (!name.endsWith('Port')) continue;
    let candidate = Number(defaultPort);
    while (used.has(candidate)) candidate += 10;
    used.add(candidate);
    ports[name] = candidate;
  }
  return ports;
}
