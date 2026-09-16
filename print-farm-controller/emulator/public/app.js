const grid = document.querySelector('#printer-grid');
const empty = document.querySelector('#empty-state');
const template = document.querySelector('#printer-template');
const toast = document.querySelector('#toast');
const profileSelect = document.querySelector('#profile');
const cards = new Map();
let printers = [];
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}`);
  return data;
}

function endpointLines(printer) {
  const settings = printer.controllerSettings;
  if (printer.adapterType === 'flashforge-ad5m') {
    return [
      `Host ${settings.host}`,
      `HTTP ${settings.httpPort} · TCP ${settings.tcpPort} · Camera ${settings.cameraPort}`,
      `Serial ${settings.serialNumber} · Check code ${settings.checkCode}`
    ];
  }
  if (printer.adapterType === 'bambu-lab') {
    return [
      `Host ${settings.host}`,
      `MQTT TLS ${settings.mqttPort} · FTPS TLS ${settings.ftpsPort} · Camera TLS ${settings.cameraPort}`,
      `Serial ${settings.serialNumber} · Access code ${settings.accessCode}`
    ];
  }
  return [`Host ${settings.host}`, `Moonraker ${settings.httpPort}`];
}

function temperatureMetrics(printer) {
  const tool = printer.tools[0];
  return [
    ['Bed', `${printer.bed.actual.toFixed(1)} / ${printer.bed.target} °C`],
    [printer.tools.length > 1 ? 'Active T0' : 'Nozzle', `${tool.actual.toFixed(1)} / ${tool.target} °C`],
    ['Files', String(printer.files.length)]
  ];
}

function bindCard(card, id) {
  card.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const printer = printers.find((item) => item.id === id);
    let action = button.dataset.action;
    if (action === 'offline' && printer && !printer.online) action = 'online';
    try { await request(`/api/printers/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ action }) }); }
    catch (error) { showToast(error.message); }
  }));
  card.querySelector('.remove-button').addEventListener('click', async () => {
    if (!window.confirm('Remove this simulated printer and stop all of its endpoints?')) return;
    try { await request(`/api/printers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
    catch (error) { showToast(error.message); }
  });
  card.querySelector('.progress-slider').addEventListener('change', (event) => updatePrinter(id, { progress: Number(event.target.value) }));
  card.querySelector('.state-select').addEventListener('change', (event) => updatePrinter(id, { status: event.target.value }));
  card.querySelector('.speed-input').addEventListener('change', (event) => updatePrinter(id, { speedMultiplier: Number(event.target.value) }));
  card.querySelector('.bed-input').addEventListener('change', (event) => updatePrinter(id, { bedTarget: Number(event.target.value) }));
  card.querySelector('.auto-progress').addEventListener('change', (event) => updatePrinter(id, { autoProgress: event.target.checked }));
  card.querySelectorAll('[data-fault]').forEach((input) => input.addEventListener('change', () => updateFaults(id, card)));
  card.querySelector('.delay-input').addEventListener('change', () => updateFaults(id, card));
  card.querySelector('.run-scenario').addEventListener('click', async () => {
    const scenario = card.querySelector('.scenario-select').value;
    try { await request(`/api/printers/${encodeURIComponent(id)}/scenarios`, { method: 'POST', body: JSON.stringify({ scenario }) }); }
    catch (error) { showToast(error.message); }
  });
}

async function updatePrinter(id, values) {
  try { await request(`/api/printers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(values) }); }
  catch (error) { showToast(error.message); }
}

async function updateFaults(id, card) {
  const faults = { responseDelayMs: Number(card.querySelector('.delay-input').value || 0) };
  card.querySelectorAll('[data-fault]').forEach((input) => { faults[input.dataset.fault] = input.checked; });
  try { await request(`/api/printers/${encodeURIComponent(id)}/faults`, { method: 'PATCH', body: JSON.stringify(faults) }); }
  catch (error) { showToast(error.message); }
}

function renderCard(printer) {
  let card = cards.get(printer.id);
  if (!card) {
    card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = printer.id;
    bindCard(card, printer.id);
    cards.set(printer.id, card);
    grid.append(card);
  }
  card.querySelector('.manufacturer').textContent = `${printer.manufacturer} · SIMULATED`;
  card.querySelector('.printer-title').textContent = printer.name;
  card.querySelector('.model').textContent = printer.model;
  const shownStatus = printer.online ? printer.status : 'offline';
  const pill = card.querySelector('.status-pill');
  pill.textContent = shownStatus;
  pill.className = `status-pill ${shownStatus}`;
  card.querySelector('.endpoint-lines').replaceChildren(...endpointLines(printer).map((line) => Object.assign(document.createElement('div'), { textContent: line })));
  card.querySelector('.filename').textContent = printer.fileName || 'No active file';
  card.querySelector('.progress-text').textContent = `${Math.round(printer.progress)}%`;
  card.querySelector('.progress-fill').style.width = `${printer.progress}%`;
  const slider = card.querySelector('.progress-slider');
  if (document.activeElement !== slider) slider.value = printer.progress;
  card.querySelector('.metrics').replaceChildren(...temperatureMetrics(printer).map(([label, value]) => {
    const metric = document.createElement('div');
    metric.className = 'metric';
    const span = document.createElement('span'); span.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    metric.append(span, strong);
    return metric;
  }));
  card.querySelector('.state-select').value = printer.status;
  card.querySelector('.speed-input').value = printer.speedMultiplier;
  card.querySelector('.bed-input').value = printer.bed.target;
  card.querySelector('.auto-progress').checked = printer.autoProgress;
  card.querySelectorAll('[data-fault]').forEach((input) => { input.checked = Boolean(printer.faults[input.dataset.fault]); });
  card.querySelector('.delay-input').value = printer.faults.responseDelayMs;
  const onlineButton = card.querySelector('.online-toggle');
  onlineButton.textContent = printer.online ? 'Take offline' : 'Bring online';
  const activity = card.querySelector('.activity-log');
  activity.replaceChildren(...printer.logs.slice(0, 12).map((entry) => {
    const item = document.createElement('li');
    item.textContent = `${new Date(entry.at).toLocaleTimeString()} [${entry.protocol}] ${entry.message}`;
    return item;
  }));
}

function render(nextPrinters) {
  printers = nextPrinters || [];
  const ids = new Set(printers.map((printer) => printer.id));
  for (const [id, card] of cards) {
    if (!ids.has(id)) { card.remove(); cards.delete(id); }
  }
  printers.forEach(renderCard);
  empty.classList.toggle('hidden', printers.length > 0);
  document.querySelector('#printer-count').textContent = printers.length;
  document.querySelector('#online-count').textContent = printers.filter((printer) => printer.online).length;
  document.querySelector('#printing-count').textContent = printers.filter((printer) => printer.status === 'printing').length;
  document.querySelector('#fault-count').textContent = printers.reduce((count, printer) => count + Object.values(printer.faults).filter((value) => value === true || Number(value) > 0).length, 0);
}

async function loadProfiles() {
  const { profiles } = await request('/api/profiles');
  profileSelect.replaceChildren(...profiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.manufacturer} ${profile.model}`;
    return option;
  }));
}

function connectEvents() {
  const state = document.querySelector('#connection-state');
  const events = new EventSource('/api/events');
  events.onopen = () => { state.textContent = 'Live'; state.classList.remove('disconnected'); };
  events.onmessage = (event) => render(JSON.parse(event.data).printers);
  events.onerror = () => { state.textContent = 'Reconnecting…'; state.classList.add('disconnected'); };
}

document.querySelector('#show-add').addEventListener('click', () => document.querySelector('#add-panel').classList.remove('hidden'));
document.querySelector('#hide-add').addEventListener('click', () => document.querySelector('#add-panel').classList.add('hidden'));
document.querySelector('#add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await request('/api/printers', { method: 'POST', body: JSON.stringify(body) });
    document.querySelector('#printer-name').value = '';
    document.querySelector('#add-panel').classList.add('hidden');
  } catch (error) { showToast(error.message); }
});

const preferredTheme = localStorage.getItem('printer-emulator-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = preferredTheme;
document.querySelector('#theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('printer-emulator-theme', theme);
});

Promise.all([loadProfiles(), request('/api/printers').then((data) => render(data.printers))])
  .then(connectEvents)
  .catch((error) => showToast(error.message));
