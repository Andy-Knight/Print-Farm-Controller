import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=filename=>readFileSync(new URL('../'+filename,import.meta.url),'utf8');

test('container permanently exposes both ports and uses a TLS-independent health endpoint',()=>{
  const docker=read('Dockerfile');
  assert.match(docker,/EXPOSE 4242 4243/);
  assert.match(docker,/fetch\('http:\/\/127\.0\.0\.1:4242\/healthz'\)/);
  assert.doesNotMatch(docker,/EXPOSE 80 443/);
});
test('example MetalLB Service maps external 80 and 443 to fixed named pod ports',()=>{
  const yaml=read('deploy/kubernetes/print-farm-controller.yaml');
  assert.match(yaml,/kind: Deployment/);
  assert.match(yaml,/kind: Service/);
  assert.match(yaml,/type: LoadBalancer/);
  assert.match(yaml,/containerPort: 4242/);
  assert.match(yaml,/containerPort: 4243/);
  assert.match(yaml,/name: http\n      port: 80\n      targetPort: http/);
  assert.match(yaml,/name: https\n      port: 443\n      targetPort: https/);
  assert.match(yaml,/readinessProbe:[\s\S]*?path: \/healthz/);
  assert.match(yaml,/livenessProbe:[\s\S]*?path: \/healthz/);
  assert.match(yaml,/mountPath: \/data/);
  assert.match(yaml,/mountPath: \/logs/);
  assert.match(yaml,/replicas: 1/);
});
test('HTTPS GUI exposes fixed ports as labels without editable port mutation',()=>{
  const html=read('public/index.html');
  const ui=read('public/auth-gate.js');
  const tls=read('src/security/controller-tls.js');
  assert.match(html,/id="tlsHttpPort"/);
  assert.match(html,/id="tlsPort"/);
  assert.match(html,/id="tlsHttpBehaviour"/);
  assert.doesNotMatch(html,/id="tlsConfigurePort"/);
  assert.doesNotMatch(ui,/form\.elements\.port\.value/);
  assert.match(tls,/HTTPS listener port is fixed and cannot be changed in the GUI/);
});
