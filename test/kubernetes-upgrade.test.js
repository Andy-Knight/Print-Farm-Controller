import test from 'node:test';
import assert from 'node:assert/strict';
import { mailboxJob, reconcileUpgrade, requestedUpgrade, upgradePending } from '../src/kubernetes-upgrade.js';
import { isRoleAllowed } from '../src/security/authorization-policy.js';

const image = 'ghcr.io/andy-knight/print-farm-controller';
const next = `${image}:0.69.0`;
const pinned = `${next}@sha256:${'a'.repeat(64)}`;
const previous = `${image}:0.68.0`;

function fixture() {
  const target = {
    metadata:{generation:1},
    spec:{replicas:1,strategy:{type:'Recreate'},template:{spec:{containers:[{name:'controller',image:previous}]}}},
    status:{observedGeneration:1, replicas:1, updatedReplicas:1, readyReplicas:1, availableReplicas:1}
  };
  const container = target.spec.template.spec.containers[0];
  const mailbox = {data:{upgrade:JSON.stringify(requestedUpgrade(next, 1_000))}};
  const client = {
    readMailbox:async () => mailbox,
    writeMailbox:async (_, job) => { mailbox.data.upgrade = JSON.stringify(job); },
    readDeployment:async () => target,
    setImage:async (_, reference) => { container.image = reference; target.metadata.generation++; }
  };
  return {mailbox, target, container, client};
}

test('controller upgrade records the previous image and waits for readiness of the new generation', async () => {
  const {mailbox,target,container,client} = fixture();
  const resolveImage = async version => { assert.equal(version, next); return pinned; };
  await reconcileUpgrade(client, {now:2_000,resolveImage});
  assert.equal(mailboxJob(mailbox).phase, 'deploying');
  assert.equal(mailboxJob(mailbox).previousImage, previous);
  await reconcileUpgrade(client, {now:3_000});
  assert.equal(container.image, pinned);
  await reconcileUpgrade(client, {now:4_000});
  assert.equal(upgradePending(mailboxJob(mailbox)), true, 'old pod readiness is not sufficient');
  target.status.observedGeneration = target.metadata.generation;
  await reconcileUpgrade(client, {now:5_000});
  assert.equal(mailboxJob(mailbox).phase, 'succeeded');
});

test('worker reports stalled replacements and does not overwrite an externally changed image', async () => {
  for (const externalChange of [true,false]) {
    const {mailbox,container,client} = fixture();
    await reconcileUpgrade(client, {now:2_000,resolveImage:async () => pinned});
    if (externalChange) container.image = `${image}:0.70.0`;
    else await reconcileUpgrade(client, {now:3_000});
    await reconcileUpgrade(client, {now:externalChange ? 4_000 : 700_000});
    assert.equal(mailboxJob(mailbox).phase, 'failed');
    assert.equal(mailboxJob(mailbox).previousImage, previous);
    assert.equal(container.image, externalChange ? `${image}:0.70.0` : pinned);
  }
});

test('worker rejects expired requests, mutable previous images and external repositories', async () => {
  for (const mode of ['expired','mutable','external']) {
    const {mailbox,container,client} = fixture();
    if (mode === 'mutable') container.image = `${image}:latest`;
    if (mode === 'external') mailbox.data.upgrade = JSON.stringify({...mailboxJob(mailbox),image:'other.example/controller:0.69.0'});
    await reconcileUpgrade(client, {now:mode === 'expired' ? 200_000 : 2_000,
      resolveImage:async () => assert.fail('Invalid requests must not reach the registry')});
    assert.equal(mailboxJob(mailbox).phase, 'failed');
  }
});

test('only administrators can read or start a Kubernetes controller upgrade', () => {
  for (const method of ['GET','POST']) {
    assert.equal(isRoleAllowed('viewer',method,'/api/controller-upgrade'), false);
    assert.equal(isRoleAllowed('operator',method,'/api/controller-upgrade'), false);
    assert.equal(isRoleAllowed('administrator',method,'/api/controller-upgrade'), true);
  }
});
