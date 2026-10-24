import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const css=read('public/auth.css');
const gate=read('public/auth-gate.js');

test('industrial login retains the native sign-in and initial-enrollment contracts',()=>{
  for(const id of ['authOverlay','authLoginHeading','authLoginHelp','authLoginForm',
    'authSetupSection','authSetupForm','authSetupError','authLoginError','authTransportNotice'])
    assert.match(html,new RegExp('id="'+id+'"'));
  for(const id of ['authLoginUsername','authLoginPassword','authPasswordToggle'])
    assert.match(html,new RegExp('id="'+id+'"'));
  for(const name of ['username','password','code','displayName','confirmPassword'])
    assert.match(html,new RegExp('name="'+name+'"'));
  assert.match(gate,/nativeFetch\('\/api\/auth\/login'/);
  assert.match(gate,/nativeFetch\('\/api\/auth\/enroll'/);
  assert.match(gate,/location\.reload\(\)/);
  assert.match(gate,/location\.assign\('\/'\)/);
  assert.match(html,/role="status" hidden/);
});

test('full-viewport control-centre branding is local, responsive and reduced-motion safe',()=>{
  assert.match(html,/class="auth-experience"/);
  assert.match(html,/class="auth-story"/);
  assert.match(html,/class="auth-printer-art"/);
  assert.match(html,/class="auth-printer-trace"/);
  assert.match(html,/Precision in every layer/);
  assert.match(html,/Control over every printer/);
  assert.match(css,/grid-template-columns:minmax\(0,1\.08fr\) minmax\(430px,\.92fr\)/);
  assert.match(css,/@media\(max-width:980px\)/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/id="authExtrusionPath" class="auth-printer-trace"/);
  assert.match(html,/id="authPrinterHead" class="auth-printer-head-motion"/);
  assert.match(html,/class="auth-printer-nozzle"/);
  assert.match(html,/class="auth-heat-block"/);
  assert.match(html,/class="auth-head-guide"/);
  assert.match(html,/class="auth-build-grid"/);
  assert.match(html,/id="authPrintLayer">02/);
  assert.match(gate,/extrusionPath\.getPointAtLength\(distance\)/);
  assert.match(gate,/carriage\.setAttribute\('transform'/);
  assert.match(gate,/extrusionPath\.style\.strokeDashoffset/);
  assert.match(gate,/requestAnimationFrame\(nextPrinterFrame\)/);
  assert.doesNotMatch(css,/@keyframes auth-head-travel|@keyframes auth-trace/);
  assert.match(css,/@keyframes auth-logo-layer/);
  assert.match(css,/var\(--ds-page\)/);
  assert.match(css,/var\(--ds-brand\)/);
  assert.match(css,/var\(--ds-warning\)/);
  assert.match(css,/\.auth-overlay\[hidden\]/);
  assert.doesNotMatch(html,/https?:\/\/(?:fonts|cdn)\./);
  assert.doesNotMatch(html,/data-live-printer-count|data-printer-status/);
});

test('show-hide password button preserves the same input and exposes a11y state',()=>{
  assert.match(html,/id="authPasswordToggle"[^>]+type="button"[^>]+aria-pressed="false"/);
  assert.match(html,/id="authLoginPassword" name="password" type="password"/);
  assert.match(gate,/input\.type=visible\?'text':'password'/);
  assert.match(gate,/button\.setAttribute\('aria-pressed',String\(visible\)\)/);
  assert.match(gate,/button\.setAttribute\('aria-label',visible\?'Hide password':'Show password'\)/);
  assert.doesNotMatch(gate,/localStorage\.setItem\([^)]*password/);
});

test('automatic extrusion has no pause button or stale browser motion preference',()=>{
  assert.doesNotMatch(html,/id="authMotionToggle"|id="authMotionLabel"|class="auth-motion-controls"/);
  assert.doesNotMatch(css,/\.auth-motion-toggle|\.auth-motion-controls|data-motion="off"/);
  assert.doesNotMatch(gate,/motionPreferenceKey|motionChoice|localStorage\.getItem\(motionPreferenceKey\)/);
  assert.match(gate,/extrusionPath\.getPointAtLength\(distance\)/);
  assert.match(gate,/extrusionPath\.style\.strokeDashoffset=String\(extrusionLength-distance\)/);
  assert.match(gate,/requestAnimationFrame\(nextPrinterFrame\)/);
  assert.match(gate,/document\.addEventListener\('visibilitychange',syncPrinterAnimation\)/);
});

test('reference-inspired toolpath is a top-down grid with a nozzle inside its printable area',()=>{
  assert.match(html,/class="auth-build-grid"/);
  assert.match(html,/class="auth-build-area" d="M183 127 516 136 502 317 169 309Z"/);
  assert.match(html,/id="authExtrusionPath" class="auth-printer-trace"[\s\S]*?d="M257 177 438 185 433 267 252 259Z"/);
  assert.match(html,/class="auth-head-guide" d="M0-51V-11"/);
  assert.match(html,/class="auth-printer-nozzle" d="M-11-11H11L3-1 0 0 -3-1Z"/);
  assert.match(html,/TOOLPATH VISUALISATION · DEMO/);
  assert.match(html,/Layer <tspan id="authPrintLayer">02<\/tspan> \/ 18/);
  assert.match(gate,/const layer=2\+\(Math.floor\(elapsed\/printCycleMs\)%17\)/);
  assert.match(gate,/layerCounter\.textContent=String\(layer\)\.padStart\(2,'0'\)/);
  assert.doesNotMatch(html,/auth-printer-base|auth-printer-rail|auth-carriage-roller|auth-fan-ring/);
});

test('login uses the identical Stacked Layers glyph geometry as the controller sidebar',()=>{
  const sidebarStart=html.indexOf('<svg class="stacked-layers-mark"');
  const sidebar=sidebarStart<0?'':html.slice(sidebarStart,html.indexOf('</svg>',sidebarStart)+6);
  const login=html.slice(html.indexOf('id="authOverlay"'));
  assert.ok(sidebar,'sidebar retains the canonical logo');
  for(const points of ['60,2 114,27 60,52 6,27',
    '14,39 60,60 106,39 114,43 60,69 6,43',
    '14,58 60,79 106,58 114,62 60,90 6,62']){
    assert.match(sidebar,new RegExp('points="'+points+'"'));
    assert.ok(login.includes('points="'+points+'"'),'login reuses the actual mark: '+points);
  }
});
