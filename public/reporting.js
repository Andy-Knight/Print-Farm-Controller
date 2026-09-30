const reportsBtn = document.querySelector('#reportsBtn');
const topbarOverflow = document.querySelector('#topbarOverflow');
const reportingDialog = document.querySelector('#reportingDialog');
const reportingRange = document.querySelector('#reportingRange');
const reportingGroup = document.querySelector('#reportingGroup');
const reportingPrinter = document.querySelector('#reportingPrinter');
const reportingRefreshBtn = document.querySelector('#reportingRefreshBtn');
const reportingStatus = document.querySelector('#reportingStatus');
const reportingError = document.querySelector('#reportingError');
const reportingKpis = document.querySelector('#reportingKpis');
const reportingTrend = document.querySelector('#reportingTrend');
const reportingPrinters = document.querySelector('#reportingPrinters');
const reportingFiles = document.querySelector('#reportingFiles');
const reportingMaterials = document.querySelector('#reportingMaterials');
const filamentForm = document.querySelector('#filamentForm');
const filamentId = document.querySelector('#filamentId');
const filamentMaterial = document.querySelector('#filamentMaterial');
const filamentBrand = document.querySelector('#filamentBrand');
const filamentProduct = document.querySelector('#filamentProduct');
const filamentColour = document.querySelector('#filamentColour');
const filamentCost = document.querySelector('#filamentCost');
const filamentCurrency = document.querySelector('#filamentCurrency');
const filamentFormTitle = document.querySelector('#filamentFormTitle');
const filamentSubmitBtn = document.querySelector('#filamentSubmitBtn');
const filamentCancelEdit = document.querySelector('#filamentCancelEdit');
const filamentList = document.querySelector('#filamentList');
const filamentError = document.querySelector('#filamentError');

let reportingPrintersState = [];
let reportingGroupsState = [];
let reportingFilamentsState = [];
let currentReport = null;
const FILAMENT_CURRENCIES = new Set(['GBP', 'USD', 'EUR', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF', 'HKD', 'SGD', 'INR', 'KRW', 'TWD', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'AED', 'SAR', 'ILS', 'ZAR', 'BRL', 'MXN', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'RUB', 'CLP', 'COP']);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers:options.body ? { 'content-type':'application/json', ...(options.headers || {}) } : options.headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString(undefined, { maximumFractionDigits:digits, minimumFractionDigits:digits });
}

function formatPercent(rate) {
  const value = Number(rate);
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

function formatRateTrend(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return 'Trend unavailable';
  const points = Math.round(value * 100);
  if (points === 0) return 'No recent change';
  return `${points > 0 ? '+' : ''}${points} pp recent trend`;
}

function formatCurrencyTotals(totals = {}) {
  const entries = Object.entries(totals || {}).filter(([, value]) => Number.isFinite(Number(value)));
  if (!entries.length) return '—';
  return entries.map(([currency, value]) => {
    try {
      return new Intl.NumberFormat(undefined, { style:'currency', currency }).format(Number(value));
    } catch {
      return `${currency} ${Number(value).toFixed(2)}`;
    }
  }).join(' + ');
}

function reportRangeDates() {
  const days = Math.max(1, Number(reportingRange?.value || 30));
  const to = new Date();
  const from = new Date(to.getTime() - (days * 24 * 60 * 60 * 1000));
  return { from:from.toISOString(), to:to.toISOString() };
}

function populateReportFilters() {
  if (reportingGroup) {
    const previous = reportingGroup.value;
    reportingGroup.innerHTML = '<option value="">All printer groups</option>'
      + reportingGroupsState.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('');
    if ([...reportingGroup.options].some((option) => option.value === previous)) reportingGroup.value = previous;
  }
  if (reportingPrinter) {
    const previous = reportingPrinter.value;
    reportingPrinter.innerHTML = '<option value="">All printers</option>'
      + reportingPrintersState.map((printer) => `<option value="${escapeHtml(printer.id)}">${escapeHtml(printer.name || printer.model || printer.id)}</option>`).join('');
    if ([...reportingPrinter.options].some((option) => option.value === previous)) reportingPrinter.value = previous;
  }
}

function lineChartSvg(rows = []) {
  if (!rows.length) return '<div class="reporting-empty">No completed reporting history in this period.</div>';
  const width = 760;
  const height = 230;
  const pad = { left:42, right:18, top:18, bottom:34 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxY = Math.max(1, ...rows.flatMap((row) => [Number(row.completed || 0), Number(row.failed || 0), Number(row.cancelled || 0)]));
  const x = (index) => pad.left + (rows.length === 1 ? chartW / 2 : (index / (rows.length - 1)) * chartW);
  const y = (value) => pad.top + chartH - (Number(value || 0) / maxY) * chartH;
  const path = (key) => rows.map((row, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(row[key]).toFixed(1)}`).join(' ');
  const tickIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  const grid = [0, .25, .5, .75, 1].map((portion) => {
    const yy = pad.top + chartH - portion * chartH;
    const label = Math.round(maxY * portion);
    return `<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" class="reporting-grid-line"/>
      <text x="${pad.left - 8}" y="${yy + 4}" text-anchor="end" class="reporting-axis-text">${label}</text>`;
  }).join('');
  const labels = tickIndexes.map((index) => {
    const text = rows[index]?.date ? new Date(`${rows[index].date}T00:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : '';
    return `<text x="${x(index)}" y="${height - 9}" text-anchor="middle" class="reporting-axis-text">${escapeHtml(text)}</text>`;
  }).join('');
  return `<div class="reporting-chart-legend">
      <span><i class="reporting-legend-dot completed"></i>Completed</span>
      <span><i class="reporting-legend-dot failed"></i>Failed</span>
      <span><i class="reporting-legend-dot cancelled"></i>Cancelled</span>
    </div>
    <svg class="reporting-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily print outcomes">
      ${grid}
      <path d="${path('completed')}" class="reporting-series completed"/>
      <path d="${path('failed')}" class="reporting-series failed"/>
      <path d="${path('cancelled')}" class="reporting-series cancelled"/>
      ${labels}
    </svg>`;
}

function renderBarRows(rows, { value, label, detail = null, maxRows = 8, empty = 'No data in this period.' } = {}) {
  const sliced = rows.slice(0, maxRows);
  if (!sliced.length) return `<div class="reporting-empty">${escapeHtml(empty)}</div>`;
  const values = sliced.map((row) => Math.max(0, Number(value(row) || 0)));
  const max = Math.max(1, ...values);
  return sliced.map((row, index) => {
    const amount = values[index];
    const pct = Math.max(1.5, (amount / max) * 100);
    return `<div class="reporting-bar-row">
      <div class="reporting-bar-heading">
        <strong title="${escapeHtml(label(row))}">${escapeHtml(label(row))}</strong>
        <span>${escapeHtml(detail ? detail(row) : String(amount))}</span>
      </div>
      <div class="reporting-bar-track"><span style="width:${pct.toFixed(2)}%"></span></div>
    </div>`;
  }).join('');
}

function renderProblemPrinters(printers = []) {
  if (!printers.length) return '<div class="reporting-empty">No printer activity in this period.</div>';
  return printers.slice(0, 10).map((printer) => {
    const attention = Array.isArray(printer.attentionReasons) ? printer.attentionReasons : [];
    return `<article class="reporting-printer-row ${attention.length ? 'attention' : ''}">
      <div>
        <strong>${escapeHtml(printer.printerName || 'Unknown printer')}</strong>
        <div class="subtle">${printer.attempts} attempts · ${printer.completed} completed · ${printer.failed} failed · ${formatNumber(printer.runHours, 1)} h run time</div>
        <div class="reporting-printer-trend">${escapeHtml(formatRateTrend(printer.failureRateTrend))}</div>
      </div>
      <div class="reporting-printer-rate">
        <b>${formatPercent(printer.failureRate)}</b>
        <span>failure rate</span>
      </div>
      ${attention.length ? `<div class="reporting-attention-reasons">${attention.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>` : ''}
    </article>`;
  }).join('');
}

function renderReport(report) {
  currentReport = report;
  const totals = report?.totals || {};
  if (reportingKpis) {
    reportingKpis.innerHTML = [
      ['Print attempts', formatNumber(totals.attempts)],
      ['Completed', formatNumber(totals.completed)],
      ['Completion rate', formatPercent(totals.completionRate)],
      ['Failed', formatNumber(totals.failed)],
      ['Run time', `${formatNumber(totals.runHours, 1)} h`],
      ['Material used', totals.materialGrams ? `${formatNumber(totals.materialGrams, 1)} g` : '—'],
      ['Material spend', formatCurrencyTotals(totals.spendByCurrency)],
      ['Cost coverage', totals.completed ? `${formatNumber(totals.costedPrints)} / ${formatNumber(totals.completed)} prints` : '—']
    ].map(([label, value]) => `<div class="reporting-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }
  if (reportingTrend) reportingTrend.innerHTML = lineChartSvg(report?.daily || []);
  if (reportingPrinters) reportingPrinters.innerHTML = renderProblemPrinters(report?.printers || []);
  if (reportingFiles) {
    reportingFiles.innerHTML = renderBarRows(report?.files || [], {
      value:(row) => row.completed,
      label:(row) => row.fileName,
      detail:(row) => `${row.completed} completed · ${row.failed} failed`,
      empty:'No files were completed in this period.'
    });
  }
  if (reportingMaterials) {
    reportingMaterials.innerHTML = renderBarRows(report?.materials || [], {
      value:(row) => row.grams,
      label:(row) => row.label,
      detail:(row) => `${formatNumber(row.grams, 1)} g · ${formatCurrencyTotals(row.spendByCurrency)}`,
      empty:'No costed material usage is available in this period.'
    });
  }
}

async function loadReportingContext() {
  const [printersPayload, groupsPayload, filamentPayload] = await Promise.all([
    requestJson('/api/printers'),
    requestJson('/api/printer-groups'),
    requestJson('/api/filaments')
  ]);
  reportingPrintersState = Array.isArray(printersPayload.printers) ? printersPayload.printers : [];
  reportingGroupsState = Array.isArray(groupsPayload.groups) ? groupsPayload.groups : [];
  reportingFilamentsState = Array.isArray(filamentPayload.filaments) ? filamentPayload.filaments : [];
  populateReportFilters();
  renderFilamentCatalogue();
}

async function loadReport() {
  if (reportingRefreshBtn) reportingRefreshBtn.disabled = true;
  if (reportingError) { reportingError.textContent = ''; reportingError.classList.add('hidden'); }
  if (reportingStatus) reportingStatus.textContent = 'Loading reporting data…';
  try {
    const range = reportRangeDates();
    const params = new URLSearchParams({ from:range.from, to:range.to });
    if (reportingGroup?.value) params.set('groupId', reportingGroup.value);
    if (reportingPrinter?.value) params.set('printerId', reportingPrinter.value);
    const payload = await requestJson(`/api/reports?${params.toString()}`);
    renderReport(payload.report || {});
    if (reportingStatus) {
      const from = new Date(payload.report?.range?.from || range.from).toLocaleDateString();
      const to = new Date(payload.report?.range?.to || range.to).toLocaleDateString();
      reportingStatus.textContent = `Reporting period: ${from} – ${to}. Historical analytics are retained independently of the recent queue history limit.`;
    }
  } catch (error) {
    if (reportingStatus) reportingStatus.textContent = '';
    if (reportingError) { reportingError.textContent = error.message; reportingError.classList.remove('hidden'); }
  } finally {
    if (reportingRefreshBtn) reportingRefreshBtn.disabled = false;
  }
}

function setFilamentCurrency(value = 'GBP') {
  if (!filamentCurrency) return;
  for (const option of [...filamentCurrency.options]) {
    if (option.dataset.legacyCurrency === 'true') option.remove();
  }
  const currency = String(value || 'GBP').trim().toUpperCase();
  if (!FILAMENT_CURRENCIES.has(currency)) {
    const legacy = document.createElement('option');
    legacy.value = currency;
    legacy.textContent = `${currency} (legacy — choose a supported currency)`;
    legacy.disabled = true;
    legacy.dataset.legacyCurrency = 'true';
    filamentCurrency.append(legacy);
  }
  filamentCurrency.value = currency;
}

function resetFilamentForm() {
  filamentForm?.reset();
  if (filamentId) filamentId.value = '';
  setFilamentCurrency('GBP');
  if (filamentFormTitle) filamentFormTitle.textContent = 'Add filament cost';
  if (filamentSubmitBtn) filamentSubmitBtn.textContent = 'Add filament';
  filamentCancelEdit?.classList.add('hidden');
  if (filamentError) { filamentError.textContent = ''; filamentError.classList.add('hidden'); }
}

function filamentLabel(item) {
  return [item.brand, item.product].filter(Boolean).join(' · ') || item.material;
}

function renderFilamentCatalogue() {
  if (!filamentList) return;
  const rows = reportingFilamentsState;
  if (!rows.length) {
    filamentList.innerHTML = '<div class="reporting-empty">No filament costs configured yet. Add a material and its current cost per kg.</div>';
    return;
  }
  filamentList.innerHTML = rows.map((item) => `<div class="filament-cost-row">
    <div>
      <strong>${escapeHtml(filamentLabel(item))}</strong>
      <div class="subtle">${escapeHtml(item.material)}${item.colour ? ` · ${escapeHtml(item.colour)}` : ''}</div>
    </div>
    <div class="filament-cost-price">
      <b>${escapeHtml(formatCurrencyTotals({ [item.currency]:item.costPerKg }))}</b>
      <span>per kg</span>
    </div>
    <div class="mini-actions">
      <button type="button" class="secondary" data-filament-edit="${escapeHtml(item.id)}">Edit</button>
      <button type="button" class="danger" data-filament-delete="${escapeHtml(item.id)}">Delete</button>
    </div>
  </div>`).join('');
}

reportsBtn?.addEventListener('click', async () => {
  if (topbarOverflow) topbarOverflow.open = false;
  reportingDialog?.showModal();
  if (reportingStatus) reportingStatus.textContent = 'Loading reporting data…';
  try {
    await loadReportingContext();
    await loadReport();
  } catch (error) {
    if (reportingStatus) reportingStatus.textContent = '';
    if (reportingError) { reportingError.textContent = error.message; reportingError.classList.remove('hidden'); }
  }
});

document.querySelectorAll('[data-reporting-close]').forEach((button) => button.addEventListener('click', () => reportingDialog?.close()));
reportingRefreshBtn?.addEventListener('click', loadReport);
reportingRange?.addEventListener('change', loadReport);
reportingGroup?.addEventListener('change', loadReport);
reportingPrinter?.addEventListener('change', loadReport);

filamentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = filamentId?.value || '';
  if (filamentSubmitBtn) filamentSubmitBtn.disabled = true;
  if (filamentError) { filamentError.textContent = ''; filamentError.classList.add('hidden'); }
  try {
    const currency = String(filamentCurrency?.value || 'GBP').trim().toUpperCase();
    if (!FILAMENT_CURRENCIES.has(currency)) throw new Error('Choose a supported filament currency');
    const payload = {
      material:filamentMaterial?.value || '',
      brand:filamentBrand?.value || '',
      product:filamentProduct?.value || '',
      colour:filamentColour?.value || '',
      costPerKg:Number(filamentCost?.value),
      currency
    };
    await requestJson(id ? `/api/filaments/${encodeURIComponent(id)}` : '/api/filaments', {
      method:id ? 'PATCH' : 'POST',
      body:JSON.stringify(payload)
    });
    reportingFilamentsState = (await requestJson('/api/filaments')).filaments || [];
    renderFilamentCatalogue();
    resetFilamentForm();
    await loadReport();
  } catch (error) {
    if (filamentError) { filamentError.textContent = error.message; filamentError.classList.remove('hidden'); }
  } finally {
    if (filamentSubmitBtn) filamentSubmitBtn.disabled = false;
  }
});

filamentCancelEdit?.addEventListener('click', resetFilamentForm);
filamentList?.addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-filament-edit]');
  if (edit) {
    const item = reportingFilamentsState.find((entry) => entry.id === edit.dataset.filamentEdit);
    if (!item) return;
    if (filamentId) filamentId.value = item.id;
    if (filamentMaterial) filamentMaterial.value = item.material || '';
    if (filamentBrand) filamentBrand.value = item.brand || '';
    if (filamentProduct) filamentProduct.value = item.product || '';
    if (filamentColour) filamentColour.value = item.colour || '';
    if (filamentCost) filamentCost.value = String(item.costPerKg ?? '');
    setFilamentCurrency(item.currency || 'GBP');
    if (filamentFormTitle) filamentFormTitle.textContent = 'Edit filament cost';
    if (filamentSubmitBtn) filamentSubmitBtn.textContent = 'Save filament';
    filamentCancelEdit?.classList.remove('hidden');
    filamentMaterial?.focus();
    return;
  }

  const remove = event.target.closest('[data-filament-delete]');
  if (!remove) return;
  const item = reportingFilamentsState.find((entry) => entry.id === remove.dataset.filamentDelete);
  if (!item || !confirm(`Delete filament cost “${filamentLabel(item)}”? Historical print costs already captured will not change.`)) return;
  remove.disabled = true;
  try {
    await requestJson(`/api/filaments/${encodeURIComponent(item.id)}`, { method:'DELETE' });
    reportingFilamentsState = (await requestJson('/api/filaments')).filaments || [];
    renderFilamentCatalogue();
  } catch (error) {
    remove.disabled = false;
    if (filamentError) { filamentError.textContent = error.message; filamentError.classList.remove('hidden'); }
  }
});

resetFilamentForm();
