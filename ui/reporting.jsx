import { render } from 'preact';
import { UiButton, UiTab } from './components.jsx';

const REPORT_TABS = Object.freeze([
  { key:'analytics', icon:'chart', label:'Analytics', id:'reportingTabAnalytics', panel:'reportingPanelAnalytics' },
  { key:'filament', icon:'spool', label:'Filament cost catalogue', id:'reportingTabFilament', panel:'reportingPanelFilament' },
  { key:'pricing', icon:'chart', label:'Pricing settings', id:'reportingTabPricing', panel:'reportingPanelPricing' }
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

function ReportingKpis({ items }) {
  return <>{items.map((item) => <div class="reporting-kpi" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</>;
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
      {chart.labels.map((label, index) =>
        <text key={index} x={label.x} y={label.y} text-anchor="middle" class="reporting-axis-text">{label.text}</text>
      )}
    </svg>
  </>;
}

function ProblemPrinters({ printers }) {
  if (!printers.length) return <div class="reporting-empty">No printer activity in this period.</div>;
  return <>{printers.map((printer) => <article class={`reporting-printer-row${printer.attention.length ? ' attention' : ''}`} key={printer.id}>
    <div>
      <strong>{printer.name}</strong>
      <div class="subtle">{printer.summary}</div>
      <div class="reporting-printer-trend">{printer.trend}</div>
    </div>
    <div class="reporting-printer-rate"><b>{printer.failureRate}</b><span>failure rate</span></div>
    {printer.attention.length ? <div class="reporting-attention-reasons">{printer.attention.map((reason) => <span key={reason}>{reason}</span>)}</div> : null}
  </article>)}</>;
}

function BarRows({ rows, emptyText }) {
  if (!rows.length) return <div class="reporting-empty">{emptyText}</div>;
  return <>{rows.map((row) => <div class="reporting-bar-row" key={row.key}>
    <div class="reporting-bar-heading">
      <strong title={row.label}>{row.label}</strong>
      <span>{row.detail}</span>
    </div>
    <div class="reporting-bar-track"><span style={{ width:`${row.percent}%` }}></span></div>
  </div>)}</>;
}

function FilamentCatalogue({ items }) {
  if (!items.length) return <div class="reporting-empty">No filament costs configured yet. Add a material and its current cost per kg.</div>;
  return <>{items.map((item) => <div class="filament-cost-row" key={item.id}>
    <div>
      <strong>{item.label}</strong>
      <div class="subtle">{item.detail}</div>
    </div>
    <div class="filament-cost-price"><b>{item.price}</b><span>per kg</span></div>
    <div class="mini-actions">
      <UiButton variant="secondary" data-filament-edit={item.id}>Edit</UiButton>
      <UiButton variant="danger" data-filament-delete={item.id}>Delete</UiButton>
    </div>
  </div>)}</>;
}

function normalizeState(detail = {}) {
  return {
    activeTab:['analytics','filament','pricing'].includes(detail.activeTab) ? detail.activeTab : 'analytics',
    kpis:Array.isArray(detail.kpis) ? detail.kpis : [],
    chart:detail.chart || { rows:[], grid:[], labels:[], viewBox:'0 0 760 230', completedPath:'', failedPath:'', cancelledPath:'' },
    printers:Array.isArray(detail.printers) ? detail.printers : [],
    files:Array.isArray(detail.files) ? detail.files : [],
    materials:Array.isArray(detail.materials) ? detail.materials : [],
    filaments:Array.isArray(detail.filaments) ? detail.filaments : []
  };
}

export function initReportingUi() {
  const tabsRoot = document.querySelector('#reportingDialog .reporting-tabs');
  const kpisRoot = document.querySelector('#reportingKpis');
  const trendRoot = document.querySelector('#reportingTrend');
  const printersRoot = document.querySelector('#reportingPrinters');
  const filesRoot = document.querySelector('#reportingFiles');
  const materialsRoot = document.querySelector('#reportingMaterials');
  const filamentRoot = document.querySelector('#filamentList');
  if (!tabsRoot || !kpisRoot || !trendRoot || !printersRoot || !filesRoot || !materialsRoot || !filamentRoot) return;

  let state = normalizeState(window.__PFC_REPORTING_UI_STATE__ || {});
  const renderAll = () => {
    render(<ReportingTabs activeTab={state.activeTab} />, tabsRoot);
    render(<ReportingKpis items={state.kpis} />, kpisRoot);
    render(<ReportingTrend chart={state.chart} />, trendRoot);
    render(<ProblemPrinters printers={state.printers} />, printersRoot);
    render(<BarRows rows={state.files} emptyText="No files were completed in this period." />, filesRoot);
    render(<BarRows rows={state.materials} emptyText="No costed material usage is available in this period." />, materialsRoot);
    render(<FilamentCatalogue items={state.filaments} />, filamentRoot);
  };
  window.addEventListener('pfc:reporting-ui-state', (event) => {
    state = normalizeState(event?.detail || {});
    renderAll();
  });
  renderAll();
  window.__PFC_PREACT_REPORTING__ = true;
}
