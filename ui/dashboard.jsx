import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Metric, ProgressBar, StatusBadge, ToastHost, UiButton } from './components.jsx';
import { initPrinterDetailsUi } from './printer-details.jsx';
import { initPrintQueueUi } from './print-queue.jsx';
import { initPrintLibraryUi } from './print-library.jsx';
import { initMaintenanceUi } from './maintenance.jsx';
import { initAlertsUi } from './alerts.jsx';
import { initReportingUi } from './reporting.jsx';

const FILTERS = Object.freeze([
  { key:'all', label:'All Printers' },
  { key:'online', label:'Online' },
  { key:'printing', label:'Printing' },
  { key:'attention', label:'Needs attention' }
]);

const DEFAULT_STATE = Object.freeze({
  counts:{ all:0, online:0, printing:0, attention:0 },
  activeFilter:'all',
  groups:[],
  groupId:'',
  viewMode:'cards'
});

function normalizeDashboardState(input = {}) {
  const counts = input.counts && typeof input.counts === 'object' ? input.counts : {};
  return {
    counts:{
      all:Number(counts.all || 0),
      online:Number(counts.online || 0),
      printing:Number(counts.printing || 0),
      attention:Number(counts.attention || 0)
    },
    activeFilter:[...FILTERS.map((item) => item.key), 'maintenance'].includes(input.activeFilter) ? input.activeFilter : 'all',
    groups:Array.isArray(input.groups) ? input.groups.map((group) => ({
      id:String(group?.id || ''),
      name:String(group?.name || ''),
      printerCount:Number(group?.printerCount || 0)
    })).filter((group) => group.id) : [],
    groupId:String(input.groupId || ''),
    viewMode:input.viewMode === 'table' ? 'table' : 'cards'
  };
}

function normalizeFleetState(input = {}) {
  return {
    printers:Array.isArray(input.printers) ? input.printers : []
  };
}

function dispatchDashboardAction(type, value = '') {
  window.dispatchEvent(new CustomEvent('pfc:dashboard-action', {
    detail:{ type, value }
  }));
}

function DashboardControls({ state }) {
  const tableView = state.viewMode === 'table';
  const groupsVisible = state.groups.length > 0;
  return (
    <section class="dashboard-controls" aria-label="Dashboard controls">
      <div
        id="dashboardGroupFilterBar"
        class={`dashboard-group-filter${groupsVisible ? '' : ' hidden'}`}
        aria-label="Dashboard printer group filter"
      >
        <label for="dashboardGroupFilter">Printer group</label>
        <select
          id="dashboardGroupFilter"
          value={state.groupId}
          onChange={(event) => dispatchDashboardAction('group', event.currentTarget.value)}
        >
          <option value="">All printers</option>
          {state.groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.printerCount})
            </option>
          ))}
        </select>
      </div>
      <div class="dashboard-view-control">
        <span class="dashboard-view-label">Dashboard view</span>
        <UiButton
          id="dashboardViewToggle"
          class="dashboard-view-toggle"
          variant="ghost"
          role="switch"
          aria-checked={String(tableView)}
          aria-label={`Switch dashboard to ${tableView ? 'card' : 'table'} view`}
          onClick={() => dispatchDashboardAction('view', tableView ? 'cards' : 'table')}
        >
          <span class="dashboard-view-toggle-track" aria-hidden="true"></span>
          <span class="dashboard-view-toggle-label">{tableView ? 'Table' : 'Cards'}</span>
        </UiButton>
      </div>
    </section>
  );
}

function DashboardSummary({ state }) {
  return (
    <section id="summary" class="summary">
      {FILTERS.map((item) => {
        const active = state.activeFilter === item.key;
        return (
          <UiButton
            key={item.key}
            variant="ghost"
            class={`summary-card${active ? ' active' : ''}`}
            data-dashboard-filter={item.key}
            aria-pressed={String(active)}
            onClick={() => dispatchDashboardAction('filter', item.key)}
          >
            <span class="summary-card-label"><span class="subtle">{item.label}</span><i aria-hidden="true"></i></span>
            <b>{state.counts[item.key]}</b>
          </UiButton>
        );
      })}
    </section>
  );
}

function DashboardOverview() {
  const [state, setState] = useState(() => normalizeDashboardState(window.__PFC_DASHBOARD_STATE__ || DEFAULT_STATE));

  useEffect(() => {
    const update = (event) => setState(normalizeDashboardState(event?.detail || window.__PFC_DASHBOARD_STATE__ || DEFAULT_STATE));
    window.addEventListener('pfc:dashboard-state', update);
    if (window.__PFC_DASHBOARD_STATE__) setState(normalizeDashboardState(window.__PFC_DASHBOARD_STATE__));
    return () => window.removeEventListener('pfc:dashboard-state', update);
  }, []);

  return (
    <>
      <DashboardControls state={state} />
      <DashboardSummary state={state} />
      <ToastHost />
    </>
  );
}

function MaintenanceIcon({ printer }) {
  const maintenance = printer.maintenance || {};
  return (
    <button
      type="button"
      class="maintenance-status-icon maintenance-status-icon-button"
      data-maintenance-status-icon
      data-maintenance-open-printer={printer.id}
      data-state={maintenance.state || 'none'}
      aria-label={maintenance.actionText || ''}
      title={maintenance.actionText || ''}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z"></path>
      </svg>
    </button>
  );
}

function PrinterImage({ printer }) {
  const sources = Array.isArray(printer.filaments?.sources) ? printer.filaments.sources : [];
  const extra = Number(printer.filaments?.extra || 0);
  return (
    <div class="printer-image-slot" data-printer-image-slot>
      {printer.image?.key
        ? <img class="printer-model-image" src={`/assets/printers/${printer.image.key}.webp`} alt={printer.image.label} draggable={false} />
        : (
          <div class="printer-model-fallback">
            <span>3D PRINTER</span>
            <strong>{printer.image?.label || printer.name}</strong>
          </div>
        )}
      <div
        class={`dashboard-filament-overlay${sources.length ? '' : ' hidden'}`}
        data-dashboard-filaments
        aria-label="Loaded filament colours"
      >
        {sources.map((source) => (
          <span
            key={source.key}
            class={`dashboard-filament-swatch${source.color ? '' : ' unknown'}`}
            role="img"
            aria-label={source.tooltip}
            title={source.tooltip}
            style={source.color ? { background:source.color } : undefined}
          ></span>
        ))}
        {extra > 0 && (
          <span
            class="dashboard-filament-more"
            title={`${extra} more loaded filament source${extra === 1 ? '' : 's'}`}
          >
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}

function ActivityStrip({ printer }) {
  const activity = printer.activity || {};
  return (
    <div class={`bed-level-strip${activity.visible ? '' : ' hidden'}`} data-bed-level-strip>
      <div>
        <strong data-bed-level-title>{activity.title || 'PRINTER ACTIVITY'}</strong>
        <span data-bed-level-summary>{activity.summary || ''}</span>
      </div>
    </div>
  );
}

function LicenceStrip({ printer }) {
  const licence = printer.licence || {};
  return (
    <div class={`license-strip${licence.visible ? '' : ' hidden'}`} data-license-strip>
      <div>
        <strong data-license-title>{licence.title || ''}</strong>
        <span data-license-summary>{licence.summary || ''}</span>
      </div>
      <UiButton
        variant="secondary"
        data-license-slot-toggle={licence.toggleValue || ''}
        disabled={Boolean(licence.toggleDisabled)}
        title={licence.toggleTitle || ''}
      >
        {licence.toggleText || ''}
      </UiButton>
    </div>
  );
}

function PreheatStrip({ printer }) {
  const preheat = printer.preheat || {};
  return (
    <div class={`preheat-strip${preheat.visible ? '' : ' hidden'}`} data-preheat-strip>
      <div>
        <strong>CHAMBER PREHEAT</strong>
        <span data-preheat-summary>{preheat.summary || ''}</span>
      </div>
      <UiButton variant="secondary" size="small" class="preheat-stop" data-stop-preheat>Stop</UiButton>
    </div>
  );
}

function ClearanceStrip({ printer }) {
  const clearance = printer.clearance || {};
  return (
    <div class={`bed-clearance-strip${clearance.visible ? '' : ' hidden'}`} data-bed-clearance-strip>
      <div>
        <strong>BED CLEARANCE REQUIRED</strong>
        <span data-bed-clearance-summary>{clearance.summary || ''}</span>
      </div>
      <UiButton variant="secondary" size="small" data-bed-cleared-card>Bed cleared</UiButton>
    </div>
  );
}

function PrinterCard({ printer }) {
  const classes = [
    'card',
    printer.visible ? '' : 'hidden',
    printer.selected ? 'selected' : '',
    printer.licence?.inactive ? 'license-inactive' : ''
  ].filter(Boolean).join(' ');
  const jobControl = printer.jobControl || {};

  return (
    <article
      class={classes}
      data-printer-card={printer.id}
      style={printer.sortOrder == null ? undefined : { order:printer.sortOrder }}
    >
      <div class="card-head">
        <div class="card-title-area">
          <label class="printer-select" title="Select printer">
            <input
              type="checkbox"
              data-printer-select
              aria-label={`Select ${printer.name}`}
              checked={Boolean(printer.selected)}
              disabled={Boolean(printer.selectionDisabled)}
            />
            <span></span>
          </label>
          <div>
            <h3 data-name>{printer.name}</h3>
            <div class="subtle" data-host>{printer.hostText}</div>
          </div>
        </div>
        <div class="card-head-actions">
          <div class="reorder-controls" aria-label="Reorder printer">
            <button type="button" class="reorder-button" data-move-earlier title="Move earlier" aria-label="Move printer earlier">←</button>
            <span class="drag-handle" data-drag-handle title="Drag to reorder" aria-label="Drag to reorder" role="button" tabindex="0">⋮⋮</span>
            <button type="button" class="reorder-button" data-move-later title="Move later" aria-label="Move printer later">→</button>
          </div>
          <MaintenanceIcon printer={printer} />
          <StatusBadge state={printer.stateClass} title={printer.badgeTitle || ''}>{printer.state}</StatusBadge>
        </div>
      </div>

      <PrinterImage printer={printer} />
      <ActivityStrip printer={printer} />
      <LicenceStrip printer={printer} />
      <PreheatStrip printer={printer} />
      <ClearanceStrip printer={printer} />

      <div class="card-body">
        <div class="job">
          <span class="job-name" data-job-name>{printer.jobName}</span>
          <b data-progress-value>{printer.progressText}</b>
        </div>
        <ProgressBar value={printer.progress} label={`${printer.name} print progress`} />
        <div class="metrics">
          <Metric label={printer.nozzleLabel} value={printer.nozzle} labelAttributes={{ 'data-nozzle-label':'' }} valueAttributes={{ 'data-nozzle':'' }} />
          <Metric label="Bed" value={printer.bed} valueAttributes={{ 'data-bed':'' }} />
          <Metric label="Layer" value={printer.layer} valueAttributes={{ 'data-layer':'' }} />
          <Metric label="Remaining" value={printer.remaining} valueAttributes={{ 'data-remaining':'' }} />
        </div>
        <div class="health-line">
          <span data-last-seen>{printer.lastSeen}</span>
          <span data-latency>{printer.latency}</span>
        </div>
      </div>

      <div class="card-footer">
        <div class="card-footer-actions">
          <UiButton
            variant={jobControl.action === 'resume' ? 'positive' : 'attention'}
            class={jobControl.className || 'secondary card-job-control hidden'}
            data-card-job-control={jobControl.action || ''}
            disabled={!jobControl.visible}
            title={jobControl.title || ''}
          >
            {jobControl.text || ''}
          </UiButton>
          <UiButton variant="secondary" data-open={printer.id}>Open printer</UiButton>
        </div>
        <div class={`card-error${printer.errorVisible ? '' : ' hidden'}`} data-card-error>{printer.error || ''}</div>
      </div>
    </article>
  );
}

function PrinterFleet() {
  const [state, setState] = useState(() => normalizeFleetState(window.__PFC_DASHBOARD_FLEET_STATE__));

  useEffect(() => {
    const update = (event) => setState(normalizeFleetState(event?.detail || window.__PFC_DASHBOARD_FLEET_STATE__));
    window.addEventListener('pfc:dashboard-fleet-state', update);
    if (window.__PFC_DASHBOARD_FLEET_STATE__) setState(normalizeFleetState(window.__PFC_DASHBOARD_FLEET_STATE__));
    return () => window.removeEventListener('pfc:dashboard-fleet-state', update);
  }, []);

  return <>{state.printers.map((printer) => <PrinterCard key={printer.id} printer={printer} />)}</>;
}

const dashboardRoot = document.querySelector('#dashboardPreactRoot');
if (dashboardRoot) {
  render(<DashboardOverview />, dashboardRoot);
  window.__PFC_PREACT_DASHBOARD__ = true;
}

const fleetRoot = document.querySelector('#fleet');
if (fleetRoot) {
  render(<PrinterFleet />, fleetRoot);
  window.__PFC_PREACT_FLEET__ = true;
}


initPrinterDetailsUi();

initPrintQueueUi();

initPrintLibraryUi();

initMaintenanceUi();

initAlertsUi();

initReportingUi();
