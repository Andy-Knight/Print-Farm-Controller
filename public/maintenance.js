const button = document.querySelector('#maintenanceBtn');
const dialog = document.querySelector('#maintenanceDialog');
const closeButtons = document.querySelectorAll('[data-maintenance-close]');
const list = document.querySelector('#maintenanceList');
const statusEl = document.querySelector('#maintenanceStatus');
const errorEl = document.querySelector('#maintenanceError');
const form = document.querySelector('#maintenanceTaskForm');
const assignmentScopeInput = document.querySelector('#maintenanceAssignmentScope');
const printerField = document.querySelector('#maintenancePrinterField');
const printerSelect = document.querySelector('#maintenancePrinter');
const modelField = document.querySelector('#maintenanceModelField');
const modelSelect = document.querySelector('#maintenanceModel');
const taskIdInput = document.querySelector('#maintenanceTaskId');
const nameInput = document.querySelector('#maintenanceName');
const descriptionInput = document.querySelector('#maintenanceDescription');
const typeInput = document.querySelector('#maintenanceType');
const intervalInput = document.querySelector('#maintenanceInterval');
const enabledInput = document.querySelector('#maintenanceEnabled');
const formTitle = document.querySelector('#maintenanceFormTitle');
const submitButton = document.querySelector('#maintenanceSubmitBtn');
const cancelEditButton = document.querySelector('#maintenanceCancelEdit');
const viewButtons = [...document.querySelectorAll('[data-maintenance-view]')];

let printers = [];
let adapters = [];
let maintenance = { modelTasks:[], printers:[] };
let activeMaintenanceView = 'printers';
let revealedModelCompletionPrinterIds = [];
let revealedModelCompletionHistoryIds = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers:options.body ? { 'content-type':'application/json', ...(options.headers || {}) } : options.headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatHours(value) {
  const hours = Number(value || 0);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function scheduleLabel(task) {
  const interval = Number(task.schedule?.interval || 0);
  if (task.schedule?.type === 'days') return `Every ${interval} day${interval === 1 ? '' : 's'}`;
  if (task.schedule?.type === 'print_hours') return `Every ${interval} print hour${interval === 1 ? '' : 's'}`;
  return `Every ${interval} print${interval === 1 ? '' : 's'}`;
}

function remainingLabel(task) {
  const status = task.status || {};
  if (status.state === 'disabled') return 'Disabled';
  if (status.state === 'due') return 'Due now';
  if (task.schedule?.type === 'days') {
    const days = Number(status.remaining || 0);
    return `${Math.max(0, Math.ceil(days))} day${Math.ceil(days) === 1 ? '' : 's'} remaining`;
  }
  if (task.schedule?.type === 'print_hours') return `${formatHours(status.remaining)} remaining`;
  const count = Math.max(0, Math.ceil(Number(status.remaining || 0)));
  return `${count} print${count === 1 ? '' : 's'} remaining`;
}

function statusLabel(value) {
  if (value === 'due') return 'Due';
  if (value === 'due_soon') return 'Due soon';
  if (value === 'disabled') return 'Disabled';
  return 'Current';
}

function modelTargets() {
  return adapters.flatMap((adapter) => (adapter.models || []).map((model) => ({
    adapterType:adapter.type,
    model:String(model),
    manufacturer:adapter.manufacturer || adapter.label || adapter.type,
    label:`${adapter.manufacturer || adapter.label || adapter.type} · ${model}`
  })));
}

function targetKey(target) {
  return `${String(target?.adapterType || '')}::${String(target?.model || '')}`;
}

function targetFromKey(value) {
  const target = modelTargets().find((item) => targetKey(item) === String(value || ''));
  return target ? { adapterType:target.adapterType, model:target.model } : null;
}

function modelLabel(target) {
  return modelTargets().find((item) => targetKey(item) === targetKey(target))?.label
    || [target?.adapterType, target?.model].filter(Boolean).join(' · ')
    || 'Unknown model';
}

function assignmentLabel(task, printer = null) {
  if (task.assignment?.scope === 'model') return `Model · ${modelLabel(task.assignment)}`;
  return printer ? `Printer · ${printer.printerName}` : 'Individual printer';
}

function modelTaskSection() {
  const tasks = [...(maintenance.modelTasks || [])].sort((a, b) =>
    modelLabel(a.assignment || a.target).localeCompare(modelLabel(b.assignment || b.target))
    || String(a.name).localeCompare(String(b.name))
  );
  if (!tasks.length) return '';

  return `
    <section class="maintenance-model-rules">
      <div class="maintenance-model-rules-head">
        <div>
          <h3>Model-wide maintenance rules</h3>
          <div class="subtle">Inherited automatically by every current and future printer of the selected model. Completion state remains independent per printer.</div>
        </div>
        <span class="maintenance-pill">${tasks.length} shared</span>
      </div>
      <div class="maintenance-model-rule-list">
        ${tasks.map((task) => {
          const completion = task.completionSummary || {};
          const matching = Number(completion.matching || 0);
          const eligible = Number(completion.eligible || 0);
          const locked = Number(completion.locked || 0);
          return `
          <article class="maintenance-model-rule">
            <div class="maintenance-task-main">
              <div class="maintenance-task-title-row">
                <strong>${escapeHtml(task.name)}</strong>
                <span class="maintenance-scope-pill">Model · ${escapeHtml(modelLabel(task.assignment || task.target))}</span>
                ${task.enabled === false ? '<span class="maintenance-pill" data-state="disabled">Disabled</span>' : ''}
              </div>
              ${task.description ? `<div class="maintenance-task-description">${escapeHtml(task.description)}</div>` : ''}
              <div class="maintenance-task-meta">
                <span>${escapeHtml(scheduleLabel(task))}</span>
                <span>Applies to matching printers automatically</span>
                <span>${matching} matching · ${eligible} ready${locked ? ` · ${locked} locked` : ''}</span>
              </div>
            </div>
            <div class="mini-actions maintenance-task-actions">
              <button type="button" class="primary" data-maintenance-complete-model data-task-id="${escapeHtml(task.id)}" ${eligible <= 0 ? `disabled aria-disabled="true" title="${escapeHtml(matching ? 'No matching printers are currently eligible for completion' : 'No matching printers are configured')}"` : ''}>Complete for model</button>
              <button type="button" class="secondary" data-maintenance-edit data-task-scope="model" data-task-id="${escapeHtml(task.id)}">Edit rule</button>
              <button type="button" class="danger" data-maintenance-delete data-task-scope="model" data-task-id="${escapeHtml(task.id)}">Delete rule</button>
            </div>
          </article>
        `;
        }).join('')}
      </div>
    </section>
  `;
}

function printerCardsMarkup() {
  if (!maintenance.printers?.length) {
    return '<div class="empty maintenance-empty"><h3>No printers configured</h3><p>Model-wide tasks can still be configured now and will be inherited when matching printers are added.</p></div>';
  }

  return maintenance.printers.map((printer) => {
    const revealModelCompletion = revealedModelCompletionPrinterIds.includes(printer.printerId);
    const tasks = [...(printer.tasks || [])].sort((a, b) => {
      const rank = { due:0, due_soon:1, current:2, disabled:3 };
      return (rank[a.status?.state] ?? 9) - (rank[b.status?.state] ?? 9)
        || String(a.name).localeCompare(String(b.name));
    });
    const history = (printer.history || []).slice(0, 5);

    return `
      <section class="maintenance-printer-card${revealModelCompletion ? ' maintenance-printer-card-model-completed' : ''}" data-maintenance-printer-card="${escapeHtml(printer.printerId)}" tabindex="-1">
        <div class="maintenance-printer-head">
          <div>
            <h3>${escapeHtml(printer.printerName)}</h3>
            <div class="subtle">${escapeHtml([printer.manufacturer, printer.model].filter(Boolean).join(' '))}</div>
          </div>
          <div class="maintenance-summary-badges">
            <span class="maintenance-pill" data-state="due">${Number(printer.summary?.due || 0)} due</span>
            <span class="maintenance-pill" data-state="due_soon">${Number(printer.summary?.dueSoon || 0)} soon</span>
          </div>
        </div>

        <div class="maintenance-usage">
          <div><span>Observed print time</span><strong>${formatHours(printer.usage?.printHours)}</strong></div>
          <div><span>Observed print cycles</span><strong>${Number(printer.usage?.printCount || 0)}</strong></div>
          <div><span>Tracking</span><strong>Controller observed</strong></div>
        </div>

        <div class="maintenance-task-list">
          ${tasks.length ? tasks.map((task) => `
            <article class="maintenance-task" data-state="${escapeHtml(task.status?.state || 'current')}">
              <div class="maintenance-task-main">
                <div class="maintenance-task-title-row">
                  <strong>${escapeHtml(task.name)}</strong>
                  <span class="maintenance-pill" data-state="${escapeHtml(task.status?.state || 'current')}">${statusLabel(task.status?.state)}</span>
                  <span class="maintenance-scope-pill">${escapeHtml(assignmentLabel(task, printer))}</span>
                </div>
                ${task.description ? `<div class="maintenance-task-description">${escapeHtml(task.description)}</div>` : ''}
                <div class="maintenance-task-meta">
                  <span>${escapeHtml(scheduleLabel(task))}</span>
                  <span>${escapeHtml(remainingLabel(task))}</span>
                  <span>Last completed: ${escapeHtml(formatDate(task.lastCompletedAt))}</span>
                  ${task.lastCompletedAt && task.completionAllowed === false ? '<span>Complete again when Due soon (80%)</span>' : ''}
                  ${task.assignment?.scope === 'model' ? `<span>Assigned to this printer: ${escapeHtml(formatDate(task.assignedAt))}</span>` : ''}
                </div>
              </div>
              <div class="mini-actions maintenance-task-actions">
                <button type="button" class="primary" data-maintenance-complete data-task-scope="${escapeHtml(task.assignment?.scope || 'printer')}" data-printer-id="${escapeHtml(printer.printerId)}" data-task-id="${escapeHtml(task.id)}" ${task.completionAllowed === false ? `disabled aria-disabled="true" title="${escapeHtml(task.completionReason || 'This maintenance task cannot be completed yet')}"` : ''}>Complete</button>
                <button type="button" class="secondary" data-maintenance-edit data-task-scope="${escapeHtml(task.assignment?.scope || 'printer')}" data-printer-id="${escapeHtml(printer.printerId)}" data-task-id="${escapeHtml(task.id)}">${task.assignment?.scope === 'model' ? 'Edit model rule' : 'Edit'}</button>
                <button type="button" class="danger" data-maintenance-delete data-task-scope="${escapeHtml(task.assignment?.scope || 'printer')}" data-printer-id="${escapeHtml(printer.printerId)}" data-task-id="${escapeHtml(task.id)}">${task.assignment?.scope === 'model' ? 'Delete model rule' : 'Delete'}</button>
              </div>
            </article>
          `).join('') : '<div class="subtle maintenance-no-tasks">No maintenance tasks configured for this printer.</div>'}
        </div>

        <details class="maintenance-history" ${revealModelCompletion ? 'open' : ''}>
          <summary>Recent maintenance history (${Number(printer.history?.length || 0)})</summary>
          <div class="maintenance-history-list">
            ${history.length ? history.map((entry) => `
              <div class="maintenance-history-entry${revealedModelCompletionHistoryIds.includes(entry.id) ? ' maintenance-history-entry-new' : ''}">
                <strong>${escapeHtml(entry.taskName)}</strong>
                <span>${escapeHtml(formatDate(entry.completedAt))}</span>
                <span>${formatHours(Number(entry.usageSnapshot?.printHours || 0))} / ${Number(entry.usageSnapshot?.printCount || 0)} prints</span>
                <small class="maintenance-history-scope">${escapeHtml(entry.assignment?.scope === 'model' ? `Model · ${modelLabel(entry.assignment)}` : 'Individual printer')}</small>
                ${entry.notes ? `<div>${escapeHtml(entry.notes)}</div>` : ''}
              </div>
            `).join('') : '<div class="subtle">No maintenance has been recorded yet.</div>'}
          </div>
        </details>
      </section>
    `;
  }).join('');
}

function render() {
  if (!list) return;
  form?.classList.toggle('hidden', activeMaintenanceView !== 'add');
  list.classList.toggle('hidden', activeMaintenanceView === 'add');
  if (activeMaintenanceView === 'model') {
    list.innerHTML = modelTaskSection() || '<div class="empty maintenance-empty"><h3>No model-wide maintenance rules</h3><p>Create a model-wide rule from Add maintenance tasks.</p></div>';
    return;
  }
  if (activeMaintenanceView === 'printers') {
    list.innerHTML = printerCardsMarkup();
    return;
  }
  list.innerHTML = '';
}

function setMaintenanceView(view) {
  const next = ['add', 'model', 'printers'].includes(view) ? view : 'printers';
  activeMaintenanceView = next;
  for (const button of viewButtons) {
    const active = button.dataset.maintenanceView === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  render();
}

function populatePrinters() {
  if (!printerSelect) return;
  const previous = printerSelect.value;
  printerSelect.innerHTML = printers.length
    ? printers.map((printer) => `<option value="${escapeHtml(printer.id)}">${escapeHtml(printer.name)}</option>`).join('')
    : '<option value="">No printers configured</option>';
  if (printers.some((printer) => printer.id === previous)) printerSelect.value = previous;
}

function populateModels() {
  if (!modelSelect) return;
  const previous = modelSelect.value;
  const targets = modelTargets();
  modelSelect.innerHTML = targets.length
    ? targets.map((target) => `<option value="${escapeHtml(targetKey(target))}">${escapeHtml(target.label)}</option>`).join('')
    : '<option value="">No supported models available</option>';
  if (targets.some((target) => targetKey(target) === previous)) modelSelect.value = previous;
}

function updateAssignmentFields() {
  const scope = assignmentScopeInput?.value === 'model' ? 'model' : 'printer';
  printerField?.classList.toggle('hidden', scope !== 'printer');
  modelField?.classList.toggle('hidden', scope !== 'model');
  if (printerSelect) printerSelect.required = scope === 'printer';
  if (modelSelect) modelSelect.required = scope === 'model';
}

function resetForm() {
  form?.reset();
  if (taskIdInput) taskIdInput.value = '';
  if (formTitle) formTitle.textContent = 'Add maintenance task';
  if (submitButton) submitButton.textContent = 'Add task';
  cancelEditButton?.classList.add('hidden');
  if (assignmentScopeInput) {
    assignmentScopeInput.value = printers.length ? 'printer' : 'model';
    assignmentScopeInput.disabled = false;
  }
  if (printerSelect) printerSelect.disabled = false;
  if (modelSelect) modelSelect.disabled = false;
  if (enabledInput) enabledInput.checked = true;
  if (typeInput) typeInput.value = 'days';
  if (intervalInput) intervalInput.value = '30';
  updateAssignmentFields();
}

async function refresh() {
  if (statusEl) statusEl.textContent = 'Loading maintenance data…';
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
  try {
    const [printerResult, maintenanceResult, adapterResult] = await Promise.all([
      api('/api/printers'),
      api('/api/maintenance'),
      api('/api/adapters')
    ]);
    printers = printerResult.printers || [];
    maintenance = maintenanceResult.maintenance || { modelTasks:[], printers:[] };
    adapters = adapterResult.adapters || [];
    populatePrinters();
    populateModels();
    updateAssignmentFields();
    render();
    if (statusEl) statusEl.textContent = '';
  } catch (error) {
    if (statusEl) statusEl.textContent = '';
    if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
    throw error;
  }
}

function findModelTask(taskId) {
  return maintenance.modelTasks?.find((item) => item.id === taskId) || null;
}

function findPrinterTask(printerId, taskId) {
  const record = maintenance.printers?.find((item) => item.printerId === printerId);
  return {
    record,
    task:record?.tasks?.find((item) => item.id === taskId) || null
  };
}

function beginEdit(scope, task, printerId = '') {
  if (!task) return;
  setMaintenanceView('add');
  assignmentScopeInput.value = scope;
  assignmentScopeInput.disabled = true;
  taskIdInput.value = task.id;
  nameInput.value = task.name || '';
  descriptionInput.value = task.description || '';
  typeInput.value = task.schedule?.type || 'days';
  intervalInput.value = task.schedule?.interval || 1;
  enabledInput.checked = task.enabled !== false;

  if (scope === 'model') {
    const target = task.assignment || task.target;
    modelSelect.value = targetKey(target);
    printerSelect.disabled = true;
    modelSelect.disabled = false;
    formTitle.textContent = 'Edit model-wide maintenance rule';
  } else {
    printerSelect.value = printerId;
    printerSelect.disabled = true;
    modelSelect.disabled = true;
    formTitle.textContent = 'Edit printer maintenance task';
  }

  submitButton.textContent = 'Save changes';
  cancelEditButton?.classList.remove('hidden');
  updateAssignmentFields();
  form?.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function openForPrinter(printerId) {
  const id = String(printerId || '');
  if (!id) return;
  if (!dialog?.open) dialog?.showModal();
  resetForm();
  setMaintenanceView('printers');
  await refresh().catch(() => {});

  if (printers.some((printer) => printer.id === id)) {
    if (assignmentScopeInput) assignmentScopeInput.value = 'printer';
    if (printerSelect) printerSelect.value = id;
    updateAssignmentFields();
  }

  const target = [...(list?.querySelectorAll?.('[data-maintenance-printer-card]') || [])]
    .find((card) => card.dataset.maintenancePrinterCard === id);
  if (!target) return;

  for (const card of list.querySelectorAll('[data-maintenance-printer-card]')) {
    card.classList.remove('maintenance-printer-card-target');
  }
  target.classList.add('maintenance-printer-card-target');
  target.focus({ preventScroll:true });
  target.scrollIntoView({ behavior:'smooth', block:'center' });

  window.setTimeout(() => {
    target.classList.remove('maintenance-printer-card-target');
  }, 2400);
}

button?.addEventListener('click', async () => {
  dialog?.showModal();
  revealedModelCompletionPrinterIds = [];
  revealedModelCompletionHistoryIds = [];
  activeMaintenanceView = 'printers';
  await refresh().catch(() => {});
  resetForm();
  setMaintenanceView('printers');
});

window.addEventListener('pfc:open-maintenance', (event) => {
  openForPrinter(event.detail?.printerId).catch(() => {});
});

for (const close of closeButtons) close.addEventListener('click', () => dialog?.close());
for (const viewButton of viewButtons) {
  viewButton.addEventListener('click', () => {
    if (viewButton.dataset.maintenanceView === 'add') resetForm();
    setMaintenanceView(viewButton.dataset.maintenanceView);
  });
}
assignmentScopeInput?.addEventListener('change', updateAssignmentFields);
cancelEditButton?.addEventListener('click', () => resetForm());

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const scope = assignmentScopeInput?.value === 'model' ? 'model' : 'printer';
  const taskId = taskIdInput?.value || '';
  const payload = {
    name:nameInput?.value || '',
    description:descriptionInput?.value || '',
    schedule:{
      type:typeInput?.value || 'days',
      interval:Number(intervalInput?.value || 0)
    },
    enabled:enabledInput?.checked !== false
  };

  let url;
  let method = taskId ? 'PATCH' : 'POST';
  if (scope === 'model') {
    const target = targetFromKey(modelSelect?.value);
    if (!target) {
      if (errorEl) { errorEl.textContent = 'Choose a printer model'; errorEl.classList.remove('hidden'); }
      return;
    }
    payload.target = target;
    url = taskId
      ? `/api/maintenance/model-tasks/${encodeURIComponent(taskId)}`
      : '/api/maintenance/model-tasks';
  } else {
    const printerId = printerSelect?.value;
    if (!printerId) {
      if (errorEl) { errorEl.textContent = 'Choose a printer'; errorEl.classList.remove('hidden'); }
      return;
    }
    url = taskId
      ? `/api/printers/${encodeURIComponent(printerId)}/maintenance/tasks/${encodeURIComponent(taskId)}`
      : `/api/printers/${encodeURIComponent(printerId)}/maintenance/tasks`;
  }

  submitButton.disabled = true;
  try {
    await api(url, { method, body:JSON.stringify(payload) });
    const completedScope = scope;
    await refresh();
    resetForm();
    setMaintenanceView(completedScope === 'model' ? 'model' : 'printers');
  } catch (error) {
    if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
  } finally {
    submitButton.disabled = false;
  }
});

list?.addEventListener('click', async (event) => {
  const completeModel = event.target.closest('[data-maintenance-complete-model]');
  const complete = event.target.closest('[data-maintenance-complete]');
  const edit = event.target.closest('[data-maintenance-edit]');
  const remove = event.target.closest('[data-maintenance-delete]');
  const action = completeModel || complete || edit || remove;
  if (!action) return;

  const scope = completeModel || action.dataset.taskScope === 'model' ? 'model' : 'printer';
  const printerId = action.dataset.printerId || '';
  const taskId = action.dataset.taskId;
  const { record, task:effectiveTask } = printerId ? findPrinterTask(printerId, taskId) : { record:null, task:null };
  const task = scope === 'model' ? (findModelTask(taskId) || effectiveTask) : effectiveTask;
  if (!task) return;

  if (completeModel) {
    const summary = task.completionSummary || {};
    const matching = Number(summary.matching || 0);
    const eligible = Number(summary.eligible || 0);
    const locked = Number(summary.locked || 0);
    if (eligible <= 0) return;
    const notes = prompt(
      `Complete “${task.name}” for ${eligible} eligible ${modelLabel(task.assignment || task.target)} printer${eligible === 1 ? '' : 's'}?`
      + (locked ? `\n\n${locked} matching printer${locked === 1 ? '' : 's'} ${locked === 1 ? 'is' : 'are'} not yet Due soon and will be skipped.` : '')
      + '\n\nOptional maintenance notes:',
      ''
    );
    if (notes === null) return;
    completeModel.disabled = true;
    try {
      const result = await api(`/api/maintenance/model-tasks/${encodeURIComponent(taskId)}/complete`, {
        method:'POST',
        body:JSON.stringify({ notes })
      });
      const completedPrinters = Array.isArray(result.completed) ? result.completed : [];
      revealedModelCompletionPrinterIds = completedPrinters.map((item) => item.printerId).filter(Boolean);
      revealedModelCompletionHistoryIds = completedPrinters.map((item) => item.history?.id).filter(Boolean);
      await refresh();
      const completedCount = Number(result.summary?.completed || 0);
      const skippedCount = Number(result.summary?.skipped || 0);
      if (completedCount > 0) {
        setMaintenanceView('printers');
        const firstUpdated = list?.querySelector('.maintenance-printer-card-model-completed');
        firstUpdated?.scrollIntoView({ behavior:'smooth', block:'center' });
      }
      if (statusEl) {
        statusEl.textContent = `Completed “${task.name}” on ${completedCount} printer${completedCount === 1 ? '' : 's'}`
          + (skippedCount ? `; ${skippedCount} skipped because ${skippedCount === 1 ? 'it was' : 'they were'} not yet eligible.` : '.');
      }
    } catch (error) {
      completeModel.disabled = false;
      if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
    }
    return;
  }

  if (edit) {
    beginEdit(scope, task, printerId);
    return;
  }

  if (remove) {
    const message = scope === 'model'
      ? `Delete model-wide maintenance rule “${task.name}”?\n\nIt will be removed from every current and future matching printer. Existing completed maintenance history will be retained on each printer.`
      : `Delete maintenance task “${task.name}”? Its completed maintenance history will be retained.`;
    if (!confirm(message)) return;
    try {
      const url = scope === 'model'
        ? `/api/maintenance/model-tasks/${encodeURIComponent(taskId)}`
        : `/api/printers/${encodeURIComponent(printerId)}/maintenance/tasks/${encodeURIComponent(taskId)}`;
      await api(url, { method:'DELETE' });
      await refresh();
      resetForm();
    } catch (error) {
      if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
    }
    return;
  }

  if (!record || !effectiveTask) return;
  const notes = prompt(`Complete “${effectiveTask.name}” for ${record.printerName}?\n\nOptional maintenance notes:`, '');
  if (notes === null) return;
  try {
    await api(`/api/printers/${encodeURIComponent(printerId)}/maintenance/tasks/${encodeURIComponent(taskId)}/complete`, {
      method:'POST',
      body:JSON.stringify({ notes })
    });
    await refresh();
  } catch (error) {
    if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
  }
});
