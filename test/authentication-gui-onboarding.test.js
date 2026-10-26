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

test('user list requires confirmation before deleting and prevents self deletion',()=>{
  assert.match(ui,/deletion\.className='danger auth-user-delete'/);
  assert.match(ui,/deletion\.disabled=self/);
  assert.match(ui,/window\.confirm\('Permanently delete user/);
  assert.match(ui,/method:'DELETE'/);
  assert.match(ui,/await loadUsers\(\)/);
  assert.match(css,/\.auth-row-actions \.auth-user-delete/);
  assert.match(html,/Deletion requires confirmation and cannot be undone/);
  assert.match(backend,/if\(method==='DELETE'&&edit\)/);
  assert.match(backend,/You cannot delete your current account/);
  assert.match(backend,/this\.#revokeUser\(user\.id\)/);
});

test('Security & users has separate keyboard-accessible tabs and an unmistakable managed renewal action',()=>{
  const nav=html.indexOf('id="authAdminTabs"');
  const users=html.indexOf('id="authUsersPanel"');
  const https=html.indexOf('id="tlsSettings"');
  const summary=html.indexOf('id="tlsSummaryHeading"');
  const configure=html.indexOf('id="tlsConfigureForm"');
  const renewal=html.indexOf('id="tlsRegenerateBtn"');
  assert.ok(nav>0&&users>nav&&https>users,'tabs and both panels must exist in page order');
  assert.ok(summary>https&&configure>summary&&renewal>configure,
    'HTTPS sections must be Summary then Connection settings then managed-only Replacement');
  assert.match(html,/id="tlsConfigureCertificatePem"[^>]*name="certificatePem"[^>]*textarea|id="tlsConfigureCertificatePem"[^>]*name="certificatePem"/);
  assert.match(html,/id="tlsConfigurePrivateKeyPem"[^>]*name="privateKeyPem"/);
  assert.doesNotMatch(html,/id="tlsConfigureCertPath"|id="tlsConfigureKeyPath"/);
  assert.match(ui,/\.hidden=!tls\.canRegenerate/);
  assert.match(ui,/location\.protocol==='https:'/);
  assert.match(html,/id="authTabUsers"[^>]*role="tab"[^>]*aria-selected="true"/);
  assert.match(html,/id="authTabHttps"[^>]*role="tab"[^>]*aria-selected="false"/);
  assert.match(html,/id="authTabHttps"[^>]*>Connection settings<\/button>/);
  assert.match(html,/<h3 id="tlsSettingsHeading">Connection settings<\/h3>/);
  assert.doesNotMatch(html,/HTTPS &amp; certificates/);
  assert.doesNotMatch(html,/MetalLB/i,'connection settings tab must use deployment-neutral wording');
  assert.match(html,/<dt>HTTP port \(controller\)<\/dt><dd id="tlsHttpPort">4242<\/dd>/);
  assert.match(html,/<dt>HTTPS port \(controller\)<\/dt><dd id="tlsPort">4243<\/dd>/);
  assert.match(ui,/String\(tls\.httpPort\|\|4242\)/);
  assert.match(ui,/String\(tls\.httpsPort\|\|4243\)/);
  assert.doesNotMatch(ui,/MetalLB/i,'connection settings runtime text must use deployment-neutral wording');
  assert.match(html,/id="tlsRegenerateBtn"[^>]*type="submit"[^>]*class="attention"/);
  assert.match(ui,/function showSecurityTab\(/);
  assert.match(ui,/if\(choice==='https'\)void loadTlsSettings\(\)/);
  assert.match(ui,/\.hidden=!tls\.canRegenerate/);
  assert.match(ui,/result\.unchanged/);
  assert.match(css,/#authUsersPanel\[hidden\]/);
  assert.match(css,/#tlsMaintenance\[hidden\]/);
});
