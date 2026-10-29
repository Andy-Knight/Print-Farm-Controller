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
  const yml=readFileSync(workflowUrl,'utf8').replaceAll('\r\n', '\n');
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
  const windows=yml.split('  windows:\n')[1]?.split('\n  smoke:\n')[0] || '';
  assert.match(windows,/runs-on: windows-latest/);
  assert.match(windows,/name: Run full Windows regression suite\n        run: npm test\n/,
    'Windows must exercise the full suite, including checkout line-ending portability');
});

test('Chromium regression budget includes browser installation on slow runners',t=>{
  if(!existsSync(workflowUrl)){
    if(process.env.GITHUB_ACTIONS) assert.fail('CI checkout must include container-image.yml');
    t.skip('GitHub workflow files are not present in this installation');
    return;
  }
  const yml=readFileSync(workflowUrl,'utf8').replaceAll('\r\n', '\n');
  const browser=yml.split('  browser:\n')[1]?.split('\n  windows:\n')[0] || '';
  const budget=Number(browser.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  assert.ok(budget>=25,
    'the Chromium job needs time for slow Ubuntu browser dependency setup, not just the browser tests');
  assert.match(browser,/npx playwright install --with-deps chromium/);
  assert.match(browser,/npm run test:browser/);
});

test('Windows draft releases use main-only validated artifacts and never gain PR write access',()=>{
  const yml=readFileSync(workflowUrl,'utf8').replaceAll('\r\n','\n');
  const windows=yml.split('\n  windows:\n')[1].split('\n  smoke:\n')[0];
  const draft=yml.split('\n  windows-draft:\n')[1];
  assert.match(windows,/node scripts\/build-installer-windows\.mjs/);
  assert.match(windows,/node scripts\/windows-release-bundle\.mjs/);
  assert.match(windows,/actions\/upload-artifact@v7/);
  assert.match(windows,/name: windows-installer/);
  assert.match(windows,/github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request' && secrets\.PFC_GOOGLE_CLIENT_SECRET/);
  assert.match(draft,/if: github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\)/);
  assert.match(draft,/needs: \[windows, build\]/);
  assert.match(draft,/contents: write/);
  assert.equal((yml.match(/contents: write/g)||[]).length,1,'only the main-only draft job can write releases');
  assert.match(draft,/persist-credentials: false/);
  assert.match(draft,/cancel-in-progress: false/);
  assert.match(draft,/needs\.windows\.outputs\.version/);
  assert.match(draft,/name: windows-installer/);
  assert.match(draft,/node scripts\/draft-windows-release\.mjs/);
  assert.doesNotMatch(draft,/secrets\.PFC_|draft=false/);
  assert.equal((yml.match(/- installer\/\*\*/g)||[]).length,2,'installer source changes trigger PR and main validation');
});
