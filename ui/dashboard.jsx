import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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
    activeFilter:FILTERS.some((item) => item.key === input.activeFilter) ? input.activeFilter : 'all',
    groups:Array.isArray(input.groups) ? input.groups.map((group) => ({
      id:String(group?.id || ''),
      name:String(group?.name || ''),
      printerCount:Number(group?.printerCount || 0)
    })).filter((group) => group.id) : [],
    groupId:String(input.groupId || ''),
    viewMode:input.viewMode === 'table' ? 'table' : 'cards'
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
        <button
          id="dashboardViewToggle"
          class="dashboard-view-toggle"
          type="button"
          role="switch"
          aria-checked={String(tableView)}
          aria-label={`Switch dashboard to ${tableView ? 'card' : 'table'} view`}
          onClick={() => dispatchDashboardAction('view', tableView ? 'cards' : 'table')}
        >
          <span class="dashboard-view-toggle-track" aria-hidden="true"></span>
          <span class="dashboard-view-toggle-label">{tableView ? 'Table' : 'Cards'}</span>
        </button>
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
          <button
            key={item.key}
            type="button"
            class={`summary-card${active ? ' active' : ''}`}
            data-dashboard-filter={item.key}
            aria-pressed={String(active)}
            onClick={() => dispatchDashboardAction('filter', item.key)}
          >
            <span class="subtle">{item.label}</span>
            <b>{state.counts[item.key]}</b>
          </button>
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
    </>
  );
}

const root = document.querySelector('#dashboardPreactRoot');
if (root) {
  window.__PFC_PREACT_DASHBOARD__ = true;
  render(<DashboardOverview />, root);
}
