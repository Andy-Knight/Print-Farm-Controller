export function initControllerUpdates(api) {
  const get = id => document.getElementById(id);
  const badge = get('controllerUpdateBadge');
  const button = get('controllerUpdateCheck');
  const status = get('controllerUpdateStatus');
  const details = get('controllerUpdateDetails');
  const download = get('controllerUpdateDownload');
  const image = get('controllerUpdateImage');
  let checking = false;

  function setLink(link, href) {
    link.hidden = !href;
    if (href) link.href = href;
    else link.removeAttribute('href');
  }

  async function check(manual = false) {
    if (checking || (!manual && document.hidden)) return;
    checking = true;
    button.disabled = true;
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
      status.textContent = result === 'unavailable' ? 'Could not check for updates. Try again later.'
        : updateAvailable ? `Version ${latest.version} is available.`
        : result === 'checked' ? 'No newer version is available.' : 'Update checks are unavailable for this build.';
    } catch {
      status.textContent = 'Could not check for updates. Try again later.';
    } finally {
      checking = false;
      button.disabled = false;
    }
  }

  button.addEventListener('click', () => void check(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  void check();
  setInterval(check, 15 * 60 * 1000);
}
