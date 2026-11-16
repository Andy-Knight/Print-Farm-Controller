import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerUpdateCheck } from '../src/controller-update-check.js';
import { isRoleAllowed } from '../src/security/authorization-policy.js';

const release = {
  tag_name:'v0.68.0', draft:false, prerelease:false, published_at:'2026-11-16T10:00:00Z',
  assets:[{name:'PrintFarmController-Setup-v0.68.0.exe', state:'uploaded', size:123}]
};

test('Windows status caches a stable release and retains it after a failed refresh', async () => {
  let calls = 0;
  let now = 0;
  let result = release;
  const checker = new ControllerUpdateCheck({version:'0.67.2', channel:'windows', now:() => now,
    fetchImpl:async url => {
      assert.match(url, /api\.github\.com\/repos\/Andy-Knight\/Print-Farm-Controller\/releases\/latest$/);
      calls++;
      return Response.json(result);
    }
  });
  const first = await Promise.all([checker.check(), checker.check()]);
  assert.deepEqual(first[0], first[1]);
  assert.equal(calls, 1);
  assert.equal(first[0].updateAvailable, true);
  assert.match(first[0].latest.downloadUrl, /\/releases\/download\/v0\.68\.0\/PrintFarmController-Setup-v0\.68\.0\.exe$/);
  result = {...release, assets:[]};
  now = 60_000;
  assert.deepEqual(await checker.check(), first[0]);
  const failed = await checker.check({manual:true});
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.latest, first[0].latest);
  assert.equal(failed.checkedAt, first[0].checkedAt);
  await checker.check({manual:true});
  assert.equal(calls, 2);
});

test('drafts and prereleases are excluded and older versions do not trigger a notice', async () => {
  for (const patch of [{draft:true}, {prerelease:true}, {tag_name:'v0.68.0-beta.1'}]) {
    const checker = new ControllerUpdateCheck({version:'0.67.2', channel:'source',
      fetchImpl:async () => Response.json({...release, ...patch})
    });
    assert.equal((await checker.check()).updateAvailable, false);
  }
  const checker = new ControllerUpdateCheck({version:'0.100.0', channel:'windows',
    fetchImpl:async () => Response.json(release)
  });
  const result = await checker.check();
  assert.equal(result.status, 'checked');
  assert.equal(result.updateAvailable, false);
});

test('GHCR selects the highest stable full version across pages', async () => {
  const requests = [];
  const checker = new ControllerUpdateCheck({version:'0.67.2', channel:'container', fetchImpl:async (url, options) => {
    requests.push(url.pathname);
    assert.equal(url.origin, 'https://ghcr.io');
    if (url.pathname === '/token') return Response.json({token:'registry-token'});
    assert.equal(options.headers.authorization, 'Bearer registry-token');
    if (url.searchParams.has('last')) return Response.json({tags:['0.100.0','0.9.0','0.101.0-beta.1']});
    return Response.json({tags:['latest','sha-example','0.70','0.70.0']}, {
      headers:{link:'</v2/andy-knight/print-farm-controller/tags/list?last=0.70.0>; rel="next"'}
    });
  }});
  const status = await checker.check();
  assert.equal(requests.length, 3);
  assert.equal(status.latest.image, 'ghcr.io/andy-knight/print-farm-controller:0.100.0');
  assert.equal(status.updateAvailable, true);
});

test('update status is readable by viewers and manual refresh requires administrator permissions', () => {
  assert.equal(isRoleAllowed('viewer', 'GET', '/api/controller-updates'), true);
  assert.equal(isRoleAllowed('viewer', 'POST', '/api/controller-updates'), false);
  assert.equal(isRoleAllowed('operator', 'POST', '/api/controller-updates'), false);
  assert.equal(isRoleAllowed('administrator', 'POST', '/api/controller-updates'), true);
});
