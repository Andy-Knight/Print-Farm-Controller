const repository = 'Andy-Knight/Print-Farm-Controller';
const image = 'andy-knight/print-farm-controller';
const releasePage = `https://github.com/${repository}/releases`;
const registry = 'https://ghcr.io';
const tagPath = `/v2/${image}/tags/list`;
const daily = 24 * 60 * 60 * 1000;
const retryDelay = 60 * 60 * 1000;
const manualCooldown = 60 * 1000;

function stableVersion(tag) {
  return typeof tag === 'string' && /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(tag)
    ? tag.replace(/^v/, '') : null;
}

function compareVersions(left, right) {
  const parts = version => version.split('.').map(Number);
  const [a, b, c] = parts(left);
  const [x, y, z] = parts(right);
  return a - x || b - y || c - z;
}

async function requestJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, {...options, redirect:'error'});
  if (!response.ok) throw new Error('Update source request failed');
  return {data:await response.json(), headers:response.headers};
}

async function findRelease(fetchImpl, signal, channel) {
  const {data} = await requestJson(fetchImpl, `https://api.github.com/repos/${repository}/releases/latest`, {
    signal, headers:{accept:'application/vnd.github+json', 'user-agent':'Print-Farm-Controller'}
  });
  const version = stableVersion(data.tag_name);
  if (!version || data.draft !== false || data.prerelease !== false || !data.published_at) {
    throw new Error('No published stable release returned');
  }
  const filename = `PrintFarmController-Setup-v${version}.exe`;
  const installer = data.assets?.some(asset => asset.name === filename && asset.state === 'uploaded' && asset.size > 0);
  if (channel === 'windows' && !installer) throw new Error('Windows installer unavailable for the latest release');
  return {
    version, releaseUrl:`${releasePage}/tag/${data.tag_name}`,
    downloadUrl:channel === 'windows' ? `${releasePage}/download/${data.tag_name}/${filename}` : null
  };
}

async function findContainer(fetchImpl, signal) {
  const tokenUrl = new URL('/token', registry);
  tokenUrl.search = new URLSearchParams({service:'ghcr.io', scope:`repository:${image}:pull`});
  const {data:{token}} = await requestJson(fetchImpl, tokenUrl, {signal});
  if (typeof token !== 'string' || !token) throw new Error('Container registry token unavailable');
  let url = new URL(`${tagPath}?n=1000`, registry);
  let newest;
  for (let page = 0; page < 10; page++) {
    const {data, headers} = await requestJson(fetchImpl, url, {signal, headers:{authorization:`Bearer ${token}`}});
    if (!Array.isArray(data.tags)) throw new Error('Invalid container registry response');
    for (const tag of data.tags) {
      const version = stableVersion(tag);
      if (version && (!newest || compareVersions(version, newest.version) > 0)) newest = {version, tag};
    }
    const next = headers.get('link');
    if (!next) {
      if (!newest) throw new Error('No stable container tags returned');
      return {
        version:newest.version, image:`ghcr.io/${image}:${newest.tag}`,
        packageUrl:`https://github.com/${repository}/pkgs/container/print-farm-controller`
      };
    }
    const href = next.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    if (!href) throw new Error('Invalid container registry pagination');
    url = new URL(href, registry);
    if (url.origin !== registry || url.pathname !== tagPath || url.username || url.password) {
      throw new Error('Unexpected container registry URL');
    }
  }
  throw new Error('Container registry page limit reached');
}

export class ControllerUpdateCheck {
  constructor({version, channel, fetchImpl = fetch, now = Date.now}) {
    this.version = version;
    this.channel = channel;
    this.fetch = fetchImpl;
    this.now = now;
    this.result = {installedVersion:version, channel, status:'unchecked', checkedAt:null, latest:null, updateAvailable:false};
    this.attemptAt = null;
    this.inFlight = null;
  }

  check({manual = false} = {}) {
    if (!stableVersion(this.version)) return Promise.resolve(this.result);
    if (this.inFlight) return this.inFlight;
    const interval = manual ? manualCooldown : this.result.status === 'unavailable' ? retryDelay : daily;
    if (this.attemptAt !== null && this.now() - this.attemptAt < interval) return Promise.resolve(this.result);
    this.attemptAt = this.now();
    this.inFlight = this.refresh().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async refresh() {
    try {
      const signal = AbortSignal.timeout(10_000);
      const latest = this.channel === 'container'
        ? await findContainer(this.fetch, signal) : await findRelease(this.fetch, signal, this.channel);
      this.result = {...this.result, status:'checked', checkedAt:new Date(this.now()).toISOString(), latest,
        updateAvailable:compareVersions(latest.version, stableVersion(this.version)) > 0};
    } catch {
      // Keep the last known result if the controller cannot reach its update source.
      this.result = {...this.result, status:'unavailable'};
    }
    return this.result;
  }
}
