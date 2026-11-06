import { createPrinterMapPage } from './printer-map.js';

const display = createPrinterMapPage({ displayOnly:true });
const status = document.querySelector('#mapDisplayStatus');
const fullscreen = document.querySelector('#mapDisplayFullscreen');
let refreshId = 0;
let nextPoll;

function showStatus(message) {
  display.show(null);
  status.textContent = message;
  status.hidden = false;
}

async function refresh() {
  clearTimeout(nextPoll);
  const id = ++refreshId;
  const token = location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    showStatus('Monitoring link unavailable.');
    return;
  }

  try {
    const response = await fetch('/api/map-display', {
      credentials:'omit',
      cache:'no-store',
      signal:AbortSignal.timeout(8000),
      headers:{ authorization:`Bearer ${token}` }
    });
    if (id !== refreshId) return;
    if ([401, 403, 404].includes(response.status)) {
      showStatus('Monitoring link unavailable.');
      return;
    }
    if (!response.ok) throw new Error('Map display request failed.');
    const { map, printers } = await response.json();
    if (id !== refreshId) return;
    status.hidden = true;
    display.show(map, printers);
  } catch {
    if (id !== refreshId) return;
    showStatus('Map display is temporarily unavailable. Retrying…');
  }
  nextPoll = setTimeout(refresh, 5000);
}

if (document.fullscreenEnabled) {
  fullscreen.hidden = false;
  fullscreen.addEventListener('click', () => {
    const toggle = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    toggle.catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });
}

window.addEventListener('hashchange', () => {
  showStatus('Loading printer map…');
  refresh();
});
refresh();
