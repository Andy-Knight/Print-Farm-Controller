import { render } from 'preact';
import { UiButton, UiTab } from './components.jsx';

const REPORT_TABS = Object.freeze([
  { key:'analytics', icon:'chart', label:'Analytics', id:'reportingTabAnalytics', panel:'reportingPanelAnalytics' },
  { key:'filament', icon:'spool', label:'Filament cost catalogue', id:'reportingTabFilament', panel:'reportingPanelFilament' },
  { key:'pricing', icon:'sliders', label:'Pricing settings', id:'reportingTabPricing', panel:'reportingPanelPricing' }
]);

function dispatchReportingAction(type, value = '') {
  window.dispatchEvent(new CustomEvent('pfc:reporting-action', { detail:{ type, value } }));
}

function ReportingTabs({ activeTab }) {
  return <>
    {REPORT_TABS.map((tab, index) => {
      const active = tab.key === activeTab;
      const onKeyDown = (event) => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? REPORT_TABS.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + REPORT_TABS.length) % REPORT_TABS.length;
        const next = REPORT_TABS[nextIndex];
        dispatchReportingAction('tab', next.key);
        requestAnimationFrame(() => document.querySelector(`[data-reporting-tab="${next.key}"]`)?.focus());
      };
      return <UiTab
        icon={tab.icon}
        key={tab.key}
        id={tab.id}
        class={`maintenance-view-button${active ? ' active' : ''}`}
        data-reporting-tab={tab.key}
        role="tab"
        aria-selected={active ? 'true' : 'false'}
        aria-controls={tab.panel}
        tabindex={active ? 0 : -1}
        onClick={() => dispatchReportingAction('tab', tab.key)}
        onKeyDown={onKeyDown}
      >{tab.label}</UiTab>;
    })}
  </>;
}

function ReportingKpiSymbol({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
    {name === 'jobs' && <><rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" /></>}
    {name === 'check' && <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />}
    {name === 'cross' && <path d="M6 6l12 12M18 6 6 18" />}
    {name === 'clock' && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>}
  </svg>;
}

function ReportingKpis({ items }) {
  return <>{items.map((item) => {
    const progress = item.progressPercent;
    const hasRate = progress != null;
    const tone = ['info','positive','negative'].includes(item.tone) ? item.tone : 'info';
    return <div class={`reporting-kpi reporting-kpi-${tone}`} key={item.label}>
      <span class={`reporting-kpi-gauge${hasRate ? '' : ' reporting-kpi-gauge-neutral'}`}
        style={{'--reporting-kpi-angle':`${hasRate ? progress * 3.6 : 0}deg`}} aria-hidden="true">
        <span class="reporting-kpi-icon"><ReportingKpiSymbol name={item.iconName} /></span>
      </span>
      <div class="reporting-kpi-body">
        <span class="reporting-kpi-label">{item.label}</span>
        <strong>{item.value}</strong>
        <small>{item.detail}</small>
        {hasRate ? <div class="reporting-kpi-meter" role="progressbar"
          aria-label={item.progressLabel} aria-valuemin="0" aria-valuemax="100"
          aria-valuenow={progress}>
          <span style={{width:`${progress}%`}}></span>
        </div> : <span class="reporting-kpi-accent" aria-hidden="true"></span>}
      </div>
      <div class={`reporting-kpi-change reporting-kpi-change-${item.change?.tone || 'muted'}`}
        aria-label={item.change?.description || 'No previous period data'}
        title={item.change?.description || 'No previous period data'}>
        <strong class="reporting-kpi-change-value">
          {item.change?.symbol && <span aria-hidden="true">{item.change.symbol}</span>}
          {item.change?.label || '—'}
        </strong>
        <span class="reporting-kpi-change-caption">{item.change?.caption || 'No previous period data'}</span>
      </div>
    </div>;
  })}</>;
}

function ReportingTrend({ chart }) {
  if (!chart.rows.length) return <div class="reporting-empty">No completed reporting history in this period.</div>;
  return <>
    <div class="reporting-chart-legend">
      <span><i class="reporting-legend-dot completed"></i>Completed</span>
      <span><i class="reporting-legend-dot failed"></i>Failed</span>
      <span><i class="reporting-legend-dot cancelled"></i>Cancelled</span>
    </div>
    <svg class="reporting-line-chart" viewBox={chart.viewBox} role="img" aria-label="Daily print outcomes">
      {chart.grid.map((line, index) => <g key={index}>
        <line x1={line.x1} y1={line.y} x2={line.x2} y2={line.y} class="reporting-grid-line" />
        <text x={line.labelX} y={line.labelY} text-anchor="end" class="reporting-axis-text">{line.label}</text>
      </g>)}
      <path d={chart.completedPath} class="reporting-series completed" />
      <path d={chart.failedPath} class="reporting-series failed" />
      <path d={chart.cancelledPath} class="reporting-series cancelled" />
      {(chart.points || []).map((point, index) => <g key={point.date + '-' + point.key + '-' + index}>
        <circle cx={point.x} cy={point.y} r="4.5" class={`reporting-point ${point.key}`}>
          <title>{point.title}</title>
        </circle>
        {chart.showPointValues &&
          <text x={point.x} y={Math.max(11, point.y - 10)} text-anchor="middle"
            class={`reporting-point-value ${point.key}`}>{point.value}</text>}
      </g>)}
      {chart.labels.map((label, index) =>
        <text key={index} x={label.x} y={label.y} text-anchor="middle" class="reporting-axis-text">{label.text}</text>
      )}
    </svg>
  </>;
}

function ReportingTable({ headers, rows, empty, footer = null, label = 'Analytics table' }) {
  if (!rows.length) return <div class="reporting-empty">{empty}</div>;
  return <div class="reporting-table-scroll" tabindex="0" role="region" aria-label={label}>
    <table class="reporting-analytics-table">
      <thead><tr>{headers.map((header, index) => <th key={index} scope="col" class={header.numeric ? 'numeric' : ''}>{header.label}</th>)}</tr></thead>
      <tbody>{rows}</tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  </div>;
}

function ReportFileIdentity({ file }) {
  return <div class="reporting-file-identity">
    <span class="reporting-thumbnail">
      {file.previewUrl
        ? <img src={file.previewUrl} alt="" loading="lazy" />
        : <span class="reporting-thumbnail-empty" aria-hidden="true">◇</span>}
    </span>
    {file.libraryFileId
      ? <button type="button" class="reporting-file-link" data-reporting-open-file={file.libraryFileId}
        title="Open Print Library details">{file.fileName}</button>
      : <span class="reporting-file-plain" title="This file is not in the Print Library">{file.fileName}</span>}
  </div>;
}

function ReportingProgress({ percent }) {
  return <div class="reporting-progress" role="img" aria-label={String(percent) + '% of total'}>
    <span style={{ width:String(percent) + '%' }}></span>
  </div>;
}

function ReportFiles({ files, sort }) {
  const headings = [
    { label:'#' }, { label:<button type="button" class="reporting-table-sort" data-reporting-file-sort="fileName"
      aria-label="Sort by file name" aria-pressed={sort.key === 'fileName'}>
      Print file {sort.key === 'fileName' ? (sort.direction === 'desc' ? '▼' : '▲') : '↕'}
    </button> },
    ...[
      ['completed','Completed'], ['failed','Failed'], ['successRate','Success rate']
    ].map(([key,label]) => ({
      numeric:true,
      label:<button type="button" class="reporting-table-sort" data-reporting-file-sort={key}
        aria-label={'Sort by ' + label.toLowerCase()} aria-pressed={sort.key === key}>
        {label} {sort.key === key ? (sort.direction === 'desc' ? '▼' : '▲') : '↕'}
      </button>
    })),
    { numeric:true, label:<button type="button" class="reporting-table-sort" data-reporting-file-sort="materialGrams"
      aria-label="Sort by material usage" aria-pressed={sort.key === 'materialGrams'}>
      Material {sort.key === 'materialGrams' ? (sort.direction === 'desc' ? '▼' : '▲') : '↕'}
    </button> },
    { numeric:true, label:<button type="button" class="reporting-table-sort" data-reporting-file-sort="materialCost"
      title="Historical costs are sorted within currency groups, without currency conversion"
      aria-label="Sort by historical material cost, grouped by currency" aria-pressed={sort.key === 'materialCost'}>
      Cost {sort.key === 'materialCost' ? (sort.direction === 'desc' ? '▼' : '▲') : '↕'}
    </button> },
    { numeric:true,label:<button type="button" class="reporting-table-sort" data-reporting-file-sort="runSeconds"
      aria-label="Sort by total print time" aria-pressed={sort.key === 'runSeconds'}>
      Print time {sort.key === 'runSeconds' ? (sort.direction === 'desc' ? '▼' : '▲') : '↕'}
    </button> }
  ];
  return <ReportingTable label="Most popular print files" headers={headings} empty="No completed print files for the selected period."
    rows={files.map((file) => <tr key={file.id}>
      <td>{file.rank}</td><td><ReportFileIdentity file={file} /></td>
      <td class="numeric">{file.completed}</td><td class="numeric">{file.failed}</td>
      <td class="numeric">{file.successRate}</td>
      <td class="numeric reporting-file-material" title={file.materialTitle}>
        {file.materialText}{file.materialPartial && <small>partial</small>}
      </td>
      <td class="numeric reporting-file-cost" title={file.costTitle}>
        {file.materialCostText}{file.materialCostPartial && <small>partial</small>}
      </td>
      <td class="numeric reporting-file-time" title={file.printTimeTitle}>
        {file.printTime}{file.printTimePartial && <small>partial</small>}
      </td>
    </tr>)}/>;
}

function ReportMaterials({ materials, materialMode }) {
  const headings = [
    { label:materialMode === 'type' ? 'Material type' : 'Filament' },
    { label:'Used (kg)', numeric:true }, { label:'Share', numeric:true },
    { label:'Estimated cost', numeric:true }, { label:'Usage' }
  ];
  return <ReportingTable label="Material usage" headers={headings} empty="No material usage captured for completed prints in this period."
    rows={materials.rows.map((row) => <tr key={row.key}>
      <td title={row.note || row.label}>{row.label}</td><td class="numeric">{row.kg}</td>
      <td class="numeric">{row.percentage}</td><td class="numeric">{row.cost}</td>
      <td><ReportingProgress percent={row.percent} /></td>
    </tr>)}
    footer={<tr class="reporting-total-row"><th scope="row">Total</th>
      <td class="numeric">{materials.totalKg}</td><td class="numeric">100%</td>
      <td class="numeric">{materials.totalCost}</td><td></td>
    </tr>}/>;
}

function ProblemPrinters({ printers, hasActivity }) {
  if (!printers.length) return <div class="reporting-empty">{hasActivity
    ? 'No printers currently need attention. No printers have exceeded the failure thresholds during the selected reporting period.'
    : 'No printer activity in this period.'}</div>;
  return <ReportingTable label="Printers needing attention" headers={[
    { label:'Printer' }, { label:'Attempts', numeric:true },
    { label:'Completed', numeric:true }, { label:'Failed', numeric:true },
    { label:'Failure rate', numeric:true }, { label:'Trend' }, { label:'Last failure' }
  ]} rows={printers.map((printer) => <tr key={printer.id}>
    <th scope="row" title={printer.attention.join('; ')}>{printer.name}</th>
    <td class="numeric">{printer.attempts}</td><td class="numeric">{printer.completed}</td>
    <td class="numeric">{printer.failed}</td>
    <td class="numeric reporting-failure-value">{printer.failureRate}</td>
    <td>{printer.trend}</td><td>{printer.latestFailure}</td>
  </tr>)} />;
}

function FileFailures({ files }) {
  return <ReportingTable label="Print file failure analysis" headers={[
    { label:'Print file' }, { label:'Attempts', numeric:true },
    { label:'Failed', numeric:true }, { label:'Failure rate', numeric:true },
    { label:'Last failure' }
  ]} empty="No failed print files for the selected period."
    rows={files.map((file) => <tr key={file.id}>
      <td><ReportFileIdentity file={file} /></td>
      <td class="numeric">{file.attempts}</td><td class="numeric">{file.failed}</td>
      <td class="numeric reporting-failure-value">{file.failureRate}</td>
      <td>{file.lastFailure}</td>
    </tr>)} />;
}

function FilamentCatalogue({ items, canManage }) {
  if (!items.length) return <div class="reporting-empty">No filament costs configured yet.{canManage && ' Add a material and its current cost per kg.'}</div>;
  return <>{items.map((item) => <div class="filament-cost-row" key={item.id}>
    <div>
      <strong>{item.label}</strong>
      <div class="subtle">{item.detail}</div>
    </div>
    <div class="filament-cost-price"><b>{item.price}</b><span>per kg</span></div>
    {canManage && <div class="mini-actions">
      <UiButton variant="secondary" data-filament-edit={item.id}>Edit</UiButton>
      <UiButton variant="danger" data-filament-delete={item.id}>Delete</UiButton>
    </div>}
  </div>)}</>;
}

function normalizeState(detail = {}) {
  return {
    activeTab:['analytics','filament','pricing'].includes(detail.activeTab) ? detail.activeTab : 'analytics',
    kpis:Array.isArray(detail.kpis) ? detail.kpis : [],
    chart:detail.chart || { rows:[], grid:[], labels:[], viewBox:'0 0 760 230', completedPath:'', failedPath:'', cancelledPath:'' },
    printers:Array.isArray(detail.printers) ? detail.printers : [],
    printerActivity:detail.printerActivity === true,
    files:Array.isArray(detail.files) ? detail.files : [],
    fileFailures:Array.isArray(detail.fileFailures) ? detail.fileFailures : [],
    fileScope:detail.fileScope === 'all' ? 'all' : 'top10',
    fileSort:detail.fileSort || { key:'completed', direction:'desc' },
    materials:detail.materials && Array.isArray(detail.materials.rows)
      ? detail.materials : { rows:[], totalKg:'0.00', totalCost:'—' },
    materialMode:detail.materialMode === 'filament' ? 'filament' : 'type',
    filaments:Array.isArray(detail.filaments) ? detail.filaments : [],
    canManageFilaments:detail.canManageFilaments === true
  };
}

export function initReportingUi() {
  const tabsRoot = document.querySelector('#reportingDialog .reporting-tabs');
  const kpisRoot = document.querySelector('#reportingKpis');
  const trendRoot = document.querySelector('#reportingTrend');
  const printersRoot = document.querySelector('#reportingPrinters');
  const filesRoot = document.querySelector('#reportingFiles');
  const materialsRoot = document.querySelector('#reportingMaterials');
  const fileFailuresRoot = document.querySelector('#reportingFileFailures');
  const filamentRoot = document.querySelector('#filamentList');
  if (!tabsRoot || !kpisRoot || !trendRoot || !printersRoot || !filesRoot || !materialsRoot || !fileFailuresRoot || !filamentRoot) return;

  let state = normalizeState(window.__PFC_REPORTING_UI_STATE__ || {});
  const renderAll = () => {
    render(<ReportingTabs activeTab={state.activeTab} />, tabsRoot);
    render(<ReportingKpis items={state.kpis} />, kpisRoot);
    render(<ReportingTrend chart={state.chart} />, trendRoot);
    render(<ProblemPrinters printers={state.printers} hasActivity={state.printerActivity} />, printersRoot);
    render(<ReportFiles files={state.files} sort={state.fileSort} />, filesRoot);
    render(<ReportMaterials materials={state.materials} materialMode={state.materialMode} />, materialsRoot);
    render(<FileFailures files={state.fileFailures} />, fileFailuresRoot);
    render(<FilamentCatalogue items={state.filaments} canManage={state.canManageFilaments} />, filamentRoot);
  };
  window.addEventListener('pfc:reporting-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });
  renderAll();
  window.__PFC_PREACT_REPORTING__ = true;
}
