import { createPrinterMapPage } from './printer-map.js';

const display = createPrinterMapPage({ displayOnly:true, openAlerts });
const status = document.querySelector('#mapDisplayStatus');
const fullscreen = document.querySelector('#mapDisplayFullscreen');
const alertDialog = document.querySelector('#mapDisplayAlerts');
const alertTitle = alertDialog.querySelector('h2');
const alertStatus = alertDialog.querySelector('[role="status"]');
const alertList = alertDialog.querySelector('ol');
let alertRequest;
let alertPrinterId;
let refreshId = 0;
let nextPoll;

function requestDisplay(token, search, signal = AbortSignal.timeout(8000)) {
  return fetch(`/api/map-display${search}`, {
    credentials:'omit', cache:'no-store', signal, headers:{ authorization:`Bearer ${token}` }
  });
}

async function openAlerts(printerId, printerName) {
  alertRequest?.abort();
  const request = new AbortController();
  alertRequest = request;
  alertPrinterId = printerId;
  alertTitle.textContent = `Alerts for ${printerName}`;
  alertList.replaceChildren();
  alertStatus.hidden = false;
  alertStatus.textContent = 'Loading printer alerts…';
  alertDialog.showModal();
  try {
    const query = new URLSearchParams({ printerId });
    const response = await requestDisplay(location.hash.slice(1), `?${query}`,
      AbortSignal.any([request.signal, AbortSignal.timeout(8000)]));
    if (!response.ok) throw new Error('Alert request failed');
    const { alerts } = await response.json();
    if (request.signal.aborted || !alertDialog.open) return;
    alertStatus.textContent = 'No recent alerts for this printer.';
    alertStatus.hidden = alerts.length > 0;
    alertList.replaceChildren(...alerts.map(alert => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      const detail = document.createElement('small');
      const severity = { info:'Info', warning:'Warning', critical:'Critical' }[alert.severity];
      const read = alert.severity === 'info' ? '' : alert.read ? 'Read' : 'Unread';
      title.textContent = alert.title;
      detail.textContent = [severity, read, new Date(alert.createdAt).toLocaleString()].filter(Boolean).join(' · ');
      item.append(title, detail);
      return item;
    }));
  } catch {
    if (!request.signal.aborted && alertDialog.open) alertStatus.textContent = 'Printer alerts are unavailable.';
  }
}

alertDialog.querySelector('button').addEventListener('click', () => alertDialog.close());
alertDialog.addEventListener('close', () => {
  if (alertDialog.open) return;
  alertRequest?.abort();
  alertRequest = null;
  alertPrinterId = null;
  alertList.replaceChildren();
});

function showStatus(message) {
  if (alertDialog.open) alertDialog.close();
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
    const response = await requestDisplay(token, '');
    if (id !== refreshId) return;
    if ([401, 403, 404].includes(response.status)) {
      showStatus('Monitoring link unavailable.');
      return;
    }
    if (!response.ok) throw new Error('Map display request failed.');
    const { map, printers } = await response.json();
    if (id !== refreshId) return;
    if (alertDialog.open && !printers.some(printer => printer.id === alertPrinterId)) alertDialog.close();
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
