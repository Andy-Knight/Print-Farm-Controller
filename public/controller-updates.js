export function initControllerUpdates(api) {
  const get = id => document.getElementById(id);
  const badge = get('controllerUpdateBadge');
  const button = get('controllerUpdateCheck');
  const status = get('controllerUpdateStatus');
  const details = get('controllerUpdateDetails');
  const download = get('controllerUpdateDownload');
  const image = get('controllerUpdateImage');
  const upgradeButton = get('controllerUpgradeStart');
  const upgradeStatus = get('controllerUpgradeStatus');
  const upgradeSetup = get('controllerUpgradeSetup');
  const administrator = document.body.dataset.authRole === 'administrator';
  let candidate;
  let upgradeEnabled = false;
  let upgradeAvailability = 'checking';
  let upgradeJob;
  let requestError = '';
  let upgradeRefresh = 0;
  let submitting = false;
  let checking = false;

  function renderUpgrade() {
    const pending = ['requested','deploying'].includes(upgradeJob?.phase);
    upgradeButton.hidden = !administrator || !candidate;
    upgradeButton.disabled = !upgradeEnabled || checking || submitting || pending;
    upgradeSetup.hidden = !administrator || !candidate || upgradeEnabled;
    const messages = {
      requested:'Upgrade requested. The controller will briefly disconnect.',
      deploying:'Replacing the controller container. Waiting for it to become healthy.',
      succeeded:'The replacement controller container is healthy.'
    };
    upgradeStatus.textContent = requestError || (upgradeJob?.phase === 'failed'
      ? upgradeJob.message : messages[upgradeJob?.phase] || '');
    if (administrator && candidate && !upgradeEnabled) {
      const availabilityMessages = {
        checking:'Checking whether container upgrades are enabled…',
        disabled:'Container upgrades require the optional Kubernetes/K3s updater to be installed and enabled. Follow the setup instructions to enable the upgrade button.',
        unavailable:'Cannot read container upgrade status. Check the controller connection and its access to the upgrade ConfigMap.'
      };
      upgradeStatus.textContent = availabilityMessages[upgradeAvailability];
    }
    if (upgradeJob?.previousImage && !pending) {
      upgradeStatus.textContent += ` Previous image: ${upgradeJob.previousImage}`;
    }
  }

  async function readUpgrade() {
    if (!administrator || submitting || document.hidden || get('controllerUpdateSettings').hidden
      || get('usersDialog').hidden) return;
    const refresh = ++upgradeRefresh;
    try {
      const {enabled, job} = await api('/api/controller-upgrade');
      if (refresh !== upgradeRefresh) return;
      upgradeEnabled = enabled;
      upgradeAvailability = enabled ? 'enabled' : 'disabled';
      if (job?.id !== upgradeJob?.id || job?.phase !== upgradeJob?.phase) requestError = '';
      upgradeJob = job;
      renderUpgrade();
    } catch {
      if (refresh === upgradeRefresh) {
        upgradeEnabled = false;
        upgradeAvailability = 'unavailable';
        renderUpgrade();
      }
    }
  }

  function setLink(link, href) {
    link.hidden = !href;
    if (href) link.href = href;
    else link.removeAttribute('href');
  }

  async function check(manual = false) {
    if (checking || (!manual && document.hidden)) return;
    checking = true;
    button.disabled = true;
    renderUpgrade();
    status.textContent = 'Checking for updates…';
    try {
      const {installedVersion, status:result, checkedAt, latest, updateAvailable} = await api(
        '/api/controller-updates', {method:manual ? 'POST' : 'GET', cache:'no-store'}
      );
      const page = latest?.releaseUrl || latest?.packageUrl;
      get('controllerUpdateInstalled').textContent = installedVersion ? `v${installedVersion}` : '—';
      get('controllerUpdateLatest').textContent = latest ? `v${latest.version}` : '—';
      get('controllerUpdateCheckedAt').textContent = checkedAt ? new Date(checkedAt).toLocaleString() : '—';
      badge.textContent = updateAvailable ? `Update available · v${latest.version}` : 'Update available';
      setLink(badge, updateAvailable ? page : null);
      details.textContent = latest?.packageUrl ? 'View container package' : 'View release notes';
      setLink(details, updateAvailable ? page : null);
      setLink(download, updateAvailable ? latest.downloadUrl : null);
      image.hidden = !updateAvailable || !latest?.image;
      image.querySelector('code').textContent = image.hidden ? '' : latest.image;
      candidate = result === 'checked' && updateAvailable ? latest.image : null;
      status.textContent = result === 'unavailable' ? 'Could not check for updates. Try again later.'
        : updateAvailable ? `Version ${latest.version} is available.`
        : result === 'checked' ? 'No newer version is available.' : 'Update checks are unavailable for this build.';
    } catch {
      candidate = null;
      status.textContent = 'Could not check for updates. Try again later.';
    } finally {
      checking = false;
      button.disabled = false;
      renderUpgrade();
      void readUpgrade();
    }
  }

  button.addEventListener('click', () => void check(true));
  upgradeButton.addEventListener('click', async () => {
    if (!candidate || upgradeButton.disabled) return;
    const target = candidate;
    if (!window.confirm(`Upgrade the controller to ${target}? The controller will briefly disconnect.`)) return;
    submitting = true;
    upgradeRefresh++;
    requestError = '';
    renderUpgrade();
    try {
      const {job} = await api('/api/controller-upgrade', {method:'POST', body:JSON.stringify({image:target})});
      upgradeJob = job;
      renderUpgrade();
    } catch (error) {
      requestError = error.message;
      renderUpgrade();
    } finally {
      submitting = false;
      renderUpgrade();
    }
  });
  if (administrator) {
    const updatePanel = get('controllerUpdateSettings');
    new MutationObserver(() => void readUpgrade()).observe(updatePanel, {attributes:true, attributeFilter:['hidden']});
    setInterval(readUpgrade, 5000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  void check();
  setInterval(check, 15 * 60 * 1000);
}
