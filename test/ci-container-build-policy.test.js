import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const workflowUrl=new URL('../.github/workflows/container-image.yml',import.meta.url);

test('feature pull requests run tests and disposable container smoke, without multi-architecture release builds',t=>{
  // Packaged Windows and container installations may omit repository metadata.
  if(!existsSync(workflowUrl)){
    if(process.env.GITHUB_ACTIONS) assert.fail('CI checkout must include container-image.yml');
    t.skip('GitHub workflow files are not present in this installation');
    return;
  }
  const yml=readFileSync(workflowUrl,'utf8');
  assert.match(yml,/  pull_request:\n/);
  assert.match(yml,/  push:\n    branches:\n      - main\n/);
  assert.match(yml,/  workflow_dispatch:\n/);
  assert.match(yml,/  smoke:\n    name: Container smoke test\n    needs: \[test\]/);
  assert.match(yml,/      - name: Build smoke-test image\n/);
  const build=yml.slice(yml.indexOf('  build:\n'));
  assert.ok(build.startsWith('  build:\n'));
  assert.match(build, /    needs: \[smoke, browser, windows\]/);
  assert.match(build,/    if: >-\n      \(github\.event_name == 'push'/);
  assert.match(build,/github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(build,/if: github\.event_name == 'pull_request'/,
    'pull requests must not run costly multi-architecture image builds');
  assert.match(build,/      - name: Build manually selected feature branch \(not published\)/);
  assert.match(build,/if: github\.event_name == 'workflow_dispatch' && github\.ref != 'refs\/heads\/main'/);
  assert.match(build,/      - name: Build and publish production image/);
  assert.match(build,/if: github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(build,/push: false/);
  assert.match(build,/push: true/);
  assert.match(build,/pfc_google_client_id=\$\{\{ secrets\.PFC_GOOGLE_CLIENT_ID \}\}/,
    'production secrets are still scoped to published images');
});
