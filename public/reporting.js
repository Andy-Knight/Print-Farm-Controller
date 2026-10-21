const reportsBtn = document.querySelector('#reportsBtn');
const topbarOverflow = document.querySelector('#topbarOverflow');
const reportingDialog = document.querySelector('#reportingDialog');
const reportingRange = document.querySelector('#reportingRange');
const reportingGroup = document.querySelector('#reportingGroup');
const reportingPrinter = document.querySelector('#reportingPrinter');
const reportingRefreshBtn = document.querySelector('#reportingRefreshBtn');
const reportingStatus = document.querySelector('#reportingStatus');
const reportingError = document.querySelector('#reportingError');
const reportingTabs = Array.from(document.querySelectorAll('[data-reporting-tab]'));
const reportingPanels = Array.from(document.querySelectorAll('[data-reporting-panel]'));
const reportingKpis = document.querySelector('#reportingKpis');
const reportingTrend = document.querySelector('#reportingTrend');
const reportingPrinters = document.querySelector('#reportingPrinters');
const reportingFiles = document.querySelector('#reportingFiles');
const reportingMaterials = document.querySelector('#reportingMaterials');
const reportingFileFailures = document.querySelector('#reportingFileFailures');
const filamentForm = document.querySelector('#filamentForm');
const filamentId = document.querySelector('#filamentId');
const filamentMaterial = document.querySelector('#filamentMaterial');
const filamentBrand = document.querySelector('#filamentBrand');
const filamentProduct = document.querySelector('#filamentProduct');
const filamentColour = document.querySelector('#filamentColour');
const filamentCost = document.querySelector('#filamentCost');
const filamentFormTitle = document.querySelector('#filamentFormTitle');
const filamentSubmitBtn = document.querySelector('#filamentSubmitBtn');
const filamentCancelEdit = document.querySelector('#filamentCancelEdit');
const filamentList = document.querySelector('#filamentList');
const filamentError = document.querySelector('#filamentError');
const reportingPricingForm = document.querySelector('#reportingPricingForm');
const reportingCurrency = document.querySelector('#reportingCurrency');
const reportingPricingFields = document.querySelector('#reportingPricingFields');
const reportingProfitPercent = document.querySelector('#reportingProfitPercent');
const reportingProfitMethod = document.querySelector('#reportingProfitMethod');
const reportingTaxRate = document.querySelector('#reportingTaxRate');
const reportingHourlyCostRate = document.querySelector('#reportingHourlyCostRate');
const reportingLabourHourlyRate = document.querySelector('#reportingLabourHourlyRate');
const reportingPricingStatus = document.querySelector('#reportingPricingStatus');
const reportingPricingError = document.querySelector('#reportingPricingError');
const reportingPricingSaveBtn = document.querySelector('#reportingPricingSaveBtn');

let reportingPrintersState = [];
let reportingGroupsState = [];
let reportingFilamentsState = [];
let currentReport = null;
let activeReportingTab = 'analytics';
let reportingPricingLoadSerial = 0;
let reportingPricingSaving = false;
let reportingCurrencyActive = 'GBP';
let reportingFilesScope = 'top10';
let reportingFilesSort = { key:'completed', direction:'desc' };
let reportingMaterialMode = 'type';

function clearReportingPricingMessages() {
  if (reportingPricingError) {
    reportingPricingError.textContent = '';
    reportingPricingError.classList.add('hidden');
  }
}
async function loadReportingPricingSettings() {
  if (!reportingPricingFields || reportingPricingSaving) return;
  const requestId=++reportingPricingLoadSerial;
  reportingPricingFields.disabled=true;
  clearReportingPricingMessages();
  if (reportingPricingStatus) reportingPricingStatus.textContent='Loading saved pricing settings…';
  try {
    const response=await requestJson('/api/library/pricing');
    if (requestId !== reportingPricingLoadSerial) return;
    reportingCurrencyActive=String(response.settings?.currency || 'GBP').toUpperCase();
    if (reportingCurrency) reportingCurrency.value=reportingCurrencyActive;
    if (reportingProfitPercent) reportingProfitPercent.value=response.settings?.profitPercent ?? '';
    if (reportingProfitMethod) reportingProfitMethod.value=response.settings?.profitMethod || 'markup';
    if (reportingTaxRate) reportingTaxRate.value=String(response.settings?.taxRate ?? 0);
    if (reportingHourlyCostRate) reportingHourlyCostRate.value=String(response.settings?.hourlyCostRate ?? 0);
    if (reportingLabourHourlyRate) reportingLabourHourlyRate.value=String(response.settings?.labourHourlyRate ?? '');
    reportingPricingFields.disabled=false;
    if (reportingPricingStatus) reportingPricingStatus.textContent='Saved settings loaded. Changes affect current Print Library tax-inclusive sell prices.';
  } catch(error) {
    if (requestId !== reportingPricingLoadSerial) return;
    if (reportingPricingError) {
      reportingPricingError.textContent=error.message;
      reportingPricingError.classList.remove('hidden');
    }
    if (reportingPricingStatus) reportingPricingStatus.textContent='Could not load pricing settings. Select the tab again to retry.';
  }
}



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
  if (rate == null || rate === '') return '—';
  const value = Number(rate);
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

function formatRateTrend(rate) {
  // Number(null) is zero, so check absence before formatting the trend.
  if (rate == null || rate === '') return 'Insufficient data';
  const value = Number(rate);
  if (!Number.isFinite(value)) return 'Insufficient data';
  const points = Math.round(value * 100);
  if (points === 0) return 'No recent change';
  return `${points > 0 ? '+' : ''}${points} pp recent trend`;
}

function formatPrinterRunTime(printer) {
  if (printer.runTimeRecordedCount === 0) return 'run time unavailable';
  const minutes = Number(printer.runMinutes);
  if (Number.isFinite(minutes) && minutes >= 0 && minutes < 6) {
    return `${formatNumber(minutes, 1)} min run time`;
  }
  return `${formatNumber(printer.runHours, 1)} h run time`;
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

function lineChartViewModel(rows = []) {
  if (!rows.length) {
    return { rows:[], grid:[], labels:[], viewBox:'0 0 760 230', completedPath:'', failedPath:'', cancelledPath:'' };
  }
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
  return {
    rows,
    viewBox:`0 0 ${width} ${height}`,
    completedPath:path('completed'),
    failedPath:path('failed'),
    cancelledPath:path('cancelled'),
    grid:[0, .25, .5, .75, 1].map((portion) => {
      const yy = pad.top + chartH - portion * chartH;
      return {
        x1:pad.left,
        x2:width - pad.right,
        y:yy,
        labelX:pad.left - 8,
        labelY:yy + 4,
        label:Math.round(maxY * portion)
      };
    }),
    labels:tickIndexes.map((index) => ({
      x:x(index),
      y:height - 9,
      text:rows[index]?.date
        ? new Date(`${rows[index].date}T00:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric' })
        : ''
    }))
  };
}

function reportingBarRowsViewModel(rows, { value, label, detail = null, maxRows = 8 } = {}) {
  const sliced = (rows || []).slice(0, maxRows);
  const values = sliced.map((row) => Math.max(0, Number(value(row) || 0)));
  const max = Math.max(1, ...values);
  return sliced.map((row, index) => {
    const amount = values[index];
    return {
      key:String(row.id || row.fileName || row.label || index),
      label:String(label(row)),
      detail:String(detail ? detail(row) : amount),
      percent:Number(Math.max(1.5, (amount / max) * 100).toFixed(2))
    };
  });
}

function formatReportingDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—'
    : date.toLocaleDateString(undefined, { day:'2-digit', month:'short', year:'numeric' });
}

// Count completed and failed prints only: cancelled queue jobs do not
// represent physical print outcomes and must not lower file success rates.
function filePrintRate(file, field = 'completed') {
  const count = Number(file.completed || 0) + Number(file.failed || 0);
  return count > 0 ? Number(file[field] || 0) / count : null;
}

function reportingFileRows(files = [], { failures = false } = {}) {
  const ranked = files.filter((item) => Number(item.completed || 0) > 0 || (failures && Number(item.failed || 0) > 0))
    .slice().sort((a, b) => Number(b.completed || 0) - Number(a.completed || 0)
      || String(a.fileName || '').localeCompare(String(b.fileName || '')))
    .map((item, index) => ({ ...item, rank:index + 1 }));
  const sorted = ranked.filter((item) => !failures || Number(item.failed || 0) > 0);
  const sortKey = failures ? 'failed' : reportingFilesSort.key;
  const direction = failures ? 'desc' : reportingFilesSort.direction;
  sorted.sort((a, b) => {
    if (sortKey === 'fileName') {
      const result = String(a.fileName || '').localeCompare(String(b.fileName || ''));
      return direction === 'asc' ? result : -result;
    }
    const value = (item) => sortKey === 'successRate' ? filePrintRate(item) ?? -1 : Number(item[sortKey] || 0);
    const result = value(a) - value(b);
    return (direction === 'asc' ? result : -result)
      || Number(b.completed || 0) - Number(a.completed || 0)
      || String(a.fileName || '').localeCompare(String(b.fileName || ''));
  });
  const maxCompleted = Math.max(1, ...ranked.map((item) => Number(item.completed || 0)));
  return (failures ? sorted.slice(0, 5)
    : reportingFilesScope === 'all' ? sorted : sorted.slice(0, 10))
    .map((item) => ({
      id:String(item.libraryFileId || item.fileName || item.rank),
      rank:item.rank,
      fileName:String(item.fileName || 'Unknown file'),
      libraryFileId:item.libraryFileId ? String(item.libraryFileId) : null,
      previewUrl:String(item.previewUrl || ''),
      attempts:Number(item.attempts || 0),
      completed:Number(item.completed || 0),
      failed:Number(item.failed || 0),
      successRate:filePrintRate(item) == null ? '—' : `${formatNumber(filePrintRate(item) * 100, 1)}%`,
      failureRate:filePrintRate(item, 'failed') == null ? '—' : `${formatNumber(filePrintRate(item, 'failed') * 100, 1)}%`,
      popularity:Number(Math.min(100, Math.max(0, Number(item.completed || 0) / maxCompleted * 100)).toFixed(1)),
      lastFailure:formatReportingDate(item.lastFailedAt)
    }));
}

function reportingFilamentLabel(entry, materialType) {
  const recordedLabel = String(entry?.label || entry?.material || 'Unknown filament').trim();
  const typeOnly = materialType !== 'UNKNOWN MATERIAL'
    && recordedLabel.toUpperCase() === materialType;
  if (!typeOnly) return { label:recordedLabel, note:'' };
  if (entry?.filamentId) {
    // A catalogue reference exists, but its historical snapshot did not
    // capture brand/product; do not imply the filament was unidentified.
    return {
      label:`${recordedLabel} (Brand/product not recorded)`,
      note:'The print recorded a filament catalogue reference, but the saved snapshot contains only the material type. Brand and product cannot be recovered reliably from current catalogue settings.'
    };
  }
  return {
    label:`${recordedLabel} (Unidentified filament)`,
    note:'The print recorded this material type but did not identify a specific filament catalogue entry. Brand and product cannot be determined from the historical snapshot.'
  };
}

function reportingMaterialRows(materials = []) {
  const groupByType = reportingMaterialMode === 'type';
  const groups = new Map();
  for (const entry of materials) {
    const type = String(entry.material || 'Unknown material').trim().toUpperCase();
    const display = groupByType ? { label:type, note:'' } : reportingFilamentLabel(entry, type);
    const key = groupByType ? type : String(entry.filamentId || entry.label || type);
    if (!groups.has(key)) groups.set(key, { key, ...display, grams:0, spendByCurrency:{} });
    const row = groups.get(key);
    row.grams += Number(entry.grams || 0);
    for (const [currency, amount] of Object.entries(entry.spendByCurrency || {})) {
      if (Number.isFinite(Number(amount))) {
        row.spendByCurrency[currency] = (row.spendByCurrency[currency] || 0) + Number(amount);
      }
    }
  }
  const ordered = [...groups.values()].filter((row) => row.grams > 0)
    .sort((a,b) => b.grams - a.grams || a.label.localeCompare(b.label));
  const total = ordered.reduce((sum, row) => sum + row.grams, 0);
  const spendByCurrency = {};
  for (const row of ordered) {
    for (const [currency, value] of Object.entries(row.spendByCurrency)) {
      spendByCurrency[currency] = (spendByCurrency[currency] || 0) + value;
    }
  }
  return {
    rows:ordered.map((row) => ({
      key:row.key,
      label:row.label,
      note:row.note,
      kg:formatNumber(row.grams / 1000, 2),
      percentage:total > 0 ? `${formatNumber(row.grams * 100 / total, 1)}%` : '—',
      percent:total > 0 ? Number((row.grams * 100 / total).toFixed(1)) : 0,
      cost:formatCurrencyTotals(row.spendByCurrency)
    })),
    totalKg:formatNumber(total / 1000, 2),
    totalCost:formatCurrencyTotals(spendByCurrency)
  };
}

function reportingPrintersViewModel(printers = []) {
  return printers.filter((printer) =>
    printer?.printerId && Array.isArray(printer.attentionReasons) && printer.attentionReasons.length > 0
  ).slice(0, 10).map((printer, index) => ({
    id:String(printer.printerId || printer.id || index),
    name:String(printer.printerName || 'Unknown printer'),
    summary:`${printer.attempts} attempts · ${printer.completed} completed · ${printer.failed} failed · ${formatPrinterRunTime(printer)}`,
    attempts:Number(printer.attempts || 0),
    completed:Number(printer.completed || 0),
    failed:Number(printer.failed || 0),
    latestFailure:formatReportingDate(printer.lastFailedAt),
    trend:formatRateTrend(printer.failureRateTrend),
    failureRate:formatPercent(printer.failureRate),
    attention:Array.isArray(printer.attentionReasons) ? printer.attentionReasons.map(String) : []
  }));
}

function reportingKpiViewModel(report = {}) {
  const totals = report?.totals || {};
  return [
    { label:'Total print jobs', value:formatNumber(totals.attempts), detail:'In selected period', icon:'▤', tone:'info' },
    { label:'Completed', value:formatNumber(totals.completed), detail:`${formatPercent(totals.completionRate)} completion rate`, icon:'✓', tone:Number(totals.completed || 0) > 0 ? 'positive' : 'info' },
    { label:'Failed', value:formatNumber(totals.failed), detail:`${formatPercent(totals.failureRate)} failure rate`, icon:Number(totals.failed || 0) > 0 ? '×' : '✓', tone:Number(totals.failed || 0) > 0 ? 'negative' : 'positive' },
    { label:'Total run time', value:`${formatNumber(totals.runHours, 1)} h`, detail:'Reported from print timestamps', icon:'◷', tone:'info' }
  ];
}

function reportingFilamentsViewModel() {
  return reportingFilamentsState.map((item) => ({
    id:String(item.id || ''),
    label:filamentLabel(item),
    detail:`${item.material}${item.colour ? ` · ${item.colour}` : ''}`,
    price:formatCurrencyTotals({ [item.currency]:item.costPerKg })
  }));
}

function publishReportingUiState(report = currentReport || {}) {
  if (!window.__PFC_PREACT_REPORTING__) return;
  const detail = {
    activeTab:activeReportingTab,
    kpis:reportingKpiViewModel(report),
    chart:lineChartViewModel(report?.daily || []),
    printers:reportingPrintersViewModel(report?.printers || []),
    printerActivity:(report?.printers || []).length > 0,
    files:reportingFileRows(report?.files || []),
    fileFailures:reportingFileRows(report?.files || [], { failures:true }),
    fileScope:reportingFilesScope,
    fileSort:reportingFilesSort,
    materials:reportingMaterialRows(report?.materials || []),
    materialMode:reportingMaterialMode,
    filaments:reportingFilamentsViewModel()
  };
  window.__PFC_REPORTING_UI_STATE__ = detail;
  window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state', { detail }));
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

function reportingFileNameHtml(file) {
  const thumbnail = file.previewUrl
    ? `<img src="${escapeHtml(file.previewUrl)}" alt="" loading="lazy" />`
    : '<span class="reporting-thumbnail-empty" aria-hidden="true">◇</span>';
  const name = file.libraryFileId
    ? `<button type="button" class="reporting-file-link" data-reporting-open-file="${escapeHtml(file.libraryFileId)}" title="Open Print Library details">${escapeHtml(file.fileName)}</button>`
    : `<span class="reporting-file-plain" title="This file is not in the Print Library">${escapeHtml(file.fileName)}</span>`;
  return `<div class="reporting-file-identity"><span class="reporting-thumbnail">${thumbnail}</span>${name}</div>`;
}

function reportingTableShell(headings, rows, empty, foot = '') {
  if (!rows.length) return `<div class="reporting-empty">${escapeHtml(empty)}</div>`;
  return `<div class="reporting-table-scroll" tabindex="0" role="region" aria-label="Scrollable analytics table">
    <table class="reporting-analytics-table">
      <thead><tr>${headings.map((item) => `<th scope="col"${item.numeric ? ' class="numeric"' : ''}>${item.html || escapeHtml(item.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>${foot}
    </table></div>`;
}

function renderReportFiles(files) {
  const headings = [
    { label:'#' }, { label:'Print file', html:`<button type="button" class="reporting-table-sort" data-reporting-file-sort="fileName" aria-label="Sort by file name" aria-pressed="${reportingFilesSort.key === 'fileName'}">Print file ${reportingFilesSort.key === 'fileName' ? (reportingFilesSort.direction === 'desc' ? '▼' : '▲') : '↕'}</button>` },
    ...[
      ['completed','Completed'], ['failed','Failed'], ['successRate','Success rate']
    ].map(([key,label]) => ({
      label,
      numeric:true,
      html:`<button type="button" class="reporting-table-sort" data-reporting-file-sort="${key}" aria-label="Sort by ${label.toLowerCase()}" aria-pressed="${reportingFilesSort.key === key}">${label} ${reportingFilesSort.key === key ? (reportingFilesSort.direction === 'desc' ? '▼' : '▲') : '↕'}</button>`
    })),
    { label:'Popularity' }
  ];
  return reportingTableShell(headings, files.map((file) => `<tr>
      <td>${file.rank}</td><td>${reportingFileNameHtml(file)}</td>
      <td class="numeric">${file.completed}</td><td class="numeric">${file.failed}</td>
      <td class="numeric">${file.successRate}</td>
      <td><div class="reporting-progress" role="img" aria-label="${file.popularity}% of leading file">
        <span style="width:${file.popularity}%"></span></div></td>
    </tr>`),
    'No completed print files for the selected period.');
}

function renderReportMaterials(materials) {
  const headings = [
    { label:reportingMaterialMode === 'type' ? 'Material type' : 'Filament' },
    { label:'Used (kg)', numeric:true }, { label:'Share', numeric:true },
    { label:'Estimated cost', numeric:true }, { label:'Usage' }
  ];
  const foot = `<tfoot><tr class="reporting-total-row"><th scope="row">Total</th>
    <td class="numeric">${materials.totalKg}</td><td class="numeric">100%</td>
    <td class="numeric">${escapeHtml(materials.totalCost)}</td><td></td></tr></tfoot>`;
  return reportingTableShell(headings, materials.rows.map((row) => `<tr>
    <td title="${escapeHtml(row.note || row.label)}">${escapeHtml(row.label)}</td>
    <td class="numeric">${row.kg}</td><td class="numeric">${row.percentage}</td>
    <td class="numeric">${escapeHtml(row.cost)}</td><td><div class="reporting-progress"><span style="width:${row.percent}%"></span></div></td>
  </tr>`), 'No material usage captured for completed prints in this period.', foot);
}

function renderProblemPrinters(printers = []) {
  const rows = reportingPrintersViewModel(printers);
  if (!rows.length) return `<div class="reporting-empty">${printers.length
    ? 'No printers currently need attention. No printers have exceeded the failure thresholds during the selected reporting period.'
    : 'No printer activity in this period.'}</div>`;
  return reportingTableShell([
    { label:'Printer' }, { label:'Attempts', numeric:true },
    { label:'Completed', numeric:true }, { label:'Failed', numeric:true },
    { label:'Failure rate', numeric:true }, { label:'Trend' }, { label:'Last failure' }
  ], rows.map((row) => `<tr>
    <th scope="row" title="${escapeHtml(row.attention.join('; '))}">${escapeHtml(row.name)}</th>
    <td class="numeric">${row.attempts}</td><td class="numeric">${row.completed}</td>
    <td class="numeric">${row.failed}</td><td class="numeric reporting-failure-value">${row.failureRate}</td>
    <td>${escapeHtml(row.trend)}</td><td>${escapeHtml(row.latestFailure)}</td>
  </tr>`), 'No printers currently need attention.');
}

function renderFileFailures(files) {
  return reportingTableShell([
    { label:'Print file' }, { label:'Attempts', numeric:true },
    { label:'Failed', numeric:true }, { label:'Failure rate', numeric:true }, { label:'Last failure' }
  ], files.map((file) => `<tr>
    <td>${reportingFileNameHtml(file)}</td>
    <td class="numeric">${file.attempts}</td><td class="numeric">${file.failed}</td>
    <td class="numeric reporting-failure-value">${file.failureRate}</td>
    <td>${escapeHtml(file.lastFailure)}</td></tr>`),
    'No failed print files for the selected period.');
}

function renderReport(report) {
  currentReport = report;
  if (window.__PFC_PREACT_REPORTING__) {
    publishReportingUiState(report);
    return;
  }
  if (reportingKpis) {
    reportingKpis.innerHTML = reportingKpiViewModel(report).map((item) => `<div class="reporting-kpi">
      <span class="reporting-kpi-icon reporting-kpi-icon-${escapeHtml(item.tone)}" aria-hidden="true">${escapeHtml(item.icon)}</span>
      <div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.detail)}</small></div></div>`).join('');
  }
  if (reportingTrend) reportingTrend.innerHTML = lineChartSvg(report?.daily || []);
  if (reportingPrinters) reportingPrinters.innerHTML = renderProblemPrinters(report?.printers || []);
  if (reportingFiles) reportingFiles.innerHTML = renderReportFiles(reportingFileRows(report?.files || []));
  if (reportingMaterials) reportingMaterials.innerHTML = renderReportMaterials(reportingMaterialRows(report?.materials || []));
  if (reportingFileFailures) reportingFileFailures.innerHTML = renderFileFailures(reportingFileRows(report?.files || [], { failures:true }));

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

function resetFilamentForm() {
  filamentForm?.reset();
  if (filamentId) filamentId.value = '';
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
  if (window.__PFC_PREACT_REPORTING__) {
    publishReportingUiState(currentReport || {});
    return;
  }
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

function activateReportingTab(name, focus = false) {
  const selectedName = ['analytics','filament','pricing'].includes(name) ? name : 'analytics';
  activeReportingTab = selectedName;

  if (!window.__PFC_PREACT_REPORTING__) {
    const tabs = Array.from(document.querySelectorAll('[data-reporting-tab]'));
    for (const tab of tabs) {
      const active = tab.dataset.reportingTab === selectedName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    }
  }

  for (const panel of reportingPanels) {
    panel.hidden = panel.dataset.reportingPanel !== selectedName;
  }
  if (window.__PFC_PREACT_REPORTING__) publishReportingUiState(currentReport || {});
  if (selectedName === 'pricing') void loadReportingPricingSettings();
  if (focus) document.querySelector(`[data-reporting-tab="${selectedName}"]`)?.focus();
}

window.addEventListener('pfc:reporting-action', (event) => {
  const action = event?.detail || {};
  if (action.type === 'tab') activateReportingTab(action.value);
});

if (!window.__PFC_PREACT_REPORTING__) {
  for (const tab of reportingTabs) {
    tab.addEventListener('click', () => activateReportingTab(tab.dataset.reportingTab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = reportingTabs.indexOf(tab);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? reportingTabs.length - 1
          : event.key === 'ArrowRight'
            ? (currentIndex + 1) % reportingTabs.length
            : (currentIndex - 1 + reportingTabs.length) % reportingTabs.length;
      activateReportingTab(reportingTabs[nextIndex]?.dataset.reportingTab, true);
    });
  }
}

reportsBtn?.addEventListener('click', async () => {
  if (topbarOverflow) topbarOverflow.open = false;
  activateReportingTab('analytics');
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
function updateReportingSegments() {
  document.querySelectorAll('[data-reporting-files-scope]').forEach((button) => {
    const active = button.dataset.reportingFilesScope === reportingFilesScope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-reporting-material-mode]').forEach((button) => {
    const active = button.dataset.reportingMaterialMode === reportingMaterialMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

reportingDialog?.addEventListener('click', (event) => {
  const scope = event.target.closest('[data-reporting-files-scope]');
  const group = event.target.closest('[data-reporting-material-mode]');
  const sort = event.target.closest('[data-reporting-file-sort]');
  const open = event.target.closest('[data-reporting-open-file]');
  if (open) {
    window.dispatchEvent(new CustomEvent('pfc:reporting-open-library-file', { detail:{ id:open.dataset.reportingOpenFile } }));
    return;
  }
  if (scope && ['top10','all'].includes(scope.dataset.reportingFilesScope)) reportingFilesScope = scope.dataset.reportingFilesScope;
  else if (group && ['type','filament'].includes(group.dataset.reportingMaterialMode)) reportingMaterialMode = group.dataset.reportingMaterialMode;
  else if (sort && ['fileName','completed','failed','successRate'].includes(sort.dataset.reportingFileSort)) {
    const key = sort.dataset.reportingFileSort;
    reportingFilesSort = key === reportingFilesSort.key
      ? { key, direction:reportingFilesSort.direction === 'desc' ? 'asc' : 'desc' }
      : { key, direction:key === 'fileName' ? 'asc' : 'desc' };
  } else return;
  updateReportingSegments();
  renderReport(currentReport || {});
});

reportingRefreshBtn?.addEventListener('click', loadReport);
reportingRange?.addEventListener('change', loadReport);
reportingGroup?.addEventListener('change', loadReport);
reportingPrinter?.addEventListener('change', loadReport);

reportingPricingForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  if (reportingPricingSaving || reportingPricingFields?.disabled) return;
  reportingPricingSaving=true;
  reportingPricingLoadSerial++; // Any earlier GET must not overwrite saved form values.
  reportingPricingFields.disabled=true;
  clearReportingPricingMessages();
  if (reportingPricingStatus) reportingPricingStatus.textContent='Saving global pricing settings…';
  try {
    await requestJson('/api/library/pricing',{method:'PUT',body:JSON.stringify({
      profitPercent:reportingProfitPercent?.value === '' ? null : Number(reportingProfitPercent?.value),
      profitMethod:reportingProfitMethod?.value || 'markup',
      taxRate:Number(reportingTaxRate?.value ?? 0),
      hourlyCostRate:Number(reportingHourlyCostRate?.value ?? 0),
      labourHourlyRate:reportingLabourHourlyRate?.value === '' ? null : Number(reportingLabourHourlyRate?.value),
      currency:reportingCurrency?.value || reportingCurrencyActive
    })});
    reportingCurrencyActive=reportingCurrency?.value || reportingCurrencyActive;
    // Refresh the library immediately after settings commit. A subsequent
    // catalogue refresh failure must never be reported as a failed save.
    window.dispatchEvent(new Event('pfc:library-pricing-updated'));
    if (reportingPricingStatus) reportingPricingStatus.textContent='Pricing saved. Current catalogue and library use '+reportingCurrencyActive+'. Currency changes do not convert amounts; review prices and hourly rates.';
    try {
      reportingFilamentsState=(await requestJson('/api/filaments')).filaments || [];
      renderFilamentCatalogue();
    } catch (refreshError) {
      if (reportingPricingStatus) reportingPricingStatus.textContent+=' Refresh the filament list to see updated currency labels.';
    }
  } catch(error) {
    if (reportingPricingStatus) reportingPricingStatus.textContent='';
    if (reportingPricingError) {
      reportingPricingError.textContent=error.message;
      reportingPricingError.classList.remove('hidden');
    }
  } finally {
    reportingPricingSaving=false;
    reportingPricingFields.disabled=false;
    if (reportingPricingSaveBtn) reportingPricingSaveBtn.disabled=false;
  }
});

filamentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = filamentId?.value || '';
  if (filamentSubmitBtn) filamentSubmitBtn.disabled = true;
  if (filamentError) { filamentError.textContent = ''; filamentError.classList.add('hidden'); }
  try {
    const payload = {
      material:filamentMaterial?.value || '',
      brand:filamentBrand?.value || '',
      product:filamentProduct?.value || '',
      colour:filamentColour?.value || '',
      costPerKg:Number(filamentCost?.value)
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
