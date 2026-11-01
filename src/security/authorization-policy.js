/**
 * Proposed controller-native RBAC policy, NOT YET WIRED INTO THE HTTP SERVER.
 *
 * Security design foundation for issue #127. Do not assume users have been
 * authenticated or API access is protected until middleware and sessions
 * enforce this policy at the real HTTP entry point.
 *
 * This intentionally does not consult signed licence entitlements. Licence
 * features and user permissions are separate security dimensions.
 */

export const ROLES = Object.freeze(['administrator', 'operator', 'viewer']);

export const PERMISSIONS = Object.freeze({
  SYSTEM_READ:'system.read',
  PRINTER_READ:'printer.read',
  PRINTER_OPERATE:'printer.operate',
  PRINTER_CONFIGURE:'printer.configure',
  PRINTER_FILE_MANAGE:'printer.files.manage',
  CAMERA_READ:'camera.read',
  QUEUE_READ:'queue.read',
  QUEUE_MANAGE:'queue.manage',
  QUEUE_HISTORY_PURGE:'queue.history.purge',
  LIBRARY_READ:'library.read',
  LIBRARY_MANAGE:'library.manage',
  LIBRARY_DELETE:'library.delete',
  PRICING_MANAGE:'pricing.manage',
  FILAMENT_READ:'filament.read',
  FILAMENT_MANAGE:'filament.manage',
  FILAMENT_ASSIGN:'filament.assign',
  GROUP_READ:'group.read',
  GROUP_MANAGE:'group.manage',
  MAINTENANCE_READ:'maintenance.read',
  MAINTENANCE_MANAGE:'maintenance.manage',
  MAINTENANCE_PURGE:'maintenance.purge',
  REPORT_READ:'report.read',
  ALERT_READ:'alert.read',
  ALERT_ACKNOWLEDGE:'alert.acknowledge',
  ALERT_MANAGE:'alert.manage',
  BACKUP_MANAGE:'backup.manage',
  RESTORE_MANAGE:'restore.manage',
  INTEGRATION_MANAGE:'integration.manage',
  LICENSE_MANAGE:'license.manage',
  DIAGNOSTICS_MANAGE:'diagnostics.manage',
  SIMULATOR_MANAGE:'simulator.manage',
  USER_MANAGE:'user.manage'
});

const P = PERMISSIONS;
const OPERATOR_PERMISSIONS = new Set([
  P.SYSTEM_READ, P.PRINTER_READ, P.PRINTER_OPERATE, P.PRINTER_FILE_MANAGE,
  P.CAMERA_READ, P.QUEUE_READ, P.QUEUE_MANAGE, P.LIBRARY_READ, P.LIBRARY_MANAGE,
  P.FILAMENT_READ, P.FILAMENT_ASSIGN, P.GROUP_READ, P.MAINTENANCE_READ,
  P.MAINTENANCE_MANAGE, P.REPORT_READ, P.ALERT_READ, P.ALERT_ACKNOWLEDGE
]);
const VIEWER_PERMISSIONS = new Set([
  P.SYSTEM_READ, P.PRINTER_READ, P.CAMERA_READ, P.QUEUE_READ,
  P.LIBRARY_READ, P.FILAMENT_READ, P.GROUP_READ, P.MAINTENANCE_READ,
  P.REPORT_READ, P.ALERT_READ
]);

export function roleHasPermission(role, permission) {
  if (!Object.values(P).includes(permission)) return false;
  if (role === 'administrator') return true;
  if (role === 'operator') return OPERATOR_PERMISSIONS.has(permission);
  if (role === 'viewer') return VIEWER_PERMISSIONS.has(permission);
  return false;
}

// Exact paths cover all currently implemented ordinary API routes.
// No permission fallback based on GET or on route prefixes is allowed.
const exactRoutes = new Map();
function exact(method, path, permission) {
  const key = `${method} ${path}`;
  if (exactRoutes.has(key)) throw new Error(`Duplicate RBAC route: ${key}`);
  exactRoutes.set(key, permission);
}
const read = (path, permission) => exact('GET', path, permission);
const write = (method, path, permission) => exact(method, path, permission);

// Keep this public health response minimal when activating authentication:
// the current implementation includes licence information.
read('/api/health', 'public');
read('/api/license', P.SYSTEM_READ);
read('/api/tls/status', P.USER_MANAGE);
read('/api/settings/resource-limits', P.USER_MANAGE);
write('PUT', '/api/settings/resource-limits', P.USER_MANAGE);
read('/api/tls/certificate', P.USER_MANAGE);
write('POST', '/api/tls/regenerate', P.USER_MANAGE);
write('POST', '/api/tls/configure', P.USER_MANAGE);
exact('POST', '/api/license/install', P.LICENSE_MANAGE);
read('/api/adapters', P.SYSTEM_READ);
read('/api/events', P.PRINTER_READ); // SSE contains fleet, queue and alerts
read('/api/discovery', P.PRINTER_CONFIGURE);
read('/api/printers', P.PRINTER_READ);
read('/api/fleet', P.PRINTER_READ);
write('POST', '/api/printers', P.PRINTER_CONFIGURE);
write('PUT', '/api/printers/order', P.PRINTER_CONFIGURE);

read('/api/printer-groups', P.GROUP_READ);
write('POST', '/api/printer-groups', P.GROUP_MANAGE);

read('/api/queue', P.QUEUE_READ);
for (const p of ['/api/queue','/api/queue/stage']) write('POST',p,P.QUEUE_MANAGE);
for (const [method, path] of [
  ['PUT','/api/queue/order']
]) write(method,path,P.QUEUE_MANAGE);
write('DELETE','/api/queue/history',P.QUEUE_HISTORY_PURGE);

read('/api/library',P.LIBRARY_READ);
read('/api/library/storage',P.LIBRARY_READ);
read('/api/reports/library',P.USER_MANAGE);
read('/api/library/readiness',P.LIBRARY_READ);
write('POST','/api/library',P.LIBRARY_MANAGE);
read('/api/library/pricing',P.LIBRARY_READ);
write('PUT','/api/library/pricing',P.PRICING_MANAGE);

read('/api/filaments',P.FILAMENT_READ);
write('POST','/api/filaments',P.FILAMENT_MANAGE);

read('/api/reports',P.REPORT_READ);
read('/api/maintenance',P.MAINTENANCE_READ);

read('/api/alerts',P.ALERT_READ);
write('POST','/api/alerts/mark-read',P.ALERT_ACKNOWLEDGE);
write('DELETE','/api/alerts/history',P.ALERT_MANAGE);
for (const path of ['/api/alerts/rules','/api/alerts/destinations'])
  write('POST',path,P.ALERT_MANAGE);

write('POST','/api/distribute',P.QUEUE_MANAGE);
write('POST','/api/batch',P.PRINTER_OPERATE);

for (const path of ['/api/backup/status','/api/backup/settings'])
  read(path,P.BACKUP_MANAGE);
write('PUT','/api/backup/settings',P.BACKUP_MANAGE);
for (const path of [
  '/api/backup/cancel','/api/backup/test-destination','/api/backup/create',
  '/api/backup/create/google-drive','/api/backup/create/one-drive',
  '/api/backup/create/s3'
]) write('POST',path,P.BACKUP_MANAGE);

for (const path of [
  '/api/integrations/google-drive/status',
  '/api/integrations/google-drive/backups',
  '/api/integrations/one-drive/status',
  '/api/integrations/one-drive/backups',
  '/api/integrations/s3/status',
  '/api/integrations/s3/backups'
]) read(path,P.INTEGRATION_MANAGE);
for (const path of [
  '/api/integrations/google-drive/config',
  '/api/integrations/one-drive/config',
  '/api/integrations/s3/config'
]) write('PUT',path,P.INTEGRATION_MANAGE);
for (const path of [
  '/api/integrations/google-drive/config',
  '/api/integrations/google-drive',
  '/api/integrations/one-drive/config',
  '/api/integrations/one-drive',
  '/api/integrations/s3/config'
]) write('DELETE',path,P.INTEGRATION_MANAGE);
for (const path of [
  '/api/integrations/google-drive/connect',
  '/api/integrations/google-drive/connect/poll',
  '/api/integrations/google-drive/test',
  '/api/integrations/one-drive/connect',
  '/api/integrations/one-drive/connect/poll',
  '/api/integrations/one-drive/test',
  '/api/integrations/s3/test'
]) write('POST',path,P.INTEGRATION_MANAGE);

for(const path of ['/api/restore/status','/api/restore/cloud/providers'])
  read(path,P.RESTORE_MANAGE);
for(const path of ['/api/restore/stage','/api/restore/inspect'])
  write('POST',path,P.RESTORE_MANAGE);
write('DELETE','/api/restore/stage',P.RESTORE_MANAGE);

for(const path of ['/api/diagnostics','/api/diagnostics/bundle'])
  read(path,P.DIAGNOSTICS_MANAGE);

// Dynamic routes require both an exact verb and an anchored, known suffix.
const dynamic = [];
function pattern(methods, regex, permission) {
  for(const method of methods) dynamic.push({method,regex,permission});
}
pattern(['PATCH','DELETE'],/^\/api\/printer-groups\/[^/]+$/,P.GROUP_MANAGE);
pattern(['GET'],/^\/api\/backup\/download\/[^/]+$/,P.BACKUP_MANAGE);
pattern(['GET'],/^\/api\/restore\/cloud\/[^/]+\/backups$/,P.RESTORE_MANAGE);
pattern(['POST'],/^\/api\/restore\/cloud\/[^/]+\/(?:inspect|stage)$/,P.RESTORE_MANAGE);
pattern(['PATCH','DELETE'],/^\/api\/alerts\/rules\/[^/]+$/,P.ALERT_MANAGE);
pattern(['PATCH','DELETE'],/^\/api\/alerts\/destinations\/[^/]+$/,P.ALERT_MANAGE);
pattern(['POST'],/^\/api\/alerts\/destinations\/[^/]+\/test$/,P.ALERT_MANAGE);
pattern(['PATCH','DELETE'],/^\/api\/filaments\/[^/]+$/,P.FILAMENT_MANAGE);
pattern(['GET'],/^\/api\/library\/[^/]+\/preview$/,P.LIBRARY_READ);
pattern(['GET','PUT'],/^\/api\/library\/[^/]+\/ownership$/,P.USER_MANAGE);
pattern(['PATCH'],/^\/api\/library\/[^/]+$/,P.LIBRARY_MANAGE);
pattern(['DELETE'],/^\/api\/library\/[^/]+$/,P.LIBRARY_DELETE);
pattern(['DELETE'],/^\/api\/queue\/stage\/[^/]+$/,P.QUEUE_MANAGE);
pattern(['POST'],/^\/api\/queue\/production\/[^/]+\/(?:pause|resume|cancel|quantity|priority|reprint)$/,P.QUEUE_MANAGE);
pattern(['POST'],/^\/api\/queue\/bed-clearance\/[^/]+$/,P.QUEUE_MANAGE);
pattern(['DELETE'],/^\/api\/queue\/[^/]+$/,P.QUEUE_MANAGE);
pattern(['POST'],/^\/api\/queue\/[^/]+\/(?:reprint|recheck|priority)$/,P.QUEUE_MANAGE);
pattern(['POST','PATCH','DELETE'],/^\/api\/maintenance\/(?:model-tasks|group-tasks)(?:\/[^/]+)?(?:\/complete)?$/,P.MAINTENANCE_MANAGE);
pattern(['POST','PATCH','DELETE'],/^\/api\/printers\/[^/]+\/maintenance\/tasks(?:\/[^/]+)?(?:\/complete)?$/,P.MAINTENANCE_MANAGE);
pattern(['DELETE'],/^\/api\/printers\/[^/]+\/maintenance\/history$/,P.MAINTENANCE_PURGE);

pattern(['DELETE'],/^\/api\/printers\/[^/]+$/,P.PRINTER_CONFIGURE);
pattern(['PUT'],/^\/api\/printers\/[^/]+\/(?:name|license-slot)$/,P.PRINTER_CONFIGURE);
pattern(['GET'],/^\/api\/printers\/[^/]+\/(?:status|files|file-material|print-setup|chamber-preheat)$/,P.PRINTER_READ);
pattern(['GET'],/^\/api\/printers\/[^/]+\/camera\/(?:stream|status|snapshot)$/,P.CAMERA_READ);
pattern(['POST'],/^\/api\/printers\/[^/]+\/(?:print|job|temperature|fans|filtration|level|chamber-preheat|camera)$/,P.PRINTER_OPERATE);
pattern(['DELETE'],/^\/api\/printers\/[^/]+\/chamber-preheat$/,P.PRINTER_OPERATE);
pattern(['POST','DELETE'],/^\/api\/printers\/[^/]+\/files$/,P.PRINTER_FILE_MANAGE);
pattern(['POST','DELETE'],/^\/api\/printers\/[^/]+\/(?:material-designation|tool-material-designation|nozzle-designation|tool-nozzle-designation)$/,P.FILAMENT_ASSIGN);
pattern(['POST'],/^\/api\/printers\/[^/]+\/(?:filament-color|filament-type|filament-config)$/,P.FILAMENT_ASSIGN);
pattern(['POST'],/^\/api\/printers\/[^/]+\/(?:tool-configuration|tool-offset-calibration)$/,P.PRINTER_CONFIGURE);

// Emulator management has its own router; the entire simulated control
// surface is administrator-only when authentication is activated.
pattern(['GET','POST','PUT','PATCH','DELETE'],/^\/api\/emulator(?:\/.*)?$/,P.SIMULATOR_MANAGE);

/**
 * Required permission for an incoming method and pathname.
 * Returns null for any unknown route or unrecognised method (fail closed).
 */
export function requiredPermission(method, pathname) {
  const verb = String(method || '').toUpperCase();
  const path = String(pathname || '');
  if (!['GET','POST','PUT','PATCH','DELETE'].includes(verb)) return null;
  const exactMatch = exactRoutes.get(`${verb} ${path}`);
  if (exactMatch) return exactMatch;
  const matches=dynamic.filter(entry=>entry.method===verb && entry.regex.test(path));
  if(matches.length!==1) return null;
  return matches[0].permission;
}

/** Pure permission decision. HTTP integration must also validate a session. */
export function isRoleAllowed(role, method, pathname) {
  const permission=requiredPermission(method,pathname);
  return permission==='public'||(permission!==null && roleHasPermission(role,permission));
}

/** Useful for documentation auditing; no internal regex objects escape. */
export function exactPermissionRoutes() {
  return Object.freeze([...exactRoutes].map(([route,permission])=>Object.freeze({route,permission})));
}
