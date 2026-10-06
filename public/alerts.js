const alertsBtn = document.querySelector('#alertsBtn');
const alertsSettingsBtn = document.querySelector('#alertsSettingsBtn');
const topbarOverflow = document.querySelector('#topbarOverflow');
const alertsDialog = document.querySelector('#alertsDialog');
const alertsStatus = document.querySelector('#alertsStatus');
const alertsError = document.querySelector('#alertsError');
const alertsHistory = document.querySelector('#alertsHistory');
const alertsMarkAllReadBtn = document.querySelector('#alertsMarkAllReadBtn');
const alertTabs = Array.from(document.querySelectorAll('[data-alerts-tab]'));
const alertPanels = Array.from(document.querySelectorAll('[data-alerts-panel]'));

const alertDestinationForm = document.querySelector('#alertDestinationForm');
const alertDestinationId = document.querySelector('#alertDestinationId');
const alertDestinationName = document.querySelector('#alertDestinationName');
const alertDestinationProvider = document.querySelector('#alertDestinationProvider');
const alertDestinationEnabled = document.querySelector('#alertDestinationEnabled');
const alertDestinationNtfyFields = document.querySelector('#alertDestinationNtfyFields');
const alertDestinationWebhookFields = document.querySelector('#alertDestinationWebhookFields');
const alertNtfyServer = document.querySelector('#alertNtfyServer');
const alertNtfyTopic = document.querySelector('#alertNtfyTopic');
const alertNtfyToken = document.querySelector('#alertNtfyToken');
const alertNtfyUsername = document.querySelector('#alertNtfyUsername');
const alertNtfyPassword = document.querySelector('#alertNtfyPassword');
const alertWebhookUrl = document.querySelector('#alertWebhookUrl');
const alertWebhookAuthorization = document.querySelector('#alertWebhookAuthorization');
const alertDestinationCancelEdit = document.querySelector('#alertDestinationCancelEdit');
const alertDestinationSubmit = document.querySelector('#alertDestinationSubmit');
const alertDestinationsList = document.querySelector('#alertDestinationsList');

const alertRuleForm = document.querySelector('#alertRuleForm');
const alertRuleId = document.querySelector('#alertRuleId');
const alertRuleName = document.querySelector('#alertRuleName');
const alertRuleEvent = document.querySelector('#alertRuleEvent');
const alertRuleSeverity = document.querySelector('#alertRuleSeverity');
const alertRuleScope = document.querySelector('#alertRuleScope');
const alertRulePrinterField = document.querySelector('#alertRulePrinterField');
const alertRuleGroupField = document.querySelector('#alertRuleGroupField');
const alertRuleModelField = document.querySelector('#alertRuleModelField');
const alertRulePrinter = document.querySelector('#alertRulePrinter');
const alertRuleGroup = document.querySelector('#alertRuleGroup');
const alertRuleModel = document.querySelector('#alertRuleModel');
const alertRuleEnabled = document.querySelector('#alertRuleEnabled');
const alertRuleDestinations = document.querySelector('#alertRuleDestinations');
const alertRuleCancelEdit = document.querySelector('#alertRuleCancelEdit');
const alertRuleSubmit = document.querySelector('#alertRuleSubmit');
const alertRulesList = document.querySelector('#alertRulesList');

let alertUiState = {
  version:1,
  unreadCount:0,
  providers:[],
  rules:[],
  destinations:[],
  history:[]
};
let alertPrinters = [];
let alertGroups = [];
let alertAdapters = [];
let currentLiveSummary = { unreadCount:0, recent:[] };

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers:options.body
      ? { 'content-type':'application/json', ...(options.headers || {}) }
      : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function showError(error = null) {
  if (!alertsError) return;
  alertsError.textContent = error ? (error.message || String(error)) : '';
  alertsError.classList.toggle('hidden', !error);
}

function setStatus(message = '') {
  if (alertsStatus) alertsStatus.textContent = message;
}

function formatTimestamp(value) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return 'Unknown time';
  return time.toLocaleString();
}

function eventLabel(type) {
  return ({
    'print.failed':'Print failed',
    'print.completed':'Print completed',
    'print.cancelled':'Print cancelled',
    'printer.offline':'Printer offline',
    'queue.needs_review':'Queue job needs review',
    'queue.bed_clearance':'Bed clearance required',
    'maintenance.due':'Maintenance due',
    'maintenance.due_soon':'Maintenance due soon',
    'backup.failed':'Scheduled backup failed',
    'backup.completed':'Scheduled backup completed',
    '*':'All events'
  })[type] || String(type || 'Unknown event');
}

function severityLabel(severity) {
  return severity === 'critical' ? 'Critical'
    : severity === 'warning' ? 'Warning'
      : 'Information';
}

function randomTopic() {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `pfc-${uuid.replace(/-/g, '').slice(0, 24)}`;
}

function destinationById(id) {
  return alertUiState.destinations.find((destination) => destination.id === id) || null;
}

function ruleScopeLabel(scope = {}) {
  if (scope.type === 'printer') {
    const printer = alertPrinters.find((item) => String(item.id) === String(scope.printerId));
    return printer?.name || 'Individual printer';
  }
  if (scope.type === 'group') {
    const group = alertGroups.find((item) => String(item.id) === String(scope.groupId));
    return group?.name || 'Printer group';
  }
  if (scope.type === 'model') return scope.model || 'Printer model';
  return 'All printers / controller';
}

function renderHistory() {
  if (!alertsHistory) return;
  const history = Array.isArray(alertUiState.history) ? alertUiState.history : [];
  if (!history.length) {
    alertsHistory.innerHTML = '<div class="alerts-empty">No alerts have been recorded yet.</div>';
    alertsMarkAllReadBtn?.setAttribute('disabled', '');
    return;
  }
  if (alertUiState.unreadCount > 0) alertsMarkAllReadBtn?.removeAttribute('disabled');
  else alertsMarkAllReadBtn?.setAttribute('disabled', '');

  alertsHistory.innerHTML = history.map((alert) => {
    const unread = !alert.readAt;
    const printerName = alert.printer?.name ? ` · ${escapeHtml(alert.printer.name)}` : '';
    return `
      <article class="alert-history-row ${unread ? 'unread' : ''}" data-severity="${escapeHtml(alert.severity || 'info')}">
        <div class="alert-history-marker" aria-hidden="true"></div>
        <div class="alert-history-copy">
          <div class="alert-history-title-row">
            <strong>${escapeHtml(alert.title || eventLabel(alert.type))}</strong>
            <span class="alert-severity-pill" data-severity="${escapeHtml(alert.severity || 'info')}">${escapeHtml(severityLabel(alert.severity))}</span>
          </div>
          <div class="alert-history-message">${escapeHtml(alert.message || '')}</div>
          <div class="subtle">${escapeHtml(formatTimestamp(alert.createdAt))}${printerName}</div>
        </div>
        ${unread ? `<button type="button" class="secondary compact" data-alert-mark-read="${escapeHtml(alert.id)}">Mark read</button>` : ''}
      </article>`;
  }).join('');
}

function renderDestinations() {
  if (!alertDestinationsList) return;
  const destinations = Array.isArray(alertUiState.destinations) ? alertUiState.destinations : [];
  if (!destinations.length) {
    alertDestinationsList.innerHTML = '<div class="alerts-empty">No external notification destinations configured.</div>';
    return;
  }

  alertDestinationsList.innerHTML = destinations.map((destination) => {
    const config = destination.config || {};
    const summary = destination.provider === 'ntfy'
      ? `${escapeHtml(config.server || 'https://ntfy.sh')} / ${escapeHtml(config.topic || 'No topic')}`
      : escapeHtml(config.url || 'No webhook URL');
    const auth = destination.provider === 'ntfy'
      ? (config.hasToken ? 'Token authentication' : config.username ? 'Username/password authentication' : 'Anonymous topic')
      : (config.hasAuthorization ? 'Authorization header configured' : 'No authorization header');
    return `
      <article class="alerts-card">
        <div>
          <div class="alerts-card-title">
            <strong>${escapeHtml(destination.name)}</strong>
            <span class="alert-provider-pill">${escapeHtml(destination.providerLabel || destination.provider)}</span>
            ${destination.enabled === false ? '<span class="alert-disabled-pill">Disabled</span>' : ''}
          </div>
          <div class="subtle">${summary}</div>
          <div class="field-help">${escapeHtml(auth)}</div>
        </div>
        <div class="mini-actions">
          <button type="button" class="secondary" data-alert-destination-test="${escapeHtml(destination.id)}">Test</button>
          <button type="button" class="secondary" data-alert-destination-edit="${escapeHtml(destination.id)}">Edit</button>
          <button type="button" class="danger" data-alert-destination-delete="${escapeHtml(destination.id)}">Delete</button>
        </div>
      </article>`;
  }).join('');
}

function renderRuleDestinationOptions(selected = []) {
  if (!alertRuleDestinations) return;
  const selectedIds = new Set(selected.map(String));
  const destinations = alertUiState.destinations || [];
  if (!destinations.length) {
    alertRuleDestinations.innerHTML = '<div class="alerts-empty compact-empty">Add a notification destination before creating delivery rules.</div>';
    return;
  }
  alertRuleDestinations.innerHTML = destinations.map((destination) => `
    <label class="checkbox-label alert-destination-option">
      <input type="checkbox" data-alert-rule-destination value="${escapeHtml(destination.id)}" ${selectedIds.has(String(destination.id)) ? 'checked' : ''} />
      <span><strong>${escapeHtml(destination.name)}</strong><small>${escapeHtml(destination.providerLabel || destination.provider)}</small></span>
    </label>
  `).join('');
}

function renderRules() {
  if (!alertRulesList) return;
  const rules = Array.isArray(alertUiState.rules) ? alertUiState.rules : [];
  if (!rules.length) {
    alertRulesList.innerHTML = '<div class="alerts-empty">No external notification rules configured.</div>';
    return;
  }

  alertRulesList.innerHTML = rules.map((rule) => {
    const destinations = (rule.destinationIds || []).map((id) => destinationById(id)?.name).filter(Boolean);
    return `
      <article class="alerts-card">
        <div>
          <div class="alerts-card-title">
            <strong>${escapeHtml(rule.name)}</strong>
            ${rule.enabled === false ? '<span class="alert-disabled-pill">Disabled</span>' : ''}
          </div>
          <div class="subtle">${escapeHtml((rule.eventTypes || []).map(eventLabel).join(', '))} · ${escapeHtml((rule.severities || []).map(severityLabel).join(', '))}</div>
          <div class="field-help">Scope: ${escapeHtml(ruleScopeLabel(rule.scope))} · Deliver to: ${escapeHtml(destinations.join(', ') || 'No destinations')}</div>
        </div>
        <div class="mini-actions">
          <button type="button" class="secondary" data-alert-rule-edit="${escapeHtml(rule.id)}">Edit</button>
          <button type="button" class="danger" data-alert-rule-delete="${escapeHtml(rule.id)}">Delete</button>
        </div>
      </article>`;
  }).join('');
}

function renderAll() {
  renderHistory();
  renderDestinations();
  renderRules();
  if (!alertRuleId?.value) renderRuleDestinationOptions([]);
}

function populateScopeOptions() {
  if (alertRulePrinter) {
    alertRulePrinter.innerHTML = alertPrinters.length
      ? alertPrinters
        .slice()
        .sort((a,b) => String(a.name).localeCompare(String(b.name)))
        .map((printer) => `<option value="${escapeHtml(printer.id)}">${escapeHtml(printer.name || printer.id)}</option>`)
        .join('')
      : '<option value="">No printers configured</option>';
  }

  if (alertRuleGroup) {
    alertRuleGroup.innerHTML = alertGroups.length
      ? alertGroups
        .slice()
        .sort((a,b) => String(a.name).localeCompare(String(b.name)))
        .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
        .join('')
      : '<option value="">No printer groups configured</option>';
  }

  if (alertRuleModel) {
    const models = alertAdapters.flatMap((adapter) =>
      (adapter.models || []).map((model) => ({
        adapterType:adapter.type,
        model,
        label:`${adapter.label || adapter.type} — ${model}`
      }))
    );
    alertRuleModel.innerHTML = models.length
      ? models
        .sort((a,b) => a.label.localeCompare(b.label))
        .map((item) => `<option value="${encodeURIComponent(item.adapterType)}::${encodeURIComponent(item.model)}">${escapeHtml(item.label)}</option>`)
        .join('')
      : '<option value="">No printer models available</option>';
  }
}

function updateRuleScopeFields() {
  const scope = alertRuleScope?.value || 'all';
  alertRulePrinterField?.classList.toggle('hidden', scope !== 'printer');
  alertRuleGroupField?.classList.toggle('hidden', scope !== 'group');
  alertRuleModelField?.classList.toggle('hidden', scope !== 'model');
}

function updateDestinationProviderFields() {
  const provider = alertDestinationProvider?.value || 'ntfy';
  alertDestinationNtfyFields?.classList.toggle('hidden', provider !== 'ntfy');
  alertDestinationWebhookFields?.classList.toggle('hidden', provider !== 'webhook');
}

function resetDestinationForm() {
  alertDestinationForm?.reset();
  if (alertDestinationId) alertDestinationId.value = '';
  if (alertDestinationProvider) alertDestinationProvider.value = 'ntfy';
  if (alertDestinationEnabled) alertDestinationEnabled.checked = true;
  if (alertNtfyServer) alertNtfyServer.value = 'https://ntfy.sh';
  if (alertNtfyTopic) alertNtfyTopic.value = randomTopic();
  if (alertNtfyToken) {
    alertNtfyToken.value = '';
    alertNtfyToken.placeholder = 'Optional';
  }
  if (alertNtfyUsername) alertNtfyUsername.value = '';
  if (alertNtfyPassword) {
    alertNtfyPassword.value = '';
    alertNtfyPassword.placeholder = 'Optional';
  }
  if (alertWebhookUrl) alertWebhookUrl.value = '';
  if (alertWebhookAuthorization) {
    alertWebhookAuthorization.value = '';
    alertWebhookAuthorization.placeholder = 'Optional, for example Bearer ...';
  }
  if (alertDestinationSubmit) alertDestinationSubmit.textContent = 'Add destination';
  alertDestinationCancelEdit?.classList.add('hidden');
  updateDestinationProviderFields();
}

function resetRuleForm() {
  alertRuleForm?.reset();
  if (alertRuleId) alertRuleId.value = '';
  if (alertRuleEvent) alertRuleEvent.value = 'print.failed';
  if (alertRuleSeverity) alertRuleSeverity.value = 'critical';
  if (alertRuleScope) alertRuleScope.value = 'all';
  if (alertRuleEnabled) alertRuleEnabled.checked = true;
  if (alertRuleSubmit) alertRuleSubmit.textContent = 'Add rule';
  alertRuleCancelEdit?.classList.add('hidden');
  updateRuleScopeFields();
  renderRuleDestinationOptions([]);
}

function editDestination(id) {
  const destination = destinationById(id);
  if (!destination) return;
  const config = destination.config || {};
  alertDestinationId.value = destination.id;
  alertDestinationName.value = destination.name || '';
  alertDestinationProvider.value = destination.provider || 'ntfy';
  alertDestinationEnabled.checked = destination.enabled !== false;
  if (destination.provider === 'ntfy') {
    alertNtfyServer.value = config.server || 'https://ntfy.sh';
    alertNtfyTopic.value = config.topic || '';
    alertNtfyUsername.value = config.username || '';
    alertNtfyToken.value = '';
    alertNtfyPassword.value = '';
    alertNtfyToken.placeholder = config.hasToken ? 'Saved token — leave blank to keep' : 'Optional';
    alertNtfyPassword.placeholder = config.hasPassword ? 'Saved password — leave blank to keep' : 'Optional';
  } else {
    alertWebhookUrl.value = config.url || '';
    alertWebhookAuthorization.value = '';
    alertWebhookAuthorization.placeholder = config.hasAuthorization
      ? 'Saved authorization — leave blank to keep'
      : 'Optional, for example Bearer ...';
  }
  alertDestinationSubmit.textContent = 'Save destination';
  alertDestinationCancelEdit.classList.remove('hidden');
  updateDestinationProviderFields();
  alertDestinationForm.scrollIntoView({ behavior:'smooth', block:'start' });
}

function editRule(id) {
  const rule = alertUiState.rules.find((item) => item.id === id);
  if (!rule) return;
  alertRuleId.value = rule.id;
  alertRuleName.value = rule.name || '';
  alertRuleEvent.value = rule.eventTypes?.[0] || '*';
  alertRuleSeverity.value = rule.severities?.[0] || 'warning';
  alertRuleScope.value = rule.scope?.type || 'all';
  alertRuleEnabled.checked = rule.enabled !== false;
  updateRuleScopeFields();
  if (rule.scope?.type === 'printer') alertRulePrinter.value = rule.scope.printerId || '';
  if (rule.scope?.type === 'group') alertRuleGroup.value = rule.scope.groupId || '';
  if (rule.scope?.type === 'model') {
    alertRuleModel.value = `${encodeURIComponent(rule.scope.adapterType || '')}::${encodeURIComponent(rule.scope.model || '')}`;
  }
  renderRuleDestinationOptions(rule.destinationIds || []);
  alertRuleSubmit.textContent = 'Save rule';
  alertRuleCancelEdit.classList.remove('hidden');
  alertRuleForm.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function loadAlertUi({ preserveForms = false } = {}) {
  setStatus('Loading alerts…');
  showError();
  const [alertsResponse, printersResponse, groupsResponse, adaptersResponse] = await Promise.all([
    requestJson('/api/alerts?limit=100'),
    requestJson('/api/printers'),
    requestJson('/api/printer-groups'),
    requestJson('/api/adapters')
  ]);
  alertUiState = alertsResponse.alerts || alertUiState;
  alertPrinters = printersResponse.printers || [];
  alertGroups = groupsResponse.groups || [];
  alertAdapters = adaptersResponse.adapters || [];
  populateScopeOptions();
  renderAll();
  if (!preserveForms) {
    resetDestinationForm();
    resetRuleForm();
  }
  setStatus('');
}

function activateAlertsTab(name, focus = false) {
  const selected = alertTabs.find((tab) => tab.dataset.alertsTab === name) || alertTabs[0];
  if (!selected) return;
  const selectedName = selected.dataset.alertsTab;
  for (const tab of alertTabs) {
    const active = tab === selected;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of alertPanels) {
    const active = panel.dataset.alertsPanel === selectedName;
    panel.hidden = !active;
  }
  if (focus) selected.focus();
}

async function openAlerts(tab = 'history') {
  if (topbarOverflow) topbarOverflow.open = false;
  activateAlertsTab(tab);
  alertsDialog?.showModal();
  try {
    await loadAlertUi();
  } catch (error) {
    setStatus('');
    showError(error);
  }
}

function buildDestinationPayload() {
  const provider = alertDestinationProvider.value;
  const config = {};
  if (provider === 'ntfy') {
    config.server = alertNtfyServer.value.trim();
    config.topic = alertNtfyTopic.value.trim();
    config.username = alertNtfyUsername.value.trim();
    const token = alertNtfyToken.value.trim();
    const password = alertNtfyPassword.value;
    if (token) config.token = token;
    if (password) config.password = password;
  } else {
    config.url = alertWebhookUrl.value.trim();
    const authorization = alertWebhookAuthorization.value.trim();
    if (authorization) config.authorization = authorization;
  }
  return {
    name:alertDestinationName.value.trim(),
    provider,
    enabled:alertDestinationEnabled.checked,
    config
  };
}

function buildRulePayload() {
  const scopeType = alertRuleScope.value;
  let scope = { type:scopeType };
  if (scopeType === 'printer') scope = { type:'printer', printerId:alertRulePrinter.value };
  if (scopeType === 'group') scope = { type:'group', groupId:alertRuleGroup.value };
  if (scopeType === 'model') {
    const [adapterType, model] = String(alertRuleModel.value || '').split('::').map((value) => decodeURIComponent(value || ''));
    scope = { type:'model', adapterType, model };
  }
  const destinationIds = [...alertRuleDestinations.querySelectorAll('[data-alert-rule-destination]:checked')]
    .map((input) => input.value);
  return {
    name:alertRuleName.value.trim(),
    enabled:alertRuleEnabled.checked,
    eventTypes:[alertRuleEvent.value],
    severities:[alertRuleSeverity.value],
    scope,
    destinationIds
  };
}

alertsBtn?.addEventListener('click', () => openAlerts('history'));
alertsSettingsBtn?.addEventListener('click', () => openAlerts('rules'));
document.querySelectorAll('[data-alerts-close]').forEach((button) => button.addEventListener('click', () => alertsDialog?.close()));

for (const tab of alertTabs) {
  tab.addEventListener('click', () => activateAlertsTab(tab.dataset.alertsTab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = alertTabs.indexOf(tab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? alertTabs.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % alertTabs.length
          : (currentIndex - 1 + alertTabs.length) % alertTabs.length;
    activateAlertsTab(alertTabs[nextIndex]?.dataset.alertsTab, true);
  });
}

alertDestinationProvider?.addEventListener('change', updateDestinationProviderFields);
alertDestinationCancelEdit?.addEventListener('click', resetDestinationForm);
alertRuleScope?.addEventListener('change', updateRuleScopeFields);
alertRuleCancelEdit?.addEventListener('click', resetRuleForm);

alertDestinationForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError();
  const id = alertDestinationId.value;
  alertDestinationSubmit.disabled = true;
  try {
    await requestJson(id ? `/api/alerts/destinations/${encodeURIComponent(id)}` : '/api/alerts/destinations', {
      method:id ? 'PATCH' : 'POST',
      body:JSON.stringify(buildDestinationPayload())
    });
    await loadAlertUi();
    setStatus(id ? 'Notification destination updated.' : 'Notification destination added.');
  } catch (error) {
    showError(error);
  } finally {
    alertDestinationSubmit.disabled = false;
  }
});

alertRuleForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError();
  const id = alertRuleId.value;
  alertRuleSubmit.disabled = true;
  try {
    await requestJson(id ? `/api/alerts/rules/${encodeURIComponent(id)}` : '/api/alerts/rules', {
      method:id ? 'PATCH' : 'POST',
      body:JSON.stringify(buildRulePayload())
    });
    await loadAlertUi();
    setStatus(id ? 'Notification rule updated.' : 'Notification rule added.');
  } catch (error) {
    showError(error);
  } finally {
    alertRuleSubmit.disabled = false;
  }
});

alertsHistory?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-alert-mark-read]');
  if (!button) return;
  button.disabled = true;
  try {
    await requestJson('/api/alerts/mark-read', {
      method:'POST',
      body:JSON.stringify({ alertId:button.dataset.alertMarkRead })
    });
    await loadAlertUi({ preserveForms:true });
  } catch (error) {
    button.disabled = false;
    showError(error);
  }
});

alertsMarkAllReadBtn?.addEventListener('click', async () => {
  alertsMarkAllReadBtn.disabled = true;
  try {
    await requestJson('/api/alerts/mark-read', { method:'POST', body:'{}' });
    await loadAlertUi({ preserveForms:true });
    setStatus('All alerts marked as read.');
  } catch (error) {
    showError(error);
  } finally {
    if (alertUiState.unreadCount > 0) alertsMarkAllReadBtn.disabled = false;
  }
});

alertDestinationsList?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-alert-destination-edit]');
  if (edit) return editDestination(edit.dataset.alertDestinationEdit);

  const test = event.target.closest('[data-alert-destination-test]');
  if (test) {
    test.disabled = true;
    setStatus('Sending test notification…');
    showError();
    try {
      await requestJson(`/api/alerts/destinations/${encodeURIComponent(test.dataset.alertDestinationTest)}/test`, {
        method:'POST',
        body:'{}'
      });
      setStatus('Test notification sent.');
    } catch (error) {
      setStatus('');
      showError(error);
    } finally {
      test.disabled = false;
    }
    return;
  }

  const remove = event.target.closest('[data-alert-destination-delete]');
  if (!remove) return;
  const destination = destinationById(remove.dataset.alertDestinationDelete);
  if (!destination || !confirm(`Delete notification destination “${destination.name}”?`)) return;
  remove.disabled = true;
  try {
    await requestJson(`/api/alerts/destinations/${encodeURIComponent(destination.id)}`, { method:'DELETE' });
    await loadAlertUi();
    setStatus(`Deleted “${destination.name}”.`);
  } catch (error) {
    remove.disabled = false;
    showError(error);
  }
});

alertRulesList?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-alert-rule-edit]');
  if (edit) return editRule(edit.dataset.alertRuleEdit);

  const remove = event.target.closest('[data-alert-rule-delete]');
  if (!remove) return;
  const rule = alertUiState.rules.find((item) => item.id === remove.dataset.alertRuleDelete);
  if (!rule || !confirm(`Delete notification rule “${rule.name}”?`)) return;
  remove.disabled = true;
  try {
    await requestJson(`/api/alerts/rules/${encodeURIComponent(rule.id)}`, { method:'DELETE' });
    await loadAlertUi();
    setStatus(`Deleted “${rule.name}”.`);
  } catch (error) {
    remove.disabled = false;
    showError(error);
  }
});

window.addEventListener('pfc-alerts-live', (event) => {
  currentLiveSummary = event.detail || currentLiveSummary;
  if (!alertsDialog?.open) return;
  if (Number(currentLiveSummary.unreadCount || 0) !== Number(alertUiState.unreadCount || 0)) {
    loadAlertUi({ preserveForms:true }).catch(showError);
  }
});

resetDestinationForm();
resetRuleForm();
