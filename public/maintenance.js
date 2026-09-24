const button = document.querySelector('#maintenanceBtn');
const dialog = document.querySelector('#maintenanceDialog');
const closeButtons = document.querySelectorAll('[data-maintenance-close]');
const list = document.querySelector('#maintenanceList');
const statusEl = document.querySelector('#maintenanceStatus');
const errorEl = document.querySelector('#maintenanceError');
const form = document.querySelector('#maintenanceTaskForm');
const printerSelect = document.querySelector('#maintenancePrinter');
const taskIdInput = document.querySelector('#maintenanceTaskId');
const nameInput = document.querySelector('#maintenanceName');
const descriptionInput = document.querySelector('#maintenanceDescription');
const typeInput = document.querySelector('#maintenanceType');
const intervalInput = document.querySelector('#maintenanceInterval');
const enabledInput = document.querySelector('#maintenanceEnabled');
const formTitle = document.querySelector('#maintenanceFormTitle');
const submitButton = document.querySelector('#maintenanceSubmitBtn');
const cancelEditButton = document.querySelector('#maintenanceCancelEdit');

let printers = [];
let maintenance = { printers:[] };

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

function render() {
  if (!list) return;
  if (!maintenance.printers?.length) {
    list.innerHTML = '<div class="empty maintenance-empty"><h3>No printers configured</h3><p>Add a printer before creating maintenance tasks.</p></div>';
    return;
  }

  list.innerHTML = maintenance.printers.map((printer) => {
    const tasks = [...(printer.tasks || [])].sort((a, b) => {
      const rank = { due:0, due_soon:1, current:2, disabled:3 };
      return (rank[a.status?.state] ?? 9) - (rank[b.status?.state] ?? 9)
        || String(a.name).localeCompare(String(b.name));
    });
    const history = (printer.history || []).slice(0, 5);

    return `
      <section class="maintenance-printer-card">
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
                </div>
                ${task.description ? `<div class="maintenance-task-description">${escapeHtml(task.description)}</div>` : ''}
                <div class="maintenance-task-meta">
                  <span>${escapeHtml(scheduleLabel(task))}</span>
                  <span>${escapeHtml(remainingLabel(task))}</span>
                  <span>Last completed: ${escapeHtml(formatDate(task.lastCompletedAt))}</span>
                </div>
              </div>
              <div class="mini-actions maintenance-task-actions">
                <button type="button" class="primary" data-maintenance-complete data-printer-id="${escapeHtml(printer.printerId)}" data-task-id="${escapeHtml(task.id)}">Complete</button>
                <button type="button" class="secondary" data-maintenance-edit data-printer-id="${escapeHtml(printer.printerId)}" data-task-id="${escapeHtml(task.id)}">Edit</button>
                <button type="button" class="danger" data-maintenance-delete data-printer-id="${escapeHtml(printer.printerId)}" data-task-id="${escapeHtml(task.id)}">Delete</button>
              </div>
            </article>
          `).join('') : '<div class="subtle maintenance-no-tasks">No maintenance tasks configured for this printer.</div>'}
        </div>

        <details class="maintenance-history">
          <summary>Recent maintenance history (${Number(printer.history?.length || 0)})</summary>
          <div class="maintenance-history-list">
            ${history.length ? history.map((entry) => `
              <div class="maintenance-history-entry">
                <strong>${escapeHtml(entry.taskName)}</strong>
                <span>${escapeHtml(formatDate(entry.completedAt))}</span>
                <span>${formatHours(Number(entry.usageSnapshot?.printHours || 0))} / ${Number(entry.usageSnapshot?.printCount || 0)} prints</span>
                ${entry.notes ? `<div>${escapeHtml(entry.notes)}</div>` : ''}
              </div>
            `).join('') : '<div class="subtle">No maintenance has been recorded yet.</div>'}
          </div>
        </details>
      </section>
    `;
  }).join('');
}

function populatePrinters() {
  if (!printerSelect) return;
  const previous = printerSelect.value;
  printerSelect.innerHTML = printers
    .map((printer) => `<option value="${escapeHtml(printer.id)}">${escapeHtml(printer.name)}</option>`)
    .join('');
  if (printers.some((printer) => printer.id === previous)) printerSelect.value = previous;
}

function resetForm() {
  form?.reset();
  if (taskIdInput) taskIdInput.value = '';
  if (formTitle) formTitle.textContent = 'Add maintenance task';
  if (submitButton) submitButton.textContent = 'Add task';
  cancelEditButton?.classList.add('hidden');
  if (enabledInput) enabledInput.checked = true;
  if (typeInput) typeInput.value = 'days';
  if (intervalInput) intervalInput.value = '30';
}

async function refresh() {
  if (statusEl) statusEl.textContent = 'Loading maintenance data…';
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
  try {
    const [printerResult, maintenanceResult] = await Promise.all([
      api('/api/printers'),
      api('/api/maintenance')
    ]);
    printers = printerResult.printers || [];
    maintenance = maintenanceResult.maintenance || { printers:[] };
    populatePrinters();
    render();
    if (statusEl) statusEl.textContent = '';
  } catch (error) {
    if (statusEl) statusEl.textContent = '';
    if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
    throw error;
  }
}

button?.addEventListener('click', async () => {
  dialog?.showModal();
  resetForm();
  await refresh().catch(() => {});
});

for (const close of closeButtons) close.addEventListener('click', () => dialog?.close());

cancelEditButton?.addEventListener('click', () => resetForm());

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const printerId = printerSelect?.value;
  if (!printerId) return;
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
  submitButton.disabled = true;
  try {
    await api(
      taskId
        ? `/api/printers/${encodeURIComponent(printerId)}/maintenance/tasks/${encodeURIComponent(taskId)}`
        : `/api/printers/${encodeURIComponent(printerId)}/maintenance/tasks`,
      { method:taskId ? 'PATCH' : 'POST', body:JSON.stringify(payload) }
    );
    resetForm();
    await refresh();
  } catch (error) {
    if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
  } finally {
    submitButton.disabled = false;
  }
});

list?.addEventListener('click', async (event) => {
  const complete = event.target.closest('[data-maintenance-complete]');
  const edit = event.target.closest('[data-maintenance-edit]');
  const remove = event.target.closest('[data-maintenance-delete]');
  const action = complete || edit || remove;
  if (!action) return;
  const printerId = action.dataset.printerId;
  const taskId = action.dataset.taskId;
  const record = maintenance.printers?.find((item) => item.printerId === printerId);
  const task = record?.tasks?.find((item) => item.id === taskId);
  if (!record || !task) return;

  if (edit) {
    printerSelect.value = printerId;
    taskIdInput.value = task.id;
    nameInput.value = task.name || '';
    descriptionInput.value = task.description || '';
    typeInput.value = task.schedule?.type || 'days';
    intervalInput.value = task.schedule?.interval || 1;
    enabledInput.checked = task.enabled !== false;
    formTitle.textContent = 'Edit maintenance task';
    submitButton.textContent = 'Save changes';
    cancelEditButton?.classList.remove('hidden');
    form?.scrollIntoView({ behavior:'smooth', block:'start' });
    return;
  }

  if (remove) {
    if (!confirm(`Delete maintenance task “${task.name}”? Its completed maintenance history will be retained.`)) return;
    try {
      await api(`/api/printers/${encodeURIComponent(printerId)}/maintenance/tasks/${encodeURIComponent(taskId)}`, { method:'DELETE' });
      await refresh();
    } catch (error) {
      if (errorEl) { errorEl.textContent = error.message; errorEl.classList.remove('hidden'); }
    }
    return;
  }

  const notes = prompt(`Complete “${task.name}” for ${record.printerName}?\n\nOptional maintenance notes:`, '');
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
