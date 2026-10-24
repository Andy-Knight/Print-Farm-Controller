import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=filename=>readFileSync(new URL('../'+filename,import.meta.url),'utf8');
const html=read('public/index.html'),ui=read('public/auth-gate.js'),css=read('public/auth.css');
const backend=read('src/security/http-auth.js');

test('legacy farm visibly offers secure GUI onboarding in both frontend paths',()=>{
  assert.match(html,/id="usersBtn"[^>]*data-route="\/users"[^>]*hidden/);
  assert.match(html,/Security &amp; users/);
  assert.match(html,/id="authSetupOverview"/);
  assert.match(html,/id="authSecurityStatus"/);
  assert.match(html,/id="authSetupStartBtn"/);
  assert.match(ui,/function initializeSetupUi\(/);
  assert.match(ui,/session\.enrollmentAvailable/);
  assert.match(ui,/else initializeSetupUi\(\)/);
  assert.match(ui,/window\.__PFC_FRONTEND_BOOTED__/);
  assert.match(css,/#authSetupForm\[hidden\]/);
  assert.match(css,/#authUsersLayout\[hidden\]/);
});

test('GUI setup requires protected code and confirmed password without unauthenticated enrollment',()=>{
  for(const name of ['code','username','password','confirmPassword'])
    assert.match(html,new RegExp('name="'+name+'"'));
  assert.match(ui,/form\.elements\.password\.value!==form\.elements\.confirmPassword\.value/);
  assert.match(ui,/nativeFetch\('\/api\/auth\/enroll'/);
  assert.match(backend,/#originAllowed\(req\)/);
  assert.match(backend,/this\.#enrollmentAvailable/);
  assert.match(backend,/this\.#secure\|\|this\.#allowHttp/);
  assert.doesNotMatch(ui,/localStorage\.setItem\([^)]*(?:token|password)/i);
  assert.doesNotMatch(html,/value="(?:admin|password123)"/);
});
