export const LICENSE_FEATURES = Object.freeze({
  BASIC_CONTROL: 'printer.basic_control',
  FILE_MANAGEMENT: 'printer.file_management',
  CAMERA: 'printer.camera',
  PREHEAT: 'printer.preheat',
  MANUAL_QUEUE: 'queue.manual',
  SMART_ASSIGNMENT: 'queue.smart_assignment',
  JOB_PRIORITY: 'queue.job_priority',
  BATCH_JOBS: 'queue.batch_jobs',
  FLEET_STATISTICS: 'fleet.statistics',
  FLEET_MAINTENANCE: 'fleet.maintenance',
  FLEET_HISTORY: 'fleet.history',
  MULTI_OPERATOR: 'fleet.multi_operator',
  BED_CLEARANCE: 'automation.bed_clearance',
  MATERIAL_MATCHING: 'automation.material_matching',
  NOZZLE_MATCHING: 'automation.nozzle_matching',
  AUTO_TRANSFER: 'automation.auto_transfer',
  FAILURE_RECOVERY: 'automation.failure_recovery',
  REMOTE_ACCESS: 'remote.access',
  REMOTE_NOTIFICATIONS: 'remote.notifications',
  REMOTE_MULTI_SITE: 'remote.multi_site'
});

const BASIC_FEATURES = Object.freeze([
  LICENSE_FEATURES.BASIC_CONTROL,
  LICENSE_FEATURES.FILE_MANAGEMENT,
  LICENSE_FEATURES.CAMERA,
  LICENSE_FEATURES.PREHEAT,
  LICENSE_FEATURES.MANUAL_QUEUE
]);

const PRO_FEATURES = Object.freeze([
  ...BASIC_FEATURES,
  LICENSE_FEATURES.JOB_PRIORITY,
  LICENSE_FEATURES.FLEET_STATISTICS,
  LICENSE_FEATURES.FLEET_MAINTENANCE,
  LICENSE_FEATURES.FLEET_HISTORY
]);

const FARM_FEATURES = Object.freeze([
  ...PRO_FEATURES,
  LICENSE_FEATURES.SMART_ASSIGNMENT,
  LICENSE_FEATURES.BATCH_JOBS,
  LICENSE_FEATURES.MULTI_OPERATOR,
  LICENSE_FEATURES.BED_CLEARANCE,
  LICENSE_FEATURES.MATERIAL_MATCHING,
  LICENSE_FEATURES.NOZZLE_MATCHING,
  LICENSE_FEATURES.AUTO_TRANSFER,
  LICENSE_FEATURES.FAILURE_RECOVERY
]);

export const LICENSE_EDITIONS = Object.freeze({
  development: Object.freeze({
    id: 'development',
    name: 'Development',
    maxPrinters: null,
    features: Object.freeze(['*']),
    commercial: false
  }),
  community: Object.freeze({
    id: 'community',
    name: 'Community',
    maxPrinters: 2,
    features: BASIC_FEATURES,
    commercial: true
  }),
  pro: Object.freeze({
    id: 'pro',
    name: 'Pro',
    maxPrinters: 10,
    features: PRO_FEATURES,
    commercial: true
  }),
  farm: Object.freeze({
    id: 'farm',
    name: 'Farm',
    maxPrinters: 25,
    features: FARM_FEATURES,
    commercial: true
  })
});

export function getEditionDefinition(edition) {
  const key = String(edition || '').trim().toLowerCase();
  return LICENSE_EDITIONS[key] || null;
}

export function listEditionDefinitions() {
  return Object.values(LICENSE_EDITIONS).map((edition) => ({
    ...edition,
    features: [...edition.features]
  }));
}
