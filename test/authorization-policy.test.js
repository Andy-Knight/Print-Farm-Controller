import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ROLES, PERMISSIONS, exactPermissionRoutes,
  requiredPermission, roleHasPermission, isRoleAllowed
} from '../src/security/authorization-policy.js';

const server = readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const allPermissions = new Set(Object.values(PERMISSIONS));

test('only three explicit roles exist; every declared permission is known',()=>{
  assert.deepEqual(ROLES,['administrator','operator','viewer']);
  assert.equal(new Set(ROLES).size,ROLES.length);
  assert.equal(new Set(Object.values(PERMISSIONS)).size,Object.values(PERMISSIONS).length);
  assert.ok(exactPermissionRoutes().length>65,'full API surface must be inventoried');
  for(const route of exactPermissionRoutes())
    assert.ok(route.permission==='public'||allPermissions.has(route.permission),route.route);
});

test('anonymous or unknown roles are denied by default; only health is explicitly public',()=>{
  for(const [method,path] of [
    ['GET','/api/events'],['GET','/api/fleet'],['GET','/api/queue'],
    ['GET','/api/printers/id/camera/stream'],['POST','/api/batch'],
    ['POST','/api/backup/create'],['POST','/api/restore/stage'],
    ['GET','/api/diagnostics/bundle']
  ]){
    assert.equal(isRoleAllowed(null,method,path),false,`no anonymous ${method} ${path}`);
    assert.equal(isRoleAllowed('unknown',method,path),false);
  }
  assert.equal(isRoleAllowed(null,'GET','/api/health'),true);
  assert.equal(requiredPermission('POST','/api/health'),null);
  for(const method of ['GET','POST','PATCH','PUT','DELETE','OPTIONS','HEAD']){
    assert.equal(requiredPermission(method,'/api/undocumented-route'),null,method);
    assert.equal(isRoleAllowed('administrator',method,'/api/undocumented-route'),false);
    assert.equal(requiredPermission(method,'/api/printers/test/unknown-control'),null);
  }
});

test('viewer is read-only, including file previews, SSE and camera streams',()=>{
  const allowed=[
    '/api/fleet','/api/events','/api/printers',
    '/api/printers/abc/status','/api/printers/abc/files',
    '/api/printers/abc/camera/snapshot','/api/printers/abc/camera/stream',
    '/api/library','/api/library/x/preview','/api/library/readiness',
    '/api/reports','/api/alerts','/api/printer-groups','/api/queue',
    '/api/maintenance','/api/filaments','/api/license'
  ];
  for(const path of allowed) assert.equal(isRoleAllowed('viewer','GET',path),true,path);
  for(const [method,path] of [
    ['POST','/api/printers/x/print'],['POST','/api/batch'],
    ['DELETE','/api/queue/history'],['POST','/api/library'],
    ['PATCH','/api/printer-groups/x'],['POST','/api/filaments'],
    ['POST','/api/alerts/mark-read'],['POST','/api/backup/create'],
    ['GET','/api/backup/status'],['GET','/api/diagnostics'],
    ['POST','/api/license/install']
  ]) assert.equal(isRoleAllowed('viewer',method,path),false,`${method} ${path}`);
});

test('operator may run production but cannot manage security, credentials or backups',()=>{
  for(const [method,path] of [
    ['POST','/api/batch'],['POST','/api/printers/x/print'],['POST','/api/printers/x/job'],
    ['DELETE','/api/printers/x/files'],['POST','/api/distribute'],
    ['POST','/api/queue'],['POST','/api/queue/x/reprint'],
    ['POST','/api/queue/bed-clearance/x'],['POST','/api/library'],
    ['POST','/api/printers/x/filament-config'],
    ['POST','/api/printers/x/filament-color'],
    ['POST','/api/printers/x/material-designation'],
    ['POST','/api/printers/x/nozzle-designation'],
    ['DELETE','/api/printers/x/tool-material-designation'],
    ['POST','/api/maintenance/model-tasks'],
    ['POST','/api/printers/x/maintenance/tasks/task/complete']
  ])assert.equal(isRoleAllowed('operator',method,path),true,`${method} ${path}`);
  for(const [method,path] of [
    ['DELETE','/api/library/print-file'],
    ['DELETE','/api/queue/history'],
    ['POST','/api/filaments'],
    ['PATCH','/api/filaments/x'],
    ['DELETE','/api/filaments/x'],
    ['POST','/api/printers'],['DELETE','/api/printers/x'],
    ['POST','/api/printers/x/tool-configuration'],['PUT','/api/library/pricing'],
    ['POST','/api/backup/create'],['POST','/api/restore/stage'],
    ['GET','/api/integrations/s3/status'],['DELETE','/api/integrations/google-drive'],
    ['POST','/api/license/install'],['POST','/api/diagnostics/verbose'],
    ['POST','/api/alerts/destinations'],['PATCH','/api/printer-groups/x'],
    ['DELETE','/api/printers/x/maintenance/history'],['GET','/api/backup/download/x'],
    ['POST','/api/emulator/start']
  ])assert.equal(isRoleAllowed('operator',method,path),false,`${method} ${path}`);
});

test('administrator can access enumerated sensitive API routes but never unknown ones',()=>{
  for(const [method,path] of [
    ['GET','/api/backup/status'],['PUT','/api/backup/settings'],
    ['GET','/api/backup/download/abc'],['POST','/api/restore/cloud/s3/stage'],
    ['POST','/api/restore/cloud/google-drive/inspect'],
    ['DELETE','/api/restore/stage'],['GET','/api/diagnostics/bundle'],
    ['POST','/api/license/install'],['DELETE','/api/printers/x'],
    ['DELETE','/api/library/print-file'],['DELETE','/api/queue/history'],
    ['POST','/api/filaments'],['PATCH','/api/filaments/x'],['DELETE','/api/filaments/x'],
    ['POST','/api/alerts/destinations/x/test'],['DELETE','/api/emulator/printers/x']
  ])assert.equal(isRoleAllowed('administrator',method,path),true,`${method} ${path}`);
  assert.equal(roleHasPermission('administrator','invented.permission'),false);
  assert.equal(isRoleAllowed('administrator','GET','/api/printers/x/camera/credentials'),false);
});

test('the controller cannot add an ordinary static API endpoint without an explicit RBAC decision',()=>{
  const patterns=[
    /if\s*\(\s*req\.method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'\s*&&\s*url\.pathname\s*===\s*'([^']+)'/g,
    /if\s*\(\s*url\.pathname\s*===\s*'([^']+)'\s*&&\s*req\.method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'/g
  ];
  const found=[];
  for(const [i,regex] of patterns.entries()){
    for(const match of server.matchAll(regex)){
      const method=i===0?match[1]:match[2],path=i===0?match[2]:match[1];
      if(path.startsWith('/api/'))found.push([method,path]);
    }
  }
  assert.ok(found.length>60,'static inventory should cover real routes, not an empty fixture');
  const unlisted=found.filter(([method,path])=>requiredPermission(method,path)===null);
  assert.deepEqual(unlisted,[],'all server API routes must have an explicitly reviewed permission');
});

test('explicit dynamic API routes cover actual router action families',()=>{
  const sample=[
    ['PATCH','/api/printer-groups/g'],['DELETE','/api/printer-groups/g'],
    ['GET','/api/backup/download/file'],['GET','/api/restore/cloud/s3/backups'],
    ['POST','/api/restore/cloud/s3/inspect'],['POST','/api/restore/cloud/s3/stage'],
    ['PATCH','/api/alerts/rules/a'],['DELETE','/api/alerts/destinations/a'],
    ['POST','/api/alerts/destinations/a/test'],
    ['PATCH','/api/filaments/f'],['GET','/api/library/f/preview'],
    ['PATCH','/api/library/f'],['DELETE','/api/queue/stage/t'],
    ...['pause','resume','cancel','quantity','priority','reprint'].map(action=>['POST',`/api/queue/production/x/${action}`]),
    ['POST','/api/queue/bed-clearance/p'],['DELETE','/api/queue/q'],
    ...['reprint','recheck','priority'].map(action=>['POST',`/api/queue/q/${action}`]),
    ['POST','/api/maintenance/model-tasks'],['PATCH','/api/maintenance/model-tasks/id'],
    ['POST','/api/maintenance/group-tasks/id/complete'],
    ['DELETE','/api/printers/p/maintenance/history'],
    ['POST','/api/printers/p/maintenance/tasks'],['PATCH','/api/printers/p/maintenance/tasks/t'],
    ['POST','/api/printers/p/maintenance/tasks/t/complete'],
    ['DELETE','/api/printers/p'],
    ['PUT','/api/printers/p/license-slot'],['PUT','/api/printers/p/name'],
    ...['status','files','file-material','print-setup','chamber-preheat'].map(action=>['GET',`/api/printers/p/${action}`]),
    ...['stream','status','snapshot'].map(action=>['GET',`/api/printers/p/camera/${action}`]),
    ...['print','job','temperature','fans','filtration','level','chamber-preheat','camera','tool-configuration','tool-offset-calibration',
      'filament-type','filament-color','filament-config','material-designation','tool-material-designation','nozzle-designation','tool-nozzle-designation','files'
    ].map(action=>['POST',`/api/printers/p/${action}`]),
    ['DELETE','/api/printers/p/files'],['DELETE','/api/printers/p/chamber-preheat'],
    ['GET','/api/emulator'],['POST','/api/emulator/status']
  ];
  for(const [method,path] of sample)
    assert.ok(requiredPermission(method,path),`missing permission mapping ${method} ${path}`);
});

test('HTTP and HTTPS dispatchers invoke authentication before emulator and API routes',()=>{
  assert.match(server,/https\.createServer\(options,guardedHttpListener\(handleControllerRequest\)\)/);
  assert.match(server,/http\.createServer\(guardedHttpListener\(handleHttpRequest\)\)/);
  assert.match(server,/if\(!httpsActive\)return handleControllerRequest\(req,res\)/);
  assert.match(server,/HTTP accepts no actions while HTTPS is enabled/);
  assert.match(server,/req\.url==='\/healthz'/);
  assert.match(server,/ControllerAuth/);
  const auth=server.indexOf('controllerAuth.authorize(req,res,url');
  const emulator=server.indexOf('emulatorManager.handleApi(req, res, url)');
  const api=server.indexOf('const backupRoute=');
  assert.ok(auth!==-1&&auth<emulator&&auth<api,'authorization must precede all API dispatch');
});

test('production operators can edit library records and assign printer consumables, not delete shared data',()=>{
  const permit=[
    ['POST','/api/library'],['PATCH','/api/library/file'],
    ['POST','/api/queue'],['DELETE','/api/queue/queued-job'],
    ['POST','/api/queue/queued-job/recheck'],
    ['POST','/api/printers/printer/material-designation'],
    ['DELETE','/api/printers/printer/nozzle-designation'],
    ['POST','/api/printers/printer/filament-type']
  ];
  const forbid=[
    ['DELETE','/api/library/file'],['DELETE','/api/queue/history'],
    ['POST','/api/filaments'],['PATCH','/api/filaments/cost'],['DELETE','/api/filaments/cost']
  ];
  for(const [method,path] of permit){
    assert.equal(isRoleAllowed('operator',method,path),true,method+' '+path);
    assert.equal(isRoleAllowed('viewer',method,path),false,method+' '+path);
  }
  for(const [method,path] of forbid){
    assert.equal(isRoleAllowed('operator',method,path),false,method+' '+path);
    assert.equal(isRoleAllowed('administrator',method,path),true,method+' '+path);
  }
  for(const permission of [PERMISSIONS.LIBRARY_DELETE,PERMISSIONS.QUEUE_HISTORY_PURGE,PERMISSIONS.FILAMENT_MANAGE])
    assert.equal(roleHasPermission('operator',permission),false);
  assert.equal(roleHasPermission('operator',PERMISSIONS.FILAMENT_ASSIGN),true);
});
