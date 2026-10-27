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
let reportingMaterialMode = 'filament';
// Legacy mode has no identity; once signed in, only administrators may edit
// the central filament cost catalogue. Operator printer assignments are separate.
const canManageFilamentCatalogue = () => !document.body.dataset.authRole || document.body.dataset.authRole === 'administrator';

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

function chartTimelineRows(rows = [], range = null) {
  if (!rows.length) return [];
  const start = Date.parse(range?.from || '');
  const finish = Date.parse(range?.to || '');
  const day = 24 * 60 * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return rows;
  const startDay = Math.floor(start / day) * day;
  const endDay = Math.floor(finish / day) * day;
  const dayCount = Math.round((endDay - startDay) / day) + 1;
  // The UI offers at most 365 days; don't create unbounded graph series
  // for malformed or unexpectedly large custom report ranges.
  if (dayCount < 2 || dayCount > 370) return rows;
  const byDate = new Map(rows.map((row) => [String(row.date), row]));
  return Array.from({ length:dayCount }, (_, index) => {
    const date = new Date(startDay + index * day).toISOString().slice(0, 10);
    return { date, completed:0, failed:0, cancelled:0, ...(byDate.get(date) || {}) };
  });
}

function lineChartViewModel(rows = [], range = null) {
  const timeline = chartTimelineRows(rows, range);
  if (!timeline.length) {
    return { rows:[], grid:[], labels:[], points:[], showPointValues:false,
      viewBox:'0 0 760 230', completedPath:'', failedPath:'', cancelledPath:'' };
  }
  const width = 760;
  const height = 230;
  const pad = { left:42, right:18, top:18, bottom:34 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxY = Math.max(1, ...timeline.flatMap((row) => [
    Number(row.completed || 0), Number(row.failed || 0), Number(row.cancelled || 0)
  ]));
  // Use whole-number Y-axis ticks for whole print counts, without repeating
  // labels (e.g. 0, 1, 2, 2, 3 for a maximum of three prints).
  const step = maxY <= 4 ? 1 : Math.ceil(maxY / 4);
  const axisMax = Math.ceil(maxY / step) * step;
  const x = (index) => pad.left + (timeline.length === 1
    ? chartW / 2 : (index / (timeline.length - 1)) * chartW);
  const y = (value) => pad.top + chartH - (Number(value || 0) / axisMax) * chartH;
  const path = (key) => timeline.map((row, index) =>
    `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(row[key]).toFixed(1)}`
  ).join(' ');
  const tickIndexes = [...new Set([0, Math.floor((timeline.length - 1) / 2), timeline.length - 1])];
  const series = ['completed','failed','cancelled'];
  const points = timeline.flatMap((row, index) => series.flatMap((key) => {
    const value = Number(row[key] || 0);
    return value > 0 ? [{
      key, date:row.date, value, x:Number(x(index).toFixed(1)),
      y:Number(y(value).toFixed(1)), title:`${row.date}: ${value} ${key}`
    }] : [];
  }));
  return {
    rows:timeline,
    viewBox:`0 0 ${width} ${height}`,
    completedPath:path('completed'),
    failedPath:path('failed'),
    cancelledPath:path('cancelled'),
    points,
    showPointValues:points.length <= 8,
    grid:Array.from({ length:Math.floor(axisMax / step) + 1 }, (_, index) => {
      const value = index * step;
      const yy = y(value);
      return { x1:pad.left, x2:width - pad.right, y:yy, labelX:pad.left - 8,
        labelY:yy + 4, label:value };
    }),
    labels:tickIndexes.map((index) => ({
      x:x(index),
      y:height - 9,
      text:timeline[index]?.date
        ? new Date(`${timeline[index].date}T00:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric' })
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


function reportingFileDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  const minutes = Math.round(value / 60);
  if (value > 0 && minutes === 0) return '<1m';
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${minutes}m`;
}

function reportingFileCostSort(item) {
  const entries = Object.entries(item?.spendByCurrency || {})
    .filter(([currency, amount]) => currency && Number.isFinite(Number(amount)));
  // Historical currencies are never converted into a guessed global amount.
  return entries.length === 1 && Number(item?.costedPrints || 0) > 0
    ? { currency:entries[0][0], amount:Number(entries[0][1]) } : null;
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
    if (sortKey === 'materialCost') {
      const left = reportingFileCostSort(a);
      const right = reportingFileCostSort(b);
      // Unknown/mixed-currency costs last; single-currency records are
      // grouped by currency code before their amounts are compared.
      if (!left || !right) {
        if (!left && right) return 1;
        if (left && !right) return -1;
      } else {
        const currencyOrder = left.currency.localeCompare(right.currency);
        if (currencyOrder !== 0) return currencyOrder;
        const difference = left.amount - right.amount;
        if (difference) return direction === 'asc' ? difference : -difference;
      }
    } else {
      const metric = (item) => {
        if (sortKey === 'successRate') return filePrintRate(item);
        if (sortKey === 'materialGrams')
          return Number(item.materialUsageRecordedCount || 0) || Number(item.materialGrams || 0) > 0
            ? Number(item.materialGrams || 0) : null;
        if (sortKey === 'runSeconds')
          return Number(item.runTimeRecordedCount || 0) > 0 ? Number(item.runSeconds || 0) : null;
        return Number(item[sortKey] || 0);
      };
      const left = metric(a);
      const right = metric(b);
      if (left == null || right == null) {
        if (left == null && right != null) return 1;
        if (left != null && right == null) return -1;
      } else {
        const difference = left - right;
        if (difference) return direction === 'asc' ? difference : -difference;
      }
    }
    return Number(b.completed || 0) - Number(a.completed || 0)
      || String(a.fileName || '').localeCompare(String(b.fileName || ''));
  });
  return (failures ? sorted.slice(0, 5)
    : reportingFilesScope === 'all' ? sorted : sorted.slice(0, 10))
    .map((item) => {
      const completed = Number(item.completed || 0);
      const grams = Number(item.materialGrams || 0);
      const materialRecorded = Number(item.materialUsageRecordedCount || 0);
      const materialAvailable = materialRecorded > 0 || grams > 0;
      const costed = Number(item.costedPrints || 0);
      const timeRecorded = Number(item.runTimeRecordedCount || 0);
      const timeEligible = Number(item.runTimeEligibleCount || 0);
      const rawSeconds = Number(item.runSeconds || 0);
      const timeAvailable = timeRecorded > 0;
      const costAvailable = costed > 0;
      return {
        id:String(item.libraryFileId || item.fileName || item.rank),
        rank:item.rank,
        fileName:String(item.fileName || 'Unknown file'),
        libraryFileId:item.libraryFileId ? String(item.libraryFileId) : null,
        previewUrl:String(item.previewUrl || ''),
        attempts:Number(item.attempts || 0),
        completed,
        failed:Number(item.failed || 0),
        successRate:filePrintRate(item) == null ? '—' : `${formatNumber(filePrintRate(item) * 100, 1)}%`,
        failureRate:filePrintRate(item, 'failed') == null ? '—' : `${formatNumber(filePrintRate(item, 'failed') * 100, 1)}%`,
        materialText:materialAvailable ? `${formatNumber(grams / 1000, 2)} kg` : '—',
        materialPartial:materialAvailable && materialRecorded < completed,
        materialCostText:costAvailable ? formatCurrencyTotals(item.spendByCurrency) : '—',
        materialCostPartial:costAvailable && costed < completed,
        materialTitle:materialAvailable
          ? `Material usage recorded for ${materialRecorded} of ${completed} completed prints`
          : 'No reliable material usage recorded for completed prints',
        costTitle:costAvailable
          ? `Complete material costs recorded for ${costed} of ${completed} completed prints. Historical currencies are not converted.`
          : 'No complete material cost snapshots recorded for completed prints',
        printTime:timeAvailable ? reportingFileDuration(rawSeconds) : '—',
        printTimePartial:timeAvailable && timeRecorded < timeEligible,
        printTimeTitle:timeAvailable
          ? `Recorded printer run time for ${timeRecorded} of ${timeEligible} physical print attempts, including failed or started-cancelled jobs`
          : 'No printer run duration recorded',
        lastFailure:formatReportingDate(item.lastFailedAt)
      };
    });
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

// Filament colours come from the current catalogue, not historical print
// snapshots. Accept only known colour words or hex RGB values: user-entered
// catalogue descriptions must never become arbitrary CSS.
function reportingFilamentBarColour(value) {
  const colour=String(value || '').trim().toLowerCase();
  const names={
    black:'#344252',white:'#f0f5fa',red:'#dc5964',orange:'#e99549',
    yellow:'#e2c258',green:'#4dbd8b',blue:'#4997d7',purple:'#ae82df',
    violet:'#ae82df',pink:'#e88fb5',grey:'#8999a8',gray:'#8999a8',
    silver:'#a9b6c1',brown:'#a67559',cyan:'#4fb9c9',
    gold:'#d4b767',natural:'#e5dfc8'
  };
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(colour)) return colour;
  return names[colour] || 'var(--ds-brand-strong)';
}

function reportingPiePath(start, end) {
  const at = (portion) => {
    const radians = portion * Math.PI * 2 - Math.PI / 2;
    return `${(100 + 90 * Math.cos(radians)).toFixed(4)} ${(100 + 90 * Math.sin(radians)).toFixed(4)}`;
  };
  return `M 100 100 L ${at(start)} A 90 90 0 ${end - start > 0.5 ? 1 : 0} 1 ${at(end)} Z`;
}

function reportingMaterialRows(materials = [], catalogue = []) {
  const groupByType = reportingMaterialMode === 'type';
  const groups = new Map();
  const catalogueById=new Map((catalogue || []).map(item=>[String(item.id || ''),item]));
  for (const entry of materials) {
    const type = String(entry.material || 'Unknown material').trim().toUpperCase();
    const display = groupByType ? { label:type, note:'' } : reportingFilamentLabel(entry, type);
    const key = groupByType ? type : String(entry.filamentId || entry.label || type);
    if (!groups.has(key)) groups.set(key, { key, ...display, grams:0, spendByCurrency:{},
      barColour:groupByType ? 'var(--ds-brand-strong)'
        : reportingFilamentBarColour(catalogueById.get(String(entry.filamentId || ''))?.colour)
    });
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
  let accumulated = 0;
  return {
    rows:ordered.map((row, index) => {
      const pieStart = accumulated / total;
      accumulated += row.grams;
      const pieEnd = Math.min(1, accumulated / total);
      return {
      key:row.key,
      label:row.label,
      note:row.note,
      kg:formatNumber(row.grams / 1000, row.grams < 10 ? 3 : 2),
      percentage:total > 0 ? `${formatNumber(row.grams * 100 / total, 1)}%` : '—',
      percent:total > 0 ? Number((row.grams * 100 / total).toFixed(1)) : 0,
      barPercent:ordered[0]?.grams > 0 ? Number((row.grams * 100 / ordered[0].grams).toFixed(2)) : 0,
      barColour:row.barColour,
      pieColour:row.barColour === 'var(--ds-brand-strong)'
        ? `var(--reporting-pie-${index % 8 + 1})` : row.barColour,
      pieFull:ordered.length === 1,
      piePath:ordered.length === 1 ? '' : reportingPiePath(pieStart, pieEnd),
      cost:formatCurrencyTotals(row.spendByCurrency)
    }; }),
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

function reportingKpiSvg(name) {
  const paths = {
    jobs:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    check:'<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    cross:'<path d="M6 6l12 12M18 6 6 18"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    scale:'<path d="M4 4h16M7 4v4h10V4"/><rect x="3" y="9" width="18" height="12" rx="2.5"/><path d="M8 17a4 4 0 0 1 8 0M12 17l2-2"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
      ${paths[name] || paths.jobs}</svg>`;
}

function reportingPreviousPeriodChange(current, previous, hasPrevious, measure) {
  if (!hasPrevious) return {
    symbol:'', label:'—', caption:'No previous period data',
    description:'No previous period data for the selected printer filters', tone:'muted'
  };
  const now = Number(current);
  const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return {
    symbol:'', label:'—', caption:'Comparison unavailable',
    description:'Unable to compare this statistic with the previous period', tone:'muted'
  };
  const direction = now > before ? 'up' : now < before ? 'down' : 'flat';
  const beneficial = measure === 'completed' ? direction === 'up'
    : measure === 'failed' ? direction === 'down' : null;
  const tone = direction === 'flat' ? 'muted'
    : beneficial === true ? 'positive'
    : beneficial === false ? 'negative' : 'neutral';
  const symbol = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—';
  const label = direction === 'flat' ? '0.0%'
    : before === 0 ? 'From 0'
    : `${formatNumber(Math.abs((now - before) / before * 100), 1)}%`;
  const summary = direction === 'flat' ? 'No change'
    : `${direction === 'up' ? 'Increase' : 'Decrease'} ${before === 0 ? 'from zero' : 'of ' + label}`;
  return { symbol, label, caption:'vs previous period',
    description:`${summary} vs previous period`, tone };
}

function reportingKpiViewModel(report = {}) {
  const totals = report?.totals || {};
  const previous = report?.previousTotals || {};
  const hasPrevious = Number(previous.attempts || 0) > 0;
  // The reporting service tallies material grams only for completed jobs,
  // including older entries that have weight but no identifiable filament.
  const recordedGrams=Number(totals.materialGrams);
  const hasCompletedPrints=Number(totals.completed || 0) > 0;
  const hasRecordedUsage=!hasCompletedPrints || (Number.isFinite(recordedGrams) && recordedGrams > 0);
  const materialValue=hasRecordedUsage
    ? `${formatNumber((Number.isFinite(recordedGrams) ? recordedGrams : 0) / 1000, 2)} kg` : '—';
  const previousGrams=Number(previous.materialGrams);
  const previousUsageKnown=Number.isFinite(previousGrams) && previousGrams >= 0
    && (previousGrams > 0 || Number(previous.completed || 0) === 0);
  const materialChange=hasRecordedUsage && hasPrevious && previousUsageKnown
    ? reportingPreviousPeriodChange(Number.isFinite(recordedGrams) ? recordedGrams : 0,previousGrams,true,'neutral')
    : reportingPreviousPeriodChange(0,0,false,'neutral');
  const change = (key, measure = key) =>
    reportingPreviousPeriodChange(totals[key] || 0, previous[key] || 0, hasPrevious, measure);
  // Only measured completion/failure rates receive progress meters.
  // Job totals and machine hours have no meaningful 0–100% target.
  const percent = (rate) => {
    const number = rate == null ? NaN : Number(rate);
    return Number(totals.attempts || 0) > 0 && Number.isFinite(number)
      ? Math.round(Math.max(0, Math.min(1, number)) * 1000) / 10
      : null;
  };
  return [
    { label:'Total print jobs', value:formatNumber(totals.attempts), detail:'In selected period', icon:'▤', iconName:'jobs', tone:'info', progressPercent:null, change:change('attempts','neutral') },
    { label:'Completed', value:formatNumber(totals.completed), detail:`${formatPercent(totals.completionRate)} completion rate`, icon:'✓', iconName:'check', tone:Number(totals.completed || 0) > 0 ? 'positive' : 'info', progressPercent:percent(totals.completionRate), progressLabel:'Completion rate', change:change('completed') },
    { label:'Failed', value:formatNumber(totals.failed), detail:`${formatPercent(totals.failureRate)} failure rate`, icon:'×', iconName:'cross', tone:'negative', progressPercent:percent(totals.failureRate), progressLabel:'Failure rate', change:change('failed') },
    { label:'Total run time', value:`${formatNumber(totals.runHours, 1)} h`, detail:'Reported from print timestamps', icon:'◷', iconName:'clock', tone:'info', progressPercent:null, change:change('runHours','neutral') },
    { label:'Total filament used', value:materialValue, detail:hasRecordedUsage ? 'Recorded for completed prints' : 'No recorded material usage', iconName:'scale', tone:'info', progressPercent:null, change:materialChange }
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
    chart:lineChartViewModel(report?.daily || [], report?.range),
    printers:reportingPrintersViewModel(report?.printers || []),
    printerActivity:(report?.printers || []).length > 0,
    files:reportingFileRows(report?.files || []),
    fileFailures:reportingFileRows(report?.files || [], { failures:true }),
    fileScope:reportingFilesScope,
    fileSort:reportingFilesSort,
    materials:reportingMaterialRows(report?.materials || [], reportingFilamentsState),
    materialMode:reportingMaterialMode,
    filaments:reportingFilamentsViewModel(),
    canManageFilaments:canManageFilamentCatalogue()
  };
  window.__PFC_REPORTING_UI_STATE__ = detail;
  window.dispatchEvent(new CustomEvent('pfc:reporting-ui-state', { detail }));
}

function lineChartSvg(rows = [], range = null) {
  const chart = lineChartViewModel(rows, range);
  if (!chart.rows.length) return '<div class="reporting-empty">No completed reporting history in this period.</div>';
  const grid = chart.grid.map((line) => `<line x1="${line.x1}" y1="${line.y}" x2="${line.x2}" y2="${line.y}" class="reporting-grid-line"/>
      <text x="${line.labelX}" y="${line.labelY}" text-anchor="end" class="reporting-axis-text">${line.label}</text>`).join('');
  const labels = chart.labels.map((label) =>
    `<text x="${label.x}" y="${label.y}" text-anchor="middle" class="reporting-axis-text">${escapeHtml(label.text)}</text>`
  ).join('');
  const points = chart.points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4.5" class="reporting-point ${point.key}">
      <title>${escapeHtml(point.title)}</title>
    </circle>${chart.showPointValues
      ? `<text x="${point.x}" y="${Math.max(11,point.y - 10)}" text-anchor="middle" class="reporting-point-value ${point.key}">${point.value}</text>`
      : ''}`).join('');
  return `<div class="reporting-chart-legend">
      <span><i class="reporting-legend-dot completed"></i>Completed</span>
      <span><i class="reporting-legend-dot failed"></i>Failed</span>
      <span><i class="reporting-legend-dot cancelled"></i>Cancelled</span>
    </div>
    <svg class="reporting-line-chart" viewBox="${chart.viewBox}" role="img" aria-label="Daily print outcomes">
      ${grid}
      <path d="${chart.completedPath}" class="reporting-series completed"/>
      <path d="${chart.failedPath}" class="reporting-series failed"/>
      <path d="${chart.cancelledPath}" class="reporting-series cancelled"/>
      ${points}
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
      ['completed','Completed'], ['failed','Failed']
    ].map(([key,label]) => ({
      label,
      numeric:true,
      html:`<button type="button" class="reporting-table-sort" data-reporting-file-sort="${key}" aria-label="Sort by ${label.toLowerCase()}" aria-pressed="${reportingFilesSort.key === key}">${label} ${reportingFilesSort.key === key ? (reportingFilesSort.direction === 'desc' ? '▼' : '▲') : '↕'}</button>`
    })),
    { label:'Material', numeric:true, html:`<button type="button" class="reporting-table-sort" data-reporting-file-sort="materialGrams" aria-label="Sort by material usage" aria-pressed="${reportingFilesSort.key === 'materialGrams'}">Material ${reportingFilesSort.key === 'materialGrams' ? (reportingFilesSort.direction === 'desc' ? '▼' : '▲') : '↕'}</button>` },
    { label:'Cost', numeric:true, html:`<button type="button" class="reporting-table-sort" data-reporting-file-sort="materialCost" aria-label="Sort by historical material cost, grouped by currency" title="Historical costs are sorted within currency groups, without currency conversion" aria-pressed="${reportingFilesSort.key === 'materialCost'}">Cost ${reportingFilesSort.key === 'materialCost' ? (reportingFilesSort.direction === 'desc' ? '▼' : '▲') : '↕'}</button>` }
  ];
  return reportingTableShell(headings, files.map((file) => `<tr>
      <td>${file.rank}</td><td>${reportingFileNameHtml(file)}</td>
      <td class="numeric">${file.completed}</td><td class="numeric">${file.failed}</td>
      <td class="numeric reporting-file-material" title="${escapeHtml(file.materialTitle)}">
        ${escapeHtml(file.materialText)}${file.materialPartial ? '<small>partial</small>' : ''}</td>
      <td class="numeric reporting-file-cost" title="${escapeHtml(file.costTitle)}">
        ${escapeHtml(file.materialCostText)}${file.materialCostPartial ? '<small>partial</small>' : ''}</td>
    </tr>`),
    'No completed print files for the selected period.');
}

function renderReportMaterials(materials) {
  if (!materials.rows.length)
    return '<div class="reporting-empty">No material usage captured for completed prints in this period.</div>';
  const slices=materials.rows.map(row => row.pieFull
    ? `<circle cx="100" cy="100" r="90" style="fill:${escapeHtml(row.pieColour)}"><title>${escapeHtml(row.label)}: ${escapeHtml(row.kg)} kg (${escapeHtml(row.percentage)})</title></circle>`
    : `<path d="${escapeHtml(row.piePath)}" style="fill:${escapeHtml(row.pieColour)}"><title>${escapeHtml(row.label)}: ${escapeHtml(row.kg)} kg (${escapeHtml(row.percentage)})</title></path>`
  ).join('');
  const rows=materials.rows.map(row=>`<li class="reporting-usage-row">
    <span class="reporting-usage-swatch" style="background-color:${escapeHtml(row.pieColour)}" aria-hidden="true"></span>
    <div class="reporting-usage-description">
      <strong title="${escapeHtml(row.note || row.label)}">${escapeHtml(row.label)}</strong>
      <span class="reporting-usage-meta">Recorded cost: ${escapeHtml(row.cost)}</span>
    </div>
    <span class="reporting-usage-value">${escapeHtml(row.kg)} kg <small>${escapeHtml(row.percentage)}</small></span>
  </li>`).join('');
  return `<div class="reporting-usage-chart" role="region" aria-label="Filament used pie chart in kilograms" tabindex="0">
    <div class="reporting-usage-plot">
      <svg class="reporting-usage-pie" viewBox="0 0 200 200" role="img" aria-label="Proportion of recorded filament usage by group">
        <title>Recorded filament use by weight</title>${slices}
      </svg>
      <ol class="reporting-usage-rows" aria-label="Filament usage legend">${rows}</ol>
    </div>
    <div class="reporting-usage-total">
      <strong>Total filament used</strong><span>${escapeHtml(materials.totalKg)} kg</span>
      <small>Recorded cost: ${escapeHtml(materials.totalCost)}</small>
    </div>
  </div>`;
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
    reportingKpis.innerHTML = reportingKpiViewModel(report).map((item) => {
      const progress = item.progressPercent;
      const hasRate = progress != null;
      const safeTone = ['positive','negative','info'].includes(item.tone) ? item.tone : 'info';
      return `<div class="reporting-kpi reporting-kpi-${safeTone}">
        <span class="reporting-kpi-gauge${hasRate ? '' : ' reporting-kpi-gauge-neutral'}"
            style="--reporting-kpi-angle:${hasRate ? progress * 3.6 : 0}deg" aria-hidden="true">
          <span class="reporting-kpi-icon">${reportingKpiSvg(item.iconName)}</span>
        </span>
        <div class="reporting-kpi-body">
          <span class="reporting-kpi-label">${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          <small>${escapeHtml(item.detail)}</small>
          ${hasRate ? `<div class="reporting-kpi-meter" role="progressbar" aria-label="${escapeHtml(item.progressLabel)}"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
            <span style="width:${progress}%"></span></div>` : '<span class="reporting-kpi-accent" aria-hidden="true"></span>'}
        </div>
        <div class="reporting-kpi-change reporting-kpi-change-${escapeHtml(item.change?.tone || 'muted')}"
          aria-label="${escapeHtml(item.change?.description || 'No previous period data')}"
          title="${escapeHtml(item.change?.description || 'No previous period data')}">
          <strong class="reporting-kpi-change-value"><span aria-hidden="true">${escapeHtml(item.change?.symbol || '')}</span>${escapeHtml(item.change?.label || '—')}</strong>
          <span class="reporting-kpi-change-caption">${escapeHtml(item.change?.caption || 'No previous period data')}</span>
        </div>
      </div>`;
    }).join('');
  }
  if (reportingTrend) reportingTrend.innerHTML = lineChartSvg(report?.daily || [], report?.range);
  if (reportingPrinters) reportingPrinters.innerHTML = renderProblemPrinters(report?.printers || []);
  if (reportingFiles) reportingFiles.innerHTML = renderReportFiles(reportingFileRows(report?.files || []));
  if (reportingMaterials) reportingMaterials.innerHTML = renderReportMaterials(reportingMaterialRows(report?.materials || [], reportingFilamentsState));
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
  if (filamentForm) filamentForm.hidden = !canManageFilamentCatalogue();
  const readOnlyHelp=document.querySelector('#filamentReadOnlyHelp');
  if(readOnlyHelp)readOnlyHelp.hidden=canManageFilamentCatalogue();
  if (window.__PFC_PREACT_REPORTING__) {
    publishReportingUiState(currentReport || {});
    return;
  }
  const rows = reportingFilamentsState;
  if (!rows.length) {
    filamentList.innerHTML = '<div class="reporting-empty">No filament costs configured yet.' + (canManageFilamentCatalogue() ? ' Add a material and its current cost per kg.' : '') + '</div>';
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
    ${canManageFilamentCatalogue() ? `<div class="mini-actions">
      <button type="button" class="secondary" data-filament-edit="${escapeHtml(item.id)}">Edit</button>
      <button type="button" class="danger" data-filament-delete="${escapeHtml(item.id)}">Delete</button>
    </div>` : ''}
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
  else if (sort && ['fileName','completed','failed','successRate','materialGrams','materialCost','runSeconds'].includes(sort.dataset.reportingFileSort)) {
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
  if (!canManageFilamentCatalogue()) return;
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
  if (!canManageFilamentCatalogue()) return;
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
