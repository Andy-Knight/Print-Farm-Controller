import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { randomUUID } from 'node:crypto';

const serviceAccount = '/var/run/secrets/kubernetes.io/serviceaccount';
const deployment = 'print-farm-controller';
const mailbox = 'print-farm-controller-upgrade';
const imageName = 'ghcr.io/andy-knight/print-farm-controller';
const versionPattern = '(?:0|[1-9]\\d{0,8})';
const imagePrefix = imageName.replaceAll('.', '\\.');
const versionedImage = new RegExp(`^${imagePrefix}:v?${versionPattern}\\.${versionPattern}\\.${versionPattern}$`);
const fixedImage = new RegExp(`^${imagePrefix}(?::[^@]+)?@sha256:[a-f0-9]{64}$`);
const deadlineMs = 10 * 60 * 1000;

export const upgradePending = job => ['requested', 'deploying'].includes(job?.phase);

export async function inClusterUpgradeClient() {
  const namespace = (await readFile(`${serviceAccount}/namespace`, 'utf8')).trim();
  const ca = await readFile(`${serviceAccount}/ca.crt`);
  const configPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${mailbox}`;
  const deploymentPath = `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${deployment}`;

  async function api(path, body, type = 'application/merge-patch+json') {
    const token = (await readFile(`${serviceAccount}/token`, 'utf8')).trim();
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request({hostname:'kubernetes.default.svc', path, ca,
        signal:AbortSignal.timeout(5000), method:encoded ? 'PATCH' : 'GET',
        headers:{authorization:`Bearer ${token}`, accept:'application/json',
          ...(encoded ? {'content-type':type,'content-length':Buffer.byteLength(encoded)} : {})}
      }, res => {
        const chunks = [];
        let bytes = 0;
        res.on('error', reject);
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) res.destroy(new Error('Kubernetes response too large'));
          else chunks.push(chunk);
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(Object.assign(new Error('Kubernetes upgrade request failed'), {kubeStatus:res.statusCode}));
          }
          try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (error) { reject(error); }
        });
      });
      req.on('error', reject);
      req.end(encoded);
    });
  }

  return {
    readMailbox:() => api(configPath),
    writeMailbox:(previous, job) => api(configPath, {
      metadata:{resourceVersion:previous.metadata.resourceVersion}, data:{upgrade:JSON.stringify(job)}
    }),
    readDeployment:() => api(deploymentPath),
    setImage:(previous, image) => api(deploymentPath, {
      metadata:{resourceVersion:previous.metadata.resourceVersion},
      spec:{template:{spec:{containers:[{name:'controller',image}]}}}
    }, 'application/strategic-merge-patch+json')
  };
}

export function mailboxJob(mailboxState) {
  return JSON.parse(mailboxState.data?.upgrade || 'null');
}

export function requestedUpgrade(image, now = Date.now()) {
  if (!versionedImage.test(image)) throw new Error('Expected a published controller image version');
  return {id:randomUUID(), phase:'requested', image, requestedAt:now};
}

export async function resolvePublishedImage(image) {
  if (!versionedImage.test(image)) throw new Error('Invalid registry image');
  const signal = AbortSignal.timeout(10_000);
  const options = {signal, redirect:'error'};
  const repository = imageName.slice('ghcr.io/'.length);
  const tokenUrl = new URL('https://ghcr.io/token');
  tokenUrl.search = new URLSearchParams({service:'ghcr.io', scope:`repository:${repository}:pull`});
  const response = await fetch(tokenUrl, options);
  if (!response.ok) throw new Error('Could not authenticate to GHCR');
  const {token} = await response.json();
  if (!token) throw new Error('Missing GHCR token');
  const tag = image.slice(imageName.length + 1);
  const manifest = await fetch(`https://ghcr.io/v2/${repository}/manifests/${tag}`, {
    ...options, method:'HEAD', headers:{authorization:`Bearer ${token}`,
      accept:'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'}
  });
  return manifest.ok ? `${image}@${manifest.headers.get('docker-content-digest')}` : '';
}

export async function reconcileUpgrade(client, { now = Date.now(), resolveImage } = {}) {
  const mailboxState = await client.readMailbox();
  const job = mailboxJob(mailboxState);
  if (!upgradePending(job)) return;
  const write = (phase, extra = {}) => client.writeMailbox(mailboxState, {...job,...extra,phase});
  const fail = message => write('failed', {message});
  if (!versionedImage.test(job.image) || !Number.isFinite(job.requestedAt) || job.requestedAt > now + 30_000) {
    return fail('Invalid upgrade request.');
  }
  const target = await client.readDeployment();
  const currentImage = target.spec?.template?.spec?.containers?.find(container => container.name === 'controller')?.image;
  if (target.spec?.replicas !== 1 || target.spec?.strategy?.type !== 'Recreate' || !currentImage) {
    return fail('The controller Deployment must use a single replica and the Recreate strategy.');
  }
  if (job.phase === 'requested') {
    if (now - job.requestedAt > 2 * 60_000) return fail('The upgrade request expired before deployment.');
    if (!versionedImage.test(currentImage) && !fixedImage.test(currentImage)) {
      return fail('Pin the running controller image to a version or digest before enabling upgrades.');
    }
    const pinnedImage = await resolveImage(job.image);
    if (!fixedImage.test(pinnedImage) || !pinnedImage.startsWith(`${job.image}@`)) {
      return fail('Could not verify the requested image digest.');
    }
    if (currentImage === pinnedImage) return fail('The requested image is already deployed.');
    return write('deploying', {previousImage:currentImage, pinnedImage, startedAt:now});
  }
  if (!fixedImage.test(job.pinnedImage) || !job.pinnedImage.startsWith(`${job.image}@`)
    || !Number.isFinite(job.startedAt) || job.startedAt > now + 30_000) {
    return fail('Invalid deployment state.');
  }
  const {observedGeneration, updatedReplicas, replicas, readyReplicas, availableReplicas} = target.status || {};
  if (currentImage === job.pinnedImage && observedGeneration >= target.metadata.generation &&
    updatedReplicas === 1 && replicas === 1 && readyReplicas === 1 && availableReplicas === 1) return write('succeeded');
  if (now - job.startedAt > deadlineMs) return fail('The replacement did not become ready within ten minutes. Check the Deployment and previous image.');
  if (currentImage === job.previousImage) return client.setImage(target, job.pinnedImage);
  if (currentImage !== job.pinnedImage) return fail('The Deployment image changed outside this upgrade.');
}
