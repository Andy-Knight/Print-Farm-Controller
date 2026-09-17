const grid = document.querySelector('#printer-grid');
const empty = document.querySelector('#empty-state');
const template = document.querySelector('#printer-template');
const toast = document.querySelector('#toast');
const profileSelect = document.querySelector('#profile');
const cards = new Map();
let printers = [];
let toastTimer = null;
const integrated = location.pathname.startsWith('/simulator');
const apiBase = integrated ? '/api/emulator' : '/api';
const apiUrl = (pathname) => `${apiBase}${pathname}`;

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
    const cameraLabel = printer.model === 'X1C'
      ? `Camera test endpoint ${settings.cameraPort} · physical X1C uses RTSPS 322`
      : `Camera TLS ${settings.cameraPort}`;
    return [
      `Host ${settings.host}`,
      `MQTT TLS ${settings.mqttPort} · FTPS TLS ${settings.ftpsPort} · ${cameraLabel}`,
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

function renderAmsControls(card, printer) {
  const panel = card.querySelector('.ams-controls');
  panel.classList.toggle('hidden', printer.adapterType !== 'bambu-lab');
  if (printer.adapterType !== 'bambu-lab') return;
  const units = Array.isArray(printer.amsUnits) ? printer.amsUnits : [];
  const unitCount = panel.querySelector('.ams-unit-count');
  if (document.activeElement !== unitCount) unitCount.value = units.length;
  unitCount.onchange = () => updatePrinter(printer.id, { amsUnits:Number(unitCount.value) });
  const active = panel.querySelector('.ams-active-source');
  const choices = [
    { value:254, label:'External spool' },
    ...units.flatMap((unit) => unit.trays.map((tray) => ({ value:Number(unit.id) * 4 + Number(tray.slotIndex), label:`AMS ${Number(unit.id) + 1} · Slot ${Number(tray.slotIndex) + 1}` })))
  ];
  const choiceSignature = JSON.stringify(choices);
  if (active.dataset.choiceSignature !== choiceSignature && document.activeElement !== active) {
    active.replaceChildren(...choices.map((choice) => {
      const option = document.createElement('option');
      option.value = String(choice.value); option.textContent = choice.label;
      return option;
    }));
    active.dataset.choiceSignature = choiceSignature;
  }
  if (document.activeElement !== active) active.value = String(printer.activeMaterialSource ?? 254);
  active.onchange = () => updatePrinter(printer.id, { activeMaterialSource:Number(active.value) });
  const grid = panel.querySelector('.ams-slot-grid');
  const slots = units.flatMap((unit) => unit.trays.map((tray) => ({ unit, tray })));
  const structureSignature = JSON.stringify(slots.map(({ unit, tray }) => [Number(unit.id), Number(tray.slotIndex)]));
  if (grid.dataset.structureSignature !== structureSignature && !grid.contains(document.activeElement)) {
    grid.replaceChildren(...slots.map(({ unit, tray }) => {
      const slot = document.createElement('div');
      slot.className = 'ams-slot';
      slot.dataset.amsSlot = `${Number(unit.id)}:${Number(tray.slotIndex)}`;
      slot.innerHTML = `<strong>AMS ${Number(unit.id) + 1} · Slot ${Number(tray.slotIndex) + 1}</strong>
        <label class="check"><input data-ams-present type="checkbox">Loaded</label>
        <label>Material<select data-ams-material>${['PLA','PETG','ABS','ASA','PA','PC','TPU','PVA'].map((value) => `<option>${value}</option>`).join('')}</select></label>
        <label>Colour<input data-ams-color type="color"></label>`;
      const save = () => updatePrinter(printer.id, { amsSlots:[{
        unitIndex:Number(unit.id), slotIndex:Number(tray.slotIndex),
        present:slot.querySelector('[data-ams-present]').checked,
        material:slot.querySelector('[data-ams-material]').value,
        color:slot.querySelector('[data-ams-color]').value
      }] });
      slot.querySelectorAll('input,select').forEach((input) => input.addEventListener('change', save));
      return slot;
    }));
    grid.dataset.structureSignature = structureSignature;
  }
  for (const { unit, tray } of slots) {
    const slot = [...grid.querySelectorAll('[data-ams-slot]')].find((item) => item.dataset.amsSlot === `${Number(unit.id)}:${Number(tray.slotIndex)}`);
    if (!slot) continue;
    const present = slot.querySelector('[data-ams-present]');
    const material = slot.querySelector('[data-ams-material]');
    const color = slot.querySelector('[data-ams-color]');
    if (document.activeElement !== present) present.checked = Boolean(tray.present);
    if (document.activeElement !== material) material.value = tray.material || 'PLA';
    if (document.activeElement !== color) color.value = /^#[0-9A-F]{6}$/i.test(tray.color || '') ? tray.color : '#FFFFFF';
  }
}

function bindCard(card, id) {
  card.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const printer = printers.find((item) => item.id === id);
    let action = button.dataset.action;
    if (action === 'offline' && printer && !printer.online) action = 'online';
    try { await request(apiUrl(`/printers/${encodeURIComponent(id)}/actions`), { method: 'POST', body: JSON.stringify({ action }) }); }
    catch (error) { showToast(error.message); }
  }));
  card.querySelector('.remove-button').addEventListener('click', async () => {
    if (!window.confirm('Remove this simulated printer and stop all of its endpoints?')) return;
    try { await request(apiUrl(`/printers/${encodeURIComponent(id)}`), { method: 'DELETE' }); }
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
    try { await request(apiUrl(`/printers/${encodeURIComponent(id)}/scenarios`), { method: 'POST', body: JSON.stringify({ scenario }) }); }
    catch (error) { showToast(error.message); }
  });
}

async function updatePrinter(id, values) {
  try { await request(apiUrl(`/printers/${encodeURIComponent(id)}`), { method: 'PATCH', body: JSON.stringify(values) }); }
  catch (error) { showToast(error.message); }
}

async function updateFaults(id, card) {
  const faults = { responseDelayMs: Number(card.querySelector('.delay-input').value || 0) };
  card.querySelectorAll('[data-fault]').forEach((input) => { faults[input.dataset.fault] = input.checked; });
  try { await request(apiUrl(`/printers/${encodeURIComponent(id)}/faults`), { method: 'PATCH', body: JSON.stringify(faults) }); }
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
  renderAmsControls(card, printer);
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
  const { profiles } = await request(apiUrl('/profiles'));
  profileSelect.replaceChildren(...profiles.map((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.manufacturer} ${profile.model}`;
    return option;
  }));
}

function connectEvents() {
  const state = document.querySelector('#connection-state');
  const events = new EventSource(apiUrl('/events'));
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
    await request(apiUrl('/printers'), { method: 'POST', body: JSON.stringify(body) });
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

async function initialize() {
  if (integrated) {
    document.querySelector('#controller-link').classList.remove('hidden');
    const panel = document.querySelector('#integrated-control');
    const content = document.querySelector('#simulator-content');
    const toggle = document.querySelector('#simulator-toggle');
    panel.classList.remove('hidden');
    let status = await request(apiUrl('/status'));
    const renderStatus = (current) => {
      document.querySelector('#integrated-heading').textContent = current.running ? 'Printer simulator is enabled' : 'Printer simulator is disabled';
      document.querySelector('#integrated-description').textContent = current.running
        ? `${current.printerCount} virtual printer endpoints are running on ${current.host}. Disabling stops every simulated endpoint.`
        : 'Enable it to start loopback-only virtual printer endpoints. This preference is remembered for future controller launches.';
      toggle.textContent = current.running ? 'Disable simulator' : 'Enable simulator';
      toggle.className = current.running ? 'danger' : '';
      content.classList.toggle('hidden', !current.running);
      document.querySelector('#show-add').disabled = !current.running;
    };
    renderStatus(status);
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        status = await request(apiUrl('/status'), { method: 'POST', body: JSON.stringify({ enabled: !status.running }) });
        if (status.running) location.reload();
        else renderStatus(status);
      } catch (error) { showToast(error.message); }
      finally { toggle.disabled = false; }
    });
    if (!status.running) return;
  }
  await Promise.all([loadProfiles(), request(apiUrl('/printers')).then((data) => render(data.printers))]);
  connectEvents();
}

initialize().catch((error) => showToast(error.message));
