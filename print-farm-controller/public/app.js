const fleetEl = document.querySelector('#fleet');
const summaryEl = document.querySelector('#summary');
const emptyEl = document.querySelector('#empty');
const addDialog = document.querySelector('#addPrinterDialog');
const addForm = document.querySelector('#addPrinterForm');
const printerDialog = document.querySelector('#printerDialog');
const printerDetail = document.querySelector('#printerDetail');
const formError = document.querySelector('#formError');
const scanNetworkBtn = document.querySelector('#scanNetworkBtn');
const discoveryStatus = document.querySelector('#discoveryStatus');
const discoveryResults = document.querySelector('#discoveryResults');
const liveIndicator = document.querySelector('#liveIndicator');
const controllerVersionEl = document.querySelector('#controllerVersion');
const controllerEditionEl = document.querySelector('#controllerEdition');
const licenseNoticeEl = document.querySelector('#licenseNotice');
const licenseBtn = document.querySelector('#licenseBtn');
const licenseDialog = document.querySelector('#licenseDialog');
const licenseDetails = document.querySelector('#licenseDetails');
const licenseInstallForm = document.querySelector('#licenseInstallForm');
const licenseFileInput = document.querySelector('#licenseFileInput');
const licenseInstallStatus = document.querySelector('#licenseInstallStatus');
const licenseInstallError = document.querySelector('#licenseInstallError');
const batchModeBtn = document.querySelector('#batchModeBtn');
const batchToolbar = document.querySelector('#batchToolbar');
const batchSelectedCount = document.querySelector('#batchSelectedCount');
const batchResult = document.querySelector('#batchResult');
const batchActionDialog = document.querySelector('#batchActionDialog');
const batchActionForm = document.querySelector('#batchActionForm');
const batchActionTitle = document.querySelector('#batchActionTitle');
const batchActionSubtitle = document.querySelector('#batchActionSubtitle');
const batchActionFields = document.querySelector('#batchActionFields');
const batchActionError = document.querySelector('#batchActionError');
const adapterTypeSelect = document.querySelector('#adapterTypeSelect');
const adapterFields = document.querySelector('#adapterFields');
const libraryBtn = document.querySelector('#libraryBtn');
const libraryButtonCount = document.querySelector('#libraryButtonCount');
const libraryDialog = document.querySelector('#libraryDialog');
const librarySummary = document.querySelector('#librarySummary');
const librarySearchInput = document.querySelector('#librarySearchInput');
const libraryFileInput = document.querySelector('#libraryFileInput');
const libraryUploadBtn = document.querySelector('#libraryUploadBtn');
const libraryStatus = document.querySelector('#libraryStatus');
const libraryError = document.querySelector('#libraryError');
const libraryList = document.querySelector('#libraryList');
const queueBtn = document.querySelector('#queueBtn');
const queueButtonCount = document.querySelector('#queueButtonCount');
const queueDialog = document.querySelector('#queueDialog');
const queueSummary = document.querySelector('#queueSummary');
const queueActiveList = document.querySelector('#queueActiveList');
const queueHistoryList = document.querySelector('#queueHistoryList');
const clearQueueHistoryBtn = document.querySelector('#clearQueueHistoryBtn');
const queueAddFileBtn = document.querySelector('#queueAddFileBtn');
const queueAddDialog = document.querySelector('#queueAddDialog');
const queueAddForm = document.querySelector('#queueAddForm');
const queueAddFileInput = document.querySelector('#queueAddFileInput');
const queueAddFileField = document.querySelector('#queueAddFileField');
const queueAddSelectedFile = document.querySelector('#queueAddSelectedFile');
const queueAddStatus = document.querySelector('#queueAddStatus');
const queueAddError = document.querySelector('#queueAddError');
const themeToggle = document.querySelector('#themeToggle');
const themeColorMeta = document.querySelector('#themeColorMeta');

let fleet = [];
let adapters = [];
let queueState = { jobs:[], queued:0, active:0, history:0, needsReview:0, awaitingClearance:0, bedClearance:[], productionBatches:[] };
let libraryState = { files:[] };
let queueAddLibraryFile = null;
let licenseState = null;
let eventSource = null;
let currentPrinterId = null;
let lastDiscoveryAt = 0;
let reorderInProgress = false;
let reorderSaveTimer = null;
let selectionMode = false;
let batchBusy = false;
let pendingBatchAction = null;
const selectedPrinterIds = new Set();
const toolOffsetActionLocks = new Map();

const THEME_STORAGE_KEY = 'printer-fleet-theme';
const themeMedia = window.matchMedia('(prefers-color-scheme: light)');

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme, { persist = false } = {}) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  themeColorMeta?.setAttribute('content', next === 'light' ? '#eef3f7' : '#0c1015');
  if (themeToggle) {
    const dark = next === 'dark';
    themeToggle.setAttribute('aria-checked', String(dark));
    themeToggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    const label = themeToggle.querySelector('.theme-toggle-label');
    if (label) label.textContent = dark ? 'Dark' : 'Light';
  }
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
  }
}

applyTheme(document.documentElement.dataset.theme || (themeMedia.matches ? 'light' : 'dark'));
themeToggle?.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', { persist:true });
});
themeMedia.addEventListener('change', (event) => {
  if (!savedTheme()) applyTheme(event.matches ? 'light' : 'dark');
});

const cameraSnapshotRefreshMs = 5000;
const cameraSnapshotRetryMs = 7000;
const cameraSnapshotFailureThreshold = 3;

function cameraInitialDelay(image) {
  const id = image?.dataset.cameraId || '';
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 1400;
}

const cameraObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const image = entry.target;
    image.dataset.visible = entry.isIntersecting ? '1' : '0';
    if (entry.isIntersecting) scheduleCameraSnapshot(image, cameraInitialDelay(image));
    else {
      if (image._cameraTimer) clearTimeout(image._cameraTimer);
      image._cameraTimer = null;
      image._cameraAbort?.abort();
      image._cameraAbort = null;
    }
  }
}, { rootMargin: '250px' }) : null;

function scheduleCameraSnapshot(image, delay = cameraSnapshotRefreshMs) {
  if (!image?.isConnected) return;
  if (cameraObserver && image.dataset.visible !== '1') return;
  if (image._cameraTimer) clearTimeout(image._cameraTimer);
  image._cameraTimer = setTimeout(() => {
    image._cameraTimer = null;
    refreshCameraSnapshot(image);
  }, delay);
}

async function loadImageObjectUrl(url) {
  await new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = resolve;
    probe.onerror = () => reject(new Error('Invalid camera image'));
    probe.src = url;
  });
}

async function refreshCameraSnapshot(image) {
  if (!image?.isConnected || (cameraObserver && image.dataset.visible !== '1')) return;
  if (image._cameraLoading) return;

  image._cameraLoading = true;
  const controller = new AbortController();
  image._cameraAbort = controller;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12000);
  let nextDelay = cameraSnapshotRefreshMs;

  try {
    const base = image.dataset.cameraSrc;
    const response = await fetch(`${base}${base.includes('?') ? '&' : '?'}_=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Camera snapshot failed (${response.status})`);
    const blob = await response.blob();
    if (!blob.size || !String(blob.type || '').toLowerCase().includes('image/jpeg')) {
      throw new Error('Camera returned an invalid image');
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      await loadImageObjectUrl(objectUrl);
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }

    const oldObjectUrl = image._cameraObjectUrl;
    image.src = objectUrl;
    image._cameraObjectUrl = objectUrl;
    if (oldObjectUrl) URL.revokeObjectURL(oldObjectUrl);

    image._cameraFailures = 0;
    image.classList.remove('camera-failed');
    const message = image.parentElement?.querySelector('[data-camera-message]');
    message?.classList.add('hidden');
  } catch (error) {
    if (error?.name !== 'AbortError' || timedOut) {
      image._cameraFailures = (image._cameraFailures || 0) + 1;
      nextDelay = cameraSnapshotRetryMs;
      // Preserve the last successful image. Only surface a warning after
      // repeated failures so a single slow camera frame does not make the
      // whole dashboard appear broken.
      if (image._cameraFailures >= cameraSnapshotFailureThreshold) {
        image.classList.add('camera-failed');
        const message = image.parentElement?.querySelector('[data-camera-message]');
        if (message) {
          message.textContent = 'Camera preview temporarily unavailable · retrying';
          message.classList.remove('hidden');
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    if (image._cameraAbort === controller) image._cameraAbort = null;
    image._cameraLoading = false;
    if (image.isConnected && (!cameraObserver || image.dataset.visible === '1')) {
      scheduleCameraSnapshot(image, nextDelay);
    }
  }
}

function disposeCameraImage(image) {
  if (!image) return;
  if (image._cameraTimer) clearTimeout(image._cameraTimer);
  image._cameraAbort?.abort();
  if (image._cameraObjectUrl) URL.revokeObjectURL(image._cameraObjectUrl);
  image._cameraTimer = null;
  image._cameraAbort = null;
  image._cameraObjectUrl = null;
  if (cameraObserver) cameraObserver.unobserve(image);
}

function observeCameraSnapshot(image) {
  image._cameraFailures = 0;
  if (cameraObserver) cameraObserver.observe(image);
  else {
    image.dataset.visible = '1';
    scheduleCameraSnapshot(image, cameraInitialDelay(image));
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'content-type':'application/json', ...(options.headers || {}) } : options.headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (!value) return '—';
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function preheatRemainingSeconds(preheat) {
  if (!preheat?.active) return 0;
  const end = new Date(preheat.endsAt || 0).getTime();
  if (Number.isFinite(end) && end > 0) return Math.max(0, Math.ceil((end - Date.now()) / 1000));
  return Math.max(0, Number(preheat.remainingSeconds || 0));
}

function formatCountdown(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const sec = Math.floor(value % 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

function formatLastSeen(value) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(value).toLocaleString();
}


function setControllerVersion(version) {
  if (!controllerVersionEl || !version) return;
  controllerVersionEl.textContent = `v${version}`;
}

function formatLicenseDate(value, emptyLabel = '—') {
  const text = String(value || '').trim();
  if (!text) return emptyLabel;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString();
}

function licenseStatusLabel(license) {
  const status = String(license?.licenseStatus || '').toLowerCase();
  if (status === 'valid') return 'Valid';
  if (status === 'expired') return 'Expired';
  if (status === 'invalid') return 'Invalid';
  if (status === 'not-installed') return 'Not installed';
  if (status === 'development-override') return 'Development override';
  return status ? status.replace(/-/g, ' ') : 'Unknown';
}

function renderLicenseDialog() {
  if (!licenseDetails) return;
  const license = licenseState || {};
  const printerAllowance = license.maxPrinters == null
    ? 'Unlimited'
    : `${license.maxPrinters} physical printers`;
  const customer = license.customer || (license.edition === 'community' ? 'Community user' : '—');
  const type = license.licenseType
    ? license.licenseType.charAt(0).toUpperCase() + license.licenseType.slice(1)
    : '—';
  const expiry = license.licenseType === 'perpetual' && !license.expiresAt
    ? 'Never'
    : formatLicenseDate(license.expiresAt);
  const updateEntitlement = license.updatesUntil
    ? `${formatLicenseDate(license.updatesUntil)}${license.updatesExpired ? ' · expired' : ''}`
    : '—';

  licenseDetails.innerHTML = `
    <div class="license-status-card">
      <div>
        <span class="license-status-label">Current edition</span>
        <strong>${escapeHtml(license.label || 'Community Edition')}</strong>
      </div>
      <span class="license-status-pill" data-license-status="${escapeHtml(String(license.licenseStatus || 'unknown'))}">${escapeHtml(licenseStatusLabel(license))}</span>
    </div>
    <div class="license-info-grid">
      <div><span>Customer</span><strong>${escapeHtml(customer)}</strong></div>
      <div><span>Licence ID</span><strong>${escapeHtml(license.licenseId || '—')}</strong></div>
      <div><span>Licence type</span><strong>${escapeHtml(type)}</strong></div>
      <div><span>Printer allowance</span><strong>${escapeHtml(printerAllowance)}</strong></div>
      <div><span>Expires</span><strong>${escapeHtml(expiry)}</strong></div>
      <div><span>Feature updates until</span><strong>${escapeHtml(updateEntitlement)}</strong></div>
      <div><span>Signature key</span><strong>${escapeHtml(license.signatureKeyId || '—')}</strong></div>
      <div><span>Source</span><strong>${escapeHtml(license.source || '—')}</strong></div>
    </div>
    <div class="license-file-path"><span>Licence file</span><code>${escapeHtml(license.licenseFile || 'Application directory / license.json')}</code></div>
    ${license.configurationWarning ? `<div class="license-dialog-warning">${escapeHtml(license.configurationWarning)}</div>` : ''}
  `;

  const submit = licenseInstallForm?.querySelector('button[type="submit"]');
  if (submit) submit.textContent = license.licenseStatus === 'valid' ? 'Replace licence' : 'Install licence';
}

function setControllerLicense(license) {
  licenseState = license || null;
  if (controllerEditionEl && license?.label) {
    const usage = license.maxPrinters != null && Number.isFinite(Number(license.activePhysicalPrinters))
      ? ` · ${license.activePhysicalPrinters}/${license.maxPrinters} active`
      : '';
    controllerEditionEl.textContent = `${license.label}${usage}`;
    controllerEditionEl.title = license.enforcementEnabled
      ? 'Licence enforcement enabled'
      : 'Development edition: licence limits are not enforced';
  }

  if (licenseDialog?.open) renderLicenseDialog();
  if (!licenseNoticeEl) return;
  const show = Boolean(license?.enforcementEnabled && license?.overLimit);
  licenseNoticeEl.classList.toggle('hidden', !show);
  if (!show) {
    licenseNoticeEl.innerHTML = '';
    return;
  }

  const remaining = Number(license.slotsRemaining || 0);
  licenseNoticeEl.innerHTML = `<div><strong>${escapeHtml(license.label)} printer limit</strong><span>${escapeHtml(String(license.configuredPhysicalPrinters))} physical printers are configured; this edition allows ${escapeHtml(String(license.maxPrinters))}. Choose the printers that may receive new controller commands.</span></div><span class="license-notice-count">${escapeHtml(String(license.activePhysicalPrinters))} / ${escapeHtml(String(license.maxPrinters))} selected${remaining ? ` · ${remaining} slot${remaining === 1 ? '' : 's'} free` : ''}</span>`;
}

function setLiveState(state) {
  const label = state === 'live' ? 'Live' : state === 'offline' ? 'Reconnecting' : 'Connecting';
  liveIndicator.className = `live-indicator ${state}`;
  liveIndicator.querySelector('span').textContent = label;
}

const CANCELLED_PRINTER_STATES = new Set(['cancel', 'cancelled', 'canceled', 'stopped']);

function rawStateName(printer) {
  return printer.online ? String(printer.status?.status || 'unknown') : 'offline';
}

function stateName(printer) {
  const raw = rawStateName(printer);
  if (
    printer.online
    && printer.adapterType === 'flashforge-ad5m'
    && CANCELLED_PRINTER_STATES.has(raw.toLowerCase())
  ) {
    return queueBedClearance(printer.id) ? 'cancelled' : 'ready';
  }
  return raw;
}

function queueBedClearance(printerId) {
  return (Array.isArray(queueState?.bedClearance) ? queueState.bedClearance : []).find((item) => item.printerId === printerId) || null;
}

async function confirmBedCleared(printerId, printerName) {
  if (!confirm(`Confirm the build plate on ${printerName || 'this printer'} is clear?\n\nThe next queued job may start immediately.`)) return false;
  const result = await api(`/api/queue/bed-clearance/${encodeURIComponent(printerId)}`, { method:'POST' });
  queueState = result.queue || queueState;
  reconcileFleet();
  renderPrintQueue();
  return true;
}

function renderSummary() {
  const online = fleet.filter((p) => p.online).length;
  const printing = fleet.filter((p) => {
    const state = String(p.status?.status || '').toLowerCase();
    if (state === 'heating' && p.chamberPreheat?.active && !p.status?.fileName) return false;
    return ['printing', 'working', 'heating', 'building_from_sd'].includes(state);
  }).length;
  const attentionIds = new Set(fleet.filter((p) => !p.online || ['error', 'pause', 'paused'].includes(String(p.status?.status || '').toLowerCase())).map((p) => p.id));
  for (const item of Array.isArray(queueState?.bedClearance) ? queueState.bedClearance : []) attentionIds.add(item.printerId);
  const attention = attentionIds.size;
  const items = [['Printers', fleet.length], ['Online', online], ['Printing', printing], ['Needs attention', attention]];
  summaryEl.innerHTML = items.map(([label, value]) => `<div class="summary-card"><span class="subtle">${label}</span><b>${value}</b></div>`).join('');
}


function formatQueueTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function queueElapsed(job) {
  const start = new Date(job.startedAt || job.startRequestedAt || 0).getTime();
  const end = new Date(job.finishedAt || 0).getTime();
  if (!start || !end || end < start) return '';
  return formatDuration(Math.max(1, Math.round((end - start) / 1000)));
}

function queueOptionsText(job) {
  const options = job.options || {};
  const parts = [];
  if (options.levelingBeforePrint !== false) parts.push('level');
  if (options.flowCalibrationBeforePrint === true) parts.push('flow calibration');
  if (options.timeLapseBeforePrint === true) parts.push('timelapse');
  if (options.autoReplenishFilament === true) parts.push('auto replenish');
  if (options.filamentEntangleDetect === true) parts.push('entanglement detect');
  if (options.toolMap && Object.keys(options.toolMap).length) parts.push('tool mapping');
  return parts.length ? parts.join(' · ') : 'standard print settings';
}

function queueStatusLabel(status) {
  const labels = {
    queued:'Queued',
    uploading:'Uploading',
    preflight:'Preflight',
    starting:'Starting',
    printing:'Printing',
    needs_review:'Needs review',
    completed:'Completed',
    failed:'Failed',
    cancelled:'Cancelled'
  };
  return labels[status] || status || 'Unknown';
}

function queueCompatibilityMarkup(job) {
  if (job.assignmentMode !== 'automatic' || !job.compatibility || job.status !== 'queued') return '';
  const groups = [
    ['ready', 'Eligible'],
    ['blocked', 'Waiting'],
    ['needsReview', 'Needs review'],
    ['incompatible', 'Not compatible']
  ];
  const rows = [];
  for (const [key, label] of groups) {
    const items = Array.isArray(job.compatibility[key]) ? job.compatibility[key] : [];
    if (!items.length) continue;
    rows.push(`<div><b>${escapeHtml(label)}:</b> ${items.map((item) => {
      const reasons = Array.isArray(item.reasons) && item.reasons.length ? ` — ${item.reasons.map((reason) => reason.text).join(' · ')}` : '';
      return `${escapeHtml(item.printerName || item.printerId)}${escapeHtml(reasons)}`;
    }).join('<br>')}</div>`);
  }
  return rows.length ? `<div class="queue-compatibility">${rows.join('')}</div>` : '';
}

function queuePriorityLabel(value) {
  const priority = String(value || 'normal').toLowerCase();
  return priority === 'high' ? 'High' : priority === 'low' ? 'Low' : 'Normal';
}

function queuePriorityOptions(selected) {
  return ['high','normal','low'].map((priority) =>
    `<option value="${priority}"${priority === selected ? ' selected' : ''}>${queuePriorityLabel(priority)}</option>`
  ).join('');
}

function queuePriorityBadge(job) {
  const priority = String(job.priority || 'normal').toLowerCase();
  const effective = String(job.effectivePriority || priority).toLowerCase();
  const aged = job.priorityAged === true && effective !== priority;
  const title = aged ? `Originally ${queuePriorityLabel(priority)}; promoted automatically while waiting` : `${queuePriorityLabel(priority)} queue priority`;
  const text = aged ? `${queuePriorityLabel(effective)} effective` : `${queuePriorityLabel(priority)} priority`;
  return `<span class="queue-priority priority-${escapeHtml(effective)}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

function queueJobMarkup(job, { history = false, queuedIndex = -1, queuedCount = 0, canMoveUp = false, canMoveDown = false } = {}) {
  const terminalTime = history ? (job.finishedAt || job.updatedAt) : job.queuedAt;
  const elapsed = queueElapsed(job);
  const progress = job.status === 'printing' ? `${Math.round(Number(job.maxProgress || 0))}%` : '';
  const error = job.error ? `<div class="queue-job-error">${escapeHtml(job.error)}</div>` : '';
  const meta = history
    ? `${formatQueueTime(terminalTime)}${elapsed ? ` · ${escapeHtml(elapsed)}` : ''}`
    : `${formatQueueTime(job.queuedAt)} · ${escapeHtml(queueOptionsText(job))}`;
  const controls = history
    ? `<button type="button" class="secondary" data-queue-reprint="${escapeHtml(job.id)}">Reprint</button>`
    : `<div class="queue-job-actions">
        ${['queued','needs_review'].includes(job.status) ? `<label class="queue-priority-control">Priority<select data-queue-priority="${escapeHtml(job.id)}">${queuePriorityOptions(String(job.priority || 'normal').toLowerCase())}</select></label>` : ''}
        ${job.status === 'queued' ? `<button type="button" class="queue-order-button" data-queue-up="${escapeHtml(job.id)}" aria-label="Move queued job earlier within its priority" title="Move earlier within ${escapeHtml(queuePriorityLabel(job.effectivePriority))} priority"${!canMoveUp ? ' disabled' : ''}>↑</button><button type="button" class="queue-order-button" data-queue-down="${escapeHtml(job.id)}" aria-label="Move queued job later within its priority" title="Move later within ${escapeHtml(queuePriorityLabel(job.effectivePriority))} priority"${!canMoveDown ? ' disabled' : ''}>↓</button>` : ''}
        ${job.status === 'needs_review' ? `<button type="button" class="secondary" data-queue-recheck="${escapeHtml(job.id)}">Recheck</button>` : ''}
        <button type="button" class="danger queue-cancel-button" data-queue-cancel="${escapeHtml(job.id)}">Cancel</button>
      </div>`;
  const printerLabel = job.assignmentMode === 'automatic' && !job.printerId ? 'Next available compatible printer' : (job.printerName || job.printerId || 'Unassigned');
  return `<article class="queue-job queue-job-${escapeHtml(job.status)}" data-queue-job="${escapeHtml(job.id)}">
    <div class="queue-job-main">
      <div class="queue-job-title"><strong>${escapeHtml(job.fileName)}</strong><span class="queue-job-badges">${queuePriorityBadge(job)}<span class="queue-status ${escapeHtml(job.status)}">${escapeHtml(queueStatusLabel(job.status))}${progress ? ` · ${progress}` : ''}</span></span></div>
      <div class="queue-job-printer">${escapeHtml(printerLabel)}</div>
      <div class="queue-job-meta">${escapeHtml(meta)}</div>
      ${job.selectionReason ? `<div class="queue-selection-reason">${escapeHtml(job.selectionReason)}</div>` : ''}
      ${queueCompatibilityMarkup(job)}
      ${error}
    </div>
    ${controls}
  </article>`;
}

function queueClearanceMarkup(item) {
  const status = queueStatusLabel(item.jobStatus);
  return `<article class="queue-job queue-job-clearance" data-bed-clearance-printer="${escapeHtml(item.printerId)}">
    <div class="queue-job-main">
      <div class="queue-job-title"><strong>Clear build plate</strong><span class="queue-status clearance">Waiting</span></div>
      <div class="queue-job-printer">${escapeHtml(item.printerName || item.printerId)}</div>
      <div class="queue-job-meta">${escapeHtml(item.fileName)} · ${escapeHtml(status)} ${escapeHtml(formatQueueTime(item.finishedAt))}</div>
      <div class="queue-job-clearance-note">The next queued print is blocked until the build plate has been cleared.</div>
    </div>
    <div class="queue-job-actions"><button type="button" class="secondary" data-bed-cleared="${escapeHtml(item.printerId)}">Bed cleared · continue</button></div>
  </article>`;
}

function productionBatchMarkup(batch, { history = false } = {}) {
  const quantity = Math.max(1, Number(batch.quantity || 1));
  const completed = Number(batch.completed || 0);
  const active = Number(batch.active || 0);
  const remaining = Number(batch.remaining || 0);
  const cancelable = Number(batch.cancelable || remaining);
  const failed = Number(batch.failed || 0);
  const cancelled = Number(batch.cancelled || 0);
  const progress = Math.max(0, Math.min(100, Math.round((completed / quantity) * 100)));
  const state = batch.paused ? 'Paused'
    : batch.finished ? (failed ? 'Completed with failures' : cancelled && !completed ? 'Cancelled' : 'Completed')
    : active ? 'Printing'
    : batch.needsReview ? 'Needs review'
    : 'Queued';
  const runs = Array.isArray(batch.runs) ? batch.runs : [];
  const visibleRuns = runs.slice(0, 12);
  const runMarkup = visibleRuns.map((run) => {
    const printer = run.printerName || (run.status === 'queued' ? 'Waiting for compatible printer' : 'Unassigned');
    const pct = run.status === 'printing' ? ` · ${Math.round(Number(run.progress || 0))}%` : '';
    return `<div class="production-run"><span>#${run.sequence} · ${escapeHtml(queueStatusLabel(run.status))}${pct}</span><span>${escapeHtml(printer)}</span></div>`;
  }).join('');
  const more = runs.length > visibleRuns.length ? `<div class="subtle">+ ${runs.length - visibleRuns.length} more copies</div>` : '';
  const controls = history && batch.finished
    ? `<div class="production-actions"><button type="button" class="secondary" data-production-reprint="${escapeHtml(batch.id)}">Reprint batch</button></div>`
    : !history && !batch.finished ? `<div class="production-actions">
      <button type="button" class="secondary" data-production-action="${batch.paused ? 'resume' : 'pause'}" data-production-batch="${escapeHtml(batch.id)}">${batch.paused ? 'Resume production' : 'Pause production'}</button>
      <label class="queue-priority-control">Priority<select data-production-priority-select="${escapeHtml(batch.id)}">${queuePriorityOptions(String(batch.priority || 'normal').toLowerCase())}</select></label>
      <label class="production-quantity-control">Quantity <input type="number" min="1" max="999" step="1" value="${quantity}" data-production-quantity-input="${escapeHtml(batch.id)}"></label>
      <button type="button" class="secondary" data-production-quantity="${escapeHtml(batch.id)}">Update quantity</button>
      ${cancelable ? `<button type="button" class="danger" data-production-action="cancel" data-production-batch="${escapeHtml(batch.id)}">Cancel remaining</button>` : ''}
    </div>` : '';
  return `<article class="queue-job production-batch${batch.paused ? ' production-paused' : ''}" data-production-card="${escapeHtml(batch.id)}">
    <div class="queue-job-main">
      <div class="queue-job-title"><strong>${escapeHtml(batch.fileName)}</strong><span class="queue-job-badges">${queuePriorityBadge(batch)}<span class="queue-status ${batch.paused ? 'paused' : batch.finished ? 'completed' : active ? 'printing' : 'queued'}">${escapeHtml(state)}</span></span></div>
      <div class="queue-job-printer">Production quantity ${quantity}</div>
      <div class="production-counts">Completed ${completed} · Printing/preparing ${active} · Remaining ${remaining}${failed ? ` · Failed ${failed}` : ''}${cancelled ? ` · Cancelled ${cancelled}` : ''}</div>
      <div class="production-progress"><span style="width:${progress}%"></span></div>
      <div class="production-runs">${runMarkup}${more}</div>
    </div>
    ${controls}
  </article>`;
}

function renderPrintQueue() {
  if (!queueDialog) return;
  const jobs = Array.isArray(queueState?.jobs) ? queueState.jobs : [];
  const productionBatches = Array.isArray(queueState?.productionBatches) ? queueState.productionBatches : [];
  const standaloneJobs = jobs.filter((job) => !job.productionBatchId);
  const queuedJobs = jobs.filter((job) => job.status === 'queued');
  const activeJobs = jobs.filter((job) => ['uploading','preflight','starting','printing'].includes(job.status));
  const reviewJobs = jobs.filter((job) => job.status === 'needs_review');
  const currentJobs = standaloneJobs.filter((job) => ['uploading','preflight','starting','printing','needs_review','queued'].includes(job.status));
  const activeProduction = productionBatches.filter((batch) => !batch.finished);
  const historyProduction = productionBatches.filter((batch) => batch.finished).reverse().slice(0, 100);
  const clearanceItems = Array.isArray(queueState?.bedClearance) ? queueState.bedClearance : [];
  const allHistoryJobs = jobs.filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status));
  const historyJobs = standaloneJobs.filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status)).reverse().slice(0, 100);
  const clearableHistoryJobs = allHistoryJobs.filter((job) => !(job.bedClearanceRequired === true && !job.bedClearedAt));
  const outstanding = currentJobs.length + activeProduction.length + clearanceItems.length;
  const historyCount = historyJobs.length + historyProduction.length;

  if (queueButtonCount) {
    queueButtonCount.textContent = String(outstanding);
    queueButtonCount.classList.toggle('hidden', outstanding === 0);
  }
  if (queueSummary) {
    const productionText = activeProduction.length ? ` · ${activeProduction.length} production batch${activeProduction.length === 1 ? '' : 'es'}` : '';
    queueSummary.textContent = outstanding
      ? `${activeJobs.length} active · ${queuedJobs.length} queued copies · ${reviewJobs.length} needs review${productionText} · ${clearanceItems.length} awaiting bed clearance · ${historyCount} recent history`
      : `${historyCount ? `${historyCount} history item${historyCount === 1 ? '' : 's'}` : 'No queued prints'}`;
  }
  if (queueActiveList) {
    const clearanceMarkup = clearanceItems.map(queueClearanceMarkup).join('');
    const productionMarkup = activeProduction.map((batch) => productionBatchMarkup(batch)).join('');
    const jobsMarkup = currentJobs.map((job) => {
      const queuedIndex = job.status === 'queued' ? queuedJobs.findIndex((queued) => queued.id === job.id) : -1;
      const effectivePriority = String(job.effectivePriority || job.priority || 'normal');
      return queueJobMarkup(job, {
        queuedIndex,
        queuedCount: queuedJobs.length,
        canMoveUp:queuedIndex > 0 && String(queuedJobs[queuedIndex - 1]?.effectivePriority || queuedJobs[queuedIndex - 1]?.priority || 'normal') === effectivePriority,
        canMoveDown:queuedIndex >= 0 && queuedIndex < queuedJobs.length - 1 && String(queuedJobs[queuedIndex + 1]?.effectivePriority || queuedJobs[queuedIndex + 1]?.priority || 'normal') === effectivePriority
      });
    }).join('');
    queueActiveList.innerHTML = clearanceMarkup || productionMarkup || jobsMarkup
      ? `${clearanceMarkup}${productionMarkup}${jobsMarkup}`
      : '<div class="queue-empty">No active, queued or review-blocked jobs.</div>';
  }
  if (queueHistoryList) {
    const productionHistoryMarkup = historyProduction.map((batch) => productionBatchMarkup(batch, { history:true })).join('');
    const jobHistoryMarkup = historyJobs.map((job) => queueJobMarkup(job, { history:true })).join('');
    queueHistoryList.innerHTML = productionHistoryMarkup || jobHistoryMarkup
      ? `${productionHistoryMarkup}${jobHistoryMarkup}`
      : '<div class="queue-empty">Completed, failed and cancelled queued prints will appear here.</div>';
  }
  if (clearQueueHistoryBtn) {
    clearQueueHistoryBtn.disabled = clearableHistoryJobs.length === 0;
    clearQueueHistoryBtn.title = clearanceItems.length ? 'History items holding an uncleared-bed interlock are retained until the bed is confirmed clear.' : '';
  }
}

async function refreshPrintQueue() {
  queueState = await api('/api/queue');
  renderPrintQueue();
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / (1024 ** power);
  return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
}

function libraryRequirementSummary(file) {
  const requirements = file?.requirements || {};
  const logicalTools = Array.isArray(requirements.logicalTools) ? requirements.logicalTools : [];
  const materials = [...new Set(logicalTools.map((tool) => String(tool.material || '').trim()).filter(Boolean))];
  const nozzles = [...new Set(logicalTools.map((tool) => Number(tool.nozzleDiameter)).filter((value) => Number.isFinite(value) && value > 0).map((value) => value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')))];
  const colors = [...new Set(logicalTools.map((tool) => normalizeColor(tool.color)).filter(Boolean))];
  const parts = [];
  if (materials.length) parts.push(materials.join(' / '));
  if (nozzles.length) parts.push(`${nozzles.join(' / ')} mm nozzle`);
  if (Number(requirements.toolCount || 0) > 0) parts.push(`${requirements.toolCount} tool${Number(requirements.toolCount) === 1 ? '' : 's'}`);
  if (colors.length) parts.push(`${colors.length} colour${colors.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Requirements not detected';
}

function librarySearchText(file) {
  const requirements = file?.requirements || {};
  const logicalTools = Array.isArray(requirements.logicalTools) ? requirements.logicalTools : [];
  return [
    file?.fileName,
    file?.sha256,
    ...logicalTools.flatMap((tool) => [tool.material, tool.color, tool.nozzleDiameter])
  ].filter(Boolean).join(' ').toLowerCase();
}

function libraryFileMarkup(file) {
  const usage = file.usage || {};
  const lastPrinted = usage.lastPrintedAt ? `Last printed ${formatLastSeen(usage.lastPrintedAt)}` : 'Not printed from queue yet';
  const warning = file.requirements?.warning ? `<div class="library-warning">${escapeHtml(file.requirements.warning)}</div>` : '';
  return `<article class="library-file" data-library-file="${escapeHtml(file.id)}">
    <div class="library-file-main">
      <div class="library-file-title"><strong>${escapeHtml(file.fileName)}</strong><span>${escapeHtml(formatBytes(file.size))}</span></div>
      <div class="library-file-requirements">${escapeHtml(libraryRequirementSummary(file))}</div>
      <div class="library-file-meta">Added ${escapeHtml(formatLastSeen(file.addedAt || file.stagedAt))} · ${Number(usage.completedPrints || 0)} completed print${Number(usage.completedPrints || 0) === 1 ? '' : 's'} · ${escapeHtml(lastPrinted)}</div>
      ${warning}
    </div>
    <div class="library-file-actions">
      <button type="button" class="primary" data-library-queue="${escapeHtml(file.id)}">Queue</button>
      <button type="button" class="danger" data-library-delete="${escapeHtml(file.id)}"${Number(usage.queueReferences || 0) > 0 ? ' disabled title="Clear queue/history references before deleting this file"' : ''}>Delete</button>
    </div>
  </article>`;
}

function renderPrintLibrary() {
  if (!libraryList) return;
  const files = Array.isArray(libraryState?.files) ? libraryState.files : [];
  const query = String(librarySearchInput?.value || '').trim().toLowerCase();
  const visible = query ? files.filter((file) => librarySearchText(file).includes(query)) : files;

  if (libraryButtonCount) {
    libraryButtonCount.textContent = String(files.length);
    libraryButtonCount.classList.toggle('hidden', files.length === 0);
  }
  if (librarySummary) {
    const bytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    librarySummary.textContent = `${files.length} file${files.length === 1 ? '' : 's'} · ${formatBytes(bytes)} stored on this controller`;
  }
  libraryList.innerHTML = visible.length
    ? visible.map(libraryFileMarkup).join('')
    : `<div class="queue-empty">${files.length ? 'No library files match this search.' : 'No files in the Print Library yet. Add a G-code, GX or 3MF file to get started.'}</div>`;
}

async function refreshPrintLibrary() {
  libraryState = await api('/api/library');
  renderPrintLibrary();
  return libraryState;
}

async function uploadLibraryFile(file) {
  if (!(file instanceof File) || !file.size) throw new Error('Choose a file to add to the Print Library');
  if (file.size > 512 * 1024 * 1024) throw new Error('File exceeds the 512 MB upload limit');
  const response = await fetch('/api/library', {
    method:'POST',
    headers:{ 'x-file-name':encodeURIComponent(file.name), 'content-type':'application/octet-stream' },
    body:file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Print Library upload failed (${response.status})`);
  await refreshPrintLibrary();
  return payload.file;
}

async function queueLibraryFile(libraryFileId, options = {}, quantity = 1, priority = 'normal') {
  if (!libraryFileId) throw new Error('Choose a Print Library file to queue');
  const result = await api('/api/queue', {
    method:'POST',
    body:JSON.stringify({
      assignmentMode:'automatic',
      libraryFileId,
      quantity,
      priority,
      options
    })
  });
  queueState = result.queue || queueState;
  renderPrintQueue();
  await refreshPrintLibrary().catch(() => {});
  return result.job;
}

function openQueueAddDialog(libraryFile = null) {
  queueAddLibraryFile = libraryFile || null;
  queueAddForm?.reset();
  if (queueAddStatus) queueAddStatus.textContent = '';
  if (queueAddError) {
    queueAddError.textContent = '';
    queueAddError.classList.add('hidden');
  }
  queueAddFileField?.classList.toggle('hidden', Boolean(queueAddLibraryFile));
  if (queueAddFileInput) queueAddFileInput.required = !queueAddLibraryFile;
  if (queueAddSelectedFile) {
    queueAddSelectedFile.classList.toggle('hidden', !queueAddLibraryFile);
    queueAddSelectedFile.innerHTML = queueAddLibraryFile
      ? `<strong>Print Library file</strong><div>${escapeHtml(queueAddLibraryFile.fileName)}</div><div class="field-help">${escapeHtml(libraryRequirementSummary(queueAddLibraryFile))}</div>`
      : '';
  }
  queueAddDialog?.showModal();
}

async function addPrintQueueJob(printer, fileName, options = {}) {
  const result = await api('/api/queue', {
    method:'POST',
    body: JSON.stringify({ printerId:printer.id, fileName, options })
  });
  queueState = result.queue || queueState;
  renderPrintQueue();
  return result.job;
}

async function stageAutomaticQueueFile(file, options = {}, quantity = 1, priority = 'normal') {
  const libraryFile = await uploadLibraryFile(file);
  return queueLibraryFile(libraryFile.id, options, quantity, priority);
}

function selectedPrinters() {
  return fleet.filter((printer) => selectedPrinterIds.has(printer.id));
}

function updateBatchUi() {
  for (const id of [...selectedPrinterIds]) {
    if (!fleet.some((printer) => printer.id === id)) selectedPrinterIds.delete(id);
  }
  fleetEl.classList.toggle('selection-mode', selectionMode);
  batchToolbar.classList.toggle('hidden', !selectionMode);
  batchModeBtn.textContent = selectionMode ? 'Exit fleet ops' : 'Fleet operations';
  batchSelectedCount.textContent = String(selectedPrinterIds.size);

  for (const card of fleetEl.querySelectorAll('[data-printer-card]')) {
    const selected = selectedPrinterIds.has(card.dataset.printerCard);
    card.classList.toggle('selected', selected);
    const checkbox = card.querySelector('[data-printer-select]');
    if (checkbox) checkbox.checked = selected;
  }

  batchToolbar.querySelectorAll('[data-batch-open],[data-batch-direct]').forEach((button) => {
    button.disabled = batchBusy || selectedPrinterIds.size === 0;
  });
}

function setSelectionMode(enabled) {
  selectionMode = Boolean(enabled);
  if (!selectionMode) {
    selectedPrinterIds.clear();
    batchResult.textContent = '';
    batchResult.classList.remove('has-errors');
    batchResult.removeAttribute('title');
  }
  updateBatchUi();
}

function togglePrinterSelection(id, selected) {
  if (selected) selectedPrinterIds.add(id);
  else selectedPrinterIds.delete(id);
  updateBatchUi();
}

function cardMarkup(printer) {
  return `<article class="card" data-printer-card="${escapeHtml(printer.id)}" draggable="false">
    <div class="card-head">
      <div class="card-title-area">
        <label class="printer-select" title="Select printer"><input type="checkbox" data-printer-select aria-label="Select ${escapeHtml(printer.name)}"><span></span></label>
        <div><h3 data-name></h3><div class="subtle" data-host></div></div>
      </div>
      <div class="card-head-actions">
        <div class="reorder-controls" aria-label="Reorder printer">
          <button type="button" class="reorder-button" data-move-earlier title="Move earlier" aria-label="Move printer earlier">←</button>
          <span class="drag-handle" data-drag-handle title="Drag to reorder" aria-label="Drag to reorder" role="button" tabindex="0">⋮⋮</span>
          <button type="button" class="reorder-button" data-move-later title="Move later" aria-label="Move printer later">→</button>
        </div>
        <div class="badge" data-state></div>
      </div>
    </div>
    <div class="camera-slot" data-camera-slot></div>
    <div class="license-strip hidden" data-license-strip>
      <div><strong data-license-title></strong><span data-license-summary></span></div>
      <button type="button" class="secondary" data-license-slot-toggle></button>
    </div>
    <div class="preheat-strip hidden" data-preheat-strip>
      <div><strong>CHAMBER PREHEAT</strong><span data-preheat-summary></span></div>
      <button type="button" class="preheat-stop" data-stop-preheat>Stop</button>
    </div>
    <div class="bed-clearance-strip hidden" data-bed-clearance-strip>
      <div><strong>BED CLEARANCE REQUIRED</strong><span data-bed-clearance-summary></span></div>
      <button type="button" class="secondary" data-bed-cleared-card>Bed cleared</button>
    </div>
    <div class="card-body">
      <div class="job"><span class="job-name" data-job-name></span><b data-progress-value>0%</b></div>
      <div class="progress"><span data-progress-bar></span></div>
      <div class="metrics">
        <div class="metric"><span data-nozzle-label>Nozzle</span><b data-nozzle>—</b></div>
        <div class="metric"><span>Bed</span><b data-bed>—</b></div>
        <div class="metric"><span>Layer</span><b data-layer>—</b></div>
        <div class="metric"><span>Remaining</span><b data-remaining>—</b></div>
      </div>
      <div class="health-line"><span data-last-seen></span><span data-latency></span></div>
      <div class="card-error hidden" data-card-error></div>
    </div>
    <div class="card-footer"><button class="secondary" data-open="${escapeHtml(printer.id)}">Open printer</button></div>
  </article>`;
}

function updateCameraSlot(card, printer) {
  const slot = card.querySelector('[data-camera-slot]');
  const current = slot.querySelector('img[data-camera-id]');
  if (!printer.capabilities?.camera || !printer.online || printer.cameraAvailable === false) {
    disposeCameraImage(current);
    if (!slot.querySelector('.camera-placeholder')) slot.innerHTML = '<div class="camera-placeholder">Camera unavailable</div>';
    return;
  }

  const cameraSrc = `/api/printers/${encodeURIComponent(printer.id)}/camera/snapshot`;
  if (current && current.dataset.cameraSrc === cameraSrc) return;
  disposeCameraImage(current);
  slot.innerHTML = `<img class="camera camera-snapshot" data-camera-id="${escapeHtml(printer.id)}" data-camera-src="${escapeHtml(cameraSrc)}" alt="${escapeHtml(printer.name)} camera preview"><div class="camera-message hidden" data-camera-message></div>`;
  observeCameraSnapshot(slot.querySelector('img'));
}

function updateCard(card, printer) {
  const s = printer.status;
  const state = stateName(printer);
  const progress = Math.round(s?.progress || 0);
  card.querySelector('[data-name]').textContent = printer.name;
  card.querySelector('[data-host]').textContent = `${printer.host}${printer.model ? ` · ${printer.model}` : ''}`;
  const badge = card.querySelector('[data-state]');
  badge.textContent = state;
  badge.className = `badge ${state.toLowerCase()}`;
  const rawState = rawStateName(printer);
  badge.title = rawState.toLowerCase() !== state.toLowerCase() ? `Printer reports ${rawState}` : '';
  card.querySelector('[data-job-name]').textContent = s?.fileName || (printer.online ? 'No active job' : 'Printer offline');
  card.querySelector('[data-progress-value]').textContent = `${progress}%`;
  card.querySelector('[data-progress-bar]').style.width = `${progress}%`;
  const activeTool = Number.isInteger(Number(s?.activeTool)) ? Number(s.activeTool) : null;
  card.querySelector('[data-nozzle-label]').textContent = activeTool !== null && printer.capabilities?.toolTemperatures ? `Active T${activeTool}` : 'Nozzle';
  card.querySelector('[data-nozzle]').textContent = s ? `${s.nozzle.actual.toFixed(0)} / ${s.nozzle.target.toFixed(0)} °C` : '—';
  card.querySelector('[data-bed]').textContent = s ? `${s.bed.actual.toFixed(0)} / ${s.bed.target.toFixed(0)} °C` : '—';
  card.querySelector('[data-layer]').textContent = s && s.totalLayers ? `${s.currentLayer} / ${s.totalLayers}` : '—';
  card.querySelector('[data-remaining]').textContent = formatDuration(s?.remainingSeconds);
  card.querySelector('[data-last-seen]').textContent = printer.online ? `Seen ${formatLastSeen(printer.lastSeen)}` : `Last seen ${formatLastSeen(printer.lastSeen)}`;
  card.querySelector('[data-latency]').textContent = printer.latencyMs != null ? `${printer.latencyMs} ms` : '';
  const licenseStrip = card.querySelector('[data-license-strip]');
  const showLicenseSlots = Boolean(licenseState?.enforcementEnabled && licenseState?.overLimit && !printer.simulated);
  licenseStrip?.classList.toggle('hidden', !showLicenseSlots);
  card.classList.toggle('license-inactive', printer.licenseActive === false);
  if (showLicenseSlots && licenseStrip) {
    const active = printer.licenseActive !== false;
    const title = licenseStrip.querySelector('[data-license-title]');
    const summary = licenseStrip.querySelector('[data-license-summary]');
    const button = licenseStrip.querySelector('[data-license-slot-toggle]');
    if (title) title.textContent = active ? 'LICENCE SLOT ACTIVE' : 'INACTIVE — LICENCE LIMIT';
    if (summary) summary.textContent = active
      ? 'This printer may receive new controller commands.'
      : 'Monitoring remains available, but new jobs and control commands are blocked.';
    if (button) {
      button.textContent = active ? 'Release slot' : 'Use licence slot';
      button.dataset.licenseSlotToggle = active ? 'off' : 'on';
      button.disabled = !active && Number(licenseState?.slotsRemaining || 0) <= 0;
      button.title = button.disabled ? 'Release a licence slot from another printer first' : '';
    }
  }
  const selector = card.querySelector('[data-printer-select]');
  if (selector) {
    selector.disabled = printer.licenseActive === false;
    if (selector.disabled && selector.checked) {
      selector.checked = false;
      selectedPrinterIds.delete(printer.id);
    }
  }

  const error = card.querySelector('[data-card-error]');
  error.textContent = printer.error || '';
  error.classList.toggle('hidden', !printer.error || printer.online);
  const preheat = printer.chamberPreheat;
  const preheatStrip = card.querySelector('[data-preheat-strip]');
  preheatStrip.classList.toggle('hidden', !preheat?.active);
  if (preheat?.active) {
    card.querySelector('[data-preheat-summary]').textContent = `${Number(preheat.bedTemperature).toFixed(0)} °C bed · ${formatCountdown(preheatRemainingSeconds(preheat))} remaining`;
  }
  const clearance = queueBedClearance(printer.id);
  const clearanceStrip = card.querySelector('[data-bed-clearance-strip]');
  clearanceStrip?.classList.toggle('hidden', !clearance);
  if (clearance) {
    const summary = card.querySelector('[data-bed-clearance-summary]');
    if (summary) {
      const outcome = String(clearance.jobStatus || '').toLowerCase() === 'cancelled' ? 'cancelled' : 'finished';
      summary.textContent = `${clearance.fileName} ${outcome} · queue paused`;
    }
  }
  updateCameraSlot(card, printer);
}

function reconcileFleet() {
  emptyEl.classList.toggle('hidden', fleet.length !== 0);
  fleetEl.classList.toggle('hidden', fleet.length === 0);
  renderSummary();

  const wanted = new Set(fleet.map((printer) => printer.id));
  for (const card of fleetEl.querySelectorAll('[data-printer-card]')) {
    if (!wanted.has(card.dataset.printerCard)) {
      disposeCameraImage(card.querySelector('img[data-camera-id]'));
      card.remove();
    }
  }

  for (const printer of fleet) {
    let card = fleetEl.querySelector(`[data-printer-card="${CSS.escape(printer.id)}"]`);
    if (!card) {
      fleetEl.insertAdjacentHTML('beforeend', cardMarkup(printer));
      card = fleetEl.lastElementChild;
    }
    updateCard(card, printer);
    if (!reorderInProgress) fleetEl.appendChild(card);
  }

  updateBatchUi();
  updateOpenPrinterTelemetry();
}

function dashboardOrderIds() {
  return [...fleetEl.querySelectorAll('[data-printer-card]')].map((card) => card.dataset.printerCard);
}

async function persistDashboardOrder() {
  const printerIds = dashboardOrderIds();
  if (printerIds.length !== fleet.length) return;
  try {
    await api('/api/printers/order', { method:'PUT', body: JSON.stringify({ printerIds }) });
    const order = new Map(printerIds.map((id, index) => [id, index]));
    fleet.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  } catch (error) {
    console.error('Could not save printer order', error);
    await loadInitialFleet();
  }
}

function queueDashboardOrderSave(delay = 0) {
  if (reorderSaveTimer) clearTimeout(reorderSaveTimer);
  reorderSaveTimer = setTimeout(() => {
    reorderSaveTimer = null;
    persistDashboardOrder();
  }, delay);
}

function movePrinterCard(card, direction) {
  if (!card) return;
  const sibling = direction < 0 ? card.previousElementSibling : card.nextElementSibling;
  if (!sibling) return;
  reorderInProgress = true;
  if (direction < 0) fleetEl.insertBefore(card, sibling);
  else fleetEl.insertBefore(sibling, card);
  reorderInProgress = false;
  queueDashboardOrderSave();
}

function cardBeforePointer(container, x, y, draggingCard) {
  const cards = [...container.querySelectorAll('[data-printer-card]')].filter((card) => card !== draggingCard);
  let best = null;
  let bestScore = Infinity;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const rowDistance = Math.abs(y - (rect.top + rect.height / 2));
    const colDistance = Math.abs(x - (rect.left + rect.width / 2));
    const score = rowDistance * 4 + colDistance;
    const before = y < rect.top + rect.height / 2 || (Math.abs(y - (rect.top + rect.height / 2)) < rect.height * .28 && x < rect.left + rect.width / 2);
    if (score < bestScore) {
      bestScore = score;
      best = { card, before };
    }
  }
  return best;
}

async function loadInitialFleet() {
  try {
    const result = await api('/api/fleet');
    fleet = result.printers || [];
    queueState = result.queue || queueState;
    setControllerVersion(result.version);
    setControllerLicense(result.license);
    reconcileFleet();
    renderPrintQueue();
  } catch (error) {
    console.error(error);
  }
}

function connectLiveUpdates() {
  if (eventSource) eventSource.close();
  setLiveState('connecting');
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('open', () => setLiveState('live'));
  eventSource.addEventListener('fleet', (event) => {
    try {
      const payload = JSON.parse(event.data);
      fleet = payload.printers || [];
      queueState = payload.queue || queueState;
      setControllerVersion(payload.version);
      setControllerLicense(payload.license);
      reconcileFleet();
      renderPrintQueue();
      setLiveState('live');
    } catch (error) {
      console.error('Bad fleet event', error);
    }
  });
  eventSource.addEventListener('error', () => setLiveState('offline'));
}


function adapterDefinition(type) {
  return adapters.find((adapter) => adapter.type === type) || null;
}

function renderAdapterFields(type, values = {}) {
  const definition = adapterDefinition(type);
  const fields = definition?.configFields || [];
  adapterFields.innerHTML = fields.map((field) => {
    const value = values[field.name] ?? field.defaultValue ?? '';
    const help = field.help ? `<div class="field-help">${escapeHtml(field.help)}</div>` : '';
    if (field.type === 'select' && Array.isArray(field.options)) {
      const attrs = [`name="${escapeHtml(field.name)}"`, field.required ? 'required' : ''].filter(Boolean).join(' ');
      const options = field.options.map((item) => {
        const option = item && typeof item === 'object' ? item : { value:item, label:item };
        return `<option value="${escapeHtml(option.value)}"${String(option.value) === String(value) ? ' selected' : ''}>${escapeHtml(option.label ?? option.value)}</option>`;
      }).join('');
      return `<label>${escapeHtml(field.label || field.name)}<select ${attrs}>${options}</select></label>${help}`;
    }
    const inputType = field.secret ? 'password' : (field.type || 'text');
    const attrs = [
      `name="${escapeHtml(field.name)}"`,
      `type="${escapeHtml(inputType)}"`,
      field.required ? 'required' : '',
      field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '',
      field.min !== undefined ? `min="${escapeHtml(field.min)}"` : '',
      field.max !== undefined ? `max="${escapeHtml(field.max)}"` : '',
      value !== '' ? `value="${escapeHtml(value)}"` : ''
    ].filter(Boolean).join(' ');
    return `<label>${escapeHtml(field.label || field.name)}<input ${attrs}></label>${help}`;
  }).join('');
  if (type === 'bambu-lab') {
    const model = adapterFields.querySelector('[name="model"]');
    const cameraPort = adapterFields.querySelector('[name="cameraPort"]');
    model?.addEventListener('change', () => {
      if (!cameraPort || !['322','6000'].includes(cameraPort.value)) return;
      cameraPort.value = model.value.trim().toUpperCase() === 'X1C' ? '322' : '6000';
    });
  }
}

async function loadAdapters() {
  try {
    const result = await api('/api/adapters');
    adapters = result.adapters || [];
    adapterTypeSelect.innerHTML = adapters.map((adapter) => `<option value="${escapeHtml(adapter.type)}">${escapeHtml(adapter.label || adapter.type)}</option>`).join('');
    if (!adapterTypeSelect.value && adapters.length) adapterTypeSelect.value = adapters[0].type;
    renderAdapterFields(adapterTypeSelect.value);
  } catch (error) {
    adapters = [];
    adapterTypeSelect.innerHTML = '<option value="flashforge-ad5m">FlashForge Adventurer 5M family</option>';
    renderAdapterFields('flashforge-ad5m');
    console.error('Could not load printer adapters', error);
  }
}

function renderDiscoveryResults(printers) {
  if (!printers.length) {
    discoveryResults.innerHTML = '<div class="discovery-empty">No supported printers responded. Manual entry still works.</div>';
    return;
  }
  discoveryResults.innerHTML = printers.map((printer, index) => {
    const supported = Boolean(printer.adapterType);
    const lan = printer.lanMode === true ? 'LAN mode on' : printer.lanMode === false ? 'LAN mode off' : '';
    return `<div class="discovery-result ${printer.alreadyAdded ? 'already-added' : ''}">
      <div class="discovery-main">
        <strong>${escapeHtml(printer.name)}</strong>
        <div class="subtle">${escapeHtml(printer.host)} · ${escapeHtml(printer.manufacturer || '')} ${escapeHtml(printer.model || '')}${lan ? ` · ${escapeHtml(lan)}` : ''}</div>
        <div class="serial-line">${escapeHtml(printer.adapterType || 'unsupported')}${printer.serialNumber ? ` · ${escapeHtml(printer.serialNumber)}` : ''}</div>
      </div>
      <button type="button" class="secondary" data-use-discovery="${index}" ${printer.alreadyAdded || !supported ? 'disabled' : ''}>${printer.alreadyAdded ? 'Added' : supported ? 'Use' : 'Unsupported'}</button>
    </div>`;
  }).join('');
  discoveryResults._printers = printers;
}

async function scanNetwork() {
  scanNetworkBtn.disabled = true;
  scanNetworkBtn.textContent = 'Scanning…';
  discoveryStatus.textContent = 'Scanning for supported local printers…';
  discoveryResults.innerHTML = '';
  try {
    const { printers } = await api('/api/discovery');
    lastDiscoveryAt = Date.now();
    discoveryStatus.textContent = `Found ${printers.length} supported printer${printers.length === 1 ? '' : 's'}.`;
    renderDiscoveryResults(printers);
  } catch (error) {
    discoveryStatus.textContent = `Discovery failed: ${error.message}`;
  } finally {
    scanNetworkBtn.disabled = false;
    scanNetworkBtn.textContent = 'Scan LAN';
  }
}

function openAdd() {
  formError.classList.add('hidden');
  formError.textContent = '';
  addDialog.showModal();
  renderAdapterFields(adapterTypeSelect.value);
  if (Date.now() - lastDiscoveryAt > 30000) scanNetwork();
}

document.querySelector('#addPrinterBtn').addEventListener('click', openAdd);
licenseBtn?.addEventListener('click', () => {
  if (licenseInstallStatus) licenseInstallStatus.textContent = '';
  if (licenseInstallError) {
    licenseInstallError.textContent = '';
    licenseInstallError.classList.add('hidden');
  }
  if (licenseFileInput) licenseFileInput.value = '';
  renderLicenseDialog();
  licenseDialog?.showModal();
});
document.querySelectorAll('[data-license-close]').forEach((el) => el.addEventListener('click', () => licenseDialog?.close()));
licenseInstallForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = licenseFileInput?.files?.[0];
  const submit = licenseInstallForm.querySelector('button[type="submit"]');
  if (!file) return;
  if (file.size > 256_000) {
    if (licenseInstallError) {
      licenseInstallError.textContent = 'Licence file is too large.';
      licenseInstallError.classList.remove('hidden');
    }
    return;
  }

  if (submit) submit.disabled = true;
  if (licenseInstallError) {
    licenseInstallError.textContent = '';
    licenseInstallError.classList.add('hidden');
  }
  if (licenseInstallStatus) licenseInstallStatus.textContent = 'Verifying licence signature…';

  try {
    const documentText = await file.text();
    const result = await api('/api/license/install', {
      method:'POST',
      body:JSON.stringify({ license:documentText })
    });
    if (result.license) setControllerLicense(result.license);
    await loadInitialFleet();
    renderLicenseDialog();
    if (licenseFileInput) licenseFileInput.value = '';
    if (licenseInstallStatus) {
      licenseInstallStatus.textContent = `${result.installedLicense?.label || 'Licence'} installed and activated.`;
    }
  } catch (error) {
    if (licenseInstallStatus) licenseInstallStatus.textContent = '';
    if (licenseInstallError) {
      licenseInstallError.textContent = error.message;
      licenseInstallError.classList.remove('hidden');
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = licenseState?.licenseStatus === 'valid' ? 'Replace licence' : 'Install licence';
    }
  }
});
libraryBtn?.addEventListener('click', async () => {
  if (libraryError) { libraryError.textContent = ''; libraryError.classList.add('hidden'); }
  if (libraryStatus) libraryStatus.textContent = 'Loading Print Library…';
  libraryDialog?.showModal();
  try {
    await refreshPrintLibrary();
    if (libraryStatus) libraryStatus.textContent = '';
  } catch (error) {
    if (libraryStatus) libraryStatus.textContent = '';
    if (libraryError) { libraryError.textContent = error.message; libraryError.classList.remove('hidden'); }
  }
});
document.querySelectorAll('[data-library-close]').forEach((el) => el.addEventListener('click', () => libraryDialog?.close()));
librarySearchInput?.addEventListener('input', renderPrintLibrary);
libraryUploadBtn?.addEventListener('click', () => libraryFileInput?.click());
libraryFileInput?.addEventListener('change', async () => {
  const file = libraryFileInput.files?.[0];
  if (!file) return;
  libraryUploadBtn.disabled = true;
  if (libraryError) { libraryError.textContent = ''; libraryError.classList.add('hidden'); }
  if (libraryStatus) libraryStatus.textContent = `Adding ${file.name} to Print Library…`;
  try {
    const stored = await uploadLibraryFile(file);
    if (libraryStatus) libraryStatus.textContent = stored.duplicate
      ? `${stored.fileName} is already in the Print Library.`
      : `${stored.fileName} added to the Print Library.`;
  } catch (error) {
    if (libraryStatus) libraryStatus.textContent = '';
    if (libraryError) { libraryError.textContent = error.message; libraryError.classList.remove('hidden'); }
  } finally {
    libraryFileInput.value = '';
    libraryUploadBtn.disabled = false;
  }
});
libraryList?.addEventListener('click', async (event) => {
  const queueButton = event.target.closest('[data-library-queue]');
  if (queueButton) {
    const file = (libraryState.files || []).find((item) => item.id === queueButton.dataset.libraryQueue);
    if (!file) return;
    libraryDialog?.close();
    openQueueAddDialog(file);
    return;
  }
  const deleteButton = event.target.closest('[data-library-delete]');
  if (!deleteButton) return;
  const file = (libraryState.files || []).find((item) => item.id === deleteButton.dataset.libraryDelete);
  if (!file || !confirm(`Delete ${file.fileName} from the Print Library? The stored controller copy will be removed.`)) return;
  deleteButton.disabled = true;
  try {
    await api(`/api/library/${encodeURIComponent(file.id)}`, { method:'DELETE' });
    await refreshPrintLibrary();
  } catch (error) {
    alert(error.message);
    deleteButton.disabled = false;
  }
});

queueBtn?.addEventListener('click', () => { renderPrintQueue(); queueDialog.showModal(); });
document.querySelectorAll('[data-queue-close]').forEach((el) => el.addEventListener('click', () => queueDialog.close()));
queueAddFileBtn?.addEventListener('click', () => openQueueAddDialog());
document.querySelectorAll('[data-queue-add-close]').forEach((el) => el.addEventListener('click', () => queueAddDialog?.close()));
queueAddDialog?.addEventListener('close', () => {
  queueAddLibraryFile = null;
  queueAddFileField?.classList.remove('hidden');
  if (queueAddFileInput) queueAddFileInput.required = true;
  queueAddSelectedFile?.classList.add('hidden');
});
queueAddForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = queueAddFileInput?.files?.[0];
  const submit = queueAddForm.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  if (queueAddError) { queueAddError.textContent = ''; queueAddError.classList.add('hidden'); }
  if (queueAddStatus) queueAddStatus.textContent = queueAddLibraryFile ? 'Adding library file to queue…' : 'Adding file to Print Library and queue…';
  try {
    const data = new FormData(queueAddForm);
    const quantity = Number(data.get('quantity') || 1);
    const priority = String(data.get('priority') || 'normal');
    const options = {
      levelingBeforePrint:data.get('levelingBeforePrint') === 'on',
      flowCalibrationBeforePrint:data.get('flowCalibrationBeforePrint') === 'on'
    };
    if (queueAddLibraryFile) await queueLibraryFile(queueAddLibraryFile.id, options, quantity, priority);
    else await stageAutomaticQueueFile(file, options, quantity, priority);
    if (queueAddStatus) queueAddStatus.textContent = quantity > 1 ? `Added ${quantity} copies as a production batch` : 'Added to fleet queue';
    queueAddDialog?.close();
    renderPrintQueue();
  } catch (error) {
    if (queueAddStatus) queueAddStatus.textContent = '';
    if (queueAddError) { queueAddError.textContent = error.message; queueAddError.classList.remove('hidden'); }
  } finally {
    if (submit) submit.disabled = false;
  }
});
clearQueueHistoryBtn?.addEventListener('click', async () => {
  if (!confirm('Clear completed, failed and cancelled print history? Active and queued jobs will be kept.')) return;
  try {
    const result = await api('/api/queue/history', { method:'DELETE' });
    queueState = result.queue || queueState;
    renderPrintQueue();
    await refreshPrintLibrary().catch(() => {});
  } catch (error) { alert(error.message); }
});
queueActiveList?.addEventListener('change', async (event) => {
  const jobPriority = event.target.closest('[data-queue-priority]');
  const productionPriority = event.target.closest('[data-production-priority-select]');
  if (!jobPriority && !productionPriority) return;
  const previous = jobPriority
    ? (queueState.jobs || []).find((job) => job.id === jobPriority.dataset.queuePriority)?.priority
    : (queueState.productionBatches || []).find((batch) => batch.id === productionPriority.dataset.productionPrioritySelect)?.priority;
  event.target.disabled = true;
  try {
    const endpoint = jobPriority
      ? `/api/queue/${encodeURIComponent(jobPriority.dataset.queuePriority)}/priority`
      : `/api/queue/production/${encodeURIComponent(productionPriority.dataset.productionPrioritySelect)}/priority`;
    const result = await api(endpoint, { method:'POST', body:JSON.stringify({ priority:event.target.value }) });
    queueState = result.queue || queueState;
    renderPrintQueue();
  } catch (error) {
    alert(error.message);
    event.target.value = previous || 'normal';
    event.target.disabled = false;
  }
});

queueActiveList?.addEventListener('click', async (event) => {
  const productionAction = event.target.closest('[data-production-action]');
  if (productionAction) {
    const batchId = productionAction.dataset.productionBatch;
    const action = productionAction.dataset.productionAction;
    if (action === 'cancel' && !confirm('Cancel all copies in this production batch that have not started yet? Active prints will continue.')) return;
    productionAction.disabled = true;
    try {
      const result = await api(`/api/queue/production/${encodeURIComponent(batchId)}/${action}`, { method:'POST', body:'{}' });
      queueState = result.queue || queueState;
      renderPrintQueue();
    } catch (error) { alert(error.message); productionAction.disabled = false; }
    return;
  }
  const productionQuantity = event.target.closest('[data-production-quantity]');
  if (productionQuantity) {
    const batchId = productionQuantity.dataset.productionQuantity;
    const card = productionQuantity.closest('[data-production-card]');
    const input = card?.querySelector(`[data-production-quantity-input="${batchId}"]`);
    const quantity = Number(input?.value);
    productionQuantity.disabled = true;
    try {
      const result = await api(`/api/queue/production/${encodeURIComponent(batchId)}/quantity`, { method:'POST', body:JSON.stringify({ quantity }) });
      queueState = result.queue || queueState;
      renderPrintQueue();
    } catch (error) { alert(error.message); productionQuantity.disabled = false; }
    return;
  }
  const cleared = event.target.closest('[data-bed-cleared]');
  if (cleared) {
    const item = (queueState.bedClearance || []).find((entry) => entry.printerId === cleared.dataset.bedCleared);
    if (!item) return;
    cleared.disabled = true;
    try {
      await confirmBedCleared(item.printerId, item.printerName);
    } catch (error) { alert(error.message); cleared.disabled = false; }
    return;
  }
  const recheck = event.target.closest('[data-queue-recheck]');
  if (recheck) {
    const job = (queueState.jobs || []).find((item) => item.id === recheck.dataset.queueRecheck);
    if (!job) return;
    recheck.disabled = true;
    recheck.textContent = 'Checking…';
    try {
      const result = await api(`/api/queue/${encodeURIComponent(job.id)}/recheck`, { method:'POST', body:'{}' });
      queueState = result.queue || queueState;
      renderPrintQueue();
    } catch (error) { alert(error.message); recheck.disabled = false; recheck.textContent = 'Recheck'; }
    return;
  }
  const cancel = event.target.closest('[data-queue-cancel]');
  if (cancel) {
    const job = (queueState.jobs || []).find((item) => item.id === cancel.dataset.queueCancel);
    if (!job) return;
    const active = job.status === 'starting' || job.status === 'printing';
    if (!confirm(active ? `Cancel ${job.fileName} on ${job.printerName}? This will also cancel the active printer job.` : `Remove ${job.fileName} from the queue?`)) return;
    cancel.disabled = true;
    try {
      const result = await api(`/api/queue/${encodeURIComponent(job.id)}`, { method:'DELETE' });
      queueState = result.queue || queueState;
      renderPrintQueue();
    } catch (error) { alert(error.message); cancel.disabled = false; }
    return;
  }
  const move = event.target.closest('[data-queue-up],[data-queue-down]');
  if (!move) return;
  const id = move.dataset.queueUp || move.dataset.queueDown;
  const direction = move.dataset.queueUp ? -1 : 1;
  const queued = (queueState.jobs || []).filter((job) => job.status === 'queued');
  const index = queued.findIndex((job) => job.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= queued.length) return;
  [queued[index], queued[target]] = [queued[target], queued[index]];
  move.disabled = true;
  try {
    queueState = await api('/api/queue/order', { method:'PUT', body:JSON.stringify({ jobIds:queued.map((job) => job.id) }) });
    renderPrintQueue();
  } catch (error) { alert(error.message); move.disabled = false; }
});
queueHistoryList?.addEventListener('click', async (event) => {
  const productionReprint = event.target.closest('[data-production-reprint]');
  if (productionReprint) {
    const batchId = productionReprint.dataset.productionReprint;
    const batch = (queueState.productionBatches || []).find((item) => item.id === batchId);
    if (!batch) return;
    if (!confirm(`Reprint all ${batch.quantity} copies of ${batch.fileName} as a new production batch?`)) return;
    productionReprint.disabled = true;
    try {
      const result = await api(`/api/queue/production/${encodeURIComponent(batchId)}/reprint`, { method:'POST', body:'{}' });
      queueState = result.queue || queueState;
      renderPrintQueue();
    } catch (error) { alert(error.message); productionReprint.disabled = false; }
    return;
  }
  const button = event.target.closest('[data-queue-reprint]');
  if (!button) return;
  const job = (queueState.jobs || []).find((item) => item.id === button.dataset.queueReprint);
  if (!job) return;
  const printer = fleet.find((item) => item.id === job.printerId);
  button.disabled = true;
  try {
    if (job.assignmentMode === 'automatic') {
      if (!confirm(`Queue ${job.fileName} again for the next available compatible printer?`)) return;
      const result = await api(`/api/queue/${encodeURIComponent(job.id)}/reprint`, { method:'POST', body:'{}' });
      queueState = result.queue || queueState;
      renderPrintQueue();
      return;
    }
    // A fixed U1 reprint must re-open Print setup because filament/nozzle state may
    // have changed since the historical job was queued. This avoids silently
    // reusing a stale physical tool mapping.
    if (printer?.capabilities?.printToolMapping || printer?.capabilities?.materialSlotMapping) {
      queueDialog.close();
      await openPrinter(printer.id);
      const setup = await api(`/api/printers/${encodeURIComponent(printer.id)}/print-setup?fileName=${encodeURIComponent(job.fileName)}`);
      if (printer.capabilities?.materialSlotMapping) renderBambuPrintSetup(printer, setup, job.fileName, 'queue');
      else renderU1PrintSetup(printer, setup, job.fileName, 'queue');
      return;
    }
    if (!confirm(`Queue ${job.fileName} again on ${job.printerName}?`)) return;
    const result = await api(`/api/queue/${encodeURIComponent(job.id)}/reprint`, { method:'POST', body:'{}' });
    queueState = result.queue || queueState;
    renderPrintQueue();
  } catch (error) { alert(error.message); button.disabled = false; }
});
batchModeBtn.addEventListener('click', () => setSelectionMode(!selectionMode));
document.querySelectorAll('[data-add-printer]').forEach((el) => el.addEventListener('click', openAdd));
document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => el.closest('dialog').close()));
scanNetworkBtn.addEventListener('click', scanNetwork);
adapterTypeSelect.addEventListener('change', () => renderAdapterFields(adapterTypeSelect.value));

discoveryResults.addEventListener('click', (event) => {
  const button = event.target.closest('[data-use-discovery]');
  if (!button) return;
  const printer = discoveryResults._printers?.[Number(button.dataset.useDiscovery)];
  if (!printer) return;
  const type = printer.adapterType || 'flashforge-ad5m';
  adapterTypeSelect.value = type;
  renderAdapterFields(type, {
    serialNumber: printer.serialNumber || '',
    model: printer.model || '',
    httpPort: printer.httpPort || (type === 'snapmaker-u1' ? 7125 : 8898),
    mqttPort: printer.mqttPort || 8883,
    ftpsPort: printer.ftpsPort || 990,
    cameraPort: printer.cameraPort || (type === 'bambu-lab' ? 6000 : 8080)
  });
  addForm.elements.name.value = printer.name || printer.model || 'Printer';
  addForm.elements.host.value = printer.host || '';
  const firstSpecific = adapterFields.querySelector('input:not([type=hidden])');
  firstSpecific?.focus();
});

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = addForm.querySelector('[type=submit]');
  submit.disabled = true;
  submit.textContent = 'Testing…';
  formError.classList.add('hidden');
  try {
    const body = Object.fromEntries(new FormData(addForm));
    await api('/api/printers', { method:'POST', body: JSON.stringify(body) });
    addForm.reset();
    if (adapters.length) adapterTypeSelect.value = adapters[0].type;
    renderAdapterFields(adapterTypeSelect.value);
    addDialog.close();
    lastDiscoveryAt = 0;
  } catch (error) {
    formError.textContent = error.message;
    formError.classList.remove('hidden');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Test & add';
  }
});

fleetEl.addEventListener('click', (event) => {
  const licenceToggle = event.target.closest('[data-license-slot-toggle]');
  if (licenceToggle) {
    const card = licenceToggle.closest('[data-printer-card]');
    const printer = card ? fleet.find((item) => item.id === card.dataset.printerCard) : null;
    if (!printer) return;
    const active = licenceToggle.dataset.licenseSlotToggle === 'on';
    licenceToggle.disabled = true;
    api(`/api/printers/${encodeURIComponent(printer.id)}/license-slot`, {
      method:'PUT',
      body:JSON.stringify({ active })
    }).then((result) => {
      if (result.license) setControllerLicense(result.license);
      return loadInitialFleet();
    }).catch((error) => {
      alert(error.message);
      licenceToggle.disabled = false;
    });
    return;
  }

  const bedCleared = event.target.closest('[data-bed-cleared-card]');
  if (bedCleared) {
    const card = bedCleared.closest('[data-printer-card]');
    if (!card) return;
    const printer = fleet.find((item) => item.id === card.dataset.printerCard);
    bedCleared.disabled = true;
    confirmBedCleared(card.dataset.printerCard, printer?.name)
      .catch((error) => { alert(error.message); bedCleared.disabled = false; });
    return;
  }
  const stopPreheat = event.target.closest('[data-stop-preheat]');
  if (stopPreheat) {
    const card = stopPreheat.closest('[data-printer-card]');
    if (!card) return;
    stopPreheat.disabled = true;
    api(`/api/printers/${encodeURIComponent(card.dataset.printerCard)}/chamber-preheat`, { method:'DELETE' })
      .then((result) => { if (result.warning) alert(result.warning); })
      .catch((error) => { alert(error.message); stopPreheat.disabled = false; });
    return;
  }
  const earlier = event.target.closest('[data-move-earlier]');
  if (earlier) {
    movePrinterCard(earlier.closest('[data-printer-card]'), -1);
    return;
  }
  const later = event.target.closest('[data-move-later]');
  if (later) {
    movePrinterCard(later.closest('[data-printer-card]'), 1);
    return;
  }
  const button = event.target.closest('[data-open]');
  if (button) openPrinter(button.dataset.open);
});

fleetEl.addEventListener('change', (event) => {
  const checkbox = event.target.closest?.('[data-printer-select]');
  if (!checkbox) return;
  const card = checkbox.closest('[data-printer-card]');
  if (!card) return;
  togglePrinterSelection(card.dataset.printerCard, checkbox.checked);
});

fleetEl.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-drag-handle]');
  if (!handle) return;
  const card = handle.closest('[data-printer-card]');
  if (card) card.draggable = true;
});

const disableCardDragging = (event) => {
  const card = event.target.closest?.('[data-printer-card]');
  if (card && !card.classList.contains('dragging')) card.draggable = false;
};
fleetEl.addEventListener('pointerup', disableCardDragging);
fleetEl.addEventListener('pointercancel', disableCardDragging);

fleetEl.addEventListener('dragstart', (event) => {
  const card = event.target.closest?.('[data-printer-card]');
  if (!card || card.draggable !== true) {
    event.preventDefault();
    return;
  }
  reorderInProgress = true;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.dataset.printerCard);
});

fleetEl.addEventListener('dragover', (event) => {
  const draggingCard = fleetEl.querySelector('.card.dragging');
  if (!draggingCard) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const target = cardBeforePointer(fleetEl, event.clientX, event.clientY, draggingCard);
  if (!target) {
    fleetEl.appendChild(draggingCard);
    return;
  }
  if (target.before) fleetEl.insertBefore(draggingCard, target.card);
  else fleetEl.insertBefore(draggingCard, target.card.nextElementSibling);
});

fleetEl.addEventListener('drop', (event) => {
  if (!fleetEl.querySelector('.card.dragging')) return;
  event.preventDefault();
});

fleetEl.addEventListener('dragend', (event) => {
  const card = event.target.closest?.('[data-printer-card]');
  if (!card) return;
  card.classList.remove('dragging');
  card.draggable = false;
  reorderInProgress = false;
  queueDashboardOrderSave();
});

fleetEl.addEventListener('keydown', (event) => {
  const handle = event.target.closest?.('[data-drag-handle]');
  if (!handle || !event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  movePrinterCard(handle.closest('[data-printer-card]'), ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
});

async function command(id, action, body = {}) {
  await api(`/api/printers/${id}/${action}`, { method:'POST', body: JSON.stringify(body) });
}

const batchActionDefinitions = {
  'distribute-file': {
    title: 'Upload & distribute file',
    fields: `
      <label>G-code / 3MF file<input name="file" type="file" accept=".gcode,.gx,.3mf" required></label>
      <div class="batch-field-grid distribution-options">
        <label class="checkbox-label"><input name="levelingBeforePrint" type="checkbox" checked> <span>Level supported printers before print</span></label>
        <label class="checkbox-label"><input name="flowCalibrationBeforePrint" type="checkbox"> <span>Flow-calibrate supported printers before print</span></label>
        <label class="checkbox-label"><input name="startPrint" type="checkbox"> <span>Start after verified upload</span></label>
      </div>
      <div class="field-help">The controller uploads to each selected printer, verifies the file is visible in printer storage, and only then starts printing when requested. Maximum file size 512 MB.</div>`
  },
  fans: {
    title: 'Set fan speeds',
    fields: `
      <div class="batch-field-grid">
        <label>Cooling fan % <span class="field-inline-help">blank = unchanged</span><input name="coolingFan" type="number" min="0" max="100" placeholder="0-100"></label>
        <label>Chamber fan % <span class="field-inline-help">blank = unchanged</span><input name="chamberFan" type="number" min="0" max="100" placeholder="0-100"></label>
      </div>`
  },
  'chamber-preheat-start': {
    title: 'Start chamber preheat',
    fields: `
      <div class="batch-field-grid">
        <label>Bed setpoint °C<input name="bedTemperature" type="number" min="30" max="110" value="90" required></label>
        <label>Duration minutes<input name="durationMinutes" type="number" min="1" max="120" value="45" required></label>
      </div>
      <div class="field-help">Only idle printers will start preheating. Busy, offline, faulted, or hardware-incompatible printers will be skipped. Each printer's own bed-temperature limit applies.</div>`
  }
};

function selectedNamesSummary() {
  const printers = selectedPrinters();
  if (!printers.length) return 'No printers selected';
  if (printers.length <= 3) return printers.map((printer) => printer.name).join(', ');
  return `${printers.slice(0, 3).map((printer) => printer.name).join(', ')} + ${printers.length - 3} more`;
}

function openBatchAction(action) {
  if (!selectedPrinterIds.size) return;
  const definition = batchActionDefinitions[action];
  if (!definition) return;
  pendingBatchAction = action;
  batchActionTitle.textContent = definition.title;
  batchActionSubtitle.textContent = `${selectedPrinterIds.size} selected · ${selectedNamesSummary()}`;
  batchActionFields.innerHTML = definition.fields;
  batchActionError.textContent = '';
  batchActionError.classList.add('hidden');
  const submit = batchActionForm.querySelector('[type=submit]');
  if (submit) submit.textContent = action === 'distribute-file' ? 'Upload to selected' : 'Apply';
  batchActionDialog.showModal();
}

function batchPayloadFromForm(action) {
  const form = new FormData(batchActionForm);
  if (action === 'fans') {
    const params = {};
    if (String(form.get('coolingFan') || '').trim() !== '') params.coolingFan = Number(form.get('coolingFan'));
    if (String(form.get('chamberFan') || '').trim() !== '') params.chamberFan = Number(form.get('chamberFan'));
    if (params.coolingFan === undefined && params.chamberFan === undefined) throw new Error('Enter a cooling and/or chamber fan speed');
    return params;
  }
  if (action === 'chamber-preheat-start') {
    return {
      bedTemperature: Number(form.get('bedTemperature')),
      durationMinutes: Number(form.get('durationMinutes'))
    };
  }
  return {};
}

async function runFileDistribution() {
  if (!selectedPrinterIds.size) throw new Error('Select at least one printer');
  const form = new FormData(batchActionForm);
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new Error('Choose a file to upload');
  if (!/\.(?:gcode|gx|3mf)$/i.test(file.name)) throw new Error('Choose a .gcode, .gx, or .3mf file');
  if (file.size > 512 * 1024 * 1024) throw new Error('File exceeds the 512 MB upload limit');

  const startPrint = form.get('startPrint') === 'on';
  const levelingBeforePrint = form.get('levelingBeforePrint') === 'on';
  const flowCalibrationBeforePrint = form.get('flowCalibrationBeforePrint') === 'on';
  if (startPrint && !confirm(`Upload ${file.name} to ${selectedPrinterIds.size} selected printer(s) and start printing after each upload is verified?${selectedMaterialPreflightText()}`)) return null;

  setBatchBusy(true);
  batchResult.textContent = `Uploading ${file.name}…`;
  batchResult.classList.remove('has-errors');
  batchResult.removeAttribute('title');
  try {
    const response = await fetch('/api/distribute', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
        'x-printer-ids': JSON.stringify([...selectedPrinterIds]),
        'x-start-print': String(startPrint),
        'x-level-before-print': String(levelingBeforePrint),
        'x-flow-calibration-before-print': String(flowCalibrationBeforePrint)
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);

    const failed = (result.results || []).filter((item) => !item.ok);
    const pieces = [`${result.verified}/${result.requested} verified`];
    if (startPrint) pieces.push(`${result.started} started`);
    if (failed.length) pieces.push(`${failed.length} failed`);
    batchResult.textContent = `${file.name} · ${pieces.join(' · ')}`;
    batchResult.classList.toggle('has-errors', failed.length > 0);
    batchResult.title = (result.results || []).map((item) => {
      if (item.ok) return `${item.name}: uploaded and verified${item.started ? ' · print started' : ''}`;
      return `${item.name}: ${item.error || 'failed'}`;
    }).join('\n');
    return result;
  } finally {
    setBatchBusy(false);
    updateBatchUi();
  }
}

function setBatchBusy(busy) {
  batchBusy = Boolean(busy);
  batchToolbar.querySelectorAll('button').forEach((button) => { button.disabled = batchBusy || (button.matches('[data-batch-open],[data-batch-direct]') && selectedPrinterIds.size === 0); });
  batchModeBtn.disabled = batchBusy;
}

async function runBatchAction(action, params = {}) {
  if (!selectedPrinterIds.size) throw new Error('Select at least one printer');
  setBatchBusy(true);
  batchResult.textContent = 'Applying…';
  batchResult.removeAttribute('title');
  try {
    const result = await api('/api/batch', {
      method:'POST',
      body: JSON.stringify({ printerIds: [...selectedPrinterIds], action, params })
    });
    const failed = (result.results || []).filter((item) => !item.ok);
    batchResult.textContent = failed.length
      ? `${result.succeeded} succeeded · ${failed.length} skipped/failed`
      : `${result.succeeded} succeeded`;
    batchResult.classList.toggle('has-errors', failed.length > 0);
    if (failed.length) batchResult.title = failed.map((item) => `${item.name}: ${item.error}`).join('\n');
    else batchResult.removeAttribute('title');
    return result;
  } finally {
    setBatchBusy(false);
    updateBatchUi();
  }
}

batchToolbar.addEventListener('click', async (event) => {
  const selectAll = event.target.closest('[data-batch-select-all]');
  if (selectAll) {
    fleet.forEach((printer) => selectedPrinterIds.add(printer.id));
    updateBatchUi();
    return;
  }
  if (event.target.closest('[data-batch-clear]')) {
    selectedPrinterIds.clear();
    batchResult.textContent = '';
    batchResult.classList.remove('has-errors');
    batchResult.removeAttribute('title');
    updateBatchUi();
    return;
  }
  const open = event.target.closest('[data-batch-open]');
  if (open) {
    openBatchAction(open.dataset.batchOpen);
    return;
  }
  const direct = event.target.closest('[data-batch-direct]');
  if (!direct) return;
  const action = direct.dataset.batchDirect;
  const confirmations = {
    'chamber-preheat-stop': `Stop chamber preheat on the ${selectedPrinterIds.size} selected printer(s)?`,
    'heaters-off': `Turn the nozzle and bed heaters OFF on the ${selectedPrinterIds.size} selected printer(s)?`,
    cancel: `Cancel active prints on the ${selectedPrinterIds.size} selected printer(s)? This cannot be undone.`
  };
  if (confirmations[action] && !confirm(confirmations[action])) return;
  try {
    await runBatchAction(action);
  } catch (error) {
    batchResult.textContent = error.message;
    batchResult.classList.add('has-errors');
  }
});

batchActionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  batchActionError.classList.add('hidden');
  const submit = batchActionForm.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    if (pendingBatchAction === 'distribute-file') {
      const result = await runFileDistribution();
      if (result) batchActionDialog.close();
      return;
    }
    const params = batchPayloadFromForm(pendingBatchAction);
    if (pendingBatchAction === 'chamber-preheat-start' && !confirm(`Start chamber preheat on the ${selectedPrinterIds.size} selected printer(s)?`)) return;
    await runBatchAction(pendingBatchAction, params);
    batchActionDialog.close();
  } catch (error) {
    batchActionError.textContent = error.message;
    batchActionError.classList.remove('hidden');
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('[data-batch-dialog-close]').forEach((button) => button.addEventListener('click', () => batchActionDialog.close()));
batchActionDialog.addEventListener('close', () => {
  pendingBatchAction = null;
  batchActionFields.innerHTML = '';
  const submit = batchActionForm.querySelector('[type=submit]');
  if (submit) submit.textContent = 'Apply';
});

function detailCameraMarkup(printer) {
  if (!printer.capabilities?.camera || !printer.online || printer.cameraAvailable === false) return '<div class="detail-camera camera-placeholder">Camera unavailable while printer is offline</div>';
  const cameraUrl = `/api/printers/${encodeURIComponent(printer.id)}/camera/stream`;
  return `<img class="detail-camera" src="${escapeHtml(cameraUrl)}" alt="${escapeHtml(printer.name)} camera">`;
}

function filamentMaterialName(filament = {}) {
  const parts = [filament.material, filament.materialVariant].filter((value, index, all) => value && all.indexOf(value) === index);
  return parts.length ? parts.join(' · ') : 'Material unknown';
}

function filamentMetaText(filament = {}) {
  const source = filament.materialSource === 'manual'
    ? 'Manually assigned'
    : filament.materialSource === 'rfid'
      ? 'RFID detected'
      : filament.materialSource === 'printer'
        ? 'Printer reported'
        : null;
  const reported = filament.materialSource === 'manual' && filament.reportedMaterial
    ? `Printer reports ${filament.reportedMaterial}`
    : null;
  const values = [source, reported, filament.vendor || filament.manufacturer, normalizeColor(filament.color)].filter(Boolean);
  return values.length ? values.join(' · ') : 'No material metadata';
}

function filamentPresenceText(filament = {}) {
  if (filament.present === true) return filament.detecting ? 'Filament detected · reading tag…' : 'Filament detected';
  if (filament.present === false) return 'No filament detected';
  return 'Filament presence unavailable';
}

function materialSummaryText(tools = []) {
  const known = tools.filter((tool) => tool.filament?.present !== null);
  const loaded = known.filter((tool) => tool.filament?.present === true).length;
  const metadata = tools.filter((tool) => tool.filament?.metadataAvailable).length;
  if (!known.length) return `Filament presence unavailable · material data on ${metadata}/${tools.length}`;
  return `${loaded}/${known.length} toolheads report filament · material data on ${metadata}/${tools.length}`;
}

function materialSwatchColor(filament = {}) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(filament.color || '')) ? filament.color : null;
}

function filamentRgbText(value) {
  const color = normalizeColor(value);
  if (!color) return null;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `RGB(${red}, ${green}, ${blue})`;
}

function filamentColorText(value) {
  const color = normalizeColor(value);
  if (!color) return null;
  return `${color} · ${filamentRgbText(color)}`;
}

const SNAPMAKER_U1_FILAMENT_TYPES = [
  'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PVA', 'PA', 'PA-CF', 'PA-GF',
  'PA6-CF', 'PA6-GF', 'PC', 'PC-ABS', 'PETG-CF', 'PLA-CF', 'PEBA'
];

function u1FilamentConfigEditState(printer, tool = {}) {
  const filament = tool.filament || {};
  if (printer?.adapterType !== 'snapmaker-u1' || !printer?.capabilities?.filamentTypeControl || !printer?.capabilities?.filamentColorControl) {
    return { enabled:false, message:'Filament editing is unavailable.' };
  }
  if (String(printer.status?.status || '').toLowerCase() !== 'idle') {
    return { enabled:false, message:'Filament can be changed while the U1 is idle.' };
  }
  if (filament.present !== true) return { enabled:false, message:`Load filament in T${tool.index} before setting its type and colour.` };
  if (filament.officialFilament === true || filament.editable === false) {
    return { enabled:false, message:'Official Snapmaker RFID filament controls its own type and colour.' };
  }
  return { enabled:true, message:'Writes the type and colour together, then verifies both from the U1.' };
}

function u1FilamentConfigControlMarkup(printer, tool = {}) {
  if (printer?.adapterType !== 'snapmaker-u1' || !printer?.capabilities?.filamentTypeControl || !printer?.capabilities?.filamentColorControl) return '';
  const filament = tool.filament || {};
  const state = u1FilamentConfigEditState(printer, tool);
  const material = String(filament.material || '').trim().toUpperCase();
  const knownMaterial = SNAPMAKER_U1_FILAMENT_TYPES.includes(material);
  const color = normalizeColor(filament.color) || '#FFFFFF';
  return `<div class="u1-filament-config-control" data-u1-filament-config-control="${tool.index}">
    <label>Filament type<select data-u1-filament-type-input="${tool.index}"${state.enabled ? '' : ' disabled'}>
      <option value=""${knownMaterial ? '' : ' selected'}>Select type</option>
      ${SNAPMAKER_U1_FILAMENT_TYPES.map((value) => `<option value="${value}"${value === material ? ' selected' : ''}>${value}</option>`).join('')}
    </select></label>
    <label>Colour<input type="color" data-u1-filament-color-input="${tool.index}" value="${escapeHtml(color)}"${state.enabled ? '' : ' disabled'}></label>
    <button type="button" class="secondary" data-u1-filament-config-save="${tool.index}"${state.enabled ? '' : ' disabled'}>Set filament on U1</button>
    <small data-u1-filament-config-help="${tool.index}">${escapeHtml(state.message)}</small>
  </div>`;
}

function flashForgeMaterialDesignationMarkup(printer, filament = {}) {
  if (!printer?.capabilities?.materialDesignation) return '';
  const manualValue = filament.materialSource === 'manual'
    ? String(filament.material || '')
    : String(printer.materialDesignation || '');
  const manualColor = filament.colorSource === 'manual'
    ? String(filament.color || '')
    : String(printer.materialColorDesignation || '');
  const colorValue = /^#[0-9A-Fa-f]{6}$/.test(manualColor) ? manualColor : '#FFFFFF';
  const reported = filament.reportedMaterial || (filament.materialSource === 'printer' ? filament.material : null);
  const clearLabel = reported ? 'Use printer value' : 'Clear designation';
  const options = ['PLA','PETG','ABS','ASA','TPU','PC','PA','Nylon','PVA','HIPS','PP','PET','PLA-CF','PETG-CF','ASA-CF','PA-CF','PC-CF'];
  return `<div class="material-designation-control">
    <div class="material-designation-fields">
      <label>Controller material type
        <input type="text" data-material-designation-input value="${escapeHtml(manualValue)}" list="flashforgeMaterialTypes" maxlength="48" placeholder="e.g. PLA, PETG, ASA" autocomplete="off" />
      </label>
      <label>Controller filament colour
        <input type="color" data-material-color-input value="${escapeHtml(colorValue)}" aria-label="Controller filament colour" />
      </label>
    </div>
    <datalist id="flashforgeMaterialTypes">${options.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('')}</datalist>
    <div class="mini-actions"><button type="button" class="secondary" data-material-designation-save>Assign filament</button><button type="button" class="secondary" data-material-designation-clear>${escapeHtml(clearLabel)}</button></div>
    <div class="field-help">Stored by Print Farm Controller for this printer. Material and colour are used by automatic queue compatibility until cleared.${reported ? ` Printer currently reports material ${escapeHtml(reported)}.` : ''}</div>
  </div>`;
}

function flashForgeNozzleDesignationMarkup(printer, tool = {}) {
  if (!printer?.capabilities?.nozzleDesignation) return '';
  const manualValue = tool.nozzleDiameterSource === 'manual' && Number.isFinite(Number(tool.nozzleDiameter))
    ? Number(tool.nozzleDiameter)
    : (Number.isFinite(Number(printer.nozzleDiameterDesignation)) ? Number(printer.nozzleDiameterDesignation) : '');
  const reported = Number.isFinite(Number(tool.reportedNozzleDiameter)) && Number(tool.reportedNozzleDiameter) > 0
    ? Number(tool.reportedNozzleDiameter)
    : null;
  const clearLabel = reported ? 'Use printer value' : 'Clear designation';
  const options = [0.25, 0.4, 0.6, 0.8];
  return `<div class="material-designation-control nozzle-designation-control">
    <label>Controller nozzle designation
      <input type="number" data-nozzle-designation-input value="${escapeHtml(manualValue)}" list="flashforgeNozzleSizes" min="0.1" max="1.2" step="0.05" placeholder="e.g. 0.4" />
    </label>
    <datalist id="flashforgeNozzleSizes">${options.map((value) => `<option value="${value}"></option>`).join('')}</datalist>
    <div class="mini-actions"><button type="button" class="secondary" data-nozzle-designation-save>Assign nozzle</button><button type="button" class="secondary" data-nozzle-designation-clear>${escapeHtml(clearLabel)}</button></div>
    <div class="field-help">Stored by Print Farm Controller for this printer and used by automatic queue compatibility.${reported ? ` Printer currently reports ${escapeHtml(nozzleDiameterText(reported))}.` : ' FlashForge firmware does not reliably report the installed nozzle size, so set this whenever you change the nozzle.'}</div>
  </div>`;
}

function nozzleDiameterText(value) {
  const diameter = Number(value);
  return Number.isFinite(diameter) && diameter > 0 ? `${diameter.toFixed(1)} mm nozzle` : 'nozzle size unknown';
}

function toolOffsetText(offset) {
  if (!Array.isArray(offset) || offset.length < 3) return 'offset unavailable';
  const values = offset.slice(0, 3).map(Number);
  if (!values.every(Number.isFinite)) return 'offset unavailable';
  return `X ${values[0].toFixed(2)} · Y ${values[1].toFixed(2)} · Z ${values[2].toFixed(2)} mm`;
}

function toolCalibrationStateText(calibration = {}) {
  if (calibration.available === false) return 'Calibration status unavailable';
  const state = String(calibration.state || 'idle').trim().replace(/_/g, ' ');
  if (!state || state === 'idle') return 'Idle · ready to start';
  return state.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function calibrationResultText(result) {
  if (!Array.isArray(result) || result.length < 3) return 'Not probed in this session';
  const values = result.slice(0, 3).map(Number);
  if (!values.every(Number.isFinite)) return 'Probe result unavailable';
  return `Measured X ${values[0].toFixed(2)} · Y ${values[1].toFixed(2)} · Z ${values[2].toFixed(2)} mm`;
}

function calibrationCleaningToolIndex(calibration = {}) {
  const state = String(calibration.state || '').trim().toLowerCase();
  const match = state.match(/^extruder(\d*)_nozzle_clean$/);
  if (!match) return null;
  return match[1] === '' ? 0 : Number(match[1]);
}

function calibrationCleanText(tool = {}, calibration = {}) {
  const activeClean = calibrationCleaningToolIndex(calibration);
  if (activeClean === Number(tool.index)) return 'At front · waiting for you to clean nozzle';
  if (tool.nozzleClean === true) return 'Cleaning stage completed';
  if (tool.nozzleClean === false) return 'Not prepared for cleaning';
  return 'Cleaning status unavailable';
}

async function flashForgeFileMaterialCheck(printer, fileName) {
  if (printer?.adapterType !== 'flashforge-ad5m' || !printer?.materialDesignation) return null;
  return api(`/api/printers/${encodeURIComponent(printer.id)}/file-material?fileName=${encodeURIComponent(fileName)}`);
}

function flashForgeFileMaterialText(check, { queue = false } = {}) {
  if (!check) return '';
  if (check.mismatch) {
    return `MATERIAL MISMATCH
File requires: ${check.requiredMaterial}
Printer designated: ${check.designatedMaterial}

${queue ? 'This job will be held as Needs review and will not start unattended until the designation matches and you recheck it.' : 'You can continue only by confirming this warning.'}`;
  }
  if (check.requiredMaterial) return `Material check: ${check.requiredMaterial} file · ${check.designatedMaterial || 'no manual designation'} loaded designation`;
  return `Material check: file requirement unknown. ${check.warning || 'No reliable filament metadata is available for this file.'}`;
}

function materialPreflightText(printer) {
  if (printer?.adapterType !== 'snapmaker-u1') return '';
  if (!printer?.capabilities?.materialStatus || !Array.isArray(printer.status?.tools)) return '';
  const tools = printer.status.tools;
  if (!tools.some((tool) => tool.filament?.present !== null || tool.filament?.metadataAvailable)) return '';
  const lines = tools.map((tool) => {
    const filament = tool.filament || {};
    const presence = filament.present === true ? 'filament detected' : filament.present === false ? 'NO FILAMENT' : 'sensor unknown';
    const material = filament.metadataAvailable ? filamentMaterialName(filament) : 'material unknown';
    const colorText = filamentColorText(filament.color);
    const color = colorText ? ` · ${colorText}` : '';
    const source = filament.materialSource === 'manual' ? ' · manually assigned' : filament.materialSource === 'rfid' ? ' · RFID' : '';
    return `T${tool.index}: ${presence} · ${material}${color}${source}`;
  });
  return `U1 material preflight:
${lines.join('\n')}

This is advisory: the controller does not block the job because a stored G-code file may use only a subset of the four U1 tools.`;
}

function normalizeColor(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : null;
}

function normalizedMaterial(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9+_-]/g, '');
}

function defaultU1ToolMap(printer, setup) {
  const physicalTools = Array.isArray(printer.status?.tools) ? printer.status.tools : [];
  const mapping = {};
  const usedPhysical = new Set();
  const nozzleMatch = (physical, logical) => {
    const wanted = Number(logical?.nozzleDiameter);
    const actual = Number(physical?.nozzleDiameter);
    return !Number.isFinite(wanted) || !Number.isFinite(actual) || Math.abs(wanted - actual) < 0.001;
  };
  for (const logical of setup.logicalTools || []) {
    const wantedColor = normalizeColor(logical.color);
    let selected = null;
    if (wantedColor) {
      selected = physicalTools.find((tool) => tool.filament?.present === true && normalizeColor(tool.filament?.color) === wantedColor && nozzleMatch(tool, logical) && !usedPhysical.has(tool.index));
      if (!selected) selected = physicalTools.find((tool) => tool.filament?.present === true && normalizeColor(tool.filament?.color) === wantedColor && !usedPhysical.has(tool.index));
      if (!selected) selected = physicalTools.find((tool) => tool.filament?.present === true && normalizeColor(tool.filament?.color) === wantedColor);
    }
    if (!selected && logical.index < 4) selected = physicalTools.find((tool) => tool.index === logical.index && nozzleMatch(tool, logical) && !usedPhysical.has(tool.index));
    if (!selected) selected = physicalTools.find((tool) => tool.filament?.present === true && nozzleMatch(tool, logical) && !usedPhysical.has(tool.index));
    if (!selected && logical.index < 4) selected = physicalTools.find((tool) => tool.index === logical.index && !usedPhysical.has(tool.index));
    if (!selected) selected = physicalTools.find((tool) => tool.filament?.present === true && !usedPhysical.has(tool.index));
    if (!selected) selected = physicalTools.find((tool) => !usedPhysical.has(tool.index));
    if (!selected) selected = physicalTools[0] || { index:0 };
    mapping[logical.index] = selected.index;
    usedPhysical.add(selected.index);
  }
  return mapping;
}

function physicalToolChoiceMarkup(tool, { summary = false, selected = false } = {}) {
  const filament = tool?.filament || {};
  const material = filamentMaterialName(filament);
  const color = materialSwatchColor(filament);
  const colorText = filamentColorText(filament.color);
  const presence = filamentPresenceText(filament);
  const nozzle = nozzleDiameterText(tool?.nozzleDiameter);
  const swatch = `<span class="material-swatch${color ? '' : ' unknown'}"${color ? ` style="background:${escapeHtml(color)}"` : ''} title="${escapeHtml(color ? 'Configured filament colour' : 'Colour unknown')}"></span>`;
  const details = [presence, colorText, nozzle].filter(Boolean).join(' · ');
  const text = `<span class="tool-map-choice-text"><strong>T${tool.index} · ${escapeHtml(material)}</strong><small>${escapeHtml(details)}</small></span>`;
  if (summary) return `<span class="tool-map-selected">${swatch}${text}</span><span class="tool-map-caret" aria-hidden="true">▾</span>`;
  return `<button type="button" class="tool-map-option${selected ? ' selected' : ''}" data-tool-map-option="${tool.index}">${swatch}${text}</button>`;
}

function physicalToolPickerMarkup(logicalIndex, physicalTools, selectedIndex) {
  const selectedTool = physicalTools.find((tool) => Number(tool.index) === Number(selectedIndex)) || physicalTools[0] || { index:0, filament:{} };
  const options = physicalTools.map((tool) => physicalToolChoiceMarkup(tool, { selected:Number(tool.index) === Number(selectedIndex) })).join('');
  return `<input type="hidden" data-tool-map="${logicalIndex}" value="${selectedTool.index}">
    <details class="tool-map-picker" data-tool-map-picker="${logicalIndex}">
      <summary data-tool-map-summary>${physicalToolChoiceMarkup(selectedTool, { summary:true })}</summary>
      <div class="tool-map-menu">${options}</div>
    </details>`;
}

function u1MappingAssessment(printer, setup, toolMap) {
  const physicalTools = Array.isArray(printer.status?.tools) ? printer.status.tools : [];
  const warnings = [];
  const errors = [];
  const assigned = new Map();
  for (const logical of setup.logicalTools || []) {
    const physicalIndex = Number(toolMap[logical.index]);
    const physical = physicalTools.find((tool) => Number(tool.index) === physicalIndex);
    if (!physical) {
      errors.push(`File T${logical.index} has no valid physical U1 head selected.`);
      continue;
    }
    const prior = assigned.get(physicalIndex);
    if (prior) {
      const priorColor = normalizeColor(prior.color);
      const currentColor = normalizeColor(logical.color);
      if (!priorColor || !currentColor || priorColor !== currentColor) {
        errors.push(`Physical T${physicalIndex} is assigned to multiple file tools with different or unknown colours.`);
      }
    } else {
      assigned.set(physicalIndex, logical);
    }

    const filament = physical.filament || {};
    if (filament.present === false) warnings.push(`Physical T${physicalIndex} is required for file T${logical.index}, but no filament is detected.`);
    const wantedColor = normalizeColor(logical.color);
    const loadedColor = normalizeColor(filament.color);
    if (wantedColor && loadedColor && wantedColor !== loadedColor) warnings.push(`File T${logical.index} requests ${wantedColor}, but physical T${physicalIndex} is configured as ${loadedColor}.`);
    const wantedMaterial = normalizedMaterial(logical.material);
    const loadedMaterial = normalizedMaterial(filament.material);
    if (wantedMaterial && loadedMaterial && wantedMaterial !== loadedMaterial) warnings.push(`File T${logical.index} requests ${logical.material}, but physical T${physicalIndex} is configured as ${filament.material}.`);
    const wantedNozzle = Number(logical.nozzleDiameter);
    const loadedNozzle = Number(physical.nozzleDiameter);
    if (Number.isFinite(wantedNozzle) && Number.isFinite(loadedNozzle) && Math.abs(wantedNozzle - loadedNozzle) >= 0.001) {
      warnings.push(`File T${logical.index} requests a ${wantedNozzle.toFixed(1)} mm nozzle, but physical T${physicalIndex} has a ${loadedNozzle.toFixed(1)} mm nozzle.`);
    }
  }
  return { warnings:[...new Set(warnings)], errors:[...new Set(errors)] };
}

function defaultBambuMaterialMap(setup) {
  const sources = (setup.materialSources || []).filter((source) => source.present !== false);
  const mapping = {};
  const used = new Set();
  for (const logical of setup.logicalTools || []) {
    const wantedMaterial = normalizedMaterial(logical.material);
    const wantedColor = normalizeColor(logical.color);
    let selected = sources.find((source) => !used.has(source.protocolIndex)
      && (!wantedMaterial || normalizedMaterial(source.material) === wantedMaterial)
      && (!wantedColor || normalizeColor(source.color) === wantedColor));
    if (!selected) selected = sources.find((source) => !used.has(source.protocolIndex) && (!wantedMaterial || normalizedMaterial(source.material) === wantedMaterial));
    if (!selected) selected = sources.find((source) => !used.has(source.protocolIndex));
    if (!selected) selected = sources[0];
    if (selected) { mapping[logical.index] = selected.protocolIndex; used.add(selected.protocolIndex); }
  }
  return mapping;
}

function bambuMappingAssessment(setup, materialMap) {
  const sources = setup.materialSources || [];
  const warnings = [];
  const errors = [];
  const used = new Set();
  for (const logical of setup.logicalTools || []) {
    const protocolIndex = Number(materialMap[logical.index]);
    const source = sources.find((item) => Number(item.protocolIndex) === protocolIndex);
    if (!source) { errors.push(`File T${logical.index} has no valid material source selected.`); continue; }
    if (source.present === false) errors.push(`${source.label} is empty.`);
    if (used.has(protocolIndex)) errors.push(`${source.label} is assigned more than once.`);
    used.add(protocolIndex);
    const wantedMaterial = normalizedMaterial(logical.material);
    const loadedMaterial = normalizedMaterial(source.material);
    if (wantedMaterial && loadedMaterial && wantedMaterial !== loadedMaterial) warnings.push(`File T${logical.index} requests ${logical.material}, but ${source.label} contains ${source.material}.`);
    const wantedColor = normalizeColor(logical.color);
    const loadedColor = normalizeColor(source.color);
    if (wantedColor && loadedColor && wantedColor !== loadedColor) warnings.push(`File T${logical.index} requests ${wantedColor}, but ${source.label} contains ${loadedColor}.`);
  }
  return { warnings:[...new Set(warnings)], errors:[...new Set(errors)] };
}

function renderBambuPrintSetup(printer, setup, fileName, mode = 'print') {
  const panel = printerDetail.querySelector('#printSetupPanel');
  if (!panel) return;
  const queueMode = mode === 'queue';
  const mapping = defaultBambuMaterialMap(setup);
  const sources = setup.materialSources || [];
  const rows = (setup.logicalTools || []).map((logical) => {
    const label = [logical.material || 'material unknown', logical.color || 'colour unknown'].filter(Boolean).join(' · ');
    const options = sources.map((source) => `<option value="${source.protocolIndex}"${Number(mapping[logical.index]) === Number(source.protocolIndex) ? ' selected' : ''}${source.present === false ? ' disabled' : ''}>${escapeHtml(`${source.label} · ${source.present === false ? 'empty' : `${source.material || 'unknown'} · ${source.color || 'colour unknown'}`}`)}</option>`).join('');
    return `<div class="tool-map-row"><div class="tool-map-file"><strong>File T${logical.index}</strong><span>${escapeHtml(label)}</span></div><label>Material source<select data-bambu-material-map="${logical.index}">${options}</select></label></div>`;
  }).join('');
  panel.innerHTML = `<div class="print-setup-head"><div><strong>${queueMode ? 'Queue setup' : 'Print setup'}</strong><span>${escapeHtml(fileName)}</span></div><button type="button" class="icon" data-print-setup-close>×</button></div>
    <div class="field-help">Map each filament used by the file to a loaded AMS slot. The external spool is available for single-material printing.</div>
    ${setup.warning ? `<div class="file-warning">${escapeHtml(setup.warning)}</div>` : ''}
    <div class="tool-map-grid">${rows || '<div class="file-warning">No reliable filament requirements were found. The printer will use its default external-spool path.</div>'}</div>
    <div id="printSetupAssessment" class="print-setup-assessment"></div>
    <div class="actions"><button type="button" class="secondary" data-print-setup-close>Cancel</button><button type="button" class="primary" data-print-setup-start>${queueMode ? 'Add to queue' : 'Start print'}</button></div>`;
  panel.classList.remove('hidden');
  const currentMap = () => Object.fromEntries([...panel.querySelectorAll('[data-bambu-material-map]')].map((select) => [select.dataset.bambuMaterialMap, Number(select.value)]));
  const refresh = () => {
    const assessment = bambuMappingAssessment(setup, currentMap());
    if (setup.amsMappingSupported === false) assessment.errors.push('Bambu multi-material AMS printing requires a sliced .3mf project file.');
    const target = panel.querySelector('#printSetupAssessment');
    target.textContent = [...assessment.errors.map((value) => `BLOCK: ${value}`), ...assessment.warnings.map((value) => `Warning: ${value}`)].join('\n');
    target.classList.toggle('has-errors', assessment.errors.length > 0);
    panel.querySelector('[data-print-setup-start]').disabled = assessment.errors.length > 0;
  };
  panel.querySelectorAll('[data-bambu-material-map]').forEach((select) => select.addEventListener('change', refresh));
  panel.querySelectorAll('[data-print-setup-close]').forEach((button) => button.onclick = () => panel.classList.add('hidden'));
  panel.querySelector('[data-print-setup-start]').onclick = async () => {
    const materialMap = currentMap();
    const assessment = bambuMappingAssessment(setup, materialMap);
    if (assessment.errors.length) return;
    const options = {
      levelingBeforePrint:printerDetail.querySelector('#levelBeforePrint')?.checked ?? false,
      flowCalibrationBeforePrint:printerDetail.querySelector('#flowCalibrationBeforePrint')?.checked ?? false,
      materialMap,
      usedLogicalTools:setup.referencedTools || []
    };
    if (!confirm(`${queueMode ? 'Add to queue' : 'Start'} ${fileName} ${queueMode ? `for ${printer.name}` : `on ${printer.name}`}?${assessment.warnings.length ? `\n\n${assessment.warnings.join('\n')}` : ''}`)) return;
    try {
      if (queueMode) await addPrintQueueJob(printer, fileName, options);
      else await command(printer.id, 'print', { fileName, ...options });
      printerDialog.close();
      if (queueMode) { renderPrintQueue(); queueDialog.showModal(); }
    } catch (error) { showError(error); }
  };
  refresh();
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function renderU1PrintSetup(printer, setup, fileName, mode = 'print') {
  const panel = printerDetail.querySelector('#printSetupPanel');
  if (!panel) return;
  const queueMode = mode === 'queue';
  const physicalTools = Array.isArray(printer.status?.tools) ? printer.status.tools : [];
  const mapping = defaultU1ToolMap(printer, setup);
  const printPreferences = printer.status?.printPreferences || {};
  const timeLapseDefault = printPreferences.timeLapseCamera === true;
  const autoReplenishDefault = printPreferences.autoReplenishFilament !== false;
  const entangleDefault = printPreferences.filamentEntangleDetect === true;
  const entangleSensitivity = ['low', 'medium', 'high'].includes(String(printPreferences.filamentEntangleSensitivity || '').toLowerCase())
    ? String(printPreferences.filamentEntangleSensitivity).toLowerCase()
    : 'medium';
  const rows = (setup.logicalTools || []).map((logical) => {
    const fileLabel = [logical.material || 'material unknown', logical.color || 'colour unknown', logical.nozzleDiameter != null ? nozzleDiameterText(logical.nozzleDiameter) : null, logical.weightGrams != null ? `${Number(logical.weightGrams).toFixed(1)} g` : null].filter(Boolean).join(' · ');
    const picker = physicalToolPickerMarkup(logical.index, physicalTools, mapping[logical.index]);
    return `<div class="tool-map-row" data-tool-map-row="${logical.index}">
      <div class="tool-map-file"><strong>File T${logical.index}</strong><span>${escapeHtml(fileLabel)}</span></div>
      <label>Physical head${picker}</label>
    </div>`;
  }).join('');
  panel.innerHTML = `<div class="print-setup-head"><div><strong>${queueMode ? 'Queue setup' : 'Print setup'}</strong><span>${escapeHtml(fileName)}</span></div><button type="button" class="icon" data-print-setup-close>×</button></div>
    <div class="field-help">Map each logical tool used by the G-code to one of the U1's four physical heads. Exact loaded-colour matches are selected automatically where possible.</div>
    ${setup.warning ? `<div class="file-warning">${escapeHtml(setup.warning)}</div>` : ''}
    <div class="tool-map-grid">${rows || '<div class="subtle">No tool information was found; T0 will be used by the printer defaults.</div>'}</div>
    <div class="u1-print-options">
      <div class="u1-print-options-head"><strong>U1 print options</strong><span>${queueMode ? 'Saved with this queued job and applied when it starts' : 'Applied immediately before the print starts'}</span></div>
      <div class="u1-print-options-grid">
        <label class="checkbox-label"><input type="checkbox" id="printSetupTimeLapse"${timeLapseDefault ? ' checked' : ''}${printer.cameraAvailable === false ? ' disabled' : ''}> <span>Timelapse</span></label>
        <label class="checkbox-label"><input type="checkbox" id="printSetupAutoReplenish"${autoReplenishDefault ? ' checked' : ''}> <span>Auto filament replenishment</span></label>
        <label class="checkbox-label"><input type="checkbox" id="printSetupEntangle"${entangleDefault ? ' checked' : ''}> <span>Filament entanglement detection</span></label>
        <label class="u1-entangle-sensitivity" for="printSetupEntangleSensitivity">Entanglement sensitivity
          <select id="printSetupEntangleSensitivity"${entangleDefault ? '' : ' disabled'}>
            <option value="low"${entangleSensitivity === 'low' ? ' selected' : ''}>Low</option>
            <option value="medium"${entangleSensitivity === 'medium' ? ' selected' : ''}>Medium</option>
            <option value="high"${entangleSensitivity === 'high' ? ' selected' : ''}>High</option>
          </select>
        </label>
      </div>
      <div class="field-help">Auto replenishment uses the U1's native runout handoff logic and still depends on a compatible loaded replacement. Entanglement detection uses the U1's own filament-feed sensing. Timelapse requires the built-in camera${printer.cameraAvailable === false ? ', which is currently unavailable' : ''}.</div>
    </div>
    <div id="printSetupAssessment" class="print-setup-assessment"></div>
    <div class="actions"><button type="button" class="secondary" data-print-setup-close>Cancel</button><button type="button" class="primary" data-print-setup-start>${queueMode ? 'Add to queue' : 'Start print'}</button></div>`;
  panel.classList.remove('hidden');
  panel.dataset.fileName = fileName;
  panel.dataset.mode = mode;
  panel._setup = setup;

  const refreshAssessment = () => {
    const toolMap = {};
    panel.querySelectorAll('[data-tool-map]').forEach((select) => { toolMap[Number(select.dataset.toolMap)] = Number(select.value); });
    const assessment = u1MappingAssessment(printer, setup, toolMap);
    const target = panel.querySelector('#printSetupAssessment');
    const messages = [...assessment.errors.map((text) => `BLOCK: ${text}`), ...assessment.warnings.map((text) => `Warning: ${text}`)];
    target.textContent = messages.join('\n');
    target.classList.toggle('has-errors', assessment.errors.length > 0);
    panel.querySelector('[data-print-setup-start]').disabled = assessment.errors.length > 0;
  };
  panel.querySelectorAll('[data-tool-map]').forEach((input) => input.addEventListener('change', refreshAssessment));
  panel.querySelectorAll('[data-tool-map-option]').forEach((option) => option.addEventListener('click', () => {
    const picker = option.closest('[data-tool-map-picker]');
    const logicalIndex = Number(picker?.dataset.toolMapPicker);
    const input = panel.querySelector(`[data-tool-map="${logicalIndex}"]`);
    const selectedTool = physicalTools.find((tool) => Number(tool.index) === Number(option.dataset.toolMapOption));
    if (!picker || !input || !selectedTool) return;
    input.value = String(selectedTool.index);
    picker.querySelector('[data-tool-map-summary]').innerHTML = physicalToolChoiceMarkup(selectedTool, { summary:true });
    picker.querySelectorAll('[data-tool-map-option]').forEach((item) => item.classList.toggle('selected', item === option));
    picker.open = false;
    input.dispatchEvent(new Event('change', { bubbles:true }));
  }));
  const entangleToggle = panel.querySelector('#printSetupEntangle');
  const entangleSensitivityInput = panel.querySelector('#printSetupEntangleSensitivity');
  if (entangleToggle && entangleSensitivityInput) {
    entangleToggle.addEventListener('change', () => { entangleSensitivityInput.disabled = !entangleToggle.checked; });
  }
  panel.querySelectorAll('[data-print-setup-close]').forEach((button) => button.onclick = () => panel.classList.add('hidden'));
  panel.querySelector('[data-print-setup-start]').onclick = async () => {
    const toolMap = {};
    panel.querySelectorAll('[data-tool-map]').forEach((select) => { toolMap[Number(select.dataset.toolMap)] = Number(select.value); });
    const assessment = u1MappingAssessment(printer, setup, toolMap);
    if (assessment.errors.length) return;
    const preflight = assessment.warnings.length ? `\n\n${assessment.warnings.join('\n')}` : '';
    const leveling = printerDetail.querySelector('#levelBeforePrint')?.checked ?? false;
    const flowCalibration = printerDetail.querySelector('#flowCalibrationBeforePrint')?.checked ?? false;
    const timeLapse = panel.querySelector('#printSetupTimeLapse')?.checked ?? false;
    const autoReplenish = panel.querySelector('#printSetupAutoReplenish')?.checked ?? true;
    const entangleDetect = panel.querySelector('#printSetupEntangle')?.checked ?? false;
    const entangleSensitivityValue = panel.querySelector('#printSetupEntangleSensitivity')?.value || 'medium';
    const verb = queueMode ? 'Add to queue' : 'Start';
    if (!confirm(`${verb} ${fileName} ${queueMode ? `for ${printer.name}` : `on ${printer.name}`}?\n\nBed levelling: ${leveling ? 'yes' : 'no'}\nFlow calibration: ${flowCalibration ? 'yes' : 'no'}\nTimelapse: ${timeLapse ? 'yes' : 'no'}\nAuto filament replenishment: ${autoReplenish ? 'yes' : 'no'}\nEntanglement detection: ${entangleDetect ? `yes (${entangleSensitivityValue})` : 'no'}${preflight}`)) return;
    const options = {
      levelingBeforePrint: leveling,
      flowCalibrationBeforePrint: flowCalibration,
      timeLapseBeforePrint: timeLapse,
      autoReplenishFilament: autoReplenish,
      filamentEntangleDetect: entangleDetect,
      filamentEntangleSensitivity: entangleSensitivityValue,
      toolMap,
      usedLogicalTools: setup.referencedTools || []
    };
    try {
      if (queueMode) await addPrintQueueJob(printer, fileName, options);
      else await command(printer.id, 'print', { fileName, ...options });
      printerDialog.close();
      if (queueMode) {
        renderPrintQueue();
        queueDialog.showModal();
      }
    } catch (error) {
      const el = printerDetail.querySelector('#detailError');
      if (el) { el.textContent = error.message; el.classList.remove('hidden'); }
    }
  };
  refreshAssessment();
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function selectedMaterialPreflightText() {
  const u1s = selectedPrinters().filter((printer) => printer.adapterType === 'snapmaker-u1' && printer.capabilities?.materialStatus);
  if (!u1s.length) return '';
  const rows = u1s.map((printer) => {
    const tools = printer.status?.tools || [];
    const known = tools.filter((tool) => tool.filament?.present !== null);
    const loaded = known.filter((tool) => tool.filament?.present === true).length;
    return `${printer.name}: ${loaded}/${known.length || tools.length || 4} toolheads report filament`;
  });
  return `

U1 material preflight:
${rows.join('\n')}
This is advisory; the selected file may use only some toolheads.`;
}

function applyLicenseReadOnly(printer) {
  if (!printerDetail || printer?.licenseActive !== false) return;
  const safeSelectors = [
    '[data-detail-close]',
    '[data-remove]',
    '[data-job="pause"]',
    '[data-job="resume"]',
    '[data-job="cancel"]',
    '[data-preheat-stop]',
    '[data-camera-open]'
  ];
  for (const button of printerDetail.querySelectorAll('button')) {
    if (safeSelectors.some((selector) => button.matches(selector))) continue;
    button.disabled = true;
    button.title = 'Inactive — no licence slot selected';
  }
}

function updateOpenPrinterTelemetry() {
  if (!currentPrinterId || !printerDialog.open) return;
  const printer = fleet.find((p) => p.id === currentPrinterId);
  if (!printer) return;
  const s = printer.status;
  const set = (selector, text) => {
    const el = printerDetail.querySelector(selector);
    if (el) el.textContent = text;
  };
  const displayState = stateName(printer);
  const rawState = rawStateName(printer);
  set('[data-detail-state]', displayState);
  set(
    '[data-detail-health]',
    printer.online
      ? `Last response ${formatLastSeen(printer.lastSeen)} · ${printer.latencyMs ?? '—'} ms${rawState.toLowerCase() !== displayState.toLowerCase() ? ` · Printer reports ${rawState}` : ''}`
      : `Offline · last seen ${formatLastSeen(printer.lastSeen)}`
  );
  set('[data-detail-file]', s?.fileName || 'No active job');
  set('[data-detail-progress]', `${Math.round(s?.progress || 0)}%`);
  set('[data-detail-layer]', s && s.totalLayers ? `${s.currentLayer} / ${s.totalLayers}` : '—');
  set('[data-detail-remaining]', formatDuration(s?.remainingSeconds));
  set('[data-nozzle-now]', s ? `${s.nozzle.actual.toFixed(0)} °C now` : '—');
  set('[data-bed-now]', s ? `${s.bed.actual.toFixed(0)} °C now` : '—');
  for (const tool of s?.tools || []) set(`[data-tool-now="${tool.index}"]`, `${Number(tool.actual || 0).toFixed(0)} °C now${tool.active ? ' · active' : ''}`);
  if (printer.capabilities?.materialStatus && Array.isArray(s?.tools)) {
    const materialSummary = printerDetail.querySelector('[data-material-summary]');
    if (materialSummary) {
      materialSummary.textContent = materialSummaryText(s.tools);
    }
    for (const tool of s.tools) {
      const filament = tool.filament || {};
      const row = printerDetail.querySelector(`[data-material-tool="${tool.index}"]`);
      if (!row) continue;
      set(`[data-material-name="${tool.index}"]`, filamentMaterialName(filament));
      set(`[data-material-presence="${tool.index}"]`, filamentPresenceText(filament));
      set(`[data-tool-nozzle="${tool.index}"]`, `${nozzleDiameterText(tool.nozzleDiameter)}${tool.nozzleVolumeType ? ` · ${tool.nozzleVolumeType}` : ''}`);
      set(`[data-tool-offset="${tool.index}"]`, toolOffsetText(tool.offset));
      set(`[data-material-meta="${tool.index}"]`, filamentMetaText(filament));
      const rgbText = filamentRgbText(filament.color);
      set(`[data-material-rgb="${tool.index}"]`, rgbText || '');
      const rgbLine = row.querySelector(`[data-material-rgb="${tool.index}"]`);
      rgbLine?.classList.toggle('hidden', !rgbText);
      const u1ConfigState = u1FilamentConfigEditState(printer, tool);
      const u1TypeInput = row.querySelector(`[data-u1-filament-type-input="${tool.index}"]`);
      const u1ColorInput = row.querySelector(`[data-u1-filament-color-input="${tool.index}"]`);
      const u1ConfigSave = row.querySelector(`[data-u1-filament-config-save="${tool.index}"]`);
      const u1ConfigHelp = row.querySelector(`[data-u1-filament-config-help="${tool.index}"]`);
      if (u1TypeInput) {
        const reportedMaterial = String(filament.material || '').trim().toUpperCase();
        if (document.activeElement !== u1TypeInput) u1TypeInput.value = SNAPMAKER_U1_FILAMENT_TYPES.includes(reportedMaterial) ? reportedMaterial : '';
        u1TypeInput.disabled = !u1ConfigState.enabled;
      }
      if (u1ColorInput) {
        if (document.activeElement !== u1ColorInput) u1ColorInput.value = normalizeColor(filament.color) || '#FFFFFF';
        u1ColorInput.disabled = !u1ConfigState.enabled;
      }
      if (u1ConfigSave) u1ConfigSave.disabled = !u1ConfigState.enabled;
      if (u1ConfigHelp) u1ConfigHelp.textContent = u1ConfigState.message;
      row.classList.toggle('filament-missing', filament.present === false);
      row.classList.toggle('filament-loaded', filament.present === true);
      const swatch = row.querySelector('[data-material-swatch]');
      if (swatch) {
        const color = materialSwatchColor(filament);
        swatch.style.background = color || '';
        swatch.classList.toggle('unknown', !color);
        swatch.title = color || 'Colour unknown';
      }
    }
    for (const source of s.materialSources || []) {
      const row = printerDetail.querySelector(`[data-ams-source="${source.protocolIndex}"]`);
      if (!row) continue;
      const color = normalizeColor(source.color);
      const active = row.querySelector('[data-ams-active]');
      const state = row.querySelector('[data-ams-state]');
      const swatch = row.querySelector('[data-ams-swatch]');
      if (active) active.textContent = source.active ? 'Active' : '';
      if (state) state.textContent = source.present === false ? 'Empty' : `${source.material || 'Unknown material'}${color ? ` · ${color}` : ''}`;
      if (swatch) {
        swatch.classList.toggle('unknown', !color);
        swatch.style.background = color || '';
      }
      row.classList.toggle('active', source.active === true);
      row.classList.toggle('empty', source.present === false);
    }
  }
  if (s?.chamber?.actual != null && Number.isFinite(Number(s.chamber.actual))) set('[data-chamber-now]', `${Number(s.chamber.actual).toFixed(1)} °C`);
  if (s?.chamberFan != null) set('[data-chamber-fan-now]', `${Math.round(Number(s.chamberFan) || 0)}% now`);
  if (s?.filtration) {
    set('[data-filtration-now]', s.filtration.available === false
      ? 'Purifier hardware not detected'
      : `Internal ${Math.round(Number(s.filtration.internal) || 0)}% · Exhaust ${Math.round(Number(s.filtration.external) || 0)}%${s.filtration.internalRpm != null ? ` · ${Math.round(Number(s.filtration.internalRpm))} RPM` : ''}`);
    set('[data-internal-filter-now]', `${Math.round(Number(s.filtration.internal) || 0)}% now`);
    set('[data-external-filter-now]', `${Math.round(Number(s.filtration.external) || 0)}% now`);
    printerDetail.querySelectorAll('[data-filter], [data-set-filtration]').forEach((button) => {
      button.disabled = !printer.capabilities?.filtration || s.filtration.available === false;
    });
    for (const input of printerDetail.querySelectorAll('#internalFilterInput, #externalFilterInput')) {
      input.disabled = !printer.capabilities?.filtration || s.filtration.available === false;
    }
  }
  if (printer.capabilities?.toolheadOffsetCalibration) {
    const calibration = s?.toolOffsetCalibration || {};
    set('[data-tool-calibration-state]', toolCalibrationStateText(calibration));
    for (const tool of calibration.tools || []) {
      set(`[data-calibration-result="${tool.index}"]`, calibrationResultText(tool.result));
      set(`[data-calibration-clean="${tool.index}"]`, calibrationCleanText(tool, calibration));
    }
    const busyPrinting = s && String(s.status || '').toLowerCase() !== 'idle';
    const activeClean = calibrationCleaningToolIndex(calibration);
    const calibrationState = String(calibration.state || 'idle').trim().toLowerCase();
    const calibrationStarted = calibrationState !== '' && calibrationState !== 'idle';
    const calibrationTools = Array.isArray(calibration.tools) ? calibration.tools : [];
    const allCleaned = calibrationTools.length >= 4 && calibrationTools.every((tool) => tool.nozzleClean === true);
    const allProbed = calibrationTools.length >= 4 && calibrationTools.every((tool) => Array.isArray(tool.result) && tool.result.length >= 3);
    const actionInFlight = toolOffsetActionLocks.get(printer.id) || null;
    printerDetail.querySelectorAll('[data-tool-offset-action]').forEach((button) => {
      const action = button.dataset.toolOffsetAction;
      let stageDisabled = false;
      if (action === 'start') stageDisabled = calibrationStarted;
      else if (action === 'advance-cleaning') stageDisabled = Number(button.dataset.toolIndex) !== activeClean;
      else if (action === 'check-plate') stageDisabled = !calibrationStarted || !allCleaned || activeClean !== null || calibration.bedPlateCheck === true;
      else if (action === 'save') stageDisabled = !calibrationStarted || !allProbed;
      else if (action === 'exit') stageDisabled = !calibrationStarted;
      // While any stock U1 calibration command is still running, lock the whole
      // workflow. This necessarily disables the active step and every preceding
      // step, while also preventing a later step from overlapping it.
      button.disabled = !printer.online || busyPrinting || stageDisabled || Boolean(actionInFlight);
    });
  }
  set('[data-camera-health]', printer.cameraHealth?.state || 'idle');
  const preheat = printer.chamberPreheat;
  const preheatStatus = printerDetail.querySelector('[data-preheat-status]');
  const preheatStart = printerDetail.querySelector('[data-preheat-start]');
  const preheatStop = printerDetail.querySelector('[data-preheat-stop]');
  const preheatBed = printerDetail.querySelector('#preheatBedInput');
  const preheatDuration = printerDetail.querySelector('#preheatDurationInput');
  if (preheatStatus) {
    const chamberText = preheat?.active && s?.chamber?.actual != null && Number.isFinite(Number(s.chamber.actual))
      ? ` · chamber ${Number(s.chamber.actual).toFixed(1)} °C`
      : '';
    preheatStatus.textContent = preheat?.active
      ? `Active · bed ${Number(preheat.bedTemperature).toFixed(0)} °C${chamberText} · ${formatCountdown(preheatRemainingSeconds(preheat))} remaining · ${preheat.reassertions || 0} reassertion${Number(preheat.reassertions || 0) === 1 ? '' : 's'}`
      : 'Not active';
    preheatStatus.classList.toggle('active', Boolean(preheat?.active));
  }
  if (preheatStart) preheatStart.disabled = !printer.capabilities?.chamberPreheat || !printer.online || Boolean(preheat?.active);
  if (preheatStop) preheatStop.disabled = !preheat?.active;
  if (preheatBed) preheatBed.disabled = !printer.capabilities?.chamberPreheat || Boolean(preheat?.active);
  if (preheatDuration) preheatDuration.disabled = !printer.capabilities?.chamberPreheat || Boolean(preheat?.active);
  const bar = printerDetail.querySelector('[data-detail-progress-bar]');
  if (bar) bar.style.width = `${Math.round(s?.progress || 0)}%`;
  const err = printerDetail.querySelector('#detailConnectionError');
  if (err) {
    err.textContent = printer.online ? '' : (printer.error || 'Printer is offline');
    err.classList.toggle('hidden', printer.online);
  }
  applyLicenseReadOnly(printer);
}

async function openPrinter(id) {
  const printer = fleet.find((p) => p.id === id);
  if (!printer) return;
  currentPrinterId = id;
  const capabilities = printer.capabilities || {};
  const limits = printer.limits || {};
  const maxNozzleC = Number(limits.nozzleTemperature?.max ?? 265);
  const maxBedC = Number(limits.bedTemperature?.max ?? 110);
  const preheatMinBedC = Number(limits.chamberPreheatBedTemperature?.min ?? 30);
  const preheatMaxBedC = Number(limits.chamberPreheatBedTemperature?.max ?? maxBedC);
  const preheatMaxMinutes = Number(limits.chamberPreheatMinutes?.max ?? 120);
  const disabled = (supported) => supported ? '' : ' disabled';
  let fileResult = { files: [], complete: true, source: 'tcp-m661', warning: null };
  let fileLoadError = null;
  if (printer.online && capabilities.localFiles) {
    try {
      fileResult = await api(`/api/printers/${id}/files`);
      fileResult.files = [...(fileResult.files || [])];
    } catch (error) {
      fileLoadError = error.message;
    }
  }
  const files = fileResult.files || [];
  const fileListMarkup = files.length
    ? files.map((file) => `<div class="file" data-file-entry><span class="file-name">${escapeHtml(file)}</span><div class="file-actions"><button class="secondary" data-queue-file="${escapeHtml(file)}">Queue</button><button class="secondary" data-print-file="${escapeHtml(file)}">Print</button></div></div>`).join('')
    : `<div class="subtle">${!capabilities.localFiles ? 'File browsing is not supported by this printer.' : printer.online ? (fileLoadError ? `Could not load files: ${escapeHtml(fileLoadError)}` : 'No printable files returned by printer.') : 'Files unavailable while printer is offline.'}</div>`;
  const fileWarningMarkup = fileResult.warning ? `<div class="file-warning">${escapeHtml(fileResult.warning)}</div>` : '';
  const orderLabel = fileResult.ordering === 'last-printed-first' ? 'recent first' : '';
  const fileSourceLabel = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} · ${fileResult.complete ? 'full storage' : 'recent only'}${orderLabel ? ` · ${orderLabel}` : ''}` : '';
  const uploadExtensions = Array.isArray(printer.uploadExtensions) && printer.uploadExtensions.length
    ? printer.uploadExtensions.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : ['.gcode', '.gx', '.3mf'];
  const uploadAccept = uploadExtensions.join(',');
  const fileUploadMarkup = capabilities.fileUpload && capabilities.localFiles
    ? `<div class="printer-file-upload"><input class="hidden" type="file" data-printer-file-upload-input accept="${escapeHtml(uploadAccept)}"><button type="button" class="secondary" data-printer-file-upload${printer.online ? '' : ' disabled'}>Upload file</button><span class="subtle" data-printer-file-upload-status>${printer.online ? `Supported: ${escapeHtml(uploadExtensions.join(', '))}` : 'Upload unavailable while printer is offline.'}</span></div>`
    : '';
  const s = printer.status;
  const toolTemperatureMarkup = capabilities.toolTemperatures && Array.isArray(s?.tools) && s.tools.length
    ? s.tools.map((tool) => `<div class="control-row tool-temperature-row"><label>${escapeHtml(tool.name || `T${tool.index}`)} target<input data-tool-temp-input="${tool.index}" type="number" min="0" max="${maxNozzleC}" value="${Number(tool.target || 0)}" /></label><span class="subtle" data-tool-now="${tool.index}">${Number(tool.actual || 0).toFixed(0)} °C now${tool.active ? ' · active' : ''}</span><button class="secondary" data-set-tool-temp="${tool.index}">Set</button></div>`).join('')
    : `<div class="control-row"><label>Nozzle target<input id="nozzleInput" type="number" min="0" max="${maxNozzleC}" value="${s?.nozzle.target || 0}"${disabled(capabilities.nozzleTemperature)} /></label><span class="subtle" data-nozzle-now>${s?.nozzle.actual?.toFixed(0) || '—'} °C now</span><button class="secondary" data-set-temp="nozzle"${disabled(capabilities.nozzleTemperature)}>Set</button></div>`;
  const chamberTemperatureMarkup = capabilities.chamberTemperatureSensor && s?.chamber?.actual != null && Number.isFinite(Number(s.chamber.actual))
    ? `<div class="sensor-readout"><span>Chamber / cavity</span><b data-chamber-now>${Number(s.chamber.actual).toFixed(1)} °C</b></div>`
    : '';
  const materialStatusMarkup = capabilities.materialStatus ? (() => {
    const tools = Array.isArray(s?.tools) ? s.tools : [];
    if (!tools.length) return `<div class="panel material-panel"><h3>Toolhead status</h3><div class="subtle">Material status is unavailable while the printer is offline.</div>${flashForgeMaterialDesignationMarkup(printer)}${flashForgeNozzleDesignationMarkup(printer)}</div>`;
    const materialHelp = printer.adapterType === 'flashforge-ad5m'
      ? "Filament type uses the controller's manual designation when set, otherwise the value reported by the FlashForge 5M local /detail API. Installed nozzle size uses the controller nozzle designation when set because the 5M API does not reliably expose it. The 5M API also does not expose U1-style filament colour/RFID metadata or a reliable live filament-presence value."
      : printer.adapterType === 'bambu-lab'
        ? 'Material and colour come from the active external-spool or AMS tray metadata reported by the Bambu LAN interface. Bambu support is experimental until checked against physical P1P, P1S and X1C hardware.'
        : 'Filament presence comes from each U1 motion sensor. Third-party filament type and colour can be written to the idle printer and are verified by reading the effective per-tool configuration back. Official Snapmaker RFID filament remains locked. Nozzle size and XYZ offset come directly from each physical U1 extruder.';
    const bambuSources = printer.adapterType === 'bambu-lab' && Array.isArray(s?.materialSources)
      ? `<div class="ams-source-grid">${s.materialSources.map((source) => {
        const color = normalizeColor(source.color);
        const state = source.present === false ? 'Empty' : `${source.material || 'Unknown material'}${color ? ` · ${color}` : ''}`;
        return `<div class="ams-source${source.active ? ' active' : ''}${source.present === false ? ' empty' : ''}" data-ams-source="${source.protocolIndex}"><div><strong>${escapeHtml(source.label)}</strong><span data-ams-active>${source.active ? 'Active' : ''}</span></div><i class="material-swatch${color ? '' : ' unknown'}" data-ams-swatch${color ? ` style="background:${escapeHtml(color)}"` : ''}></i><small data-ams-state>${escapeHtml(state)}</small></div>`;
      }).join('')}</div>`
      : '';
    return `<div class="panel material-panel">
      <h3>Toolhead status</h3>
      <div class="material-summary" data-material-summary>${escapeHtml(materialSummaryText(tools))}</div>
      <div class="material-grid${tools.length === 1 ? ' single-tool' : ''}">${tools.map((tool) => {
        const filament = tool.filament || {};
        const color = materialSwatchColor(filament);
        const stateClass = filament.present === true ? ' filament-loaded' : filament.present === false ? ' filament-missing' : '';
        return `<div class="material-tool${stateClass}" data-material-tool="${tool.index}">
          <div class="material-tool-head"><strong>T${tool.index}${tool.active ? ' · active' : ''}</strong><span class="material-swatch${color ? '' : ' unknown'}" data-material-swatch style="${color ? `background:${escapeHtml(color)}` : ''}" title="${escapeHtml(color || 'Colour unknown')}"></span></div>
          <b data-material-name="${tool.index}">${escapeHtml(filamentMaterialName(filament))}</b>
          <span data-material-presence="${tool.index}">${escapeHtml(filamentPresenceText(filament))}</span>
          ${capabilities.toolheadNozzleStatus ? `<small data-tool-nozzle="${tool.index}">${escapeHtml(`${nozzleDiameterText(tool.nozzleDiameter)}${tool.nozzleVolumeType ? ` · ${tool.nozzleVolumeType}` : ''}`)}</small>` : ''}
          ${capabilities.toolheadNozzleStatus ? `<small data-tool-offset="${tool.index}">${escapeHtml(toolOffsetText(tool.offset))}</small>` : ''}
          <small data-material-meta="${tool.index}">${escapeHtml(filamentMetaText(filament))}</small>
          ${['snapmaker-u1','flashforge-ad5m','bambu-lab'].includes(printer.adapterType) ? `<small class="material-rgb${filamentRgbText(filament.color) ? '' : ' hidden'}" data-material-rgb="${tool.index}">${escapeHtml(filamentRgbText(filament.color) || '')}</small>` : ''}
          ${printer.adapterType === 'snapmaker-u1' ? u1FilamentConfigControlMarkup(printer, tool) : ''}
        </div>`;
      }).join('')}</div>
      ${bambuSources}
      ${printer.adapterType === 'flashforge-ad5m' ? flashForgeMaterialDesignationMarkup(printer, tools[0]?.filament || {}) : ''}
      ${printer.adapterType === 'flashforge-ad5m' ? flashForgeNozzleDesignationMarkup(printer, tools[0] || {}) : ''}
      <div class="field-help material-help">${escapeHtml(materialHelp)}</div>
    </div>`;
  })() : '';
  const toolOffsetCalibrationMarkup = capabilities.toolheadOffsetCalibration ? (() => {
    const calibration = s?.toolOffsetCalibration || {};
    const calibrationTools = Array.isArray(calibration.tools) && calibration.tools.length
      ? calibration.tools
      : [0,1,2,3].map((index) => ({ index, result:null }));
    return `<div id="toolOffsetCalibrationPanel" class="tool-offset-calibration hidden">
      <div class="tool-offset-calibration-head"><strong>U1 XYZ toolhead offset calibration</strong><span data-tool-calibration-state>${escapeHtml(toolCalibrationStateText(calibration))}</span></div>
      <div class="field-help">Follows the stock U1 touchscreen sequence. Start once with the build plate fitted: the printer enters calibration mode, preheats/homes, then prepares T0 and moves it to the front. After you manually clean the nozzle, confirm that clean and the controller will cool it and automatically prepare the next toolhead. The sequence walks T0 → T1 → T2 → T3 without requiring you to select each head yourself.</div>
      <div class="calibration-actions">
        <button type="button" class="secondary" data-tool-offset-action="start">1 · Start cleaning sequence</button>
      </div>
      <div class="calibration-stage-title">2 · Clean all four toolheads</div>
      <div class="calibration-clean-grid">${calibrationTools.map((tool) => `<div class="calibration-clean-tool"><div><strong>T${tool.index}</strong><small data-calibration-clean="${tool.index}">${escapeHtml(calibrationCleanText(tool, calibration))}</small></div><div class="calibration-tool-actions"><button type="button" class="secondary" data-tool-offset-action="advance-cleaning" data-tool-index="${tool.index}" aria-label="T${tool.index} cleaned${tool.index < 3 ? `, continue to T${tool.index + 1}` : ', complete cleaning stage'}" title="${tool.index < 3 ? `T${tool.index} cleaned — continue to T${tool.index + 1}` : 'T3 cleaned — complete cleaning stage'}"${calibrationCleaningToolIndex(calibration) === tool.index ? '' : ' disabled'}>Cleaned</button></div></div>`).join('')}</div>
      <div class="field-help calibration-hot-warning">The selected nozzle may be hot. Wait until printer motion stops and use the same cleaning method/tools you normally use from the U1 touchscreen; do not touch the nozzle directly.</div>
      <div class="calibration-actions">
        <button type="button" class="secondary" data-tool-offset-action="check-plate">3 · Verify plate & start probes</button>
      </div>
      <div class="calibration-stage-title">4 · Automatic XYZ probing</div>
      <div class="field-help">After the build plate removal check succeeds, the U1 touchscreen/firmware continues through the stock T0 → T1 → T2 → T3 XYZ offset measurements automatically. Do not start a second probe from the controller; live results appear below as each toolhead completes.</div>
      <div class="calibration-tool-grid">${calibrationTools.map((tool) => `<div class="calibration-tool"><div><strong>T${tool.index}</strong><small data-calibration-result="${tool.index}">${escapeHtml(calibrationResultText(tool.result))}</small></div></div>`).join('')}</div>
      <div class="calibration-actions">
        <button type="button" class="secondary" data-tool-offset-action="save">Save results</button>
        <button type="button" class="danger" data-tool-offset-action="exit">Finish / exit</button>
      </div>
      <div class="field-help">The U1 automatically saves after all four successful probes; Save results is provided for recovery/retry workflows. If the printer rejects a step, correct the condition shown by the U1 and retry that step rather than forcing motion.</div>
    </div>`;
  })() : '';
  printerDetail.innerHTML = `<div class="detail-shell">
    <div class="dialog-head">
      <div>
        <div class="eyebrow">PRINTER</div>
        <h2 data-detail-name>${escapeHtml(printer.name)}</h2>
        <div class="subtle"><span>${escapeHtml(printer.host)}</span> · <span data-detail-state>${escapeHtml(stateName(printer))}</span></div>
        <div class="detail-health" data-detail-health></div>
      </div>
      <button class="icon" data-detail-close>×</button>
    </div>
    <div id="detailConnectionError" class="error hidden"></div>
    ${printer.licenseActive === false ? '<div class="license-detail-warning">This printer is inactive because it does not have a selected licence slot. Live monitoring and safety controls remain available, but new jobs and normal controller commands are disabled.</div>' : ''}
    ${printer.adapterType === 'bambu-lab' ? `<div class="file-warning">Experimental Bambu ${escapeHtml(printer.model || '')} support: validate behavior carefully before relying on unattended printing.${printer.model === 'X1C' ? ' X1C RTSPS/H.264 camera decoding is not yet supported.' : ''}</div>` : ''}
    <div class="detail-grid">
      <div class="detail-column detail-column-left">
        ${detailCameraMarkup(printer)}
        <div class="panel" style="margin-top:12px">
          <h3>Current job</h3>
          <div class="job"><span class="job-name" data-detail-file>${escapeHtml(s?.fileName || 'No active job')}</span><b data-detail-progress>${Math.round(s?.progress || 0)}%</b></div>
          <div class="progress"><span data-detail-progress-bar style="width:${Math.round(s?.progress || 0)}%"></span></div>
          <div class="job-meta"><span>Layer <b data-detail-layer>—</b></span><span>Remaining <b data-detail-remaining>—</b></span></div>
          <div class="mini-actions">
            <button class="secondary" data-job="pause"${disabled(capabilities.jobControl)}>Pause</button>
            <button class="secondary" data-job="resume"${disabled(capabilities.jobControl)}>Resume</button>
            <button class="danger" data-job="cancel"${disabled(capabilities.jobControl)}>Cancel</button>
          </div>
        </div>
        <div class="panel">
          <div class="file-heading"><h3>Files on printer</h3><span class="subtle">${escapeHtml(fileSourceLabel)}</span></div>
          ${fileUploadMarkup}
          ${capabilities.levelBeforePrint ? '<label class="checkbox-label"><input type="checkbox" id="levelBeforePrint" checked /> Level bed before print</label>' : '<div class="field-help">This printer uses the start G-code embedded in the uploaded file; controller-side pre-print levelling is not available.</div>'}
          ${capabilities.flowCalibrationBeforePrint ? '<label class="checkbox-label"><input type="checkbox" id="flowCalibrationBeforePrint" /> Flow calibration before print</label>' : ''}
          ${files.length > 10 ? `<input id="fileSearch" class="file-search" type="search" placeholder="Filter ${files.length} files…" autocomplete="off" />` : ''}
          ${fileWarningMarkup}
          <div class="file-list" id="printerFileList">${fileListMarkup}<div id="fileNoMatches" class="subtle hidden">No matching files.</div></div>
          ${capabilities.printToolMapping || capabilities.materialSlotMapping ? '<div id="printSetupPanel" class="print-setup-panel hidden"></div>' : ''}
        </div>
      </div>
      <div class="detail-column detail-column-right">
        <div class="panel">
          <h3>Temperature</h3>
          ${toolTemperatureMarkup}
          <div class="control-row"><label>Bed target<input id="bedInput" type="number" min="0" max="${maxBedC}" value="${s?.bed.target || 0}"${disabled(capabilities.bedTemperature)} /></label><span class="subtle" data-bed-now>${s?.bed.actual?.toFixed(0) || '—'} °C now</span><button class="secondary" data-set-temp="bed"${disabled(capabilities.bedTemperature)}>Set</button></div>
          ${chamberTemperatureMarkup}
        </div>
        ${materialStatusMarkup}
        <div class="panel chamber-preheat-panel">
          <h3>Chamber preheat</h3>
          <p class="subtle">${printer.adapterType === 'snapmaker-u1'
            ? 'Uses the build plate as the heat source and the U1 stock PREHEAT_CHAMBER mode for circulation: 60% inner purifier fan, exhaust off. The controller keeps the session bounded and holds the bed setpoint.'
            : 'Uses the build plate as the chamber heat source. The controller holds the normal bed setpoint for a bounded period and reasserts it if idle firmware clears it.'}</p>
          <div class="preheat-fields">
            <label>Bed setpoint °C<input id="preheatBedInput" type="number" min="${preheatMinBedC}" max="${preheatMaxBedC}" value="${Math.max(preheatMinBedC, Math.min(preheatMaxBedC, Number(s?.bed.target || 90) || 90))}"${disabled(capabilities.chamberPreheat)} /></label>
            <label>Duration minutes<input id="preheatDurationInput" type="number" min="1" max="${preheatMaxMinutes}" value="45"${disabled(capabilities.chamberPreheat)} /></label>
          </div>
          <div class="preheat-status" data-preheat-status>Not active</div>
          <div class="mini-actions">
            <button class="primary" data-preheat-start${disabled(capabilities.chamberPreheat)}>Start chamber preheat</button>
            <button class="danger" data-preheat-stop disabled>Stop preheat</button>
          </div>
          <div class="field-help">Maximum bed setpoint ${preheatMaxBedC} °C · maximum session ${preheatMaxMinutes} minutes · sessions never resume after controller restart.</div>
        </div>
        <div class="panel fans-panel">
          <h3>Fans</h3>
          <div class="control-row"><label>Part cooling %<input id="coolingFanInput" type="number" min="0" max="100" value="${s?.coolingFan || 0}"${disabled(capabilities.coolingFan)} /></label><span></span><button class="secondary" data-set-fan="coolingFan"${disabled(capabilities.coolingFan)}>Set</button></div>
          <div class="control-row"><label>Chamber fan %<input id="chamberFanInput" type="number" min="0" max="100" value="${s?.chamberFan || 0}"${disabled(capabilities.chamberFan)} /></label><span class="subtle" data-chamber-fan-now>${Math.round(Number(s?.chamberFan) || 0)}% now</span><button class="secondary" data-set-fan="chamberFan"${disabled(capabilities.chamberFan)}>Set</button></div>
          ${capabilities.filtration && limits.filtrationSpeed ? `
            <div class="control-row"><label>Internal filter %<input id="internalFilterInput" type="number" min="${Number(limits.filtrationSpeed.min ?? 0)}" max="${Number(limits.filtrationSpeed.max ?? 100)}" value="${Math.round(Number(s?.filtration?.internal) || 0)}"${disabled(s?.filtration?.available !== false)} /></label><span class="subtle" data-internal-filter-now>${Math.round(Number(s?.filtration?.internal) || 0)}% now</span><button class="secondary" data-set-filtration="internal"${disabled(s?.filtration?.available !== false)}>Set</button></div>
            <div class="control-row"><label>Exhaust filter %<input id="externalFilterInput" type="number" min="${Number(limits.filtrationSpeed.min ?? 0)}" max="${Number(limits.filtrationSpeed.max ?? 100)}" value="${Math.round(Number(s?.filtration?.external) || 0)}"${disabled(s?.filtration?.available !== false)} /></label><span class="subtle" data-external-filter-now>${Math.round(Number(s?.filtration?.external) || 0)}% now</span><button class="secondary" data-set-filtration="external"${disabled(s?.filtration?.available !== false)}>Set</button></div>
          ` : `<div class="mini-actions"><button class="secondary" data-filter="internal:on"${disabled(capabilities.filtration && s?.filtration?.available !== false)}>Internal filter on</button><button class="secondary" data-filter="internal:off"${disabled(capabilities.filtration && s?.filtration?.available !== false)}>Internal off</button><button class="secondary" data-filter="external:on"${disabled(capabilities.filtration && s?.filtration?.available !== false)}>External filter on</button><button class="secondary" data-filter="external:off"${disabled(capabilities.filtration && s?.filtration?.available !== false)}>External off</button></div>`}
          ${capabilities.filtration ? `<div class="field-help" data-filtration-now>${s?.filtration?.available === false ? 'Purifier hardware not detected' : `Internal ${Math.round(Number(s?.filtration?.internal) || 0)}% · Exhaust ${Math.round(Number(s?.filtration?.external) || 0)}%${s?.filtration?.internalRpm != null ? ` · ${Math.round(Number(s.filtration.internalRpm))} RPM` : ''}`}</div>` : ''}
        </div>
        <div class="panel maintenance-panel">
          <h3>Maintenance</h3>
          <div class="mini-actions"><button class="secondary" data-level${disabled(capabilities.bedLeveling)}>Bed level</button><button class="secondary" data-camera-open${disabled(capabilities.camera)}>Restart camera</button>${capabilities.toolheadOffsetCalibration ? '<button class="secondary" data-tool-offset-open>XYZ tool offsets</button>' : ''}</div>
          ${printer.adapterType === 'snapmaker-u1' && capabilities.bedLeveling ? '<div class="field-help">U1 bed level runs the stock heated AUTO_BED_MESH_CALIBRATE routine; the printer heats, soaks, probes the bed, and updates its mesh.</div>' : ''}
          ${toolOffsetCalibrationMarkup}
        </div>
        <div class="panel diagnostics-panel">
          <h3>Diagnostics</h3>
          <div><span>Manufacturer</span><b>${escapeHtml(printer.manufacturer || 'Unknown')}</b></div>
          <div><span>Model</span><b>${escapeHtml(printer.model || 'Unknown')}</b></div>
          <div><span>Adapter</span><b>${escapeHtml(printer.adapterType || 'unknown')}</b></div>
          <div><span>Serial</span><b>${escapeHtml(printer.serialNumber || '—')}</b></div>
          <div><span>Firmware</span><b>${escapeHtml(s?.firmwareVersion || '—')}</b></div>
          <div><span>Printer-reported name</span><b>${escapeHtml(s?.printerName || '—')}</b></div>
          <div><span>Last seen</span><b>${escapeHtml(formatLastSeen(printer.lastSeen))}</b></div>
          <div><span>Failures</span><b>${printer.consecutiveFailures || 0}</b></div>
          <div><span>Camera</span><b data-camera-health>${escapeHtml(printer.cameraHealth?.state || 'idle')}</b></div>
        </div>
        <div class="panel printer-management-panel">
          <h3>Printer management</h3>
          <label>Controller name<input data-printer-name type="text" maxlength="80" value="${escapeHtml(printer.name)}" autocomplete="off" /></label>
          <div class="mini-actions"><button class="secondary" data-rename>Rename printer</button><button class="danger" data-remove>Remove printer</button></div>
          <div class="field-help" data-rename-status>This changes only the name shown by Print Farm Controller; the printer's own name is not modified.</div>
        </div>
      </div>
    </div>
    <div id="detailError" class="error hidden" style="margin-top:12px"></div>
  </div>`;
  const leftDetailColumn = printerDetail.querySelector('.detail-column-left');
  if (leftDetailColumn) {
    for (const selector of ['.chamber-preheat-panel', '.fans-panel']) {
      const panel = printerDetail.querySelector(selector);
      if (panel) leftDetailColumn.append(panel);
    }
  }
  if (!printerDialog.open) printerDialog.showModal();
  updateOpenPrinterTelemetry();

  const printerUploadButton = printerDetail.querySelector('[data-printer-file-upload]');
  const printerUploadInput = printerDetail.querySelector('[data-printer-file-upload-input]');
  const printerUploadStatus = printerDetail.querySelector('[data-printer-file-upload-status]');
  if (printerUploadButton && printerUploadInput) {
    printerUploadButton.onclick = () => printerUploadInput.click();
    printerUploadInput.onchange = async () => {
      const file = printerUploadInput.files?.[0];
      if (!file) return;
      const extension = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
      if (uploadExtensions.length && !uploadExtensions.includes(extension)) {
        if (printerUploadStatus) printerUploadStatus.textContent = `Unsupported file type. Use ${uploadExtensions.join(', ')}`;
        printerUploadInput.value = '';
        return;
      }
      if (file.size > 512 * 1024 * 1024) {
        if (printerUploadStatus) printerUploadStatus.textContent = 'File exceeds the 512 MB upload limit.';
        printerUploadInput.value = '';
        return;
      }
      printerUploadButton.disabled = true;
      if (printerUploadStatus) printerUploadStatus.textContent = `Uploading ${file.name}…`;
      try {
        const response = await fetch(`/api/printers/${encodeURIComponent(id)}/files`, {
          method:'POST',
          headers:{ 'content-type':'application/octet-stream', 'x-file-name':encodeURIComponent(file.name) },
          body:file
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
        await openPrinter(id);
        const refreshedStatus = printerDetail.querySelector('[data-printer-file-upload-status]');
        if (refreshedStatus) refreshedStatus.textContent = `Uploaded and verified ${result.fileName || file.name}`;
      } catch (error) {
        if (printerUploadStatus) printerUploadStatus.textContent = error.message || 'Upload failed';
      } finally {
        printerUploadInput.value = '';
        if (printerUploadButton.isConnected) printerUploadButton.disabled = false;
      }
    };
  }

  const liveCamera = printerDetail.querySelector('img.detail-camera');
  liveCamera?.addEventListener('error', () => {
    if (!liveCamera.isConnected) return;
    const placeholder = document.createElement('div');
    placeholder.className = 'detail-camera camera-placeholder';
    placeholder.textContent = 'Camera stream unavailable — use Restart camera to retry';
    liveCamera.replaceWith(placeholder);
  }, { once: true });

  const showError = (error) => {
    const el = printerDetail.querySelector('#detailError');
    el.textContent = error.message;
    el.classList.remove('hidden');
  };

  const fileSearch = printerDetail.querySelector('#fileSearch');
  if (fileSearch) {
    fileSearch.addEventListener('input', () => {
      const query = fileSearch.value.trim().toLowerCase();
      let visible = 0;
      printerDetail.querySelectorAll('[data-file-entry]').forEach((row) => {
        const name = row.querySelector('.file-name')?.textContent?.toLowerCase() || '';
        const matches = !query || name.includes(query);
        row.classList.toggle('hidden', !matches);
        if (matches) visible++;
      });
      printerDetail.querySelector('#fileNoMatches')?.classList.toggle('hidden', visible !== 0);
    });
  }

  printerDetail.querySelector('[data-detail-close]').onclick = () => printerDialog.close();
  printerDetail.querySelectorAll('[data-job]').forEach((btn) => btn.onclick = () => command(id, 'job', { action: btn.dataset.job }).catch(showError));
  printerDetail.querySelectorAll('[data-queue-file]').forEach((btn) => btn.onclick = async () => {
    try {
      if (printer.capabilities?.printToolMapping || printer.capabilities?.materialSlotMapping) {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Reading…';
        try {
          const setup = await api(`/api/printers/${encodeURIComponent(id)}/print-setup?fileName=${encodeURIComponent(btn.dataset.queueFile)}`);
          if (printer.capabilities?.materialSlotMapping) renderBambuPrintSetup(printer, setup, btn.dataset.queueFile, 'queue');
          else renderU1PrintSetup(printer, setup, btn.dataset.queueFile, 'queue');
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
        return;
      }
      const leveling = printerDetail.querySelector('#levelBeforePrint')?.checked ?? false;
      const materialCheck = await flashForgeFileMaterialCheck(printer, btn.dataset.queueFile);
      const materialText = flashForgeFileMaterialText(materialCheck, { queue:true });
      if (!confirm(`Add ${btn.dataset.queueFile} to the queue for ${printer.name}?

Bed levelling: ${leveling ? 'yes' : 'no'}${materialText ? `

${materialText}` : ''}

The controller will start it automatically when this printer is idle and all safety checks pass.`)) return;
      await addPrintQueueJob(printer, btn.dataset.queueFile, { levelingBeforePrint:leveling });
      printerDialog.close();
      renderPrintQueue();
      queueDialog.showModal();
    } catch (error) { showError(error); }
  });
  printerDetail.querySelectorAll('[data-print-file]').forEach((btn) => btn.onclick = async () => {
    try {
      if (printer.capabilities?.printToolMapping || printer.capabilities?.materialSlotMapping) {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Reading…';
        try {
          const setup = await api(`/api/printers/${encodeURIComponent(id)}/print-setup?fileName=${encodeURIComponent(btn.dataset.printFile)}`);
          if (printer.capabilities?.materialSlotMapping) renderBambuPrintSetup(printer, setup, btn.dataset.printFile);
          else renderU1PrintSetup(printer, setup, btn.dataset.printFile);
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
        return;
      }
      const preflight = materialPreflightText(printer);
      const materialCheck = await flashForgeFileMaterialCheck(printer, btn.dataset.printFile);
      const flashForgePreflight = flashForgeFileMaterialText(materialCheck);
      if (!confirm(`Start ${btn.dataset.printFile} on ${printer.name}?${preflight ? `

${preflight}` : ''}${flashForgePreflight ? `

${flashForgePreflight}` : ''}`)) return;
      await command(id, 'print', {
        fileName: btn.dataset.printFile,
        levelingBeforePrint: printerDetail.querySelector('#levelBeforePrint')?.checked ?? false,
        allowMaterialMismatch: materialCheck?.mismatch === true
      });
      printerDialog.close();
    } catch (error) { showError(error); }
  });
  printerDetail.querySelectorAll('[data-u1-filament-config-save]').forEach((button) => button.onclick = async () => {
    const toolIndex = Number(button.dataset.u1FilamentConfigSave);
    const typeInput = printerDetail.querySelector(`[data-u1-filament-type-input="${toolIndex}"]`);
    const colorInput = printerDetail.querySelector(`[data-u1-filament-color-input="${toolIndex}"]`);
    const material = String(typeInput?.value || '').trim().toUpperCase();
    const color = normalizeColor(colorInput?.value);
    if (!material) { showError(new Error('Choose a filament type.')); return; }
    if (!color) { showError(new Error('Choose a valid filament colour.')); return; }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Setting…';
    try {
      const result = await api(`/api/printers/${id}/filament-config`, { method:'POST', body:JSON.stringify({ toolIndex, material, color }) });
      const tool = printer.status?.tools?.find((item) => Number(item.index) === toolIndex);
      if (tool?.filament) {
        tool.filament.material = result.material;
        tool.filament.materialVariant = result.subtype;
        tool.filament.vendor = result.vendor;
        tool.filament.color = result.color;
        tool.filament.materialSource = 'manual';
        tool.filament.manuallyAssigned = true;
        tool.filament.officialFilament = false;
        tool.filament.metadataAvailable = true;
      }
      updateOpenPrinterTelemetry();
    } catch (error) { showError(error); }
    finally { button.textContent = original; updateOpenPrinterTelemetry(); }
  });

  const materialDesignationSave = printerDetail.querySelector('[data-material-designation-save]');
  if (materialDesignationSave) materialDesignationSave.onclick = async () => {
    const input = printerDetail.querySelector('[data-material-designation-input]');
    const colorInput = printerDetail.querySelector('[data-material-color-input]');
    const material = String(input?.value || '').trim();
    const color = String(colorInput?.value || '').trim().toUpperCase();
    if (!material) { showError(new Error('Enter a material type to assign, or use Clear designation.')); return; }
    if (!/^#[0-9A-F]{6}$/.test(color)) { showError(new Error('Choose a filament colour.')); return; }
    const original = materialDesignationSave.textContent;
    materialDesignationSave.disabled = true;
    materialDesignationSave.textContent = 'Saving…';
    try {
      await api(`/api/printers/${id}/material-designation`, { method:'POST', body: JSON.stringify({ material, color }) });
      printer.materialDesignation = material;
      printer.materialColorDesignation = color;
      const filament = printer.status?.tools?.[0]?.filament;
      if (filament) {
        if (!filament.reportedMaterial && filament.materialSource === 'printer') filament.reportedMaterial = filament.material || null;
        if (!filament.reportedColor && filament.colorSource === 'printer') filament.reportedColor = filament.color || null;
        filament.material = material;
        filament.materialSource = 'manual';
        filament.color = color;
        filament.colorSource = 'manual';
        filament.manuallyAssigned = true;
        filament.metadataAvailable = true;
        updateOpenPrinterTelemetry();
      }
    } catch (error) { showError(error); }
    finally { materialDesignationSave.disabled = false; materialDesignationSave.textContent = original; }
  };
  const materialDesignationClear = printerDetail.querySelector('[data-material-designation-clear]');
  if (materialDesignationClear) materialDesignationClear.onclick = async () => {
    const original = materialDesignationClear.textContent;
    materialDesignationClear.disabled = true;
    materialDesignationClear.textContent = 'Clearing…';
    try {
      await api(`/api/printers/${id}/material-designation`, { method:'DELETE' });
      printer.materialDesignation = null;
      printer.materialColorDesignation = null;
      const filament = printer.status?.tools?.[0]?.filament;
      if (filament) {
        filament.material = filament.reportedMaterial || null;
        filament.materialSource = filament.reportedMaterial ? 'printer' : null;
        filament.color = filament.reportedColor || null;
        filament.colorSource = filament.reportedColor ? 'printer' : null;
        filament.manuallyAssigned = false;
        updateOpenPrinterTelemetry();
      }
      const input = printerDetail.querySelector('[data-material-designation-input]');
      if (input) input.value = '';
      const colorInput = printerDetail.querySelector('[data-material-color-input]');
      if (colorInput) colorInput.value = '#FFFFFF';
    } catch (error) { showError(error); }
    finally { materialDesignationClear.disabled = false; materialDesignationClear.textContent = original; }
  };

  const nozzleDesignationSave = printerDetail.querySelector('[data-nozzle-designation-save]');
  if (nozzleDesignationSave) nozzleDesignationSave.onclick = async () => {
    const input = printerDetail.querySelector('[data-nozzle-designation-input]');
    const nozzleDiameter = Number(input?.value);
    if (!Number.isFinite(nozzleDiameter) || nozzleDiameter < 0.1 || nozzleDiameter > 1.2) {
      showError(new Error('Enter a nozzle diameter between 0.1 and 1.2 mm, or use Clear designation.'));
      return;
    }
    const original = nozzleDesignationSave.textContent;
    nozzleDesignationSave.disabled = true;
    nozzleDesignationSave.textContent = 'Saving…';
    try {
      const result = await api(`/api/printers/${id}/nozzle-designation`, { method:'POST', body:JSON.stringify({ nozzleDiameter }) });
      printer.nozzleDiameterDesignation = result.nozzleDiameterDesignation;
      const tool = printer.status?.tools?.[0];
      if (tool) {
        if (!Number.isFinite(Number(tool.reportedNozzleDiameter)) && tool.nozzleDiameterSource === 'printer' && Number.isFinite(Number(tool.nozzleDiameter))) {
          tool.reportedNozzleDiameter = Number(tool.nozzleDiameter);
        }
        tool.nozzleDiameter = result.nozzleDiameterDesignation;
        tool.nozzleDiameterSource = 'manual';
        tool.nozzleManuallyAssigned = true;
        updateOpenPrinterTelemetry();
      }
    } catch (error) { showError(error); }
    finally { nozzleDesignationSave.disabled = false; nozzleDesignationSave.textContent = original; }
  };
  const nozzleDesignationClear = printerDetail.querySelector('[data-nozzle-designation-clear]');
  if (nozzleDesignationClear) nozzleDesignationClear.onclick = async () => {
    const original = nozzleDesignationClear.textContent;
    nozzleDesignationClear.disabled = true;
    nozzleDesignationClear.textContent = 'Clearing…';
    try {
      await api(`/api/printers/${id}/nozzle-designation`, { method:'DELETE' });
      printer.nozzleDiameterDesignation = null;
      const tool = printer.status?.tools?.[0];
      if (tool) {
        const reported = Number(tool.reportedNozzleDiameter);
        tool.nozzleDiameter = Number.isFinite(reported) && reported > 0 ? reported : null;
        tool.nozzleDiameterSource = tool.nozzleDiameter ? 'printer' : null;
        tool.nozzleManuallyAssigned = false;
        updateOpenPrinterTelemetry();
      }
      const input = printerDetail.querySelector('[data-nozzle-designation-input]');
      if (input) input.value = '';
    } catch (error) { showError(error); }
    finally { nozzleDesignationClear.disabled = false; nozzleDesignationClear.textContent = original; }
  };

  printerDetail.querySelectorAll('[data-set-temp]').forEach((btn) => btn.onclick = () => {
    const key = btn.dataset.setTemp;
    const input = printerDetail.querySelector(key === 'nozzle' ? '#nozzleInput' : '#bedInput');
    command(id, 'temperature', { [key]: Number(input.value) }).catch(showError);
  });
  printerDetail.querySelectorAll('[data-set-tool-temp]').forEach((btn) => btn.onclick = () => {
    const toolIndex = Number(btn.dataset.setToolTemp);
    const input = printerDetail.querySelector(`[data-tool-temp-input="${toolIndex}"]`);
    command(id, 'temperature', { toolIndex, nozzle: Number(input.value) }).catch(showError);
  });
  const preheatStartButton = printerDetail.querySelector('[data-preheat-start]');
  if (preheatStartButton) preheatStartButton.onclick = async () => {
    const bedTemperature = Number(printerDetail.querySelector('#preheatBedInput').value);
    const durationMinutes = Number(printerDetail.querySelector('#preheatDurationInput').value);
    if (!confirm(`Preheat ${printer.name} using a ${bedTemperature} °C bed setpoint for ${durationMinutes} minutes?`)) return;
    try {
      await api(`/api/printers/${id}/chamber-preheat`, { method:'POST', body: JSON.stringify({ bedTemperature, durationMinutes }) });
    } catch (error) { showError(error); }
  };
  const preheatStopButton = printerDetail.querySelector('[data-preheat-stop]');
  if (preheatStopButton) preheatStopButton.onclick = async () => {
    try {
      const result = await api(`/api/printers/${id}/chamber-preheat`, { method:'DELETE' });
      if (result.warning) showError(new Error(result.warning));
    } catch (error) { showError(error); }
  };
  printerDetail.querySelectorAll('[data-set-fan]').forEach((btn) => btn.onclick = () => {
    const key = btn.dataset.setFan;
    const input = printerDetail.querySelector(key === 'coolingFan' ? '#coolingFanInput' : '#chamberFanInput');
    command(id, 'fans', { [key]: Number(input.value) }).catch(showError);
  });
  printerDetail.querySelectorAll('[data-filter]').forEach((btn) => btn.onclick = () => {
    const [key, value] = btn.dataset.filter.split(':');
    command(id, 'filtration', { [key]: value === 'on' }).catch(showError);
  });
  printerDetail.querySelectorAll('[data-set-filtration]').forEach((btn) => btn.onclick = () => {
    const key = btn.dataset.setFiltration;
    const input = printerDetail.querySelector(key === 'internal' ? '#internalFilterInput' : '#externalFilterInput');
    command(id, 'filtration', { [key]: Number(input.value) }).catch(showError);
  });
  const levelButton = printerDetail.querySelector('[data-level]');
  if (levelButton) levelButton.onclick = () => {
    if (!confirm(`Start bed levelling on ${printer.name}? The printer may heat the bed and move the toolhead during calibration.`)) return;
    command(id, 'level').catch(showError);
  };
  const toolOffsetOpen = printerDetail.querySelector('[data-tool-offset-open]');
  if (toolOffsetOpen) toolOffsetOpen.onclick = () => {
    const panel = printerDetail.querySelector('#toolOffsetCalibrationPanel');
    if (panel) panel.classList.toggle('hidden');
  };
  printerDetail.querySelectorAll('[data-tool-offset-action]').forEach((btn) => btn.onclick = async () => {
    const action = btn.dataset.toolOffsetAction;
    const toolIndex = btn.dataset.toolIndex === undefined ? undefined : Number(btn.dataset.toolIndex);
    if (toolOffsetActionLocks.has(id)) {
      showError(new Error('A U1 XYZ toolhead calibration action is already running. Wait for it to finish before starting another step.'));
      return;
    }
    const confirmations = {
      start: `Start the U1 XYZ toolhead cleaning/calibration sequence on ${printer.name}? Leave the build plate fitted and clear the bed area. The U1 will preheat/home, automatically clean T0 and bring it to the front for your manual nozzle clean.`,
      'advance-cleaning': toolIndex < 3
        ? `Have you manually cleaned T${toolIndex}? Confirming will cool T${toolIndex}, then automatically heat/auto-clean T${toolIndex + 1} and bring it to the front for you.`
        : 'Have you manually cleaned T3? Confirming will cool T3 and complete the four-tool cleaning stage.',
      'check-plate': `All four nozzles should now be manually cleaned and cooled. Remove the U1 build plate, then confirm this check. The printer will verify that the plate has been removed and then automatically continue through the stock T0–T3 XYZ offset measurements.`,
      save: 'Save the completed U1 XYZ offset calibration results?',
      exit: 'Finish and exit the U1 XYZ offset calibration mode?'
    };
    if (confirmations[action] && !confirm(confirmations[action])) return;
    const original = btn.textContent;
    const cleanStatus = action === 'advance-cleaning' && toolIndex !== undefined
      ? printerDetail.querySelector(`[data-calibration-clean="${toolIndex}"]`)
      : null;
    const originalCleanStatus = cleanStatus?.textContent;
    btn.disabled = true;
    btn.textContent = action === 'check-plate' ? 'Verifying…'
      : action === 'advance-cleaning' ? 'Working…'
      : 'Working…';
    if (cleanStatus) {
      cleanStatus.textContent = toolIndex < 3
        ? `Cooling T${toolIndex} · preparing T${toolIndex + 1}…`
        : 'Cooling T3 · finishing cleaning stage…';
    }
    let commandSucceeded = false;
    toolOffsetActionLocks.set(id, { action, toolIndex, startedAt: Date.now() });
    updateOpenPrinterTelemetry();
    try {
      await command(id, 'tool-offset-calibration', { action, ...(toolIndex !== undefined ? { toolIndex } : {}) });
      commandSucceeded = true;
      if (action === 'exit') printerDetail.querySelector('#toolOffsetCalibrationPanel')?.classList.add('hidden');
    } catch (error) { showError(error); }
    finally {
      btn.textContent = original;
      toolOffsetActionLocks.delete(id);
      updateOpenPrinterTelemetry();
      if (!commandSucceeded && cleanStatus && originalCleanStatus != null) cleanStatus.textContent = originalCleanStatus;
    }
  });
  const cameraOpenButton = printerDetail.querySelector('[data-camera-open]');
  if (cameraOpenButton) cameraOpenButton.onclick = async () => {
    try {
      const { cameraUrl } = await api(`/api/printers/${id}/camera`, { method:'POST', body:'{}' });
      const current = printerDetail.querySelector('.detail-camera');
      if (current) {
        const img = document.createElement('img');
        img.className = 'detail-camera';
        img.alt = `${printer.name} camera`;
        img.src = `${cameraUrl}${cameraUrl.includes('?') ? '&' : '?'}_=${Date.now()}`;
        current.replaceWith(img);
      }
    } catch (error) { showError(error); }
  };
  const renameButton = printerDetail.querySelector('[data-rename]');
  const renameInput = printerDetail.querySelector('[data-printer-name]');
  if (renameButton && renameInput) renameButton.onclick = async () => {
    const nextName = renameInput.value.trim();
    if (!nextName) { showError(new Error('Printer name is required')); return; }
    if (nextName === printer.name) return;
    renameButton.disabled = true;
    const originalText = renameButton.textContent;
    renameButton.textContent = 'Renaming…';
    try {
      const result = await api(`/api/printers/${id}/name`, { method:'PUT', body:JSON.stringify({ name:nextName }) });
      printer.name = result.printer.name;
      renameInput.value = printer.name;
      const heading = printerDetail.querySelector('[data-detail-name]');
      if (heading) heading.textContent = printer.name;
      const status = printerDetail.querySelector('[data-rename-status]');
      if (status) status.textContent = `Controller name changed to ${printer.name}. Printer-reported name is unchanged.`;
    } catch (error) { showError(error); }
    finally { renameButton.disabled = false; renameButton.textContent = originalText; }
  };

  printerDetail.querySelector('[data-remove]').onclick = async () => {
    if (!confirm(`Remove ${printer.name} from this controller?`)) return;
    try {
      await api(`/api/printers/${id}`, { method:'DELETE' });
      printerDialog.close();
      currentPrinterId = null;
    } catch (error) { showError(error); }
  };
}

printerDialog.addEventListener('close', () => {
  currentPrinterId = null;
  // Removing the live image closes this browser's proxy subscription. The
  // backend keeps a shared upstream stream only while another viewer needs it.
  printerDetail.innerHTML = '';
});
window.addEventListener('beforeunload', () => eventSource?.close());

await loadAdapters();
await loadInitialFleet();
await refreshPrintLibrary().catch((error) => console.error('Could not load Print Library', error));
connectLiveUpdates();
